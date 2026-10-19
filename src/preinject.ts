/**
 * roroko-preinject —— 双段注入子模块。
 *
 * 就两张清单，谁都不认识、什么都不猜：
 *   系统层 systemFiles —— 按顺序拼进系统提示词（`deployment:persona-prefix`，
 *                         section 文本只放宏，正文由变量 provider 现读）。
 *   用户层 userFiles   —— 按顺序拼成一条 user 消息，追加在本批用户消息之后，
 *                         每会话一次。
 *
 * 清单只有一份，存在 `<root>/state/preinject.json`，设置页读写；preset 里只给
 * `root`。两个清单都空 = 什么都不注入。
 *
 * 文件路径相对 root 解析，`~/` 走主目录，绝对路径原样用；读不到静默跳过。
 * 判重记在 `<root>/state/injected.json`，跨重启有效。
 */
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import { registerMount, type MountStatus } from './state.js'

/** 子模块标识：只用于日志与消息来源签名，不是独立插件。 */
export const moduleName = 'roroko-preinject'

/** 抢占的槽位名（等同 PERSONA_PREFIX_SECTION）。 */
const SECTION_NAME = 'deployment:persona-prefix'
/** 官方固定开场白段名，order -1000。 */
const HARNESS_IDENTITY = 'harness:identity'
const VARIABLE = 'roroko_preinject_system'
const MARK = '[roroko-preinject]'

/** preset 接线参数：只给目录与几个开关，清单不在这里写。 */
export interface PreinjectConfig {
  /** false 时不挂载本模块。 */
  enabled?: boolean
  /** 文件基准目录，默认 $DSH_HOME/roroko。 */
  root?: string
  /** 顶掉 "You are an AI agent powered by DeepSeek Harness." 这个开场白。 */
  suppressHarnessIdentity?: boolean
}

/** 两张注入清单（设置页唯一编辑的东西）。 */
export interface InjectConfig {
  /** 系统层：相对 root 的文件名，按顺序拼进系统提示词。 */
  systemFiles: string[]
  /** 用户层：相对 root 的文件名，按顺序拼成一条 user 消息。 */
  userFiles: string[]
  /** 用户层是否包 `<system-reminder>`。 */
  wrap: boolean
}

export const DEFAULTS: InjectConfig = {
  systemFiles: [],
  userFiles: [],
  wrap: true,
}

/** ctx 上本模块用到的最小面（避免绑死具体类型）。 */
interface PromptSurface {
  variable(name: string, provider: (context: unknown) => string | undefined): () => void
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
    session?: {
      id?: string
      header?: { id?: string }
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

/** 清单文件。 */
export function configFile(root: string): string {
  return join(root, 'state', 'preinject.json')
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

/** 清单清洗：字符串、去空白、去空项。 */
function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
}

/** 读清单（同步：系统段 provider 不能 await）。坏文件当空。 */
export function readConfig(root: string): InjectConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(configFile(root), 'utf8'))
  } catch {
    return { ...DEFAULTS }
  }
  if (parsed === null || typeof parsed !== 'object') return { ...DEFAULTS }
  const raw = parsed as Record<string, unknown>
  return {
    systemFiles: cleanList(raw.systemFiles),
    userFiles: cleanList(raw.userFiles),
    wrap: typeof raw.wrap === 'boolean' ? raw.wrap : DEFAULTS.wrap,
  }
}

/**
 * 整份写清单（全量替换，不合并）。
 * @param root - 身份根。
 * @param patch - 页面提交的字段，缺的走默认。
 * @returns 落盘后的清单。
 */
export async function writeConfig(root: string, patch: Record<string, unknown>): Promise<InjectConfig> {
  const next: InjectConfig = {
    systemFiles: cleanList(patch.systemFiles),
    userFiles: cleanList(patch.userFiles),
    wrap: typeof patch.wrap === 'boolean' ? patch.wrap : DEFAULTS.wrap,
  }
  const file = configFile(root)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

/** 系统层正文：清单现读，读不到的文件跳过。 */
function systemText(root: string): string {
  return readConfig(root).systemFiles
    .map(name => readSync(entryPath(name, root)))
    .filter(Boolean)
    .join('\n\n')
}

/** 用户层正文：带签名，可选 system-reminder 壳。 */
async function userSegmentText(root: string): Promise<string> {
  const config = readConfig(root)
  const body = (await Promise.all(config.userFiles.map(name => readAsync(entryPath(name, root)))))
    .filter(Boolean)
    .join('\n\n')
  if (!body) return ''
  const named = `${MARK} 用户层注入（${config.userFiles.join(', ')}）：\n\n${body}`
  return config.wrap ? `<system-reminder>\n${named}\n</system-reminder>` : named
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
  const root = rawConfig.root !== undefined && rawConfig.root.length > 0 ? rawConfig.root : defaultRoot()
  const file = injectedFile(root)

  const status: MountStatus = { root, configFile: configFile(root), injectedFile: file }
  surface.effect(() => registerMount(status), 'preinject.status()')

  surface.effect(
    () => surface.systemPrompt.variable(VARIABLE, () => systemText(root)),
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
    const sessionId = session?.id ?? session?.header?.id
    if (sessionId !== undefined && (await loadInjected(file)).has(sessionId)) return decision
    const text = await userSegmentText(root)
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
