/**
 * routes.js HTTP 集成测试 —— ★ 复现链路:设置页保存 → 刷新网页 → 应该还在。
 *
 * 用真实 node:http 承载 registerStateRoutes 的 handler,不依赖 DSH。
 * 运行:node test/route-state.mjs
 */
import { makeAsserts, startRouteServer, useTempDshHome } from './helpers/harness.mjs'

const { ok, eq, done } = makeAsserts()

const home = await useTempDshHome('roroko-route-')
const { mkdirSync, writeFileSync, readFileSync, existsSync } = await import('node:fs')
const { join } = await import('node:path')

// ── 造两个假 preset 目录:一个合法、一个 id 不合契约(应被跳过)
const presetRoot = join(home.dir, '.agent-presets')
mkdirSync(join(presetRoot, 'roroko-server'), { recursive: true })
writeFileSync(join(presetRoot, 'roroko-server', 'agent.cordis.yml'), '- id: x\n', 'utf8')
writeFileSync(join(presetRoot, 'roroko-server', 'preset.yml'), 'name: "roroko_Server"\n', 'utf8')
mkdirSync(join(presetRoot, 'INVALID_NAME'), { recursive: true })

const { registerStateRoutes } = await import('../lib/routes.js')
const server = await startRouteServer(registerStateRoutes)
const { hostname, port } = new URL(server.url)

const http = await import('node:http')
/** 手写请求:要能自由设置 Origin / Host(fetch 对这两个头不友好)。 */
function call(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { method, hostname, port, path, headers },
      (response) => {
        let raw = ''
        response.on('data', chunk => { raw += chunk })
        response.on('end', () => resolve({
          status: response.statusCode,
          text: raw,
          json: () => JSON.parse(raw.length > 0 ? raw : 'null'),
        }))
      },
    )
    request.on('error', reject)
    if (body !== undefined) request.write(typeof body === 'string' ? body : JSON.stringify(body))
    request.end()
  })
}

const origin = server.url
const post = (payload, { origin: org = origin, omitOrigin = false, raw } = {}) => call(
  'POST', '/roroko-tool/state',
  {
    headers: {
      'content-type': 'application/json',
      ...omitOrigin ? {} : { origin: org },
    },
    body: raw ?? payload,
  },
)

// ── GET /roroko-tool/state
let response = await call('GET', '/roroko-tool/state')
eq(response.status, 200, 'GET /roroko-tool/state → 200')
let body = response.json()
ok(body.presets !== undefined, '响应含 presets(分桶)')
ok(body.data !== undefined && body.mark !== undefined, '响应含 data / mark 节')
ok(Array.isArray(body.preinject?.systemFiles), '★ 响应含兼容视图 preinject(旧设置页/继承基线靠它)')

// ── GET /roroko-tool/presets
response = await call('GET', '/roroko-tool/presets')
eq(response.status, 200, 'GET /roroko-tool/presets → 200')
body = response.json()
eq(body.commonScope, 'common', 'presets 路由返回 commonScope')
eq(body.presets.length, 1, '只认合法 preset id 目录(INVALID_NAME 被跳过)')
eq(
  { id: body.presets[0].id, name: body.presets[0].name, composition: body.presets[0].composition },
  { id: 'roroko-server', name: 'roroko_Server', composition: true },
  'preset 行:name 取自 preset.yml,composition 反映 agent.cordis.yml 是否存在',
)

// ── 变异端点的同源防线
eq((await post({ tool: 'preinject' }, { omitOrigin: true })).status, 403, 'POST 无 Origin → 403')
eq((await post({ tool: 'preinject' }, { origin: 'https://evil.example' })).status, 403, 'POST 异源 → 403')

// ── 参数校验
eq((await post({ tool: 'nope' })).status, 400, '未知 tool → 400')
eq((await post({ tool: 'warn' })).status, 400, 'warn 无参数可存 → 400')
eq((await post({ tool: 'data' })).status, 400, 'data 缺 dbPath → 400')
eq((await post({ tool: 'mark', enabled: 'yes' })).status, 400, 'mark 非布尔 enabled → 400')

// ── ★★ 设置页主链路:保存 → 落盘 → 模拟刷新再读
response = await post({ tool: 'preinject', preset: 'common', systemFiles: ['AGENTS.md', 'IDENTITY.md'] })
eq(response.status, 200, 'POST preinject 保存 → 200')
body = response.json()
eq(body.ok, true, '回执 ok=true(白箱化:客户端据此才亮"已保存")')
eq(body.scope, 'common', '回执带 scope')
eq(
  body.state.presets.common.preinject.systemFiles,
  ['AGENTS.md', 'IDENTITY.md'],
  '回执里的 state 已含新值(界面用回执刷新)',
)
eq(
  body.state.preinject.systemFiles,
  ['AGENTS.md', 'IDENTITY.md'],
  '★ 回执同时带兼容视图 preinject(缺了它旧面板会卡回「加载中…」)',
)

const onDisk = JSON.parse(readFileSync(home.statePath, 'utf8'))
eq(onDisk.presets.common.preinject.systemFiles, ['AGENTS.md', 'IDENTITY.md'], '★ 值已落盘')

response = await call('GET', '/roroko-tool/state')
eq(
  response.json().presets.common.preinject.systemFiles,
  ['AGENTS.md', 'IDENTITY.md'],
  '★★ 模拟刷新页面:重新 GET 后新值仍在',
)

// ── 第二轮部分保存:另一组字段不该把第一组冲掉
response = await post({ tool: 'preinject', preset: 'common', files: ['PLAYER.md'] })
eq(response.status, 200, 'POST 第二次(只发 files) → 200')
body = response.json()
eq(
  body.state.presets.common.preinject,
  { systemFiles: ['AGENTS.md', 'IDENTITY.md'], files: ['PLAYER.md'] },
  '★★ 部分保存合并:两组字段共存',
)

// ── per-preset 分桶:写 roroko-server 桶不影响 common
response = await post({ tool: 'preinject', preset: 'roroko-server', systemFiles: ['${presetDir}/AGENTS.md'] })
eq(
  response.json().state.presets.common.preinject.systemFiles,
  ['AGENTS.md', 'IDENTITY.md'],
  '写具体桶不动 common 桶',
)
eq(
  response.json().state.presets['roroko-server'].preinject.systemFiles,
  ['${presetDir}/AGENTS.md'],
  '具体桶内容正确落盘',
)

// ── reset:整桶删掉,回到继承
response = await post({ tool: 'preinject', preset: 'roroko-server', reset: true })
body = response.json()
eq(body.reset, true, 'reset 回执标记 reset=true')
ok(body.state.presets['roroko-server'] === undefined, 'reset 后该桶被删除')

// ── data / mark 保存
response = await post({ tool: 'data', dbPath: '/tmp/soul.db' })
eq(response.json().state.data.dbPath, '/tmp/soul.db', 'data 保存落盘')
response = await post({ tool: 'mark', enabled: false })
eq(response.json().state.mark.enabled, false, 'mark 保存落盘')

// ── 方法/体积边界
eq((await call('PUT', '/roroko-tool/state')).status, 405, '非 GET/POST → 405')
eq((await call('PUT', '/roroko-tool/presets')).status, 405, 'presets 非 GET → 405')
eq(
  (await post({ tool: 'preinject', padding: 'x'.repeat(70 * 1024) })).status,
  500,
  '超过 64 KiB body → 500(request body too large)',
)
ok(existsSync(home.statePath), 'state 文件仍然存在')

await server.close()
home.cleanup()
process.exit(done('routes HTTP 集成'))
