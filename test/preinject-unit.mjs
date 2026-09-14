/**
 * preinject.js 纯函数测试:注入路径解析(路径宏) / 消息段落点计算。
 * 需要解析钩子:node --import ./test/helpers/register-stubs.mjs test/preinject-unit.mjs
 */
import { makeAsserts, useTempDshHome } from './helpers/harness.mjs'

const { ok, eq, done } = makeAsserts()

const home = await useTempDshHome('roroko-preinject-')
const { homedir } = await import('node:os')
const { join, resolve } = await import('node:path')

const { resolveInjectionPath, injectionIndex, resolveSessionPresetId } = await import('../lib/preinject.js')

const CWD = resolve('C:/tmp/workspace')
const PRESET = 'roroko-server'
const presetDir = join(home.dir, '.agent-presets', PRESET)

// ── 基本形态
eq(resolveInjectionPath('', CWD, PRESET), undefined, '空串 → undefined(整条跳过)')
eq(resolveInjectionPath('   ', CWD, PRESET), undefined, '空白串 → undefined')
eq(resolveInjectionPath('AGENTS.md', CWD, PRESET), resolve(CWD, 'AGENTS.md'), '裸文件名相对会话 cwd')
eq(resolveInjectionPath('  sub\\dir\\X.md  ', CWD, PRESET), resolve(CWD, 'sub\\dir\\X.md'), '两端空白被 trim')
eq(resolveInjectionPath(resolve(CWD, 'abs.md'), CWD, PRESET), resolve(CWD, 'abs.md'), '绝对路径原样返回')

// ── 路径宏
eq(
  resolveInjectionPath('${presetDir}/AGENTS.md', CWD, PRESET),
  join(presetDir, 'AGENTS.md'),
  '${presetDir} → <DSH_HOME>/.agent-presets/<presetId>/',
)
eq(
  resolveInjectionPath('${dshHome}/roroko/X.md', CWD, PRESET),
  join(home.dir, 'roroko', 'X.md'),
  '${dshHome} → $DSH_HOME(缺省 ~/.dsh)',
)
eq(resolveInjectionPath('${cwd}/X.md', CWD, PRESET), resolve(CWD, 'X.md'), '${cwd} → 会话工作区')
eq(
  resolveInjectionPath('${dshHome}/${presetDir}/X.md', CWD, PRESET),
  resolve(join(home.dir, presetDir), 'X.md'),
  '多个宏可以混用',
)

// ── 家目录写法
eq(resolveInjectionPath('~/shared/X.md', CWD, PRESET), join(homedir(), 'shared', 'X.md'), '~/ → 用户主目录')
eq(resolveInjectionPath('~', CWD, PRESET), homedir(), '单独的 ~ → 用户主目录')

// ── ★ ${presetDir} 的前置条件:拿不到 presetId 就整条跳过,绝不猜路径
eq(
  resolveInjectionPath('${presetDir}/AGENTS.md', CWD, undefined),
  undefined,
  '★ 会话没有 preset → 含 ${presetDir} 的条目整条跳过',
)
eq(
  resolveInjectionPath('${presetDir}/AGENTS.md', CWD, 'INVALID_NAME'),
  undefined,
  '★ preset id 不合契约(大写/下划线) → 整条跳过',
)
eq(
  resolveInjectionPath('${presetDir}/AGENTS.md', CWD, '-leading-dash'),
  undefined,
  '★ 以短横开头的 id 同样被拒',
)
ok(
  resolveInjectionPath('${presetDir}/AGENTS.md', CWD, 'valid-1') !== undefined,
  '合法 id(小写 + 数字 + 短横)正常解析',
)
ok(
  resolveInjectionPath('AGENTS.md', CWD, undefined) !== undefined,
  '不含 ${presetDir} 的条目不受 preset 缺失影响',
)

