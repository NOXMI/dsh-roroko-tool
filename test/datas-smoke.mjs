/**
 * datas 子模块冒烟测试：取料纯逻辑 + 参数四层链 + 覆盖层读写。
 *
 * 不连库、不连 DSH：query-form 的匹配/收束/渲染是纯函数，presets 的合成与落盘
 * 只用临时目录。真库行为由线上工具自己验。
 *
 *   node test/datas-smoke.mjs
 */
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AUTOINJECT_DEFAULTS,
  DEFAULT_DB_PATH,
  clearDatasBucket,
  datasStateFile,
  pickCandidates,
  readDatasState,
  renderQuery,
  resolveDatas,
  scoreRow,
  setDatasBucket,
  splitKws,
} from '../lib/index.mjs'

let failed = 0
const check = (name, ok, detail) => {
  if (ok) {
    console.log(`PASS  ${name}`)
  } else {
    failed += 1
    console.log(`FAIL  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  check(name, a === e, `得到 ${a}，应为 ${e}`)
}

// ── 匹配口径 ────────────────────────────────────────────────────────────
const single = { keywords: '["透","透明","夜"]' }
check('记录侧单字 token 不参与匹配', scoreRow({ keywords: '["透","夜"]' }, ['透']) === 0)
check('单字查询词只能靠双字 token 包含命中 +1', scoreRow(single, ['透']) === 1)
check('双字 token 完全相等 +2', scoreRow(single, ['透明']) === 2)
check('双向包含各 +1', scoreRow({ keywords: '["职场","干练"]' }, ['职场装']) === 1)
eq('查询词拆分去空白去重', splitKws(' 职场, 干练 ,,职场'), ['职场', '干练'])

// ── 收束链 ──────────────────────────────────────────────────────────────
const clothing = [
  { name: '白衬衫', slot: 'top', reveal_level: 1, signal_level: 1, keywords: '["职场","干练"]', hit_count: 3 },
  { name: '条带背心', slot: 'top', reveal_level: 3, signal_level: 2, keywords: '["职场"]', hit_count: 0 },
  { name: '包臀裙', slot: 'bottom', reveal_level: 2, signal_level: 3, keywords: '["职场"]', hit_count: 1 },
  { name: '无主内裤', slot: '', reveal_level: 1, signal_level: 1, keywords: '["职场"]', hit_count: 0 },
]
const capped = pickCandidates(clothing, {
  tableKey: 'clothing',
  kws: ['职场'],
  filters: { revealLevel: 2 },
  limit: 2,
  rng: () => 0.5,
})
check('收束链留痕：一条 reduce 记录', capped.steps.length === 1 && capped.steps[0].label === 'reveal_level≤2')
check('收束后排除高暴露单品', capped.groups.every(g => g.rows.every(r => r.name !== '条带背心')))
check('显式点名但筛空的槽位也列出来', pickCandidates(clothing, {
  tableKey: 'clothing',
  kws: ['职场'],
  filters: { slot: ['headwear'] },
  limit: 1,
  rng: () => 0.5,
}).groups.some(g => g.raw === 'headwear' && g.rows.length === 0))
const grouped = pickCandidates(clothing, { tableKey: 'clothing', kws: ['职场'], filters: {}, limit: 2, rng: () => 0.5 })
check('空槽位归 (未分类) 且排最后', grouped.groups.at(-1).slot === '(未分类)')
check('槽位分布统计全表', grouped.slotStats.length === 3)

// 发散：无关键词时全池随机，命中数为 0
const spread = pickCandidates(clothing, { tableKey: 'clothing', kws: [], filters: {}, limit: 2, rng: () => 0.5 })
check('无关键词 = 发散，不按分数过滤', spread.poolSize === clothing.length && spread.matched === clothing.length)

// ── 渲染 ────────────────────────────────────────────────────────────────
const rendered = renderQuery({
  tableKey: 'clothing',
  kws: ['职场'],
  pick: capped,
  total: clothing.length,
  usedCount: 2,
  limit: 2,
  adhoc: [],
  now: new Date('2026-10-20T00:00:00Z'),
})
check('标题带关键词', rendered.startsWith('## 素材 · clothing · `职场`'))
check('表概览带总条数与被用过条数', rendered.includes('4 条') && rendered.includes('被用过 2 条'))
check('收束链写进正文', rendered.includes('reveal_level≤2 4→3'))
check('穿搭渲染按槽位分组（粗体槽位行）', rendered.includes('| **top** |'))

const missRender = renderQuery({
  tableKey: 'scene',
  kws: ['地铁'],
  pick: { poolSize: 0, matched: 0, steps: [], rows: [], groups: [], slotStats: [], usedKws: ['地铁'], droppedKws: [] },
  total: 10,
  usedCount: 0,
  limit: 5,
  adhoc: [],
})
check('未命中提示去 register', missRender.includes('关键词未命中'))

const droppedRender = renderQuery({
  tableKey: 'scene',
  kws: ['夜'],
  pick: { poolSize: 1, matched: 1, steps: [], rows: [{ name: '阳台', hit_count: 0 }], groups: [], slotStats: [], usedKws: [], droppedKws: ['夜'] },
  total: 10,
  usedCount: 0,
  limit: 5,
  adhoc: [],
})
check('单字词被忽略时正文说明', droppedRender.includes('单字词 夜 不作命中依据'))

// ── 参数四层链 ──────────────────────────────────────────────────────────
const root = await mkdtemp(join(tmpdir(), 'roroko-datas-'))
try {
  eq('没有覆盖层时全走默认（总开关默认关）', resolveDatas({}, { presets: {} }, undefined), {
    enabled: false,
    dbPath: DEFAULT_DB_PATH,
    autoinject: AUTOINJECT_DEFAULTS,
  })

  await setDatasBucket(root, 'common', { enabled: true, autoinject: { every: 12 } })
  const withCommon = readDatasState(root)
  eq('公共桶打开总开关', resolveDatas({}, withCommon, undefined).enabled, true)
  eq('公共桶只改 every，其余字段仍按默认', resolveDatas({}, withCommon, undefined).autoinject, {
    ...AUTOINJECT_DEFAULTS,
    every: 12,
  })

  await setDatasBucket(root, 'roroko', { enabled: false, dbPath: ' /tmp/x.db ' })
  const withPreset = readDatasState(root)
  eq('分桶可以单独关掉（压过公共桶）', resolveDatas({}, withPreset, 'roroko').enabled, false)
  eq('分桶 dbPath 覆盖公共层', resolveDatas({}, withPreset, 'roroko').dbPath, '/tmp/x.db')
  eq('分桶没写的字段继续吃公共层', resolveDatas({}, withPreset, 'roroko').autoinject.every, 12)

  eq('接线 config 在覆盖层之下', resolveDatas({ dbPath: '/w.db' }, withPreset, 'other').dbPath, '/w.db')
  eq('接线 config 的 autoinject 也逐字段叠', resolveDatas({ autoinject: { minGap: 2 } }, withPreset, 'roroko').autoinject.minGap, 2)

  await setDatasBucket(root, 'roroko', { dbPath: null })
  eq('字段传 null 删键，剩下的字段还在', readDatasState(root).presets.roroko, { enabled: false })
  await setDatasBucket(root, 'roroko', { enabled: null })
  check('键删空后整桶消失', readDatasState(root).presets.roroko === undefined)

  await setDatasBucket(root, 'tmp', { dbPath: '/t.db' })
  await clearDatasBucket(root, 'tmp')
  check('reset 删掉整桶', readDatasState(root).presets.tmp === undefined)

  await setDatasBucket(root, 'clamp', { autoinject: { every: 999, minGap: -3 } })
  eq('数值越界被钳住', readDatasState(root).presets.clamp.autoinject, { every: 200, minGap: 0 })

  check('覆盖层文件落在 <root>/state/datas.json', existsSync(datasStateFile(root)))
  check('落盘 JSON 可读且有 presets', JSON.parse(await readFile(datasStateFile(root), 'utf8')).presets !== undefined)

  await writeFile(datasStateFile(root), '{ 坏掉的 json', 'utf8')
  eq('坏文件当没有，不抛', readDatasState(root), { presets: {} })
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
