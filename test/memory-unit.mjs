/**
 * memory-form / memory-store 测试:CST 时间口径 / 日期区间 / 入参收窄 / 渲染 /
 * 真 sqlite 往返。零依赖,直读 lib/ 产物:node test/memory-unit.mjs
 *
 * 时间口径是本套件的重点:库里的 created_at 一律 CST+0800,而跑测试的机器时区
 * (以及服务器时区)都不可控 —— 所以用例全部用带 Z 的**绝对时刻**,验的是"东八区
 * 那面钟",不是本机本地钟。
 *
 * memory.js(工具注册那层)要 DSH 运行时包才能 import,不在本套件覆盖范围内;
 * 本套件只打 form + store,所以**不需要替身钩子**。
 */
import { makeAsserts } from './helpers/harness.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { ok, eq, done } = makeAsserts()

const form = await import('../lib/memory-form.js')
const store = await import('../lib/memory-store.js')

// ── 一、CST 时间口径 ────────────────────────────────────────────────────────
// 本机是 +08:00 照样要这么测:东八区口径不能靠"机器恰好对"

eq(form.fmtCst(new Date('2026-09-17T16:30:00Z')), '2026-09-18 00:30:00', 'UTC 16:30 → CST 次日 00:30(跨日)')
eq(form.fmtCst(new Date('2026-09-17T15:59:59Z')), '2026-09-17 23:59:59', 'UTC 15:59:59 → CST 23:59:59(同日边界)')
eq(form.fmtCst(new Date('2026-01-01T00:00:00Z')), '2026-01-01 08:00:00', '跨年不串月日')
eq(form.cstDate(new Date('2026-09-17T16:00:00Z')), '2026-09-18', 'CST 日界:UTC 16:00 已是次日')
eq(form.cstDate(new Date('2026-09-17T15:59:00Z')), '2026-09-17', 'CST 日界前仍是当日')

// ── 二、日期算术(纯 UTC 天数运算) ─────────────────────────────────────────
eq(form.shiftDate('2026-09-01', -1), '2026-08-31', '往前跨月')
eq(form.shiftDate('2026-01-01', -1), '2025-12-31', '往前跨年')
eq(form.shiftDate('2028-03-01', -1), '2028-02-29', '闰年 2/29')
eq(form.shiftDate('2026-09-18', 1), '2026-09-19', '往后一天')

// ── 三、日期输入校验 ────────────────────────────────────────────────────────
ok(form.isDateStr('2026-02-28'), '正常日期通过')
ok(!form.isDateStr('2026-02-30'), '挡"格式对但不存在"的日期')
ok(!form.isDateStr('2026-9-1'), '挡未补零写法')
ok(!form.isDateStr(20260918), '挡非字符串')
eq(form.normalizeDateInput('2026-09-18 11:30'), '2026-09-18', '带时间的串取日期部分')
eq(form.normalizeDateInput('2026-09-18T03:00:00Z'), '2026-09-18', 'ISO 串取日期部分')
eq(form.normalizeDateInput('9/18'), undefined, '斜杠写法不认')
eq(form.normalizeDateInput('   '), undefined, '空白不算日期')

// ── 四、区间解析 ────────────────────────────────────────────────────────────
const nowNoon = new Date('2026-09-18T03:00:00Z')      // CST 09-18 11:00
const nowMidnight = new Date('2026-09-17T16:00:00Z')  // CST 09-18 00:00

eq(form.resolveRange(undefined, undefined, nowNoon).range, { from: '2026-09-17', to: '2026-09-18' }, '默认 = 今天 + 昨天')
eq(form.resolveRange('', '', nowMidnight).range, { from: '2026-09-17', to: '2026-09-18' }, 'CST 日界上的默认区间不跟 UTC 走')
eq(form.resolveRange('2026-09-10', undefined, nowNoon).range, { from: '2026-09-10', to: '2026-09-18' }, '只给 from → 到今天')
eq(form.resolveRange(undefined, '2026-09-05', nowNoon).range, { from: '2026-09-05', to: '2026-09-05' }, '只给 to → 单日')
eq(form.resolveRange('2026-09-01', '2026-09-10', nowNoon).range, { from: '2026-09-01', to: '2026-09-10' }, '两端都给')
ok(form.resolveRange('2026-09-19', '2026-09-10', nowNoon).error !== undefined, 'from 晚于 to → 报错不自动交换')
ok(form.resolveRange('9/18', undefined, nowNoon).error !== undefined, '非法 from → 报错')
ok(form.resolveRange(undefined, '2026-02-30', nowNoon).error !== undefined, '非法 to → 报错')
eq(form.resolveRange('2026-09-25', undefined, nowNoon).range, { from: '2026-09-25', to: '2026-09-25' }, '未来 from 退化为单日,不拼反区间')

