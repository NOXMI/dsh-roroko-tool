/**
 * roroko-data — 洛洛可素材库查询工具集(roroko-tool 电箱子功能)。
 *
 * 设计来源:nanobot 工作区 skill `roroko-datas`(roroko_datas.py +
 * update_soul_state.py)的设计逻辑,用 DSH 姿势重写——agent preset 层注册
 * 四个 agent 工具,直接经 `node:sqlite` 访问服务器 soul.db,不再外包 python
 * CLI。
 *
 *   roroko_datas_query  取料:表概览 + 候选召回(发散默认 / 条件收束),
 *                   穿搭按 slot 分组,返回 markdown 表格(省 token,LLM 原生友好)。
 *                   实现见 datas/query.ts + datas/query-form.ts。
 *   roroko_datas_lookup   按名在四张素材表查详情。
 *   roroko_datas_register 兜底:场景/衣物/道具/伴侣不在库中时注册入 ad_hoc,
 *                   主表同名则合并关键词回主表。
 *   roroko_datas_state     状态单行读写(表 soul_state):snap 读当前状态(带 staleness
 *                   陈旧度 + 鞭策),update 按字段更新(自动同步 *_updated
 *                   时间戳 / 计数器 / hit_count 联动)。
 *
 * 电箱闸门(2026-09-03 三改):原 `data.enabled` 运行级开关已退役——preset
 * 在 agent.cordis.yml 声明 `roroko-data` 行即注册四把工具,不声明即不存在。
 * 参数两层:preset 接线 `config.dbPath`(声明即配)优先,其次 host state 文件
 * data 节覆盖(设置页编辑),最后回落服务器默认路径。参数只影响连接哪个库,
 * 不改工具 schema,不破坏 request-cache。
 *
 * 数据层限制(安全):
 *   - 只认 soul.db 素材库,表名经白名单映射,杜绝任意表 SELECT *;
 *   - 关键词/名字查询全部参数化,不做字符串拼接;
 *   - SQL 里出现的表名列名全来自编译期白名单常量。
 *
 * 注:soul.db 路径默认 /var/www/api/database/soul.db(可经 preset config
 * 或设置页覆盖)。node:sqlite 为 node22 实验特性,服务器 wrapper 已强制 node22。
 */
import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { loadStateSync } from './state.js'
import { RorokoDataDefaultDbPath } from './settings.js'
import { applyQuery } from './datas/query.js'

export const name = 'roroko-data'

/** 注入 tools 服务(注册 agent 工具必需)。 */
export const inject = ['tools']

/** roroko-data 接线 config:preset agent.cordis.yml 里 roroko-data 行可传。 */
export interface RorokoDataConfig {
  /** soul.db 绝对路径;缺省回落服务器默认路径(state 覆盖其次)。 */
  dbPath?: string
}

/** sqlite 行值类型收窄:字符串/数字/null/bigint。 */
type SqlValue = string | number | bigint | null | Uint8Array
type Row = Record<string, SqlValue>

/**
 * 解析最终 dbPath:preset config.dbPath 优先 → state 覆盖其次 → 默认路径。
 * state 缺失/损坏时回落默认。
 */
function resolveDbPath(config: RorokoDataConfig): string {
  if (config.dbPath !== undefined && config.dbPath.trim().length > 0) return config.dbPath.trim()
  const state = loadStateSync()
  const fromState = state.data.dbPath
  if (fromState.trim().length > 0) return fromState.trim()
  return RorokoDataDefaultDbPath
}

/** 打开 sqlite(工具每次 execute 独立连接,用完 close)。 */
function openDb(dbPath: string): DatabaseSync {
  return new DatabaseSync(dbPath)
}

/** 读一行 JSON 数组文本(素材表 keywords 列)。兼容裸逗号串与空串。 */
function parseKeywords(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim().length === 0) return []
  const raw = value.trim()
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        return parsed.map(String).map(s => s.trim()).filter(s => s.length > 0)
      }
    } catch {
      // fall through to comma split
    }
  }
  return raw.split(',').map(s => s.trim()).filter(s => s.length > 0)
}

