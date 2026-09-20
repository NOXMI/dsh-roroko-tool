/**
 * roroko 记忆 dream 的纯逻辑:队列口径 / prompt 组装 / 回复解析 / 门禁判定。
 *
 * 设计来源:`refs/notes/roroko-memory-design-v1.md` §七(第七刀 = 记忆系统的下游)+
 * `refs/notes/roroko-datas-dream-slice7-plan.md`(照抄 nanobot 的九步执行序)。
 *
 * 与 09-16 那份计划的**唯一差别**:靶子从"三个记忆文件"换成 sqlite 记忆表。
 * 因为不写文件,所以 E2 的快照目录、`.dream_cursor`、受限工具集、prune 全部作废 ——
 * **队列本身就是游标**(`reflected_at IS NULL`)。
 *
 * 本文件**不 import node 内置与 DSH 运行时包** —— 零依赖测试直读编译产物。
 */
import {
  MEMORY_CONTENT_MAX, MEMORY_SUMMARY_MAX, type MemoryRow,
} from './memory-form.js'

/** 默认间隔:4 小时(照抄 nanobot 的 everyMs=14400000)。 */
export const DREAM_DEFAULT_INTERVAL_MS = 4 * 60 * 60 * 1000

/** 间隔下限:5 分钟(防手滑配成 0 秒把模型当风扇吹)。 */
export const DREAM_MIN_INTERVAL_MS = 5 * 60 * 1000

/** 间隔上限:24 小时。 */
export const DREAM_MAX_INTERVAL_MS = 24 * 60 * 60 * 1000

/** 一次取多少条(照抄 nanobot 的 max_entries=20)。 */
export const DREAM_DEFAULT_BATCH = 20

/** 批量上限。 */
export const DREAM_MAX_BATCH = 50

/** 单条喂给模型的截断长度(照抄 nanobot 的 truncate_text(content, 300))。 */
export const DREAM_ENTRY_MAX = 300

/**
 * 分段定时器的每段长度:最多 1 小时醒一次,醒来自查墙钟到点没。
 * Node 的 timer 上限是 2147483647ms(约 24.8 天),分段是照抄 dsh-schedule 的做法。
 */
export const DREAM_TICK_MS = 60 * 60 * 1000

/**
 * 不进反思队列的 kind —— 历史日志(`kind=log`)是逐字入库的开发流水,
 * 再让模型逐条提炼一遍纯属白烧 token(2026-09-20 阿一拍)。
 */
export const DREAM_SKIP_KINDS: readonly string[] = ['log']

/** 审计落盘目录(相对工作区)。 */
export const DREAM_LOG_DIR = 'dream-log'

/**
 * 单次调用的 token 上限。
 * ⚠️ **默认必须够推理模型用**:`deepseek-v4-flash` 这类带 thinking 的模型会先把
 * reasoning 写完再吐正文,2048 会被 thinking 吃满 → 正文一个字都没有(2026-09-20
 * 在服务器上实测踩到,提到 8192 立刻通)。
 */
export const DREAM_DEFAULT_MAX_TOKENS = 8192

/** maxTokens 上限。 */
export const DREAM_MAX_TOKENS_LIMIT = 16384

/**
 * dream 配置。默认**开着**但没配模型 —— 未配就每次静默跳过(照抄 nanobot 的
 * "默认开",隔离靠 preset 里换/关配置,不靠默认值)。
 */
export interface DreamConfig {
  enabled: boolean
  intervalMs: number
  batch: number
  provider: string
  model: string
  maxTokens: number
  /** 审计目录;空串 = 落在库旁边 `dream-log/`。 */
  logDir: string
}

/** dream 内置默认(preset 不传就用它)。 */
export const DREAM_DEFAULTS: DreamConfig = {
  enabled: true,
  intervalMs: DREAM_DEFAULT_INTERVAL_MS,
  batch: DREAM_DEFAULT_BATCH,
  provider: '',
  model: '',
  maxTokens: DREAM_DEFAULT_MAX_TOKENS,
  logDir: '',
}

/**
 * 整数收窄:非数字/非有限值回落默认,越界夹到区间。
 * ⚠️ **空串必须回落默认而不是当 0** —— `Number('')` 是 0 不是 NaN,踩过一次:
 * 未提供的 intervalMs 会一路夹到下限,变成"每 5 分钟跑一次"(比设计勤 48 倍)。
 */
