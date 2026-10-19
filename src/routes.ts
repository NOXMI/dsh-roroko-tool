/**
 * 设置页的 host 侧数据口。三条普通 webServer 路由，不引入 Remote/typert，
 * 也不依赖 configForms：
 *
 *   GET  /roroko-tool/state   两张清单 + 文件状态 + 跳闸记录
 *   POST /roroko-tool/config  整份写清单（全量替换）
 *   POST /roroko-tool/reset   清空跳闸记录（下次会话重新注入）
 *
 * 清单写完下一步装配就生效——preinject 的 provider 每次现读，不需要重挂载。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { stat } from 'node:fs/promises'
import { readConfig, writeConfig, entryPath } from './preinject.js'
import { firstMount, readInjected, resetInjected } from './state.js'

/** webServer 服务的最小面。 */
export interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** 设置页认的一个注入文件。 */
interface FileInfo {
  name: string
  path: string
  exists: boolean
  bytes: number
}

const PREFIX = '/roroko-tool'
/** 配置请求体上限（两张清单，1MB 绰绰有余）。 */
const BODY_LIMIT = 1024 * 1024

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

/**
 * 注册设置页数据路由。
 * @param server - webServer 服务。
 * @param version - 本包版本，仅供页面显示。
 * @returns 注销函数。
 */
export function registerStateRoutes(server: WebServerLike, version: string): () => void {
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
      const config = readConfig(mount.root)
      json(res, 200, {
        version,
        mounted: true,
        root: mount.root,
        configFile: mount.configFile,
        injectedFile: mount.injectedFile,
        injected: await readInjected(mount.injectedFile),
        config,
        files: {
          system: await fileInfos(config.systemFiles, mount.root),
          user: await fileInfos(config.userFiles, mount.root),
        },
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
        json(res, 200, { ok: false, reason: '未挂载 preinject，没有可写的清单' })
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
      const config = await writeConfig(mount.root, body as Record<string, unknown>)
      json(res, 200, { ok: true, config })
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