// ── 五、add 入参收窄 ────────────────────────────────────────────────────────
eq(
  form.normalizeAdd({ owner: 'dev', content: '  触发条件 → 应做  ', summary: ' 一句话 ', kind: 'reflection', source: ' sess#3 ' }).input,
  { owner: 'dev', content: '触发条件 → 应做', summary: '一句话', kind: 'reflection', source: 'sess#3' },
  '合法入参:字段逐个 trim',
)
eq(form.normalizeAdd({ owner: 'DEV', content: 'x', summary: 'y' }).input.owner, 'dev', 'owner 归一成小写')
ok(form.normalizeAdd({ content: 'x', summary: 'y' }).error !== undefined, 'owner 缺失 → 报错')
ok(form.normalizeAdd({ owner: '妈妈', content: 'x', summary: 'y' }).error !== undefined, 'owner 中文 → 挡下')
ok(form.normalizeAdd({ owner: 'dev te amo', content: 'x', summary: 'y' }).error !== undefined, 'owner 带空格 → 挡下')
ok(form.normalizeAdd({ owner: 'dev', content: '   ', summary: 'y' }).error !== undefined, 'content 空 → 报错')
ok(form.normalizeAdd({ owner: 'dev', content: 'x', summary: '  ' }).error !== undefined, 'summary 空 → 报错')
ok(form.normalizeAdd({ owner: 'dev', content: 'x'.repeat(form.MEMORY_CONTENT_MAX + 1), summary: 'y' }).error !== undefined, 'content 超长 → 报错(不静默截断)')
ok(form.normalizeAdd({ owner: 'dev', content: 'x', summary: 'y'.repeat(form.MEMORY_SUMMARY_MAX + 1) }).error !== undefined, 'summary 超长 → 报错')
eq(form.normalizeAdd({ owner: 'dev', content: 'x', summary: 'y' }).input.kind, '', 'kind 缺省为空串')
eq(form.normalizeAdd({ owner: 'dev', content: 'x', summary: 'y' }).input.source, '', 'source 缺省为空串')
eq(form.normalizeAdd({ owner: 'dev', content: 'x', summary: 'y', kind: 'k'.repeat(40) }).input.kind.length, form.MEMORY_KIND_MAX, 'kind 超长截到上限')

// ── 六、渲染 ────────────────────────────────────────────────────────────────
const rows = [
  { id: 2, owner: 'dev', summary: 'A|B', created_at: '2026-09-17 11:00:00', reflected_at: '2026-09-18 09:00:00', recalled: 3, kind: 'event' },
  { id: 3, owner: 'persona', summary: 'C', created_at: '2026-09-18 11:00:00', reflected_at: null, recalled: 0, kind: null },
]
const text = form.renderDate({ rows, range: { from: '2026-09-17', to: '2026-09-18' }, now: nowNoon })
ok(text.includes('2026-09-17 ~ 2026-09-18'), '表头带区间')
ok(text.includes('owner=(全部)'), '不传 owner = 全桶')
ok(text.includes('条数 2'), '统计条数')
ok(text.includes('未反思 1'), '统计未反思')
ok(text.includes('累计召回 3'), '统计召回')
ok(text.includes('| 2 | 09-17 11:00 | event | A/B |  |'), '摘要里的竖线换成斜杠,已反思不标旗')
ok(text.includes('| 3 | 09-18 11:00 |  | C | 未反思 |'), '空 kind 留白,未反思标旗')

