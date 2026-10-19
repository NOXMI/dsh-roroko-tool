/**
 * preinject 冒烟测试（node test/preinject-smoke.mjs）
 *
 * 用假的 cordis Context 驱动真实构建产物，验证：
 *   1. section 注册到 deployment:persona-prefix，文本只是宏
 *   2. 两张清单只管自己的段：系统层不吃用户清单，反之亦然
 *   3. 清单文件与注入文件都是每次现读：改完立刻生效，不重挂载
 *   4. 用户层注入带签名、追加在本批用户消息之后、每会话一次
 *   5. 空清单 = 不注入，且不留判重痕；缺文件静默跳过；wrap 开关生效
 *
 * 不依赖网络与 DSH 运行时；文件走临时目录。
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.mjs'

const IDENTITY = '# 身份\n身份标记：TEST-IDENTITY-1'
const AGENTS = '# 用户\n指令标记：TEST-AGENTS-1'

const root = await mkdtemp(join(tmpdir(), 'roroko-pre-'))
await writeFile(join(root, 'IDENTITY.md'), IDENTITY, 'utf8')
await writeFile(join(root, 'AGENTS.md'), AGENTS, 'utf8')
process.env.DSH_HOME = root

const problems = []
const check = (ok, message) => {
  if (!ok) problems.push(message)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`)
}

/** 写清单文件。 */
async function writeConfig(body) {
  await mkdir(join(root, 'state'), { recursive: true })
  await writeFile(join(root, 'state', 'preinject.json'), JSON.stringify(body), 'utf8')
}

/** 假 ctx：section / 变量 / 监听器各自可查。 */
function makeFake() {
  const sections = new Map()
  const variables = new Map()
  const listeners = new Map()
  const fake = {
    sections,
    variables,
    listeners,
    webServer: { register: () => () => {} },
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
  return fake
}

const decide = async () => ({ kind: 'enter', messages: [] })
/** 带一条用户消息的决策：注入必须落在它后面。 */
const withUser = async () => ({ kind: 'enter', messages: [{ role: 'user', marker: 'USER-MSG' }] })

function boot(config = {}) {
  const fake = makeFake()
  apply(fake, { preinject: { root, ...config } })
  return {
    system: () => fake.variables.get('roroko_preinject_system')?.(),
    preStep: fake.listeners.get('agent/pre-step'),
    section: fake.sections.get('deployment:persona-prefix'),
    harness: fake.sections.get('harness:identity'),
  }
}

// ── 1. section 结构 ──
const base = boot()
check(base.section !== undefined, '注册了 deployment:persona-prefix')
check(base.section?.text === '{{roroko_preinject_system}}', 'section 文本只是宏，不含正文')
check(base.section?.order === 0, 'section order 走 getSectionOrder')
check(base.harness !== undefined && base.harness.text === '', 'harness:identity 被空段顶掉')

// ── 2. 空清单 = 什么都不注入 ──
check(base.system() === '', '没写清单时系统层不注入')
const empty = await base.preStep?.({ agent: { session: { id: 'session-empty', header: {} } } }, decide)
check(empty?.messages?.length === 0, '没写清单时用户层不注入')

// ── 3. 写清单立刻生效 ──
await writeConfig({ systemFiles: ['IDENTITY.md'], userFiles: ['AGENTS.md'] })
check(base.system()?.includes('TEST-IDENTITY-1') === true, '写完清单系统层立刻现读')
check(base.system()?.includes('TEST-AGENTS-1') === false, '系统层不吃用户清单的文件')

await writeFile(join(root, 'IDENTITY.md'), '# 身份\n身份标记：TEST-IDENTITY-2', 'utf8')
check(base.system()?.includes('TEST-IDENTITY-2') === true, '改文件后系统层跟着变（不重挂载）')

// ── 4. 用户层注入 ──
const out = await base.preStep?.({ agent: { session: { id: 'session-a', header: {} } } }, withUser)
const text = out?.messages?.[1]?.content?.[0]?.text ?? ''
check(out?.kind === 'enter', '进入 step 的决策被保留')
check(out?.messages?.length === 2, '注入了一条 user 消息')
check(out?.messages?.[0]?.marker === 'USER-MSG', '注入消息追加在用户消息之后')
check(text.includes('[roroko-preinject]') && text.includes('TEST-AGENTS-1'), '消息带签名与用户层内容')
check(text.includes('TEST-IDENTITY-2') === false, '用户层不吃系统清单的文件')
check(text.startsWith('<system-reminder>') && text.trimEnd().endsWith('</system-reminder>'), '默认包 system-reminder')
check(out?.messages?.[1]?.source?.kind === 'roroko-preinject', '消息 source 用生产者自有 kind')

const again = await base.preStep?.({ agent: { session: { id: 'session-a', header: {} } } }, withUser)
check(again?.messages?.length === 1, '同一会话第二次不再重复注入')

// ── 5. 清单可换、可空，空清单不留判重痕 ──
await writeConfig({ systemFiles: ['AGENTS.md'], userFiles: [] })
check(base.system()?.includes('TEST-AGENTS-1') === true, '换清单后系统层跟着换')
check(base.system()?.includes('TEST-IDENTITY-2') === false, '旧清单不再进系统层')
const skipped = await base.preStep?.({ agent: { session: { id: 'session-b', header: {} } } }, decide)
check(skipped?.messages?.length === 0, '用户清单为空时不注入')

await writeConfig({ userFiles: ['AGENTS.md'] })
const recovered = await base.preStep?.({ agent: { session: { id: 'session-b', header: {} } } }, decide)
check(recovered?.messages?.length === 1, '清单补回来后同一会话仍会注入（空清单没留判重痕）')

// ── 6. wrap 开关 ──
await writeConfig({ userFiles: ['AGENTS.md'], wrap: false })
const plain = await base.preStep?.({ agent: { session: { id: 'session-c', header: {} } } }, decide)
const plainText = plain?.messages?.[0]?.content?.[0]?.text ?? ''
check(plainText.includes('TEST-AGENTS-1') && !plainText.includes('<system-reminder>'), 'wrap: false 时不包壳')

// ── 7. 缺文件静默跳过 ──
await writeConfig({ systemFiles: ['NOPE.md', 'IDENTITY.md'], userFiles: ['NOPE.md', 'AGENTS.md'] })
check(base.system()?.includes('TEST-IDENTITY-2') === true, '系统清单里缺的文件静默跳过，其余照读')
const partial = await base.preStep?.({ agent: { session: { id: 'session-d', header: {} } } }, decide)
check((partial?.messages?.[0]?.content?.[0]?.text ?? '').includes('TEST-AGENTS-1'), '用户清单里缺的文件静默跳过')

// ── 8. 绝对路径与 ~/ ──
await writeConfig({ systemFiles: [join(root, 'AGENTS.md')] })
check(base.system()?.includes('TEST-AGENTS-1') === true, '绝对路径原样用')

await rm(root, { recursive: true, force: true })
console.log(problems.length === 0 ? '\n全部通过' : `\n${problems.length} 项未通过`)
process.exit(problems.length === 0 ? 0 : 1)
