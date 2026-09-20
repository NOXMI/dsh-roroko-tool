/**
 * dream 的**会话载体**测试:起一次性会话 → 挂 preset → 投任务书 → 等收敛 → 收掉。
 *
 * 载体 import 了 dsh-llm 的 createUserMessage(值导入),所以要带替身:
 *   node --import ./test/helpers/register-stubs.mjs test/memory-dream-session.mjs
 * agents / sessions / presets 全是**假服务** —— 这里验的是"我们对官方 API 的用法",
 * 不是官方实现本身。
 */
import { makeAsserts } from './helpers/harness.mjs'

const { ok, eq, done } = makeAsserts()

const { runDreamSession } = await import('../lib/memory-dream-session.js')

const TASK = '现在进入**记忆整理模式**。\n- 只做一件事:- #12 · 2026-09-20 16:12:33 · 摘要'

/** 造一套假运行时;log 按调用顺序记下每一次交互。 */
function makeFake(over = {}) {
  const log = []
  const base = {
    agents: {
      async create(options) {
        log.push({ kind: 'create', options })
        if (typeof options.setup === 'function') await options.setup({ 假: 'agentCtx' })
        return {
          agent: {
            session: { id: options.sessionId },
            followup(message) { log.push({ kind: 'followup', message }) },
            async whenIdle() { log.push({ kind: 'whenIdle' }) },
          },
          async dispose() { log.push({ kind: 'dispose' }) },
        }
      },
    },
    sessions: {
      async flush(session) { log.push({ kind: 'flush', id: session.id }) },
    },
    presets: {
      async resolve(id) { log.push({ kind: 'resolve', id }); return { id: id ?? 'deploy-default' } },
      async standingKeyFor(id) { log.push({ kind: 'standingKeyFor', id }) },
      async mount(ctx, id) { log.push({ kind: 'mount', id }) },
    },
    pluginName: 'roroko-memory',
    cwd: '/root/roroko-workspace',
    presetId: 'roroko-server',
    agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash', maxTokens: 8192 },
  }
  return { runtime: { ...base, ...over }, log }
}

const kinds = log => log.map(entry => entry.kind)
const find = (log, kind) => log.find(entry => entry.kind === kind)

// ── 一、正常一趟(挂了 preset) ──────────────────────────────────────────────
{
  const { runtime, log } = makeFake()
  const outcome = await runDreamSession(runtime, TASK, '2026-09-20 16:12:33')

  eq(
    kinds(log),
    ['resolve', 'standingKeyFor', 'create', 'mount', 'followup', 'whenIdle', 'flush', 'dispose'],
    '★ 调用顺序:解析 preset → 预热 → create(setup 里 mount) → 投任务书 → 等收敛 → 落盘 → 收掉',
  )
  eq(find(log, 'resolve').id, 'roroko-server', '按配置解析 preset')
  eq(find(log, 'standingKeyFor').id, 'roroko-server', '先立组合实例(免 mount 时现读名册)')

  const created = find(log, 'create').options
  ok(String(created.sessionId).startsWith('dream-'), '★ 会话 id 带 dream- 前缀(会话列表里一眼认出)')
  eq(String(created.sessionId), 'dream-20260920161233-' + String(created.sessionId).split('-').pop(), '会话 id 里带 CST 时间戳')
  eq(created.meta.cwd, '/root/roroko-workspace', 'cwd 传进会话 meta')
  eq(created.meta.agentPreset, 'roroko-server', '★ meta.agentPreset 记上(宿主靠它认人设)')
  eq(created.agentOptions, { provider: 'deepseek-official', model: 'deepseek-v4-flash', maxTokens: 8192 }, '★ 模型参数传进 agentOptions')
  eq(find(log, 'mount').id, 'roroko-server', '★ setup 里挂上 preset(人设与工具都从它来)')

  const message = find(log, 'followup').message
  eq(message.role, 'user', '投的是一条 user 消息')
  eq(message.content[0].text, TASK, '★ 投进去的就是任务书原文')
  eq(message.source.kind, 'plugin', '消息来源标成 plugin')
  eq(message.source.plugin, 'roroko-memory', '来源里带插件名')

  eq(find(log, 'flush').id, created.sessionId, 'flush 的是这个会话')
  eq(outcome.sessionId, String(created.sessionId), '回执带会话 id')
  eq(outcome.preset, 'roroko-server', '回执带挂上的 preset')
}

