/**
 * roroko 记忆工具的纯逻辑:时间口径 / 日期区间 / 入参收窄 / 渲染 / DDL 常量。
 *
 * 与 DB 访问分离(memory-store.ts 负责开库读写),本文件**不 import node 内置与
 * DSH 运行时包** —— 零依赖测试直读编译产物,不连库、不点界面就能验整套口径。
 *
 * 口径(2026-09-18 定稿,见 refs/notes/roroko-memory-design-v1.md):
 *   - 时间一律 **CST+0800**,用固定偏移算、**不读运行环境时区**(服务器被设成 UTC 也照对)
 *   - 存库格式与 soul.db 的 datetime('now','localtime') 一致:'YYYY-MM-DD HH:mm:ss'
 *   - 日期查询拿 created_at 前 10 位做字符串比较,不拼 '23:59:59' 落边界
 *   - 默认区间 = **今天 + 昨天**(直接承接既有记忆纪律「今天 + 昨天必读」)
 *
 * 减法(2026-09-21,阿一拍板"工具就只是简单的 sqlite 工具"):
 *   - 检索**只剩一条 SQL**(关键词全都要命中,LIKE 包含匹配):删掉整套汉字 bigram
 *     打分 / 覆盖度 / 命中数 / 拉丁整词分流 —— 那些概念模型用不上,人也维护不动
 *   - **删召回计数**(recalled):它只当排序次序用,还让同一次查询的结果顺序漂移
 *     (字段仍留在库里,旧库不需要迁移,只是代码不再读写)
 *   - **删 owner 分桶开关**(owner=all / 工具入参 owner):桶固定取 preset 配的那个
 *   - **删 kind 入参**:kind 只剩一个用途 —— 标记导入的历史流水(`log`),由导入脚本
 *     直接写库,模型侧不再暴露分类概念
 */

/**
 * 时间口径搬到包根的 `src/time.ts`（datas 与 memory 共用同一把尺），这里原样转出去，
 * 外部导入名不变（`fmtCst` / `cstDate` 仍从本模块拿得到）。
 */
import { cstDate, fmtCst } from '../time.js'

export { cstDate, fmtCst }

/** 一天的毫秒数。 */
const DAY_MS = 24 * 60 * 60 * 1000

/** 两位补零。 */
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 真日期校验:挡 '2026-02-30' 这种格式对、值不存在的输入。 */
export function isDateStr(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const raw = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false
  const [y, m, d] = raw.split('-').map(Number)
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

/** 宽松日期输入:取前 10 位,'2026-09-18' / '2026-09-18 11:30' / ISO 串都认;不合法返回 undefined。 */
export function normalizeDateInput(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const head = raw.trim().slice(0, 10)
  return isDateStr(head) ? head : undefined
}

/** 日期加减天数(纯 UTC 算术,不涉时区)。 */
export function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS)
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
}

/** 闭区间 [from, to],两端都是 'YYYY-MM-DD'。 */
export interface DateRange {
  from: string
  to: string
}

/** 区间解析结果:要么给区间,要么给一条人话错误。 */
export type RangeResult = { range: DateRange; error?: undefined } | { range?: undefined; error: string }

/**
 * 解析查询区间:
 *   都不给 → [今天-1, 今天];只给 from → [from, 今天];只给 to → [to, to];都给 → [from, to]
 *   from 晚于 to → 报错(不猜、不自动交换,免得回一堆不是他要的)
 */
export function resolveRange(fromRaw: unknown, toRaw: unknown, now: Date): RangeResult {
  const today = cstDate(now)
  const hasFrom = typeof fromRaw === 'string' && fromRaw.trim().length > 0
  const hasTo = typeof toRaw === 'string' && toRaw.trim().length > 0
  const from = hasFrom ? normalizeDateInput(fromRaw) : undefined
  const to = hasTo ? normalizeDateInput(toRaw) : undefined
  if (hasFrom && from === undefined) return { error: `from 不是合法日期(要 YYYY-MM-DD): ${String(fromRaw)}` }
  if (hasTo && to === undefined) return { error: `to 不是合法日期(要 YYYY-MM-DD): ${String(toRaw)}` }
  if (from !== undefined && to !== undefined) {
    if (from > to) return { error: `from(${from}) 晚于 to(${to})` }
    return { range: { from, to } }
  }
  if (from !== undefined) {
    // from 落在未来时退化成单日 —— 否则会拼出反区间
    return { range: { from, to: from <= today ? today : from } }
  }
  if (to !== undefined) return { range: { from: to, to } }
  return { range: { from: shiftDate(today, -1), to: today } }
}

