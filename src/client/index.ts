/**
 * dsh-roroko-tool client — 洛洛可全家桶子插件参数设置页。
 *
 * 在 WebGUI 设置侧边栏注册「Roroko Tool」导航项。页面不再有工具启用开关
 * (2026-09-03 三改:四工具 enabled 运行级开关退役——preset 声明即启用,
 * agent preset 在 agent.cordis.yml 里引用哪个子插件,装配就带哪个功能)。
 * 页面只编辑各子插件的参数覆盖:preinject 的两组注入参数(系统段文件清单/
 * 基准 order/包裹壳,消息段文件清单/包裹壳/system-reminder 包裹),
 * roroko-data 的数据库路径。
 *
 * 读写不走官方 settingsScope(远程浏览器写 memory no-op),改经同源 fetch
 * 打 host 挂的 HTTP route:
 *   GET  /roroko-tool/state  → 读各节参数(state 文件内容)
 *   POST /roroko-tool/state  → { tool:'preinject', systemFiles/systemOrder/… } 写参数
 *                             → { tool:'data', dbPath } 写参数
 * UI 状态本地 useState。参照 dshmarket client 范式(api() 锚定 baseURI)。
 */
import { createElement as h, useEffect, useState } from 'react'
import { NS, en, zh } from './locales.ts'
import { setRorokoMarkEnabled } from './roroko-mark.ts'
import { RorokoMarkAssistantNode } from './RorokoMarkAssistantNode.tsx'

/** 本插件用到的 slots 服务子面(结构类型,不依赖 monorepo 内部类型)。 */
interface SlotsService {
  inject(slot: string, register: () => unknown): void
  register(meta: Record<string, unknown>, component: unknown): unknown
}

/** roroko-tool client 上下文(host 提供真实 Context;此处只声明用到的面)。 */
interface RorokoToolClientContext {
  effect(callback: () => unknown, label?: string): void
  locale: {
    register(namespace: string, dicts: { zh: unknown; en: unknown }): unknown
    bind(namespace: string): (key: keyof typeof zh) => string
  }
  slots: SlotsService
}

/** preinject 全量参数 wire(host preinjectView 的输出:补全后的有效值)。 */
interface PreinjectWire {
  /** 系统段:进系统提示词的文件的清单。 */
  systemFiles: string[]
  /** 系统段 section order。 */
  systemOrder: number
  systemHeader: string
  systemFooter: string
  /** 消息段:进 user 消息的文件清单。 */
  files: string[]
  header: string
  footer: string
  wrapInSystemReminder: boolean
  /** 消息段落点:本批用户消息之后(默认)还是之前。 */
  filesPlacement: 'after-user' | 'before-user'
  /** 消息段是否每个文件各注入一条。 */
  splitFiles: boolean
}

/**
 * preinject 覆盖层 wire:字段**缺失** = 跟随继承(公共桶 → preset config →
 * 内置默认);字段存在(含空值) = 该 preset 显式设定。设置页只发用户勾选了
 * "覆盖"的那一组字段,所以留空的输入框不会偷偷变成"显式清空"。
 */
interface PreinjectOverrideWire {
  systemFiles?: string[]
  systemOrder?: number
  systemHeader?: string
  systemFooter?: string
  files?: string[]
  header?: string
  footer?: string
  wrapInSystemReminder?: boolean
  filesPlacement?: 'after-user' | 'before-user'
  splitFiles?: boolean
}

/** 一个 preset 的覆盖节。 */
interface PresetOverrideWire {
  preinject?: PreinjectOverrideWire
}

/** data 参数 wire 形状(与 host settings.ts 一致,无 enabled)。 */
interface DataWire {
  dbPath: string
}

/** state 文件参数 wire(host 返回;warn 无参数为空节,mark 有渲染开关)。 */
interface RorokoToolState {
  /** 按 preset 分桶的覆盖(空对象 = 全部走继承)。 */
  presets: Record<string, PresetOverrideWire>
  /** 兼容视图:公共桶 + 内置默认合成的有效参数,当"继承基线"用。 */
  preinject: PreinjectWire
  data: DataWire
  warn: Record<string, never>
  mark: { enabled: boolean }
}

