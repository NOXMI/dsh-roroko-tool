/**
 * dream 机制测试:队列口径 / 任务书 / 配置归一化 / 门禁 / 一次完整执行序 / 定时器。
 *
 * 本套件**零替身**:执行序不 import 任何 DSH 运行时值 —— 载体(起会话)是**注入**的
 * 假函数,所以这里跑的是"机制本身"。会话载体那层另见 memory-dream-session.mjs。
 *
 * 2026-09-21 会话化后:模型不再回 JSON,而是自己调工具改库 —— 于是本套件的
 * 假 runSession 直接在库里模拟它的动作,门禁仍按"reflected_at 真落下去没"判。
 */
import { makeAsserts } from './helpers/harness.mjs'
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { ok, eq, done } = makeAsserts()

const form = await import('../lib/memory-dream-form.js')
const dream = await import('../lib/memory-dream.js')
const store = await import('../lib/memory-store.js')

const mkRow = (id, kind, reflected_at, created_at = '2026-09-20 10:00:00', content = '正文') => ({
  id, owner: 'dev', content, summary: 's', created_at, reflected_at, kind, source: null,
})

// ── 一、队列口径 ────────────────────────────────────────────────────────────
const rows = [
  mkRow(1, 'log', null, '2026-09-20 08:00:00'),
  mkRow(2, 'event', null, '2026-09-20 09:00:00'),
  mkRow(3, 'thread', '2026-09-20 10:00:00'),
  mkRow(4, 'reflection', null, '2026-09-20 11:00:00'),
]
const queue = form.pickQueue(rows, 20)
eq(queue.entries.map(row => row.id), [2, 4], '排除已反思的与 kind=log 的')
eq(queue.skippedLogs, 1, '跳过的日志单独计数')
eq(form.pickQueue(rows, 1).entries.map(row => row.id), [2], 'limit 截断')
eq(form.pickQueue([], 20), { entries: [], skippedLogs: 0 }, '空库出空队列')
eq(form.pickQueue([mkRow(5, 'log', null)], 20).entries, [], '只有日志时队列为空')
eq(form.pickQueue([mkRow(6, 'LOG', null)], 20).entries, [], '★ kind 大写 LOG 也认(比较时统一小写)')

// ── 二、任务书(只给清单,正文让它自己取) ──────────────────────────────────
const longSummary = `${'甲'.repeat(200)}`
const task = form.buildDreamTask([
  mkRow(2, 'event', null, '2026-09-20 09:00:00', '这条正文很长'.repeat(50)),
  { ...mkRow(3, null, null, '2026-09-20 11:00:00'), summary: longSummary, kind: null },
])
ok(task.includes('记忆整理模式'), '★ 第一句就是"记忆整理模式"声明(它得知道现在不是对话/开发)')
ok(task.includes('不要动工作区文件'), '声明里划了边界:不动文件 / 不开 shell / 不上网')
ok(task.includes('roroko_mem_id'), '告诉它先用 mem_id 取全文')
ok(task.includes('roroko_mem_edit'), '告诉它用 mem_edit 改回去')
ok(task.includes('不要抹平'), '写明矛盾不抹平(保留矛盾铁律)')
ok(task.includes('一条都不改也是正常结果'), '允许它什么都不改')
ok(task.includes('#2 · 2026-09-20 09:00:00 · event'), '★ 清单行 = id · 时间 · 类别 · 摘要')
ok(!task.includes('这条正文很长'), '★ 清单里**不带正文**(只给摘要预览,正文要它自己取)')
ok(task.includes('…'), '超长摘要截断加省略号')
ok(task.includes(`共 2 条`), '清单头部报总数')
eq(form.DREAM_PREVIEW_MAX, 120, '摘要预览上限 120 字')
eq(form.DREAM_DEFAULT_BATCH, 20, '批量 20(照抄 nanobot)')
eq(form.DREAM_DEFAULT_INTERVAL_MS, 4 * 60 * 60 * 1000, '默认间隔 4 小时(照抄 nanobot)')