// ── 二、preset 留空 → 用部署默认 ────────────────────────────────────────────
{
  const { runtime, log } = makeFake({ presetId: '' })
  const outcome = await runDreamSession(runtime, TASK, '2026-09-20 16:12:33')
  eq(find(log, 'resolve').id, undefined, '★ 空 preset 时不带 id 去解析(拿部署默认)')
  eq(find(log, 'create').options.meta.agentPreset, 'deploy-default', '挂上解析出来的默认 preset')
  eq(outcome.preset, 'deploy-default', '回执如实回默认 preset')
}

// ── 三、没有 preset 名册 → 照样能跑(只是没人设/没工具行) ─────────────────
{
  const { runtime, log } = makeFake({ presets: undefined })
  const outcome = await runDreamSession(runtime, TASK, '2026-09-20 16:12:33')
  eq(kinds(log), ['create', 'followup', 'whenIdle', 'flush', 'dispose'], '★ 没名册就跳过 resolve/预热/mount')
  eq('agentPreset' in find(log, 'create').options.meta, false, 'meta 里不写 agentPreset')
  eq(outcome.preset, '', '回执说没挂 preset')
  ok(find(log, 'followup') !== undefined, '任务书照投(退化成"只有任务书"的会话)')
}

// ── 四、cwd 留空 → 用进程 cwd ──────────────────────────────────────────────
{
  const { runtime, log } = makeFake({ cwd: '   ' })
  await runDreamSession(runtime, TASK, '2026-09-20 16:12:33')
  eq(find(log, 'create').options.meta.cwd, process.cwd(), '空 cwd 回落进程 cwd')
}

// ── 五、会话跑炸了:异常抛给调用方,但会话仍被收掉 ────────────────────────
{
  const { runtime, log } = makeFake()
  runtime.agents.create = async (options) => {
    log.push({ kind: 'create', options })
    if (typeof options.setup === 'function') await options.setup({})
    return {
      agent: {
        session: { id: options.sessionId },
        followup(message) { log.push({ kind: 'followup', message }) },
        async whenIdle() { log.push({ kind: 'whenIdle' }); throw new Error('会话内部炸了') },
      },
      async dispose() { log.push({ kind: 'dispose' }) },
    }
  }
  let caught
  try {
    await runDreamSession(runtime, TASK, '2026-09-20 16:12:33')
  } catch (error) {
    caught = error
  }
  ok(caught !== undefined && String(caught.message).includes('炸了'), '★ 异常抛给调用方(由执行序层收成结果)')
  eq(kinds(log).includes('dispose'), true, '★ 即使跑炸也收掉会话(不留野 agent)')
  eq(kinds(log).includes('flush'), false, '跑炸时不 flush(落盘交给 dispose/持久化)')
}

// ── 六、create 就失败:不 dispose(还没拿到句柄) ──────────────────────────
{
  const { runtime, log } = makeFake()
  runtime.agents.create = async () => { throw new Error('创建被拒') }
  let caught
  try {
    await runDreamSession(runtime, TASK, '2026-09-20 16:12:33')
  } catch (error) {
    caught = error
  }
  ok(caught !== undefined, 'create 失败照样抛')
  eq(kinds(log).includes('dispose'), false, '没拿到句柄就不 dispose(不会去动别人的会话)')
}

process.exit(done('dream 会话载体') === 0 ? 0 : 1)