const empty = form.renderDate({ rows: [], range: { from: '2026-09-01', to: '2026-09-02' }, owner: 'dev', now: nowNoon })
ok(empty.includes('该区间没有记忆'), '空区间明说"没有",不让模型脑补')
ok(empty.includes('owner=dev'), '空区间也带桶名')
ok(
  form.renderAddResult({ owner: 'dev', content: 'x', summary: 'S', kind: 'event', source: '' }, 7, '2026-09-18 11:00:00').includes('已记 #7 · 2026-09-18 11:00:00 CST'),
  '写入回执带 id 与 CST 时间',
)

// ── 七、DDL 与 pragma 常量 ─────────────────────────────────────────────────
eq(form.MEMORY_DDL.length, 3, '一条建表 + 两条索引')
ok(form.MEMORY_DDL[0].includes('CREATE TABLE IF NOT EXISTS memory'), '建表语句幂等')
ok(form.MEMORY_DDL[0].includes('reflected_at'), '反思时间列在位')
ok(form.MEMORY_DDL[0].includes('recalled'), '召回计数列在位')
ok(form.MEMORY_PRAGMAS.some(sql => sql.includes('journal_mode')), 'WAL 在 pragma 里')
ok(form.MEMORY_PRAGMAS.some(sql => sql.includes('busy_timeout')), 'busy_timeout 在 pragma 里')

// ── 八、真库往返 ───────────────────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'roroko-mem-'))
const dbPath = join(dir, 'nested', 'roroko_memory.db') // 故意多一层:验父目录自动补建
const db = store.openMemoryDb(dbPath)

try {
  const reopened = store.openMemoryDb(dbPath)
  reopened.close()
  ok(true, '重复开库幂等(建表语句可重复执行)')
} catch (error) {
  ok(false, `重复开库不该报错: ${String(error)}`)
}

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory'").all()
eq(tables.length, 1, 'memory 表已建')
const indexes = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_memory%' ORDER BY name")
  .all()
  .map(row => String(row.name))
eq(indexes, ['idx_memory_owner_date', 'idx_memory_reflected'], '两条索引在位')
eq(String(db.prepare('PRAGMA journal_mode').get().journal_mode), 'wal', 'WAL 已开')

const t1 = new Date('2026-09-10T03:00:00Z') // CST 09-10 11:00
const t2 = new Date('2026-09-17T03:00:00Z') // CST 09-17 11:00
const t3 = new Date('2026-09-18T03:00:00Z') // CST 09-18 11:00

const a1 = store.runAdd(db, { owner: 'dev', content: '十天前的一条', summary: '十天前', kind: 'log', source: '' }, t1)
const a2 = store.runAdd(db, { owner: 'dev', content: '昨天一条', summary: '昨天', kind: 'log', source: 'sess#1' }, t2)
const a3 = store.runAdd(db, { owner: 'persona', content: '今天一条', summary: '今天', kind: 'thread', source: '' }, t3)

eq([a1.id, a2.id, a3.id], [1, 2, 3], 'id 自增')
eq(a2.createdAt, '2026-09-17 11:00:00', 'created_at 是 CST 口径(不是 UTC)')
ok(a1.text.includes('已记 #1'), '回执带 id')

const stored = db
  .prepare('SELECT owner, content, summary, kind, source, reflected_at, recalled FROM memory WHERE id = 2')
  .get()
eq(
  { ...stored },
  { owner: 'dev', content: '昨天一条', summary: '昨天', kind: 'log', source: 'sess#1', reflected_at: null, recalled: 0 },
  '列值落对:source 有值、reflected_at 留 NULL、recalled 从 0 起',
)

const def = store.runDate(db, {}, t3)
ok(def.includes('条数 2'), '默认区间只捞昨天 + 今天')
ok(!def.includes('十天前'), '区间外的条不混进来')
ok(def.includes('未反思 2'), '新写的条默认都是未反思')

const dev = store.runDate(db, { owner: 'dev' }, t3)
ok(dev.includes('条数 1') && dev.includes('昨天'), 'owner 过滤生效')

const single = store.runDate(db, { from: '2026-09-10', to: '2026-09-10' }, t3)
ok(single.includes('十天前'), '单日区间能捞历史条')

