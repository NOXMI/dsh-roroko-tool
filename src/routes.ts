/**
 * roroko-tool 子插件参数覆盖 HTTP routes(仿 dshmarket /dsh-market/* 范式)。
 *
 * client 在设置页通过同源 fetch 读写本路由,绕开官方 settings 写只能
 * loopback 的限制(域名/隧道访问均可)。
 *
 *   GET  /roroko-tool/state  → 200 { presets:{<id>:{preinject}}, data:{dbPath}, … }
 *                             另带一份兼容视图 preinject(公共桶 + 内置默认),旧设置页照读
 *   POST /roroko-tool/state  → body { tool:'preinject', preset?, systemFiles/… } 写该 preset 覆盖
 *                            → body { tool:'data', dbPath } 写参数
 *                            → body { tool:'mark', enabled } 写渲染开关
 *   其余 method → 405;POST 非同一 Origin → 403。
 *
 * 2026-09-03 三改:enabled 开关退役(toggle 端点删除),state 只存参数覆盖,
 * 工具存在与否由 agent preset 声明决定。
 * 2026-09-11 四改:preinject 覆盖按 agent preset 分桶,body 省略 preset 即写公共桶
 * common;请求体上限由 4 KiB 提到 64 KiB —— 两份文件清单 + 两组 header/footer
 * 很容易破 4 KiB,而旧上限的表现是保存时 500「request body too large」。
 *
 * 状态存当前 profile 目录 roroko-tool-state.json(见 state.ts),跨重启保留。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Dirent } from 'node:fs'
import { access, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  isRorokoToolKey, preinjectView, resolvePresetOverride, ROROKO_COMMON_SCOPE,
} from './settings.js'
import {
  clearPreinjectConfig, dshHomeDirectory, loadState, setDataConfig, setMarkConfig, setPreinjectConfig,
} from './state.js'

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

/** 请求体上限:preinject 一次要带两份文件清单 + 两组 header/footer,4 KiB 太紧。 */
const MAX_BODY_BYTES = 64 * 1024

