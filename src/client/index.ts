/**
 * dsh-roroko-tool client — 洛洛可全家桶设置页(电箱 + preinject 注入参数编辑)。
 *
 * 在 WebGUI 设置侧边栏注册「Roroko Tool」导航项,页内渲染四个工具的
 * enabled 开关(preinject / data / warn / mark);preinject 额外展开注入参数
 * 编辑器:文件清单动态增删、header/footer 包裹壳、是否 system-reminder 包裹。
 *
 * 读写不走官方 settingsScope(远程浏览器写 memory no-op),改经同源 fetch
 * 打 host 挂的 HTTP route:
 *   GET  /roroko-tool/state  → 读四开关 + preinject 配置
 *   POST /roroko-tool/state  → { tool, enabled } 写开关
 *                             → { tool:'preinject', files/header/footer/... } 写配置
 * UI 状态本地 useState。参照 dshmarket client 范式(api() 锚定 baseURI)。
 */
import { createElement as h, useEffect, useState } from 'react'
import { NS, en, zh } from './locales.ts'

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

/** 电箱状态 wire 形状(与 host src/settings.ts 一致)。 */
interface PreinjectWire {
  enabled: boolean
  files: string[]
  header: string
  footer: string
  wrapInSystemReminder: boolean
}

interface RorokoToolState {
  preinject: PreinjectWire
  data: { enabled: boolean }
  warn: { enabled: boolean }
  mark: { enabled: boolean }
}

export const name = 'roroko-tool'
export const inject = ['slots', 'locale']

/** 四工具元数据:id 须匹配 host 工具键。 */
const TOOLS = [
  { id: 'preinject', title: '指令预注入', desc: '会话开始一次性注入工作区指令 (preinject)' },
  { id: 'data', title: '素材库工具', desc: '洛洛可素材库查询工具集 (data)' },
  { id: 'warn', title: '超量收敛警告', desc: '工具调用/思考超量时注入收敛警告 (warn)' },
  { id: 'mark', title: '呻吟标记扩展', desc: '-呻吟_X- 标记的渲染与处理 (mark)' },
] as const

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