/** owner 桶名上限。 */
export const MEMORY_OWNER_MAX = 32

/** content(初摘要)上限 —— 只报错不静默截断,让模型自己压。 */
export const MEMORY_CONTENT_MAX = 2000

/** summary(二次摘要)上限。 */
export const MEMORY_SUMMARY_MAX = 300

/** source(provenance:会话 id + 事件 seq)上限。 */
export const MEMORY_SOURCE_MAX = 200

/** 默认 owner 桶(本机开发侧)。 */
export const MEMORY_DEFAULT_OWNER = 'dev'

/**
 * owner 收窄:小写字母数字开头,可带 . _ -,≤32 字。
 * 拒绝中文/空格/大写 —— 桶名会被当成过滤键,污串一进库就再难收拾。
 * 工具侧不再收 owner 入参,这里只服务于 preset config。
 */
export function normalizeOwner(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const value = raw.trim().toLowerCase()
  if (value.length === 0 || value.length > MEMORY_OWNER_MAX) return undefined
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(value)) return undefined
  return value
}

/** 写入一条记忆的合法形状。 */
export interface MemoryAddInput {
  owner: string
  content: string
  summary: string
  /** 内部字段:只有导入历史流水的脚本会写 'log';工具侧不再暴露。 */
  kind: string
  source: string
}

/** add 入参收窄结果。 */
export type AddResult = { input: MemoryAddInput; error?: undefined } | { input?: undefined; error: string }

/** 必填文本收窄:trim 后非空、不超长。 */
function requiredText(raw: unknown, label: string, max: number): { value: string } | { error: string } {
  if (typeof raw !== 'string' || raw.trim().length === 0) return { error: `${label} 为空` }
  const value = raw.trim()
  if (value.length > max) return { error: `${label} 超长(${value.length}>${max} 字),先自己压一遍再来` }
  return { value }
}

/** add 入参收窄:owner/content/summary 必填,source 可省;kind 固定留空(导入脚本自己填)。 */
export function normalizeAdd(raw: Record<string, unknown>): AddResult {
  const owner = normalizeOwner(raw.owner)
  if (owner === undefined) {
    return { error: `owner 非法或缺失(只收小写字母数字与 . _ -,≤${MEMORY_OWNER_MAX} 字)` }
  }
  const content = requiredText(raw.content, 'content', MEMORY_CONTENT_MAX)
  if ('error' in content) return { error: content.error }
  const summary = requiredText(raw.summary, 'summary', MEMORY_SUMMARY_MAX)
  if ('error' in summary) return { error: summary.error }
  const source = typeof raw.source === 'string' ? raw.source.trim().slice(0, MEMORY_SOURCE_MAX) : ''
  return { input: { owner, content: content.value, summary: summary.value, kind: '', source } }
}

/** 反思一条记忆的合法形状。 */
export interface MemoryReflectInput {
  id: number
  content: string
  /** 空串 = 保留原 summary 不动。 */
  summary: string
}

/** reflect 入参收窄结果。 */
export type ReflectResult =
  | { input: MemoryReflectInput; error?: undefined }
  | { input?: undefined; error: string }

/**
 * reflect 入参收窄:id 必需、content 必需(**整条覆盖,不是追加**)、summary 可省。
 * 覆盖是设计稿定的(§五 5.3)——省掉历史版本,换表不膨胀;要留旧理解就别覆盖,
 * 用 op=add 另记一条(「保留矛盾」铁律)。
 */
export function normalizeReflect(raw: Record<string, unknown>): ReflectResult {
  const id = normalizeId(raw.id)
  if (id === undefined) return { error: 'id 非法或缺失(要正整数;id 从检索或按日期回查的结果里拿)' }
  const content = requiredText(raw.content, 'content', MEMORY_CONTENT_MAX)
  if ('error' in content) return { error: content.error }
  const summary = typeof raw.summary === 'string' ? raw.summary.trim() : ''
  if (summary.length > MEMORY_SUMMARY_MAX) {
    return { error: `summary 超长(${summary.length}>${MEMORY_SUMMARY_MAX} 字),先自己压一遍再来` }
  }
  return { input: { id, content: content.value, summary } }
}

