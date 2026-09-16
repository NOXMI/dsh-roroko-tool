/**
 * datas/query-form.js 纯函数测试:关键词匹配 / 收束过滤 / 候选抽取 / markdown 渲染。
 * 零依赖,直读 lib/ 产物:node test/datas-query.mjs
 *
 * fixture 按**真实库形态**构造(soul-server.json 采的样子):keywords 是 JSON 串、
 * 单字 token 混在里面、companion_pool 的时间列叫 last_used、slot 有不认识的取值。
 */
import { makeAsserts } from './helpers/harness.mjs'

const { ok, eq, done } = makeAsserts()

const {
  TABLES, parseKeywords, splitKws, splitSlots, scoreRow, pickCandidates,
  slotDistribution, clampLimit, fmtLastUsed, renderQuery,
} = await import('../lib/datas/query-form.js')

const now = new Date('2026-09-16T15:00:00')

/** 确定性随机源(线性同余),避免测试 flaky。 */
function lcg(seed) {
  let x = seed >>> 0
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0
    return x / 4294967296
  }
}

const clothingRows = [
  { id: 1, name: '白衬衫', slot: 'top', reveal_level: 1, signal_level: 2, keywords: '["职场","衬衫","白"]', note: '日常工作装', hit_count: 35, last_used_at: '2026-08-18 15:30:04' },
  { id: 2, name: '包臀裙', slot: 'bottom', reveal_level: 2, signal_level: 2, keywords: '["职场","包臀裙"]', note: '包得很紧', hit_count: 27, last_used_at: '2026-08-18 00:00:14' },
  { id: 3, name: '比基尼bra', slot: 'bra', reveal_level: 4, signal_level: 4, keywords: '["泳","比基尼","bra"]', note: '', hit_count: 2, last_used_at: '' },
  { id: 4, name: '弹弓泳衣', slot: 'swimsuit', reveal_level: 5, signal_level: 5, keywords: '["泳","弹弓"]', note: '', hit_count: 2, last_used_at: '' },
  { id: 5, name: '蕾丝内裤', slot: 'underwear', reveal_level: 3, signal_level: 3, keywords: '["蕾丝","透"]', note: '', hit_count: 6, last_used_at: '' },
  { id: 6, name: '湿透的运动背心', slot: 'top', reveal_level: 3, signal_level: 3, keywords: '["湿透","运动","背心"]', note: '', hit_count: 6, last_used_at: '2026-08-07 12:14:45' },
  { id: 7, name: '护士帽', slot: 'headwear', reveal_level: 2, signal_level: 4, keywords: '["护士","帽"]', note: '白色', hit_count: 2, last_used_at: '' },
  { id: 8, name: '无', slot: '', reveal_level: 1, signal_level: 1, keywords: '["无"]', note: '', hit_count: 0, last_used_at: '' },
  { id: 9, name: '斗篷', slot: 'cape', reveal_level: 2, signal_level: 2, keywords: '["斗篷"]', note: '', hit_count: 0, last_used_at: '' },
]

const companionRows = [
  { id: 1, profession: '健身教练', body_type: '肌肉线条分明', trait: '话少', note: '每周二四固定', last_used: '2026-06-19 00:56:24', keywords: '["健身","教练","练"]', hit_count: 9 },
  { id: 2, profession: '外卖骑手', body_type: '', trait: '', note: '', last_used: '', keywords: '["外卖","骑手"]', hit_count: 0 },
]

const pick = (rows, tableKey, opts = {}) => pickCandidates(rows, {
  tableKey,
  kws: opts.kws ?? [],
  filters: opts.filters ?? {},
  limit: opts.limit ?? TABLES[tableKey].defaultLimit,
  rng: opts.rng,
})

const render = (rows, pickResult, tableKey, extra = {}) => renderQuery({
  tableKey,
  kws: extra.kws ?? [],
  pick: pickResult,
  total: extra.total ?? rows.length,
  usedCount: extra.usedCount ?? rows.filter(r => Number(r.hit_count ?? 0) > 0).length,
  limit: extra.limit ?? TABLES[tableKey].defaultLimit,
  adhoc: extra.adhoc ?? [],
  now,
})

// ── 表形状(列名以库为准)
eq(TABLES.companion.timeCol, 'last_used', '★ companion_pool 的时间列是 last_used(不是 last_used_at)')
eq(TABLES.companion.nameCol, 'profession', 'companion_pool 的名字列是 profession')
eq(TABLES.clothing.table, 'clothing', 'clothing 真实表名')
eq(TABLES.items.table, 'sexual_items', 'items 映射到 sexual_items')
ok(TABLES.clothing.hasSlot && TABLES.clothing.hasLevels, 'clothing 有 slot 与等级列')
ok(!TABLES.scene.hasSlot && !TABLES.companion.hasLevels, '场景/伴侣没有 slot 与等级列')

