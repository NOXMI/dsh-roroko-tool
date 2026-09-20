/**
 * roroko 记忆 dream 机制:一次执行序 + 分段定时器。
 *
 * 靶子是 sqlite 记忆表(不是文件) —— 照 `roroko-datas-dream-slice7-plan.md`
 * 的九步执行序,但把"模型去改文件"换成"模型回 JSON、我们自己写库":
 *
 *   1 取队列(无条目 → 直接结束,**不调模型、不烧 token**)
 *   2 组 prompt(单条截断 300)
 *   3 调模型(一次性,`ctx.llm.stream` 由接线层注入成 `callModel`)
 *   4 解析 JSON(解析不出来就是失败,不留"装作跑过"的后路)
 *   5 写回(整条覆盖 content + 刷 reflected_at)
 *   6 **门禁:回读看 reflected_at 真落下去没** —— 只认真 diff,不认模型自述
 *   7 审计落盘(只记事实)
 *   8 异常全吞,定时器绝不能被 dream 打崩
 *
 * 本文件**不 import DSH 运行时值**(只吃 node 内置与纯逻辑) → 测试零替身。
 * 载体上相对 09-16 那份计划最大的简化:不建 agent 会话(官方 `GenerateOptions.system`
 * 注释写明了支持"one-shot callers")→ E2 快照 / `.dream_cursor` / 受限工具集 / prune 全作废。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MEMORY_COLUMNS, openMemoryDb, runReflect } from './memory-store.js'
import { fmtCst, type MemoryRow } from './memory-form.js'
import {
  DREAM_LOG_DIR, DREAM_TICK_MS, buildDreamPrompt, diffReflected, parseDreamReply, pickQueue,
  renderDreamAudit, type DreamConfig, type DreamOutcome,
} from './memory-dream-form.js'

/** 机制依赖(全部注入 —— 测试里换成假的就能跑整个执行序)。 */
export interface DreamDeps {
  dbPath: string
  /** 桶;dream 只整理本桶(默认不跨桶)。 */
  owner: string
  provider: string
  model: string
  /** 一次取多少条。 */
  batch: number
  maxTokens: number
  /** 审计目录;空串 = 不落盘。 */
  logDir: string
  /** 调一次模型拿纯文本回复(接线层用 ctx.llm.stream 拼装)。 */
  callModel: (prompt: string) => Promise<string>
  now: () => Date
}

/** 一次 dream 的完整结果。 */
export interface DreamRunResult extends DreamOutcome {
  /** 审计文件路径(没落盘就是 undefined)。 */
  auditPath?: string
  /** 出错时的原因 —— **不抛**,连错误都是结果的一部分。 */
  error?: string
}

/**
 * 进程内共享的 dream 运行面:接线层(`memory.ts`)注册,host 侧 route 读它。
 * 两边同进程同模块实例,所以一个模块级对象就够 —— 不需要任何服务依赖。
 */
export interface DreamRuntime {
  /** 生效配置;dream 未启用时为 undefined。 */
  config?: DreamConfig
  /** 动态解析当前生效配置(面板改了立刻反映;优先于 config)。 */
  resolve?: () => DreamConfig
  /** 手动触发一次;未启用时为 undefined。 */
  run?: () => Promise<DreamRunResult>
  /** 最近一次结果(CST 时间戳)。 */
  last?: DreamRunResult & { at: string }
  /** 正在跑(防并发触发)。 */
  running: boolean
}

/** 模块级共享面;route 层直接读,永远不为空。 */
export const dreamRuntime: DreamRuntime = { running: false }

/**
 * 已启动过定时器的库(进程级去重)。
 *
 * ⚠️ 插件是**按 preset / 会话装配**的 —— 同一次宿主生命周期里 apply 可能被调用多次。
 * 不加这道闸,每个会话都会起一份定时器,4 小时后一起醒:重复烧 token、并发写同一个库。
 * 同一个库只认第一个实例(后续调用只刷新共享面上的配置)。
 */
const startedDbs = new Set<string>()

