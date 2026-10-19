/**
 * 设置页路由冒烟测试（node test/routes-smoke.mjs）
 *
 * 用假 webServer + 假 preset 注册表收下三条路由的 handler，手工喂 req / res：
 *   1. GET  /roroko-tool/state  → 公共桶 / 各 preset 桶 / roster / 生效值 / 文件状态
 *   2. POST /roroko-tool/config → 按 preset 写桶（部分合并、null 删键、reset 删桶）
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
let registryCalls = 0
const registry = {
  list: async () => {
    registryCalls += 1
    return [
      { id: 'roroko', name: '洛洛可' },
      { id: 'duck', name: '小黄鸭', broken: '缺服务' },
    ]
  },
}

const fake = {
  webServer: {
    register: (route) => {
      routes.set(route.path, route.handler)
      return () => {}
    },
  },
  agentPresets: registry,
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
check(state.body.roster.length === 2 && registryCalls > 0, 'roster 来自 preset 注册表')
check(state.body.scopes.includes('common') && state.body.scopes.includes('roroko'), 'scope 集合含公共默认与注册表 preset')
check(state.body.scopes.includes('duck'), 'broken 的 preset 也列出来')
check(state.body.effective.common.systemFiles.length === 0, '默认生效清单是空的')

// ── POST config：公共桶 ──
const saved = await call('/roroko-tool/config', 'POST', {
  preset: 'common',
  systemFiles: ['IDENTITY.md', 'NOPE.md'],
  userFiles: ['AGENTS.md'],
  wrap: false,
})
check(saved.body.ok === true, 'POST config 写公共桶成功')
check(saved.body.state.presets.common.systemFiles.length === 2, '回执带回落盘后的桶')

const read = variables.get('roroko_preinject_system')?.()
check(read.includes('ROUTE-IDENTITY') === true, '保存后 provider 立刻读到公共桶内容')
check(read.includes('NOPE') === false, '缺失文件不出现在正文里')

const after = await call('/roroko-tool/state', 'GET')
check(after.body.files.common.system[0].exists === true, '文件状态带存在性')
check(after.body.files.common.system[1].exists === false, '缺失文件被标出来')
check(after.body.effective.common.wrap === false, 'wrap 开关落盘')

// ── POST config：分预设桶，字段级叠加 ──
const specific = await call('/roroko-tool/config', 'POST', {
  preset: 'roroko',
  userFiles: ['IDENTITY.md'],
})
check(specific.body.ok === true, '分预设桶写入成功')
check(specific.body.state.presets.roroko.systemFiles === undefined, '只给了 userFiles，其它字段不落桶')

const merged = await call('/roroko-tool/state', 'GET')
check(merged.body.effective.roroko.userFiles.join() === 'IDENTITY.md', '分预设桶盖住公共桶的同名字段')
check(merged.body.effective.roroko.systemFiles.join() === 'IDENTITY.md,NOPE.md', '没覆盖的字段继续吃公共桶')
check(merged.body.effective.duck.userFiles.join() === 'AGENTS.md', '别的 preset 不受影响')

// ── null 删键 ──
const dropped = await call('/roroko-tool/config', 'POST', { preset: 'roroko', userFiles: null })
check(dropped.body.state.presets.roroko === undefined, '桶内字段删空后整桶消失（回到跟随继承）')

// ── 非法桶名 / 方法 ──
check((await call('/roroko-tool/config', 'POST', { preset: '../etc' })).status === 400, '非法桶名被挡回 400')
check((await call('/roroko-tool/config', 'GET')).status === 405, '错误方法被挡回 405')
check((await call('/roroko-tool/config', 'POST')).status === 400, '空请求体被挡回 400')

// ── reset 桶 ──
await call('/roroko-tool/config', 'POST', { preset: 'common', systemFiles: ['IDENTITY.md'] })
const cleared = await call('/roroko-tool/config', 'POST', { preset: 'common', reset: true })
check(cleared.body.ok === true && cleared.body.state.presets.common === undefined, 'reset 删掉整桶')
check(variables.get('roroko_preinject_system')?.() === '', '桶删掉后系统层不再注入')

// ── POST reset：跳闸记录 ──
await mkdir(join(root, 'state'), { recursive: true })
await writeFile(join(root, 'state', 'injected.json'), JSON.stringify(['s1', 's2']), 'utf8')
check((await call('/roroko-tool/state', 'GET')).body.injected.length === 2, 'GET state 读出跳闸记录')
check((await call('/roroko-tool/reset', 'POST')).body.ok === true, 'POST reset 成功')
const gone = await stat(join(root, 'state', 'injected.json')).then(() => false, () => true)
check(gone, 'injected.json 被删掉')
check((await readFile(join(root, 'state', 'preinject.json'), 'utf8')).includes('presets'), '覆盖文件不受 reset 影响')

await rm(root, { recursive: true, force: true })
console.log(problems.length === 0 ? '\n全部通过' : `\n${problems.length} 项未通过`)
process.exit(problems.length === 0 ? 0 : 1)
