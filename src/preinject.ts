/**
 * roroko-preinject — 一次性工作区指令注入器(roroko-tool 电箱子功能)。
 *
 * 自独立旧插件 dsh-roroko-preinject 收编迁入 roroko-tool 大包(2026-09-02)。
 * 原实现在 git 6dc2415 迁入后因 settings 退役被回退占位;本次恢复注入逻辑,
 * 闸门从「settings 服务」改为「读电箱 state 文件」(roroko-tool-state.json)。
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
 * 电箱闸门(roroko-tool 设置):agent 层动手前读 host 的 state 文件(roroko-tool-
 * state.json,同进程共享文件系统),`preinject.enabled === false` 即熄火、不注入。
 * 注入参数(files/header/footer/wrapInSystemReminder)同样读自 state,由 webgui
 * 设置页编辑;本插件的 config 不再要求接线方提供。
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

/** Services required before the injector may scan the session surface.
 *  Aligns with `@deepseek-ai/dsh-agent-instructions` so the one-shot guard
 *  reads a fully-projected surface after a process restart (no re-injection
 *  on resume). */
export const inject = ['sessionProjections']

/** 兼容旧接线 config(可选;优先取电箱 state)。 */
export interface RorokoPreinjectConfig {
  /** File names, relative to the session cwd, in injection order. */
  files?: string[]
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

/**
 * 读电箱 state 的 preinject 节。state 缺失/损坏时回落默认(默认 enabled 全关,
 * 即安装即熄火,与 roroko-tool 电箱语义一致)。
 */
async function loadGateState(): Promise<RorokoPreinjectState> {
  const state = await loadState()
  return state.preinject
}

export function apply(ctx: Context, config: RorokoPreinjectConfig): void {
  ctx.on('agent/pre-step', async ({ agent, messages }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    // 电箱闸门:roroko-tool state 里 preinject.enabled === false → 熄火。
    const gate = await loadGateState()
    if (!gate.enabled) return decision
    if (hasInjected(agent.session)) return decision

    const cwd = agent.session.header.cwd ?? process.cwd()
    // 注入参数优先取电箱 state;state 未给 files(默认空)时回落到接线 config。
    const files = gate.files.length > 0 ? gate.files : (config.files ?? [])
    const content = await loadMergedText(cwd, files)
    if (content.length === 0) return decision

    const text = buildInjectionText(content, {
      wrapInSystemReminder: gate.wrapInSystemReminder ?? config.wrapInSystemReminder ?? false,
      header: gate.header.length > 0 ? gate.header : config.header,
      footer: gate.footer.length > 0 ? gate.footer : config.footer,
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
