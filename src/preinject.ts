/**
 * roroko-preinject — one-shot workspace instruction injector.
 *
 * 自 dsh-roroko-preinject 迁入 roroko-tool 大包(收编第一站)。
 *
 * Reads a fixed list of files from the agent's session cwd and injects them
 * once as a single user message on the first entering agent step.
 *
 * Unlike `@deepseek-ai/dsh-agent-instructions`, this plugin does NOT watch for
 * file changes and never re-injects updated instructions.
 *
 * The one-shot guard is durable-history-driven: once the injected message is
 * appended to the session event log (agent.ts appends `decision.messages` as
 * `user/message` on step/start), every later pre-step — including a resumed
 * session after a process restart — finds it on the surface and skips
 * re-injection. Compaction folding the injection away naturally re-injects,
 * matching the `agent-instructions` baseline contract.
 *
 * 电箱闸门(roroko-tool 设置):agent 层能注入 settings 服务时,动手前读
 * `roroko-tool` 命名空间的 `preinject.enabled`,关闸(false)即熄火、不注入。
 * settings 服务不可达时按默认「开」处理,不因配置系统故障丢失核心注入。
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { ROROKO_TOOL_SETTINGS_NS } from './settings.ts'

export const name = 'roroko-preinject'

/** Services required before the injector may scan the session surface.
 *  Aligns with `@deepseek-ai/dsh-agent-instructions` so the one-shot guard
 *  reads a fully-projected surface after a process restart (no re-injection
 *  on resume). */
export const inject = ['sessionProjections']

export interface RorokoPreinjectConfig {
  /** File names, relative to the session cwd, in injection order. */
  files: string[]
  /** Whether to wrap the final text in `<system-reminder> ... </system-reminder>`. */
  wrapInSystemReminder?: boolean
  /** Optional text inserted before the merged file content. */
  header?: string
  /** Optional text inserted after the merged file content. */
  footer?: string
}

async function loadMergedText(baseDir: string, files: readonly string[]): Promise<string> {
  const parts: string[] = []
  for (const file of files) {
    try {
      const text = await readFile(resolve(baseDir, file), 'utf8')
      if (text.trim().length > 0) parts.push(text.trim())
    } catch {
      // Missing or unreadable files are skipped; the rest still inject.
    }
  }
  return parts.join('\n\n')
}

function buildInjectionText(
  content: string,
  config: Pick<RorokoPreinjectConfig, 'wrapInSystemReminder' | 'header' | 'footer'>,
): string {
  const sections = [config.header?.trim(), content, config.footer?.trim()]
    .filter((part): part is string => part !== undefined && part.length > 0)
  const body = sections.join('\n\n')
  return config.wrapInSystemReminder === true
    ? `<system-reminder>\n${body}\n</system-reminder>`
    : body
}

/**
 * Whether this session's durable surface already carries a roroko-preinject
 * injection. Scans the model-visible surface (the same set of events the
 * agent's history projects), so the guard survives process restarts — unlike a
 * process-local WeakSet, which resets on every boot.
 */
function hasInjected(session: Session): boolean {
  for (const seq of session.surface.nodes.toReversed()) {
    const event = session.events[seq]
    if (event?.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === name) return true
  }
  return false
}

/** roroko-tool 电箱闸门读取器(读 preinject.enabled)。 */
type PreinjectGate = () => boolean

function installGate(ctx: Context): PreinjectGate {
  let enabled: (() => boolean) | undefined
  const capable = ctx as unknown as {
    inject?(services: string[], callback: (scoped: { settings: { get?(ns: string): unknown } }) => void): void
  }
  capable.inject?.(['settings'], (scoped) => {
    enabled = () => {
      try {
        const section = scoped.settings.get?.(ROROKO_TOOL_SETTINGS_NS) as
          | { preinject?: { enabled?: boolean } }
          | undefined
        return section?.preinject?.enabled ?? true
      } catch {
        return true
      }
    }
  })
  // settings 服务不可达(agent 层无法注入)时按默认「开」处理。
  return () => (enabled ? enabled() : true)
}

export function apply(ctx: Context, config: RorokoPreinjectConfig): void {
  const files = config.files ?? []
  const gate = installGate(ctx)

  ctx.on('agent/pre-step', async ({ agent, messages }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    // 电箱关闸:roroko-tool 设置里 preinject.enabled === false → 熄火。
    if (gate() === false) return decision
    if (hasInjected(agent.session)) return decision

    const cwd = agent.session.header.cwd ?? process.cwd()
    const content = await loadMergedText(cwd, files)
    if (content.length === 0) return decision

    const text = buildInjectionText(content, config)
    const injectedMessage = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: name },
    })

    // Insert right after the claimed user batch, the same position where
    // `agent-instructions` would normally place its baseline.
    const lastClaimedIndex = decision.messages.findLastIndex(message => messages.includes(message))
    const entered = decision.messages.toSpliced(lastClaimedIndex + 1, 0, injectedMessage)

    return { ...decision, messages: entered }
  })
}