const bad = store.runDate(db, { from: '2026-09-18', to: '2026-09-10' }, t3)
ok(bad.includes('区间非法'), '反区间返回人话错误,不抛')

const none = store.runDate(db, { to: '2026-09-11' }, t3)
ok(none.includes('该区间没有记忆'), '空区间明说没有')

// ── 九、bigram 与关键词切分 ─────────────────────────────────────────────────
eq(form.splitKeywords('记忆 召回'), ['记忆', '召回'], '空格切词')
eq(
  form.splitKeywords('记忆, 召回、bigram；x/y|z'),
  ['记忆', '召回', 'bigram', 'x', 'y', 'z'],
  '中英文逗号顿号分号斜杠竖线都能切',
)
eq(form.splitKeywords('a a b'), ['a', 'b'], '去重且保序')
eq(form.splitKeywords('Bigram'), ['bigram'], '转小写')
eq(form.splitKeywords('   '), [], '纯空白切不出词')
eq(form.splitKeywords(42), [], '非字符串 → 空数组')
eq(form.splitKeywords('w1 w2 w3 w4 w5 w6 w7 w8 w9').length, form.MEMORY_ROUGH_MAX_KEYWORDS, '超上限截断')
eq(form.splitKeywords('妈 记'), ['妈', '记'], '单字词留着,不走切词丢弃')

eq([...form.textGrams('测试')].sort(), ['测', '测试', '试'].sort(), '文本侧收单字 + 二元组')
eq([...form.textGrams('a-b')].sort(), ['a', 'ab', 'b'], '标点剔除后再取二元组(不产生 a- / -b)')
eq([...form.textGrams('')], [], '空串没有 gram')
eq([...form.queryGrams(['测试'])], ['测试'], '查询侧多字词只取二元组,不掺单字')
eq([...form.queryGrams(['记忆召回'])].sort(), ['忆召', '召回', '记忆'].sort(), '长词切相邻二元组')
eq([...form.queryGrams(['妈'])], ['妈'], '单字词退化成单字 gram')
eq([...form.queryGrams([' '])], [], '切不出字符的词贡献不了 gram')

// ── 十、打分 / 相关性下限 / 排序 ───────────────────────────────────────────
const mk = (id, summary, created_at, recalled = 0, content = '') => ({
  id, owner: 'dev', summary, content, created_at, reflected_at: null, recalled, kind: null,
})

// query '记忆 召回' → 2 个 gram:{记忆} {召回};命中其一即 cover 0.5 = 放行线下沿
const twoGram = form.scoreRough({
  rows: [
    mk(1, '记忆', '2026-09-18 10:00:00', 0),
    mk(2, '召回了旧的一笔', '2026-09-18 11:00:00', 0),
    mk(3, '记忆召回全中', '2026-09-18 09:00:00', 0),
    mk(4, '毫不相干', '2026-09-18 12:00:00', 0),
  ],
  keywords: form.splitKeywords('记忆 召回'),
  limit: 5,
})
eq(twoGram.map(hit => hit.id), [3, 2, 1], '命中多的在前;同命中按 created_at 新的在前')
eq(twoGram[0].hits, 2, '全中记 2 个 gram')
eq(twoGram[0].cover, 1, '覆盖度 1')
eq(twoGram[1].cover, 0.5, '命中一半 = 覆盖度 0.5(放行线下沿)')
ok(!twoGram.some(hit => hit.id === 4), '零命中的不入围')

// query 有 5 个 gram 时,只中 1 个就被下限挡掉 —— 挡的是"巧合命中"
const fiveGram = form.scoreRough({
  rows: [mk(5, '记忆', '2026-09-18 10:00:00', 0), mk(6, '记忆检索落地那件事', '2026-09-18 10:00:00', 0)],
  keywords: form.splitKeywords('记忆检索落地'),
  limit: 5,
})
eq(fiveGram.map(hit => hit.id), [6], '命中 1/5 被下限挡下,命中 3/5 放行')

// 单字查询:分母只有 1,命中即 cover 1 → 放行
const oneChar = form.scoreRough({
  rows: [mk(7, '妈妈说了话', '2026-09-18 10:00:00', 0), mk(8, '别的', '2026-09-18 10:00:00', 0)],
  keywords: form.splitKeywords('妈'),
  limit: 5,
})
eq(oneChar.map(hit => hit.id), [7], '单字词走单字 gram,搜得到')

