/**
 * 洛洛可设置页（浏览器半侧）。
 *
 * 挂进设置面板的 `settings.section`：两张清单，一块拼进系统层，一块拼进用户层。
 * 保存即写 `<root>/state/preinject.json`，preinject 的 provider 每次装配现读，
 * 改完下一步就生效。
 *
 * 版式沿用旧版 roroko-tool 设置页那套：灰色说明行 + 浅底 PanelShell +
 * 逐行可增删的文件清单 + 底部保存按钮与内联的已保存/失败提示。
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

/** 左栏一级图标。 */
export function RorokoIcon({ size = 18, active = false }: { size?: number; active?: boolean }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ opacity: active ? 1 : 0.72 }}>
      <path d="M4 17.5V9.2L12 4l8 5.2v8.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.3 20v-6.2h7.4V20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 通用行内按钮样式。 */
const buttonStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--dsw-text-secondary, #888)',
  borderRadius: 4,
  color: 'var(--dsw-text-secondary, #888)',
  cursor: 'pointer',
  fontSize: '0.85em',
  lineHeight: 1.2,
  padding: '2px 8px',
}

const inputStyle: React.CSSProperties = {
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

const hintStyle: React.CSSProperties = {
  color: 'var(--dsw-text-secondary, #888)',
  fontSize: '0.8em',
  marginTop: 2,
}

const groupLabelStyle: React.CSSProperties = {
  color: 'var(--dsw-text-secondary, #888)',
  display: 'block',
  fontSize: '0.85em',
  marginBottom: 4,
  marginTop: 8,
}

/** 区块外壳：参数面板共用背景/圆角/内边距。 */
function PanelShell(props: { children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{
      background: 'var(--dsw-surface-secondary, rgba(128,128,128,.06))',
      borderRadius: 6,
      margin: '8px 0 4px',
      padding: '10px 12px',
    }}>
      {props.children}
    </div>
  )
}

/** 工具卡片头：标题 + 一句说明。 */
function ToolHeader(props: { title: string; desc: string }): React.ReactElement {
  return (
    <div style={{ margin: '14px 0 4px' }}>
      <div style={{ fontWeight: 600 }}>{props.title}</div>
      <div style={hintStyle}>{props.desc}</div>
    </div>
  )
}

/** 文件清单编辑器：若干行文本框 + 增删。系统层与用户层共用一份。 */
function FileListEditor(props: {
  files: string[]
  busy: boolean
  placeholder: string
  addLabel: string
  deleteLabel: string
  onChange: (next: string[]) => void
}): React.ReactElement {
  const { files, busy, placeholder, addLabel, deleteLabel, onChange } = props
  return (
    <div>
      {files.map((file, index) => (
        <div key={`file-${String(index)}`} style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' }}>
          <input
            type="text"
            value={file}
            disabled={busy}
            placeholder={placeholder}
            style={inputStyle}
            onChange={event => {
              const next = files.slice()
              next[index] = event.target.value
              onChange(next)
            }}
          />
          <button
            type="button"
            disabled={busy}
            title={deleteLabel}
            style={{ ...buttonStyle, flexShrink: 0 }}
            onClick={() => { onChange(files.filter((_, i) => i !== index)) }}
          >✕</button>
        </div>
      ))}
      <div style={{ marginTop: 4 }}>
        <button
          type="button"
          disabled={busy}
          style={buttonStyle}
          onClick={() => { onChange([...files, '']) }}
        >{addLabel}</button>
      </div>
    </div>
  )
}

/** 清单读盘状态：就绪 / 缺失，标在清单下面。 */
function FileStatus(props: { infos: FileInfo[] | undefined; t: Translate }): React.ReactElement | null {
  const { infos, t } = props
  if (infos === undefined || infos.length === 0) return null
  return (
    <div style={{ ...hintStyle, marginTop: 6 }}>
      {infos.map((info, index) => (
        <span key={info.path}>
          {index > 0 ? ' · ' : ''}
          <span style={{
            color: info.exists
              ? 'var(--dsw-text-success, #46a758)'
              : 'var(--dsw-text-danger, #e5484d)',
          }}>
            {info.name} {info.exists ? `✓ ${t('present')}` : `✗ ${t('missing')}`}
          </span>
        </span>
      ))}
    </div>
  )
}

/** 清单落盘前清洗：去首尾空白、去空行、去重。 */
function cleanList(list: readonly string[]): string[] {
  return list
    .map(item => item.trim())
    .filter(item => item.length > 0)
    .filter((item, index, self) => self.indexOf(item) === index)
}

/**
 * 设置页主体。
 * @param props - 页签所有者传入的属性。
 * @returns 设置页元素。
 */