/** preset 列表 wire(host 扫 $DSH_HOME/.agent-presets 得到)。 */
interface PresetRowWire {
  id: string
  /** preset.yml 里的展示名,取不到为空串。 */
  name: string
  /** composition 文件是否存在(不存在则这个 preset 挂不起来)。 */
  composition: boolean
}

interface PresetsWire {
  presets: PresetRowWire[]
  commonScope: string
}

export const name = 'roroko-tool'
export const inject = ['slots', 'locale']

/** 解析路由路径,锚定 document.baseURI(反代带 prefix 也能命中)。 */
function api(path: string): string {
  const relative = path.replace(/^\/+/, '')
  if (typeof document === 'undefined') return `/${relative}`
  return new URL(relative, document.baseURI).pathname
}

/** 行内样式键值(数值给 lineHeight/borderRadius,其余字符串)。 */
type CssValue = string | number
type CssDict = Record<string, CssValue>

/** 通用行内按钮样式。 */
const buttonStyle: CssDict = {
  background: 'none',
  border: '1px solid var(--dsw-text-secondary, #888)',
  borderRadius: 4,
  color: 'var(--dsw-text-secondary, #888)',
  cursor: 'pointer',
  fontSize: '0.85em',
  lineHeight: 1.2,
  padding: '2px 8px',
}

const inputStyle: CssDict = {
  background: 'var(--dsw-surface-secondary, rgba(128,128,128,.08))',
  border: '1px solid var(--dsw-text-secondary, #666)',
  borderRadius: 4,
  boxSizing: 'border-box',
  color: 'var(--dsw-text-primary, #eee)',
  fontFamily: 'inherit',
  fontSize: '0.9em',
  padding: '4px 8px',
  width: '100%',
}

/** 工具卡片头:说明 preset 声明即启用,无开关。 */
function ToolHeader(props: { title: string; desc: string }): ReturnType<typeof h> {
  const { title, desc } = props
  return h('div', { style: { margin: '14px 0 4px' } },
    h('div', { style: { fontWeight: 600 } }, title),
    h('div', {
      style: {
        color: 'var(--dsw-text-secondary, #888)',
        fontSize: '0.85em',
        marginTop: 2,
      },
    }, desc),
  )
}

/** 区块外壳:参数面板共用背景/圆角/内边距。 */
function PanelShell(props: { children: ReturnType<typeof h>[] }): ReturnType<typeof h> {
  return h('div', {
    style: {
      background: 'var(--dsw-surface-secondary, rgba(128,128,128,.06))',
      borderRadius: 6,
      margin: '8px 0 4px',
      padding: '10px 12px',
    },
  }, ...props.children)
}

/** 文件清单编辑器:若干行文本框 + 增删。系统段与消息段共用一份。 */
function FileListEditor(props: {
  files: string[]
  busy: boolean
  placeholder: string
  onChange: (next: string[]) => void
}): ReturnType<typeof h> {
  const { files, busy, placeholder, onChange } = props
  return h('div', {},
    ...files.map((file, index) => h('div', {
      key: `file-${index}`,
      style: { display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' },
    },
      h('input', {
        type: 'text',
        value: file,
        disabled: busy,
        placeholder,
        style: inputStyle,
        onChange: (event: { target: { value: string } }) => {
          const value = event.target.value
          onChange(files.map((item, i) => (i === index ? value : item)))
        },
      }),
      h('button', {
        type: 'button',
        disabled: busy,
        title: '删除此行',
        style: { ...buttonStyle, flexShrink: 0 },
        onClick: () => { onChange(files.filter((_, i) => i !== index)) },
      }, '✕'),
    )),
    h('div', { style: { marginTop: 4 } },
      h('button', {
        type: 'button',
        disabled: busy,
        style: buttonStyle,
        onClick: () => { onChange([...files, '']) },
      }, '+ 添加文件'),
    ),
  )
}

/** 面板内行标签样式。 */
const groupLabelStyle: CssDict = {
  display: 'block',
  fontSize: '0.85em',
  marginBottom: 2,
  marginTop: 8,
  color: 'var(--dsw-text-secondary, #888)',
}

/** 面板内提示文字样式。 */
const hintStyle: CssDict = {
  fontSize: '0.8em',
  color: 'var(--dsw-text-secondary, #888)',
  marginTop: 2,
}

const textareaStyle: CssDict = {
  ...inputStyle,
  minHeight: 56,
  resize: 'vertical',
}

/** 清单落盘前清洗:去首尾空白、去空行、去重。非数组一律当空单,不抛。 */
function cleanList(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  return list
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => item.length > 0)
    .filter((item, index, self) => self.indexOf(item) === index)
}