// ── 三、配置归一化(★ 空串必须回落默认,不是夹到下限) ────────────────────
const cfgEmpty = form.normalizeDreamConfig({})
eq(cfgEmpty.intervalMs, 4 * 60 * 60 * 1000, '★ 未给 intervalMs → 默认 4 小时(不是下限 5 分钟)')
eq(cfgEmpty.batch, 20, '★ 未给 batch → 默认 20(不是下限 1)')
eq(cfgEmpty.preset, '', '★ preset 缺省空串 = 用部署默认 preset')
eq(cfgEmpty.cwd, '', '★ cwd 缺省空串 = 用进程 cwd')
eq('maxTokens' in cfgEmpty, false, '配置里不再有 maxTokens(会话侧用内置常量)')
eq(form.normalizeDreamConfig(undefined).intervalMs, 4 * 60 * 60 * 1000, 'undefined 配置 → 全默认')
eq(form.normalizeDreamConfig({ intervalMs: '7200000' }).intervalMs, 7200000, '字符串数字也认')
eq(form.normalizeDreamConfig({ intervalMs: '' }).intervalMs, 4 * 60 * 60 * 1000, '空串 → 默认')
eq(form.normalizeDreamConfig({ intervalMs: 1 }).intervalMs, 300000, '过小值夹到下限')
eq(form.normalizeDreamConfig({ intervalMs: 99 * 60 * 60 * 1000 }).intervalMs, 24 * 60 * 60 * 1000, '过大值夹到上限')
eq(form.normalizeDreamConfig({ batch: 999 }).batch, 50, '批量夹到上限')
eq(form.normalizeDreamConfig({ provider: ' deepseek ' }).provider, 'deepseek', 'provider 去空白')
eq(form.normalizeDreamConfig({ preset: ' roroko-server ' }).preset, 'roroko-server', '★ preset 去空白')
eq(form.normalizeDreamConfig({ cwd: ' /root/roroko-workspace ' }).cwd, '/root/roroko-workspace', '★ cwd 去空白')
eq(form.normalizeDreamConfig({ enabled: false }).enabled, false, 'enabled 照收')
eq(form.DREAM_DEFAULT_MAX_TOKENS, 8192, '★ 会话侧 maxTokens 常量 8192(推理模型够用,2048 会被 thinking 吃满)')

// ── 四、门禁判定(只认库的真 diff) ──────────────────────────────────────────
const gBefore = [mkRow(1, 'event', null), mkRow(2, 'event', null)]
eq(
  form.diffReflected(gBefore, [{ ...mkRow(1, 'event', '2026-09-20 15:00:00') }, mkRow(2, 'event', null)]),
  [1],
  '只有真落了 reflected_at 的才算变更',
)
eq(form.diffReflected(gBefore, gBefore), [], '一模一样 → 没有变更(队列不推进)')
eq(form.diffReflected(gBefore, []), [], '回读丢了行 → 不算变更')

// ── 五、一次完整执行序(真库 + 假会话) ─────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'roroko-dream-'))
const dbPath = join(dir, 'nested', 'roroko_memory.db')
const t = new Date('2026-09-20T03:00:00Z') // CST 11:00

const seed = store.openMemoryDb(dbPath)
store.runAdd(seed, { owner: 'dev', content: '待反思的一条', summary: 'S1', kind: 'event', source: '' }, t)
store.runAdd(seed, { owner: 'dev', content: '日志条', summary: 'S2', kind: 'log', source: '' }, t)
store.runAdd(seed, { owner: 'dev', content: '已反思的', summary: 'S3', kind: 'event', source: '' }, t)
store.runAdd(seed, { owner: 'persona', content: '别桶的', summary: 'S4', kind: 'event', source: '' }, t)
seed.prepare("UPDATE memory SET reflected_at = '2026-09-20 12:00:00' WHERE id = 3").run()
seed.close()

let sessionCalls = 0
let lastPrompt = ''
let lastBookmark = ''
const deps = over => ({
  dbPath,
  owner: 'dev',
  provider: 'deepseek',
  model: 'deepseek-chat',
  batch: 20,
  logDir: join(dir, 'dream-log'),
  now: () => t,
  runSession: async (prompt, bookmark) => {
    sessionCalls++
    lastPrompt = prompt
    lastBookmark = bookmark
    return { sessionId: 'dream-test-1', preset: 'roroko-server' }
  },
  ...over,
})

// ① 未配模型:跳过,且一次都不起会话
sessionCalls = 0
const noModel = await dream.runDreamOnce(deps({ provider: '' }))
ok(noModel.note.includes('未配置模型'), '未配 provider → 跳过')
eq(sessionCalls, 0, '未配模型时**不起会话**(不烧 token)')

