/**
 * dsh-roroko-tool client — 洛洛可全家桶设置页(纯 UI 壳 + 四持久化开关)。
 *
 * 在 WebGUI 设置侧边栏注册「Roroko Tool」导航项,页内渲染四个工具的
 * enabled 开关(preinject / data / warn / mark)。
 *
 * 读写不走官方 settingsScope(远程浏览器写 memory no-op),改经同源 fetch
 * 打 host 挂的 HTTP route:
 *   GET  /roroko-tool/state  → 读四开关
 *   POST /roroko-tool/state  → { tool, enabled } 写单开关,以 server 返回为准
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
interface RorokoToolState {
  preinject: { enabled: boolean }
  data: { enabled: boolean }
  warn: { enabled: boolean }
  mark: { enabled: boolean }
}

export const name = 'roroko-tool'
export const inject = ['slots', 'locale']

/** 四工具元数据:id 须匹配 host 工具键。 */
const TOOLS = [
  { id: 'preinject', title: '指令预注入', desc: '会话开始时注入一次性工作区指令 (preinject)' },
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

/** 设置页内容:加载 host state,渲染四开关。 */
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

  const enabledOf = (tool: (typeof TOOLS)[number]): boolean =>
    state?.[tool.id as keyof RorokoToolState]?.enabled ?? false

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
          ...TOOLS.map((tool) =>
            h('div', { key: tool.id, style: { marginTop: 6 } },
              h(ToolRow, {
                tool,
                enabled: enabledOf(tool),
                busy: busy && busyTool === tool.id,
                onToggle: (next) => { void toggle(tool.id, next) },
              }),
            )),
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
