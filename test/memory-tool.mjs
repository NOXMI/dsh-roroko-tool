/**
 * memory.js(工具注册层)测试:preset 声明 → 注册两把工具 → 真跑 execute。
 *
 * memory.js 顶层 import 了 dsh-tools 的值(defineTool),所以**必须带替身钩子**:
 *   node --import ./test/helpers/register-stubs.mjs test/memory-tool.mjs
 * (在 Windows 上 --import 要给 file:// URL —— 统一由 run-all.mjs 拼。)
 *
 * 纯逻辑与库访问另见 memory-unit.mjs(那套零替身,谁都能直接跑)。
 */
import { makeAsserts } from './helpers/harness.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { ok, eq, done } = makeAsserts()

const { apply } = await import('../lib/memory.js')

const dir = mkdtempSync(join(tmpdir(), 'roroko-memtool-'))
const tools = []
const ctx = { tools: { register(tool) { tools.push(tool) } } }

// 故意多一层目录:顺带验挂载即建库能自己补父目录
apply(ctx, { dbPath: join(dir, 'data', 'roroko_memory.db'), owner: 'dev' })

eq(
  tools.map(tool => tool.name),
  ['roroko_mem_edit', 'roroko_mem_date', 'roroko_mem_rough', 'roroko_mem_id'],
  'preset 声明即注册四把工具',
)
ok(tools[0].description.includes('触发条件'), 'edit 描述带三问判据(记成「触发条件 → 应做」)')
ok(tools[0].description.includes('失手记录'), 'edit 描述带四类必记')
ok(tools[1].description.includes('会话开始时先调它'), 'date 描述带"会话开始必读"纪律')
ok(tools[2].description.includes('别硬编'), 'rough 描述催它先检索再开口')
ok(tools[2].description.includes('不许据此编造记忆'), 'rough 描述带防幻觉纪律')
ok(tools[3].description.includes('别一次捞一堆'), 'id 描述限制批量滥取')
eq(tools[2].presentCall({ keywords: '记忆 召回' }).title, '检索记忆 · 记忆 召回', 'rough 卡片标题带关键词')

const addText = await tools[0].execute({ op: 'add', content: '工具层真跑:落一条', summary: '工具层真跑' })
ok(addText.includes('已记 #1'), 'add 走真库真写(owner 缺省回落 preset 配置)')

const listText = await tools[1].execute({})
ok(listText.includes('工具层真跑'), 'date 默认区间读回今天那条')
ok(listText.includes('owner=dev'), 'owner 缺省 = preset 配置的桶')

const personaText = await tools[0].execute({ op: 'add', owner: 'persona', content: '角色桶一条', summary: '角色桶' })
ok(personaText.includes('owner=persona'), '显式 owner 覆盖 preset 配置')

const onlyDev = await tools[1].execute({ owner: 'dev' })
ok(onlyDev.includes('条数 1') && !onlyDev.includes('角色桶'), 'owner 过滤挡掉别的桶')
const allText = await tools[1].execute({ owner: 'all' })
ok(allText.includes('条数 2'), 'owner=all 看全桶')

const badOwner = await tools[1].execute({ owner: '妈妈' })
ok(badOwner.includes('owner 非法'), '工具层挡非法 owner(不抛)')
const badAdd = await tools[0].execute({ op: 'add', content: '   ', summary: 'y' })
ok(badAdd.includes('写入失败'), '空 content 返回人话失败,不抛')

// M2 两把:检索与按 id 取全文(走同一套真库)
const roughText = await tools[2].execute({ keywords: '工具层' })
ok(roughText.includes('工具层真跑'), 'rough 真跑命中已落的那条')
ok(roughText.includes('候选 1 条'), 'rough 候选只算 preset 桶里的(dev 1 条)')
ok(roughText.includes('owner=dev'), 'rough owner 缺省 = preset 桶')

const roughAll = await tools[2].execute({ keywords: '角色桶', owner: 'all' })
ok(roughAll.includes('| 2 |') && !roughAll.includes('角色桶一条'), 'owner=all 跨桶检索到 persona 那条(表格只给 summary,不给 content)')
ok(roughAll.includes('owner=(全部)'), 'all 时表头明示')

const roughEmpty = await tools[2].execute({ keywords: '   ' })
ok(roughEmpty.includes('关键词为空'), '空关键词返回人话,不抛')
const roughBadOwner = await tools[2].execute({ keywords: 'x', owner: '妈妈' })
ok(roughBadOwner.includes('owner 非法'), 'rough 挡非法 owner(不抛)')
const roughNomatch = await tools[2].execute({ keywords: '和记忆完全不沾边的xyzzy' })
ok(roughNomatch.includes('没有匹配上'), '没匹配上明说,不让模型脑补')

const idText = await tools[3].execute({ id: 1 })
ok(idText.includes('记忆 #1'), 'id 真跑取到全文')
ok(idText.includes('工具层真跑:落一条'), '取到的是 content 全文')
ok(idText.includes('召回 2'), '第一次被 rough 命中过,召回数跟着走')
const idBad = await tools[3].execute({ id: 'x' })
ok(idBad.includes('id 非法'), 'id 非法返回人话')
const idMissing = await tools[3].execute({ id: 999 })
ok(idMissing.includes('没有 #999'), '不存在的 id 返回人话')

// 库路径不可写:挂载不能抛 —— 一个坏路径不该把 preset 挂载拖垮
let threw = false
try {
  apply({ tools: { register() {} } }, { dbPath: 'Z:/nowhere/roroko_memory.db' })
} catch {
  threw = true
}
ok(!threw, '库路径不可写时 apply 不抛(取用时再报)')

try {
  rmSync(dir, { recursive: true, force: true })
} catch {
  // Windows 句柄偶发未释放;临时目录留着无妨
}

process.exit(done('roroko-memory 工具层') === 0 ? 0 : 1)
