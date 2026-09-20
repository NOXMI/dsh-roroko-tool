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
 */

/** 东八区固定偏移(毫秒)。 */
const CST_OFFSET_MS = 8 * 60 * 60 * 1000

/** 一天的毫秒数。 */
const DAY_MS = 24 * 60 * 60 * 1000

/** 两位补零。 */
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 把绝对时刻搬到东八区那面钟上,再用 UTC getter 读(于是与运行环境时区无关)。 */
function cstParts(date: Date): { y: number; m: number; d: number; hh: number; mm: number; ss: number } {
  const shifted = new Date(date.getTime() + CST_OFFSET_MS)
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    hh: shifted.getUTCHours(),
    mm: shifted.getUTCMinutes(),
    ss: shifted.getUTCSeconds(),
  }
}

/** CST 时间戳 'YYYY-MM-DD HH:mm:ss'(禁用 toISOString —— 那是 UTC,库会早 8 小时)。 */
export function fmtCst(date: Date): string {
  const p = cstParts(date)
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)} ${pad2(p.hh)}:${pad2(p.mm)}:${pad2(p.ss)}`
}

/** CST 日期 'YYYY-MM-DD'。 */
export function cstDate(date: Date): string {
  return fmtCst(date).slice(0, 10)
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

/** kind 上限。 */
export const MEMORY_KIND_MAX = 32

/** source(provenance:会话 id + 事件 seq)上限。 */
export const MEMORY_SOURCE_MAX = 200

/** 已知 owner 桶(不强制枚举,只作描述与默认值;将来加角色不必改代码)。 */
export const MEMORY_OWNERS = ['dev', 'persona'] as const

/** 默认 owner 桶(本机开发侧)。 */
export const MEMORY_DEFAULT_OWNER = 'dev'

/**
 * owner 收窄:小写字母数字开头,可带 . _ -,≤32 字。
 * 拒绝中文/空格/大写 —— 桶名会被当成过滤键,污串一进库就再难收拾。
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

/** add 入参收窄:owner/content/summary 必填,kind/source 可省。 */
export function normalizeAdd(raw: Record<string, unknown>): AddResult {
  const owner = normalizeOwner(raw.owner)
  if (owner === undefined) {
    return { error: `owner 非法或缺失(只收小写字母数字与 . _ -,≤${MEMORY_OWNER_MAX} 字;常用桶: ${MEMORY_OWNERS.join(' / ')})` }
  }
  const content = requiredText(raw.content, 'content', MEMORY_CONTENT_MAX)
  if ('error' in content) return { error: content.error }
  const summary = requiredText(raw.summary, 'summary', MEMORY_SUMMARY_MAX)
  if ('error' in summary) return { error: summary.error }
  const kind = typeof raw.kind === 'string' ? raw.kind.trim().slice(0, MEMORY_KIND_MAX) : ''
  const source = typeof raw.source === 'string' ? raw.source.trim().slice(0, MEMORY_SOURCE_MAX) : ''
  return { input: { owner, content: content.value, summary: summary.value, kind, source } }
}

/** 库里读回来的一行(只列本工具用得到的列)。 */
export interface MemoryRow {
  id: number
  owner: string
  content?: string
  summary: string
  created_at: string
  reflected_at: string | null
  recalled: number
  kind: string | null
  source?: string | null
}

/** 表格单元格:竖线会打断 markdown 表,换成斜杠。 */
function cell(text: unknown): string {
  return String(text ?? '').replaceAll('|', '/').replaceAll('\n', ' ')
}

/** 写入回执:'已记 #id · 时间 · owner · kind'。 */
export function renderAddResult(input: MemoryAddInput, id: number, createdAt: string): string {
  const lines = [`已记 #${id} · ${createdAt} CST · owner=${input.owner}`]
  if (input.kind.length > 0) lines.push(`kind: ${input.kind}`)
  if (input.source.length > 0) lines.push(`source: ${input.source}`)
  lines.push(`summary: ${input.summary}`)
  return lines.join('\n')
}

/** 按日期回查的渲染入参。 */
export interface RenderDateInput {
  rows: MemoryRow[]
  range: DateRange
  /** 生效的 owner 过滤值;undefined = 全部桶。 */
  owner?: string
  now: Date
}

/**
 * 渲染按日期回查结果。**空区间要明说"没有记忆"** —— 别让模型对着空表脑补。
 * 标记列只标「未反思」(reflected_at 为空),它就是将来的反思作业队列。
 */
