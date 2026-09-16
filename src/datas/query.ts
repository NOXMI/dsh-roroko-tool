/**
 * roroko_datas_query — 取料:表概览 + 候选召回(发散默认 / 条件收束)。
 *
 * 本文件只管 DB 访问与工具注册,取料逻辑全在 query-form.ts(纯函数,可离线测)。
 *
 * 设计铁律(2026-09-15 定稿):
 *   - 库不当裁判 —— 只给池子,条件由模型给;不给条件即发散
 *   - 新鲜度与 hit_count 不参与排序(会永远推同几条 / 推出不合情景的东西)
 *   - 用现有列,不加列;slot 分组键从库里动态取
 *
 * 性能口径:素材表最大规模 128 行(clothing),**全取进内存再匹配** —— SQL 的
 * `keywords LIKE` 无法表达"单字 token 不算命中",硬塞进 SQL 只会把口径搞脏;
 * 这个量级全取的成本可以忽略,换来的是匹配规则完全可控、可离线复现。
 */
import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  TABLES, clampLimit, pickCandidates, renderQuery, splitKws, splitSlots,
  type QueryTableKey, type Row,
} from './query-form.js'

const TABLE_KEYS: QueryTableKey[] = ['scene', 'clothing', 'items', 'companion']

/** 关键词热度累加(搜索侧的既有口径:只累加 keywords 字典,不碰主表 hit_count)。 */
function ensureKeywords(db: DatabaseSync, kws: string[]): void {
  if (kws.length === 0) return
  try {
    const upsert = db.prepare(
      'INSERT INTO keywords (word, hit_count) VALUES (?, 1) '
      + 'ON CONFLICT(word) DO UPDATE SET hit_count = hit_count + 1',
    )
    for (const kw of kws) upsert.run(kw)
  } catch {
    // 库只读/锁住时不拖累取料 —— 热度是副产物,查询不该因它失败
  }
}

/** ad_hoc 补位候选:同名只留最新一条(现库里有"烟"×3、"冰饮"×2 这种重复行)。 */
function adHocRows(db: DatabaseSync, tableName: string, exclude: Set<string>): Array<{ name: string; description: string }> {
  const rows = db
    .prepare('SELECT name, description FROM ad_hoc WHERE type = ? ORDER BY id DESC')
    .all(tableName) as unknown as Row[]
  const seen = new Set(exclude)
  const out: Array<{ name: string; description: string }> = []
  for (const row of rows) {
    const name = String(row.name ?? '').trim()
    if (name.length === 0 || seen.has(name)) continue
    seen.add(name)
    out.push({ name, description: String(row.description ?? '') })
  }
  return out
}

/** 工具输出统一渲染:text content block。 */
function textRender(_args: unknown, value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/** 注册 roroko_datas_query;preset 声明 roroko-data 行即生效。 */
export function applyQuery(ctx: Context, dbPath: string): void {
  ctx.tools.register(defineTool({
    name: 'roroko_datas_query',
    description:
      '洛洛可素材库取料:查场景/穿搭/道具/伴侣的候选,返回 markdown 表。'
      + '默认**发散**(池内均匀随机,每次结果不同);给了 kw 或收束条件即**收束**。'
      + 'kw 逗号分隔(如 "职场,干练"),关键词越贴切排名越前;'
      + 'clothing 另可给 slot(逗号分隔,如 "top,bottom")/ reveal_level(暴露上限≤N)/ signal_level(信号下限≥N);'
      + '穿搭按槽位分组返回,每组取 limit 条(默认 2),其余表默认 5 条(items 3)。'
      + '候选不足时会提示用 roroko_datas_register 落库。hit_count 与"多久没用"只作展示,不参与排序。',
    parameters: {
      table: {
        type: 'string',
        required: true,
        enum: TABLE_KEYS,
        description: '素材表:scene=场景,clothing=穿搭,items=道具,companion=伴侣。',
      },
      kw: {
        type: 'string',
        description: '逗号分隔关键词(如 "职场,干练")。不给 = 发散:池内均匀随机抽候选。单字词会被忽略。',
      },
      slot: {
        type: 'string',
        description: '仅 clothing:限定槽位,逗号分隔(top,bottom,bra,underwear,socks,footwear,hair,accessory,headwear…)。不给 = 全槽位。',
      },
      reveal_level: {
        type: 'number',
        description: '仅 clothing:暴露上限。给 2 表示只要 reveal_level ≤ 2 的单品(场合收敛用)。',
      },
      signal_level: {
        type: 'number',
        description: '仅 clothing:信号下限。给 3 表示只要 signal_level ≥ 3 的单品(暗示强度下限)。',
      },
      limit: {
        type: 'number',
        description: '条数:clothing 是**每个槽位**的条数(默认 2),其余表是总数(默认 5,items 3)。上限 50。',
      },
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args) {
      const spec = TABLES[args.table]
      const db = new DatabaseSync(dbPath)
      try {
        const rows = db.prepare(`SELECT * FROM ${spec.table}`).all() as unknown as Row[]
        const kws = splitKws(args.kw)
        ensureKeywords(db, kws)
        const usedCount = rows.filter(row => Number(row.hit_count ?? 0) > 0).length
        const limit = clampLimit(args.limit, spec.defaultLimit)
        const pick = pickCandidates(rows, {
          tableKey: args.table,
          kws,
          filters: {
            slot: splitSlots(args.slot),
            revealLevel: args.reveal_level,
            signalLevel: args.signal_level,
          },
          limit,
        })
        const adhoc = spec.hasSlot || pick.poolSize >= limit
          ? []
          : adHocRows(db, spec.table, new Set(pick.rows.map(row => String(row[spec.nameCol] ?? ''))))
        return renderQuery({
          tableKey: args.table,
          kws,
          pick,
          total: rows.length,
          usedCount,
          limit,
          adhoc,
        })
      } finally {
        db.close()
      }
    },
    presentCall(args) {
      const sub = args.kw !== undefined && args.kw.length > 0 ? args.kw : '发散'
      return {
        card: 'generic',
        title: `取素材 ${args.table} · ${sub}`,
        kind: 'read',
        rawInput: sub,
      }
    },
  }))
}