// 同命中数 → 召回多的在前
const byRecall = form.scoreRough({
  rows: [mk(9, '记忆', '2026-09-18 10:00:00', 0), mk(10, '记忆', '2026-09-18 10:00:00', 7)],
  keywords: form.splitKeywords('记忆'),
  limit: 5,
})
eq(byRecall.map(hit => hit.id), [10, 9], '同覆盖度按 recalled 降序')

// created_at 参与排序(新近在前),但只在同命中同召回时
const byDate = form.scoreRough({
  rows: [mk(11, '记忆', '2026-09-01 10:00:00', 2), mk(12, '记忆', '2026-09-18 10:00:00', 2)],
  keywords: form.splitKeywords('记忆'),
  limit: 5,
})
eq(byDate.map(hit => hit.id), [12, 11], '新近度只做同分次序')

eq(form.scoreRough({ rows: [mk(13, '记忆', '2026-09-18 10:00:00')], keywords: [], limit: 5 }), [], '没有关键词 → 空结果')
eq(
  form.scoreRough({ rows: [mk(14, '记忆', '2026-09-18 10:00:00')], keywords: form.splitKeywords('记忆'), limit: 1 }).length,
  1,
  'limit 截断生效',
)

// content 也参与匹配(summary 没说全时靠它救回)
const byContent = form.scoreRough({
  rows: [mk(15, '一句话摘要', '2026-09-18 10:00:00', 0, '正文里有 bigram 召回这套东西')],
  keywords: form.splitKeywords('召回 bigram'),
  limit: 5,
})
eq(byContent.length, 1, 'summary 没中但 content 中了 → 仍然算命中')

eq(form.normalizeLimit(undefined), form.MEMORY_ROUGH_DEFAULT_LIMIT, 'limit 缺省 = 默认条数')
eq(form.normalizeLimit(0), form.MEMORY_ROUGH_DEFAULT_LIMIT, 'limit ≤0 回落默认')
eq(form.normalizeLimit('abc'), form.MEMORY_ROUGH_DEFAULT_LIMIT, 'limit 非数字回落默认')
eq(form.normalizeLimit(999), form.MEMORY_ROUGH_MAX_LIMIT, 'limit 超上限截到上限')
eq(form.normalizeLimit(3.7), 3, 'limit 小数取整')
eq(form.normalizeId(3), 3, 'id 数字通过')
eq(form.normalizeId('7'), 7, 'id 字符串数字通过(模型常这么传)')
eq(form.normalizeId(2.5), undefined, 'id 小数不认')
eq(form.normalizeId(0), undefined, 'id 0 不认')
eq(form.normalizeId('a'), undefined, 'id 非数字不认')

const roughText = form.renderRough({
  hits: [{ id: 3, summary: 'A|B', created_at: '2026-09-18 11:00:00', recalled: 2, kind: null, hits: 2, cover: 0.6667 }],
  keywords: ['记忆', '召回'],
  candidates: 4,
})
ok(roughText.includes('记忆检索'), '渲染带标题')
ok(roughText.includes('"记忆 召回"'), '渲染回显关键词')
ok(roughText.includes('owner=(全部)'), '不传 owner 显示全桶')
ok(roughText.includes('| 3 | 09-18 11:00 | 2 | 0.667 | 2 | A/B |'), '命中/覆盖/召回三列,摘要竖线换斜杠')
ok(roughText.includes('roroko_mem_id'), '提示用 id 取全文')

const roughEmptyBucket = form.renderRough({ hits: [], keywords: ['x'], owner: 'dev', candidates: 0 })
ok(roughEmptyBucket.includes('该桶还没有记忆'), '空桶明说"还没有记忆"')
const roughNoMatch = form.renderRough({ hits: [], keywords: ['x'], owner: 'dev', candidates: 9 })
ok(roughNoMatch.includes('没有匹配上'), '没匹配上要跟"没有记忆"区分开')
ok(roughNoMatch.includes('别据此编造记忆'), '没匹配上时明确禁止脑补')

