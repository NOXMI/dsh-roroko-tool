/**
 * roroko-preinject —— 双段注入子模块。
 *
 * 参数解析照 0.1.6 那条四层链，逐字段回落：
 *
 *   内置默认 ← preset 接线 config ← 公共桶 common ← 分 preset 桶
 *
 * 两张清单：
 *   系统层 systemFiles —— 按顺序拼进系统提示词（`deployment:persona-prefix`，
 *                         section 文本只放宏，正文由变量 provider 现读）。
 *   用户层 userFiles   —— 按顺序拼成一条 user 消息，落在本批用户消息之后，
 *                         每会话一次。
 *
 * 覆盖层存 `<root>/state/preinject.json`，按 preset 分桶（见 presets.ts）。
 * 文件路径相对 root 解析，`~/` 走主目录，绝对路径原样用；读不到静默跳过。
 * 判重记在 `<root>/state/injected.json`，跨重启有效。
 *
 * ── 0.2.1 适配：系统段怎么知道自己是哪个 preset ────────────────────────
 * 0.1.6 的 provider 从 `context.agent.session.header.agentPreset` 取；0.2.1 的
 * AssembleContext 只有 `scope`，没有 agent。于是改成：pre-step（异步、每 turn
 * 都跑）里用 `scopeOf(agent.ctx)` 读出该 agent 的 scope key，把
 * `scope → agentPreset` 记进 WeakMap；系统段 provider 拿 `context.scope` 查表。
 * 查不到（装配早于第一次 pre-step）就只吃公共桶 —— 行为可预测，不串会话。
 */
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import { readState, resolveBucket, COMMON, type PreinjectBucket, type PreinjectState } from './presets.js'
import { registerMount, type MountStatus } from './state.js'

/** 子模块标识：只用于日志与消息来源签名，不是独立插件。 */
export const moduleName = 'roroko-preinject'

/** 抢占的槽位名（等同 PERSONA_PREFIX_SECTION）。 */
const SECTION_NAME = 'deployment:persona-prefix'
/** 官方固定开场白段名，order -1000。 */
const HARNESS_IDENTITY = 'harness:identity'
const VARIABLE = 'roroko_preinject_system'
const MARK = '[roroko-preinject]'

/** 接线参数（preset 的 config.preinject）：一层可选基线，不写就走默认。 */
export interface PreinjectConfig {
  /** false 时不挂载本模块。 */
  enabled?: boolean
  /** 文件基准目录，默认 $DSH_HOME/roroko。 */
  root?: string
  /** 接线层的系统层清单。 */
  systemFiles?: string[]
  /** 接线层的用户层清单。 */
  userFiles?: string[]
  /** 接线层的 wrap 开关。 */
  wrap?: boolean
  /** 顶掉 "You are an AI agent powered by DeepSeek Harness." 这个开场白。 */
  suppressHarnessIdentity?: boolean
}

/** 内置默认（最底层）。 */
export const DEFAULTS: Required<Omit<PreinjectConfig, 'enabled' | 'root' | 'suppressHarnessIdentity'>> = {
  systemFiles: [],
  userFiles: [],
  wrap: true,
}

/** 四层合成后的有效参数。 */
export interface EffectiveConfig {
  systemFiles: string[]
  userFiles: string[]
  wrap: boolean
}

/**
 * 四层合成：默认 ← 接线 config ← 公共桶 ← 分 preset 桶。
 * @param config - preset 接线层。
 * @param state - 覆盖层状态。
 * @param presetId - 会话的 preset id；空 = 只吃公共桶。
 * @returns 该 preset 生效的参数。
 */
export function resolveEffective(
  config: PreinjectConfig,
  state: PreinjectState,
  presetId: string | undefined,
): EffectiveConfig {
  const bucket: PreinjectBucket = resolveBucket(state, presetId)
  return {
    systemFiles: bucket.systemFiles ?? config.systemFiles ?? DEFAULTS.systemFiles,
    userFiles: bucket.userFiles ?? config.userFiles ?? DEFAULTS.userFiles,
    wrap: bucket.wrap ?? config.wrap ?? DEFAULTS.wrap,
  }
}

/** ctx 上本模块用到的最小面（避免绑死具体类型）。 */
interface PromptSurface {
  variable(
    name: string,
    provider: (context: { scope?: object } | undefined) => string | undefined,
  ): () => void
  section(section: {
    name: string
    order: number
    text: string
    interpolate?: boolean
    complete?: boolean
  }): () => void
  getSectionOrder(name: 'DEPLOYMENT_PERSONA_PREFIX' | 'HARNESS_IDENTITY'): number
}

interface PreStepDecision {
  kind: 'reject' | 'enter'
  messages?: unknown[]
}

interface PreStepPayload {
  agent: {
    /** 0.2.1 的 Agent 自带 ctx，用它读 scope。 */
    ctx?: object
    session?: {
      id?: string
      header?: { id?: string; agentPreset?: string }
    }
  }
}

