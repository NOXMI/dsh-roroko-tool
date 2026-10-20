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
  runDream,
  saveConfig,
  type AutoinjectSettings,
  type Bucket,
  type DatasBucket,
  type DatasEffective,
  type DreamBody,
  type DreamConfig,
  type FileInfo,
  type InjectConfig,
  type MemoryBucket,
  type MemoryEffective,
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

/** 一张卡的内容：三组参数 + 保存 / 重置。 */
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
  const [coverSuppress, setCoverSuppress] = useState(() => bucket?.suppressSections !== undefined)
  const [systemFiles, setSystemFiles] = useState<string[]>(() => [...(bucket?.systemFiles ?? effective?.systemFiles ?? [])])
  const [userFiles, setUserFiles] = useState<string[]>(() => [...(bucket?.userFiles ?? effective?.userFiles ?? [])])
  const [suppressSections, setSuppressSections] = useState<string[]>(() => [
    ...(bucket?.suppressSections ?? effective?.suppressSections ?? []),
  ])
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
    patch.suppressSections = coverSuppress ? cleanList(suppressSections) : null
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
  const followSuppress = effective?.suppressSections.join(' / ') ?? ''

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

      <label style={coverLabelStyle}>
        <input
          type="checkbox"
          checked={coverSuppress}
          disabled={busy}
          onChange={() => { setCoverSuppress(value => !value); setSaved(false) }}
        />
        {t('coverSuppress')}
      </label>
      {coverSuppress
        ? (
          <div>
            <FileListEditor
              files={suppressSections}
              busy={busy}
              placeholder={t('suppressHint')}
              addLabel={t('addFile')}
              deleteLabel={t('deleteRow')}
              onChange={next => { setSuppressSections(next); setSaved(false) }}
            />
          </div>
        )
        : (
          <div style={hintStyle}>
            {t('followSuppress')}: {followSuppress.length > 0 ? followSuppress : t('emptyFiles')}
          </div>
        )}

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
  const [enabled, setEnabled] = useState<boolean>(() => follow.enabled)
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
      // 总开关不勾覆盖时也必须落盘，「关」本身就是要存的意图
      enabled,
      dbPath: coverPath ? dbPath.trim() : null,
      autoinject: coverAuto ? auto : null,
    })
  }

  const busy = saving
  return (
    <PanelShell>
      <label style={{ ...coverLabelStyle, fontWeight: 600 }}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={() => { setEnabled(value => !value); setSaved(false) }}
        />
        {t('datasEnabled')}
      </label>
      <div style={{ ...hintStyle, marginBottom: 6 }}>{t('datasEnabledHint')}</div>

      <label style={{ ...coverLabelStyle, opacity: enabled ? 1 : 0.5 }}>
        <input
          type="checkbox"
          checked={coverPath}
          disabled={busy || !enabled}
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
              disabled={busy || !enabled}
              placeholder={t('dbPathHint')}
              style={inputStyle}
              onChange={event => { setDbPath(event.target.value); setSaved(false) }}
            />
          </div>
        )
        : <div style={hintStyle}>{t('followDbPath')}: {follow.dbPath}</div>}

      <label style={{ ...coverLabelStyle, opacity: enabled ? 1 : 0.5 }}>
        <input
          type="checkbox"
          checked={coverAuto}
          disabled={busy || !enabled}
          onChange={() => { setCoverAuto(value => !value); setSaved(false) }}
        />
        {t('coverAutoinject')}
      </label>
      {coverAuto
        ? (
          <AutoinjectEditor
            value={auto}
            busy={busy || !enabled}
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
 * 记忆参数：库路径 + owner 桶 + dream 定时反思。
 * @param props - 页签所有者传入的属性。
 * @returns 面板元素。
 */
function MemoryPanel(props: {
  t: Translate
  scope: string
  bucket: MemoryBucket | undefined
  effective: MemoryEffective | undefined
  defaults: MemoryEffective
  dream: DreamBody
  onSaved: () => Promise<void>
}): React.ReactElement {
  const { t, scope, bucket, effective, defaults, dream, onSaved } = props
  const follow = effective ?? defaults
  const [enabled, setEnabled] = useState<boolean>(() => follow.enabled)
  const [coverPath, setCoverPath] = useState(() => bucket?.dbPath !== undefined)
  const [coverOwner, setCoverOwner] = useState(() => bucket?.owner !== undefined)
  const [coverDream, setCoverDream] = useState(() => bucket?.dream !== undefined)
  const [dbPath, setDbPath] = useState<string>(() => bucket?.dbPath ?? follow.dbPath)
  const [owner, setOwner] = useState<string>(() => bucket?.owner ?? follow.owner)
  const [cfg, setCfg] = useState<DreamConfig>(() => ({ ...follow.dream }))
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [dreamBusy, setDreamBusy] = useState(false)
  const [dreamNote, setDreamNote] = useState<string | null>(null)

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
      section: 'memory',
      // 总开关不勾覆盖时也必须落盘，「关」本身就是要存的意图
      enabled,
      dbPath: coverPath ? dbPath.trim() : null,
      owner: coverOwner ? owner.trim() : null,
      dream: coverDream ? cfg : null,
    })
  }

  const reflectNow = (): void => {
    setDreamBusy(true)
    setDreamNote(null)
    void runDream()
      .then(ack => {
        if (!ack.ok) throw new Error(ack.reason ?? 'dream 失败')
        setDreamNote(ack.result?.note ?? null)
        return onSaved()
      })
      .catch((cause: unknown) => { setDreamNote(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { setDreamBusy(false) })
  }

  const busy = saving
  const hours = (): number => Math.round((cfg.intervalMs / 3600000) * 10) / 10
  const text = (
    key: 'provider' | 'model' | 'preset' | 'cwd',
    placeholder: string,
  ): React.ReactElement => (
    <input
      type="text"
      value={cfg[key]}
      disabled={busy || !enabled}
      placeholder={placeholder}
      style={{ ...inputStyle, width: 220 }}
      onChange={event => { setCfg({ ...cfg, [key]: event.target.value }); setSaved(false) }}
    />
  )

  return (
    <PanelShell>
      <label style={{ ...coverLabelStyle, fontWeight: 600 }}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={() => { setEnabled(value => !value); setSaved(false) }}
        />
        {t('memoryEnabled')}
      </label>
      <div style={{ ...hintStyle, marginBottom: 6 }}>{t('memoryEnabledHint')}</div>

      <label style={{ ...coverLabelStyle, opacity: enabled ? 1 : 0.5 }}>
        <input
          type="checkbox"
          checked={coverPath}
          disabled={busy || !enabled}
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
              disabled={busy || !enabled}
              placeholder={t('dbPathHint')}
              style={inputStyle}
              onChange={event => { setDbPath(event.target.value); setSaved(false) }}
            />
          </div>
        )
        : <div style={hintStyle}>{t('followDbPath')}: {follow.dbPath}</div>}

      <label style={{ ...coverLabelStyle, opacity: enabled ? 1 : 0.5 }}>
        <input
          type="checkbox"
          checked={coverOwner}
          disabled={busy || !enabled}
          onChange={() => { setCoverOwner(value => !value); setSaved(false) }}
        />
        {t('coverOwner')}
      </label>
      {coverOwner
        ? (
          <div>
            <input
              type="text"
              value={owner}
              disabled={busy || !enabled}
              placeholder={t('ownerHint')}
              style={{ ...inputStyle, width: 180 }}
              onChange={event => { setOwner(event.target.value); setSaved(false) }}
            />
          </div>
        )
        : <div style={hintStyle}>{t('followDbPath')}: {follow.owner}</div>}

      <label style={{ ...coverLabelStyle, opacity: enabled ? 1 : 0.5 }}>
        <input
          type="checkbox"
          checked={coverDream}
          disabled={busy || !enabled}
          onChange={() => { setCoverDream(value => !value); setSaved(false) }}
        />
        {t('coverDream')}
      </label>
      {coverDream
        ? (
          <div>
            <div style={coverLabelStyle}>
              <label>
                <input
                  type="checkbox"
                  checked={cfg.enabled}
                  disabled={busy || !enabled}
                  onChange={() => { setCfg({ ...cfg, enabled: !cfg.enabled }); setSaved(false) }}
                />
                {t('dreamEnabled')}
              </label>
            </div>
            <div style={coverLabelStyle}>
              <span>{t('dreamInterval')}</span>
              <input
                type="number"
                min={0.1}
                max={24}
                step={0.5}
                value={hours()}
                disabled={busy || !enabled}
                style={{ ...inputStyle, width: 90 }}
                onChange={event => {
                  const next = Number(event.target.value)
                  setCfg({
                    ...cfg,
                    intervalMs: Number.isFinite(next) ? Math.round(next * 3600000) : cfg.intervalMs,
                  })
                  setSaved(false)
                }}
              />
              <span>{t('dreamBatch')}</span>
              <input
                type="number"
                min={1}
                max={50}
                value={cfg.batch}
                disabled={busy || !enabled}
                style={{ ...inputStyle, width: 90 }}
                onChange={event => {
                  const next = Number(event.target.value)
                  setCfg({ ...cfg, batch: Number.isFinite(next) ? Math.trunc(next) : cfg.batch })
                  setSaved(false)
                }}
              />
            </div>
            <div style={coverLabelStyle}>
              <span>{t('dreamProvider')}</span>{text('provider', 'deepseek')}
              <span>{t('dreamModel')}</span>{text('model', 'deepseek-chat')}
            </div>
            <div style={coverLabelStyle}>
              <span>{t('dreamPreset')}</span>{text('preset', 'roroko')}
              <span>{t('dreamCwd')}</span>{text('cwd', '/root/roroko-workplace')}
            </div>
          </div>
        )
        : (
          <div style={hintStyle}>
            {t('followAutoinject')}: {follow.dream.enabled ? t('on') : t('off')}
            {' · '}{t('dreamInterval')}{Math.round((follow.dream.intervalMs / 3600000) * 10) / 10}
            {' · '}{t('dreamBatch')}{follow.dream.batch}
            {follow.dream.provider.length > 0 ? ` · ${follow.dream.provider}/${follow.dream.model}` : ''}
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
          onClick={() => { run({ preset: scope, section: 'memory', reset: true }) }}
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

      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        <button type="button" disabled={busy || dreamBusy} style={buttonStyle} onClick={reflectNow}>
          {dreamBusy ? t('dreamRunning') : t('dreamNow')}
        </button>
        <span style={hintStyle}>
          {dream.started ? null : `${t('dreamIdle')} · `}
          {dream.last?.at !== undefined ? `${t('dreamLast')}: ${dream.last.at}` : ''}
          {dream.last?.note !== undefined ? ` · ${dream.last.note}` : ''}
          {dreamNote !== null ? ` · ${dreamNote}` : ''}
        </span>
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
  if (!state.mounted && state.datas?.mounted !== true && state.memory?.mounted !== true) {
    return (
      <div style={{ padding: '6px 0' }}>
        <div style={{ fontWeight: 600 }}>{t('notMounted')}</div>
        <div style={hintStyle}>{t('notMountedHint')}</div>
      </div>
    )
  }

  const scopes = state.scopes ?? ['common']
  const roster = new Map((state.roster ?? []).map(row => [row.id, row]))

  /** 一张 scope 卡的公共头部信息：标题 + 徽标 + 提示。 */
  const scopeHead = (scope: string, overridden: boolean): { title: string; badge: string; hint: string } => {
    const isCommon = scope === 'common'
    const row = roster.get(scope)
    const badge = isCommon
      ? t('badgeBaseline')
      : row?.broken !== undefined
        ? t('badgeBroken')
        : overridden ? t('badgeOverridden') : t('badgeInherit')
    const title = isCommon
      ? t('commonTitle')
      : row?.name === undefined || row.name.length === 0 ? scope : `${scope} · ${row.name}`
    return { title, badge, hint: isCommon ? t('commonHint') : t('presetHint') }
  }

  return (
    <div style={{ padding: '6px 0' }}>
      <div style={{ color: 'var(--dsw-text-secondary, #888)', fontSize: '0.9em', marginBottom: 12 }}>
        {t('title')} · {t('subtitle')} — {t('root')}: {state.root ?? '—'}
      </div>

      {state.mounted
        ? (
          <>
            <ToolHeader title={t('preinjectTitle')} desc={t('preinjectHint')} />
            {scopes.map(scope => {
              const bucket = state.presets?.[scope]
              const head = scopeHead(scope, bucket !== undefined)
              return (
                <ScopeCard
                  key={`preinject:${scope}:${JSON.stringify(bucket ?? {})}`}
                  title={head.title}
                  hint={head.hint}
                  badge={head.badge}
                  defaultOpen={scope === 'common'}
                >
                  <ScopePanel
                    t={t}
                    scope={scope}
                    bucket={bucket}
                    effective={state.effective?.[scope]}
                    files={state.files?.[scope]}
                    onSaved={load}
                  />
                </ScopeCard>
              )
            })}
          </>
        )
        : null}

      {state.datas?.mounted
        ? (
          <>
            <ToolHeader title={t('datasTitle')} desc={t('datasHint')} />
            {scopes.map(scope => {
              const bucket = state.datas?.presets[scope]
              const head = scopeHead(scope, bucket !== undefined)
              return (
                <ScopeCard
                  key={`datas:${scope}:${JSON.stringify(bucket ?? {})}`}
                  title={head.title}
                  hint={head.hint}
                  badge={head.badge}
                  defaultOpen={false}
                >
                  <DatasPanel
                    t={t}
                    scope={scope}
                    bucket={bucket}
                    effective={state.datas?.effective[scope]}
                    defaults={state.datas?.defaults ?? { enabled: false, dbPath: '', autoinject: { rounds: true, every: 8, afterTool: true, minGap: 4 } }}
                    onSaved={load}
                  />
                </ScopeCard>
              )
            })}
          </>
        )
        : null}

      {state.memory?.mounted
        ? (
          <>
            <ToolHeader title={t('memoryTitle')} desc={t('memoryHint')} />
            {scopes.map(scope => {
              const bucket = state.memory?.presets[scope]
              const head = scopeHead(scope, bucket !== undefined)
              return (
                <ScopeCard
                  key={`memory:${scope}:${JSON.stringify(bucket ?? {})}`}
                  title={head.title}
                  hint={head.hint}
                  badge={head.badge}
                  defaultOpen={false}
                >
                  <MemoryPanel
                    t={t}
                    scope={scope}
                    bucket={bucket}
                    effective={state.memory?.effective[scope]}
                    defaults={state.memory?.defaults ?? {
                      enabled: false,
                      dbPath: '',
                      owner: 'dev',
                      dream: {
                        enabled: true,
                        intervalMs: 4 * 60 * 60 * 1000,
                        batch: 20,
                        provider: '',
                        model: '',
                        preset: '',
                        cwd: '',
                      },
                    }}
                    dream={state.memory?.dream ?? { running: false, started: false, config: null, last: null }}
                    onSaved={load}
                  />
                </ScopeCard>
              )
            })}
          </>
        )
        : null}

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