/** 认领一个库的 dream 启动权;已被认领过则返回 false。 */
export function claimDreamStart(dbPath: string): boolean {
  if (startedDbs.has(dbPath)) return false
  startedDbs.add(dbPath)
  return true
}

/** 取本桶所有候选行(时间升序,让"最久没反思的"自然排在前面)。 */
function loadRows(dbPath: string, owner: string): MemoryRow[] {
  const db = openMemoryDb(dbPath)
  try {
    return db
      .prepare(`SELECT ${MEMORY_COLUMNS} FROM memory WHERE owner = ? ORDER BY created_at ASC, id ASC`)
      .all(owner) as unknown as MemoryRow[]
  } finally {
    db.close()
  }
}

/** 回读指定 id 的 reflected_at 与 content(门禁判定用)。 */
function reload(dbPath: string, ids: number[]): MemoryRow[] {
  if (ids.length === 0) return []
  const db = openMemoryDb(dbPath)
  try {
    const placeholders = ids.map(() => '?').join(', ')
    return db
      .prepare(`SELECT ${MEMORY_COLUMNS} FROM memory WHERE id IN (${placeholders}) ORDER BY id`)
      .all(...ids) as unknown as MemoryRow[]
  } finally {
    db.close()
  }
}

/** 把一次执行的产物落成审计文件;失败吞掉(审计不该拖垮 dream)。 */
function writeAudit(deps: DreamDeps, body: string, at: string): string | undefined {
  if (deps.logDir.length === 0) return undefined
  try {
    mkdirSync(deps.logDir, { recursive: true })
    const stamp = at.replace(/[: ]/g, '-')
    const path = join(deps.logDir, `${stamp}.md`)
    writeFileSync(path, body, 'utf8')
    return path
  } catch {
    return undefined
  }
}

/**
 * 跑一次 dream。**任何异常都在这里收住**并当成结果返回 —— 调用方(定时器)
 * 不该因为一次整理失败而死掉。
 */
export async function runDreamOnce(deps: DreamDeps): Promise<DreamRunResult> {
  const atCst = fmtCst(deps.now())
  const empty = (note: string, queued = 0, skippedLogs = 0): DreamRunResult => ({
    queued, skippedLogs, proposed: 0, changed: [], note,
  })

  if (deps.provider.length === 0 || deps.model.length === 0) {
    return empty('未配置模型(provider/model),跳过')
  }

  let rows: MemoryRow[]
  try {
    rows = loadRows(deps.dbPath, deps.owner)
  } catch (error) {
    return empty(`读库失败: ${String(error)}`)
  }

  const { entries, skippedLogs } = pickQueue(rows, deps.batch)
  if (entries.length === 0) {
    return empty(
      skippedLogs > 0 ? '没有可整理的内容(队列里只剩日志)' : '没有可整理的内容',
      0,
      skippedLogs,
    )
  }

  const prompt = buildDreamPrompt(entries)
  let reply: string
  try {
    reply = await deps.callModel(prompt)
  } catch (error) {
    const note = `模型调用失败: ${String(error)}`
    writeAudit(deps, renderDreamAudit({
      at: atCst, provider: deps.provider, model: deps.model,
      queued: entries.length, skippedLogs, proposed: 0, changed: [], before: entries, after: [], error: note,
    }), atCst)
    return { queued: entries.length, skippedLogs, proposed: 0, changed: [], note, error: note }
  }

  const allowedIds = entries.map(row => Number(row.id))
  const parsed = parseDreamReply(reply, allowedIds)
  if (parsed.edits === undefined) {
    const note = `回复不可用: ${parsed.error}`
    writeAudit(deps, renderDreamAudit({
      at: atCst, provider: deps.provider, model: deps.model,
      queued: entries.length, skippedLogs, proposed: 0, changed: [], before: entries, after: [], error: note,
    }), atCst)
    return { queued: entries.length, skippedLogs, proposed: 0, changed: [], note, error: note }
  }

  // 写回:照 reflect 的语义(整条覆盖 content + 刷 reflected_at),summary 空则保留原值
  let db
  try {
    db = openMemoryDb(deps.dbPath)
  } catch (error) {
    const note = `写库失败: ${String(error)}`
    return { queued: entries.length, skippedLogs, proposed: parsed.edits.length, changed: [], note, error: note }
  }
  try {
    for (const edit of parsed.edits) {
      runReflect(db, { id: edit.id, content: edit.content, summary: edit.summary }, deps.now())
    }
  } catch (error) {
    const note = `写回出错: ${String(error)}`
    return { queued: entries.length, skippedLogs, proposed: parsed.edits.length, changed: [], note, error: note }
  } finally {
    db.close()
  }

  // 门禁:回读,只认 reflected_at 真落下去的
  const touched = parsed.edits.map(edit => edit.id)
  const after = reload(deps.dbPath, touched)
  const changed = diffReflected(entries, after)

  const outcome: DreamOutcome = {
    queued: entries.length,
    skippedLogs,
    proposed: parsed.edits.length,
    changed,
    note: changed.length > 0
      ? `完成,反思 ${changed.length} 条`
      : '完成;**没有记忆变更**(模型没给可落地的改写)',
  }
  const auditPath = writeAudit(deps, renderDreamAudit({
    at: atCst, provider: deps.provider, model: deps.model,
    queued: entries.length, skippedLogs, proposed: parsed.edits.length, changed,
    before: entries, after,
  }), atCst)
  return { ...outcome, auditPath }
}

