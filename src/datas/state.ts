/**
 * datas/state.ts — 三把「非取料」工具的纯逻辑：lookup / register / state。
 *
 * 从 0.1.6 的 data.ts 原样搬出来的三段业务（09-29 版口径），只做了两件事：
 *   - import 换成同目录的 query-form（parseKeywords/Row 不再各存一份）
 *   - 工具注册留给 index.ts，这里只管「开库之后干什么」
 *
 * 口径一条不动：
 *   - 表名列名列白名单全在编译期常量里，SQL 不做字符串拼接
 *   - state 白名单写回 + `*_updated` 自动同步 + 计数器 incr 快捷
 *   - 写 scene / sexual_items / outfit_* 联动素材表 hit_count（精确等值，
 *     带修饰词的值匹配不到库名就静默跳过 —— 这是既有行为，不改）
 */
import type { DatabaseSync } from 'node:sqlite'
import { parseKeywords, type Row } from './query-form.js'
import { cstDate, fmtCst, parseCstStamp } from '../time.js'

/** 素材表映射：alias → (真实表名, 名字列)。 */
export const TABLE_META: Record<string, { table: string; nameCol: string }> = {
  scene: { table: 'scenes', nameCol: 'name' },
  clothing: { table: 'clothing', nameCol: 'name' },
  items: { table: 'sexual_items', nameCol: 'name' },
  sexual_items: { table: 'sexual_items', nameCol: 'name' },
  companion: { table: 'companion_pool', nameCol: 'profession' },
}

/** roroko_datas_register 合法 type 键（ad_hoc type 用主表名存）。 */
export const REGISTER_TYPES: Record<string, string> = {
  scene: 'scenes',
  clothing: 'clothing',
  items: 'sexual_items',
  companion: 'companion_pool',
}

/** roroko_datas_lookup：按名在四张素材表查详情 → markdown。 */
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

/** 名字分词（单字 + 双字），register 合并关键词用。 */
function tokenizeName(name: string): string[] {
  const cleaned = name.replace(/[·\s　]/g, '')
  const tokens = new Set<string>()
  for (const ch of cleaned) tokens.add(ch)
  for (let i = 0; i < cleaned.length - 1; i++) tokens.add(cleaned.slice(i, i + 2))
  return [...tokens]
}

