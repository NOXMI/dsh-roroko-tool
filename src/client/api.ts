/**
 * 设置页的 HTTP 口。同源 fetch，不走官方 settings loopback（远程浏览器写不进去）。
 *
 *   GET  /roroko-tool/state   公共默认 + 各 preset 桶 + roster + 文件状态 + 跳闸记录
 *   POST /roroko-tool/config  按 preset 写覆盖桶
 *   POST /roroko-tool/reset   清空跳闸记录
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
  wrap: boolean
}

/** 一个桶里的覆盖字段（缺失 = 跟随下层）。 */
export interface Bucket {
  systemFiles?: string[]
  userFiles?: string[]
  wrap?: boolean
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
  injectedFile?: string
  injected?: string[]
  presets?: Record<string, Bucket>
  defaults?: InjectConfig
  wiring?: Partial<InjectConfig>
  roster?: PresetRow[]
  scopes?: string[]
  effective?: Record<string, InjectConfig>
  files?: Record<string, { system: FileInfo[]; user: FileInfo[] }>
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

/** 清空跳闸记录。 */
export function resetInjected(): Promise<Ack> {
  return request<Ack>('/roroko-tool/reset', { method: 'POST' })
}
