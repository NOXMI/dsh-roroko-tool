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
 * 判重：每个会话只注入一次，登记在进程内存里。DSH 0.2.1 的 Session.log 是私有
 * 字段、surface 只给 seq，扫不到注入痕迹，所以不落盘——进程重启后老会话会再
 * 注入一次，仅此而已。
 *
 * ── 0.2.1 适配：系统段怎么知道自己是哪个 preset ────────────────────────
 * 0.1.6 的 provider 从 `context.agent.session.header.agentPreset` 取；0.2.1 的
 * AssembleContext 只有 `scope`，没有 agent，拿不到会话。于是改成：pre-step
 * （异步、每 turn 都跑，且一定早于本 turn 的系统提示词装配）里把
 * `session.header.agentPreset` 记进实例变量，系统段 provider 直接读它。
 *
 * 每个 preset 的 composition 各挂一份本模块实例，scope 路由只把该 preset 下的
 * 事件送过来，所以这个实例变量对本实例如同常量。不依赖 dsh-scope 的内部符号。
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import { readState, resolveBucket, COMMON, type PreinjectBucket, type PreinjectState } from './presets.js'
import { registerMount, type MountStatus } from './state.js'

/** 子模块标识：只用于日志与消息来源签名，不是独立插件。 */
export const moduleName = 'roroko-preinject'

/**
 * 消息来源是 merge-extensible 的和类型：每个生产者在自己模块里声明自己的 kind。
 * v4 之后没有 catch-all 的 `plugin` kind，所以这里必须自己登记。
 */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'roroko-preinject': { kind: 'roroko-preinject' }
  }
}

/** 抢占的槽位名（等同 PERSONA_PREFIX_SECTION）。 */
const SECTION_NAME = 'deployment:persona-prefix'
/** 官方固定开场白段名，order -1000。 */
const HARNESS_IDENTITY = 'harness:identity'
const VARIABLE = 'roroko_preinject_system'

/**
 * 段名是否命中抹除清单。
 * 清单项以 `*` 结尾时按前缀匹配（`tool:*` 抹掉所有 `tool:` 开头的段）。
 */
export function matchesSuppress(name: string, patterns: readonly string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.endsWith('*')) {
      if (name.startsWith(pattern.slice(0, -1))) return true
    } else if (name === pattern) return true
  }
  return false
}

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
  /** 顶掉 "You are an AI agent powered by DeepSeek Harness." 这个开场白。 */
  suppressHarnessIdentity?: boolean
  /** 要抹掉的系统段名清单（装配后按名过滤）。 */
  suppressSections?: string[]
}

/**
 * 内置抹除的段：清单只能加，不能减。
 *
 *   context:file-reference          @文件引用语法说明（"Tokens prefixed with @ …"）
 *   tool:*                          各工具的使用说明大段（read/write/edit/glob/grep/
 *                                   bash/web_search/web_fetch…）—— 工具 schema 里本来
 *                                   就有参数说明，这一大段是重复叙事
 *   ui:deliverable-file-references  "Prefer showing the primary results…" 交付物/链接规范
 *   harness:source                  实现仓库自检指引（我们不在改 DSH 本体）
 *   app:web-surface                 Web GUI 自述与「别乱起服务器」指引
 *
 * 支持尾部 `*` 前缀匹配，所以 `tool:*` 一网打尽，新装工具也不用改代码。
 */
const BUILTIN_SUPPRESS_SECTIONS = [
  'context:file-reference',
  'tool:*',
  'ui:deliverable-file-references',
  'harness:source',
  'app:web-surface',
]

/** 内置默认（最底层）。 */
export const DEFAULTS: Required<Omit<PreinjectConfig, 'enabled' | 'root' | 'suppressHarnessIdentity'>> = {
  systemFiles: [],
  userFiles: [],
  suppressSections: [],
}

