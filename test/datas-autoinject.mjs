/**
 * datas/state-autoinject 测试:纯逻辑(判定/渲染) + 机制本体(两个挂点真跑)。
 * 零依赖,直读 lib/ 产物。
 *
 * 运行:node test/datas-autoinject.mjs
 * 机制部分 import 了 dsh-llm 的 createUserMessage → 需要解析钩子换替身,
 * 走 run-all 时会带 --import(单独跑要自己加)。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { makeAsserts, useTempDshHome } from './helpers/harness.mjs'

const { ok, eq, done } = makeAsserts()

const home = await useTempDshHome('roroko-autoinject-')

const {
  AutoinjectDefaultRounds, clampRounds, todayStamp,
  dueByRounds, isRorokoDatasTool, decide, renderStateShort, counterToday,
  buildInjectText, AutoinjectNotice,
} = await import('../lib/datas/state-autoinject-form.js')

const now = new Date('2026-09-16T15:00:00')
const today = todayStamp(now)

// ── 阈值收窄
eq(AutoinjectDefaultRounds, 8, '默认轮数阈值 8')
eq(clampRounds(undefined), 8, 'clampRounds:undefined → 默认')
eq(clampRounds('abc'), 8, 'clampRounds:非数字 → 默认')
eq(clampRounds(0), 1, 'clampRounds:0 钳到 1(不会每步都注)')
eq(clampRounds(-5), 1, 'clampRounds:负数钳到 1')
eq(clampRounds(201), 200, 'clampRounds:上限 200')
eq(clampRounds(8.9), 8, 'clampRounds:取整')
eq(clampRounds('12'), 12, 'clampRounds:数字串可用')

// ── 本地时间口径(禁 UTC)
eq(todayStamp(now), '2026-09-16', 'todayStamp:本地日期')
eq(todayStamp(new Date(2026, 0, 3)), '2026-01-03', 'todayStamp:补零')
ok(!todayStamp(now).includes('Z') && !todayStamp(now).includes('T'), '★ 时间戳不含 UTC 标记')

// ── 轮数到期
eq(dueByRounds(7, Number.NaN, 8), true, 'dueByRounds:从未注过 → 到期')
eq(dueByRounds(7, 0, 8), false, 'dueByRounds:差 7 < 8 不到期')
eq(dueByRounds(8, 0, 8), true, 'dueByRounds:差 8 到期(边界含等号)')
eq(dueByRounds(9, 0, 8), true, 'dueByRounds:差 9 到期')
eq(dueByRounds(3, 3, 8), false, 'dueByRounds:同一回合不重复')

// ── 工具名识别
ok(isRorokoDatasTool('roroko_datas_query'), 'isRorokoDatasTool:query 命中')
ok(isRorokoDatasTool('roroko_datas_state'), 'isRorokoDatasTool:state 命中')
ok(!isRorokoDatasTool('roroko_datas'), 'isRorokoDatasTool:光前缀不算')
ok(!isRorokoDatasTool('memory'), 'isRorokoDatasTool:别的工具不算')
ok(!isRorokoDatasTool(undefined), 'isRorokoDatasTool:非字符串不算')

// ── decide:四层优先级
const base = {
  turn: 20,
  lastTurn: 20,
  injectedTurn: Number.NaN,
  pending: false,
  forced: false,
  roundsEnabled: true,
  afterToolEnabled: true,
  every: 8,
}
eq(decide({ ...base, injectedTurn: 20 }), { inject: false, source: null },
  '★ decide:本回合已注过 → 一律不注(闸门)')
eq(decide({ ...base, forced: true, injectedTurn: 20 }), { inject: false, source: null },
  '★ decide:压缩 forced 也压不过同回合闸门')
eq(decide({ ...base, pending: true }), { inject: true, source: 'after-tool' },
  'decide:工具后触发优先于轮数')
eq(decide({ ...base, forced: true, pending: true }), { inject: true, source: 'rounds' },
  'decide:压缩释放优先于工具后(轮数开关开)')
eq(decide({ ...base, forced: true, roundsEnabled: false, pending: true }),
  { inject: true, source: 'after-tool' },
  'decide:轮数开关关了 → forced 失效,落回工具后')
eq(decide({ ...base, lastTurn: 12 }), { inject: true, source: 'rounds' },
  'decide:距上次 8 轮 → 轮数注入')
eq(decide({ ...base, pending: true, afterToolEnabled: false }),
  { inject: false, source: null },
  '★ decide:工具后开关关了 + 轮数未到期 → 不注')
eq(decide({ ...base, roundsEnabled: false, afterToolEnabled: false, lastTurn: Number.NaN }),
  { inject: false, source: null },
  'decide:两个开关全关 → 一条不注')
eq(decide({ ...base, lastTurn: Number.NaN, injectedTurn: Number.NaN }),
  { inject: true, source: 'rounds' },
  'decide:首次进入会话(从未注过)→ 轮数路径立即注一条')

// ── 计数器跨天口径(只读不写)
const rowFresh = { last_daily_reset: today, oral_today: 3, oral_total: 12 }
const rowStale = { last_daily_reset: '2026-09-15', oral_today: 3, oral_total: 12 }
eq(counterToday(rowFresh, 'oral', today), 3, 'counterToday:同一天 → 真值')
eq(counterToday(rowStale, 'oral', today), 0, '★ counterToday:跨天 → 按 0 显示(不改库)')
eq(counterToday({ oral_total: 12 }, 'oral', today), 0, 'counterToday:没有清零列 → 0')

// ── 短条渲染
const longRow = {
  scene: '公司下午的开放工位',
  truth: '午餐时把避孕套塞进西装口袋,他不知道',
  decision: '继续扮端庄,晚上再决定要不要让他发现',
  position: '坐在工位上,双腿交叠',
  body_state: '内裤已经透了',
  behavior: '假装看需求文档',
  arousal: 62,
  outfit_top: '白衬衫',
  outfit_bottom: '包臀裙',
  outfit_bra: '蕾丝内衣',
  outfit_underwear: '蕾丝内裤',
  oral_today: 1, oral_total: 12,
  vaginal_today: 0, vaginal_total: 8,
  anal_today: 0, anal_total: 3,
  last_daily_reset: today,
}
const short = renderStateShort(longRow, now)
ok(short.startsWith('[state] scene=公司下午的开放工位'), '短条:以 scene 开头')
ok(short.includes('arousal=62'), '短条:含 arousal')
ok(short.includes('计 oral 1/12 · vaginal 0/8 · anal 0/3'), '短条:计数器格式')
ok(short.includes('着装=白衬衫/包臀裙/蕾丝内衣/蕾丝内裤'), '短条:着装合并成一段')
ok(short.includes('truth=') && short.includes('decision=') && short.includes('behavior='),
  '★ 短条:含 truth / decision / behavior(阿一拍板加的三项)')
ok(short.includes('着装=') && short.includes('计 oral'),
  '★ 短条:不限字数 → 尾部段(计数器/着装)都保住')

const slim = renderStateShort({
  scene: '办公室', arousal: 30, last_daily_reset: today, oral_today: 0, oral_total: 0,
}, now)
ok(!slim.includes('position=') && !slim.includes('着装='), '短条:空值字段整段跳过')
ok(slim.includes('计 oral 0/0'), '短条:计数器恒在(哪怕全 0)')

const dirty = renderStateShort({ scene: '咖啡 | 吧台', last_daily_reset: today }, now)
ok(!dirty.includes('| 吧台'), '★ 短条:值里的竖线换成斜杠(不破分隔)')

// 不限字数:超长输入原样保留(生产库的 position/behavior 都是长句)
const huge = renderStateShort({
  ...longRow,
  scene: '一'.repeat(80),
  truth: '二'.repeat(80),
}, now)
ok(huge.length > 200, `★ 不限字数:超长输入原样保留(${huge.length} 字,不截断)`)
ok(huge.includes('着装=') && huge.includes('计 oral'), '★ 不限字数:尾部段不会被砍')

// ── 注入壳
const text = buildInjectText(short)
ok(text.startsWith('###下方内容由脚本自动注入###'), '注入壳:第一行是脚本注入声明')
ok(text.includes('黑川不可见也不知情'), '★ 注入壳:沿用 nanobot 口径')
ok(text.includes(AutoinjectNotice) && text.endsWith(short), '注入壳:声明 + 短条')

// ══════════════════════════════════════════════════════════════════
// 机制本体:假 ctx 驱动两个挂点(不需要真 DSH)
// ══════════════════════════════════════════════════════════════════
const { DatabaseSync } = await import('node:sqlite')
const { join } = await import('node:path')

const dbPath = join(home.dir, 'soul.db')
const db = new DatabaseSync(dbPath)
db.exec(`CREATE TABLE soul_state (
  id INTEGER PRIMARY KEY,
  scene TEXT, truth TEXT, decision TEXT, position TEXT, body_state TEXT, behavior TEXT,
  sex_state TEXT, arousal INTEGER, fatigue INTEGER, companion_role TEXT,
  outfit_top TEXT, outfit_bottom TEXT, outfit_bra TEXT, outfit_underwear TEXT,
  sexual_items TEXT,
  oral_today INTEGER, oral_total INTEGER, vaginal_today INTEGER, vaginal_total INTEGER,
  anal_today INTEGER, anal_total INTEGER, last_daily_reset TEXT
)`)
const liveToday = todayStamp(new Date())
db.prepare(`INSERT INTO soul_state (id, scene, truth, position, body_state, behavior, arousal,
  outfit_top, outfit_bottom, outfit_bra, outfit_underwear,
  oral_today, oral_total, vaginal_today, vaginal_total, anal_today, anal_total, last_daily_reset)
  VALUES (1, '公司下午的开放工位', '午餐时把避孕套塞进西装口袋', '坐在工位上双腿交叠', '内裤已经透了',
  '假装看需求文档', 62, '白衬衫', '包臀裙', '蕾丝内衣', '蕾丝内裤', 1, 12, 0, 8, 0, 3, ?)`)
  .run(liveToday)
db.close()

/** 写 state 文件(开关矩阵用)。 */
const writeSettings = (autoinject) => {
  mkdirSync(dirname(home.statePath), { recursive: true })
  writeFileSync(home.statePath, JSON.stringify({
    presets: {},
    data: { dbPath, autoinject },
    warn: {},
    mark: { enabled: true },
  }), 'utf8')
}

