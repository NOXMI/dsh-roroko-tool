/**
 * preinject 冒烟测试（node test/preinject-smoke.mjs）
 *
 * 用假的 cordis Context 驱动真实构建产物，验证三件事：
 *   1. section 注册到 deployment:persona-prefix，文本只是宏
 *   2. 变量 provider 每次调用现读文件（身份 + 工作区）
 *   3. pre-step 监听器在 enter 时注入带签名的 user 消息，且判重生效
 *
 * 不依赖网络与 DSH 运行时；文件走临时目录。
 */
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.mjs'

const IDENTITY = '# 身份\n身份标记：TEST-IDENTITY-1'
const AGENTS = '# 工作区\n指令标记：TEST-AGENTS-1'

const root = await mkdtemp(join(tmpdir(), 'roroko-pre-'))
await writeFile(join(root, 'IDENTITY.md'), IDENTITY, 'utf8')
await writeFile(join(root, 'AGENTS.md'), AGENTS, 'utf8')
process.env.DSH_HOME = root

const sections = new Map()
const variables = new Map()
const listeners = new Map()

const fake = {
  systemPrompt: {
    variable: (name, provider) => {
      variables.set(name, provider)
      return () => {}
    },
    section: (section) => {
      sections.set(section.name, section)
      return () => {}
    },
    getSectionOrder: (name) => ({ DEPLOYMENT_PERSONA_PREFIX: 0, HARNESS_IDENTITY: -1000 })[name],
  },
  effect: (callback) => {
    callback()
    return () => {}
  },
  on: (event, listener) => {
    listeners.set(event, listener)
    return () => {}
  },
  inject: (_services, callback) => {
    callback(fake)
    return () => {}
  },
}

apply(fake, { preinject: { root } })

const problems = []
const check = (ok, message) => {
  if (!ok) problems.push(message)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`)
}

// 1) section
const persona = sections.get('deployment:persona-prefix')
check(persona !== undefined, '注册了 deployment:persona-prefix')
check(persona?.text === '{{roroko_preinject_system}}', 'section 文本只是宏，不含正文')
check(persona?.order === 0, 'section order 走 getSectionOrder')
const header = sections.get('harness:identity')
check(header !== undefined && header.text === '', 'harness:identity 被空段顶掉')

// 2) 变量现读
const read = variables.get('roroko_preinject_system')
const first = read?.()
check(first?.includes('TEST-IDENTITY-1') === true, '系统段含身份文件内容')
check(first?.includes('TEST-AGENTS-1') === true, '系统段含工作区文件内容')
await writeFile(join(root, 'AGENTS.md'), '# 工作区\n指令标记：TEST-AGENTS-2', 'utf8')
const second = read?.()
check(second?.includes('TEST-AGENTS-2') === true, '改文件后下一次装配立刻生效')
check(second?.includes('TEST-AGENTS-1') === false, '旧内容不再出现')

// 3) 消息段
const preStep = listeners.get('agent/pre-step')
check(preStep !== undefined, '挂上了 agent/pre-step')
const decide = async () => ({ kind: 'enter', messages: [] })
const session = { agent: { session: { id: 'session-test-1', header: { cwd: root } } } }
const out = await preStep?.(session, decide)
const text = out?.messages?.[0]?.content?.[0]?.text ?? ''
check(out?.kind === 'enter', '进入 step 的决策被保留')
check(out?.messages?.length === 1, '注入了一条 user 消息')
check(text.includes('[roroko-preinject]') && text.includes('TEST-AGENTS-2'), '消息带签名与工作区指令')
check(out?.messages?.[0]?.source?.kind === 'roroko-preinject', '消息 source 标了插件名')

const again = await preStep?.(session, decide)
check(again?.messages?.length === 0, '同一会话第二次不再重复注入')

await rm(root, { recursive: true, force: true })
console.log(problems.length === 0 ? '\n全部通过' : `\n${problems.length} 项未通过`)
process.exit(problems.length === 0 ? 0 : 1)