/** 列表字段兜底:非数组当空单(host 首启或旧版 state 可能缺字段)。 */
function toList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** 字符串字段兜底:非字符串当空串。 */
function toStr(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 数值字段兜底:非有限数当兜底值。 */
function toNum(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** 覆盖层里有没有系统段那组字段。 */
function hasSystemOverride(override: PreinjectOverrideWire): boolean {
  return override.systemFiles !== undefined
    || override.systemOrder !== undefined
    || override.systemHeader !== undefined
    || override.systemFooter !== undefined
}

/** 覆盖层里有没有消息段那组字段。 */
function hasMessageOverride(override: PreinjectOverrideWire): boolean {
  return override.files !== undefined
    || override.header !== undefined
    || override.footer !== undefined
    || override.wrapInSystemReminder !== undefined
    || override.filesPlacement !== undefined
    || override.splitFiles !== undefined
}

/** 卡片外壳样式。 */
const cardStyle: CssDict = {
  border: '1px solid var(--dsw-text-secondary, #444)',
  borderRadius: 6,
  margin: '8px 0',
  padding: '8px 10px',
}

/** 卡片标题按钮样式(整行可点、左对齐)。 */
const cardHeadStyle: CssDict = {
  alignItems: 'center',
  background: 'none',
  border: 'none',
  color: 'inherit',
  cursor: 'pointer',
  display: 'flex',
  fontFamily: 'inherit',
  fontSize: '0.95em',
  gap: 8,
  padding: 0,
  textAlign: 'left',
  width: '100%',
}

/** 卡片状态徽标样式。 */
const badgeStyle: CssDict = {
  border: '1px solid var(--dsw-text-secondary, #666)',
  borderRadius: 4,
  color: 'var(--dsw-text-secondary, #888)',
  fontSize: '0.78em',
  padding: '1px 6px',
}

/** "覆盖这一组"复选框所在行样式。 */
const coverLabelStyle: CssDict = {
  alignItems: 'center',
  cursor: 'pointer',
  display: 'flex',
  fontSize: '0.88em',
  gap: 6,
  marginTop: 8,
}

/** 可折叠卡片:标题一行,点开才渲染内容(设置页一个 preset 一张卡)。 */
function PresetCard(props: {
  title: string
  hint: string
  badge?: string
  defaultOpen?: boolean
  children: ReturnType<typeof h>[]
}): ReturnType<typeof h> {
  const { title, hint, badge, defaultOpen = false, children } = props
  const [open, setOpen] = useState(defaultOpen)
  return h('div', { style: cardStyle },
    h('button', {
      type: 'button',
      style: cardHeadStyle,
      onClick: () => { setOpen(value => !value) },
    },
      h('span', { style: { fontWeight: 600 } }, `${open ? '▾' : '▸'} ${title}`),
      badge === undefined ? null : h('span', { style: badgeStyle }, badge),
    ),
    h('div', { style: { color: 'var(--dsw-text-secondary, #888)', fontSize: '0.82em', marginTop: 2 } }, hint),
    open === true ? h('div', { style: { marginTop: 8 } }, ...children) : null,
  )
}

/**
 * 单个 preset 的注入参数编辑器(一张卡片的内容)。
 *
 * 两组参数各有独立"覆盖"开关,默认关闭即跟随继承:
 *   关闭 → 该组字段一个都不发,注入时读 公共桶 → preset config → 内置默认;
 *   打开 → 该组字段整组落盘,空清单/空串就是"显式清空"。
 * 两组都不覆盖时保存 = 清除该 preset 的覆盖,不留空桶把 preset config 压住。
 *
 * 字段一律经 toList/toStr/toNum 兜底:覆盖层本身就允许缺字段,直接取用会拿到
 * undefined,后续 .map/.trim 当场抛错,症状就是"点了保存什么也没发生"。
 */
function PreinjectScopePanel(props: {
  override: PreinjectOverrideWire
  baseline: PreinjectWire
  busy: boolean
  onSave: (payload: Record<string, unknown>) => Promise<boolean>
  onReset: () => Promise<boolean>
}): ReturnType<typeof h> {
  const { override, baseline, busy, onSave, onReset } = props
  const [coverSystem, setCoverSystem] = useState(() => hasSystemOverride(override))
  const [coverMessage, setCoverMessage] = useState(() => hasMessageOverride(override))
  const [systemFiles, setSystemFiles] = useState<string[]>(
    () => toList(override.systemFiles ?? baseline.systemFiles),
  )
  const [systemOrder, setSystemOrder] = useState<number>(
    () => toNum(override.systemOrder, baseline.systemOrder),
  )
  const [systemHeader, setSystemHeader] = useState<string>(
    () => toStr(override.systemHeader ?? baseline.systemHeader),
  )
  const [systemFooter, setSystemFooter] = useState<string>(
    () => toStr(override.systemFooter ?? baseline.systemFooter),
  )
  const [files, setFiles] = useState<string[]>(() => toList(override.files ?? baseline.files))
  const [header, setHeader] = useState<string>(() => toStr(override.header ?? baseline.header))
  const [footer, setFooter] = useState<string>(() => toStr(override.footer ?? baseline.footer))
  const [wrap, setWrap] = useState<boolean>(
    () => (override.wrapInSystemReminder ?? baseline.wrapInSystemReminder) === true,
  )
  const [placement, setPlacement] = useState<'after-user' | 'before-user'>(
    () => override.filesPlacement ?? baseline.filesPlacement,
  )
  const [split, setSplit] = useState<boolean>(
    () => (override.splitFiles ?? baseline.splitFiles) === true,
  )
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const save = (): void => {
    setSaveError(null)
    setSaved(false)
    setSaving(true)
    const payload: Record<string, unknown> = {}
    if (coverSystem) {
      payload.systemFiles = cleanList(systemFiles)
      payload.systemOrder = systemOrder
      payload.systemHeader = systemHeader.trim()
      payload.systemFooter = systemFooter.trim()
    }
    if (coverMessage) {
      payload.files = cleanList(files)
      payload.header = header.trim()
      payload.footer = footer.trim()
      payload.wrapInSystemReminder = wrap
      payload.filesPlacement = placement
      payload.splitFiles = split
    }
    console.log('[roroko-tool] save preinject scope →', payload)
    // 两组都不覆盖 = 这个 preset 没有覆盖层,直接清桶(与"重置"同义)。
    const action = coverSystem || coverMessage ? onSave(payload) : onReset()
    void action
      .then((ok: boolean) => {
        if (ok) setSaved(true)
        else setSaveError('服务端未接受本次写入')
      })
      .catch((cause: unknown) => { setSaveError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { setSaving(false) })
  }

  const reset = (): void => {
    setSaveError(null)
    setSaved(false)
    setSaving(true)
    void onReset()
      .then((ok: boolean) => {
        if (ok) setSaved(true)
        else setSaveError('服务端未接受本次重置')
      })
      .catch((cause: unknown) => { setSaveError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { setSaving(false) })
  }

  return h(PanelShell, {
    children: [
      h('label', { style: coverLabelStyle },
        h('input', {
          type: 'checkbox',
          checked: coverSystem,
          disabled: busy,
          onChange: () => { setCoverSystem(value => !value); setSaved(false) },
        }),
        '覆盖系统段(进 system 提示词;不勾选 = 跟随继承)',
      ),
      coverSystem
        ? h('div', {},
            h(FileListEditor, {
              files: systemFiles,
              busy,
              placeholder: '如 AGENTS.md 或 ${presetDir}/IDENTITY.md',
              onChange: (next: string[]) => { setSystemFiles(next); setSaved(false) },
            }),
            h('label', { style: groupLabelStyle }, 'section order(改动需重挂载 preset)'),
            h('input', {
              type: 'number',
              value: `${systemOrder}`,
              disabled: busy,
              style: { ...inputStyle, maxWidth: 120 },
              onChange: (event: { target: { value: string } }) => {
                const parsed = Number(event.target.value)
                setSystemOrder(Number.isFinite(parsed) ? parsed : 0)
                setSaved(false)
              },
            }),
            h('label', { style: groupLabelStyle }, 'systemHeader / systemFooter(内容前后插入)'),
            h('textarea', {
              value: systemHeader,
              disabled: busy,
              style: textareaStyle,
              onChange: (event: { target: { value: string } }) => { setSystemHeader(event.target.value); setSaved(false) },
            }),
            h('textarea', {
              value: systemFooter,
              disabled: busy,
              style: { ...textareaStyle, marginTop: 4 },
              onChange: (event: { target: { value: string } }) => { setSystemFooter(event.target.value); setSaved(false) },
            }),
          )
        : h('div', { style: hintStyle },
            `跟随继承:${baseline.systemFiles.join(' / ') || '(空)'}(order ${baseline.systemOrder})`),

      h('label', { style: coverLabelStyle },
        h('input', {
          type: 'checkbox',
          checked: coverMessage,
          disabled: busy,
          onChange: () => { setCoverMessage(value => !value); setSaved(false) },
        }),
        '覆盖消息段(进 user 消息;不勾选 = 跟随继承)',
      ),
      coverMessage
        ? h('div', {},
            h(FileListEditor, {
              files,
              busy,
              placeholder: '如 PLAYER.md 或 ${presetDir}/PLAYER.md',
              onChange: (next: string[]) => { setFiles(next); setSaved(false) },
            }),
            h('label', { style: groupLabelStyle }, 'header / footer(内容前后插入)'),
            h('textarea', {
              value: header,
              disabled: busy,
              placeholder: '<roroko-reminder> …',
              style: textareaStyle,
              onChange: (event: { target: { value: string } }) => { setHeader(event.target.value); setSaved(false) },
            }),
            h('textarea', {
              value: footer,
              disabled: busy,
              placeholder: '… </roroko-reminder>',
              style: { ...textareaStyle, marginTop: 4 },
              onChange: (event: { target: { value: string } }) => { setFooter(event.target.value); setSaved(false) },
            }),
            h('label', { style: coverLabelStyle },
              h('input', {
                type: 'checkbox',
                checked: wrap,
                disabled: busy,
                onChange: () => { setWrap(value => !value); setSaved(false) },
              }),
              '整体包一层 <system-reminder>…</system-reminder>',
            ),
            h('label', { style: groupLabelStyle }, '落点(相对本批用户消息)'),
            h('div', { style: { display: 'flex', fontSize: '0.86em', gap: 14 } },
              ...[
                ['after-user', '之后(默认)'],
                ['before-user', '之前'],
              ].map(([value, label]) => h('label', {
                key: value,
                style: { alignItems: 'center', cursor: 'pointer', display: 'flex', gap: 4 },
              },
                h('input', {
                  type: 'radio',
                  checked: placement === value,
                  disabled: busy,
                  onChange: () => {
                    setPlacement(value as 'after-user' | 'before-user')
                    setSaved(false)
                  },
                }),
                label,
              )),
            ),
            h('label', { style: coverLabelStyle },
              h('input', {
                type: 'checkbox',
                checked: split,
                disabled: busy,
                onChange: () => { setSplit(value => !value); setSaved(false) },
              }),
              '每个文件各注入一条(不勾选 = 全部合并成一条)',
            ),
          )
        : h('div', { style: hintStyle },
            `跟随继承:${baseline.files.join(' / ') || '(空)'}`
            + `(${baseline.filesPlacement === 'before-user' ? '本批之前' : '本批之后'}`
            + `${baseline.splitFiles ? ',每文件一条' : ',合并一条'})`),

      h('div', {
        style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 },
      },
        h('button', {
          type: 'button',
          disabled: busy || saving,
          style: buttonStyle,
          onClick: save,
        }, saving ? '保存中…' : '保存'),
        h('button', {
          type: 'button',
          disabled: busy || saving,
          style: buttonStyle,
          onClick: reset,
        }, '重置为继承'),
        saved
          ? h('span', { style: { color: 'var(--dsw-text-success, #46a758)', fontSize: '0.8em' } }, '已保存')
          : null,
        saveError !== null
          ? h('span', {
            style: { color: 'var(--dsw-text-danger, #e5484d)', fontSize: '0.8em' },
          }, `保存失败: ${saveError}`)
          : null,
      ),
    ],
  })
}

/** data 参数面板:数据库路径编辑。 */
function DataPanel(props: {
  config: DataWire
  busy: boolean
  onSave: (next: DataWire) => Promise<boolean>
}): ReturnType<typeof h> {
  const { config, busy, onSave } = props
  const [dbPath, setDbPath] = useState<string>(() => toStr(config.dbPath))
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const save = (): void => {
    const next: DataWire = { dbPath: dbPath.trim() }
    console.log('[roroko-tool] save data →', next)
    setSaveError(null)
    setSaving(true)
    void onSave(next)
      .then((ok: boolean) => {
        if (ok) {
          setDirty(false)
          setSaved(true)
        } else {
          setSaveError('服务端未接受本次写入(细节见下方面板错误行)')
        }
      })
      .catch((cause: unknown) => {
        setSaveError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => { setSaving(false) })
  }

  return h(PanelShell, {
    children: [
      h('div', { style: { fontWeight: 600, marginBottom: 8, fontSize: '0.9em' } },
        '数据库路径(存 state,工具执行时读取)'),
      h('div', { style: { fontSize: '0.85em', color: 'var(--dsw-text-secondary, #888)', marginBottom: 8 } },
        'soul.db 绝对路径,默认服务器 /var/www/api/database/soul.db。'),
      h('input', {
        type: 'text',
        value: dbPath,
        disabled: busy,
        placeholder: '/var/www/api/database/soul.db',
        style: inputStyle,
        onChange: (event: { target: { value: string } }) => { setDbPath(event.target.value); setDirty(true); setSaved(false) },
      }),
      h('div', {
        style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' },
      },
        h('button', {
          type: 'button',
          disabled: busy || saving,
          style: {
            ...buttonStyle,
            borderColor: dirty ? 'var(--dsw-text-primary, #eee)' : undefined,
            color: dirty ? 'var(--dsw-text-primary, #eee)' : undefined,
          },
          onClick: save,
        }, saving ? '保存中…' : '保存路径'),
        saved && !dirty
          ? h('span', { style: { fontSize: '0.8em', color: 'var(--dsw-text-success, #46a758)' } }, '已保存')
          : null,
        saveError !== null
          ? h('span', {
            style: { fontSize: '0.8em', color: 'var(--dsw-text-danger, #e5484d)' },
          }, `保存失败: ${saveError}`)
          : null,
      ),
    ],
  })
}

/** mark 渲染开关面板:展开总开关(web 渲染 / Telegram 出站共用)。 */
function MarkPanel(props: {
  enabled: boolean
  busy: boolean
  onToggle: (next: boolean) => void
}): ReturnType<typeof h> {
  const { enabled, busy, onToggle } = props
  return h(PanelShell, {
    children: [
      h('div', { style: { fontWeight: 600, marginBottom: 8, fontSize: '0.9em' } },
        '渲染展开开关(存 state,web / Telegram 共用)'),
      h('div', {
        style: { fontSize: '0.85em', color: 'var(--dsw-text-secondary, #888)', marginBottom: 8 },
      },
        '开启后,助手回复中的 -呻吟_X- 标记在显示层展开为呻吟文本;会话日志仍存原文,模型上下文零污染。'),
      h('label', {
        style: {
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: '0.85em', cursor: 'pointer',
        },
      },
        h('input', {
          type: 'checkbox',
          checked: enabled,
          disabled: busy,
          onChange: () => { onToggle(!enabled) },
        }),
        enabled ? '展开已开启(推荐保持)' : '展开已关闭(-呻吟_X- 原样显示)',
      ),
    ],
  })
}

/** 设置页内容:按 preset 分卡片编辑注入参数,data/mark 仍是全局参数。 */
export function RorokoToolSection(): ReturnType<typeof h> {
  const [state, setState] = useState<RorokoToolState | null>(null)
  const [presets, setPresets] = useState<PresetRowWire[]>([])
  const [commonScope, setCommonScope] = useState('common')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyTool, setBusyTool] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    console.log('[roroko-tool] settings section mounted, fetching state + presets')
    void (async () => {
      try {
        const [stateResponse, presetsResponse] = await Promise.all([
          fetch(api('/roroko-tool/state'), { cache: 'no-store' }),
          fetch(api('/roroko-tool/presets'), { cache: 'no-store' }),
        ])
        const stateBody = (await stateResponse.json()) as RorokoToolState
        // preset 列表拉不到(旧 host / 路由未挂)时降级为"只有公共卡片",整页照常可用。
        let presetsBody: PresetsWire = { presets: [], commonScope: 'common' }
        if (presetsResponse.ok) {
          const raw = (await presetsResponse.json()) as Partial<PresetsWire>
          presetsBody = {
            presets: Array.isArray(raw.presets) ? raw.presets : [],
            commonScope: typeof raw.commonScope === 'string' && raw.commonScope.length > 0
              ? raw.commonScope
              : 'common',
          }
        } else {
          console.log('[roroko-tool] presets route unavailable, HTTP', presetsResponse.status)
        }
        console.log('[roroko-tool] state loaded:', stateBody)
        console.log('[roroko-tool] presets loaded:', presetsBody)
        if (!live) return
        setState(stateBody)
        setPresets(presetsBody.presets)
        setCommonScope(presetsBody.commonScope)
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    return () => { live = false }
  }, [])

  // 统一写入口:任何失败都必须让调用方知道(旧版 `if (busy) return` 会把点击
  // 静默吞掉,面板照样亮"已保存"而日志里没有请求)。成功后用服务端回执覆盖界面。
  const post = async (
    tool: string,
    payload: Record<string, unknown>,
    label: string,
  ): Promise<boolean> => {
    setBusy(true)
    setBusyTool(label)
    setError(null)
    try {
      const response = await fetch(api('/roroko-tool/state'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tool, ...payload }),
      })
      const body = (await response.json()) as { ok?: boolean; error?: string; state?: RorokoToolState }
      if (!response.ok || body.ok !== true || body.state === undefined) {
        const message = body.error ?? `failed to save ${label} (HTTP ${response.status})`
        console.log('[roroko-tool] save rejected:', label, message)
        setError(message)
        return false
      }
      setState(body.state)
      return true
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      console.log('[roroko-tool] save threw:', label, message)
      setError(message)
      return false
    } finally {
      setBusy(false)
      setBusyTool(null)
    }
  }

  const saveMark = async (enabled: boolean): Promise<boolean> => {
    setBusy(true)
    setBusyTool('mark')
    setError(null)
    try {
      const next = await setRorokoMarkEnabled(enabled)
      if (next === null) {
        console.log('[roroko-tool] save mark rejected')
        setError('failed to save mark config')
        return false
      }
      setState(next as unknown as RorokoToolState)
      return true
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      console.log('[roroko-tool] save mark threw:', message)
      setError(message)
      return false
    } finally {
      setBusy(false)
      setBusyTool(null)
    }
  }

  const baseline = state?.preinject
  const scopeCards: ReturnType<typeof h>[] = []
  if (state !== null && baseline !== undefined) {
    // 公共层:不指定 preset 时生效,也是每个 preset 没覆盖时的兜底。
    scopeCards.push(h(PresetCard, {
      key: `scope-${commonScope}`,
      title: `公共默认(${commonScope})`,
      hint: '没写 preset、或某个 preset 没覆盖时生效的那一层。',
      badge: state.presets[commonScope]?.preinject === undefined ? '跟随 config' : '已覆盖',
      defaultOpen: true,
      children: [h(PreinjectScopePanel, {
        override: state.presets[commonScope]?.preinject ?? {},
        baseline,
        busy: busy && busyTool === `preinject:${commonScope}`,
        onSave: (payload: Record<string, unknown>) =>
          post('preinject', { preset: commonScope, ...payload }, `preinject:${commonScope}`),
        onReset: () => post('preinject', { preset: commonScope, reset: true }, `preinject:${commonScope}`),
      })],
    }))

    // 每个 preset 一张卡:覆盖层叠在公共层之上,字段缺省即跟随继承。
    for (const preset of presets) {
      const override = state.presets[preset.id]?.preinject
      const badge = preset.composition !== true
        ? '缺 agent.cordis.yml'
        : override === undefined ? '跟随继承' : '已覆盖'
      scopeCards.push(h(PresetCard, {
        key: `scope-${preset.id}`,
        title: preset.name.length > 0 ? `${preset.id} · ${preset.name}` : preset.id,
        hint: `session.header.agentPreset === '${preset.id}' 的会话注入这一层。`,
        badge,
        defaultOpen: false,
        children: [h(PreinjectScopePanel, {
          override: override ?? {},
          baseline,
          busy: busy && busyTool === `preinject:${preset.id}`,
          onSave: (payload: Record<string, unknown>) =>
            post('preinject', { preset: preset.id, ...payload }, `preinject:${preset.id}`),
          onReset: () => post('preinject', { preset: preset.id, reset: true }, `preinject:${preset.id}`),
        })],
      }))
    }
  }

  return h('div', { style: { padding: '6px 0' } },
    h('div', {
      style: {
        color: 'var(--dsw-text-secondary, #888)',
        fontSize: '0.9em',
        marginBottom: 12,
      },
    }, '洛洛可全家桶插件参数 — 功能由 agent preset 声明启用,这里只调参数;状态存服务器 profile。'),
    state === null || baseline === undefined
      ? h('div', { style: { color: 'var(--dsw-text-secondary, #888)', fontSize: '0.9em' } },
          error === null ? '加载中…' : `加载失败: ${error}`)
      : h('div', {},
          h(ToolHeader, {
            title: '指令预注入 (roroko-preinject)',
            desc: '系统段进 system 提示词(常驻不折叠),消息段进 user 消息(会话一次);注入文件与落点按 preset 一卡一层。',
          }),
          ...scopeCards,
          h(ToolHeader, { title: '素材库工具 (roroko-data)', desc: '洛洛可素材库查询/注册 + soul_state 读写;preset 声明即启用。' }),
          h(DataPanel, {
            config: state.data,
            busy: busy && busyTool === 'data',
            onSave: (next: DataWire) => post('data', { dbPath: next.dbPath }, 'data'),
          }),
          h(ToolHeader, { title: '呻吟标记渲染 (roroko-mark)', desc: '-呻吟_X- 标记在 web / Telegram 显示层展开;preset 声明即启用。' }),
          h(MarkPanel, {
            enabled: state.mark.enabled,
            busy: busy && busyTool === 'mark',
            onToggle: (next: boolean) => { void saveMark(next) },
          }),
          h(ToolHeader, { title: '超量收敛警告 (roroko-warn)', desc: '工具调用/思考超量时注入收敛警告(未实现)。' }),
          error !== null
            ? h('div', {
              style: {
                marginTop: 12,
                padding: '10px 12px',
                background: 'var(--dsw-surface-secondary, rgba(128,128,128,.08))',
                borderRadius: 6,
                fontSize: '0.85em',
                color: 'var(--dsw-text-danger, #e5484d)',
              },
            }, error)
            : null,
        ),
  )
}

export function apply(ctx: RorokoToolClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'roroko-tool: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'roroko-tool',
    order: 30,
    label: () => t('nav'),
    locale: NS,
  }, RorokoToolSection))

  // roroko-mark shadow:顶掉官方 assistant-step 节点渲染(priority -1 < 官方 0),
  // 显示层按 state mark.enabled 展开 -呻吟_X- 标记。渲染只动显示,不改 session。
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'assistant-step',
    priority: -1,
    locale: NS,
  }, RorokoMarkAssistantNode))
}