const { applyStateAutoinject } = await import('../lib/datas/state-autoinject.js')

/** 造一个假 ctx:收集挂点,提供驱动器。 */
function makeCtx() {
  const handlers = new Map()
  const ctx = { on: (event, handler) => { handlers.set(event, handler) } }
  return {
    ctx,
    handlers,
    toolResult: (name, session) => handlers.get('tools/result')({ name, agent: { session } }, { isError: false }),
    preStep: async (turn, session) => handlers.get('agent/pre-step')(
      { agent: { session }, turn },
      async () => ({ kind: 'enter', messages: [] }),
    ),
    compaction: (session, type = 'compaction/summary') => handlers.get('session/event')(session, { type }),
  }
}

const session = { id: 'sess-1' }

// 1. 工具后注入:调一次 query → 下一步尾部出现短条
writeSettings({ rounds: true, every: 8, afterTool: true })
const a = makeCtx()
applyStateAutoinject(a.ctx, dbPath)
a.toolResult('roroko_datas_query', session)
const step1 = await a.preStep(1, session)
eq(step1.messages.length, 1, '★ 机制:调过 query 后本步尾部追加一条')
ok(String(step1.messages[0].content[0].text).startsWith('###下方内容由脚本自动注入###'),
  '机制:注入文本带壳')