interface Surface {
  systemPrompt: PromptSurface
  effect(callback: () => unknown, label?: string): unknown
  on(
    event: 'agent/pre-step',
    listener: (payload: PreStepPayload, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>,
  ): unknown
}

const dshHome = (): string => process.env.DSH_HOME ?? join(homedir(), '.dsh')

/** 默认身份根。 */
export function defaultRoot(): string {
  return join(dshHome(), 'roroko')
}

/** 判重文件。 */
export function injectedFile(root: string): string {
  return join(root, 'state', 'injected.json')
}

/** 清单项解析：相对 root；`~/` 走主目录；绝对路径原样。 */
export function entryPath(name: string, root: string): string {
  if (isAbsolute(name)) return name
  if (name === '~') return homedir()
  if (name.startsWith('~/') || name.startsWith('~\\')) return join(homedir(), name.slice(2))
  return resolve(root, name)
}

/**
 * scope → preset id 的登记簿。
 * provider 是同步的，只能靠 pre-step 预先喂进来；WeakMap 让 scope 随 agent 回收。
 */
const SCOPE_PRESETS = new WeakMap<object, string>()

/** dsh-scope 的 scopeOf：动态加载，宿主没提供这个包就降级。 */
type ScopeOf = (ctx: unknown) => object | undefined
let scopeOfFn: ScopeOf | undefined

/**
 * 懒加载 `@deepseek-ai/dsh-scope`。
 *
 * 必须是宿主那一份实例（它读的是模块私有的 kScope 符号），所以只能当外部依赖
 * 引，不能打包。宿主没提供时安静降级——系统段只吃公共桶，用户段照常分桶。
 */
function loadScopeOf(): void {
  if (scopeOfFn !== undefined) return
  void import('@deepseek-ai/dsh-scope')
    .then(module => { scopeOfFn = module.scopeOf as ScopeOf })
    .catch(() => { /* 没有这个包：保持降级 */ })
}

/** 读当前 ctx 的 scope key。 */
function scopeOf(ctx: object | undefined): object | undefined {
  return ctx === undefined || scopeOfFn === undefined ? undefined : scopeOfFn(ctx)
}

/** 读当前 scope 对应的 preset id。 */
function presetOf(scope: object | undefined): string | undefined {
  return scope === undefined ? undefined : SCOPE_PRESETS.get(scope)
}

function readSync(path: string): string {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return ''
  }
}

async function readAsync(path: string): Promise<string> {
  try {
    return (await readFile(path, 'utf8')).trim()
  } catch {
    return ''
  }
}

function mergeTexts(texts: readonly string[]): string {
  return texts.filter(Boolean).join('\n\n')
}

/** 系统层正文：按该 preset 生效的清单读，缺文件跳过。 */
function systemText(root: string, config: PreinjectConfig, presetId: string | undefined): string {
  const effective = resolveEffective(config, readState(root), presetId)
  return mergeTexts(effective.systemFiles.map(name => readSync(entryPath(name, root))))
}

/** 用户层正文（pre-step 里读，含签名与可选壳）。 */
async function userSegmentText(
  root: string,
  config: PreinjectConfig,
  presetId: string | undefined,
): Promise<string> {
  const effective = resolveEffective(config, readState(root), presetId)
  const body = mergeTexts(await Promise.all(effective.userFiles.map(name => readAsync(entryPath(name, root)))))
  if (!body) return ''
  const named = `${MARK} 用户层注入（${effective.userFiles.join(', ')}）：\n\n${body}`
  return effective.wrap ? `<system-reminder>\n${named}\n</system-reminder>` : named
}

async function loadInjected(file: string): Promise<Set<string>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

async function markInjected(file: string, sessionId: string): Promise<void> {
  const set = await loadInjected(file)
  if (set.has(sessionId)) return
  set.add(sessionId)
  try {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify([...set]), 'utf8')
  } catch {
    // 判重失败不影响注入本身
  }
}

/**
 * 挂载本子模块。由 host 在自己的 ctx 上调用，不单独占一行插件。
 * @param ctx - 宿主上下文（通常是 preset scope 里的子 fiber）。
 * @param rawConfig - 子模块配置（preset 的 config.preinject）。
 */
export function mount(ctx: Context, rawConfig: PreinjectConfig = {}): void {
  const surface = ctx as unknown as Surface
  const config: PreinjectConfig = { ...rawConfig }
  const root = rawConfig.root !== undefined && rawConfig.root.length > 0 ? rawConfig.root : defaultRoot()
  const file = injectedFile(root)

  const status: MountStatus = { root, config, stateFile: join(root, 'state', 'preinject.json'), injectedFile: file }
  surface.effect(() => registerMount(status), 'preinject.status()')
  loadScopeOf()

  surface.effect(
    () => surface.systemPrompt.variable(VARIABLE, context => {
      try {
        return systemText(root, config, presetOf(context?.scope))
      } catch {
        // provider 抛错会打崩整个 turn，兜底成空串（该 section 被丢弃）。
        return ''
      }
    }),
    'preinject.variable()',
  )
  surface.effect(
    () => surface.systemPrompt.section({
      name: SECTION_NAME,
      order: surface.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
      text: `{{${VARIABLE}}}`,
    }),
    'preinject.section()',
  )

  if (rawConfig.suppressHarnessIdentity !== false) {
    surface.effect(
      () => surface.systemPrompt.section({
        name: HARNESS_IDENTITY,
        order: surface.systemPrompt.getSectionOrder('HARNESS_IDENTITY'),
        text: '',
      }),
      'preinject.suppressHarnessIdentity()',
    )
  }

  surface.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const session = payload.agent.session
    const presetId = session?.header?.agentPreset
    // 喂 scope 登记簿：系统段的 provider 靠它选桶。
    const scope = payload.agent.ctx === undefined ? undefined : scopeOf(payload.agent.ctx as Context)
    if (scope !== undefined && presetId !== undefined) SCOPE_PRESETS.set(scope, presetId)
    const sessionId = session?.id ?? session?.header?.id
    if (sessionId !== undefined && (await loadInjected(file)).has(sessionId)) return decision
    const text = await userSegmentText(root, config, presetId)
    if (!text) return decision
    if (sessionId !== undefined) await markInjected(file, sessionId)
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: moduleName },
    })
    // 追加在本批用户消息之后。
    return { ...decision, messages: [...(decision.messages ?? []), message] }
  })
}

export { COMMON }