/** roroko_datas_register：ad_hoc 注册，或主表同名合并关键词。 */
export function runRegister(db: DatabaseSync, typeKey: string, nameInput: string, desc: string): string {
  const tableName = REGISTER_TYPES[typeKey]
  const meta = TABLE_META[typeKey] ?? { table: tableName, nameCol: 'name' }
  const existing = db
    .prepare(`SELECT id, keywords FROM ${tableName} WHERE ${meta.nameCol} = ?`)
    .get(nameInput) as unknown as Row | undefined
  if (existing) {
    const merged = new Set<string>([...tokenizeName(nameInput)])
    const curKws = parseKeywords(existing.keywords)
    const newKws = [...new Set([...curKws, ...merged])]
    db.prepare(
      `UPDATE ${tableName} SET keywords = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    ).run(JSON.stringify(newKws), Number(existing.id))
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
 * roroko_datas_state snap：读 soul_state 当前状态，输出 markdown + staleness 鞭策。
 * 跨天自动清零今日计数器。
 */
export function runStateSnap(db: DatabaseSync, now: Date): string {
  // 今日计数器的跨天判断按 CST 日期算 —— 与写侧同一个时区口径。
  const today = cstDate(now)
  const row0 = db.prepare('SELECT last_daily_reset FROM soul_state WHERE id = 1').get() as unknown as Row | undefined
  if (row0 && String(row0.last_daily_reset ?? '') !== today) {
    db.prepare(
      'UPDATE soul_state SET oral_today=0, vaginal_today=0, anal_today=0, last_daily_reset=? WHERE id=1',
    ).run(today)
  }
  const row = db.prepare('SELECT * FROM soul_state WHERE id = 1').get() as unknown as Row | undefined
  if (!row) return '状态表为空(id=1 不存在)'

  /** 字段是否为空：空字段既不显示、也不计陈旧度（否则空槽位会把总分拉满）。 */
  const isEmpty = (key: string): boolean => {
    const v = row[key]
    return v === undefined || v === null || String(v).length === 0 || String(v) === '无' || String(v) === '[]'
  }

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

  /** 各字段鞭策短语（score 1→index 0,4→index 3）。 */
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
    if (isEmpty(field)) continue
    const tsStr = row[`${field}_updated`]
    if (typeof tsStr !== 'string' || tsStr.trim().length === 0) continue
    // 读侧显式 +08:00 —— 库里的串没有时区标记，按宿主时区解释会整体偏 8 小时。
    const t = parseCstStamp(tsStr)
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

  // 0 分不说"过期"：全新鲜时还喊过期，会让人以为时间没更新（2026-09-24 因此误判过一次）。
  let finalWhip = '状态新鲜,暂时不用动'
  if (total > 0) {
    for (const [threshold, phrase] of SCORE_WHIPS) {
      if (total >= threshold) { finalWhip = phrase; break }
    }
  }

  const display = (key: string): string => {
    if (isEmpty(key)) return ''
    const v = row[key]
    if (key === 'sexual_items') {
      try {
        const items = JSON.parse(String(v)) as Array<{ name?: string }>
        if (Array.isArray(items)) return items.map(i => i.name ?? '').filter(Boolean).join(', ')
      } catch {
        // 保持原样
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
  lines.push('', `now: ${fmtCst(now).slice(0, 16)} (CST)`, `staleness: ${total}/${maxScore} ${finalWhip}`)
  return lines.join('\n')
}

/** roroko_datas_state update 字段白名单。 */
const STATE_FIELD_COLS = [
  'scene', 'truth', 'decision', 'position', 'body_state', 'behavior',
  'sex_state', 'arousal', 'fatigue', 'companion_present', 'companion_role',
  'outfit_top', 'outfit_bottom', 'outfit_bra', 'outfit_underwear',
  'outfit_socks', 'outfit_footwear', 'outfit_hair', 'outfit_accessory', 'outfit_outerwear',
  'sexual_items',
  'oral_today', 'vaginal_today', 'anal_today', 'oral_total', 'vaginal_total', 'anal_total',
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

/**
 * 文本字段归一：数组/对象**不能直接 `String()`** —— 那会写成 `[object Object]`，
 * 库脏了还查不出原因（道具参数是 json 类型，模型天然会给数组）。
 *
 *   ["跳蛋","润滑液"]        → "跳蛋,润滑液"
 *   [{name:"跳蛋"},{name:"套"}] → "跳蛋,套"
 *   {name:"跳蛋"}            → '{"name":"跳蛋"}'（单个对象留 JSON，读侧照旧能解析）
 */
function textValue(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  if (Array.isArray(raw)) {
    return raw
      .map(item => {
        if (item === null || item === undefined) return ''
        if (typeof item === 'object') {
          const name = (item as { name?: unknown }).name
          return typeof name === 'string' ? name.trim() : JSON.stringify(item)
        }
        return String(item).trim()
      })
      .filter(text => text.length > 0)
      .join(',')
  }
  if (typeof raw === 'object') return JSON.stringify(raw)
  return String(raw)
}

/** roroko_datas_state update：宽松 fields → 白名单列写回，含 incr 快捷计数。 */
export function runStateUpdate(db: DatabaseSync, fields: Record<string, unknown>, now: Date): string {
  // 写侧一律 CST（禁用 toISOString —— 那是 UTC，读侧会整整齐齐差 8 小时）。
  const tsNow = fmtCst(now)
  const updates = new Map<string, string | number>()
  const unknown: string[] = []

  for (const [key, raw] of Object.entries(fields)) {
    if (key.startsWith('incr_')) continue
    if (!(STATE_FIELD_COLS as readonly string[]).includes(key)) { unknown.push(key); continue }
    if (INT_FIELDS.has(key)) {
      const n = Number(raw)
      updates.set(key, Number.isFinite(n) ? Math.trunc(n) : 0)
    } else {
      updates.set(key, textValue(raw))
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

  // hit_count 联动：scene→scenes，sexual_items→sexual_items，outfit_*→clothing。
  if (updates.has('scene')) {
    db.prepare('UPDATE scenes SET hit_count = hit_count + 1, updated_at = ?, last_used_at = ? WHERE name = ?')
      .run(tsNow, tsNow, String(updates.get('scene')))
  }
  if (updates.has('sexual_items')) {
    const names = String(updates.get('sexual_items'))
      .split(',')
      .map(s => {
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