export function RorokoSettingsPage(props: { t: Translate }): React.ReactElement {
  const { t } = props
  const [state, setState] = useState<StateBody | null>(null)
  const [systemFiles, setSystemFiles] = useState<string[]>([])
  const [userFiles, setUserFiles] = useState<string[]>([])
  const [wrap, setWrap] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const body = await fetchState()
      setState(body)
      if (body.config !== undefined) {
        setSystemFiles(body.config.systemFiles)
        setUserFiles(body.config.userFiles)
        setWrap(body.config.wrap)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(() => {
    setSaved(false)
    setSaveError(null)
    setSaving(true)
    void saveConfig({ systemFiles: cleanList(systemFiles), userFiles: cleanList(userFiles), wrap })
      .then(async ack => {
        if (!ack.ok) throw new Error(ack.reason ?? t('saveFailed'))
        setSaved(true)
        await load()
      })
      .catch((cause: unknown) => {
        setSaveError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => { setSaving(false) })
  }, [systemFiles, userFiles, wrap, load, t])

  const reset = useCallback(() => {
    setNote(null)
    void resetInjected()
      .then(ack => { setNote(ack.ok ? t('resetDone') : t('resetFailed')); return load() })
      .catch(() => { setNote(t('resetFailed')) })
  }, [load, t])

  if (error !== null) {
    return (
      <div style={{ padding: '6px 0', color: 'var(--dsw-text-secondary, #888)', fontSize: '0.9em' }}>
        {t('failed')}: {error}
        <div style={{ marginTop: 8 }}>
          <button style={buttonStyle} onClick={() => { void load() }}>{t('refresh')}</button>
        </div>
      </div>
    )
  }
  if (state === null) {
    return <div style={{ padding: '6px 0', color: 'var(--dsw-text-secondary, #888)', fontSize: '0.9em' }}>{t('loading')}</div>
  }
  if (!state.mounted) {
    return (
      <div style={{ padding: '6px 0' }}>
        <div style={{ fontWeight: 600 }}>{t('notMounted')}</div>
        <div style={hintStyle}>{t('notMountedHint')}</div>
      </div>
    )
  }

  const busy = saving

  return (
    <div style={{ padding: '6px 0' }}>
      <div style={{ color: 'var(--dsw-text-secondary, #888)', fontSize: '0.9em', marginBottom: 12 }}>
        {t('title')} · {t('subtitle')}
      </div>

      <ToolHeader title={t('systemTitle')} desc={t('systemHint')} />
      <PanelShell>
        <FileListEditor
          files={systemFiles}
          busy={busy}
          placeholder={t('filesHint')}
          addLabel={t('addFile')}
          deleteLabel={t('deleteRow')}
          onChange={next => { setSystemFiles(next); setSaved(false) }}
        />
        <FileStatus infos={state.files?.system} t={t} />
      </PanelShell>

      <ToolHeader title={t('userTitle')} desc={t('userHint')} />
      <PanelShell>
        <FileListEditor
          files={userFiles}
          busy={busy}
          placeholder={t('filesHint')}
          addLabel={t('addFile')}
          deleteLabel={t('deleteRow')}
          onChange={next => { setUserFiles(next); setSaved(false) }}
        />
        <label style={{
          alignItems: 'center',
          cursor: 'pointer',
          display: 'flex',
          fontSize: '0.85em',
          gap: 6,
          marginTop: 10,
        }}>
          <input
            type="checkbox"
            checked={wrap}
            disabled={busy}
            onChange={() => { setWrap(value => !value); setSaved(false) }}
          />
          {t('wrap')}
        </label>
        <FileStatus infos={state.files?.user} t={t} />
      </PanelShell>

      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        <button type="button" disabled={busy} style={buttonStyle} onClick={save}>
          {saving ? t('saving') : t('save')}
        </button>
        <button type="button" disabled={busy} style={buttonStyle} onClick={() => { void load() }}>
          {t('refresh')}
        </button>
        {saved
          ? <span style={{ color: 'var(--dsw-text-success, #46a758)', fontSize: '0.8em' }}>{t('saved')}</span>
          : null}
        {saveError === null
          ? null
          : <span style={{ color: 'var(--dsw-text-danger, #e5484d)', fontSize: '0.8em' }}>{t('saveFailed')}: {saveError}</span>}
      </div>

      <ToolHeader title={t('injectedCount')} desc={t('injectedHint')} />
      <PanelShell>
        <div style={{ fontSize: '0.85em', lineHeight: 1.9 }}>
          <div>{t('root')}: {state.root ?? '—'}</div>
          <div>{t('configFile')}: {state.configFile ?? '—'}</div>
          <div>{t('injectedFile')}: {state.injectedFile ?? '—'}</div>
          <div>{t('injectedCount')}: {state.injected?.length ?? 0}</div>
        </div>
        <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          <button type="button" style={buttonStyle} onClick={() => { void reset() }}>{t('reset')}</button>
          {note === null
            ? null
            : <span style={{ color: 'var(--dsw-text-secondary, #888)', fontSize: '0.8em' }}>{note}</span>}
        </div>
      </PanelShell>
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