function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return fallback
    return Math.min(Math.max(Math.floor(raw), min), max)
  }
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text.length === 0) return fallback
  const value = Number(text)
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.floor(value), min), max)
}

/** dream 配置归一化:非法字段逐个回落默认,不抛。 */
export function normalizeDreamConfig(raw: unknown): DreamConfig {
  if (typeof raw !== 'object' || raw === null) return { ...DREAM_DEFAULTS }
  const value = raw as Record<string, unknown>
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DREAM_DEFAULTS.enabled,
    intervalMs: clampInt(value.intervalMs, DREAM_MIN_INTERVAL_MS, DREAM_MAX_INTERVAL_MS, DREAM_DEFAULTS.intervalMs),
    batch: clampInt(value.batch, 1, DREAM_MAX_BATCH, DREAM_DEFAULTS.batch),
    provider: typeof value.provider === 'string' ? value.provider.trim() : '',
    model: typeof value.model === 'string' ? value.model.trim() : '',
    maxTokens: clampInt(value.maxTokens, 128, DREAM_MAX_TOKENS_LIMIT, DREAM_DEFAULTS.maxTokens),
    logDir: typeof value.logDir === 'string' ? value.logDir.trim() : '',
  }
}

/** 一次 dream 里对单条的改写。 */
export interface DreamEdit {
  id: number
  content: string
  summary: string
}

/** 队列筛选结果。 */
export interface DreamQueue {
  /** 本次要整理的条目(最久没反思的在前)。 */
  entries: MemoryRow[]
  /** 排除掉的日志条数(给回执说明用)。 */
  skippedLogs: number
}

/**
 * 队列口径:`reflected_at` 为空、不在跳过 kind 里,按 created_at 升序取前 limit 条。
 * 库里取回来时已按时间排好,这里只做过滤与截断 —— 纯函数,好测。
 */
export function pickQueue(rows: MemoryRow[], limit: number): DreamQueue {
  const fresh = rows.filter(row => {
    const reflected = row.reflected_at
    return reflected === null || reflected === undefined || reflected === ''
  })
  const entries = fresh.filter(row => !DREAM_SKIP_KINDS.includes(String(row.kind ?? '')))
  const skippedLogs = fresh.length - entries.length
  return { entries: entries.slice(0, Math.max(1, limit)), skippedLogs }
}

/** 单条条目渲染成 prompt 里的一段。 */
function renderEntry(row: MemoryRow): string {
  const raw = String(row.content ?? '')
  const body = raw.length > DREAM_ENTRY_MAX ? `${raw.slice(0, DREAM_ENTRY_MAX)}…(截断)` : raw
  const kind = row.kind !== null && row.kind !== undefined && String(row.kind).length > 0 ? String(row.kind) : '(无)'
  return `[#${row.id}] (${row.created_at}) kind=${kind}\n${body}`
}

/**
 * 组装 dream 的提示词。要求模型只回一个 JSON 数组,**整条覆盖**语义,
 * 且**不抹平矛盾**(阿一的铁律:保留矛盾)。
 */
export function buildDreamPrompt(entries: MemoryRow[]): string {
  const head = [
    '你是记忆整理器。下面是记忆库里**待反思**的条目。',
    '对每一条:判断它有没有记得太啰嗦、有没有更准的措辞、有没有该收敛的结论。',
    '',
    '只输出一个 **JSON 数组**(不要 markdown 代码块、不要任何解释文字),每个元素形如:',
    '{"id": 12, "content": "改写后的完整正文", "summary": "一句话摘要"}',
    '',
    '铁律:',
    `- content 是**整条覆盖**而非追加,长度 ≤ ${MEMORY_CONTENT_MAX} 字;summary ≤ ${MEMORY_SUMMARY_MAX} 字`,
    '- 不要新增条目、不要合并条目、不要改 id',
    '- **观点变了或出现矛盾时不要抹平** —— 只收敛措辞,不消解矛盾',
    '- 不值得改的条目**不要出现在输出里**(空数组也是合法回答)',
    '',
    '## 待反思条目',
  ]
  const body = entries.map(renderEntry)
  return [...head, ...body].join('\n')
}

/** 解析结果。 */
export type DreamParseResult =
  | { edits: DreamEdit[]; error?: undefined }
  | { edits?: undefined; error: string }

/** 从模型回复里剥出 JSON(容忍 ```json 围栏与前后废话)。 */
function extractJsonArray(text: string): string | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced === null ? text : fenced[1]
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start < 0 || end <= start) return undefined
  return body.slice(start, end + 1)
}

