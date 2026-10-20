/**
 * memory 子模块冒烟测试：时间口径 / 入参收窄 / dream 纯逻辑 / 参数四层链。
 *
 * 不连 DSH、不连真库：form / dream-form 是纯函数，presets 的合成与落盘只用临时
 * 目录。真库行为由线上工具自己验。
 *
 *   node test/memory-smoke.mjs
 */
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  apply,
  DEFAULT_MEMORY_DB_PATH,
  DREAM_DEFAULTS,
  buildDreamTask,
  clearMemoryBucket,
  diffReflected,
  escapeLike,
  fmtCst,
  memoryStateFile,
  normalizeAdd,
  normalizeDreamConfig,
  normalizeReflect,
  pickQueue,
  readMemoryState,
  resolveMemory,
  resolveRange,
  setMemoryBucket,
  splitKeywords,
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

// ── 时间口径 ────────────────────────────────────────────────────────────
// 存库格式必须是 CST，且与运行环境时区无关（服务器设成 UTC 也照对）。
eq('fmtCst 固定 +8 偏移', fmtCst(new Date('2026-10-19T19:04:12Z')), '2026-10-20 03:04:12')

const now = new Date('2026-10-20T03:04:12Z') // CST 2026-10-20 11:04
eq('区间默认 = 今天+昨天', resolveRange(undefined, undefined, now).range, { from: '2026-10-19', to: '2026-10-20' })
eq('只给 from', resolveRange('2026-10-10', undefined, now).range, { from: '2026-10-10', to: '2026-10-20' })
eq('只给 to = 那一天', resolveRange(undefined, '2026-10-01', now).range, { from: '2026-10-01', to: '2026-10-01' })
eq('都给 = 闭区间', resolveRange('2026-10-01', '2026-10-05', now).range, { from: '2026-10-01', to: '2026-10-05' })
check('from 晚于 to 报错而不是自动交换', resolveRange('2026-10-05', '2026-10-01', now).error !== undefined)
check('格式对但不存在的日期被挡', resolveRange('2026-02-30', undefined, now).error !== undefined)
eq('带时间的长串取前 10 位', resolveRange('2026-10-01 11:30:00', undefined, now).range?.from, '2026-10-01')

// ── 入参收窄 ────────────────────────────────────────────────────────────
const add = normalizeAdd({ owner: 'roroko', content: '  记一条  ', summary: '摘要' })
eq('add 收窄：trim + 无 kind + 默认空 source', add.input, {
  owner: 'roroko', content: '记一条', summary: '摘要', kind: '', source: '',
})
check('owner 带中文被拒', normalizeAdd({ owner: '洛洛可', content: 'a', summary: 'b' }).error !== undefined)
check('summary 超 300 字被拒', normalizeAdd({ owner: 'dev', content: 'a', summary: 'x'.repeat(301) }).error !== undefined)
check('content 超 2000 字被拒', normalizeAdd({ owner: 'dev', content: 'x'.repeat(2001), summary: 'b' }).error !== undefined)
eq('reflect 不传 summary = 保留原样（空串）', normalizeReflect({ id: 3, content: '新正文' }).input, {
  id: 3, content: '新正文', summary: '',
})
check('reflect 缺 id 被拒', normalizeReflect({ content: 'x' }).error !== undefined)

eq('关键词分隔符全认', splitKeywords(' 记忆, 检索、落地；foo/bar|baz '), ['记忆', '检索', '落地', 'foo', 'bar', 'baz'])
eq('关键词上限 8 个', splitKeywords('a b c d e f g h i j').length, 8)
eq('LIKE 通配符转义', escapeLike('100%_x'), '100\\%\\_x')

// ── dream 纯逻辑 ────────────────────────────────────────────────────────
const row = (id, reflected, kind = null) => ({
  id, owner: 'dev', content: `c${id}`, summary: `s${id}`,
  created_at: `2026-10-0${id} 10:00:00`, reflected_at: reflected, source: null, kind,
})
const rows = [row(1, null), row(2, '2026-10-02 10:00:00'), row(3, null, 'log'), row(4, '')]
const queue = pickQueue(rows, 20)
eq('队列只收未反思的', queue.entries.map(r => r.id), [1, 4])
eq('日志 kind 被跳过且计数', queue.skippedLogs, 1)
eq('batch 截断', pickQueue(rows, 1).entries.map(r => r.id), [1])

const task = buildDreamTask(queue.entries)
check('任务书声明记忆整理模式', task.includes('记忆整理模式'))
check('任务书只给清单不给正文', task.includes('#1') && !task.includes('c1'))
check('任务书里提示 retain 矛盾', task.includes('op=add'))

eq('门禁只认 reflected_at 真落下去', diffReflected([row(1, null)], [row(1, '2026-10-20 03:00:00')]), [1])
eq('门禁不认没变的', diffReflected([row(1, null)], [row(1, null)]), [])
eq('门禁不认"原本已反思"的', diffReflected([row(2, '2026-10-02 10:00:00')], [row(2, '2026-10-03 10:00:00')]), [])

const dreamCfg = normalizeDreamConfig({})
eq('dream 默认 4 小时', dreamCfg.intervalMs, DREAM_DEFAULTS.intervalMs)
eq('空串间隔回落默认而不是夹到下限', normalizeDreamConfig({ intervalMs: '' }).intervalMs, DREAM_DEFAULTS.intervalMs)
eq('间隔下限 5 分钟', normalizeDreamConfig({ intervalMs: 1000 }).intervalMs, 5 * 60 * 1000)
eq('间隔上限 24 小时', normalizeDreamConfig({ intervalMs: 9e9 }).intervalMs, 24 * 60 * 60 * 1000)
eq('batch 上限 50', normalizeDreamConfig({ batch: 999 }).batch, 50)

