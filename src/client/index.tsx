/**
 * 洛洛可设置页（浏览器半侧）。
 *
 * 挂进设置面板的 `settings.section`：两张清单，一块拼进系统层，一块拼进用户层。
 * 保存即写 `<root>/state/preinject.json`，preinject 的 provider 每次装配现读，
 * 改完下一步就生效。
 *
 * 数据走宿主自己的 HTTP 路由（见 api.ts），不碰 Remote/configForms。
 */
import { useCallback, useEffect, useState } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { en, zh, type LocaleKey } from './locales.js'
import { fetchState, resetInjected, saveConfig, type FileInfo, type StateBody } from './api.js'

/** 文案命名空间。 */
export const NS = 'rorokoTool'

/** 需要的客户端服务。 */
export const inject = ['slots', 'locale']

/** 文案签名（由 locale 服务注入）。 */
type Translate = (key: LocaleKey) => string

/** 页面草稿：清单在输入框里是纯文本。 */
interface Draft {
  systemFiles: string
  userFiles: string
  wrap: boolean
}

/** 左栏一级图标。 */
export function RorokoIcon({ size = 18, active = false }: { size?: number; active?: boolean }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ opacity: active ? 1 : 0.72 }}>
      <path d="M4 17.5V9.2L12 4l8 5.2v8.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.3 20v-6.2h7.4V20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace'

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
  gridTemplateColumns: '112px 1fr',
  gap: '10px',
  alignItems: 'baseline',
}

const label: React.CSSProperties = { opacity: 0.6 }
const dim: React.CSSProperties = { opacity: 0.55, fontSize: '12px' }
const code: React.CSSProperties = { fontFamily: mono, fontSize: '12px', wordBreak: 'break-all' }
const card: React.CSSProperties = {
  border: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
  borderRadius: '10px',
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
}
const input: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: mono,
  fontSize: '12px',
  lineHeight: 1.6,
  padding: '7px 10px',
  borderRadius: '8px',
  border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
  background: 'color-mix(in srgb, currentColor 4%, transparent)',
  color: 'inherit',
  resize: 'vertical',
}
const button = (disabled = false): React.CSSProperties => ({
  padding: '6px 12px',
  borderRadius: '8px',
  border: '1px solid color-mix(in srgb, currentColor 22%, transparent)',
  background: 'transparent',
  color: 'inherit',
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.45 : 1,
  fontSize: '12px',
})

function Field({ name, value }: { name: string; value: string }): React.ReactElement {
  return (
    <div style={row}>
      <span style={label}>{name}</span>
      <span style={code}>{value}</span>
    </div>
  )
}

