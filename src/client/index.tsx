/**
 * 洛洛可设置页（浏览器半侧）。
 *
 * 挂进 Plugins 页的 `plugins.tab`：一个自绘的「洛洛可」页签，读
 * GET /roroko-tool/state 展示子模块挂载情况，并提供清空注入记录的按钮。
 * 不依赖 configForms —— 数据走宿主自己的 HTTP 路由，改动最小。
 */
import { useCallback, useEffect, useState } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { zh, type LocaleKey } from './locales.js'

/** 文案命名空间。 */
export const NS = 'rorokoTool'

/** 需要的客户端服务。 */
export const inject = ['slots', 'locale']

/** 文案签名（由 locale 服务注入）。 */
type Translate = (key: LocaleKey) => string

interface MountStatus {
  root: string
  identityFiles: string[]
  workspaceFiles: string[]
  includeWorkspace: boolean
}

interface StateBody {
  version: string
  mounts: MountStatus[]
  injectedFile: string | null
  injected: string[]
}

const box: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
  padding: '4px 2px',
  fontSize: '13px',
  lineHeight: 1.6,
}

const row: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '104px 1fr',
  gap: '10px',
  alignItems: 'baseline',
}

const label: React.CSSProperties = { opacity: 0.6 }
const mono: React.CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px' }
const card: React.CSSProperties = {
  border: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
  borderRadius: '10px',
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
}
const button: React.CSSProperties = {
  alignSelf: 'flex-start',
  marginTop: '4px',
  padding: '6px 12px',
  borderRadius: '8px',
  border: '1px solid color-mix(in srgb, currentColor 22%, transparent)',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: '12px',
}

function Field({ name, value }: { name: string; value: string }): React.ReactElement {
  return (
    <div style={row}>
      <span style={label}>{name}</span>
      <span style={mono}>{value}</span>
    </div>
  )
}

/**
 * 设置页主体。
 * @param props - 页签所有者传入的属性（本页不使用）。
 * @returns 设置页元素。
 */
export function RorokoSettingsPage(props: { t: Translate }): React.ReactElement {
  const { t } = props
  const [state, setState] = useState<StateBody | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch('/roroko-tool/state', { credentials: 'same-origin' })
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      setState(await response.json() as StateBody)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const reset = useCallback(async () => {
    setNote(null)
    try {
      const response = await fetch('/roroko-tool/reset', { method: 'POST', credentials: 'same-origin' })
      const body = await response.json() as { ok?: boolean }
      setNote(body.ok === true ? t('resetDone') : t('resetFailed'))
      await load()
    } catch {
      setNote(t('resetFailed'))
    }
  }, [load, t])

  if (error !== null) {
    return (
      <div style={box}>
        <div style={label}>{t('failed')}: {error}</div>
        <button style={button} onClick={() => { void load() }}>{t('refresh')}</button>
      </div>
    )
  }
  if (state === null) return <div style={box}><div style={label}>{t('loading')}</div></div>

  return (
    <div style={box}>
      <div>
        <div style={{ fontSize: '15px', fontWeight: 600 }}>{t('title')}</div>
        <div style={label}>{t('subtitle')} · {t('version')} {state.version}</div>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 600 }}>{t('mounts')}</div>
        {state.mounts.length === 0
          ? <div style={label}>{t('none')}</div>
          : state.mounts.map((mount, index) => (
            <div key={`${mount.root}-${String(index)}`} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <Field name={t('root')} value={mount.root} />
              <Field name={t('identityFiles')} value={mount.identityFiles.join(', ')} />
              <Field name={t('workspaceFiles')} value={mount.workspaceFiles.join(', ')} />
              <Field name={t('includeWorkspace')} value={mount.includeWorkspace ? t('on') : t('off')} />
            </div>
          ))}
      </div>

      <div style={card}>
        <div style={{ fontWeight: 600 }}>{t('injected')} · {String(state.injected.length)}</div>
        <Field name={t('injectedFile')} value={state.injectedFile ?? '—'} />
        <button style={button} onClick={() => { void reset() }}>{t('reset')}</button>
        {note === null ? null : <div style={label}>{note}</div>}
      </div>
    </div>
  )
}

/**
 * 注册设置页。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: ClientContext): void {
  const slots = (ctx as unknown as { slots: any }).slots
  const locale = (ctx as unknown as { locale: any }).locale

  ctx.effect(() => locale.register(NS, { zh }), 'roroko-tool: 文案')
  const t = locale.bind(NS) as Translate

  ctx.effect(() => slots.register({
    name: 'plugins.tab',
    id: 'roroko-tool',
    order: 40,
    label: () => t('title'),
    locale: NS,
  }, () => <RorokoSettingsPage t={t} />), 'roroko-tool: 设置页')
}
