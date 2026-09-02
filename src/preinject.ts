/**
 * roroko-preinject — 一次性工作区指令注入器(roroko-tool 电箱子功能)。
 *
 * 自独立旧插件 dsh-roroko-preinject 收编迁入 roroko-tool 大包(2026-09-02)。
 *
 * Reads a fixed list of files from the agent's session cwd and injects them
 * once as a single user message on the first entering agent step.
 *
 * Unlike `@deepseek-ai/dsh-agent-instructions`, this plugin does NOT watch for
 * file changes and never re-injects updated instructions.
 *
 * The one-shot guard is durable-log-driven: once the injected message is
 * appended to the session log (agent.ts appends `decision.messages` as
 * `user/message` on step/start), every later pre-step — including a resumed
 * session after a process restart — finds it in `session.events` and skips
 * re-injection. Compaction folding the injection away naturally re-injects.
 *
 * 电箱闸门(roroko-tool 设置):agent 层动手前读 host 的 state 文件(roroko-tool-
 * state.json,同进程共享文件系统),`preinject.enabled === false` 即熄火、不注入。
 * 注入参数(files/header/footer/wrapInSystemReminder)同样读自 state,由 webgui
 * 设置页编辑。
 *
 * 判重实现说明(2026-09-03 修复):曾尝试扫 `session.surface.nodes` 和
 * `session.events` 均失败——surface 是依赖 sessionProjections 的增量投影,
 * events 是 getter 在 agent preset 层访问实测为 undefined。改为直接遍历
 * `session.log`(Session 内部持久事件数组,seq 即索引,resume 后即完整),
 * 找带本插件 source 签名的 user/message,有则说明已注入过。实测:同一会话
 * 连续多 turn + 进程重启恢复后均不再重复注入。
 *
 * 参数(2026-09-03 三改):enabled 运行级开关退役——preset 声明本插件即启用
 * 注入。files/header/footer/wrapInSystemReminder 两层:preset 接线
 * `config`(声明即配)兜底,host state 文件 preinject 节覆盖优先(设置页编辑)。
 * 参数只影响注入内容,不改工具目录,不破坏 request-cache。
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { loadState } from './state.js'
import type { RorokoPreinjectState } from './settings.js'

export const name = 'roroko-preinject'

/** 接线 config(2026-09-03 三改:成为注入参数的 preset 声明源)。 */
export interface RorokoPreinjectConfig {
  files?: string[]
  wrapInSystemReminder?: boolean
  header?: string
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
  config: {
    wrapInSystemReminder?: boolean
    header?: string
    footer?: string
  },
): string {
  const sections = [config.header?.trim(), content, config.footer?.trim()]
    .filter((part): part is string => part !== undefined && part.length > 0)
  const body = sections.join('\n\n')
  return config.wrapInSystemReminder === true
    ? `<system-reminder>\n${body}\n</system-reminder>`
    : body
}

/**
 * Whether this session's durable log already carries a roroko-preinject
 * injection. Scans the whole persisted event log for a user/message whose
 * source carries this plugin's signature. Survives process restarts — unlike a
 * process-local WeakSet — because the log is the durable source of truth.
 */
function hasInjected(session: Session): boolean {
  // session.log 是内部事件数组(seq 即索引);session.events 是 getter,在 agent
  // preset 层实测访问为 undefined(见 2026-09-03 排查),改用 log 直读。
  const sess = session as unknown as { log?: unknown }
  const rawLog = sess.log
  if (!Array.isArray(rawLog)) return false
  for (const event of rawLog as Array<{
    type?: string
    data?: { source?: { kind?: string; plugin?: string } }
  }>) {
    if (event?.type === 'user/message'
      && event.data?.source?.kind === 'plugin'
      && event.data.source.plugin === name) return true
  }
  return false
}

/**
 * 合并注入参数:preset config 兜底,state preinject 节覆盖优先。
 * state 缺失/损坏时纯用 config。返回最终 files/header/footer/wrap。
 */
async function resolveInjectParams(
  config: RorokoPreinjectConfig,
): Promise<{ files: string[]; wrap: boolean; header: string; footer: string }> {
  const state = await loadState()
  const override: RorokoPreinjectState = state.preinject
  const files = override.files.length > 0 ? override.files : (config.files ?? [])
  const wrap = override.wrapInSystemReminder ?? config.wrapInSystemReminder ?? false
  const header = override.header.length > 0 ? override.header : (config.header ?? '')
  const footer = override.footer.length > 0 ? override.footer : (config.footer ?? '')
  return { files, wrap, header, footer }
}

export function apply(ctx: Context, config: RorokoPreinjectConfig = {}): void {
  ctx.on('agent/pre-step', async ({ agent, messages }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    // 一次性注入判重:已注入过的会话跳过(见 hasInjected)。
    if (hasInjected(agent.session)) return decision

    const cwd = agent.session.header.cwd ?? process.cwd()
    const params = await resolveInjectParams(config)
    const content = await loadMergedText(cwd, params.files)
    if (content.length === 0) return decision

    const text = buildInjectionText(content, {
      wrapInSystemReminder: params.wrap,
      header: params.header,
      footer: params.footer,
    })
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
