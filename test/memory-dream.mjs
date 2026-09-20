/**
 * 记忆 dream 测试:队列口径 / prompt 组装 / 回复解析 / 门禁判定 / 一次完整执行序 /
 * 分段定时器。零依赖,直读 lib/ 产物:node test/memory-dream.mjs
 *
 * 机制层(`memory-dream.js`)**不 import DSH 运行时值** —— 模型调用是注入的
 * (`deps.callModel`),所以整套执行序能用假模型真跑真库,不需要替身钩子。
 *
 * 重点是两件"不许放松"的事:
 *   ① 队列空 / 未配模型 → **一次都不许调模型**(不烧 token)
 *   ② 模型没给出可落地的改写 → **队列不推进**(照抄 nanobot 的 diff 门禁)
 */
import { makeAsserts } from './helpers/harness.mjs'
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { ok, eq, done } = makeAsserts()

const dream = await import('../lib/memory-dream.js')
const form = await import('../lib/memory-dream-form.js')
const store = await import('../lib/memory-store.js')

const mkRow = (id, kind, reflected_at, created_at = '2026-09-20 10:00:00', content = '正文') => ({
  id, owner: 'dev', content, summary: 's', created_at, reflected_at, recalled: 0, kind, source: null,
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

// ── 二、prompt 组装 ─────────────────────────────────────────────────────────
const long = mkRow(2, 'event', null, '2026-09-20 09:00:00', '甲'.repeat(400))
const prompt = form.buildDreamPrompt([long])
ok(prompt.includes('[#2]'), 'prompt 带 id')
ok(prompt.includes('…(截断)'), '超长条目带截断标记')
ok(!prompt.includes('甲'.repeat(350)), '截断真的截到 300 字以内')
ok(prompt.includes('整条覆盖'), '写明覆盖语义(不是追加)')
ok(prompt.includes('不要抹平'), '写明矛盾不抹平(保留矛盾铁律)')
ok(prompt.includes('JSON 数组'), '要求 JSON 数组')
ok(prompt.includes('不要合并条目'), '禁止合并/新增')
eq(form.DREAM_ENTRY_MAX, 300, '单条截断 300(照抄 nanobot)')
eq(form.DREAM_DEFAULT_BATCH, 20, '批量 20(照抄 nanobot)')
eq(form.DREAM_DEFAULT_INTERVAL_MS, 4 * 60 * 60 * 1000, '默认间隔 4 小时(照抄 nanobot)')

// ── 三、回复解析 ────────────────────────────────────────────────────────────
eq(
  form.parseDreamReply('[{"id":2,"content":"新正文","summary":"新摘要"}]', [2]).edits,
  [{ id: 2, content: '新正文', summary: '新摘要' }],
  '正常 JSON 数组',
)
eq(form.parseDreamReply('```json\n[{"id":2,"content":"c","summary":"s"}]\n```', [2]).edits.length, 1, 'markdown 代码围栏也能剥')
eq(form.parseDreamReply('好的,结果如下:\n[{"id":2,"content":"c"}]\n以上。', [2]).edits.length, 1, '前后废话容忍')
eq(form.parseDreamReply('[{"id":99,"content":"c"}]', [2]).edits, [], '越界 id 丢掉单条')
eq(form.parseDreamReply(`[{"id":2,"content":"${'x'.repeat(2001)}"}]`, [2]).edits, [], '超长正文丢掉单条')
eq(form.parseDreamReply('[]', [2]).edits, [], '空数组是合法回答')
eq(form.parseDreamReply('[{"id":2,"content":"c"}]', [2]).edits[0].summary, '', 'summary 缺省为空串')
eq(form.parseDreamReply('[{"id":"2","content":"c"}]', [2]).edits[0].id, 2, 'id 收字符串数字')
ok(form.parseDreamReply('我整理好了,没什么要改的', [2]).error !== undefined, '没有 JSON → error')
ok(form.parseDreamReply('[坏]', [2]).error !== undefined, '坏 JSON → error')
ok(form.parseDreamReply('{"id":2,"content":"c"}', [2]).error !== undefined, '顶层不是数组 → error')

// ── 四、门禁判定(只认库的真 diff) ──────────────────────────────────────────
const gBefore = [mkRow(1, 'event', null), mkRow(2, 'event', null)]
eq(
  form.diffReflected(gBefore, [{ ...mkRow(1, 'event', '2026-09-20 15:00:00') }, mkRow(2, 'event', null)]),
  [1],
  '只有真落了 reflected_at 的才算变更',
)
eq(form.diffReflected(gBefore, gBefore), [], '一模一样 → 没有变更(队列不推进)')
eq(form.diffReflected(gBefore, []), [], '回读丢了行 → 不算变更')

// ── 五、一次完整执行序(真库 + 假模型) ─────────────────────────────────────
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

let calls = 0
const deps = over => ({
  dbPath,
  owner: 'dev',
  provider: 'deepseek',
  model: 'deepseek-chat',
  batch: 20,
  maxTokens: 1024,
  logDir: join(dir, 'dream-log'),
  now: () => t,
  callModel: async () => {
    calls++
    return '[{"id":1,"content":"收过的正文","summary":"收过的摘要"}]'
  },
  ...over,
})

// ① 未配模型:跳过,且一次都不调
calls = 0
const noModel = await dream.runDreamOnce(deps({ provider: '' }))
ok(noModel.note.includes('未配置模型'), '未配 provider → 跳过')
eq(calls, 0, '未配模型时**不调模型**(不烧 token)')

// ② 模型回废话:算失败,队列不推进
calls = 0
const bad = await dream.runDreamOnce(deps({ callModel: async () => { calls++; return '我整理好了' } }))
eq(calls, 1, '调了一次')
ok(bad.note.includes('回复不可用'), '解析失败要明说')
eq(bad.changed, [], '解析失败 → 零落库')
eq(
  store.openMemoryDb(dbPath).prepare('SELECT reflected_at FROM memory WHERE id = 1').get().reflected_at,
  null,
  '解析失败时队列纹丝不动',
)

// ③ 模型抛错:吞掉,当结果返回
const boom = await dream.runDreamOnce(deps({ callModel: async () => { throw new Error('网络炸了') } }))
ok(boom.note.includes('模型调用失败'), '模型抛错被收成 note')
ok(boom.error !== undefined, 'error 字段有值')
eq(boom.changed, [], '抛错时零落库')

// ④ 正常一次:写库 + 门禁判定
calls = 0
const good = await dream.runDreamOnce(deps())
eq(calls, 1, '调了一次模型')
eq(good.queued, 1, '队列里只有 dev 那条 event(日志与已反思的都不在内)')
eq(good.skippedLogs, 1, '日志被跳过')
eq(good.changed, [1], '门禁:真落库的只有 #1')
ok(good.note.includes('反思 1 条'), '结论一句话')
ok(good.auditPath !== undefined, '审计落盘')
ok(existsSync(good.auditPath), '审计文件真存在')
eq(readdirSync(join(dir, 'dream-log')).length, 1, '审计目录里一个文件')

const check = store.openMemoryDb(dbPath)
eq(check.prepare('SELECT content FROM memory WHERE id = 1').get().content, '收过的正文', 'content 被整条覆盖')
eq(check.prepare('SELECT summary FROM memory WHERE id = 1').get().summary, '收过的摘要', 'summary 一起换')
eq(check.prepare('SELECT reflected_at FROM memory WHERE id = 1').get().reflected_at, '2026-09-20 11:00:00', 'reflected_at 落成 CST')
eq(check.prepare('SELECT reflected_at FROM memory WHERE id = 2').get().reflected_at, null, '日志条一根毫毛没动')
eq(check.prepare('SELECT reflected_at FROM memory WHERE id = 4').get().reflected_at, null, '别桶的也没动(不跨桶)')
check.close()

// ⑤ 队列只剩日志:明说没有可整理的内容,且不调模型
calls = 0
const empty = await dream.runDreamOnce(deps())
eq(calls, 0, '队列空 → 不调模型')
ok(empty.note.includes('没有可整理的内容'), '明说没有可整理的内容')
ok(empty.note.includes('日志'), '并说明只剩日志')

// ⑥ 模型回空数组:干净完成但没有变更,队列不推进
const seed2 = store.openMemoryDb(dbPath)
store.runAdd(seed2, { owner: 'dev', content: '再来一条', summary: 'S5', kind: 'event', source: '' }, t)
seed2.close()
const noChange = await dream.runDreamOnce(deps({ callModel: async () => { calls++; return '[]' } }))
eq(noChange.proposed, 0, '模型没给改写')
eq(noChange.changed, [], '没有变更')
ok(noChange.note.includes('没有记忆变更'), '干净完成但无变更要明说')

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

// ── 七、渲染 ────────────────────────────────────────────────────────────────
const outcomeText = form.renderDreamOutcome({ queued: 3, skippedLogs: 85, proposed: 2, changed: [7, 9], note: '完成,反思 2 条' })
ok(outcomeText.includes('队列 3 条'), '回执带队列数')
ok(outcomeText.includes('跳过日志 85 条'), '回执带跳过数')
ok(outcomeText.includes('#7 #9'), '回执列出已反思的 id')

const audit = form.renderDreamAudit({
  at: '2026-09-20 15:30:00',
  provider: 'deepseek',
  model: 'deepseek-chat',
  queued: 2,
  skippedLogs: 85,
  proposed: 1,
  changed: [1],
  before: [mkRow(1, 'event', null, '2026-09-20 09:00:00', '甲甲甲甲')],
  after: [{ ...mkRow(1, 'event', '2026-09-20 15:30:00', '2026-09-20 09:00:00', '乙') }],
})
ok(audit.includes('dream 2026-09-20 15:30:00 CST'), '审计带时间')
ok(audit.includes('| 1 | 4 → 1 |'), '审计只记字数 diff(不记模型自述)')

try {
  rmSync(dir, { recursive: true, force: true })
} catch {
  // Windows 句柄偶发未释放;临时目录留着无妨
}

process.exit(done('记忆 dream') === 0 ? 0 : 1)
