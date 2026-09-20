/**
 * memory-form / memory-store 测试:CST 时间口径 / 日期区间 / 入参收窄 / 渲染 /
 * 真 sqlite 往返 / 一条 SQL 的检索语义。零依赖,直读 lib/ 产物:node test/memory-unit.mjs
 *
 * 时间口径是本套件的重点:库里的 created_at 一律 CST+0800,而跑测试的机器时区
 * (以及服务器时区)都不可控 —— 所以用例全部用带 Z 的**绝对时刻**,验的是"东八区
 * 那面钟",不是本机本地钟。
 *
 * 2026-09-21 减法后:检索从"bigram 打分"改成**一条 SQL LIKE**(每个词都要命中),
 * 本套件对应删掉打分/覆盖度/召回计数那几节,补上 LIKE 的语义与转义用例。
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

// ── 五、add 入参收窄(kind 已从工具面撤掉,固定空串) ────────────────────────
eq(
  form.normalizeAdd({ owner: 'dev', content: '  触发条件 → 应做  ', summary: ' 一句话 ', source: ' sess#3 ' }).input,
  { owner: 'dev', content: '触发条件 → 应做', summary: '一句话', kind: '', source: 'sess#3' },
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
eq(form.normalizeAdd({ owner: 'dev', content: 'x', summary: 'y' }).input.source, '', 'source 缺省为空串')
eq(form.normalizeAdd({ owner: 'dev', content: 'x', summary: 'y' }).input.kind, '', '★ kind 固定空串:工具面不再暴露分类(只有导入脚本自己写 log)')
eq(
  form.normalizeAdd({ owner: 'dev', content: 'x', summary: 'y', kind: 'event' }).input.kind,
  '',
  '★ 就算硬塞 kind 进来也被忽略 —— 分类概念已从工具面撤掉',
)

// ── 六、渲染 ────────────────────────────────────────────────────────────────
const rows = [
  { id: 2, owner: 'dev', summary: 'A|B', created_at: '2026-09-17 11:00:00', reflected_at: '2026-09-18 09:00:00', kind: 'log' },
  { id: 3, owner: 'dev', summary: 'C', created_at: '2026-09-18 11:00:00', reflected_at: null, kind: null },
]
const text = form.renderDate({ rows, range: { from: '2026-09-17', to: '2026-09-18' }, owner: 'dev' })
ok(text.includes('2026-09-17 ~ 2026-09-18'), '表头带区间')
ok(text.includes('owner=dev'), '表头带桶名')
ok(text.includes('条数 2'), '统计条数')
ok(text.includes('未反思 1'), '统计未反思')
ok(!text.includes('召回'), '★ 累计召回统计已删')
ok(text.includes('| 2 | 09-17 11:00 | log | A/B |  |'), '摘要里的竖线换成斜杠,已反思不标旗')
ok(text.includes('| 3 | 09-18 11:00 |  | C | 未反思 |'), '空 kind 留白,未反思标旗')

const empty = form.renderDate({ rows: [], range: { from: '2026-09-01', to: '2026-09-02' }, owner: 'dev' })
ok(empty.includes('该区间没有记忆'), '空区间明说"没有",不让模型脑补')
ok(empty.includes('owner=dev'), '空区间也带桶名')
ok(
  form.renderAddResult({ owner: 'dev', content: 'x', summary: 'S', kind: '', source: '' }, 7, '2026-09-18 11:00:00').includes('已记 #7 · 2026-09-18 11:00:00 CST'),
  '写入回执带 id 与 CST 时间',
)
ok(
  !form.renderAddResult({ owner: 'dev', content: 'x', summary: 'S', kind: '', source: '' }, 7, 't').includes('kind'),
  '★ 回执不再回显 kind',
)

const roughText = form.renderRough({
  rows: [{ id: 3, owner: 'dev', summary: 'A|B', created_at: '2026-09-18 11:00:00', reflected_at: null, kind: null }],
  keywords: ['记忆', 'bigram'],
  owner: 'dev',
  candidates: 4,
})
ok(roughText.includes('记忆检索'), '渲染带标题')
ok(roughText.includes('"记忆 bigram"'), '渲染回显关键词')
ok(roughText.includes('owner=dev'), '渲染带桶名')
ok(roughText.includes('| 3 | 09-18 11:00 |  | A/B |'), '★ 检索表只剩 id/时间/类别/摘要,摘要竖线换斜杠')
ok(roughText.includes('| id | 时间 | 类别 | 摘要 |'), '★ 表头就是这四列')
ok(!roughText.includes('覆盖'), '★ 覆盖度列已删')
ok(!roughText.includes('召回'), '★ 召回列已删')
ok(roughText.includes('roroko_mem_id'), '提示用 id 取全文')

const roughEmptyBucket = form.renderRough({ rows: [], keywords: ['x'], owner: 'dev', candidates: 0 })
ok(roughEmptyBucket.includes('该桶还没有记忆'), '空桶明说"还没有记忆"')
const roughNoMatch = form.renderRough({ rows: [], keywords: ['x'], owner: 'dev', candidates: 9 })
ok(roughNoMatch.includes('没有匹配上'), '没匹配上要跟"没有记忆"区分开')
ok(roughNoMatch.includes('别据此编造记忆'), '没匹配上时明确禁止脑补')
ok(roughNoMatch.includes('每个词都要命中') || roughNoMatch.includes('少给一个词'), '没匹配上时告诉模型怎么改关键词')

const idText = form.renderId({
  row: {
    id: 7, owner: 'dev', content: '正文全文', summary: '一句话摘要',
    created_at: '2026-09-18 11:00:00', reflected_at: '2026-09-19 09:00:00',
    kind: null, source: 'sess#3',
  },
})
ok(idText.includes('记忆 #7'), '全文渲染带 id')
ok(!idText.includes('召回'), '★ 全文渲染不再提召回数')
ok(idText.includes('已反思 2026-09-19 09:00:00'), '已反思显示时间')
ok(idText.includes('source: sess#3'), 'provenance 跟着走')
ok(idText.includes('正文全文'), '正文全文在')
const idUnreflected = form.renderId({
  row: { id: 8, owner: 'persona', content: 'c', summary: 's', created_at: '2026-09-18 11:00:00', reflected_at: null, kind: null, source: null },
})
ok(idUnreflected.includes('未反思'), '未反思标旗')
ok(!idUnreflected.includes('source:'), '空 source 不留行')

// ── 七、DDL 与 pragma 常量 ─────────────────────────────────────────────────
eq(form.MEMORY_DDL.length, 3, '一条建表 + 两条索引')
ok(form.MEMORY_DDL[0].includes('CREATE TABLE IF NOT EXISTS memory'), '建表语句幂等')
ok(form.MEMORY_DDL[0].includes('reflected_at'), '反思时间列在位')
ok(form.MEMORY_DDL[0].includes('recalled'), '★ 召回计数列**仍留在表里**(代码不读它,但老库不需要迁移)')
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
const a2 = store.runAdd(db, { owner: 'dev', content: '昨天一条', summary: '昨天', kind: '', source: 'sess#1' }, t2)
const a3 = store.runAdd(db, { owner: 'persona', content: '今天一条', summary: '今天', kind: '', source: '' }, t3)

eq([a1.id, a2.id, a3.id], [1, 2, 3], 'id 自增')
eq(a2.createdAt, '2026-09-17 11:00:00', 'created_at 是 CST 口径(不是 UTC)')
ok(a1.text.includes('已记 #1'), '回执带 id')

const stored = db
  .prepare('SELECT owner, content, summary, kind, source, reflected_at FROM memory WHERE id = 2')
  .get()
eq(
  { ...stored },
  { owner: 'dev', content: '昨天一条', summary: '昨天', kind: null, source: 'sess#1', reflected_at: null },
  '列值落对:source 有值、reflected_at 留 NULL、kind 空则存 NULL',
)

const def = store.runDate(db, {}, 'dev', t3)
ok(def.includes('条数 1'), '★ 默认区间 + 本桶:只有昨天那条')
ok(!def.includes('十天前'), '区间外的条不混进来')
ok(!def.includes('今天一条'), '★ 别的桶不混进来')
ok(def.includes('未反思 1'), '新写的条默认都是未反思')

const personaOnly = store.runDate(db, {}, 'persona', t3)
ok(personaOnly.includes('| 3 |') && personaOnly.includes('今天'), '★ 换个桶能看到 persona 那条')
ok(!personaOnly.includes('昨天'), '★ persona 桶里没有 dev 的记录')

const single = store.runDate(db, { from: '2026-09-10', to: '2026-09-10' }, 'dev', t3)
ok(single.includes('十天前'), '单日区间能捞历史条')

const bad = store.runDate(db, { from: '2026-09-18', to: '2026-09-10' }, 'dev', t3)
ok(bad.includes('区间非法'), '反区间返回人话错误,不抛')

const none = store.runDate(db, { to: '2026-09-11' }, 'dev', t3)
ok(none.includes('该区间没有记忆'), '空区间明说没有')

// ── 九、关键词切分与 LIKE 转义 ─────────────────────────────────────────────
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

eq(form.escapeLike('100%'), '100\\%', '★ % 转义 —— 否则会变成"以 100 开头的一切"')
eq(form.escapeLike('node_options'), 'node\\_options', '★ _ 转义 —— 否则会匹配任意单字符')
eq(form.escapeLike('a\\b'), 'a\\\\b', '反斜杠自己先转义')
eq(form.escapeLike('普通词'), '普通词', '没有通配符的词原样')

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

// ── 十、真库检索(一条 SQL 的语义) ─────────────────────────────────────────
// 再补两条做语义与转义验证
const a4 = store.runAdd(db, { owner: 'dev', content: '构建要加 NODE_OPTIONS', summary: '小内存构建', kind: '', source: '' }, t2)
const a5 = store.runAdd(db, { owner: 'dev', content: 'nodeXoptions 是假货', summary: '诱饵', kind: '', source: '' }, t2)
const a6 = store.runAdd(db, { owner: 'dev', content: '完成度 100% 那件事', summary: '覆盖率', kind: '', source: '' }, t2)
const a7 = store.runAdd(db, { owner: 'dev', content: '完成度 10 那件事', summary: '误中诱饵', kind: '', source: '' }, t2)

const hitOne = store.runRough(db, { keywords: '昨天' }, 'dev')
ok(hitOne.includes('| 2 | 09-17 11:00 |'), '★ 单词命中:表格只剩 id/时间/类别/摘要')
ok(hitOne.includes('桶内 6 条'), '★ 回执给桶内总条数(区分"没记忆"与"没匹配上")')
ok(!hitOne.includes('今天'), '★ 别的桶不参与检索')

const hitAnd = store.runRough(db, { keywords: '昨天 十天前' }, 'dev')
ok(hitAnd.includes('没有匹配上'), '★ 两个词要同时出现:没有任何一条同时含"昨天"和"十天前"')

const hitBoth = store.runRough(db, { keywords: '昨天 一条' }, 'dev')
ok(hitBoth.includes('| 2 |'), '★ 两个词都出现的那条命中')

const hitContent = store.runRough(db, { keywords: 'summary 没说全' }, 'dev')
eq(hitContent.includes('没有匹配上'), true, 'content 与 summary 里都没有 → 没匹配上')

const hitContentHit = store.runRough(db, { keywords: '假货' }, 'dev')
ok(hitContentHit.includes('| 5 |'), '★ 只在 content 里出现也算命中')

const hitCase = store.runRough(db, { keywords: 'node_options' }, 'dev')
ok(hitCase.includes('| 4 |'), '★ 拉丁词大小写无关,且下划线按字面匹配')
ok(!hitCase.includes('| 5 |'), '★ 下划线不会被当成通配符(否则 nodeXoptions 也会中)')

const hitPercent = store.runRough(db, { keywords: '100%' }, 'dev')
ok(hitPercent.includes('| 6 |'), '★ % 按字面匹配:含 100% 的那条命中')
ok(!hitPercent.includes('| 7 |'), '★ % 没被当成通配符(否则"完成度 10"也会中)')

const roughFail = store.runRough(db, { keywords: '完全不相干的词xyzzy' }, 'dev')
ok(roughFail.includes('没有匹配上'), '真库里查不到 → 明说没匹配上')
const roughNoKeyword = store.runRough(db, {}, 'dev')
ok(roughNoKeyword.includes('关键词为空'), '空关键词返回人话,不抛')
const roughNobody = store.runRough(db, { keywords: 'x' }, 'nobody')
ok(roughNobody.includes('该桶还没有记忆'), '空桶走另一条文案')

const roughLimit = store.runRough(db, { keywords: '一条', limit: 1 }, 'dev')
eq((roughLimit.match(/^\| \d+ \|/gm) ?? []).length, 1, '★ limit 生效(表格只剩一行)')

const roughNoRecall = db.prepare('SELECT recalled FROM memory WHERE id = 2').get().recalled
eq(Number(roughNoRecall), 0, '★ 检索不再动 recalled(旧行为:命中即 +1)')

const id1 = store.runId(db, { id: 2 }, 'dev')
ok(id1.includes('记忆 #2'), '按 id 取全文')
ok(id1.includes('昨天一条'), '全文是 content 不是 summary')
ok(id1.includes('source: sess#1'), '带出处')
eq(Number(db.prepare('SELECT recalled FROM memory WHERE id = 2').get().recalled), 0, '★ 取全文也不动 recalled')
ok(store.runId(db, { id: 2 }, 'persona').includes('没有 #2'), '★ 桶不对就取不到(id 也要在本桶里)')
ok(store.runId(db, { id: 999 }, 'dev').includes('没有 #999'), '不存在的 id 返回人话')
ok(store.runId(db, { id: 'x' }, 'dev').includes('id 非法'), '非法 id 返回人话')
ok(store.runId(db, { id: -1 }, 'dev').includes('id 非法'), '负数 id 挡下')
eq([a4.id, a5.id, a6.id, a7.id], [4, 5, 6, 7], '新增四条 id 连号')

// ── 十一、反思(reflect) ────────────────────────────────────────────────────
eq(
  form.normalizeReflect({ id: 2, content: '  新结论  ', summary: ' 新摘要 ' }).input,
  { id: 2, content: '新结论', summary: '新摘要' },
  'reflect 入参逐个 trim',
)
eq(form.normalizeReflect({ id: '2', content: 'x' }).input, { id: 2, content: 'x', summary: '' }, 'id 收字符串数字;summary 可省(空串)')
ok(form.normalizeReflect({ content: 'x' }).error !== undefined, 'reflect 缺 id → 报错')
ok(form.normalizeReflect({ id: 0, content: 'x' }).error !== undefined, 'reflect id 0 → 报错')
ok(form.normalizeReflect({ id: 2, content: '   ' }).error !== undefined, 'reflect 空 content → 报错')
ok(
  form.normalizeReflect({ id: 2, content: 'x', summary: 'y'.repeat(form.MEMORY_SUMMARY_MAX + 1) }).error !== undefined,
  'reflect summary 超长 → 报错',
)

const reflectEcho = form.renderReflectResult({
  id: 7, reflectedAt: '2026-09-20 16:00:00', beforeChars: 400, afterChars: 120, summary: 'S', summaryKept: false,
})
ok(reflectEcho.includes('已反思 #7 · 2026-09-20 16:00:00 CST'), '回执带 id 与 CST 时间')
ok(reflectEcho.includes('字数 400 → 120'), '回执给字数变化 —— 一眼看出是改写不是新增')
ok(
  form.renderReflectResult({ id: 7, reflectedAt: 't', beforeChars: 1, afterChars: 1, summary: 'S', summaryKept: true }).includes('(未改)'),
  '没动 summary 要标明',
)

// 真库:用第八节写下的 id=2(dev / kind=NULL / source=sess#1)
eq(db.prepare('SELECT reflected_at FROM memory WHERE id = 2').get().reflected_at, null, '反思前是未反思')
const reflect1 = store.runReflect(db, { id: 2, content: '反思后的新内容', summary: '' }, t3)
ok(reflect1.includes('已反思 #2'), '真库反思回执')
const afterReflect = db.prepare('SELECT content, summary, kind, source, reflected_at, recalled FROM memory WHERE id = 2').get()
eq(afterReflect.content, '反思后的新内容', 'content 被**整条覆盖**')
eq(afterReflect.summary, '昨天', 'summary 没传 → 保留原值')
eq(afterReflect.reflected_at, '2026-09-18 11:00:00', 'reflected_at 刷成 CST 口径')
eq(afterReflect.kind, null, 'reflect 不动 kind')
eq(afterReflect.source, 'sess#1', 'reflect 不动 provenance')
eq(Number(afterReflect.recalled), 0, 'reflect 不动 recalled(列还在,只是没人用)')
ok(reflect1.includes('(未改)'), '回执标明 summary 未改')

store.runReflect(db, { id: 2, content: '再收一遍', summary: '新的摘要' }, t3)
eq(db.prepare('SELECT summary FROM memory WHERE id = 2').get().summary, '新的摘要', '传了 summary 就一起换')

const dateAfterReflect = store.runDate(db, {}, 'dev', t3)
ok(dateAfterReflect.includes('未反思 4'), '★ 本桶昨天那条已反思,其余四条仍标未反思')
ok(dateAfterReflect.includes('| 2 | 09-17 11:00 |  | 新的摘要 |  |'), '已反思的行不标旗')
ok(store.runReflect(db, { id: 999, content: 'x', summary: '' }, t3).includes('没有 #999'), '反思不存在的 id 返回人话')
ok(store.runReflect(db, { id: 2, content: 'x', summary: '' }, t3).includes('已反思 #2'), '同一条可反复反思(不新增条)')

db.close()
try {
  rmSync(dir, { recursive: true, force: true })
} catch {
  // Windows 句柄偶发未释放;临时目录留着无妨
}

process.exit(done('memory-form / memory-store') === 0 ? 0 : 1)
