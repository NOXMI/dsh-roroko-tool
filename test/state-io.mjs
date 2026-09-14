/**
 * state.js 文件 IO 测试:路径推导 / 原子写 / 部分保存合并 / 旧版迁移 / 损坏回落。
 * 运行:node test/state-io.mjs
 */
import { makeAsserts, useTempDshHome } from './helpers/harness.mjs'

const { ok, eq, done } = makeAsserts()

// 必须先隔离 DSH_HOME,再 import lib(ESM 顶层求值会读进程环境)
const home = await useTempDshHome('roroko-state-')
const { existsSync, readFileSync, readdirSync, writeFileSync } = await import('node:fs')
const state = await import('../lib/state.js')
const settings = await import('../lib/settings.js')

const DEFAULTS = settings.RorokoToolStateDefault

// ── 路径推导
eq(state.dshHomeDirectory(), home.dir, 'DSH_HOME 生效')
eq(
  state.rorokoToolStatePath(),
  home.statePath,
  'state 路径 = <DSH_HOME>/profiles/<profile>/roroko-tool-state.json',
)

// ── 缺文件 → 回落默认(不抛)
eq((await state.loadState()).presets, {}, '缺文件时 loadState 回落默认')
eq(state.loadStateSync().mark.enabled, true, '缺文件时 loadStateSync 回落默认')

// ── 往返 + 原子写不留 .tmp
await state.saveState({ ...DEFAULTS, data: { dbPath: '/tmp/x.db' } })
ok(existsSync(home.statePath), 'saveState 落盘')
eq(JSON.parse(readFileSync(home.statePath, 'utf8')).data.dbPath, '/tmp/x.db', '落盘内容读得回来')
ok(
  !readdirSync(home.profileDir).some(name => name.endsWith('.tmp')),
  '原子写(临时文件 + rename)不留 .tmp 残留',
)

// ── ★ 设置页核心链路:两次部分保存 → 合并成一组
await state.setPreinjectConfig('common', { systemFiles: ['AGENTS.md'] })
await state.setPreinjectConfig('common', { files: ['PLAYER.md'] })
let current = await state.loadState()
eq(
  current.presets.common.preinject,
  { systemFiles: ['AGENTS.md'], files: ['PLAYER.md'] },
  '★ 两次部分保存按字段合并(A 组 + B 组都在)',
)

// ── 空数组是显式设定(能清空清单)
await state.setPreinjectConfig('common', { files: [] })
eq(
  (await state.loadState()).presets.common.preinject.files,
  [],
  '★ 空清单被接受(显式清空,不是"未覆盖")',
)

// ── 一个合法字段都不给 → 不留空桶(免得把 preset config 压住)
await state.setPreinjectConfig('empty-scope', {})
ok(
  (await state.loadState()).presets['empty-scope'] === undefined,
  '不提供任何合法字段 → 不生成空桶',
)

// ── per-preset 分桶互相隔离
await state.setPreinjectConfig('roroko-server', { files: ['SERVER.md'] })
current = await state.loadState()
eq(current.presets['roroko-server'].preinject.files, ['SERVER.md'], '具体 preset 桶独立保存')
eq(current.presets.common.preinject.files, [], '另一桶内容不受影响')

// ── 删桶(reset 语义)
await state.clearPreinjectConfig('roroko-server')
ok((await state.loadState()).presets['roroko-server'] === undefined, 'clearPreinjectConfig 删掉该桶')

// ── data 节:空白串不覆盖旧值
await state.setDataConfig({ dbPath: '/a/soul.db' })
await state.setDataConfig({ dbPath: '   ' })
eq((await state.loadState()).data.dbPath, '/a/soul.db', '空白 dbPath 不覆盖既有值')
await state.setDataConfig({ dbPath: '/b/soul.db' })
eq((await state.loadState()).data.dbPath, '/b/soul.db', '正常 dbPath 覆盖成功')

// ── mark 节:缺字段保留旧值
await state.setMarkConfig({ enabled: false })
eq((await state.loadState()).mark.enabled, false, 'mark 开关落盘')
await state.setMarkConfig({})
eq((await state.loadState()).mark.enabled, false, 'mark 缺字段时保留旧值')

// ── 损坏文件 → 回落默认(不抛)
writeFileSync(home.statePath, '{ 这不是 json', 'utf8')
eq((await state.loadState()).presets, {}, '损坏 state 回落默认不抛')
eq(state.loadStateSync().data.dbPath, DEFAULTS.data.dbPath, '损坏 state 的同步读同样回落')

// ── profile 名从 CLI 参数推导(子进程验证,避免改本进程 argv)
const { spawnSync } = await import('node:child_process')
const { pathToFileURL } = await import('node:url')
const { join } = await import('node:path')
const libUrl = pathToFileURL(join(process.cwd(), 'lib', 'state.js')).href
// 用临时脚本文件而不是 `node -e`:--profile 必须作为「脚本参数」传给进程,
// 否则会被 node 自己当 CLI 选项解析并报 bad option。
const probePath = join(home.dir, 'probe-profile.mjs')
writeFileSync(
  probePath,
  `import { rorokoToolStatePath } from ${JSON.stringify(libUrl)}\nconsole.log(rorokoToolStatePath())\n`,
  'utf8',
)
const probe = spawnSync(
  process.execPath,
  [probePath, '--profile', 'roroko-server'],
  { env: { ...process.env, DSH_HOME: home.dir }, encoding: 'utf8' },
)
eq(
  (probe.stdout ?? '').trim(),
  join(home.dir, 'profiles', 'roroko-server', 'roroko-tool-state.json'),
  '--profile <name> 决定 profiles/<name> 子目录',
)

home.cleanup()
process.exit(done('state 文件 IO'))