// ── 消息段落点计算
eq(injectionIndex(-1, 'after-user'), 0, '本步没认领到用户消息 → 落到数组开头(after-user)')
eq(injectionIndex(-1, 'before-user'), 0, '本步没认领到用户消息 → 落到数组开头(before-user)')
eq(injectionIndex(0, 'after-user'), 1, '默认落点:本批用户消息之后')
eq(injectionIndex(0, 'before-user'), 0, '可选落点:本批用户消息之前')
eq(injectionIndex(3, 'after-user'), 4, '多消息批次:紧跟最后一条之后')
eq(injectionIndex(3, 'before-user'), 3, '多消息批次:插在最后一条之前')

// ── ★ 当前生效的 preset id:log 优先于「创建时」header(2026-09-14 修)
// 真实数据取自本机 ~/.dsh/sessions:header 写 roroko-gamedev,4 秒后切 roroko-dsh,
// header 全程不动 —— 旧代码拿 header 就会用错 preset。
const sel = id => ({ type: 'agent-preset/selected', data: { agentPreset: id } })

eq(resolveSessionPresetId(undefined, 'roroko-gamedev'), 'roroko-gamedev', '无 log → 回落 header')
eq(resolveSessionPresetId([], 'roroko-gamedev'), 'roroko-gamedev', '空 log → 回落 header')
eq(resolveSessionPresetId(null, 'roroko-gamedev'), 'roroko-gamedev', 'log 非数组 → 回落 header')
eq(resolveSessionPresetId({ 0: sel('x') }, 'roroko-gamedev'), 'roroko-gamedev', 'log 是对象(非数组) → 回落 header')
eq(resolveSessionPresetId(undefined, undefined), undefined, '两者都没有 → undefined')
eq(
  resolveSessionPresetId([sel('roroko-dsh')], 'roroko-gamedev'),
  'roroko-dsh',
  '★ 本机实况:log 里的选择覆盖创建时 header',
)
eq(
  resolveSessionPresetId([sel('a'), sel('b'), sel('c')], 'roroko-gamedev'),
  'c',
  '★ 多条选择事件 → 取最后一条',
)
eq(
  resolveSessionPresetId([{ type: 'user/message' }, sel('roroko-dsh'), { type: 'turn/start' }], 'std'),
  'roroko-dsh',
  '★ 取最后一条,与它在 log 中的位置无关',
)
eq(
  resolveSessionPresetId([sel(''), sel('ok')], 'std'),
  'ok',
  '末尾事件 id 为空串(畸形) → 跳过继续往前找',
)
eq(resolveSessionPresetId([sel(''), sel(1), sel(null)], 'std'), 'std', '全是畸形值 → 回落 header')
eq(
  resolveSessionPresetId([{ type: 'agent-preset/selected' }, { type: 'agent-preset/selected', data: {} }], 'std'),
  'std',
  '事件缺 data / 缺字段 → 不误判,回落 header',
)

// 真实事件行(2026-09-14 从 ~/.dsh/sessions 里解出来的原文,保留 seq/time 字段形)
const realSelected = JSON.parse(
  '{"type":"agent-preset/selected","seq":3,"time":1789367682289,"data":{"agentPreset":"roroko-dsh"}}',
)
eq(
  resolveSessionPresetId([{ type: 'turn/start' }, realSelected], 'roroko-gamedev'),
  'roroko-dsh',
  '★ 真实 log 原文(带 seq/time)→ 取 roroko-dsh,不是创建时的 roroko-gamedev',
)

// 端到端效果:同一份 log 决定 ${presetDir} 落在哪个目录(修前会指向 gamedev)
const livePreset = resolveSessionPresetId([realSelected], 'roroko-gamedev')
eq(
  resolveInjectionPath('${presetDir}/AGENTS.md', CWD, livePreset),
  join(home.dir, '.agent-presets', 'roroko-dsh', 'AGENTS.md'),
  '★ 同一份 log:${presetDir} 落到 roroko-dsh 目录,而非创建时的 roroko-gamedev',
)

home.cleanup()
process.exit(done('preinject 纯函数'))
