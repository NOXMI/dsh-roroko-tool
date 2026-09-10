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

/** preinject 参数 wire 形状(与 host src/settings.ts 一致,无 enabled)。 */
interface PreinjectWire {
  /** 系统段:进系统提示词的文件的清单。 */
  systemFiles: string[]
  /** 系统段基准 order(第 N 个文件 order = 基准 + N)。 */
  systemOrder: number
  systemHeader: string
  systemFooter: string
  /** 消息段:进 user 消息的文件清单。 */
  files: string[]
  header: string
  footer: string
  wrapInSystemReminder: boolean
}

/** data 参数 wire 形状(与 host settings.ts 一致,无 enabled)。 */
interface DataWire {
  dbPath: string
}

/** state 文件参数 wire(host 返回;warn 无参数为空节,mark 有渲染开关)。 */
interface RorokoToolState {
  preinject: PreinjectWire
  data: DataWire
  warn: Record<string, never>
  mark: { enabled: boolean }
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

/** 参数面板内的分组小标题:区分系统段与消息段。 */
function GroupTitle(props: { text: string; hint: string }): ReturnType<typeof h> {
  return h('div', { style: { marginTop: 4, marginBottom: 6 } },
    h('div', { style: { fontWeight: 600, fontSize: '0.9em' } }, props.text),
    h('div', {
      style: { color: 'var(--dsw-text-secondary, #888)', fontSize: '0.82em', marginTop: 2 },
    }, props.hint),
  )
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

/** 清单落盘前清洗:去首尾空白、去空行、去重。 */
function cleanList(list: string[]): string[] {
  return list
    .map(item => item.trim())
    .filter(item => item.length > 0)
    .filter((item, index, self) => self.indexOf(item) === index)
}

/**
 * preinject 参数编辑器:系统段(system section)+ 消息段(user 消息)。
 *
 * 两段落点机制不同,参数因此不对称:系统段进系统提示词,常驻、不折叠、内容
 * 每步现读,所以只有基准 order 与 header/footer;消息段是 user 消息,注入一次
 * 落日志,所以另有 system-reminder 包裹开关。
 */
function PreinjectPanel(props: {
  config: PreinjectWire
  busy: boolean
  onSave: (next: PreinjectWire) => void
}): ReturnType<typeof h> {
  const { config, busy, onSave } = props
  const [systemFiles, setSystemFiles] = useState<string[]>(config.systemFiles)
  const [systemOrder, setSystemOrder] = useState(config.systemOrder)
  const [systemHeader, setSystemHeader] = useState(config.systemHeader)
  const [systemFooter, setSystemFooter] = useState(config.systemFooter)
  const [files, setFiles] = useState<string[]>(config.files)
  const [header, setHeader] = useState(config.header)
  const [footer, setFooter] = useState(config.footer)
  const [wrap, setWrap] = useState(config.wrapInSystemReminder)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)

  const markDirty = (): void => {
    setDirty(true)
    setSaved(false)
  }

  const save = (): void => {
    onSave({
      systemFiles: cleanList(systemFiles),
      systemOrder,
      systemHeader: systemHeader.trim(),
      systemFooter: systemFooter.trim(),
      files: cleanList(files),
      header: header.trim(),
      footer: footer.trim(),
      wrapInSystemReminder: wrap,
    })
    setDirty(false)
    setSaved(true)
  }

  return h(PanelShell, {
    children: [
      h('div', { style: { fontWeight: 600, marginBottom: 8, fontSize: '0.9em' } },
        '注入参数(存 state,注入时读取)'),
      h('div', { style: { fontSize: '0.85em', color: 'var(--dsw-text-secondary, #888)', marginBottom: 10 } },
        '文件路径相对会话 cwd;缺失文件静默跳过。'),

      h(GroupTitle, {
        text: '系统段 — 进系统提示词',
        hint: '常驻、不占消息位、不被压缩折叠;每次装配现读文件,改动立刻生效。',
      }),
      h(FileListEditor, {
        files: systemFiles,
        busy,
        placeholder: '如 AGENTS.md',
        onChange: (next: string[]) => { setSystemFiles(next); markDirty() },
      }),
      h('label', { style: groupLabelStyle }, '基准 order(清单里第 N 个文件 order = 基准 + N)'),
      h('input', {
        type: 'number',
        value: `${systemOrder}`,
        disabled: busy,
        style: { ...inputStyle, maxWidth: 120 },
        onChange: (event: { target: { value: string } }) => {
          const parsed = Number(event.target.value)
          setSystemOrder(Number.isFinite(parsed) ? parsed : 0)
          markDirty()
        },
      }),
      h('div', { style: hintStyle }, 'order 改动需重新挂载 preset(重开会话或重启 DSH)才生效。'),
      h('label', { style: groupLabelStyle }, 'header(内容前插入,可留空)'),
      h('textarea', {
        value: systemHeader,
        disabled: busy,
        style: textareaStyle,
        onChange: (event: { target: { value: string } }) => { setSystemHeader(event.target.value); markDirty() },
      }),
      h('label', { style: groupLabelStyle }, 'footer(内容后插入,可留空)'),
      h('textarea', {
        value: systemFooter,
        disabled: busy,
        style: textareaStyle,
        onChange: (event: { target: { value: string } }) => { setSystemFooter(event.target.value); markDirty() },
      }),

      h(GroupTitle, {
        text: '消息段 — 进 user 消息',
        hint: '会话开始注入一次并落日志;被压缩折叠掉会重新注入。',
      }),
      h(FileListEditor, {
        files,
        busy,
        placeholder: '如 PLAYER.md',
        onChange: (next: string[]) => { setFiles(next); markDirty() },
      }),
      h('label', { style: groupLabelStyle }, 'header(内容前插入)'),
      h('textarea', {
        value: header,
        disabled: busy,
        placeholder: '<roroko-reminder> …',
        style: textareaStyle,
        onChange: (event: { target: { value: string } }) => { setHeader(event.target.value); markDirty() },
      }),
      h('label', { style: groupLabelStyle }, 'footer(内容后插入)'),
      h('textarea', {
        value: footer,
        disabled: busy,
        placeholder: '… </roroko-reminder>',
        style: textareaStyle,
        onChange: (event: { target: { value: string } }) => { setFooter(event.target.value); markDirty() },
      }),
      h('label', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: '0.85em',
          marginTop: 10,
          color: 'var(--dsw-text-secondary, #888)',
          cursor: 'pointer',
        },
      },
        h('input', {
          type: 'checkbox',
          checked: wrap,
          disabled: busy,
          onChange: () => { setWrap(!wrap); markDirty() },
        }),
        '整体包一层 &lt;system-reminder&gt;…&lt;/system-reminder&gt;',
      ),

      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 } },
        h('button', {
          type: 'button',
          disabled: busy || !dirty,
          style: {
            ...buttonStyle,
            borderColor: dirty ? 'var(--dsw-text-primary, #eee)' : undefined,
            color: dirty ? 'var(--dsw-text-primary, #eee)' : undefined,
          },
          onClick: save,
        }, '保存注入参数'),
        saved && !dirty
          ? h('span', { style: { fontSize: '0.8em', color: 'var(--dsw-text-success, #46a758)' } }, '已保存')
          : null,
      ),
    ],
  })
}