/** 库里读回来的一行(只列本工具用得到的列)。 */
export interface MemoryRow {
  id: number
  owner: string
  content?: string
  summary: string
  created_at: string
  reflected_at: string | null
  kind: string | null
  source?: string | null
}

/** 表格单元格:竖线会打断 markdown 表,换成斜杠。 */
function cell(text: unknown): string {
  return String(text ?? '').replaceAll('|', '/').replaceAll('\n', ' ')
}

/** 时间列截成 'MM-DD HH:mm'。 */
function shortStamp(stamp: unknown): string {
  const text = String(stamp ?? '')
  return text.length >= 16 ? text.slice(5, 16) : text
}

/** 写入回执:'已记 #id · 时间 · owner'。 */
export function renderAddResult(input: MemoryAddInput, id: number, createdAt: string): string {
  const lines = [`已记 #${id} · ${createdAt} CST · owner=${input.owner}`]
  if (input.source.length > 0) lines.push(`source: ${input.source}`)
  lines.push(`summary: ${input.summary}`)
  return lines.join('\n')
}

/** 反思回执入参。 */
export interface RenderReflectInput {
  id: number
  reflectedAt: string
  /** 覆盖前的 content 字数。 */
  beforeChars: number
  afterChars: number
  summary: string
  /** true = 本次没动 summary。 */
  summaryKept: boolean
}

/** 反思回执:'已反思 #id · 时间 · 字数 旧→新' —— 一眼看出是**改写**不是新增。 */
export function renderReflectResult(input: RenderReflectInput): string {
  return [
    `已反思 #${input.id} · ${input.reflectedAt} CST · 字数 ${input.beforeChars} → ${input.afterChars}`,
    `summary: ${input.summary}${input.summaryKept ? '(未改)' : ''}`,
  ].join('\n')
}

/** 按日期回查的渲染入参。 */
export interface RenderDateInput {
  rows: MemoryRow[]
  range: DateRange
  owner: string
}

/**
 * 渲染按日期回查结果。**空区间要明说"没有记忆"** —— 别让模型对着空表脑补。
 * 标记列只标「未反思」(reflected_at 为空),它就是将来的反思作业队列。
 */
export function renderDate(input: RenderDateInput): string {
  const { rows, range, owner } = input
  const head = `## 记忆 · ${range.from} ~ ${range.to} · owner=${owner}`
  if (rows.length === 0) {
    return `${head}\n该区间没有记忆。换个区间,或先 \`roroko_mem_edit\` op=add 落一条。`
  }
  const unreflected = rows.filter(row => row.reflected_at === null || row.reflected_at === '').length
  const lines = [
    head,
    `条数 ${rows.length} · 未反思 ${unreflected}`,
    '',
    '| id | 时间 | 类别 | 摘要 | 标记 |',
    '|---|---|---|---|---|',
  ]
  for (const row of rows) {
    const flags = row.reflected_at === null || row.reflected_at === '' ? '未反思' : ''
    lines.push(`| ${row.id} | ${shortStamp(row.created_at)} | ${cell(row.kind)} | ${cell(row.summary)} | ${flags} |`)
  }
  return lines.join('\n')
}

/** 单次检索喂进 SQL 的关键词个数上限(词越多命中越稀)。 */
export const MEMORY_ROUGH_MAX_KEYWORDS = 8

/** 检索默认返回条数。 */
export const MEMORY_ROUGH_DEFAULT_LIMIT = 5

/** 检索返回条数上限。 */
export const MEMORY_ROUGH_MAX_LIMIT = 20

/** 关键词分隔符:空白与中英文逗号顿号分号斜杠竖线。 */
const KEYWORD_SEP = /[\s,，、;；/|]+/

/**
 * 切关键词:按分隔符切、转小写、去重、保序,超上限截断。
 * 词原样拿去 SQL 做包含匹配 —— 不做分词、不做相似度。
 */
export function splitKeywords(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  const seen = new Set<string>()
  const words: string[] = []
  for (const part of raw.split(KEYWORD_SEP)) {
    const word = part.trim().toLowerCase()
    if (word.length === 0 || seen.has(word)) continue
    seen.add(word)
    words.push(word)
    if (words.length >= MEMORY_ROUGH_MAX_KEYWORDS) break
  }
  return words
}