/** 四层合成后的有效参数。 */
export interface EffectiveConfig {
  systemFiles: string[]
  userFiles: string[]
  suppressSections: string[]
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
  // 抹除清单是**叠加**语义：内置的永远在，三层只能往上加。
  // （schema 会把没写的数组填成 []，做成"可覆盖"的话配置层一填就把内置顶掉了。）
  const extra = bucket.suppressSections ?? config.suppressSections ?? DEFAULTS.suppressSections
  return {
    systemFiles: bucket.systemFiles ?? config.systemFiles ?? DEFAULTS.systemFiles,
    userFiles: bucket.userFiles ?? config.userFiles ?? DEFAULTS.userFiles,
    suppressSections: [...new Set([...BUILTIN_SUPPRESS_SECTIONS, ...extra])],
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
  on(event: string, listener: (...args: any[]) => unknown): unknown
}

const dshHome = (): string => process.env.DSH_HOME ?? join(homedir(), '.dsh')

/** 默认身份根。 */
export function defaultRoot(): string {
  return join(dshHome(), 'roroko')
}

/** 清单项解析：相对 root；`~/` 走主目录；绝对路径原样。 */
export function entryPath(name: string, root: string): string {
  if (isAbsolute(name)) return name
  if (name === '~') return homedir()
  if (name.startsWith('~/') || name.startsWith('~\\')) return join(homedir(), name.slice(2))
  return resolve(root, name)
}

/** 已注入过的会话（进程内存，重启即清空）。 */
const INJECTED = new Set<string>()

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

/** 用户层正文：纯拼接，不加签名、不加壳——首尾要什么，清单里的文件自己带。 */
async function userSegmentText(
  root: string,
  config: PreinjectConfig,
  presetId: string | undefined,
): Promise<string> {
  const effective = resolveEffective(config, readState(root), presetId)
  return mergeTexts(await Promise.all(effective.userFiles.map(name => readAsync(entryPath(name, root)))))
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

  /**
   * 本实例所属 preset id（**实例变量，不是模块变量**——两个 preset 的实例共享
   * 同一份模块，模块级变量会互相串）。
   *
   * 为什么必须在 pre-step 之外也记一次：一次 step 的顺序是
   * `assemble(系统提示词) → agent/pre-step`（见 agent-loop 的 preStep），所以
   * 一个会话的**首次装配**永远早于它的首次 pre-step。只听 pre-step 的话，
   * 新会话第一轮的系统段就是空的——之前就是栽在这儿。`agent/created` 在会话
   * 创建时就触发且被等待，从那里拿 header.agentPreset 才能喂到首装配。
   */
  let activePreset: string | undefined
  const remember = (presetId: string | undefined): void => {
    if (presetId !== undefined && presetId.length > 0) activePreset = presetId
  }

  const status: MountStatus = { root, config }
  surface.effect(() => registerMount(status), 'preinject.status()')

  surface.effect(
    () => surface.systemPrompt.variable(VARIABLE, () => {
      try {
        return systemText(root, config, activePreset)
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

  /**
   * 按名抹掉系统段。装配瀑布是 scope 过滤的，这里只收本 preset 的装配；
   * `complete` 段由装配侧恢复，所以抹不掉李代桃僵的那一段（也不该抹）。
   */
  surface.on('system-prompt/assemble', async (
    assembly: { sections: Array<{ name: string }> },
    _context: unknown,
    next: () => Promise<{ sections: Array<{ name: string }> }>,
  ) => {
    const result = await next()
    try {
      const drop = resolveEffective(config, readState(root), activePreset).suppressSections
      if (drop.length === 0) return result
      const kept = result.sections.filter(section => !matchesSuppress(section.name, drop))
      return kept.length === result.sections.length ? result : { ...result, sections: kept }
    } catch {
      // 装配瀑布里抛错会打崩整个 turn —— 一律吞掉，保持原样。
      return result
    }
  })

  // 会话创建时就记下 preset：首次装配要用（首装配早于首次 pre-step）。
  surface.on('agent/created', async (payload: PreStepPayload) => {
    remember(payload.agent?.session?.header?.agentPreset)
  })

  surface.on('agent/pre-step', async (payload: PreStepPayload, next: () => Promise<PreStepDecision>) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const session = payload.agent.session
    const presetId = session?.header?.agentPreset
    // 再记一次兜底（agent/created 万一没赶上）。
    remember(presetId)
    const sessionId = session?.id ?? session?.header?.id
    if (sessionId !== undefined && INJECTED.has(sessionId)) return decision
    const text = await userSegmentText(root, config, presetId)
    if (!text) return decision
    if (sessionId !== undefined) INJECTED.add(sessionId)
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: moduleName },
    })
    // 追加在本批用户消息之后。
    return { ...decision, messages: [...(decision.messages ?? []), message] }
  })
}

export { COMMON }