export function renderDate(input: RenderDateInput): string {
  const { rows, range, owner } = input
  const scope = owner === undefined ? 'owner=(全部)' : `owner=${owner}`
  const head = `## 记忆 · ${range.from} ~ ${range.to} · ${scope}`
  if (rows.length === 0) {
    return `${head}\n该区间没有记忆。换个区间,或先 \`roroko_mem_edit\` op=add 落一条。`
  }
  const unreflected = rows.filter(row => row.reflected_at === null || row.reflected_at === '').length
  const recalled = rows.reduce((sum, row) => sum + (Number(row.recalled) || 0), 0)
  const lines = [
    head,
    `条数 ${rows.length} · 未反思 ${unreflected} · 累计召回 ${recalled}`,
    '',
    '| id | 时间 | 类别 | 摘要 | 标记 |',
    '|---|---|---|---|---|',
  ]
  for (const row of rows) {
    const stamp = String(row.created_at ?? '')
    const short = stamp.length >= 16 ? stamp.slice(5, 16) : stamp
    const flags = row.reflected_at === null || row.reflected_at === '' ? '未反思' : ''
    lines.push(`| ${row.id} | ${short} | ${cell(row.kind)} | ${cell(row.summary)} | ${flags} |`)
  }
  return lines.join('\n')
}

/** 关键词词数上限(词越多命中越稀,靠相关性下限挡噪声)。 */
export const MEMORY_ROUGH_MAX_KEYWORDS = 8

/** 检索默认返回条数。 */
export const MEMORY_ROUGH_DEFAULT_LIMIT = 5

/** 检索返回条数上限。 */
export const MEMORY_ROUGH_MAX_LIMIT = 20

/** 相关性下限:命中的去重 gram 数。 */
export const MEMORY_ROUGH_MIN_HITS = 2

/** 相关性下限:覆盖度(与 MEMORY_ROUGH_MIN_HITS 命中其一即放行)。 */
export const MEMORY_ROUGH_MIN_COVER = 0.5

/** 关键词分隔符:空白与中英文逗号顿号分号斜杠竖线。 */
const KEYWORD_SEP = /[\s,，、;；/|]+/

/**
 * CJK 判定与提取。
 * ⚠️ 拉丁/数字**不进二元组** —— 字符二元组对拉丁字母没有区分度(`minGap` 切出的
 * `mi/in/ng/ga/ap` 里,`to`/`en`/`se` 在任何英文段落里都烂大街)。实测旧口径下
 * `minGap` 命中 30 条里真相关只有 1 条、`ds-persona` 是 0/30。拉丁词改走整词子串。
 */
const CJK_CHARS = /[\u4e00-\u9fff]/g
const CJK_TEST = /[\u4e00-\u9fff]/

/**
 * 切关键词:按分隔符切、转小写、去重、保序,超上限截断。
 * 单字词留着 —— 它走单字 gram,仍然搜得到。
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

/** 抽出词里的汉字序列(顺序保留)。 */
function cjkChars(text: string): string {
  return text.match(CJK_CHARS)?.join('') ?? ''
}

/**
 * 文本侧 gram 索引:汉字单字与相邻二元组**都收** —— 这样单字关键词也走同一条命中路径。
 * 只影响池子大小,不影响查询侧分母。
 */
export function textGrams(text: string): Set<string> {
  const chars = cjkChars(text)
  const grams = new Set<string>()
  for (let i = 0; i < chars.length; i++) {
    grams.add(chars[i])
    if (i + 1 < chars.length) grams.add(chars.slice(i, i + 2))
  }
  return grams
}

/**
 * 查询侧汉字 gram:每个词独立生成 —— 单字词收单字,多字词只收相邻二元组
 * (**不收单词字**,否则单字命中会把覆盖度冲淡)。
 */
export function queryGrams(keywords: string[]): Set<string> {
  const grams = new Set<string>()
  for (const word of keywords) {
    const chars = cjkChars(word)
    if (chars.length === 0) continue
    if (chars.length === 1) {
      grams.add(chars)
      continue
    }
    for (let i = 0; i + 1 < chars.length; i++) grams.add(chars.slice(i, i + 2))
  }
  return grams
}

/**
 * 查询侧拉丁/数字词:不含汉字的词整条拿去子串匹配(大小写无关)。
 * `xsec_token` / `minGap` / `0.1.6` 这类术语只有这样才查得准;代价是 `0.1` 会把
 * `0.1.2` 与 `0.1.6` 一起拉出来(可接受,摘要一眼能分)。
 */
export function queryLatinWords(keywords: string[]): string[] {
  const words: string[] = []
  for (const word of keywords) {
    if (CJK_TEST.test(word)) continue
    const normalized = word.trim()
    if (normalized.length > 0) words.push(normalized)
  }
  return words
}

/** 一条命中的检索结果。 */
export interface RoughHit {
  id: number
  summary: string
  created_at: string
  recalled: number
  kind: string | null
  /** 命中的去重 gram 数。 */
  hits: number
  /** 覆盖度 = hits / 查询 gram 总数(0~1)。 */
  cover: number
}

/** 检索打分入参:候选行(已按 owner 过滤)+ 关键词 + 条数上限。 */
export interface RoughInput {
  rows: MemoryRow[]
  keywords: string[]
  limit: number
}