const dangerButtonStyle: CssDict = {
  ...buttonStyle,
  borderColor: 'var(--dsw-text-danger, #e5484d)',
  color: 'var(--dsw-text-danger, #e5484d)',
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

/** 单行开关:值来自 host state,拨动 POST 回写。 */
function ToolRow(props: {
  tool: (typeof TOOLS)[number]
  enabled: boolean
  busy: boolean
  onToggle: (next: boolean) => void
}): ReturnType<typeof h> {
  const { tool, enabled, busy, onToggle } = props
  return h('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  },
    h('div', {},
      h('div', { style: { fontWeight: 600 } }, tool.title),
      h('div', {
        style: {
          color: 'var(--dsw-text-secondary, #888)',
          fontSize: '0.9em',
          marginTop: 2,
        },
      }, tool.desc),
    ),
    h('label', {},
      h('input', {
        type: 'checkbox',
        checked: enabled,
        disabled: busy,
        onChange: () => { onToggle(!enabled) },
      }),
    ),
  )
}

/** preinject 注入参数编辑面板:文件清单 + header/footer + wrap 包裹。 */
function PreinjectPanel(props: {
  config: PreinjectWire
  busy: boolean
  onSave: (next: PreinjectWire) => void
}): ReturnType<typeof h> {
  const { config, busy, onSave } = props
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

  const updateFile = (index: number, value: string): void => {
    setFiles(prev => prev.map((item, i) => (i === index ? value : item)))
    markDirty()
  }

  const addFile = (): void => {
    setFiles(prev => [...prev, ''])
    markDirty()
  }

  const removeFile = (index: number): void => {
    setFiles(prev => prev.filter((_, i) => i !== index))
    markDirty()
  }

  const save = (): void => {
    const next: PreinjectWire = {
      enabled: config.enabled,
      // 落盘前去重空行、去首尾空白。
      files: files
        .map(item => item.trim())
        .filter(item => item.length > 0)
        .filter((item, index, self) => self.indexOf(item) === index),
      header: header.trim(),
      footer: footer.trim(),
      wrapInSystemReminder: wrap,
    }
    onSave(next)
    setDirty(false)
    setSaved(true)
  }

  const textareaStyle: CssDict = {
    ...inputStyle,
    minHeight: 56,
    resize: 'vertical',
  }

  return h('div', {
    style: {
      background: 'var(--dsw-surface-secondary, rgba(128,128,128,.06))',
      borderRadius: 6,
      margin: '8px 0 4px',
      padding: '10px 12px',
    },
  },
    h('div', { style: { fontWeight: 600, marginBottom: 8, fontSize: '0.9em' } },
      '注入参数(存 state,会话开始注入时读取)'),
    h('div', { style: { fontSize: '0.85em', color: 'var(--dsw-text-secondary, #888)', marginBottom: 8 } },
      '文件路径相对会话 cwd;缺失文件静默跳过。'),
    files.map((file, index) => h('div', {
      key: `file-${index}`,
      style: { display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' },
    },
      h('input', {
        type: 'text',
        value: file,
        disabled: busy,
        placeholder: '如 AGENTS.md',
        style: inputStyle,
        onChange: (event: { target: { value: string } }) => { updateFile(index, event.target.value) },
      }),
      h('button', {
        type: 'button',
        disabled: busy,
        title: '删除此行',
        style: { ...dangerButtonStyle, flexShrink: 0 },
        onClick: () => { removeFile(index) },
      }, '✕'),
    )),
    h('div', { style: { marginTop: 4 } },
      h('button', {
        type: 'button',
        disabled: busy,
        style: buttonStyle,
        onClick: addFile,
      }, '+ 添加文件'),
    ),
    h('label', {
      style: {
        display: 'block',
        fontSize: '0.85em',
        marginBottom: 2,
        marginTop: 10,
        color: 'var(--dsw-text-secondary, #888)',
      },
    }, 'header(内容前插入)'),
    h('textarea', {
      value: header,
      disabled: busy,
      placeholder: '<roroko-reminder> …',
      style: textareaStyle,
      onChange: (event: { target: { value: string } }) => { setHeader(event.target.value); markDirty() },
    }),
    h('label', {
      style: {
        display: 'block',
        fontSize: '0.85em',
        marginBottom: 2,
        marginTop: 8,
        color: 'var(--dsw-text-secondary, #888)',
      },
    }, 'footer(内容后插入)'),
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
  )
}

/** 设置页内容:加载 host state,渲染四开关(preinject 带配置面板)。 */
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

  const toggle = async (tool: string, next: boolean): Promise<void> => {
    if (busy) return
    setBusy(true)
    setBusyTool(tool)
    setError(null)
    try {
      const response = await fetch(api('/roroko-tool/state'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tool, enabled: next }),
      })
      const body = (await response.json()) as { ok?: boolean; error?: string; state?: RorokoToolState }
      if (!response.ok || body.ok !== true || body.state === undefined) {
        setError(body.error ?? `failed to toggle ${tool} (HTTP ${response.status})`)
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

  const enabledOf = (tool: (typeof TOOLS)[number]): boolean =>
    state?.[tool.id as keyof RorokoToolState]?.enabled ?? false

  const preinjectConfig = (): PreinjectWire | null =>
    state?.preinject ?? null

  return h('div', { style: { padding: '6px 0' } },
    h('div', {
      style: {
        color: 'var(--dsw-text-secondary, #888)',
        fontSize: '0.9em',
        marginBottom: 12,
      },
    }, '洛洛可全家桶插件电箱 — 关闭某工具即熄火;状态存服务器 profile。'),
    state === null
      ? h('div', { style: { color: 'var(--dsw-text-secondary, #888)', fontSize: '0.9em' } },
          error === null ? '加载中…' : `加载失败: ${error}`)
      : h('div', {},
          ...TOOLS.map((tool) => {
            const config = preinjectConfig()
            return h('div', { key: tool.id, style: { marginTop: 6 } },
              h(ToolRow, {
                tool,
                enabled: enabledOf(tool),
                busy: busy && busyTool === tool.id,
                onToggle: (next) => { void toggle(tool.id, next) },
              }),
              tool.id === 'preinject' && config !== null
                ? h(PreinjectPanel, {
                  config,
                  busy: busy && busyTool === 'preinject',
                  onSave: (next) => { void savePreinject(next) },
                })
                : null,
            )
          }),
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
}