/** data 参数面板:数据库路径编辑。 */
function DataPanel(props: {
  config: DataWire
  busy: boolean
  onSave: (next: DataWire) => void
}): ReturnType<typeof h> {
  const { config, busy, onSave } = props
  const [dbPath, setDbPath] = useState(config.dbPath)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)

  const save = (): void => {
    onSave({ dbPath: dbPath.trim() })
    setDirty(false)
    setSaved(true)
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
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 } },
        h('button', {
          type: 'button',
          disabled: busy || !dirty,
          style: {
            ...buttonStyle,
            borderColor: dirty ? 'var(--dsw-text-primary, #eee)' : undefined,
            color: dirty ? 'var(--dsw-text-primary, #eee)' : undefined,
          },
          onClick: save,
        }, '保存路径'),
        saved && !dirty
          ? h('span', { style: { fontSize: '0.8em', color: 'var(--dsw-text-success, #46a758)' } }, '已保存')
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

/** 设置页内容:加载 host state,渲染各子插件参数编辑器。 */
export function RorokoToolSection(): ReturnType<typeof h> {
  const [state, setState] = useState<RorokoToolState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyTool, setBusyTool] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const response = await fetch(api('/roroko-tool/state'), { cache: 'no-store' })
        const body = (await response.json()) as RorokoToolState
        if (live) setState(body)
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    return () => { live = false }
  }, [])

  const savePreinject = async (next: PreinjectWire): Promise<void> => {
    if (busy) return
    setBusy(true)
    setBusyTool('preinject')
    setError(null)
    try {
      const response = await fetch(api('/roroko-tool/state'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tool: 'preinject',
          systemFiles: next.systemFiles,
          systemOrder: next.systemOrder,
          systemHeader: next.systemHeader,
          systemFooter: next.systemFooter,
          files: next.files,
          header: next.header,
          footer: next.footer,
          wrapInSystemReminder: next.wrapInSystemReminder,
        }),
      })
      const body = (await response.json()) as { ok?: boolean; error?: string; state?: RorokoToolState }
      if (!response.ok || body.ok !== true || body.state === undefined) {
        setError(body.error ?? `failed to save preinject config (HTTP ${response.status})`)
        return
      }
      setState(body.state)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      setBusyTool(null)
    }
  }

  const saveData = async (next: DataWire): Promise<void> => {
    if (busy) return
    setBusy(true)
    setBusyTool('data')
    setError(null)
    try {
      const response = await fetch(api('/roroko-tool/state'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tool: 'data',
          dbPath: next.dbPath,
        }),
      })
      const body = (await response.json()) as { ok?: boolean; error?: string; state?: RorokoToolState }
      if (!response.ok || body.ok !== true || body.state === undefined) {
        setError(body.error ?? `failed to save data config (HTTP ${response.status})`)
        return
      }
      setState(body.state)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      setBusyTool(null)
    }
  }

  const saveMark = async (enabled: boolean): Promise<void> => {
    if (busy) return
    setBusy(true)
    setBusyTool('mark')
    setError(null)
    try {
      const next = await setRorokoMarkEnabled(enabled)
      if (next === null) {
        setError('failed to save mark config')
        return
      }
      setState(next as unknown as RorokoToolState)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      setBusyTool(null)
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
    state === null
      ? h('div', { style: { color: 'var(--dsw-text-secondary, #888)', fontSize: '0.9em' } },
          error === null ? '加载中…' : `加载失败: ${error}`)
      : h('div', {},
          h(ToolHeader, { title: '指令预注入 (roroko-preinject)', desc: '系统段进系统提示词(常驻),消息段进 user 消息(会话一次);preset 声明即启用。' }),
          h(PreinjectPanel, {
            config: state.preinject,
            busy: busy && busyTool === 'preinject',
            onSave: (next) => { void savePreinject(next) },
          }),
          h(ToolHeader, { title: '素材库工具 (roroko-data)', desc: '洛洛可素材库查询/注册 + soul_state 读写;preset 声明即启用。' }),
          h(DataPanel, {
            config: state.data,
            busy: busy && busyTool === 'data',
            onSave: (next) => { void saveData(next) },
          }),
          h(ToolHeader, { title: '呻吟标记渲染 (roroko-mark)', desc: '-呻吟_X- 标记在 web / Telegram 显示层展开;preset 声明即启用。' }),
          h(MarkPanel, {
            enabled: state.mark.enabled,
            busy: busy && busyTool === 'mark',
            onToggle: (next) => { void saveMark(next) },
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