/**
 * 汉字 bigram + 拉丁整词 + 覆盖度打分(零依赖、不分词,中文模糊、英文精确;取代向量召回)。
 *
 * 排序:命中数降序 → 召回数降序 → created_at 降序 → id 降序。
 * ⚠️ cover 与 hits 同一个分母,两者必然同序 —— **score 只是给人看的归一化值**,
 * 主排序就是命中数;新近度与召回数只做同分次序(守住「新鲜度不参与排序」的铁律)。
 */
export function scoreRough(input: RoughInput): RoughHit[] {
  const grams = queryGrams(input.keywords)
  const words = queryLatinWords(input.keywords)
  const total = grams.size + words.length
  if (total === 0) return []
  const hits: RoughHit[] = []
  for (const row of input.rows) {
    const plain = `${row.summary ?? ''}\n${row.content ?? ''}`
    const pool = textGrams(plain)
    let matched = 0
    for (const gram of grams) if (pool.has(gram)) matched++
    if (words.length > 0) {
      const lower = plain.toLowerCase()
      for (const word of words) if (lower.includes(word)) matched++
    }
    if (matched === 0) continue
    const cover = matched / total
    if (matched < MEMORY_ROUGH_MIN_HITS && cover < MEMORY_ROUGH_MIN_COVER) continue
    hits.push({
      id: Number(row.id),
      summary: row.summary ?? '',
      created_at: String(row.created_at ?? ''),
      recalled: Number(row.recalled) || 0,
      kind: row.kind ?? null,
      hits: matched,
      cover,
    })
  }
  hits.sort((a, b) =>
    b.hits - a.hits
    || b.recalled - a.recalled
    || (a.created_at === b.created_at ? 0 : a.created_at < b.created_at ? 1 : -1)
    || b.id - a.id)
  return hits.slice(0, input.limit)
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
  hits: RoughHit[]
  keywords: string[]
  /** 生效的 owner 过滤值;undefined = 全桶。 */
  owner?: string
  /** 候选条数(过滤后、打分前)—— 用来区分"桶里没记忆"和"没匹配上"。 */
  candidates: number
}

/** 渲染检索结果。**查不到要明说**,别留给模型"好像有"的余地。 */
export function renderRough(input: RenderRoughInput): string {
  const { hits, keywords, owner, candidates } = input
  const scope = owner === undefined ? 'owner=(全部)' : `owner=${owner}`
  const head = `## 记忆检索 · "${keywords.join(' ')}" · ${scope}`
  if (candidates === 0) return `${head}\n该桶还没有记忆。先用 \`roroko_mem_edit\` op=add 落一条。`
  if (hits.length === 0) {
    return `${head}\n没有匹配上的记忆(候选 ${candidates} 条)—— 是关键词没对上,不等于没有。\n`
      + '换更贴的词,或用 `roroko_mem_date` 按日期回查。**别据此编造记忆。**'
  }
  const lines = [
    head,
    `命中 ${hits.length} 条 · 候选 ${candidates} 条`,
    '',
    '| id | 时间 | 命中 | 覆盖 | 召回 | 摘要 |',
    '|---|---|---|---|---|---|',
  ]
  for (const hit of hits) {
    const stamp = hit.created_at
    const short = stamp.length >= 16 ? stamp.slice(5, 16) : stamp
    lines.push(`| ${hit.id} | ${short} | ${hit.hits} | ${hit.cover.toFixed(3)} | ${hit.recalled} | ${cell(hit.summary)} |`)
  }
  lines.push('', '要看完整内容用 `roroko_mem_id`;摘要够判断就别多取一次。')
  return lines.join('\n')
}

/** 按 id 取全文的渲染入参。 */
export interface RenderIdInput {
  row: MemoryRow
  /** 本次取用后的召回计数(库里已经 +1,渲染要跟库一致)。 */
  recalled: number
}

/** 渲染单条记忆全文(含 provenance,方便回会话原文)。 */
export function renderId(input: RenderIdInput): string {
  const { row, recalled } = input
  const flags = row.reflected_at === null || row.reflected_at === '' || row.reflected_at === undefined
    ? '未反思'
    : `已反思 ${row.reflected_at}`
  const lines = [
    `## 记忆 #${row.id} · owner=${row.owner} · ${row.created_at} CST · 召回 ${recalled} · ${flags}`,
  ]
  if (typeof row.kind === 'string' && row.kind.length > 0) lines.push(`kind: ${row.kind}`)
  if (typeof row.source === 'string' && row.source.length > 0) lines.push(`source: ${row.source}`)
  lines.push('', row.content ?? '', '', `summary: ${row.summary}`)
  return lines.join('\n')
}

/** 建表语句(设计稿 §四原文;幂等,每次开库都跑一遍)。 */
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