// ② 会话抛错:吞掉,当结果返回,队列纹丝不动
sessionCalls = 0
const boom = await dream.runDreamOnce(deps({ runSession: async () => { sessionCalls++; throw new Error('会话炸了') } }))
eq(sessionCalls, 1, '起了一次会话')
ok(boom.note.includes('会话执行失败'), '会话抛错被收成 note')
ok(boom.error !== undefined, 'error 字段有值')
eq(boom.changed, [], '抛错时零落库')
eq(
  store.openMemoryDb(dbPath).prepare('SELECT reflected_at FROM memory WHERE id = 1').get().reflected_at,
  null,
  '抛错时队列纹丝不动',
)

// ③ 正常一次:会话自己在库里改 → 门禁认它
sessionCalls = 0
const good = await dream.runDreamOnce(deps({
  runSession: async (prompt, bookmark) => {
    sessionCalls++
    lastPrompt = prompt
    lastBookmark = bookmark
    const db = store.openMemoryDb(dbPath)
    store.runReflect(db, { id: 1, content: '收过的正文', summary: '收过的摘要' }, t)
    db.close()
    return { sessionId: 'dream-20260920-110000', preset: 'roroko-server' }
  },
}))
eq(sessionCalls, 1, '起了一次会话')
eq(good.queued, 1, '队列里只有 dev 那条 event(日志与已反思的都不在内)')
eq(good.skippedLogs, 1, '日志被跳过')
eq(good.changed, [1], '门禁:真落库的只有 #1')
eq(good.sessionId, 'dream-20260920-110000', '★ 回执带会话 id')
eq(good.preset, 'roroko-server', '★ 回执带挂上的 preset')
eq(good.added, 0, '它没有自己 add')
ok(good.note.includes('反思 1 条'), '结论一句话')
ok(good.auditPath !== undefined, '审计落盘')
ok(existsSync(good.auditPath), '审计文件真存在')
ok(readFileSync(good.auditPath, 'utf8').includes('会话: dream-20260920-110000'), '★ 审计记了会话 id')
ok(readFileSync(good.auditPath, 'utf8').includes('preset=roroko-server'), '★ 审计记了 preset')
eq(readdirSync(join(dir, 'dream-log')).length, 1, '审计目录里一个文件')
ok(lastPrompt.includes('记忆整理模式'), '★ 投进去的就是那份任务书')
ok(lastBookmark.startsWith('2026-'), '★ 会话 id 用 CST 时间当书签')

const check = store.openMemoryDb(dbPath)
eq(check.prepare('SELECT content FROM memory WHERE id = 1').get().content, '收过的正文', 'content 被整条覆盖')
eq(check.prepare('SELECT summary FROM memory WHERE id = 1').get().summary, '收过的摘要', 'summary 一起换')
eq(check.prepare('SELECT reflected_at FROM memory WHERE id = 1').get().reflected_at, '2026-09-20 11:00:00', 'reflected_at 落成 CST')
eq(check.prepare('SELECT reflected_at FROM memory WHERE id = 2').get().reflected_at, null, '日志条一根毫毛没动')
eq(check.prepare('SELECT reflected_at FROM memory WHERE id = 4').get().reflected_at, null, '别桶的也没动(不跨桶)')
check.close()

// ④ 队列空(只剩日志):明说没有可整理的内容,且不起会话
sessionCalls = 0
const empty = await dream.runDreamOnce(deps())
eq(sessionCalls, 0, '队列空 → 不起会话')
ok(empty.note.includes('没有可整理的内容'), '明说没有可整理的内容')
ok(empty.note.includes('日志'), '并说明只剩日志')

// ⑤ 会话什么都没改:干净完成但没有变更
const seed2 = store.openMemoryDb(dbPath)
store.runAdd(seed2, { owner: 'dev', content: '再来一条', summary: 'S5', kind: 'event', source: '' }, t)
seed2.close()
const noChange = await dream.runDreamOnce(deps())
eq(noChange.changed, [], '会话没动库 → 没有变更')
ok(noChange.note.includes('没有记忆变更'), '干净完成但无变更要明说')

// ⑥ 它自己 add 了一条(保留矛盾那条通道)→ added 记上
sessionCalls = 0
const added = await dream.runDreamOnce(deps({
  runSession: async () => {
    sessionCalls++
    const db = store.openMemoryDb(dbPath)
    store.runAdd(db, { owner: 'dev', content: '它自己另记的一条', summary: 'S6', kind: 'event', source: '' }, t)
    db.close()
    return { sessionId: 'dream-x', preset: '' }
  },
}))
eq(added.added, 1, '★ 会话自己 add 了一条 → added=1')
eq(added.preset, '', '★ 没挂 preset 时回执如实说明')
ok(added.note.includes('没有记忆变更'), '它只是 add、没 reflect → 门禁仍然说没有反思变更')

