/**
 * roroko 记忆库访问层:开库建表 / 写入 / 按日期回查 / 关键词检索。
 *
 * 只依赖 `node:sqlite` 与 memory-form.ts(纯逻辑),**不 import DSH 运行时包** ——
 * 测试可以直接 import 本产物真跑临时库,不需要替身钩子。
 *
 * 连接策略:每次 execute 独立开关一条连接(与 roroko_datas_* 同款);开库即建表,
 * 幂等。sqlite 不会自己建目录,所以先补父目录。
 *
 * 减法(2026-09-21):检索从"全表取回 + bigram 打分"改成**一条 SQL**(每个关键词都要
 * 命中,LIKE 包含匹配);删掉召回计数与 owner 分桶开关。桶由调用方固定传进来。
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  MEMORY_DDL, MEMORY_PRAGMAS, escapeLike, fmtCst, normalizeId, normalizeLimit, renderAddResult,
  renderDate, renderId, renderReflectResult, renderRough, resolveRange, splitKeywords,
  type DateRange, type MemoryAddInput, type MemoryReflectInput, type MemoryRow,
} from './form.js'

/** sqlite 行值类型收窄。 */
type SqlValue = string | number | bigint | null | Uint8Array
type Row = Record<string, SqlValue>

/**
 * 开库 + 建表(幂等)。父目录不存在则补建 —— sqlite 遇缺目录直接报错。
 * 建表失败会让插件 apply 抛错 → 调用方自己 try/catch,别拖垮 preset 挂载。
 */
export function openMemoryDb(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  for (const sql of MEMORY_PRAGMAS) db.exec(sql)
  for (const sql of MEMORY_DDL) db.exec(sql)
  return db
}

/** 写一条记忆:created_at 由服务端按 CST 生成,reflected_at 留 NULL(待反思)。 */
export function runAdd(
  db: DatabaseSync,
  input: MemoryAddInput,
  now: Date,
): { id: number; createdAt: string; text: string } {
  const createdAt = fmtCst(now)
  const inserted = db
    .prepare(
      'INSERT INTO memory (owner, content, summary, created_at, source, kind) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      input.owner,
      input.content,
      input.summary,
      createdAt,
      input.source.length > 0 ? input.source : null,
      input.kind.length > 0 ? input.kind : null,
    )
  const id = Number(inserted.lastInsertRowid)
  return { id, createdAt, text: renderAddResult(input, id, createdAt) }
}

/**
 * 反思一条记忆:直接覆盖 content(设计稿 §五 5.3,防膨胀)、刷 reflected_at,
 * summary 传了才一起换。owner/kind/source 一概不动。
 * 查不到 id 返回人话,不抛。
 */
export function runReflect(db: DatabaseSync, input: MemoryReflectInput, now: Date): string {
  const row = db
    .prepare(`SELECT ${MEMORY_COLUMNS} FROM memory WHERE id = ?`)
    .get(input.id) as unknown as MemoryRow | undefined
  if (row === undefined) {
    return `没有 #${input.id} 这条记忆。reflect 只能改已有的;要记新的用 op=add。`
  }
  const reflectedAt = fmtCst(now)
  const summaryKept = input.summary.length === 0
  const summary = summaryKept ? row.summary : input.summary
  db.prepare('UPDATE memory SET content = ?, summary = ?, reflected_at = ? WHERE id = ?')
    .run(input.content, summary, reflectedAt, input.id)
  return renderReflectResult({
    id: input.id,
    reflectedAt,
    beforeChars: (row.content ?? '').length,
    afterChars: input.content.length,
    summaryKept,
    summary,
  })
}

/** 按日期回查入参(区间两端)。 */
export interface DateQuery {
  from?: unknown
  to?: unknown
}

/**
 * 按日期回查:拿 created_at 前 10 位(纯日期)做字符串比较,避开时间部分。
 * 区间非法时返回人话错误,不抛 —— 工具执行失败会污染整轮。
 */
export function runDate(db: DatabaseSync, query: DateQuery, owner: string, now: Date): string {
  const resolved = resolveRange(query.from, query.to, now)
  if (resolved.range === undefined) return `区间非法: ${resolved.error}`
  const range: DateRange = resolved.range
  const rows = db
    .prepare(
      `SELECT id, owner, summary, created_at, reflected_at, kind FROM memory
       WHERE owner = ? AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(owner, range.from, range.to) as unknown as MemoryRow[]
  return renderDate({ rows, range, owner })
}

/** 检索 / 取全文 / dream 共用的列(改动这里要顺手看一眼各处渲染)。 */
export const MEMORY_COLUMNS = 'id, owner, content, summary, created_at, reflected_at, source, kind'

/** 桶内条数(区分"桶里没记忆"和"没匹配上")。 */
function countOwner(db: DatabaseSync, owner: string): number {
  const row = db.prepare('SELECT count(*) AS n FROM memory WHERE owner = ?').get(owner) as unknown as Row | undefined
  return Number(row?.n ?? 0) || 0
}

/** 关键词检索入参。 */
export interface RoughQuery {
  keywords?: unknown
  limit?: unknown
}

/**
 * 关键词检索:**一条 SQL**,每个关键词都要在 content 或 summary 里出现(LIKE 包含匹配,
 * 通配符已转义)。命中按时间倒序取 limit 条 —— 没有打分、没有相似度、没有召回计数。
 * 关键词切不出东西时返回人话,不抛(工具抛错会污染整轮)。
 */
export function runRough(db: DatabaseSync, query: RoughQuery, owner: string): string {
  const keywords = splitKeywords(query.keywords)
  if (keywords.length === 0) return '关键词为空:给一句要检索的话或几个词(空格分隔)。'
  const candidates = countOwner(db, owner)
  if (candidates === 0) return renderRough({ rows: [], keywords, owner, candidates })
  const where: string[] = []
  const params: SqlValue[] = [owner]
  for (const word of keywords) {
    where.push("(content LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')")
    const pattern = `%${escapeLike(word)}%`
    params.push(pattern, pattern)
  }
  const rows = db
    .prepare(
      `SELECT id, owner, summary, created_at, reflected_at, kind FROM memory
       WHERE owner = ? AND ${where.join(' AND ')}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(...params, normalizeLimit(query.limit)) as unknown as MemoryRow[]
  return renderRough({ rows, keywords, owner, candidates })
}

/** 按 id 取全文入参。 */
export interface IdQuery {
  id?: unknown
}

/**
 * 按 id 取一条的完整内容(摘要不足以判断时才用)。只在**本桶**里找,查不到返回人话,不抛。
 */
export function runId(db: DatabaseSync, query: IdQuery, owner: string): string {
  const id = normalizeId(query.id)
  if (id === undefined) {
    return `id 非法: ${String(query.id)}(要正整数;id 从检索或按日期回查的结果里拿)`
  }
  const row = db
    .prepare(`SELECT ${MEMORY_COLUMNS} FROM memory WHERE id = ? AND owner = ?`)
    .get(id, owner) as unknown as MemoryRow | undefined
  if (row === undefined) return `没有 #${id} 这条记忆(owner=${owner})。`
  return renderId({ row })
}
