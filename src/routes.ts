/**
 * 设置页的 host 侧数据口。三条普通 webServer 路由，不引入 Remote/typert，
 * 也不依赖 configForms：
 *
 *   GET  /roroko-tool/state   公共默认 + 各 preset 桶 + roster + 文件状态 + 跳闸记录
 *   POST /roroko-tool/config  按 preset 写覆盖桶（{preset, …fields} / {preset, reset:true}）
 *   POST /roroko-tool/reset   清空跳闸记录（下次会话重新注入）
 *
 * 桶写完下一步装配就生效——preinject 的 provider 每次现读，不需要重挂载。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { stat } from 'node:fs/promises'
import {
  DEFAULTS,
  entryPath,
  resolveEffective,
  type EffectiveConfig,
  type PreinjectConfig,
} from './preinject.js'
import { COMMON, clearBucket, readState, setBucket, type PreinjectState } from './presets.js'
import { firstMount, readInjected, resetInjected } from './state.js'

/** webServer 服务的最小面。 */
export interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** agent preset 注册表的最小面（列 roster 用）。 */
export interface PresetRegistryLike {
  list(): Promise<Array<{ id: string; name?: string; description?: string; broken?: string }>>
  /** 各 preset 的插件行；用来只留真挂了我们插件的那些。 */
  compositionInventory?(): Promise<Array<{ id: string; rows: ReadonlyArray<{ moduleName: string }> }>>
}

/** 本包包名：preset 里那行的 moduleName。 */
const PACKAGE_NAME = '@roroko-tool/dsh-roroko-tool'

/** 设置页认的一个注入文件。 */
interface FileInfo {
  name: string
  path: string
  exists: boolean
  bytes: number
}

const PREFIX = '/roroko-tool'
/** 配置请求体上限（几张清单，1MB 绰绰有余）。 */
const BODY_LIMIT = 1024 * 1024
/** 桶名契约：preset id 也是桶名，限制字符免得出脏键。 */
const SCOPE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(text)
}

/** 读请求体并当 JSON 解析；空体返回 null。 */
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > BODY_LIMIT) throw new Error('请求体过大')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text.length === 0) return null
  return JSON.parse(text) as unknown
}

/** 清单 → 文件状态（缺文件不报错，标 exists:false 让页面上看得见）。 */
async function fileInfos(names: readonly string[], root: string): Promise<FileInfo[]> {
  return Promise.all(names.map(async name => {
    const path = entryPath(name, root)
    try {
      const info = await stat(path)
      const isFile = info.isFile()
      return { name, path, exists: isFile, bytes: isFile ? info.size : 0 }
    } catch {
      return { name, path, exists: false, bytes: 0 }
    }
  }))
}

/** 接线层原样（没写的字段就是没写）。 */
function wiring(config: PreinjectConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (config.systemFiles !== undefined) out.systemFiles = config.systemFiles
  if (config.userFiles !== undefined) out.userFiles = config.userFiles
  if (config.wrap !== undefined) out.wrap = config.wrap
  return out
}

/** 各 scope 的生效值与文件状态。 */
async function scopeViews(
  config: PreinjectConfig,
  state: PreinjectState,
  root: string,
  scopes: readonly string[],
): Promise<{
  effective: Record<string, EffectiveConfig>
  files: Record<string, { system: FileInfo[]; user: FileInfo[] }>
}> {
  const effective: Record<string, EffectiveConfig> = {}
  const files: Record<string, { system: FileInfo[]; user: FileInfo[] }> = {}
  for (const scope of scopes) {
    const value = resolveEffective(config, state, scope === COMMON ? undefined : scope)
    effective[scope] = value
    files[scope] = {
      system: await fileInfos(value.systemFiles, root),
      user: await fileInfos(value.userFiles, root),
    }
  }
  return { effective, files }
}

/**
 * 注册设置页数据路由。
 * @param server - webServer 服务。
 * @param version - 本包版本，仅供页面显示。
 * @param registry - preset 注册表取用函数（拿不到就只列已有桶）。
 * @returns 注销函数。
 */