// ── 四层链 ──────────────────────────────────────────────────────────────
const base = resolveMemory({}, { presets: {} }, undefined)
eq('默认总开关是关的', base.enabled, false)
eq('默认库路径', base.dbPath, DEFAULT_MEMORY_DB_PATH)
eq('默认 owner 桶', base.owner, 'dev')

const wired = resolveMemory({ dbPath: '/tmp/a.db', owner: 'Wired' }, { presets: {} }, undefined)
eq('接线层生效', [wired.dbPath, wired.owner], ['/tmp/a.db', 'wired'])
eq('接线层打不开总开关（默认仍是关）', wired.enabled, false)

const state = {
  presets: {
    common: { enabled: true, owner: 'common', dream: { provider: 'p1', model: 'm1' } },
    roroko: { dbPath: '/tmp/b.db', dream: { batch: 5 } },
  },
}
const common = resolveMemory({}, state, undefined)
eq('公共桶覆盖总开关与 owner', [common.enabled, common.owner], [true, 'common'])
eq('公共桶 dream 逐字段叠加', [common.dream.provider, common.dream.batch], ['p1', DREAM_DEFAULTS.batch])
const specific = resolveMemory({}, state, 'roroko')
eq('分 preset 桶叠在公共桶之上', [specific.dbPath, specific.owner, specific.dream.provider, specific.dream.batch],
  ['/tmp/b.db', 'common', 'p1', 5])

// ── 覆盖层落盘 ──────────────────────────────────────────────────────────
const dir = await mkdtemp(join(tmpdir(), 'roroko-mem-'))
try {
  eq('坏文件当没有', readMemoryState(dir).presets, {})
  await writeFile(memoryStateFile(dir), '{ 不是 json', 'utf8').catch(() => {})
  await rm(memoryStateFile(dir), { force: true })

  await setMemoryBucket(dir, 'common', { enabled: true, dbPath: '/tmp/x.db', owner: 'ROKO-1' })
  const saved = readMemoryState(dir)
  eq('落盘后读回来', [saved.presets.common.enabled, saved.presets.common.dbPath, saved.presets.common.owner],
    [true, '/tmp/x.db', 'roko-1'])

  await setMemoryBucket(dir, 'common', { dream: { provider: 'p', model: 'm' } })
  eq('部分覆盖保留别的字段', readMemoryState(dir).presets.common.enabled, true)

  await setMemoryBucket(dir, 'roroko', { dream: { batch: 3 } })
  eq('第二个桶独立', Object.keys(readMemoryState(dir).presets).sort(), ['common', 'roroko'])

  await clearMemoryBucket(dir, 'roroko')
  eq('清桶后只剩公共', Object.keys(readMemoryState(dir).presets), ['common'])

  await setMemoryBucket(dir, 'temp', { enabled: false })
  await setMemoryBucket(dir, 'temp', { enabled: null })
  check('空桶自动删掉', !('temp' in readMemoryState(dir).presets))

  const raw = await readFile(memoryStateFile(dir), 'utf8')
  check('落盘是带缩进的 JSON 且末尾换行', raw.includes('\n  "presets"') && raw.endsWith('\n'))
  check('写的不是临时文件', !existsSync(`${memoryStateFile(dir)}.tmp`))

  // ── 挂载链路：默认关 → 打开 → 再关 ────────────────────────────────────
  const registered = new Map()
  const listeners = new Map()
  const fake = {
    tools: {
      register: (definition) => {
        registered.set(definition.name, definition)
        return () => { registered.delete(definition.name) }
      },
    },
    webServer: { register: () => () => {} },
    effect: (callback) => { callback(); return () => {} },
    on: (event, listener) => {
      listeners.set(event, listener)
      return () => {}
    },
    inject: (_services, callback) => { callback(fake); return () => {} },
  }
  const step = () => listeners.get('agent/pre-step')(
    { agent: { session: { header: { agentPreset: 'roroko' } } }, turn: 1 },
    async () => ({ kind: 'enter', messages: [] }),
  )

  await clearMemoryBucket(dir, 'common')
  apply(fake, { memory: { root: dir, dbPath: join(dir, 'm.db') } })
  eq('默认关时一把工具都不注册', [...registered.keys()], [])

  await setMemoryBucket(dir, 'common', { enabled: true })
  await step()
  eq('打开后注册四把工具', [...registered.keys()].sort(),
    ['roroko_mem_date', 'roroko_mem_edit', 'roroko_mem_id', 'roroko_mem_rough'])
  check('roroko_mem_edit 带 add/reflect 两个 op',
    JSON.stringify(registered.get('roroko_mem_edit')?.parameters?.properties?.op?.enum) === '["add","reflect"]')

  await setMemoryBucket(dir, 'common', { enabled: false })
  await step()
  eq('关掉后工具全撤下', [...registered.keys()], [])
  eq('工具已建表（库文件落盘）', existsSync(join(dir, 'm.db')), true)
} finally {
  await rm(dir, { recursive: true, force: true })
}

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 条失败`)
process.exitCode = failed === 0 ? 0 : 1