/** 素材表映射:alias → (真实表名, 名字列, 是否有 slot 列)。 */
const TABLE_META: Record<string, { table: string; nameCol: string; hasSlot: boolean }> = {
  scene: { table: 'scenes', nameCol: 'name', hasSlot: false },
  clothing: { table: 'clothing', nameCol: 'name', hasSlot: true },
  items: { table: 'sexual_items', nameCol: 'name', hasSlot: false },
  sexual_items: { table: 'sexual_items', nameCol: 'name', hasSlot: false },
  companion: { table: 'companion_pool', nameCol: 'profession', hasSlot: false },
}

/** roroko_datas_register 合法 type 键(ad_hoc type 用主表名存)。 */
const REGISTER_TYPES: Record<string, string> = {
  scene: 'scenes',
  clothing: 'clothing',
  items: 'sexual_items',
  companion: 'companion_pool',
}

/** roroko_datas_lookup 主逻辑:按名在四张素材表查详情 → markdown。 */
export function runLookup(db: DatabaseSync, nameQuery: string): string {
  const tables: Array<{ table: string; nameCol: string; cols: string[] }> = [
    { table: 'clothing', nameCol: 'name', cols: ['name', 'slot', 'reveal_level', 'signal_level', 'note'] },
    { table: 'sexual_items', nameCol: 'name', cols: ['name', 'intensity_min', 'intensity_max', 'note'] },
    { table: 'companion_pool', nameCol: 'profession', cols: ['profession', 'body_type', 'trait', 'note'] },
    { table: 'scenes', nameCol: 'name', cols: ['name', 'description'] },
  ]
  const lines: string[] = []
  for (const meta of tables) {
    const rows = db
      .prepare(`SELECT * FROM ${meta.table} WHERE ${meta.nameCol} = ?`)
      .all(nameQuery) as unknown as Row[]
    for (const row of rows) {
      lines.push(`## ${meta.table} · ${String(row[meta.nameCol])}`)
      for (const col of meta.cols) {
        const v = row[col]
        if (v === undefined || v === null || String(v).length === 0) continue
        lines.push(`- ${col}: ${String(v)}`)
      }
      lines.push('')
    }
  }
  return lines.length > 0 ? lines.join('\n').trim() : `未找到: ${nameQuery}`
}

/** 名字分词(单字 + 双字),register 合并关键词用。 */
function tokenizeName(name: string): string[] {
  const cleaned = name.replace(/[·\s　]/g, '')
  const tokens = new Set<string>()
  for (const ch of cleaned) tokens.add(ch)
  for (let i = 0; i < cleaned.length - 1; i++) tokens.add(cleaned.slice(i, i + 2))
  return [...tokens]
}

