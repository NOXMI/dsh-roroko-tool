/**
 * roroko 记忆库访问层:开库建表 / 写入 / 按日期回查。
 *
 * 只依赖 `node:sqlite` 与 memory-form.ts(纯逻辑),**不 import DSH 运行时包** ——
 * 测试可以直接 import 本产物真跑临时库,不需要替身钩子。
 *
 * 连接策略:每次 execute 独立开关一条连接(与 roroko_datas_* 同款);开库即建表,
 * 幂等。sqlite 不会自己建目录,所以先补父目录。
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  MEMORY_DDL, MEMORY_PRAGMAS, fmtCst, renderAddResult, renderDate, resolveRange,
  type DateRange, type MemoryAddInput, type MemoryRow,
} from './memory-form.js'

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

/** 按日期回查入参。 */
export interface DateQuery {
  from?: unknown
  to?: unknown
  /** undefined = 全部桶(不跨桶是默认纪律,这里是显式放宽口)。 */
  owner?: string
}

/**
 * 按日期回查:拿 created_at 前 10 位(纯日期)做字符串比较,避开时间部分。
 * 区间非法时返回人话错误,不抛 —— 工具执行失败会污染整轮。
 */
export function runDate(db: DatabaseSync, query: DateQuery, now: Date): string {
  const resolved = resolveRange(query.from, query.to, now)
  if (resolved.range === undefined) return `区间非法: ${resolved.error}`
  const range: DateRange = resolved.range
  const where = ['substr(created_at, 1, 10) >= ?', 'substr(created_at, 1, 10) <= ?']
  const params: Array<string> = [range.from, range.to]
  if (query.owner !== undefined && query.owner.length > 0) {
    where.push('owner = ?')
    params.push(query.owner)
  }
  const rows = db
    .prepare(
      `SELECT id, owner, summary, created_at, reflected_at, recalled, kind FROM memory
       WHERE ${where.join(' AND ')} ORDER BY created_at ASC, id ASC`,
    )
    .all(...params) as unknown as MemoryRow[]
  return renderDate({ rows, range, owner: query.owner, now })
}
