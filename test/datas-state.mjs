/**
 * datas/state 时间口径测试:写侧 CST、读侧显式 +08:00,staleness 不再"刚写完就满分"。
 *
 * 病根(2026-09-24 阿一报,2026-10-20 在 0.2.1 线复现):update 用 `toISOString()`
 * 写 UTC 串(无时区标记),snap 却按**宿主时区**解析 → CST 机器上刚写完就被判
 * "8 小时前",全字段鞭策拉满;同一批 tsNow 还会把 clothing/scenes 的联动时间写歪。
 *
 * 本套件钉五件事:
 *   ① 写出来的串是 CST(不是 UTC) ② 解析按显式 +08:00(与环境时区无关)
 *   ③ 同一时刻 update 完立刻 snap,staleness 必须是 0 ④ 空槽位不计分
 *   ⑤ 联动进素材表的时间戳也是 CST
 *
 * 0.2.1 线是单入口包,直接从 `lib/index.mjs` 拿纯逻辑(不点界面、不连真库):
 *   node test/datas-state.mjs        (先 pnpm build)
 */
import { DatabaseSync } from 'node:sqlite'

const {
  fmtCst, fmtLastUsed, parseCstStamp, runStateSnap, runStateUpdate,
} = await import('../lib/index.mjs')

let failed = 0
const check = (name, ok, detail) => {
  if (ok) {
    console.log(`PASS  ${name}`)
  } else {
    failed += 1
    console.log(`FAIL  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
const eq = (actual, expected, name) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  check(name, a === e, `得到 ${a}，应为 ${e}`)
}
const ok = (name, cond, detail) => check(name, cond === true, detail)

// ── 建一间最小真库:soul_state 按真实列形态 + 三张联动用的素材表
const STATE_TEXT_COLS = [
  'scene', 'behavior', 'decision', 'truth', 'body_state', 'position', 'sex_state',
  'arousal', 'fatigue',
  'outfit_top', 'outfit_bottom', 'outfit_bra', 'outfit_underwear', 'outfit_socks',
  'outfit_footwear', 'outfit_hair', 'outfit_accessory', 'outfit_outerwear',
  'companion_present', 'companion_role', 'sexual_items',
]
const COUNTER_COLS = ['oral_today', 'vaginal_today', 'anal_today', 'oral_total', 'vaginal_total', 'anal_total']

function makeDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE soul_state (
    id INTEGER PRIMARY KEY,
    ${STATE_TEXT_COLS.flatMap(c => `${c} TEXT, ${c}_updated TEXT`).join(',\n    ')},
    ${COUNTER_COLS.map(c => `${c} INTEGER DEFAULT 0`).join(', ')},
    last_sex_date TEXT, last_updated TEXT, last_daily_reset TEXT
  )`)
  db.exec(`INSERT INTO soul_state (id, ${COUNTER_COLS.join(', ')}) VALUES (1, 0, 0, 0, 0, 0, 0)`)
  for (const t of ['scenes', 'clothing', 'sexual_items']) {
    db.exec(`CREATE TABLE ${t} (name TEXT, hit_count INTEGER DEFAULT 0, updated_at TEXT, last_used_at TEXT)`)
  }
  db.exec("INSERT INTO clothing (name) VALUES ('白衬衫')")
  db.exec("INSERT INTO sexual_items (name) VALUES ('跳蛋')")
  return db
}

// 同一时刻的两个写法:库要 CST 串,机器看 UTC 时刻
const T0 = '2026-09-24 17:34:52'
const now0 = new Date(Date.UTC(2026, 8, 24, 9, 34, 52))

// ── ① 写侧:CST 串,不是 UTC
const db = makeDb()
const writeText = runStateUpdate(db, { scene: '公司工位', body_state: '领口敞着' }, now0)
ok('update 回执列出字段', writeText.includes('已更新: scene、body_state'))
ok('★ update 回执的 now 是 CST 串', writeText.includes(`now: ${T0}`))
ok('★ update 回执里不出现 UTC 时刻', !writeText.includes('09:34:52'))

const row = db.prepare('SELECT scene_updated, body_state_updated FROM soul_state WHERE id = 1').get()
eq(row.scene_updated, T0, '★ 落库的时间戳是 CST(toISOString 会写成 09:34:52)')
eq(row.body_state_updated, T0, '落库时间戳同刻一致')

// ── ② 解析侧:显式 +08:00,与环境时区无关
eq(parseCstStamp(T0).getTime(), Date.UTC(2026, 8, 24, 9, 34, 52), '★ parseCstStamp 按 +08:00 解析')
eq(parseCstStamp('2026-09-24T17:34:52Z').getTime(), Date.UTC(2026, 8, 24, 17, 34, 52), '带 Z 的串不被再补偏移')
eq(parseCstStamp('2026-09-24T17:34:52+08:00').getTime(), Date.UTC(2026, 8, 24, 9, 34, 52), '已带偏移的串原样解析')
eq(fmtLastUsed(T0, now0), '刚刚', '★ 相对时间与写侧口径一致:同一时刻 → 刚刚')

// ── ③ 刚写完立刻 snap:0 分,不许鞭策
const snap0 = runStateSnap(db, now0)
ok('★ snap 表头是 CST 时刻', snap0.includes('now: 2026-09-24 17:34 (CST)'))
ok('★ 刚更新完立即 snap 应为 0 分', snap0.includes('staleness: 0/80'), snap0.split('staleness: ')[1]?.split('\n')[0])
ok('★ 0 分不喊"过期"', snap0.includes('状态新鲜'))
ok('★ 刚更新完没有任何"立刻更新!"鞭策', !snap0.includes('立刻更新'))

// ── ③-2 空值槽位不计分
db.prepare("UPDATE soul_state SET outfit_bra = '', outfit_bra_updated = '2026-09-02 18:31:13' WHERE id = 1").run()
ok('★ 值为空的槽位不计陈旧度', runStateSnap(db, now0).includes('staleness: 0/80'))

// ── ④ 过期才计分:30 分钟后 scene 1 分 + body_state 2 分
const snapLater = runStateSnap(db, new Date(now0.getTime() + 30 * 60_000))
ok('★ 30 分钟后:scene(20min)=1 + body_state(25min)=2', snapLater.includes('staleness: 3/80'), snapLater.split('staleness: ')[1]?.split('\n')[0])
ok('鞭策文案按 score 落到第二档', snapLater.includes('身体僵了'))

// ── ⑤ 联动写的素材表也是 CST
runStateUpdate(db, { outfit_top: '白衬衫' }, now0)
const cloth = db.prepare("SELECT updated_at, last_used_at, hit_count FROM clothing WHERE name = '白衬衫'").get()
eq(cloth.updated_at, T0, '★ outfit_* 联动写进 clothing 的时间戳同为 CST')
eq(cloth.hit_count, 1, 'outfit_* 联动照旧涨 hit_count')

// ── ⑤-2 道具传数组不再写成 [object Object]
runStateUpdate(db, { sexual_items: ['跳蛋', '润滑液'] }, now0)
const items = db.prepare('SELECT sexual_items FROM soul_state WHERE id = 1').get()
eq(items.sexual_items, '跳蛋,润滑液', '★ 数组形式的 sexual_items 归一成逗号串')
ok('★ 道具联动能匹配到库名(跳蛋 hit_count+1)', Number(db.prepare("SELECT hit_count FROM sexual_items WHERE name = '跳蛋'").get().hit_count) === 1)

// ── ⑥ 计数与跨 CST 日清零
runStateUpdate(db, { oral_today: 3, incr_vaginal: true }, now0)
const counted = db.prepare('SELECT oral_today, vaginal_today, vaginal_total FROM soul_state WHERE id = 1').get()
eq([counted.oral_today, counted.vaginal_today, counted.vaginal_total], [3, 1, 1], 'incr 快捷 +1(today 与 total 同增)')
const snapNextDay = runStateSnap(db, new Date(now0.getTime() + 24 * 3600_000))
ok('★ 跨 CST 日自动清零今日计数', snapNextDay.includes('| oral | 0 | 0 |'))
ok('清 today 不动 total', snapNextDay.includes('| vaginal | 0 | 1 |'))

// ── ⑦ 未知字段照旧只是忽略,不抛
const badText = runStateUpdate(db, { 不存在: 1, arousal: 60 }, now0)
ok('未知字段走忽略分支', badText.includes('忽略未知字段: 不存在'))
ok('同一批里的合法字段照常入账', badText.includes('已更新: arousal'))

// ── ⑧ CST 与运行环境时区无关
const localSample = new Date(Date.UTC(2026, 0, 1, 15, 59, 59))
eq(fmtCst(localSample), '2026-01-01 23:59:59', '★ fmtCst 恒按 +08:00(UTC 15:59 → CST 23:59)')

db.close()
console.log(failed === 0 ? '\n全部通过' : `\n失败 ${failed} 项`)
process.exit(failed === 0 ? 0 : 1)
