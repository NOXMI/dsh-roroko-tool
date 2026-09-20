/**
 * settings.js 纯函数测试:归一化 / 旧版迁移 / 覆盖叠加 / 兼容视图。
 * 运行:node test/settings-unit.mjs
 */
import {
  RorokoDataDefaultDbPath, ROROKO_COMMON_SCOPE, ROROKO_TOOL_KEYS, RorokoToolStateDefault,
  isRorokoToolKey, normalizeDreamState, normalizePreinjectOverride, normalizeState,
  preinjectView, resolvePresetOverride,
} from '../lib/settings.js'
import { makeAsserts } from './helpers/harness.mjs'

const { ok, eq, done } = makeAsserts()

// ── 默认状态形状
eq(RorokoToolStateDefault.presets, {}, '默认 presets 为空对象(不写默认值压 preset config)')
eq(RorokoToolStateDefault.data.dbPath, RorokoDataDefaultDbPath, '默认 dbPath = 服务器路径')
eq(RorokoToolStateDefault.mark.enabled, true, '默认 mark.enabled = true')
eq(RorokoToolStateDefault.warn, {}, '默认 warn 为空节')

// ── dream 节:字段全可选,默认值一个都不写(否则会把 preset config 永久压住)
eq(RorokoToolStateDefault.dream, {}, '默认 dream 为空桶 = 未覆盖')
ok(ROROKO_TOOL_KEYS.includes('dream'), '工具键含 dream')
eq(normalizeDreamState(undefined), {}, 'undefined → 空桶')
eq(normalizeDreamState(42), {}, '非对象 → 空桶')
eq(
  normalizeDreamState({ provider: ' deepseek ', model: 'm', batch: 2.7, 未知键: 'x' }),
  { provider: 'deepseek', model: 'm', batch: 2 },
  '只留出现过的合法字段(trim / 取整 / 丢未知键)',
)
eq(normalizeDreamState({ enabled: 'yes', intervalMs: 'x' }), {}, '类型不对的字段一律丢')
eq(normalizeDreamState({ enabled: false, logDir: '/tmp/d' }), { enabled: false, logDir: '/tmp/d' }, '布尔与字符串照收')
eq(normalizeState({ dream: { provider: 'p' } }).dream, { provider: 'p' }, 'normalizeState 认 dream 节')
eq(normalizeState({}).dream, {}, '没有 dream 节时回落空桶')

// ── normalizeState 容错:绝不抛
for (const bad of [null, undefined, 42, 'x', [], true]) {
  const state = normalizeState(bad)
  eq(state.presets, {}, `normalizeState(${JSON.stringify(bad)}) 回落默认`)
}
ok(normalizeState({ 未知键: 1 }).presets !== undefined, '未知键被丢弃且不抛')

// ── 旧版扁平 state 迁移(2026-09-11 四改之前)
const legacy = normalizeState({
  preinject: {
    files: ['PLAYER.md', 'MEMORY.md'],
    systemFiles: [],            // 旧语义:空 = 未覆盖 → 迁移时丢弃
    header: '',                 // 同上
    wrapInSystemReminder: false, // 旧语义:false 不算显式设定
    systemOrder: 100,
  },
  data: { dbPath: '/x/soul.db' },
  mark: { enabled: false },
})
eq(legacy.presets[ROROKO_COMMON_SCOPE].preinject.files, ['PLAYER.md', 'MEMORY.md'], '旧扁平 files 迁进 common 桶')
ok(legacy.presets[ROROKO_COMMON_SCOPE].preinject.systemFiles === undefined, '旧版空清单迁移时被丢弃')
ok(legacy.presets[ROROKO_COMMON_SCOPE].preinject.wrapInSystemReminder === undefined, '旧版 false 迁移时被丢弃')
eq(legacy.presets[ROROKO_COMMON_SCOPE].preinject.systemOrder, 100, '旧版数字字段保留')
eq(legacy.data.dbPath, '/x/soul.db', '旧版 data 节迁入')
eq(legacy.mark.enabled, false, '旧版 mark 节迁入')

// ── 覆盖层归一化:非法值一律不认
eq(normalizePreinjectOverride(null), undefined, 'null 覆盖层 → undefined(空桶不入 state)')
eq(normalizePreinjectOverride({}), undefined, '空对象 → undefined')
eq(normalizePreinjectOverride({ systemFiles: 'not-array' }), undefined, '字符串当清单 → 丢弃')
eq(
  normalizePreinjectOverride({ systemFiles: ['A.md', 42, null, 'B.md'] }),
  { systemFiles: ['A.md', 'B.md'] },
  '清单里的非字符串被过滤',
)
eq(normalizePreinjectOverride({ systemOrder: Number.NaN }), undefined, 'NaN order → 丢弃')
eq(normalizePreinjectOverride({ filesPlacement: 'sideways' }), undefined, '非法落点档位 → 丢弃')
eq(
  normalizePreinjectOverride({ filesPlacement: 'before-user', splitFiles: true }),
  { filesPlacement: 'before-user', splitFiles: true },
  '合法布尔/枚举保留',
)
eq(
  normalizePreinjectOverride({ systemFiles: [] }),
  { systemFiles: [] },
  '★ 空数组是显式设定(四改语义:允许把清单清空)',
)

// ── preset 分桶叠加:具体桶叠在 common 之上,字段级
const bucketState = normalizeState({
  presets: {
    common: { preinject: { files: ['PLAYER.md'], systemOrder: 100, header: '<common>' } },
    'roroko-server': { preinject: { files: ['SERVER.md'], splitFiles: true } },
  },
})
eq(
  resolvePresetOverride(bucketState, 'roroko-server'),
  { files: ['SERVER.md'], systemOrder: 100, header: '<common>', splitFiles: true },
  '具体桶字段覆盖 common,未覆盖字段回落 common',
)
eq(
  resolvePresetOverride(bucketState, 'standard'),
  { files: ['PLAYER.md'], systemOrder: 100, header: '<common>' },
  '没有专属桶的 preset 只用 common',
)
eq(resolvePresetOverride(bucketState, undefined), bucketState.presets.common.preinject, 'undefined preset 取 common')
eq(resolvePresetOverride(normalizeState({}), 'x'), {}, '全空 state → 空覆盖层')

// ── 兼容视图:override + 内置默认合成
const view = preinjectView({ files: ['ONLY.md'] })
eq(view.files, ['ONLY.md'], '兼容视图用 override 的清单')
eq(view.systemFiles, ['AGENTS.md', 'IDENTITY.md'], '未覆盖字段回落内置默认 systemFiles')
eq(view.filesPlacement, 'after-user', '默认落点 = 本批用户消息之后')
eq(view.splitFiles, false, '默认合并成一条')
eq(
  preinjectView({ files: [], systemFiles: [] }).files,
  [],
  '★ 显式空清单在兼容视图里保持为空(不被默认值盖回来)',
)

// ── 工具键窄化
for (const key of ['preinject', 'data', 'warn', 'mark']) ok(isRorokoToolKey(key), `isRorokoToolKey('${key}')`)
for (const key of ['Preinject', '', 'unknown', 0, null]) ok(!isRorokoToolKey(key), `isRorokoToolKey(${JSON.stringify(key)}) 拒绝`)

process.exit(done('settings 纯函数'))
