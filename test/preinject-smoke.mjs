/**
 * preinject 冒烟测试（node test/preinject-smoke.mjs）
 *
 * 用假的 cordis Context 驱动真实构建产物，验证：
 *   1. section 注册到 deployment:persona-prefix，文本只是宏
 *   2. 四层链：默认 ← 接线 config ← 公共桶 ← 分 preset 桶，逐字段回落
 *   3. 覆盖层与注入文件都是每次现读：改完立刻生效，不重挂载
 *   4. 用户层注入带签名、追加在本批用户消息之后、每会话一次
 *   5. 空清单 = 不注入且不留判重痕；缺文件静默跳过；首尾由文件自带
 *
 * 系统段的 provider 靠 scope 登记簿选桶，假 ctx 造不出真 scope，所以分桶的
 * 断言走用户段（preset id 直接来自 session header）+ resolveEffective 直调。
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, resolveEffective, readState, DEFAULTS } from '../lib/index.mjs'

const IDENTITY = '# 身份\n身份标记：TEST-IDENTITY-1'
const AGENTS = '# 用户\n指令标记：TEST-AGENTS-1'
const EXTRA = '# 额外\n标记：TEST-EXTRA-1'

const root = await mkdtemp(join(tmpdir(), 'roroko-pre-'))
await writeFile(join(root, 'IDENTITY.md'), IDENTITY, 'utf8')
await writeFile(join(root, 'AGENTS.md'), AGENTS, 'utf8')
await writeFile(join(root, 'EXTRA.md'), EXTRA, 'utf8')
process.env.DSH_HOME = root

const problems = []
const check = (ok, message) => {
  if (!ok) problems.push(message)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`)
}

/** 写覆盖层：`{ presets: { common: {...}, roroko: {...} } }`。 */
async function writeState(presets) {
  await mkdir(join(root, 'state'), { recursive: true })
  await writeFile(join(root, 'state', 'preinject.json'), JSON.stringify({ presets }), 'utf8')
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

/** 会话（preset id 由 header 决定）。 */
const session = (id, agentPreset) => ({ agent: { session: { id, header: { agentPreset } } } })

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

// ── 2. 什么都不写 = 什么都不注入 ──
check(base.system() === '', '没有覆盖层时系统层不注入')
const empty = await base.preStep?.(session('s-empty', 'roroko'), decide)
check(empty?.messages?.length === 0, '没有覆盖层时用户层不注入')

// ── 3. 公共桶立刻生效 ──
await writeState({ common: { systemFiles: ['IDENTITY.md'], userFiles: ['AGENTS.md'] } })
check(base.system()?.includes('TEST-IDENTITY-1') === true, '写完公共桶系统层立刻现读')

await writeFile(join(root, 'IDENTITY.md'), '# 身份\n身份标记：TEST-IDENTITY-2', 'utf8')
check(base.system()?.includes('TEST-IDENTITY-2') === true, '改文件后系统层跟着变（不重挂载）')

// ── 4. 用户层注入落在用户消息之后 ──
const out = await base.preStep?.(session('s-a', 'roroko'), withUser)
const text = out?.messages?.[1]?.content?.[0]?.text ?? ''
check(out?.kind === 'enter' && out?.messages?.length === 2, '注入了一条 user 消息')
check(out?.messages?.[0]?.marker === 'USER-MSG', '注入消息追加在用户消息之后')
check(text.includes('TEST-AGENTS-1'), '消息内容来自用户层清单')
check(text === '# 用户\n指令标记：TEST-AGENTS-1', '用户层是纯拼接：不加签名、不加壳')
check(out?.messages?.[1]?.source?.kind === 'roroko-preinject', '消息 source 用生产者自有 kind')

const again = await base.preStep?.(session('s-a', 'roroko'), withUser)
check(again?.messages?.length === 1, '同一会话第二次不再重复注入')

// ── 5. 分预设桶：叠在公共桶之上，字段级 ──
await writeState({ common: { systemFiles: ['IDENTITY.md'], userFiles: ['AGENTS.md'] }, roroko: { userFiles: ['EXTRA.md'] } })
const scoped = await base.preStep?.(session('s-b', 'roroko'), decide)
const scopedText = scoped?.messages?.[0]?.content?.[0]?.text ?? ''
check(scopedText.includes('TEST-EXTRA-1'), '分预设桶盖住公共桶的同名字段')
check(scopedText.includes('TEST-AGENTS-1') === false, '被盖掉的清单不再出现在用户层')

const other = await base.preStep?.(session('s-c', 'someone-else'), decide)
const otherText = other?.messages?.[0]?.content?.[0]?.text ?? ''
check(otherText.includes('TEST-AGENTS-1'), '别的 preset 仍吃公共桶')
check(otherText.includes('TEST-EXTRA-1') === false, '分预设桶不会漏到别的 preset')

// ── 6. 四层链：接线 config 夹在默认和公共桶之间 ──
const wired = boot({ systemFiles: ['EXTRA.md'], userFiles: ['IDENTITY.md'] })
await writeState({ common: { userFiles: ['AGENTS.md'] } })
const wiredState = readState(root)
const effective = resolveEffective({ systemFiles: ['EXTRA.md'], userFiles: ['IDENTITY.md'] }, wiredState, undefined)
check(effective.systemFiles.join() === 'EXTRA.md', '公共桶没覆盖时用接线 config 的系统层')
check(effective.userFiles.join() === 'AGENTS.md', '公共桶覆盖后接线 config 让位')
check(DEFAULTS.systemFiles.length === 0, '内置默认是空清单')
check(wired.system()?.includes('TEST-EXTRA-1') === true, '接线 config 的系统层会真的注入')

// ── 7. 空清单 = 显式清空，且不留判重痕 ──
await writeState({ common: { userFiles: [] } })
const skipped = await base.preStep?.(session('s-d', 'roroko'), decide)
check(skipped?.messages?.length === 0, '用户清单为空时不注入')
await writeState({ common: { userFiles: ['AGENTS.md'] } })
const recovered = await base.preStep?.(session('s-d', 'roroko'), decide)
check(recovered?.messages?.length === 1, '清单补回来后同一会话仍会注入（空清单没留判重痕）')

// ── 8. 首尾由文件自己带，注入侧一个字都不加 ──
await writeFile(join(root, 'FRAMED.md'), '<system-reminder>\n\n# 用户\nFRAMED-1\n\n</system-reminder>', 'utf8')
await writeState({ common: { userFiles: ['FRAMED.md'] } })
const framed = await base.preStep?.(session('s-e', 'roroko'), decide)
const framedText = framed?.messages?.[0]?.content?.[0]?.text ?? ''
check(framedText.startsWith('<system-reminder>') && framedText.endsWith('</system-reminder>'), '文件里写的首尾原样带进消息')
check(!framedText.includes('[roroko-preinject]'), '注入侧不再加签名行')

// ── 9. 缺文件静默跳过 ──
await writeState({ common: { systemFiles: ['NOPE.md', 'IDENTITY.md'], userFiles: ['NOPE.md', 'AGENTS.md'] } })
check(base.system()?.includes('TEST-IDENTITY-2') === true, '系统清单里缺的文件静默跳过，其余照读')
const partial = await base.preStep?.(session('s-f', 'roroko'), decide)
check((partial?.messages?.[0]?.content?.[0]?.text ?? '').includes('TEST-AGENTS-1'), '用户清单里缺的文件静默跳过')

// ── 10. 绝对路径 ──
await writeState({ common: { systemFiles: [join(root, 'EXTRA.md')] } })
check(base.system()?.includes('TEST-EXTRA-1') === true, '绝对路径原样用')

await rm(root, { recursive: true, force: true })
console.log(problems.length === 0 ? '\n全部通过' : `\n${problems.length} 项未通过`)
process.exit(problems.length === 0 ? 0 : 1)
