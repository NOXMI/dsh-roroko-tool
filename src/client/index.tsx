/**
 * 洛洛可设置页（浏览器半侧）。
 *
 * 版式照 0.1.6 那套：灰色说明行 + 浅底面板 + 逐行可增删的文件清单 +
 * 底部保存按钮与内联的已保存/失败提示。
 *
 * 内容换成新版的分桶结构：公共默认一张卡（默认展开），注册表里每个 preset
 * 一张折叠卡。每组参数一个「覆盖」勾选框——不勾就一个字段都不发，跟随继承；
 * 勾了整组落盘，空清单就是显式清空。两组都不覆盖时保存 = 把桶删掉。
 *
 * 数据走宿主自己的 HTTP 路由（见 api.ts），不碰 Remote/configForms。
 */
import { useCallback, useEffect, useState } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { en, zh, type LocaleKey } from './locales.js'
import {
  fetchState,
  saveConfig,
  type AutoinjectSettings,
  type Bucket,
  type DatasBucket,
  type DatasEffective,
  type FileInfo,
  type InjectConfig,
  type StateBody,
} from './api.js'

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

/** 卡片外壳。 */
const cardStyle: React.CSSProperties = {
  border: '1px solid var(--dsw-text-secondary, #444)',
  borderRadius: 6,
  margin: '8px 0',
  padding: '8px 10px',
}

/** 卡片标题按钮（整行可点、左对齐）。 */
const cardHeadStyle: React.CSSProperties = {
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

/** 卡片状态徽标。 */
const badgeStyle: React.CSSProperties = {
  border: '1px solid var(--dsw-text-secondary, #666)',
  borderRadius: 4,
  color: 'var(--dsw-text-secondary, #888)',
  fontSize: '0.78em',
  padding: '1px 6px',
}

/** 「覆盖这一组」复选框所在行。 */
const coverLabelStyle: React.CSSProperties = {
  alignItems: 'center',
  cursor: 'pointer',
  display: 'flex',
  fontSize: '0.88em',
  gap: 6,
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

/** 可折叠卡片：标题一行，点开才渲染内容。 */
function ScopeCard(props: {
  title: string
  hint: string
  badge: string
  defaultOpen: boolean
  children: React.ReactNode
}): React.ReactElement {
  const [open, setOpen] = useState(props.defaultOpen)
  return (
    <div style={cardStyle}>
      <button type="button" style={cardHeadStyle} onClick={() => { setOpen(value => !value) }}>
        <span style={{ fontWeight: 600 }}>{open ? '▾' : '▸'} {props.title}</span>
        <span style={badgeStyle}>{props.badge}</span>
      </button>
      <div style={hintStyle}>{props.hint}</div>
      {open ? <div style={{ marginTop: 8 }}>{props.children}</div> : null}
    </div>
  )
}

/** 文件清单编辑器：若干行文本框 + 增删。 */
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
        <button type="button" disabled={busy} style={buttonStyle} onClick={() => { onChange([...files, '']) }}>
          {addLabel}
        </button>
      </div>
    </div>
  )
}

/** 清单读盘状态：就绪 / 缺失。 */
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