/**
 * 解析模型回复。**失败就是失败** —— 不给"装作跑过了"的后路(照抄 nanobot
 * "没跑完 → 游标不动"):解析不出来就返回 error,调用方不写库、不推队列。
 * 越界的 id(不在本批里)与超长正文一律丢掉单条,不算整体失败。
 */
export function parseDreamReply(text: string, allowedIds: number[]): DreamParseResult {
  const json = extractJsonArray(text)
  if (json === undefined) return { error: '回复里没有 JSON 数组' }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    return { error: `JSON 解析失败: ${String(error)}` }
  }
  if (!Array.isArray(parsed)) return { error: 'JSON 顶层不是数组' }
  const allowed = new Set(allowedIds)
  const edits: DreamEdit[] = []
  for (const item of parsed) {
    if (item === null || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const id = Number(row.id)
    if (!Number.isInteger(id) || !allowed.has(id)) continue
    const content = typeof row.content === 'string' ? row.content.trim() : ''
    if (content.length === 0 || content.length > MEMORY_CONTENT_MAX) continue
    const summary = typeof row.summary === 'string' ? row.summary.trim().slice(0, MEMORY_SUMMARY_MAX) : ''
    edits.push({ id, content, summary })
  }
  return { edits }
}

/**
 * 门禁:比对写回前后的 reflected_at,只认真落下去的那些(照抄 nanobot 的
 * "审计只认 diff,不认模型自述")。返回真变了的 id。
 */
export function diffReflected(before: MemoryRow[], after: MemoryRow[]): number[] {
  const wasUnreflected = new Map<number, boolean>()
  for (const row of before) {
    wasUnreflected.set(Number(row.id), row.reflected_at === null || row.reflected_at === undefined || row.reflected_at === '')
  }
  const changed: number[] = []
  for (const row of after) {
    const id = Number(row.id)
    if (wasUnreflected.get(id) !== true) continue
    const reflected = row.reflected_at
    if (reflected !== null && reflected !== undefined && reflected !== '') changed.push(id)
  }
  return changed
}

/** 一次 dream 的结果(给状态与审计用)。 */
export interface DreamOutcome {
  /** 队列里有多少条(不含跳过的日志)。 */
  queued: number
  /** 排除了多少条日志。 */
  skippedLogs: number
  /** 模型给了几条改写。 */
  proposed: number
  /** 真写进库并落了 reflected_at 的 id。 */
  changed: number[]
  /** 一句话结论。 */
  note: string
}

/** 渲染一次 dream 的回执/状态。 */
export function renderDreamOutcome(outcome: DreamOutcome): string {
  const lines = [
    `dream: ${outcome.note}`,
    `队列 ${outcome.queued} 条(跳过日志 ${outcome.skippedLogs} 条)· 模型改写 ${outcome.proposed} 条 · 真落库 ${outcome.changed.length} 条`,
  ]
  if (outcome.changed.length > 0) lines.push(`已反思: ${outcome.changed.map(id => `#${id}`).join(' ')}`)
  return lines.join('\n')
}

/**
 * 审计正文 —— **只记事实 diff,不记模型自述**(照抄 nanobot D12:
 * "the audit record reflects the filesystem's truth, not the model's self-report")。
 */
export function renderDreamAudit(input: {
  at: string
  provider: string
  model: string
  queued: number
  skippedLogs: number
  proposed: number
  changed: number[]
  before: MemoryRow[]
  after: MemoryRow[]
  error?: string
}): string {
  const beforeChars = new Map<number, number>()
  for (const row of input.before) beforeChars.set(Number(row.id), String(row.content ?? '').length)
  const lines = [
    `# dream ${input.at} CST`,
    '',
    `provider/model: ${input.provider} / ${input.model}`,
    `队列 ${input.queued} 条(跳过日志 ${input.skippedLogs} 条)· 模型改写 ${input.proposed} 条 · 真落库 ${input.changed.length} 条`,
  ]
  if (input.error !== undefined) lines.push('', `error: ${input.error}`)
  if (input.changed.length > 0) {
    lines.push('', '| id | 字数 旧 → 新 |', '|---|---|')
    for (const row of input.after) {
      const id = Number(row.id)
      if (!input.changed.includes(id)) continue
      lines.push(`| ${id} | ${beforeChars.get(id) ?? '?'} → ${String(row.content ?? '').length} |`)
    }
  }
  return lines.join('\n')
}
