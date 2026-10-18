/**
 * 设置页的 host 侧数据口：两条只读/操作路由。
 *
 *   GET  /roroko-tool/state   返回子模块挂载情况、跳闸记录、包版本
 *   POST /roroko-tool/reset   清空跳闸记录（下次会话重新注入）
 *
 * 走的是 webServer 的普通路由，不引入 Remote/typert，也不依赖 configForms。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { injectedFile, mountedStatuses, readInjected, resetInjected } from './state.js'

/** webServer 服务的最小面。 */
export interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

const PREFIX = '/roroko-tool'

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(text)
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
      const file = injectedFile()
      const injected = file === undefined ? [] : await readInjected(file)
      json(res, 200, {
        version,
        mounts: mountedStatuses(),
        injectedFile: file ?? null,
        injected,
      })
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
      const file = injectedFile()
      if (file === undefined) {
        json(res, 200, { ok: false, reason: '未挂载 preinject，没有可清空的记录' })
        return
      }
      await resetInjected(file)
      json(res, 200, { ok: true })
    },
  })

  return () => {
    offState()
    offReset()
  }
}