/**
 * 转义 LIKE 的通配符 —— 关键词里的 % _ \ 必须当普通字符,否则
 * `100%` 会变成"以 100 开头的一切"。
 */
export function escapeLike(word: string): string {
  return word.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

/** limit 收窄:非数字或 ≤0 → 默认;超上限 → 上限;小数取整。 */
export function normalizeLimit(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
  if (!Number.isFinite(value) || value <= 0) return MEMORY_ROUGH_DEFAULT_LIMIT
  return Math.min(Math.floor(value), MEMORY_ROUGH_MAX_LIMIT)
}

/** id 收窄:正整数(兼容模型传字符串数字);不合法返回 undefined。 */
export function normalizeId(raw: unknown): number | undefined {
  const value = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
  if (!Number.isInteger(value) || value <= 0) return undefined
  return value
}

/** 检索结果的渲染入参。 */
export interface RenderRoughInput {
  /** SQL 命中的行(已按时间倒序、已截断到 limit)。 */
  rows: MemoryRow[]
  keywords: string[]
  owner: string
  /** 桶内总条数 —— 用来区分"桶里没记忆"和"没匹配上"。 */
  candidates: number
}

/** 渲染检索结果。**查不到要明说**,别留给模型"好像有"的余地。 */
export function renderRough(input: RenderRoughInput): string {
  const { rows, keywords, owner, candidates } = input
  const head = `## 记忆检索 · "${keywords.join(' ')}" · owner=${owner}`
  if (candidates === 0) return `${head}\n该桶还没有记忆。先用 \`roroko_mem_edit\` op=add 落一条。`
  if (rows.length === 0) {
    return `${head}\n没有匹配上的记忆(桶内 ${candidates} 条)—— 关键词是全都要命中的,少给一个词再试。\n`
      + '也可以改用 `roroko_mem_date` 按日期回查。**别据此编造记忆。**'
  }
  const lines = [
    head,
    `命中 ${rows.length} 条 · 桶内 ${candidates} 条`,
    '',
    '| id | 时间 | 类别 | 摘要 |',
    '|---|---|---|---|',
  ]
  for (const row of rows) {
    lines.push(`| ${row.id} | ${shortStamp(row.created_at)} | ${cell(row.kind)} | ${cell(row.summary)} |`)
  }
  lines.push('', '要看完整内容用 `roroko_mem_id`;摘要够判断就别多取一次。')
  return lines.join('\n')
}

/** 按 id 取全文的渲染入参。 */
export interface RenderIdInput {
  row: MemoryRow
}

/** 渲染单条记忆全文(含 provenance,方便回会话原文)。 */
export function renderId(input: RenderIdInput): string {
  const { row } = input
  const flags = row.reflected_at === null || row.reflected_at === '' || row.reflected_at === undefined
    ? '未反思'
    : `已反思 ${row.reflected_at}`
  const lines = [
    `## 记忆 #${row.id} · owner=${row.owner} · ${row.created_at} CST · ${flags}`,
  ]
  if (typeof row.source === 'string' && row.source.length > 0) lines.push(`source: ${row.source}`)
  lines.push('', row.content ?? '', '', `summary: ${row.summary}`)
  return lines.join('\n')
}

/**
 * 建表语句(设计稿 §四原文;幂等,每次开库都跑一遍)。
 * ⚠️ `recalled` 列仍然保留:2026-09-21 删掉了召回计数逻辑,但**不动表结构** ——
 * 老库不需要迁移,新库多一个没人读的列,代价为零。
 */
export const MEMORY_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS memory (
  id            INTEGER PRIMARY KEY,
  owner         TEXT    NOT NULL,
  content       TEXT    NOT NULL,
  summary       TEXT    NOT NULL,
  created_at    TEXT    NOT NULL,
  reflected_at  TEXT,
  recalled      INTEGER NOT NULL DEFAULT 0,
  source        TEXT,
  kind          TEXT
)`,
  'CREATE INDEX IF NOT EXISTS idx_memory_owner_date ON memory(owner, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_memory_reflected ON memory(reflected_at)',
]

/** 开库即生效的连接级 pragma:WAL 抗并发、busy_timeout 别一撞就抛。 */
export const MEMORY_PRAGMAS: string[] = [
  'PRAGMA journal_mode = WAL',
  'PRAGMA busy_timeout = 3000',
]
