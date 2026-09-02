/**
 * roroko-tool 子插件参数覆盖 HTTP routes(仿 dshmarket /dsh-market/* 范式)。
 *
 * client 在设置页通过同源 fetch 读写本路由,绕开官方 settings 写只能
 * loopback 的限制(域名/隧道访问均可)。
 *
 *   GET  /roroko-tool/state  → 200 { preinject:{files,...}, data:{dbPath}, ... }
 *   POST /roroko-tool/state  → body { tool:'preinject', files/header/footer/... } 写参数
 *                            → body { tool:'data', dbPath } 写参数
 *   其余 method → 405;POST 非同一 Origin → 403。
 *
 * 2026-09-03 三改:enabled 开关退役(toggle 端点删除),state 只存参数覆盖,
 * 工具存在与否由 agent preset 声明决定。
 *
 * 状态存当前 profile 目录 roroko-tool-state.json(见 state.ts),跨重启保留。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { isRorokoToolKey } from './settings.js'
import { loadState, setDataConfig, setPreinjectConfig } from './state.js'

/** webServer 服务的最小结构面(host 提供真实 WebServer;此处只声明用到的面)。 */
export interface WebServerLike {
  register(route: {
    kind: 'exact'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

/** 写 JSON 响应(no-store)。 */
function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

/** Origin 与 Host 一致才放行(变异端点必须;非浏览器无 Origin 一律拒)。 */
function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin === undefined || host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** 读 JSON body,超 4 KiB 拒绝。 */
async function readJsonBody(request: IncomingMessage, maxBytes = 4096): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/** 挂载 state 路由,返回卸载函数。 */
export function registerStateRoutes(webServer: WebServerLike): () => void {
  return webServer.register({
    kind: 'exact',
    path: '/roroko-tool/state',
    handler: async (request, response) => {
      try {
        if (request.method === 'GET') {
          sendJson(response, 200, await loadState())
          return
        }
        if (request.method === 'POST') {
          if (!sameOrigin(request)) {
            sendJson(response, 403, { error: 'untrusted origin' })
            return
          }
          const body = (await readJsonBody(request)) as {
            tool?: unknown
            files?: unknown
            header?: unknown
            footer?: unknown
            wrapInSystemReminder?: unknown
            dbPath?: unknown
          }
          if (!isRorokoToolKey(body.tool)) {
            sendJson(response, 400, { error: 'tool must be one of preinject/data/warn/mark' })
            return
          }
          // preinject 参数节保存(部分覆盖:仅 body 提供的字段覆盖)。
          if (body.tool === 'preinject') {
            const state = await setPreinjectConfig({
              ...body.files !== undefined ? { files: body.files } : {},
              ...body.header !== undefined ? { header: body.header } : {},
              ...body.footer !== undefined ? { footer: body.footer } : {},
              ...typeof body.wrapInSystemReminder === 'boolean'
                ? { wrapInSystemReminder: body.wrapInSystemReminder }
                : {},
            })
            sendJson(response, 200, { ok: true, state })
            return
          }
          // data 参数节保存:dbPath。
          if (body.tool === 'data') {
            if (body.dbPath === undefined) {
              sendJson(response, 400, { error: 'data save requires dbPath' })
              return
            }
            const state = await setDataConfig({ dbPath: body.dbPath })
            sendJson(response, 200, { ok: true, state })
            return
          }
          // warn/mark 无参数可保存。
          sendJson(response, 400, { error: `tool "${String(body.tool)}" has no configurable parameters` })
          return
        }
        response.writeHead(405, { allow: 'GET, POST' })
        response.end()
      } catch (error) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  })
}