/** roroko_datas_register 主逻辑:ad_hoc 注册,或主表同名合并关键词。 */
export function runRegister(db: DatabaseSync, typeKey: string, nameInput: string, desc: string): string {
  const tableName = REGISTER_TYPES[typeKey]
  const meta = TABLE_META[typeKey] ?? { table: tableName, nameCol: 'name', hasSlot: false }
  const existing = db
    .prepare(`SELECT id, keywords FROM ${tableName} WHERE ${meta.nameCol} = ?`)
    .get(nameInput) as unknown as Row | undefined
  if (existing) {
    const merged = new Set<string>([...tokenizeName(nameInput)])
    const curKws = parseKeywords(existing.keywords)
    const newKws = [...new Set([...curKws, ...merged])]
    db.prepare(
      `UPDATE ${tableName} SET keywords = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    ).run(JSON.stringify(newKws), existing.id)
    for (const kw of merged) {
      db.prepare('INSERT OR IGNORE INTO keywords (word) VALUES (?)').run(kw)
    }
    return `已合并关键词到 ${tableName}.${nameInput} (id=${existing.id})\n新增: ${[...merged].join('、')}`
  }
  const res = db
    .prepare('INSERT INTO ad_hoc (type, name, description) VALUES (?, ?, ?)')
    .run(tableName, nameInput, desc)
  return `已注册 ad_hoc #${res.lastInsertRowid}: ${tableName}/${nameInput}`
}

/**
 * roroko_datas_state snap:读 soul_state 当前状态,输出 markdown + staleness 鞭策。
 * 跨天自动清零今日计数器。
 */
export function runStateSnap(db: DatabaseSync, now: Date): string {
  // 今日计数器跨天清零。
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const row0 = db.prepare('SELECT last_daily_reset FROM soul_state WHERE id = 1').get() as unknown as Row | undefined
  if (row0 && String(row0.last_daily_reset ?? '') !== today) {
    db.prepare(
      'UPDATE soul_state SET oral_today=0, vaginal_today=0, anal_today=0, last_daily_reset=? WHERE id=1',
    ).run(today)
  }
  const row = db.prepare('SELECT * FROM soul_state WHERE id = 1').get() as unknown as Row | undefined
  if (!row) return '状态表为空(id=1 不存在)'

  /** 字段 → (类别, 陈旧度阈值分钟列表[score1..4])。 */
  const CATS: Record<string, { cat: 'body' | 'outfit' | 'narrative'; minutes: number[] }> = {
    body_state: { cat: 'body', minutes: [10, 25, 60, 180] },
    position: { cat: 'body', minutes: [10, 25, 60, 180] },
    sex_state: { cat: 'body', minutes: [10, 25, 60, 180] },
    arousal: { cat: 'body', minutes: [10, 25, 60, 180] },
    fatigue: { cat: 'body', minutes: [10, 25, 60, 180] },
    behavior: { cat: 'body', minutes: [10, 25, 60, 180] },
    companion_role: { cat: 'body', minutes: [10, 25, 60, 180] },
    outfit_top: { cat: 'outfit', minutes: [60, 180, 360, 720] },
    outfit_bottom: { cat: 'outfit', minutes: [60, 180, 360, 720] },
    outfit_bra: { cat: 'outfit', minutes: [60, 180, 360, 720] },
    outfit_underwear: { cat: 'outfit', minutes: [60, 180, 360, 720] },
    outfit_socks: { cat: 'outfit', minutes: [60, 180, 360, 720] },
    outfit_footwear: { cat: 'outfit', minutes: [60, 180, 360, 720] },
    outfit_hair: { cat: 'outfit', minutes: [60, 180, 360, 720] },
    outfit_accessory: { cat: 'outfit', minutes: [60, 180, 360, 720] },
    outfit_outerwear: { cat: 'outfit', minutes: [60, 180, 360, 720] },
    scene: { cat: 'narrative', minutes: [20, 60, 180, 360] },
    truth: { cat: 'narrative', minutes: [20, 60, 180, 360] },
    decision: { cat: 'narrative', minutes: [20, 60, 180, 360] },
    sexual_items: { cat: 'narrative', minutes: [20, 60, 180, 360] },
  }

  /** 各字段鞭策短语(score 1→index 0,4→index 3)。 */
  const WHIPS: Record<string, string[]> = {
    body_state: ['身体该有变化了,更新~', '身体僵了,扭扭换个体位~', '同一状态太久,快更新~', '体温都要凉了,赶紧更新~'],
    position: ['该挪挪屁股换地方了,更新~', '还在原地?快更新~', '位置陈旧,换个场景~', '定住了?立刻更新!'],
    sex_state: ['该动动了,在等下个阶段~', '状态凝固了,快更新~', '原地踏步太久,赶紧更新~', '死水一潭,立刻更新!'],
    arousal: ['放了这么久,更新数值~', '数值不动弹,快更新~', '时间太久,赶紧更新~', 'arousal冻住了,赶紧更新!'],
    fatigue: ['隔了这么久,更新~', '数值不动弹,快更新~', '时间太久,赶紧更新~', 'fatigue烂了,赶紧更新!'],
    behavior: ['该换种演法了,更新~', '同一套演太久,快更新~', '演技套路化,赶紧更新~', 'behavior烂了,立刻更新!'],
    companion_role: ['该换伴侣了,更新~', '同一角色太久,快更新~', '伴侣陈旧,赶紧更新~', '没人陪?立刻更新!'],
    scene: ['该换场景了,更新~', '场景陈旧,快更新~', '还在原地?赶紧更新~', '场景烂了,立刻更新!'],
    truth: ['真相该发酵了,更新~', 'truth静置太久,快更新~', '真相没推进,赶紧更新~', 'truth冻住了,立刻更新!'],
    decision: ['该换说法骗他了,更新~', 'decision陈旧,快更新~', '同一套谎话用太久,赶紧更新~', 'decision馊了,立刻更新!'],
    sexual_items: ['该加道具了,更新~', '道具栏空着?快更新~', '没有道具,赶紧更新~', '空手道!立刻更新!'],
  }
  const OUTFIT_WHIPS = [
    '{item}皱了没?更新穿搭~', '{item}该让衣料讲故事了,快更新~',
    '{item}穿太久了,赶紧更新~', '{item}穿出包浆了,立刻更新!',
  ]
  const SCORE_WHIPS: Array<[number, string]> = [
    [70, '所有state都过期啦!快全量更新!'],
    [60, '该完全重构state啦!'],
    [50, '这个瞬间已完全过期,快更新!'],
    [40, '大半state过期啦,快更新!'],
    [30, '间隔太长啦,快更新state!'],
    [20, '洛洛可是定在原地了吗?快更新!'],
    [10, '好久没动啦,快更新!'],
    [0, '有些state过期,更新对应值!'],
  ]

  let total = 0
  const whipMap = new Map<string, string>()
  const maxScore = Object.keys(CATS).length * 4
  for (const [field, spec] of Object.entries(CATS)) {
    const tsStr = row[`${field}_updated`]
    if (typeof tsStr !== 'string' || tsStr.trim().length === 0) continue
    const t = new Date(tsStr.replace(' ', 'T'))
    if (Number.isNaN(t.getTime())) continue
    const minutes = (now.getTime() - t.getTime()) / 60_000
    const score = spec.minutes.filter(m => minutes > m).length
    if (score <= 0) continue
    total += score
    const idx = score - 1
    const phrase = spec.cat === 'outfit'
      ? OUTFIT_WHIPS[idx].replace('{item}', String(row[field] ?? '它'))
      : WHIPS[field]?.[idx]
    if (phrase) whipMap.set(field, phrase)
  }

  let finalWhip = SCORE_WHIPS[SCORE_WHIPS.length - 1][1]
  for (const [threshold, phrase] of SCORE_WHIPS) {
    if (total >= threshold) { finalWhip = phrase; break }
  }

  const display = (key: string): string => {
    const v = row[key]
    if (v === undefined || v === null || String(v).length === 0 || String(v) === '无' || String(v) === '[]') return ''
    // sexual_items JSON → 只留名字。
    if (key === 'sexual_items') {
      try {
        const items = JSON.parse(String(v)) as Array<{ name?: string }>
        if (Array.isArray(items)) return items.map(i => i.name ?? '').filter(Boolean).join(', ')
      } catch {
        // keep raw
      }
    }
    return String(v).replaceAll('|', '/')
  }

  const order = [
    'scene', 'truth', 'decision', 'position', 'body_state', 'behavior',
    'sex_state', 'arousal', 'fatigue',
    'outfit_top', 'outfit_bottom', 'outfit_bra', 'outfit_underwear',
    'outfit_socks', 'outfit_footwear', 'outfit_hair', 'outfit_accessory', 'outfit_outerwear',
    'companion_role', 'sexual_items',
  ]
  const lines = ['## state', '', '| 字段 | 值 | 鞭策 |', '|------|-----|------|']
  for (const key of order) {
    const value = display(key)
    if (!value) continue
    lines.push(`| ${key} | ${value} | ${whipMap.get(key) ?? ''} |`)
  }
  lines.push('', '## 计数器', '| name | today | total |', '|------|-------|-------|')
  for (const base of ['oral', 'vaginal', 'anal'] as const) {
    lines.push(`| ${base} | ${String(row[`${base}_today`] ?? 0)} | ${String(row[`${base}_total`] ?? 0)} |`)
  }
  lines.push('', `now: ${now.toISOString().slice(0, 16).replace('T', ' ')} (UTC)`, `staleness: ${total}/${maxScore} ${finalWhip}`)
  return lines.join('\n')
}

/** roroko_datas_state update 字段白名单(宽松 fields 收窄用)。 */
const STATE_FIELD_COLS = [
  // narrative
  'scene', 'truth', 'decision', 'position', 'body_state', 'behavior',
  // body
  'sex_state', 'arousal', 'fatigue', 'companion_present', 'companion_role',
  // outfit
  'outfit_top', 'outfit_bottom', 'outfit_bra', 'outfit_underwear',
  'outfit_socks', 'outfit_footwear', 'outfit_hair', 'outfit_accessory', 'outfit_outerwear',
  // items
  'sexual_items',
  // counters (直接设值)
  'oral_today', 'vaginal_today', 'anal_today', 'oral_total', 'vaginal_total', 'anal_total',
  // meta
  'last_sex_date',
] as const

/** 带 `*_updated` 自动同步时间戳的字段。 */
const TS_SYNC_FIELDS = new Set<string>([
  'scene', 'truth', 'decision', 'position', 'body_state', 'behavior',
  'sex_state', 'arousal', 'fatigue', 'companion_role', 'sexual_items',
  'outfit_top', 'outfit_bottom', 'outfit_bra', 'outfit_underwear',
  'outfit_socks', 'outfit_footwear', 'outfit_hair', 'outfit_accessory', 'outfit_outerwear',
])

/** 整数约束字段。 */
const INT_FIELDS = new Set<string>([
  'arousal', 'fatigue', 'companion_present',
  'oral_today', 'vaginal_today', 'anal_today', 'oral_total', 'vaginal_total', 'anal_total',
])

/** roroko_datas_state update:宽松 fields → 白名单列写回,含 incr 快捷计数。 */
export function runStateUpdate(db: DatabaseSync, fields: Record<string, unknown>, now: Date): string {
  const tsNow = now.toISOString().slice(0, 19).replace('T', ' ')
  const updates = new Map<string, string | number>()
  const unknown: string[] = []

  for (const [key, raw] of Object.entries(fields)) {
    // incr_* 快捷计数单独处理。
    if (key.startsWith('incr_')) continue
    if (!(STATE_FIELD_COLS as readonly string[]).includes(key)) { unknown.push(key); continue }
    if (INT_FIELDS.has(key)) {
      const n = Number(raw)
      updates.set(key, Number.isFinite(n) ? Math.trunc(n) : 0)
    } else {
      updates.set(key, String(raw))
    }
    if (TS_SYNC_FIELDS.has(key)) updates.set(`${key}_updated`, tsNow)
  }

  const incrBases: string[] = []
  for (const base of ['oral', 'vaginal', 'anal'] as const) {
    if (fields[`incr_${base}`] === true) incrBases.push(base)
  }

  if (updates.size > 0) {
    const cols = [...updates.keys()]
    const sql = `UPDATE soul_state SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = 1`
    db.prepare(sql).run(...updates.values())
  }
  if (incrBases.length > 0) {
    const sets = incrBases.map(b => `${b}_today = ${b}_today + 1, ${b}_total = ${b}_total + 1`).join(', ')
    db.prepare(`UPDATE soul_state SET ${sets} WHERE id = 1`).run()
  }

  // hit_count 联动:scene→scenes, sexual_items→sexual_items, outfit_*→clothing。
  if (updates.has('scene')) {
    db.prepare('UPDATE scenes SET hit_count = hit_count + 1, updated_at = ?, last_used_at = ? WHERE name = ?')
      .run(tsNow, tsNow, String(updates.get('scene')))
  }
  if (updates.has('sexual_items')) {
    const rawItems = String(updates.get('sexual_items'))
    const names = rawItems
      .split(',')
      .map(s => {
        // 支持 JSON 数组或裸串。
        const trimmed = s.trim().replace(/^\[|\]$/g, '')
        const jsonMatch = trimmed.match(/"name"\s*:\s*"([^"]*)"/)
        return (jsonMatch ? jsonMatch[1] : trimmed.replace(/^"|"$/g, '')).trim()
      })
      .filter(s => s.length > 0)
    for (const nm of names) {
      db.prepare('UPDATE sexual_items SET hit_count = hit_count + 1, updated_at = ?, last_used_at = ? WHERE name = ?')
        .run(tsNow, tsNow, nm)
    }
  }
  for (const [key, value] of updates) {
    if (!key.startsWith('outfit_') || key.endsWith('_updated')) continue
    db.prepare('UPDATE clothing SET hit_count = hit_count + 1, updated_at = ?, last_used_at = ? WHERE name = ?')
      .run(tsNow, tsNow, String(value))
  }

  const summary: string[] = []
  if (updates.size > 0) {
    const setKeys = [...updates.keys()].filter(k => !k.endsWith('_updated'))
    summary.push(`已更新: ${setKeys.join('、')}`)
  }
  if (incrBases.length > 0) summary.push(`计数器 +1: ${incrBases.join('、')}`)
  if (unknown.length > 0) summary.push(`忽略未知字段: ${unknown.join('、')}`)
  summary.push(`now: ${tsNow}`)
  return summary.join('\n')
}

/** 工具输出统一渲染:text content block。 */
function textRender(_args: unknown, value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/** 工具入口:按白名单操作 sqlite(表名列名全来自常量)。 */
function withDb(dbPath: string, fn: (db: DatabaseSync) => string): string {
  const db = openDb(dbPath)
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

/** 注册四个素材库工具;preset 声明本插件即注册。 */
export function apply(ctx: Context, config: RorokoDataConfig = {}): void {
  const dbPath = resolveDbPath(config)

  applyQuery(ctx, dbPath)

  const lookupTool = defineTool({
    name: 'roroko_datas_lookup',
    description: '按名字精确查某素材(场景/穿搭/道具/伴侣)的完整详情,返回过滤后的字段。遇到不认识的名字先查这里。',
    parameters: {
      name: {
        type: 'string',
        required: true,
        description: '要查的元素名,如 "白衬衫" / "健身教练"。',
      },
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args) {
      return withDb(dbPath, db => runLookup(db, args.name))
    },
    presentCall(args) {
      return { card: 'generic', title: `查详情 ${args.name}`, kind: 'read', rawInput: args.name }
    },
  })

  const registerTool = defineTool({
    name: 'roroko_datas_register',
    description:
      '素材兜底注册:场景/穿搭/道具/伴侣不在库里时注册入 ad_hoc 表。'
      + '若主表已有同名,则把名字分词合并进关键词,不重复录入。type 取 scene|clothing|items|companion。',
    parameters: {
      type: {
        type: 'string',
        required: true,
        enum: ['scene', 'companion', 'clothing', 'items'],
        description: '注册类型:scene=场景,clothing=穿搭,items=道具,companion=伴侣。',
      },
      name: {
        type: 'string',
        required: true,
        description: '要注册的名字,如 "地铁" / "外卖骑手"。',
      },
      desc: {
        type: 'string',
        description: '一句话描述,存 ad_hoc.description。',
      },
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args) {
      return withDb(dbPath, db => runRegister(db, args.type, args.name, args.desc ?? ''))
    },
    presentCall(args) {
      return { card: 'generic', title: `注册 ${args.type}/${args.name}`, kind: 'other', rawInput: args.name }
    },
  })

  const stateTool = defineTool({
    name: 'roroko_datas_state',
    description:
      '洛洛可状态读写:单行状态存叙事(scene/truth/decision/position/body_state/behavior)'
      + '、身体(sex_state/arousal/fatigue/companion_*)、穿搭(outfit_*)、道具(sexual_items)与计数器'
      + '(oral/vaginal/anal today+total)。'
      + 'action=snap 读当前状态(markdown,含 stale 陈旧度鞭策,今日计数器跨天自动清零);'
      + 'action=update 写字段:fields 传 {字段: 值}。合法字段见白名单;'
      + '性状态可用 sex_state;计数器快捷累加传 incr_oral/incr_vaginal/incr_anal 为 true;'
      + '写 scene/outfit_*/sexual_items 会自动同步对应素材表 hit_count。',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['snap', 'update'],
        description: 'snap=读状态,update=写字段。',
      },
      fields: {
        type: 'json',
        description:
          'action=update 时的字段对象。合法字段:scene/truth/decision/position/body_state/behavior/'
          + 'sex_state/arousal/fatigue/companion_present/companion_role/outfit_top/outfit_bottom/'
          + 'outfit_bra/outfit_underwear/outfit_socks/outfit_footwear/outfit_hair/outfit_accessory/'
          + 'outfit_outerwear/sexual_items/oral_today/vaginal_today/anal_today/oral_total/vaginal_total/'
          + 'anal_total/last_sex_date,以及 incr_oral/incr_vaginal/incr_anal(布尔快捷+1)。',
      },
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args) {
      const now = new Date()
      return withDb(dbPath, db => {
        if (args.action === 'snap') return runStateSnap(db, now)
        const fields = args.fields !== undefined && typeof args.fields === 'object' && args.fields !== null
          ? args.fields as Record<string, unknown>
          : {}
        return runStateUpdate(db, fields, now)
      })
    },
    presentCall(args) {
      const sub = args.action === 'snap' ? 'snap' : JSON.stringify(args.fields ?? {}).slice(0, 40)
      const kind = args.action === 'snap' ? 'read' : 'other'
      return { card: 'generic', title: `state ${args.action}`, kind, rawInput: sub }
    },
  })

  ctx.tools.register(lookupTool)
  ctx.tools.register(registerTool)
  ctx.tools.register(stateTool)
}
