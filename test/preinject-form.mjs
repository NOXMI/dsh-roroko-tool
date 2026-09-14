/**
 * preinject-form.js 纯函数测试:界面表单 ↔ 落盘 payload ↔ 继承基线。
 * 零依赖,直读 lib/ 产物:node test/preinject-form.mjs
 */
import { makeAsserts } from './helpers/harness.mjs'

const { ok, eq, done } = makeAsserts()

const {
  toList, toStr, toNum, cleanList,
  hasSystemOverride, hasMessageOverride,
  formFromState, payloadFromForm, formEquals, ensureRowIds,
} = await import('../lib/preinject-form.js')

// ── 字段兜底
eq(toList(undefined), [], 'toList:undefined → 空单')
eq(toList('x'), [], 'toList:非数组 → 空单')
eq(toList(['a', 1, 'b']), ['a', 'b'], 'toList:剔除非字符串项')
eq(toStr(undefined), '', 'toStr:undefined → 空串')
eq(toStr(7), '', 'toStr:非字符串 → 空串')
eq(toNum(undefined, 42), 42, 'toNum:非数字 → 兜底值')
eq(toNum(Number.NaN, 42), 42, 'toNum:NaN → 兜底值')
eq(toNum(0, 42), 0, 'toNum:0 是有效值,不吃兜底')

// ── 落盘前清洗
eq(cleanList([' a.md ', '', '  ', 'a.md', 'b.md']), ['a.md', 'b.md'], 'cleanList:去空白 + 去空行 + 去重')
eq(cleanList(undefined), [], 'cleanList:非数组 → 空单(不抛)')
eq(cleanList(['  x  ']), ['x'], 'cleanList:单项两端空白')

// ── 覆盖层判据(字段存在即算覆盖 —— 空数组是"显式清空",不是"没设")
ok(!hasSystemOverride({}), '空覆盖层:系统段未覆盖')
ok(hasSystemOverride({ systemFiles: [] }), '★ 空清单也算已覆盖(显式清空 ≠ 跟随继承)')
ok(hasSystemOverride({ systemOrder: 0 }), 'systemOrder:0 也算已覆盖')
ok(!hasMessageOverride({}), '空覆盖层:消息段未覆盖')
ok(hasMessageOverride({ splitFiles: false }), '★ splitFiles:false 也算已覆盖')
ok(hasMessageOverride({ wrapInSystemReminder: false }), 'wrap:false 也算已覆盖')
ok(!hasMessageOverride({ systemFiles: ['a.md'] }), '系统段字段不污染消息段判据')
ok(!hasSystemOverride({ files: ['a.md'] }), '消息段字段不污染系统段判据')

// ── 表单快照:继承基线
const base = {
  systemFiles: ['AGENTS.md'],
  systemOrder: 0,
  systemHeader: 'sys-head',
  systemFooter: 'sys-foot',
  files: ['PLAYER.md'],
  header: '<r>',
  footer: '</r>',
  wrapInSystemReminder: true,
  filesPlacement: 'after-user',
  splitFiles: false,
}

const inherited = formFromState(undefined, base)
eq(inherited.coverSystem, false, '无覆盖:系统段开关关')
eq(inherited.coverMessage, false, '无覆盖:消息段开关关')
eq(inherited.systemFiles, ['AGENTS.md'], '无覆盖:清单跟随基线')
eq(inherited.systemOrder, 0, '无覆盖:order 跟随基线')
eq(inherited.wrap, true, '无覆盖:布尔跟随基线')
eq(inherited.placement, 'after-user', '无覆盖:落点跟随基线')
eq(formFromState({}, base), inherited, '★ 空对象覆盖层 === 无覆盖(旧版 state 常见形态)')

// ── 表单快照:覆盖叠加(缺字段回落基线)
const layered = formFromState({ files: ['A.md', 'B.md'], splitFiles: true }, base)
eq(layered.coverMessage, true, '有覆盖:消息段开关开')
eq(layered.files, ['A.md', 'B.md'], '有覆盖:清单取覆盖值')
eq(layered.split, true, '有覆盖:split 取覆盖值')
eq(layered.header, '<r>', '★ 覆盖层没写的字段仍回落基线')
eq(layered.coverSystem, false, '★ 只覆盖消息段时,系统段开关仍关')
eq(layered.systemFiles, ['AGENTS.md'], '★ 只覆盖消息段时,系统段清单不动')

const cleared = formFromState({ files: [] }, base)
eq(cleared.coverMessage, true, '★ 显式清空:空清单仍算已覆盖')
eq(cleared.files, [], '★ 显式清空:清单为空')
eq(cleared.header, '<r>', '★ 显式清空只清清单,header 回落基线')

eq(formFromState(undefined, { ...base, wrapInSystemReminder: undefined }).wrap, false, '基线布尔缺失 → false(不炸)')
eq(formFromState(undefined, { ...base, filesPlacement: 'before-user' }).placement, 'before-user', '基线落点保留')
eq(formFromState({ filesPlacement: 'before-user' }, base).placement, 'before-user', '覆盖落点生效')

// ── 落盘 payload:不勾覆盖 = 一个字段都不发
const nonePayload = payloadFromForm(inherited)
eq(Object.keys(nonePayload), [], '★ 两组都不勾 → 空 payload(调用方按"清桶"处理)')
ok(!('systemFiles' in nonePayload), '★ 不勾系统段时,payload 里绝无 systemFiles(否则会压住 preset config)')
ok(!('files' in nonePayload), '★ 不勾消息段时,payload 里绝无 files')

