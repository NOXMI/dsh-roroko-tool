/**
 * 设置页的 HTTP 口。同源 fetch，不走官方 settings loopback（远程浏览器写不进去）。
 *
 *   GET  /roroko-tool/state   两张清单 + 文件状态 + 跳闸记录
 *   POST /roroko-tool/config  整份写清单
 *   POST /roroko-tool/reset   清空跳闸记录
 */

/** 一个注入文件的状态。 */
export interface FileInfo {
  name: string
  path: string
  exists: boolean
  bytes: number
}

/** 两张清单。 */
export interface InjectConfig {
  systemFiles: string[]
  userFiles: string[]
  wrap: boolean
}

/** 设置页拿到的全量状态。 */
export interface StateBody {
  version: string
  mounted: boolean
  root?: string
  configFile?: string
  injectedFile?: string
  injected?: string[]
  config?: InjectConfig
  files?: { system: FileInfo[]; user: FileInfo[] }
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
 * 整份写清单（全量替换）。
 * @param config - 两张清单 + wrap。
 * @returns 宿主回执。
 */
export function saveConfig(config: InjectConfig): Promise<Ack> {
  return request<Ack>('/roroko-tool/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  })
}

/** 清空跳闸记录。 */
export function resetInjected(): Promise<Ack> {
  return request<Ack>('/roroko-tool/reset', { method: 'POST' })
}