eq(step1.messages[0].source, { kind: 'plugin', plugin: 'roroko-data' }, '机制:来源签名是插件消息')
ok(String(step1.messages[0].content[0].text).includes('scene=公司下午的开放工位'), '机制:短条取自真库')

// 2. 同回合第二次 pre-step:闸门挡住
const step1b = await a.preStep(1, session)
eq(step1b.messages.length, 0, '★ 机制:同一回合的第二个 step 不再注入')

// 3. 别的工具不算数(轮数关掉,隔离出"工具后"这一条路)
writeSettings({ rounds: false, every: 8, afterTool: true })
const b = makeCtx()
applyStateAutoinject(b.ctx, dbPath)
b.toolResult('memory', session)
const step2 = await b.preStep(2, session)
eq(step2.messages.length, 0, '机制:非 roroko_datas_* 的调用不触发')

// 4. 只开轮数:闲着到第 8 轮才注
writeSettings({ rounds: true, every: 8, afterTool: false })
const c = makeCtx()
applyStateAutoinject(c.ctx, dbPath)
eq((await c.preStep(1, session)).messages.length, 1, '机制:首轮(从未注过)先注一条')
eq((await c.preStep(5, session)).messages.length, 0, '机制:第 5 轮未到期')
eq((await c.preStep(9, session)).messages.length, 1, '★ 机制:第 9 轮(距上次 8)到期注入')

// 5. 两个开关全关:一条不注
writeSettings({ rounds: false, every: 8, afterTool: false })
const d = makeCtx()
applyStateAutoinject(d.ctx, dbPath)
d.toolResult('roroko_datas_query', session)
eq((await d.preStep(30, session)).messages.length, 0, '★ 机制:开关全关 → 一条不注')

// 6. 压缩释放:重置后立刻注,不用干等 8 轮
writeSettings({ rounds: true, every: 8, afterTool: false })
const e = makeCtx()
applyStateAutoinject(e.ctx, dbPath)
eq((await e.preStep(1, session)).messages.length, 1, '机制:压缩场景前置(首轮注入)')
eq((await e.preStep(3, session)).messages.length, 0, '机制:压缩前未到期')
e.compaction(session)
eq((await e.preStep(4, session)).messages.length, 1, '★ 机制:压缩后下一次 pre-step 立刻重注')

// 7. 库不可达:静默跳过,不抛
writeSettings({ rounds: true, every: 8, afterTool: true })
const f = makeCtx()
applyStateAutoinject(f.ctx, join(home.dir, 'nope', 'missing.db'))
f.toolResult('roroko_datas_query', session)
const stepF = await f.preStep(1, session)
eq(stepF.messages.length, 0, '★ 机制:库打不开 → 不注入')
eq(stepF.kind, 'enter', '★ 机制:库打不开也不破坏 decision(绝不 throw)')

// 8. 子代理隔离:另一个 session 的调用不污染主会话
writeSettings({ rounds: false, every: 8, afterTool: true })
const g = makeCtx()
applyStateAutoinject(g.ctx, dbPath)
const sub = { id: 'subagent-sess' }
g.toolResult('roroko_datas_query', sub)
eq((await g.preStep(7, session)).messages.length, 0,
  '★ 机制:子代理取料不会让主会话冒短条(计数按 session 隔离)')

home.cleanup()
process.exit(done('datas-autoinject') === 0 ? 0 : 1)