/** 一张卡的内容：两组参数 + 保存 / 重置。 */
function ScopePanel(props: {
  t: Translate
  scope: string
  bucket: Bucket | undefined
  effective: InjectConfig | undefined
  files: { system: FileInfo[]; user: FileInfo[] } | undefined
  onSaved: () => Promise<void>
}): React.ReactElement {
  const { t, scope, bucket, effective, files, onSaved } = props
  const [coverSystem, setCoverSystem] = useState(() => bucket?.systemFiles !== undefined)
  const [coverUser, setCoverUser] = useState(() => bucket?.userFiles !== undefined)
  const [systemFiles, setSystemFiles] = useState<string[]>(() => [...(bucket?.systemFiles ?? effective?.systemFiles ?? [])])
  const [userFiles, setUserFiles] = useState<string[]>(() => [...(bucket?.userFiles ?? effective?.userFiles ?? [])])
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const save = (): void => {
    setSaved(false)
    setSaveError(null)
    setSaving(true)
    const patch: Record<string, unknown> = { preset: scope }
    patch.systemFiles = coverSystem ? cleanList(systemFiles) : null
    patch.userFiles = coverUser ? cleanList(userFiles) : null
    void saveConfig(patch)
      .then(async ack => {
        if (!ack.ok) throw new Error(ack.reason ?? t('saveFailed'))
        setSaved(true)
        await onSaved()
      })
      .catch((cause: unknown) => {
        setSaveError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => { setSaving(false) })
  }

  const resetScope = (): void => {
    setSaved(false)
    setSaveError(null)
    setSaving(true)
    void saveConfig({ preset: scope, reset: true })
      .then(async ack => {
        if (!ack.ok) throw new Error(ack.reason ?? t('saveFailed'))
        setSaved(true)
        await onSaved()
      })
      .catch((cause: unknown) => {
        setSaveError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => { setSaving(false) })
  }

  const busy = saving
  const followSystem = effective?.systemFiles.join(' / ') ?? ''
  const followUser = effective?.userFiles.join(' / ') ?? ''

  return (
    <PanelShell>
      <label style={coverLabelStyle}>
        <input
          type="checkbox"
          checked={coverSystem}
          disabled={busy}
          onChange={() => { setCoverSystem(value => !value); setSaved(false) }}
        />
        {t('coverSystem')}
      </label>
      {coverSystem
        ? (
          <div>
            <FileListEditor
              files={systemFiles}
              busy={busy}
              placeholder={t('filesHint')}
              addLabel={t('addFile')}
              deleteLabel={t('deleteRow')}
              onChange={next => { setSystemFiles(next); setSaved(false) }}
            />
            <FileStatus infos={files?.system} t={t} />
          </div>
        )
        : <div style={hintStyle}>{t('followSystem')}: {followSystem.length > 0 ? followSystem : t('emptyFiles')}</div>}

      <label style={coverLabelStyle}>
        <input
          type="checkbox"
          checked={coverUser}
          disabled={busy}
          onChange={() => { setCoverUser(value => !value); setSaved(false) }}
        />
        {t('coverUser')}
      </label>
      {coverUser
        ? (
          <div>
            <FileListEditor
              files={userFiles}
              busy={busy}
              placeholder={t('filesHint')}
              addLabel={t('addFile')}
              deleteLabel={t('deleteRow')}
              onChange={next => { setUserFiles(next); setSaved(false) }}
            />
            <FileStatus infos={files?.user} t={t} />
          </div>
        )
        : <div style={hintStyle}>{t('followUser')}: {followUser.length > 0 ? followUser : t('emptyFiles')}</div>}

      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        <button type="button" disabled={busy} style={buttonStyle} onClick={save}>
          {saving ? t('saving') : t('save')}
        </button>
        <button type="button" disabled={busy} style={buttonStyle} onClick={resetScope}>
          {t('resetScope')}
        </button>
        {saved
          ? <span style={{ color: 'var(--dsw-text-success, #46a758)', fontSize: '0.8em' }}>{t('saved')}</span>
          : null}
        {saveError === null
          ? null
          : <span style={{ color: 'var(--dsw-text-danger, #e5484d)', fontSize: '0.8em' }}>{t('saveFailed')}: {saveError}</span>}
      </div>
    </PanelShell>
  )
}

/** 一组自动注入开关：两个布尔 + 两个数字。 */
function AutoinjectEditor(props: {
  value: AutoinjectSettings
  busy: boolean
  t: Translate
  onChange: (next: AutoinjectSettings) => void
}): React.ReactElement {
  const { value, busy, t, onChange } = props
  const num = (key: 'every' | 'minGap'): React.ReactElement => (
    <input
      type="number"
      min={key === 'every' ? 1 : 0}
      max={200}
      value={value[key]}
      disabled={busy}
      style={{ ...inputStyle, width: 90 }}
      onChange={event => {
        const next = Number(event.target.value)
        onChange({ ...value, [key]: Number.isFinite(next) ? Math.trunc(next) : value[key] })
      }}
    />
  )
  return (
    <div>
      <label style={coverLabelStyle}>
        <input
          type="checkbox"
          checked={value.rounds}
          disabled={busy}
          onChange={() => { onChange({ ...value, rounds: !value.rounds }) }}
        />
        {t('aiRounds')}
      </label>
      <label style={coverLabelStyle}>
        <input
          type="checkbox"
          checked={value.afterTool}
          disabled={busy}
          onChange={() => { onChange({ ...value, afterTool: !value.afterTool }) }}
        />
        {t('aiAfterTool')}
      </label>
      <div style={{ ...coverLabelStyle, cursor: 'default' }}>
        <span>{t('aiEvery')}</span>
        {num('every')}
        <span>{t('aiMinGap')}</span>
        {num('minGap')}
      </div>
    </div>
  )
}

/** 素材库参数：库路径 + 自动注入节奏。 */
function DatasPanel(props: {
  t: Translate
  scope: string
  bucket: DatasBucket | undefined
  effective: DatasEffective | undefined
  defaults: DatasEffective
  onSaved: () => Promise<void>
}): React.ReactElement {
  const { t, scope, bucket, effective, defaults, onSaved } = props
  const follow = effective ?? defaults
  const [coverPath, setCoverPath] = useState(() => bucket?.dbPath !== undefined)
  const [coverAuto, setCoverAuto] = useState(() => bucket?.autoinject !== undefined)
  const [dbPath, setDbPath] = useState<string>(() => bucket?.dbPath ?? follow.dbPath)
  const [auto, setAuto] = useState<AutoinjectSettings>(() => ({ ...follow.autoinject }))
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const run = (patch: Record<string, unknown>): void => {
    setSaved(false)
    setSaveError(null)
    setSaving(true)
    void saveConfig(patch)
      .then(async ack => {
        if (!ack.ok) throw new Error(ack.reason ?? t('saveFailed'))
        setSaved(true)
        await onSaved()
      })
      .catch((cause: unknown) => {
        setSaveError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => { setSaving(false) })
  }

  const save = (): void => {
    run({
      preset: scope,
      section: 'datas',
      dbPath: coverPath ? dbPath.trim() : null,
      autoinject: coverAuto ? auto : null,
    })
  }

  const busy = saving
  return (
    <PanelShell>
      <ToolHeader title={t('datasTitle')} desc={t('datasHint')} />

      <label style={coverLabelStyle}>
        <input
          type="checkbox"
          checked={coverPath}
          disabled={busy}
          onChange={() => { setCoverPath(value => !value); setSaved(false) }}
        />
        {t('coverDbPath')}
      </label>
      {coverPath
        ? (
          <div>
            <input
              type="text"
              value={dbPath}
              disabled={busy}
              placeholder={t('dbPathHint')}
              style={inputStyle}
              onChange={event => { setDbPath(event.target.value); setSaved(false) }}
            />
          </div>
        )
        : <div style={hintStyle}>{t('followDbPath')}: {follow.dbPath}</div>}

      <label style={coverLabelStyle}>
        <input
          type="checkbox"
          checked={coverAuto}
          disabled={busy}
          onChange={() => { setCoverAuto(value => !value); setSaved(false) }}
        />
        {t('coverAutoinject')}
      </label>
      {coverAuto
        ? (
          <AutoinjectEditor
            value={auto}
            busy={busy}
            t={t}
            onChange={next => { setAuto(next); setSaved(false) }}
          />
        )
        : (
          <div style={hintStyle}>
            {t('followAutoinject')}: {follow.autoinject.rounds ? t('on') : t('off')}
            {' · '}{t('aiEvery')}{follow.autoinject.every}
            {' · '}{t('aiMinGap')}{follow.autoinject.minGap}
          </div>
        )}

      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        <button type="button" disabled={busy} style={buttonStyle} onClick={save}>
          {saving ? t('saving') : t('save')}
        </button>
        <button
          type="button"
          disabled={busy}
          style={buttonStyle}
          onClick={() => { run({ preset: scope, section: 'datas', reset: true }) }}
        >
          {t('resetScope')}
        </button>
        {saved
          ? <span style={{ color: 'var(--dsw-text-success, #46a758)', fontSize: '0.8em' }}>{t('saved')}</span>
          : null}
        {saveError === null
          ? null
          : <span style={{ color: 'var(--dsw-text-danger, #e5484d)', fontSize: '0.8em' }}>{t('saveFailed')}: {saveError}</span>}
      </div>
    </PanelShell>
  )
}

/**
 * 设置页主体。
 * @param props - 页签所有者传入的属性。
 * @returns 设置页元素。
 */export function RorokoSettingsPage(props: { t: Translate }): React.ReactElement {
  const { t } = props
  const [state, setState] = useState<StateBody | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setState(await fetchState())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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
  if (!state.mounted && state.datas?.mounted !== true) {
    return (
      <div style={{ padding: '6px 0' }}>
        <div style={{ fontWeight: 600 }}>{t('notMounted')}</div>
        <div style={hintStyle}>{t('notMountedHint')}</div>
      </div>
    )
  }

  const scopes = state.scopes ?? ['common']
  const roster = new Map((state.roster ?? []).map(row => [row.id, row]))

  return (
    <div style={{ padding: '6px 0' }}>
      <div style={{ color: 'var(--dsw-text-secondary, #888)', fontSize: '0.9em', marginBottom: 12 }}>
        {t('title')} · {t('subtitle')} — {t('root')}: {state.root ?? '—'}
      </div>

      {scopes.map(scope => {
        const bucket = state.presets?.[scope]
        const isCommon = scope === 'common'
        const row = roster.get(scope)
        const badge = isCommon
          ? t('badgeBaseline')
          : row?.broken !== undefined
            ? t('badgeBroken')
            : bucket === undefined ? t('badgeInherit') : t('badgeOverridden')
        const title = isCommon
          ? t('commonTitle')
          : row?.name === undefined || row.name.length === 0 ? scope : `${scope} · ${row.name}`
        return (
          <ScopeCard
            key={`${scope}:${JSON.stringify(bucket ?? {})}`}
            title={title}
            hint={isCommon ? t('commonHint') : t('presetHint')}
            badge={badge}
            defaultOpen={isCommon}
          >
            {state.mounted
              ? (
                <ScopePanel
                  t={t}
                  scope={scope}
                  bucket={bucket}
                  effective={state.effective?.[scope]}
                  files={state.files?.[scope]}
                  onSaved={load}
                />
              )
              : null}
            {state.datas?.mounted
              ? (
                <DatasPanel
                  t={t}
                  scope={scope}
                  bucket={state.datas.presets[scope]}
                  effective={state.datas.effective[scope]}
                  defaults={state.datas.defaults}
                  onSaved={load}
                />
              )
              : null}
          </ScopeCard>
        )
      })}

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