const idText = form.renderId({
  row: {
    id: 7, owner: 'dev', content: '正文全文', summary: '一句话摘要',
    created_at: '2026-09-18 11:00:00', reflected_at: '2026-09-19 09:00:00', recalled: 1,
    kind: 'thread', source: 'sess#3',
  },
  recalled: 2,
})
ok(idText.includes('记忆 #7'), '全文渲染带 id')
ok(idText.includes('召回 2'), '渲染用库里的最新召回数')
ok(idText.includes('已反思 2026-09-19 09:00:00'), '已反思显示时间')
ok(idText.includes('source: sess#3'), 'provenance 跟着走')
ok(idText.includes('正文全文'), '正文全文在')
const idUnreflected = form.renderId({
  row: { id: 8, owner: 'persona', content: 'c', summary: 's', created_at: '2026-09-18 11:00:00', reflected_at: null, recalled: 0, kind: null, source: null },
  recalled: 1,
})
ok(idUnreflected.includes('未反思'), '未反思标旗')
ok(!idUnreflected.includes('source:'), '空 source 不留行')

// ── 十一、真库 rough / id 往返 ─────────────────────────────────────────────
const rough1 = store.runRough(db, { keywords: '昨天', owner: 'dev' })
ok(rough1.includes('| 2 | 09-17 11:00 | 1 | 1.000 | 1 | 昨天 |'), '真库检索命中(表格给 summary,不给 content;召回列跟着库走)')
ok(!rough1.includes('十天前'), '区间外/不相关的条不混进来')
ok(!rough1.includes('| 3 |'), 'owner 过滤挡掉别的桶')
ok(rough1.includes('候选 2 条'), '候选数 = 过滤后的条数')

const recalledAfter1 = db.prepare('SELECT recalled FROM memory WHERE id = 2').get().recalled
eq(Number(recalledAfter1), 1, '命中即 recalled += 1')

const rough2 = store.runRough(db, { keywords: '昨天', owner: 'dev' })
ok(rough2.includes('| 2 | 09-17 11:00 | 1 | 1.000 | 2 | 昨天 |'), '再检索一次 → 渲染里的召回数与库同步')
eq(Number(db.prepare('SELECT recalled FROM memory WHERE id = 2').get().recalled), 2, '库里的计数确实涨了')

const roughAll = store.runRough(db, { keywords: '今天' })
ok(roughAll.includes('| 3 |'), '不传 owner = 全桶')
ok(!roughAll.includes('owner=dev'), '全桶时表头明示')

const roughNoKeyword = store.runRough(db, {})
ok(roughNoKeyword.includes('关键词为空'), '空关键词返回人话,不抛')
const dbNoMatch = store.runRough(db, { keywords: '完全不相干的词xyzzy' })
ok(dbNoMatch.includes('没有匹配上'), '真库里查不到 → 明说没匹配上')
const dbEmptyBucket = store.runRough(db, { keywords: 'x', owner: 'nobody' })
ok(dbEmptyBucket.includes('该桶还没有记忆'), '空桶走另一条文案')

const id1 = store.runId(db, { id: 2 })
ok(id1.includes('记忆 #2'), '按 id 取全文')
ok(id1.includes('昨天一条'), '全文是 content 不是 summary')
ok(id1.includes('source: sess#1'), '带出处')
eq(Number(db.prepare('SELECT recalled FROM memory WHERE id = 2').get().recalled), 3, 'id 取用也 recalled += 1')

ok(store.runId(db, { id: 2, owner: 'persona' }).includes('没有 #2'), 'owner 限定后取不到别桶的条')
ok(store.runId(db, { id: 999 }).includes('没有 #999'), '不存在的 id 返回人话')
ok(store.runId(db, { id: 'x' }).includes('id 非法'), '非法 id 返回人话')
ok(store.runId(db, { id: -1 }).includes('id 非法'), '负数 id 挡下')

db.close()
try {
  rmSync(dir, { recursive: true, force: true })
} catch {
  // Windows 句柄偶发未释放;临时目录留着无妨
}

process.exit(done('memory-form / memory-store') === 0 ? 0 : 1)