// ── 关键词列解析
eq(parseKeywords('["职场","干练"]'), ['职场', '干练'], 'parseKeywords:JSON 数组')
eq(parseKeywords('职场,干练'), ['职场', '干练'], 'parseKeywords:裸逗号串')
eq(parseKeywords('["a",'), ['["a"'], 'parseKeywords:畸形 JSON 回落逗号切')
eq(parseKeywords(''), [], 'parseKeywords:空串')
eq(parseKeywords(null), [], 'parseKeywords:null')
eq(parseKeywords(['x']), [], 'parseKeywords:非字符串')
eq(parseKeywords('[" a ", "  ", "b"]'), ['a', 'b'], 'parseKeywords:trim + 去空项')

// ── 查询词拆分
eq(splitKws('职场, 干练'), ['职场', '干练'], 'splitKws:去空白')
eq(splitKws('a,b,a'), ['a', 'b'], 'splitKws:去重')
eq(splitKws(''), [], 'splitKws:空串')
eq(splitKws(undefined), [], 'splitKws:非字符串')
eq(splitSlots('top, bottom'), ['top', 'bottom'], 'splitSlots:逗号分隔')
eq(splitSlots('top,,top'), ['top'], 'splitSlots:去空 + 去重')

// ── 打分:★ 记录侧单字 token 不作命中依据
eq(scoreRow(clothingRows[0], ['职场']), 2, 'scoreRow:完全相等 +2')
eq(scoreRow(clothingRows[2], ['基尼']), 1, 'scoreRow:单向包含 +1(查询词短于 token)')
eq(scoreRow(clothingRows[4], ['透']), 0, '★ scoreRow:记录侧只有单字「透」→ 不命中')
eq(scoreRow(clothingRows[5], ['透']), 1, '★ scoreRow:双字 token「湿透」含「透」→ 命中(单字查询词靠双字 token 召回)')
eq(scoreRow(clothingRows[0], []), 0, 'scoreRow:无查询词恒 0')
eq(scoreRow(clothingRows[0], ['职场', '衬衫']), 4, 'scoreRow:多词累加')

// ── 发散(不给条件)
const spread = pick(clothingRows, 'clothing')
eq(spread.poolSize, clothingRows.length, '发散:池子 = 全表')
eq(spread.matched, clothingRows.length, '发散:命中数 = 全表')
eq(spread.steps, [], '发散:没有收束级')
eq(spread.groups.reduce((n, g) => n + g.rows.length, 0), clothingRows.length, '发散:每槽位在 limit 内取全部候选(共 9 条)')
ok(spread.groups.every(g => g.rows.length <= TABLES.clothing.defaultLimit), '发散:每槽位不超过 limit')
ok(spread.groups.find(g => g.slot === '(未分类)').rows.length === 1, '★ 发散:(未分类) 组也能取到行(空 slot 回归)')
eq(pick(clothingRows, 'clothing', { limit: 1 }).groups.reduce((n, g) => n + g.rows.length, 0), 8, '★ limit=1 时每槽位只取 1 条(8 个槽位)')

// ── 随机性:同一池子换种子 → 结果不同
const a = pick(clothingRows, 'scene', { limit: 3, rng: lcg(1) })
const b = pick(clothingRows, 'scene', { limit: 3, rng: lcg(99) })
ok(JSON.stringify(a.rows) !== JSON.stringify(b.rows), '★ 发散:换随机种子结果就变(不是固定排序)')
const a2 = pick(clothingRows, 'scene', { limit: 3, rng: lcg(1) })
eq(a2.rows, a.rows, '★ 同种子结果可复现(测试确定性)')

// ── 随机性:hit_count 不参与排序(高命中不会被稳定选中)
const manyRows = Array.from({ length: 40 }, (_, i) => ({
  id: i + 1, name: `条目${i + 1}`, keywords: '["通用"]', hit_count: i === 0 ? 999 : 0, last_used_at: '',
}))
const seen = new Set()
for (let seed = 1; seed <= 60; seed++) {
  for (const row of pick(manyRows, 'scene', { limit: 1, rng: lcg(seed) }).rows) seen.add(row.name)
}
ok(seen.size > 10, `★ 发散:40 条池子里抽过 ${seen.size} 个不同条目(hit_count=999 那条没有被固定偏爱)`)

// ── 关键词收束
const kwPick = pick(clothingRows, 'clothing', { kws: ['职场'], limit: 5 })
eq(kwPick.poolSize, 2, '关键词「职场」:命中 2 条')
eq(kwPick.groups.flatMap(g => g.rows).map(r => r.name).sort(), ['包臀裙', '白衬衫'], '关键词:出正确条目(clothing 走分组)')
eq(kwPick.usedKws, ['职场'], '关键词:参与匹配的词')
eq(kwPick.droppedKws, [], '关键词:没有单字被挡')