/** 清单文本 → 文件名数组（一行一个，去掉空行）。 */
function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${String(bytes)} B` : `${(bytes / 1024).toFixed(1)} KB`
}

/**
 * 设置页主体。
 * @param props - 页签所有者传入的属性。
 * @returns 设置页元素。
 */
export function RorokoSettingsPage(props: { t: Translate }): React.ReactElement {
  const { t } = props
  const [state, setState] = useState<StateBody | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const body = await fetchState()
      setState(body)
      const config = body.config
      setDraft(config === undefined
        ? null
        : { systemFiles: config.systemFiles.join('\n'), userFiles: config.userFiles.join('\n'), wrap: config.wrap })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(async () => {
    if (draft === null) return
    setBusy(true)
    setNote(null)
    try {
      const ack = await saveConfig({
        systemFiles: splitLines(draft.systemFiles),
        userFiles: splitLines(draft.userFiles),
        wrap: draft.wrap,
      })
      setNote(ack.ok ? t('saved') : `${t('saveFailed')}: ${ack.reason ?? ''}`)
      await load()
    } catch (cause) {
      setNote(`${t('saveFailed')}: ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setBusy(false)
    }
  }, [draft, load, t])

  const reset = useCallback(async () => {
    setNote(null)
    try {
      const ack = await resetInjected()
      setNote(ack.ok ? t('resetDone') : t('resetFailed'))
      await load()
    } catch {
      setNote(t('resetFailed'))
    }
  }, [load, t])

  if (error !== null) {
    return (
      <div style={box}>
        <div style={label}>{t('failed')}: {error}</div>
        <button style={button()} onClick={() => { void load() }}>{t('refresh')}</button>
      </div>
    )
  }
  if (state === null) return <div style={box}><div style={label}>{t('loading')}</div></div>
  if (!state.mounted) {
    return (
      <div style={box}>
        <div style={{ fontSize: '15px', fontWeight: 600 }}>{t('notMounted')}</div>
        <div style={label}>{t('notMountedHint')}</div>
      </div>
    )
  }
  if (draft === null) return <div style={box}><div style={label}>{t('loading')}</div></div>

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft(current => (current === null ? current : { ...current, [key]: value }))
  }

  /** 文件状态条（缺文件也照列，标出来就好）。 */
  const fileStatus = (infos: FileInfo[] | undefined): React.ReactElement => {
    if (infos === undefined || infos.length === 0) return <div style={dim}>{t('emptyFiles')}</div>
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
        {infos.map(info => (
          <span key={info.path} style={{ ...code, opacity: info.exists ? 0.85 : 0.45 }}>
            {info.name} · {info.exists ? `${t('present')} ${formatBytes(info.bytes)}` : t('missing')}
          </span>
        ))}
      </div>
    )
  }

  /**
   * 一张清单。
   * @param opts - 标题、说明、草稿字段、文件状态、附加控件。
   * @returns 卡片元素。
   */
  const layer = (opts: {
    title: string
    hint: string
    filesKey: 'systemFiles' | 'userFiles'
    infos: FileInfo[] | undefined
    extra?: React.ReactNode
  }): React.ReactElement => (
    <div style={card}>
      <div style={{ fontWeight: 600 }}>{opts.title}</div>
      <div style={dim}>{opts.hint}</div>
      <textarea
        style={{ ...input, minHeight: '96px' }}
        spellCheck={false}
        value={draft[opts.filesKey]}
        placeholder={t('filesHint')}
        onChange={event => { set(opts.filesKey, event.target.value) }}
      />
      {fileStatus(opts.infos)}
      {opts.extra}
    </div>
  )

  return (
    <div style={box}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 600 }}>{t('title')}</div>
          <div style={label}>{t('subtitle')} · {t('version')} {state.version}</div>
        </div>
        <button style={button(busy)} disabled={busy} onClick={() => { void load() }}>{t('refresh')}</button>
      </div>

      <div style={card}>
        <Field name={t('root')} value={state.root ?? '—'} />
        <Field name={t('configFile')} value={state.configFile ?? '—'} />
        <Field name={t('injectedFile')} value={state.injectedFile ?? '—'} />
        <div style={row}>
          <span style={label}>{t('injectedCount')}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={code}>{state.injected?.length ?? 0}</span>
            <button style={button()} onClick={() => { void reset() }}>{t('reset')}</button>
            {(state.injected?.length ?? 0) === 0 ? <span style={dim}>{t('injectedEmpty')}</span> : null}
          </span>
        </div>
      </div>

      {layer({
        title: t('systemTitle'),
        hint: t('systemHint'),
        filesKey: 'systemFiles',
        infos: state.files?.system,
      })}

      {layer({
        title: t('userTitle'),
        hint: t('userHint'),
        filesKey: 'userFiles',
        infos: state.files?.user,
        extra: (
          <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={draft.wrap}
              onChange={event => { set('wrap', event.target.checked) }}
            />
            <span style={dim}>{t('wrap')} · {t('wrapHint')}</span>
          </label>
        ),
      })}

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <button style={button(busy)} disabled={busy} onClick={() => { void save() }}>{t('save')}</button>
        {note === null ? null : <span style={label}>{note}</span>}
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

  // 注册失败不拖垮整条 entry：把真实原因打到控制台，页面照常启动。
  try {
    ctx.effect(() => locale.register(NS, { zh, en }), 'roroko-tool: 文案')

    // 设置面板里的独立一页（与「通用」「模型」「插件」同级）。
    slots.inject('settings.section', () => slots.register({
      name: 'settings.section',
      id: 'roroko-tool',
      order: 50,
      label: () => '洛洛可',
      locale: NS,
    }, RorokoSettingsPage))
  } catch (error) {
    console.error('[roroko-tool] 设置页注册失败：', error)
  }
}