/** 定时器句柄。 */
export interface DreamTimer {
  dispose(): void
  /** 上一次跑完的时间(CST 字符串)或空。 */
  lastRunAt(): string | undefined
}

/** 分段定时器入参。 */
export interface DreamTimerOptions {
  /** 间隔(毫秒);给函数则每轮重新取 —— 面板改了间隔不必重启宿主。 */
  intervalMs: number | (() => number)
  /** 启动后首次检查的延迟(默认 5 分钟:进程刚起来别抢资源)。 */
  startupDelayMs?: number
  run: () => Promise<void>
  now: () => Date
  onError: (error: unknown) => void
  /** 定时器接口(测试可替)。 */
  setIntervalFn?: (fn: () => void, ms: number) => { unref?: () => void; cancel?: () => void }
  clearIntervalFn?: (handle: unknown) => void
}

/**
 * 分段定时器:每 `DREAM_TICK_MS` 醒一次,自查墙钟到点没 —— 到期即跑,跑完重新计时。
 * **异常一律吞进 onError**,定时器绝不能被一次失败的整理打崩(照抄计划 §四 第 8 步)。
 */
export function startDreamTimer(options: DreamTimerOptions): DreamTimer {
  const setIntervalFn = options.setIntervalFn ?? ((fn, ms) => setInterval(fn, ms) as unknown as { unref?: () => void })
  const clearIntervalFn = options.clearIntervalFn ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>))
  const startupDelay = options.startupDelayMs ?? 5 * 60 * 1000
  const intervalOf = (): number => typeof options.intervalMs === 'function' ? options.intervalMs() : options.intervalMs

  let anchor = options.now().getTime() + startupDelay
  let lastRun: string | undefined
  let running = false

  const handle = setIntervalFn(() => {
    if (running) return
    const at = options.now().getTime()
    if (at < anchor) return
    running = true
    void options.run()
      .then(() => { lastRun = options.now().toISOString() })
      .catch((error: unknown) => { options.onError(error) })
      .finally(() => {
        running = false
        anchor = options.now().getTime() + intervalOf()
      })
  }, Math.min(intervalOf(), DREAM_TICK_MS))
  handle.unref?.()

  return {
    dispose: () => clearIntervalFn(handle),
    lastRunAt: () => lastRun,
  }
}

/** 审计目录:默认落在库旁边的 `dream-log/`(不需要 cwd,零配置可用)。 */
export function defaultDreamLogDir(dbPath: string): string {
  const cut = Math.max(dbPath.lastIndexOf('/'), dbPath.lastIndexOf('\\'))
  const dir = cut > 0 ? dbPath.slice(0, cut) : '.'
  return join(dir, DREAM_LOG_DIR)
}