const singleKw = pick(clothingRows, 'clothing', { kws: ['透', '职场'], limit: 5 })
eq(singleKw.droppedKws, ['透'], '★ 单字查询词记进 droppedKws')
eq(singleKw.poolSize, 3, '★ 单字「透」不作依据:只留下「湿透的运动背心」(靠双字 token 进来),蕾丝内裤被排除')

const noHit = pick(clothingRows, 'clothing', { kws: ['赛博'], limit: 3 })
eq(noHit.matched, 0, '关键词未命中:matched 0')
eq(noHit.poolSize, 0, '关键词未命中:池子空')

// ── 排序:分值高的在前
const mixed = [
  { id: 1, name: '弱命中', slot: 'top', reveal_level: 1, signal_level: 1, keywords: '["职场文化"]', note: '', hit_count: 0, last_used_at: '' },
  { id: 2, name: '强命中', slot: 'top', reveal_level: 1, signal_level: 1, keywords: '["职场"]', note: '', hit_count: 0, last_used_at: '' },
]
eq(pick(mixed, 'clothing', { kws: ['职场'], limit: 2 }).groups[0].rows.map(r => r.name), ['强命中', '弱命中'], '关键词:完全相等排在包含前面')

// ── 收束链
const capped = pick(clothingRows, 'clothing', { filters: { revealLevel: 2 }, limit: 5 })
eq(capped.steps.length, 1, '收束:一级留痕')
eq(capped.steps[0].label, 'reveal_level≤2', '收束:标签写口径')
eq(capped.steps[0].before, clothingRows.length, '收束:before 是收束前池子')
eq(capped.poolSize, capped.steps[0].after, '收束:after 等于最终池子')
ok(capped.groups.every(g => g.rows.every(r => r.reveal_level <= 2)), '★ reveal_level≤2:比基尼/泳装被挡在池外')
ok(!capped.groups.some(g => g.slot === 'bra'), '★ reveal_level≤2:bra 槽位(只有比基尼)无候选')

const slotOnly = pick(clothingRows, 'clothing', { filters: { slot: ['top'] }, limit: 5 })
eq(slotOnly.poolSize, 2, 'slot 收束:top 命中 2 条')
eq(slotOnly.groups.map(g => g.slot), ['top'], 'slot 收束:只出指定槽位')

const chained = pick(clothingRows, 'clothing', { filters: { slot: ['top'], revealLevel: 2, signalLevel: 2 }, limit: 5 })
eq(chained.steps.map(s => s.label), ['slot∈[top]', 'reveal_level≤2', 'signal_level≥2'], '收束链:三级按顺序留痕')
eq(chained.steps.map(s => s.before), [9, 2, 1], '收束链:每级 before 承接上一级 after')
eq(chained.poolSize, 1, '收束链:最终只剩白衬衫(reveal1/signal2/top)')

// ── clothing 分组:动态槽位
const slots = spread.groups.map(g => g.slot)
ok(slots.includes('cape'), '★ 分组槽位动态自库(库里没有的 cape 也能分组)')
ok(slots.includes('(未分类)'), '★ 空 slot 归 (未分类)')
ok(slots.indexOf('(未分类)') === slots.length - 1, '★ (未分类) 排最后')
ok(slots.indexOf('top') < slots.indexOf('headwear'), '分组按池内条数降序(top 2 条在 headwear 1 条前)')
eq(spread.groups.find(g => g.slot === 'bra').poolSize, 1, '分组:单条槽位 poolSize 正确')

eq(slotDistribution(clothingRows), [
  { slot: 'top', count: 2 }, { slot: 'bottom', count: 1 }, { slot: 'bra', count: 1 }, { slot: 'swimsuit', count: 1 },
  { slot: 'underwear', count: 1 }, { slot: 'headwear', count: 1 }, { slot: 'cape', count: 1 }, { slot: '(未分类)', count: 1 },
], 'slotDistribution:计数 + 降序 + 同数保持库内顺序 + (未分类)垫底')

// ── 条数钳制
eq(clampLimit(0, 5), 1, 'clampLimit:0 → 1')
eq(clampLimit(-9, 5), 1, 'clampLimit:负数 → 1')
eq(clampLimit(999, 5), 50, 'clampLimit:上限 50')
eq(clampLimit(3.7, 5), 3, 'clampLimit:取整')
eq(clampLimit(undefined, 3), 3, 'clampLimit:缺省回落')
eq(clampLimit('7', 5), 7, 'clampLimit:数字串也认')
eq(clampLimit('x', 5), 5, 'clampLimit:非数 → 回落')