// ── 六、分段定时器 ─────────────────────────────────────────────────────────
let nowMs = 0
const nowFn = () => new Date(nowMs)
let tickFn
let runs = 0
const errors = []
dream.startDreamTimer({
  intervalMs: 1000,
  startupDelayMs: 0,
  now: nowFn,
  run: async () => { runs++ },
  onError: error => errors.push(error),
  setIntervalFn: fn => { tickFn = fn; return {} },
  clearIntervalFn: () => {},
})
tickFn()
await new Promise(resolve => setTimeout(resolve, 0))
eq(runs, 1, '到点跑一次')
tickFn()
await new Promise(resolve => setTimeout(resolve, 0))
eq(runs, 1, '没到点不跑(分段醒来自查墙钟)')
nowMs = 5000
tickFn()
await new Promise(resolve => setTimeout(resolve, 0))
eq(runs, 2, '过了一个间隔再跑')

let tickFn2
dream.startDreamTimer({
  intervalMs: 1000,
  startupDelayMs: 0,
  now: nowFn,
  run: async () => { throw new Error('整理炸了') },
  onError: error => errors.push(error),
  setIntervalFn: fn => { tickFn2 = fn; return {} },
  clearIntervalFn: () => {},
})
nowMs = 60000
tickFn2()
await new Promise(resolve => setTimeout(resolve, 0))
eq(errors.length, 1, '异常被 onError 收住,定时器不死')
eq(form.DREAM_TICK_MS, 60 * 60 * 1000, '分段长度 1 小时')
eq(form.DREAM_SKIP_KINDS.includes('log'), true, '日志在跳过清单里')
eq(dream.defaultDreamLogDir('/a/b/mem.db').endsWith(['dream', 'log'].join('-')), true, '审计目录默认落在库旁边')

// 进程级去重:插件按 preset/会话装配,apply 可能被调多次 —— 同一个库只许起一份定时器
eq(dream.claimDreamStart('/tmp/lib-a.db'), true, '首次认领启动权成功')
eq(dream.claimDreamStart('/tmp/lib-a.db'), false, '同一个库第二次认领被拒(不重复起定时器)')
eq(dream.claimDreamStart('/tmp/lib-b.db'), true, '不同库各自认领互不影响')

// ── 七、渲染 ────────────────────────────────────────────────────────────────
const outcomeText = form.renderDreamOutcome({
  queued: 3, skippedLogs: 85, sessionId: 'dream-1', preset: 'roroko-server', added: 1,
  changed: [7, 9], note: '完成,反思 2 条',
})
ok(outcomeText.includes('队列 3 条'), '回执带队列数')
ok(outcomeText.includes('跳过日志 85 条'), '回执带跳过数')
ok(outcomeText.includes('真反思 2 条'), '★ 回执带真反思条数')
ok(outcomeText.includes('自记 1 条'), '★ 回执带它自己记了几条')
ok(outcomeText.includes('dream-1'), '★ 回执带会话 id')
ok(outcomeText.includes('#7 #9'), '回执列出已反思的 id')

const audit = form.renderDreamAudit({
  at: '2026-09-20 15:30:00',
  provider: 'deepseek',
  model: 'deepseek-chat',
  sessionId: 'dream-2',
  preset: 'roroko-server',
  queued: 2,
  skippedLogs: 85,
  added: 0,
  changed: [1],
  before: [mkRow(1, 'event', null, '2026-09-20 09:00:00', '甲甲甲甲')],
  after: [{ ...mkRow(1, 'event', '2026-09-20 15:30:00', '2026-09-20 09:00:00', '乙') }],
})
ok(audit.includes('dream 2026-09-20 15:30:00 CST'), '审计带时间')
ok(audit.includes('| 1 | 4 → 1 |'), '审计只记字数 diff(不记模型自述)')
ok(audit.includes('preset=roroko-server'), '审计带 preset')

const auditNoSession = form.renderDreamAudit({
  at: 't', provider: 'p', model: 'm', sessionId: '', preset: '',
  queued: 0, skippedLogs: 0, added: 0, changed: [], before: [], after: [],
  error: '会话执行失败: xxx',
})
ok(auditNoSession.includes('会话: (未起)'), '★ 没起会话时审计如实写"未起"')
ok(auditNoSession.includes('error:'), '错误也落进审计(不静默)')

try {
  rmSync(dir, { recursive: true, force: true })
} catch {
  // Windows 句柄偶发未释放;临时目录留着无妨
}

process.exit(done('记忆 dream') === 0 ? 0 : 1)