export function registerStateRoutes(
  server: WebServerLike,
  version: string,
  registry?: () => PresetRegistryLike | undefined,
): () => void {
  /**
   * roster：只留真挂了我们插件的 preset。
   *
   * 官方 preset（standard / minimal / duck …）不会加载 roroko-tool，给它们出卡
   * 纯属占地方。靠 compositionInventory 的插件行过滤；注册表没这个方法（或
   * 读失败）就退回全量，页面照样能用。
   */
  const roster = async (): Promise<Array<{ id: string; name?: string; description?: string; broken?: string }>> => {
    try {
      const service = registry?.()
      if (service === undefined) return []
      const rows = await service.list()
      if (service.compositionInventory === undefined) return rows
      let inventory: Array<{ id: string; rows: ReadonlyArray<{ moduleName: string }> }>
      try {
        inventory = await service.compositionInventory()
      } catch {
        return rows
      }
      const ours = new Set(
        inventory
          .filter(item => item.rows.some(row => row.moduleName.includes(PACKAGE_NAME)))
          .map(item => item.id),
      )
      return rows.filter(row => ours.has(row.id))
    } catch {
      return []
    }
  }

  const offState = server.register({
    kind: 'exact',
    path: `${PREFIX}/state`,
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        json(res, 405, { error: 'GET only' })
        return
      }
      const mount = firstMount()
      if (mount === undefined) {
        json(res, 200, { version, mounted: false })
        return
      }
      const state = readState(mount.root)
      const rows = await roster()
      // scope 集合：公共默认 + 注册表里的 preset + state 里已有的桶。
      const scopes = [COMMON]
      for (const row of rows) if (!scopes.includes(row.id)) scopes.push(row.id)
      for (const key of Object.keys(state.presets)) if (!scopes.includes(key)) scopes.push(key)
      const views = await scopeViews(mount.config, state, mount.root, scopes)
      json(res, 200, {
        version,
        mounted: true,
        root: mount.root,
        stateFile: mount.stateFile,
        injectedFile: mount.injectedFile,
        injected: await readInjected(mount.injectedFile),
        presets: state.presets,
        defaults: DEFAULTS,
        wiring: wiring(mount.config),
        roster: rows,
        scopes,
        effective: views.effective,
        files: views.files,
      })
    },
  })

  const offConfig = server.register({
    kind: 'exact',
    path: `${PREFIX}/config`,
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        json(res, 405, { error: 'POST only' })
        return
      }
      const mount = firstMount()
      if (mount === undefined) {
        json(res, 200, { ok: false, reason: '未挂载 preinject，没有可写的桶' })
        return
      }
      let body: unknown
      try {
        body = await readJson(req)
      } catch (cause) {
        json(res, 400, { ok: false, reason: cause instanceof Error ? cause.message : '请求体解析失败' })
        return
      }
      if (body === null || typeof body !== 'object') {
        json(res, 400, { ok: false, reason: '请求体必须是 JSON 对象' })
        return
      }
      const patch = body as Record<string, unknown>
      const scope = typeof patch.preset === 'string' ? patch.preset : COMMON
      if (!SCOPE_RE.test(scope)) {
        json(res, 400, { ok: false, reason: `桶名不合法：${scope}` })
        return
      }
      const state = patch.reset === true
        ? await clearBucket(mount.root, scope)
        : await setBucket(mount.root, scope, patch)
      json(res, 200, { ok: true, state })
    },
  })

  const offReset = server.register({
    kind: 'exact',
    path: `${PREFIX}/reset`,
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        json(res, 405, { error: 'POST only' })
        return
      }
      const mount = firstMount()
      if (mount === undefined) {
        json(res, 200, { ok: false, reason: '未挂载 preinject，没有可清空的记录' })
        return
      }
      await resetInjected(mount.injectedFile)
      json(res, 200, { ok: true })
    },
  })

  return () => {
    offState()
    offConfig()
    offReset()
  }
}