// ── 相对时间(本地口径)
eq(fmtLastUsed('', now), '从未', 'fmtLastUsed:空 → 从未')
eq(fmtLastUsed(null, now), '从未', 'fmtLastUsed:null → 从未')
eq(fmtLastUsed('不是时间', now), '从未', 'fmtLastUsed:畸形 → 从未')
eq(fmtLastUsed('2026-09-16 14:59:30', now), '刚刚', 'fmtLastUsed:30 秒前 → 刚刚')
eq(fmtLastUsed('2026-09-16 14:55:00', now), '5min前', 'fmtLastUsed:5 分钟前')
eq(fmtLastUsed('2026-09-16 12:00:00', now), '3h前', 'fmtLastUsed:3 小时前')
eq(fmtLastUsed('2026-09-14 15:00:00', now), '2d前', 'fmtLastUsed:2 天前')
eq(fmtLastUsed('2026-08-18 15:30:04', now), '28d前', 'fmtLastUsed:跨月天数')

// ── 渲染:发散标题 + 表概览
const spreadText = render(clothingRows, spread, 'clothing')
ok(spreadText.includes('## 素材 · clothing · `发散(无条件)`'), '渲染:发散标题')
ok(spreadText.includes('表概览:9 条 · 被用过 7 条'), '渲染:表概览含总数与被用过的条数')
ok(spreadText.includes('槽位 top 2'), '渲染:表概览列槽位分布')
ok(spreadText.includes('| 名称 | 槽位 | reveal | signal | 已用 | 最后使用 | 备注 |'), '渲染:clothing 表头')
ok(spreadText.includes('| **top** |'), '★ 渲染:槽位分隔行')
ok(spreadText.includes('| **cape** |'), '渲染:动态槽位也出现')

// ── 渲染:收束行 + 单字提示
const cappedText = render(clothingRows, capped, 'clothing')
ok(cappedText.includes('收束:reveal_level≤2 9→5'), '渲染:收束留痕行')
const singleText = render(clothingRows, singleKw, 'clothing', { kws: ['透', '职场'] })
ok(singleText.includes('(单字词 透 不作命中依据,已忽略)'), '★ 渲染:单字词提示行')

// ── 渲染:命中不足两档
const noHitText = render(clothingRows, noHit, 'clothing', { kws: ['赛博'] })
ok(noHitText.includes('关键词未命中 → 建议 `roroko_datas_register`'), '★ 渲染:0 命中 → 关键词未命中提示')
const thin = pick(companionRows, 'companion', { kws: ['健身'], limit: 5 })
const thinText = render(companionRows, thin, 'companion', { kws: ['健身'], limit: 5, adhoc: [{ name: '网约车司机', description: '深夜接单' }] })
ok(thinText.includes('候选不足(1 条)'), '★ 渲染:候选不足提示')
ok(thinText.includes('| ad_hoc 临时条目 | 说明 |'), '渲染:ad_hoc 补位表')
ok(thinText.includes('| 网约车司机 | 深夜接单 |'), '渲染:ad_hoc 条目内容')

// ── 渲染:★ companion 走 last_used 列(旧实现读 last_used_at,永远显示"从未")
ok(thinText.includes('89d前'), '★ 渲染:companion 显示 last_used 的相对时间(旧 bug 回归)')
ok(!thinText.includes('从未'), '★ 渲染:companion 不再误报"从未"')

// ── 渲染:命中记录与时间脱节时说"未记录"
const textSpread = spreadText
ok(textSpread.includes('| 35 | 28d前 |'), '渲染:有命中也有时间的行正常显示')
ok(textSpread.includes('| 6 | 未记录 |'), '★ 渲染:hit_count>0 但没记时间 → 未记录')

// ── 渲染:无候选槽位
const slotHole = pick(clothingRows, 'clothing', { filters: { slot: ['bra'], revealLevel: 2 }, limit: 2 })
const holeText = render(clothingRows, slotHole, 'clothing')
ok(holeText.includes('| *(无候选)* |'), '★ 渲染:槽位被收束筛空 → 显示 (无候选)')

// ── 渲染:items 的 intensity 列
const itemRows = [
  { id: 1, name: '跳蛋', intensity_min: 2, intensity_max: 4, note: '', keywords: '["跳蛋"]', hit_count: 29, last_used_at: '' },
]
const itemPick = pick(itemRows, 'items', { limit: 3 })
const itemText = render(itemRows, itemPick, 'items')
ok(itemText.includes('| 名称 | intensity | 已用 | 最后使用 |'), '渲染:items 表头含 intensity(展示列,不参与收束)')
ok(itemText.includes('| 跳蛋 | 2~4 | 29 | 未记录 |'), '渲染:items 行')

// ── 渲染:非分组表不出槽位列
const compText = render(companionRows, pick(companionRows, 'companion', { limit: 5 }), 'companion')
ok(!compText.includes('槽位'), '渲染:companion 不出槽位列')

done('datas-query')
