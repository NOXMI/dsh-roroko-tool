/**
 * dream 的载体:起一个**一次性会话**,把任务书投进去,等它跑完再收掉。
 *
 * 为什么从"一次性 llm 调用"换成会话(2026-09-21 阿一拍板):
 *   一次性调用只拿得到一段提示词 —— 没有系统提示词、没有工具、没有人设,
 *   "像一个啥也不知道的外人来弄"。换成会话之后,任务书之外的一切都由**那个 preset
 *   自己供**:人设靠 preinject 注入的系统段,可用工具靠 preset 声明的插件行,
 *   模型因而能自己 `roroko_mem_id` 取全文、自己 `roroko_mem_edit` 改回去。
 *
 * 本文件**不 import 官方实现**,只声明用到的那几个面(接口) —— 于是测试可以塞替身,
 * 不依赖 DSH 运行时。接线层负责把真实服务 `ctx.get('agents')` 传进来。
 *
 * 生命周期照官方 headless 的用法(`bundle/headless/src/index.ts`):
 *   create →(setup 里挂 preset)→ followup(任务书)→ whenIdle → flush → dispose。
 * **异常全吞**:一次整理失败不该把定时器打崩(调用方还有自己的 catch)。
 */
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'

/** agent 的最小面(真实值:`AgentHandle.agent`)。 */
export interface DreamAgentLike {
  readonly session: Session
  /** 投一条普通 follow-up(会唤醒驱动)。 */
  followup(message: unknown): void
  /** 等整个 agent 活动收敛(含它自己发的工具调用)。 */
  whenIdle(): Promise<void>
}

/** agent 注册表的最小面(真实值:`ctx.get('agents')`)。 */
export interface DreamAgentsLike {
  create(options: Record<string, unknown>): Promise<{ agent: DreamAgentLike; dispose?: () => Promise<void> }>
}

/** 会话持久化的最小面(真实值:`ctx.get('sessions')`)。 */
export interface DreamSessionsLike {
  flush(session: Session): Promise<void>
}

/** preset 注册表的最小面(真实值:`ctx.get('agentPresets')`)。 */
export interface DreamPresetsLike {
  resolve(id?: string): Promise<{ id: string }>
  standingKeyFor?(id: string): Promise<unknown>
  mount(agentCtx: Context, id?: string): Promise<unknown>
}

/** 一次会话化执行要用到的东西。 */
export interface DreamSessionRuntime {
  agents: DreamAgentsLike
  sessions: DreamSessionsLike
  /** 缺席 = 这个部署没有 preset 名册,起出来的会话就没有人设与工具行。 */
  presets?: DreamPresetsLike
  /** 写进消息来源的插件名(会话日志里能看出这条是谁投的)。 */
  pluginName: string
  /** 会话的工作目录(人设文件里的相对路径按它解析);空串 = 进程 cwd。 */
  cwd: string
  /** 用哪个 preset;空串 = 该部署的默认 preset。 */
  presetId: string
  /** 会话的模型参数(provider / model 来自 dream 配置,maxTokens 是内置常量)。 */
  agentOptions: { provider: string; model: string; maxTokens: number }
}

/** 一次会话的结果(给审计与回执用)。 */
export interface DreamSessionOutcome {
  sessionId: string
  /** 实际挂上的 preset(空串 = 没挂)。 */
  preset: string
}

/** 会话 id 前缀:会话列表里一眼能认出这是 dream 的会话。 */
const SESSION_PREFIX = 'dream'

/**
 * 跑一个一次性会话:挂 preset → 投任务书 → 等收敛 → 等落盘 → 收掉。
 * 任何一步失败都抛给调用方(它会收成结果里的 error,不往上冒)。
 * @param runtime - 真实的 agents / sessions / presets 与本次的 cwd、preset
 * @param prompt - 任务书正文(由执行序层组装,这里只负责投递)
 * @param bookmark - CST 时间戳,用来拼会话 id(便于在会话列表里认出来)
 */
export async function runDreamSession(
  runtime: DreamSessionRuntime,
  prompt: string,
  bookmark: string,
): Promise<DreamSessionOutcome> {
  const presetId = runtime.presetId.trim()
  const preset = runtime.presets === undefined
    ? undefined
    : await runtime.presets.resolve(presetId.length > 0 ? presetId : undefined)
  // 预热:把 preset 的组合实例先立起来(mount 时才不会现读名册撞上并发改文件)
  if (preset !== undefined) await runtime.presets?.standingKeyFor?.(preset.id)

  const stamp = bookmark.replace(/[^0-9]/g, '').slice(0, 14)
  const sessionId = `${SESSION_PREFIX}-${stamp}-${Math.random().toString(36).slice(2, 8)}` as unknown as SessionId

  const handle = await runtime.agents.create({
    sessionId,
    meta: {
      cwd: runtime.cwd.trim().length > 0 ? runtime.cwd.trim() : process.cwd(),
      ...preset === undefined ? {} : { agentPreset: preset.id },
    },
    agentOptions: runtime.agentOptions,
    setup: async (agentCtx: Context): Promise<void> => {
      if (preset === undefined) return
      await runtime.presets?.mount(agentCtx, preset.id)
    },
  })

  try {
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'plugin', plugin: runtime.pluginName },
    }))
    await handle.agent.whenIdle()
    await runtime.sessions.flush(handle.agent.session)
    return { sessionId: String(sessionId), preset: preset?.id ?? '' }
  } finally {
    // 收掉会话:agent 从注册表移除、会话文件已 flush 落盘
    await handle.dispose?.()
  }
}
