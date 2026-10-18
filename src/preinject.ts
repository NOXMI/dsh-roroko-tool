/**
 * roroko-preinject —— 双段注入子模块。
 *
 * 系统段：注册 `deployment:persona-prefix`（顶掉官方 persona），section 文本只放
 *         宏 `{{roroko_preinject_system}}`，正文由 variable provider 每次装配现读文件。
 *         这样文件正文里的花括号不会进插值扫描路径，改文件下一步就生效。
 * 消息段：`agent/pre-step` 注入一条带本插件签名的 user 消息，每会话一次。
 *
 * 文件归属：
 *   身份文件 —— 相对的按 root（默认 $DSH_HOME/roroko）解析，跟预设走，不跟工作区。
 *   工作区文件 —— 相对的按会话 cwd 解析，跟项目走。
 *
 * 判重：$DSH_HOME/roroko/state/injected.json 记 sessionId，跨重启有效。
 */
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'

/** 子模块标识：只用于日志与消息来源签名，不是独立插件。 */
export const moduleName = 'roroko-preinject'

/** 抢占的槽位名（等同 PERSONA_PREFIX_SECTION）。 */
const SECTION_NAME = 'deployment:persona-prefix'
/** 官方固定开场白段名，order -1000。 */
const HARNESS_IDENTITY = 'harness:identity'
const VARIABLE = 'roroko_preinject_system'
const MARK = '[roroko-preinject]'

export interface PreinjectConfig {
  /** false 时不挂载本模块。 */
  enabled?: boolean
  /** 身份文件根目录，默认 $DSH_HOME/roroko。 */
  root?: string
  /** 身份文件（相对 root）。 */
  identityFiles?: string[]
  /** 工作区指令文件（相对会话 cwd）。 */
  workspaceFiles?: string[]
  /** 系统段是否拼入工作区文件。 */
  includeWorkspace?: boolean
  /** 工作区找不到文件时，回落到 root 下的同名文件。 */
  workspaceFallbackToRoot?: boolean
  /** 消息段是否包 <system-reminder>。 */
  wrap?: boolean
  /** 顶掉 "You are an AI agent powered by DeepSeek Harness." 这个开场白。 */
  suppressHarnessIdentity?: boolean
}

const DEFAULTS: Required<Omit<PreinjectConfig, 'enabled' | 'root'>> = {
  identityFiles: ['IDENTITY.md'],
  workspaceFiles: ['AGENTS.md'],
  includeWorkspace: true,
  workspaceFallbackToRoot: true,
  wrap: true,
  suppressHarnessIdentity: true,
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
  suppressRuntimeContext?(): () => void
}

interface PreStepDecision {
  kind: 'reject' | 'enter'
  messages?: unknown[]
}

interface PreStepPayload {
  agent: {
    session?: {
      id?: string
      header?: { id?: string; cwd?: string }
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

function readSync(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

async function readAsync(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

function resolveList(list: readonly string[], base: string): string[] {
  return list.map(path => (isAbsolute(path) ? path : resolve(base, path)))
}

function mergeTexts(texts: readonly string[]): string {
  return texts
    .map(text => text.trim())
    .filter(Boolean)
    .join('\n\n')
}

/** 系统段正文：身份文件 + 工作区文件，每次装配现读。 */
function systemText(config: PreinjectConfig, root: string): string {
  const identity = mergeTexts(resolveList(config.identityFiles ?? DEFAULTS.identityFiles, root).map(readSync))
  const workspace = config.includeWorkspace === false
    ? ''
    : mergeTexts(workspacePaths(config, process.cwd(), root).map(readSync))
  return [identity, workspace].filter(Boolean).join('\n\n---\n\n')
}

/** 工作区文件路径：按 cwd → root → 服务 cwd 依次找，用第一个有内容的。 */
function workspacePaths(config: PreinjectConfig, cwd: string, root: string): string[] {
  const files = config.workspaceFiles ?? DEFAULTS.workspaceFiles
  if (config.workspaceFallbackToRoot === false) return resolveList(files, cwd)
  const candidates = [cwd, root, process.cwd()]
  for (const base of candidates) {
    const paths = resolveList(files, base)
    if (paths.some(path => readSync(path) !== '')) return paths
  }
  return resolveList(files, cwd)
}

/** 消息段正文：只放工作区文件。 */
async function userSegmentText(config: PreinjectConfig, cwd: string, root: string): Promise<string> {
  const files = config.workspaceFiles ?? DEFAULTS.workspaceFiles
  const paths = workspacePaths(config, cwd, root)
  const workspace = mergeTexts(await Promise.all(paths.map(readAsync)))
  if (!workspace) return ''
  const body = `${MARK} 本工作区指令（${files.join(', ')}）：\n\n${workspace}`
  return config.wrap === false ? body : `<system-reminder>\n${body}\n</system-reminder>`
}

function stateFile(root: string): string {
  return join(root, 'state', 'injected.json')
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
  const config: PreinjectConfig = { ...DEFAULTS, ...rawConfig }
  const root = rawConfig.root ?? join(dshHome(), 'roroko')
  const file = stateFile(root)

  surface.effect(
    () => surface.systemPrompt.variable(VARIABLE, () => systemText(config, root)),
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

  if (config.suppressHarnessIdentity !== false) {
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
    const cwd = session?.header?.cwd ?? process.cwd()
    const text = await userSegmentText(config, cwd, root)
    if (!text) return decision
    if (sessionId !== undefined) await markInjected(file, sessionId)
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: moduleName },
    })
    return { ...decision, messages: [message, ...(decision.messages ?? [])] }
  })
}