/** 读 JSON body,超上限拒绝。 */
async function readJsonBody(request: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
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

/** 用户 preset 根目录名(与 DSH 官方 discovery 的 USER_PRESET_DIR 一致)。 */
const USER_PRESET_DIR = '.agent-presets'

/** DSH 官方 preset id 契约:目录名即 id,会当路径段用,必须受限。 */
const PRESET_ID_RE = /^[a-z0-9][a-z0-9-]*$/

/** preset 的 composition 文件名(官方 COMPOSITION_FILE)。 */
const COMPOSITION_FILE = 'agent.cordis.yml'

/** preset 元数据文件名(官方 METADATA_FILE)。 */
const METADATA_FILE = 'preset.yml'

/** 一张 preset 卡片的数据。 */
interface RorokoPresetRow {
  /** preset id(= 目录名)。 */
  id: string
  /** 展示名(preset.yml 的 name,取不到为空串)。 */
  name: string
  /** composition 文件是否存在 —— 不存在时这个 preset 挂不起来。 */
  composition: boolean
}

/** 文件是否存在(不抛)。 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** 从 preset.yml 里取 `name:`(行匹配,不引 YAML 解析依赖);取不到返回空串。 */
async function readPresetName(path: string): Promise<string> {
  try {
    const text = await readFile(path, 'utf8')
    const matched = /^name:\s*(.+)$/m.exec(text)
    return matched?.[1]?.trim().replace(/^["']|["']$/g, '') ?? ''
  } catch {
    return ''
  }
}

/**
 * 扫描 `$DSH_HOME/.agent-presets/` 下的 preset(设置页卡片用)。
 *
 * 只认合法 id 目录,目录读不到时返回空数组(不抛)。展示名取 preset.yml 的
 * `name:`。官方 shipped root / 自定义 root 里的 preset 不在此列 —— 那些不在
 * 用户家目录里,也不是这个设置页的管辖对象。
 */
async function listUserPresets(): Promise<RorokoPresetRow[]> {
  const root = join(dshHomeDirectory(), USER_PRESET_DIR)
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const rows: RorokoPresetRow[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !PRESET_ID_RE.test(entry.name)) continue
    const dir = join(root, entry.name)
    rows.push({
      id: entry.name,
      name: await readPresetName(join(dir, METADATA_FILE)),
      composition: await fileExists(join(dir, COMPOSITION_FILE)),
    })
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id))
}

/** 挂载 state 路由,返回卸载函数。 */
export function registerStateRoutes(webServer: WebServerLike): () => void {
  const disposeState = webServer.register({
    kind: 'exact',
    path: '/roroko-tool/state',
    handler: async (request, response) => {
      // 2026-09-11 留痕:点击到底有没有打到服务端,翻 journalctl 就能看见,
      // 不必再从 nginx access log 里反推(前端静默失败的案子吃过大亏)。
      console.log('[roroko-tool] route hit:', request.method, request.url,
        `origin=${request.headers.origin ?? '-'} host=${request.headers.host ?? '-'}`)
      try {
        if (request.method === 'GET') {
          const state = await loadState()
          // 兼容视图:第 3 步换 UI 之前,设置页读的是扁平 preinject 节。
          // 这里给"公共桶 + 内置默认"合成的完整参数,读法与四改前一致。
          sendJson(response, 200, {
            ...state,
            preinject: preinjectView(resolvePresetOverride(state, undefined)),
          })
          return
        }
        if (request.method === 'POST') {
          if (!sameOrigin(request)) {
            sendJson(response, 403, { error: 'untrusted origin' })
            return
          }
          const body = (await readJsonBody(request)) as {
            tool?: unknown
            /** 目标 preset id;省略或空串写公共桶 common(旧设置页即此路)。 */
            preset?: unknown
            systemFiles?: unknown
            systemOrder?: unknown
            systemHeader?: unknown
            systemFooter?: unknown
            files?: unknown
            header?: unknown
            footer?: unknown
            wrapInSystemReminder?: unknown
            filesPlacement?: unknown
            splitFiles?: unknown
            /** true = 删掉该 preset 的覆盖桶(回到 preset config 兜底)。 */
            reset?: unknown
            dbPath?: unknown
            enabled?: unknown
          }
          if (!isRorokoToolKey(body.tool)) {
            sendJson(response, 400, { error: 'tool must be one of preinject/data/warn/mark' })
            return
          }
          // preinject 参数节保存(部分覆盖:仅 body 提供的字段覆盖,按 preset 分桶)。
          if (body.tool === 'preinject') {
            const scope = typeof body.preset === 'string' && body.preset.trim().length > 0
              ? body.preset.trim()
              : ROROKO_COMMON_SCOPE
            // reset:整桶删掉,该 preset 回到 preset config / 内置默认兜底。
            if (body.reset === true) {
              const state = await clearPreinjectConfig(scope)
              sendJson(response, 200, {
                ok: true,
                scope,
                reset: true,
                state,
                preinject: preinjectView(resolvePresetOverride(state, undefined)),
              })
              return
            }
            const state = await setPreinjectConfig(scope, {
              ...body.systemFiles !== undefined ? { systemFiles: body.systemFiles } : {},
              ...body.systemOrder !== undefined ? { systemOrder: body.systemOrder } : {},
              ...body.systemHeader !== undefined ? { systemHeader: body.systemHeader } : {},
              ...body.systemFooter !== undefined ? { systemFooter: body.systemFooter } : {},
              ...body.files !== undefined ? { files: body.files } : {},
              ...body.header !== undefined ? { header: body.header } : {},
              ...body.footer !== undefined ? { footer: body.footer } : {},
              ...typeof body.wrapInSystemReminder === 'boolean'
                ? { wrapInSystemReminder: body.wrapInSystemReminder }
                : {},
              ...body.filesPlacement !== undefined ? { filesPlacement: body.filesPlacement } : {},
              ...body.splitFiles !== undefined ? { splitFiles: body.splitFiles } : {},
            })
            sendJson(response, 200, {
              ok: true,
              scope,
              state,
              preinject: preinjectView(resolvePresetOverride(state, undefined)),
            })
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
          // mark 参数节保存:渲染展开总开关 enabled。
          if (body.tool === 'mark') {
            if (typeof body.enabled !== 'boolean') {
              sendJson(response, 400, { error: 'mark save requires boolean enabled' })
              return
            }
            const state = await setMarkConfig({ enabled: body.enabled })
            sendJson(response, 200, { ok: true, state })
            return
          }
          // warn 无参数可保存。
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

  // preset 列表:设置页按 preset 分卡片(公共桶 + 每个 preset 一张)。
  const disposePresets = webServer.register({
    kind: 'exact',
    path: '/roroko-tool/presets',
    handler: async (request, response) => {
      console.log('[roroko-tool] presets hit:', request.method, request.url)
      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET' })
        response.end()
        return
      }
      try {
        sendJson(response, 200, {
          presets: await listUserPresets(),
          commonScope: ROROKO_COMMON_SCOPE,
        })
      } catch (error) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  })

  return () => {
    disposeState()
    disposePresets()
  }
}
