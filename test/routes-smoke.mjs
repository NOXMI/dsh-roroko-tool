/**
 * 设置页路由冒烟测试（node test/routes-smoke.mjs）
 *
 * 用假 webServer 收下三条路由的 handler，手工喂 req / res，验证：
 *   1. GET  /roroko-tool/state  → 两张清单、文件状态、跳闸记录
 *   2. POST /roroko-tool/config → 整份写清单，provider 立刻跟着变
 *   3. POST /roroko-tool/reset  → 删掉 injected.json
 *
 * 和 preinject-smoke 一样不碰网络与 DSH 运行时。
 */
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.mjs'

const root = await mkdtemp(join(tmpdir(), 'roroko-routes-'))
await writeFile(join(root, 'IDENTITY.md'), '# 身份\nROUTE-IDENTITY', 'utf8')
await writeFile(join(root, 'AGENTS.md'), '# 用户\nROUTE-AGENTS', 'utf8')

const problems = []
const check = (ok, message) => {
  if (!ok) problems.push(message)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`)
}

const routes = new Map()
const variables = new Map()
const fake = {
  webServer: {
    register: (route) => {
      routes.set(route.path, route.handler)
      return () => {}
    },
  },
  systemPrompt: {
    variable: (name, provider) => {
      variables.set(name, provider)
      return () => {}
    },
    section: () => () => {},
    getSectionOrder: () => 0,
  },
  effect: (callback) => {
    callback()
    return () => {}
  },
  on: () => () => {},
  inject: (_services, callback) => {
    callback(fake)
    return () => {}
  },
}

apply(fake, { preinject: { root } })
check(routes.size === 3, '注册了 state / config / reset 三条路由')

/** 假 req：能 async 迭代出请求体。 */
function makeReq(method, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = method
  return req
}

/** 假 res：收下状态码与 JSON 体。 */
function makeRes() {
  const out = { status: 0, body: undefined }
  return {
    out,
    writeHead: (status) => { out.status = status },
    end: (text) => { out.body = JSON.parse(text) },
  }
}

const call = async (path, method, body) => {
  const res = makeRes()
  await routes.get(path)(makeReq(method, body), res)
  return res.out
}

// ── GET state ──
const state = await call('/roroko-tool/state', 'GET')
check(state.status === 200 && state.body.mounted === true, 'GET state 报已挂载')
check(state.body.root === root, 'GET state 带回身份根')
check(state.body.config.systemFiles.length === 0, '默认清单是空的')
check(state.body.files.system.length === 0, '空清单没有文件状态')
check(state.body.injected.length === 0, '默认没有跳闸记录')

// ── POST config ──
const saved = await call('/roroko-tool/config', 'POST', {
  systemFiles: ['IDENTITY.md', 'NOPE.md'],
  userFiles: ['AGENTS.md'],
  wrap: false,
})
check(saved.body.ok === true, 'POST config 写入成功')
check(saved.body.config.systemFiles.length === 2, '回执带回落盘后的清单')

const read = variables.get('roroko_preinject_system')?.()
check(read.includes('ROUTE-IDENTITY') === true, '保存后 provider 立刻读到清单内容')
check(read.includes('NOPE') === false, '缺失文件不出现在正文里')

const after = await call('/roroko-tool/state', 'GET')
check(after.body.files.system[0].exists === true && after.body.files.system[0].bytes > 0, '文件状态带存在性与大小')
check(after.body.files.system[1].exists === false, '缺失文件被标出来')
check(after.body.config.wrap === false, 'wrap 开关落盘')

// ── 全量替换 ──
const replaced = await call('/roroko-tool/config', 'POST', { systemFiles: [], userFiles: ['AGENTS.md'], wrap: true })
check(replaced.body.config.systemFiles.length === 0, 'POST config 是全量替换，不做合并')
check(variables.get('roroko_preinject_system')?.() === '', '清空系统清单后系统层不再注入')

// ── 非法请求 ──
check((await call('/roroko-tool/config', 'GET')).status === 405, '错误方法被挡回 405')
check((await call('/roroko-tool/config', 'POST')).status === 400, '空请求体被挡回 400')

// ── POST reset ──
await mkdir(join(root, 'state'), { recursive: true })
await writeFile(join(root, 'state', 'injected.json'), JSON.stringify(['s1', 's2']), 'utf8')
check((await call('/roroko-tool/state', 'GET')).body.injected.length === 2, 'GET state 读出跳闸记录')
check((await call('/roroko-tool/reset', 'POST')).body.ok === true, 'POST reset 成功')
const gone = await stat(join(root, 'state', 'injected.json')).then(() => false, () => true)
check(gone, 'injected.json 被删掉')
check((await readFile(join(root, 'state', 'preinject.json'), 'utf8')).includes('AGENTS.md'), '列表文件不受 reset 影响')

await rm(root, { recursive: true, force: true })
console.log(problems.length === 0 ? '\n全部通过' : `\n${problems.length} 项未通过`)
process.exit(problems.length === 0 ? 0 : 1)