const systemOnly = payloadFromForm({ ...inherited, coverSystem: true })
eq(
  Object.keys(systemOnly).sort(),
  ['systemFiles', 'systemFooter', 'systemHeader', 'systemOrder'],
  '★ 只勾系统段 → payload 恰好四个系统字段,一个不多',
)

const messageOnly = payloadFromForm({ ...inherited, coverMessage: true })
eq(
  Object.keys(messageOnly).sort(),
  ['files', 'filesPlacement', 'footer', 'header', 'splitFiles', 'wrapInSystemReminder'],
  '★ 只勾消息段 → payload 恰好六个消息字段',
)
ok(!('systemFiles' in messageOnly), '★ 只勾消息段时不带 systemFiles')

const both = payloadFromForm({ ...inherited, coverSystem: true, coverMessage: true })
eq(Object.keys(both).length, 10, '两组都勾 → 十个字段')

// ── 落盘 payload:清洗语义
const messy = payloadFromForm({
  ...inherited,
  coverSystem: true,
  coverMessage: true,
  systemFiles: ['  AGENTS.md  ', '', 'AGENTS.md'],
  systemOrder: 7,
  systemHeader: '  head  ',
  files: [' PLAYER.md '],
  header: '  <r>  ',
  footer: '  ',
})
eq(messy.systemFiles, ['AGENTS.md'], 'payload:清单去空白去重')
eq(messy.systemOrder, 7, 'payload:order 原样')
eq(messy.systemHeader, 'head', 'payload:header 去两端空白')
eq(messy.files, ['PLAYER.md'], 'payload:消息段清单同样清洗')
eq(messy.header, '<r>', 'payload:消息段 header 去空白')
eq(messy.footer, '', 'payload:空白 footer 落成空串(显式清空,不是不发)')

// ── 脏判定:formEquals 必须是"按内容比"
const copy = formFromState(undefined, base)
eq(formEquals(inherited, copy), true, '★ 不同引用、同内容 → 等价(dirty 判定靠这个)')
eq(formEquals(formFromState(undefined, base), formFromState(undefined, base)), true, '★ 连续两次推导出的快照等价')
eq(formEquals(inherited, { ...inherited, header: 'x' }), false, '改了 header → 不等价')
eq(formEquals(inherited, { ...inherited, files: ['A.md'] }), false, '改了清单 → 不等价')
eq(formEquals(inherited, { ...inherited, files: ['PLAYER.md', 'X.md'] }), false, '清单加一项 → 不等价')
eq(formEquals(inherited, { ...inherited, wrap: false }), false, '布尔翻转 → 不等价')
eq(formEquals(inherited, { ...inherited, placement: 'before-user' }), false, '落点切换 → 不等价')
eq(formEquals(inherited, { ...inherited, coverSystem: true }), false, '★ 只勾开关也算改动')
eq(formEquals({ ...inherited, files: ['A', 'B'] }, { ...inherited, files: ['B', 'A'] }), false, '清单顺序不同 → 不等价')

// ── 脏判定:模拟一次完整的「改 → 保存 → 干净」回合
// 真实流程:清单编辑器只在勾了「覆盖」时才出现,所以起点是已覆盖的表单。
const coveredOverride = {
  files: ['PLAYER.md'],
  header: '<r>',
  footer: '</r>',
  wrapInSystemReminder: true,
  filesPlacement: 'after-user',
  splitFiles: false,
}
const covered = formFromState(coveredOverride, base)
ok(formEquals(covered, formFromState(coveredOverride, base)), '★ 刚加载完:干净(不该亮未保存)')
const edited = { ...covered, files: ['PLAYER.md', 'A.md'] }
ok(!formEquals(edited, covered), '★ 改了清单没保存:脏(该亮未保存)')
// 保存 = 这个 payload 落盘,成功后服务端回执把覆盖层更新成落盘值。
const savedLayer = payloadFromForm(edited)
ok(formEquals(edited, formFromState(savedLayer, base)), '★ 保存成功、回执与表单一致:又变干净("已保存"该亮)')
ok(!formEquals({ ...covered, coverMessage: false }, covered), '★ 取消勾选覆盖也是改动(哪怕字段没动)')

// 带首尾空白的输入:落盘会被 trim,表单须靠 props 重同步才转干净
// (组件里由 useEffect([override, baseline]) 负责,这条钉住契约)。
const messyForm = { ...covered, header: '  <r>  ' }
const messyLayer = payloadFromForm(messyForm)
eq(messyLayer.header, '<r>', '带空白输入:落盘值已 trim')
ok(!formEquals(messyForm, formFromState(messyLayer, base)), '★ 未重同步时仍判脏(提醒用户还没落实)')
ok(
  formEquals({ ...messyForm, header: '<r>' }, formFromState(messyLayer, base)),
  '★ 重同步成落盘值后:干净',
)

// ── 行身份牌对齐(FileListEditor 的 key)
let seq = 0
const mint = () => `f${seq++}`
const ids = ['a', 'b']
ok(ensureRowIds(ids, 2, mint) === ids, '长度一致 → 原样返回同一个数组引用(保住行身份)')
eq(ensureRowIds(ids, 2, mint), ['a', 'b'], '原样返回内容不变')
eq(ensureRowIds([], 2, mint).length, 2, '长度变了 → 整批换新')
eq(new Set(ensureRowIds(['a'], 3, mint)).size, 3, '新 id 互不相同')
eq(ensureRowIds(['a', 'b'], 0, mint), [], '清空 → 空身份牌表')

process.exit(done('preinject 表单纯函数'))
