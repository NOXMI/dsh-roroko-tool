/**
 * 设置页的 HTTP 口。同源 fetch，不走官方 settings loopback（远程浏览器写不进去）。
 *
 *   GET  /roroko-tool/state   公共默认 + 各 preset 桶 + roster + 文件状态
 *   POST /roroko-tool/config  按 preset 写覆盖桶
 */

/** 一个注入文件的状态。 */
export interface FileInfo {
  name: string
  path: string
  exists: boolean
  bytes: number
}

/** 一份合成后的参数。 */
export interface InjectConfig {
  systemFiles: string[]
  userFiles: string[]
  suppressSections: string[]
}

/** 一个桶里的覆盖字段（缺失 = 跟随下层）。 */
export interface Bucket {
  systemFiles?: string[]
  userFiles?: string[]
  suppressSections?: string[]
}

/** state 短条自动注入的开关与节奏。 */
export interface AutoinjectSettings {
  rounds: boolean
  every: number
  afterTool: boolean
  minGap: number
}

/** datas 桶里的覆盖字段（autoinject 逐字段叠加）。 */
export interface DatasBucket {
  enabled?: boolean
  dbPath?: string
  autoinject?: Partial<AutoinjectSettings>
}

/** datas 合成后的生效参数。 */
export interface DatasEffective {
  enabled: boolean
  dbPath: string
  autoinject: AutoinjectSettings
}

/** datas 侧全量状态。 */
export interface DatasBody {
  mounted: boolean
  stateFile?: string
  defaults: DatasEffective
  wiring: Partial<DatasEffective>
  presets: Record<string, DatasBucket>
  effective: Record<string, DatasEffective>
}

/** dream（定时反思）的配置。 */
export interface DreamConfig {
  enabled: boolean
  intervalMs: number
  batch: number
  provider: string
  model: string
  preset: string
  cwd: string
}

/** memory 桶里的覆盖字段（dream 逐字段叠加）。 */
export interface MemoryBucket {
  enabled?: boolean
  dbPath?: string
  owner?: string
  dream?: Partial<DreamConfig>
}

/** memory 合成后的生效参数。 */
export interface MemoryEffective {
  enabled: boolean
  dbPath: string
  owner: string
  dream: DreamConfig
}

/** dream 运行面（手动触发与最近一次结果）。 */
export interface DreamBody {
  running: boolean
  started: boolean
  config: DreamConfig | null
  last: {
    note?: string
    queued?: number
    changed?: number[]
    added?: number
    at?: string
    error?: string
  } | null
}

/** memory 侧全量状态。 */
export interface MemoryBody {
  mounted: boolean
  stateFile?: string
  defaults: MemoryEffective
  wiring: Partial<MemoryEffective>
  presets: Record<string, MemoryBucket>
  effective: Record<string, MemoryEffective>
  dream: DreamBody
}

/** preset 注册表里的一行。 */
export interface PresetRow {
  id: string
  name?: string
  description?: string
  broken?: string
}

/** 设置页拿到的全量状态。 */
export interface StateBody {
  version: string
  mounted: boolean
  root?: string
  stateFile?: string
  presets?: Record<string, Bucket>
  defaults?: InjectConfig
  wiring?: Partial<InjectConfig>
  roster?: PresetRow[]
  scopes?: string[]
  effective?: Record<string, InjectConfig>
  files?: Record<string, { system: FileInfo[]; user: FileInfo[] }>
  /** 素材库子模块（没挂载时为 undefined）。 */
  datas?: DatasBody
  /** 记忆子模块（没挂载时为 undefined）。 */
  memory?: MemoryBody
}

/** 写失败的通用形状。 */
interface Ack {
  ok: boolean
  reason?: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  return await response.json() as T
}

/** 读全量状态。 */
export function fetchState(): Promise<StateBody> {
  return request<StateBody>('/roroko-tool/state')
}

/**
 * 写某个桶。字段传 `null` 表示删掉该键（回到跟随下层）。
 * @param patch - 至少带 preset。
 * @returns 宿主回执。
 */
export function saveConfig(patch: Record<string, unknown>): Promise<Ack> {
  return request<Ack>('/roroko-tool/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

/** dream 状态（同一条路由，GET 读 / POST 立即整理一次）。 */
export function fetchDream(): Promise<DreamBody & Ack> {
  return request<DreamBody & Ack>('/roroko-tool/dream')
}

/** 立即整理一次。 */
export function runDream(): Promise<Ack & { result?: DreamBody['last'] }> {
  return request<Ack & { result?: DreamBody['last'] }>('/roroko-tool/dream', { method: 'POST' })
}
