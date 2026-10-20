/**
 * memory — 记忆子模块挂载口（roroko_mem_* 四把工具 + dream 定时反思）。
 *
 * 0.1.6 里它是独立一行插件（`name: '@roroko-tool/dsh-roroko-tool/memory'`），
 * 靠模块级 `inject = ['tools']` 静态接线，preset 声明即开关。0.2.1 起收进单入口：
 * preset 只要在 config 里给一个 memory 桶，host 就在 preset scope 里起子 fiber
 * 挂到这里 —— 工具注册因此天然按 preset 隔离，作用域里也不会再多一行插件。
 *
 * 分工：
 *   form.ts         → 纯逻辑（时间口径 / 区间 / 入参收窄 / 渲染 / DDL）
 *   store.ts        → sqlite 访问（一张表 memory，表名列名全编译期常量）
 *   dream-form.ts   → dream 的纯逻辑（队列 / 任务书 / 门禁 / 审计）
 *   dream-session.ts→ 起一次性会话把任务书跑完
 *   dream.ts        → 一次执行序 + 分段定时器
 *   本文件           → 四把工具的注册 + 总开关 + dream 起停
 *
 * ── 0.2.1 适配的三处 ────────────────────────────────────────────────────
 *   1 工具不再靠模块级 inject，改成 mount() 由 host 调进来。
 *   2 dbPath / owner / dream 配置要按 preset 分桶，而 preset id 只在 pre-step
 *     的 payload 里拿得到 → 本模块自己挂一个透传 pre-step 监听器记进实例变量，
 *     每次 execute 现读。每个 preset 各一份实例，值对本实例稳定。
 *   3 dreamRuntime 进 mount 闭包（见 dream.ts 文件头）。
 */
import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  MEMORY_ROUGH_DEFAULT_LIMIT, MEMORY_ROUGH_MAX_LIMIT, fmtCst, normalizeAdd, normalizeOwner,
  normalizeReflect,
} from './form.js'
import { openMemoryDb, runAdd, runDate, runId, runReflect, runRough } from './store.js'
import { DREAM_DEFAULT_MAX_TOKENS, type DreamConfig } from './dream-form.js'
import {
  claimDreamStart, createDreamRuntime, defaultDreamLogDir, releaseDreamStart, runDreamOnce,
  startDreamTimer, type DreamDeps, type DreamRunResult, type DreamTimer,
} from './dream.js'
import {
  runDreamSession, type DreamAgentsLike, type DreamPresetsLike, type DreamSessionsLike,
} from './dream-session.js'
import { readMemoryState, resolveMemory, type MemoryConfig } from './presets.js'
import { registerMemoryMount } from '../state.js'

export type { MemoryConfig } from './presets.js'
export {
  COMMON, DEFAULT_MEMORY_DB_PATH, DEFAULT_OWNER, memoryStateFile, memoryWiring, readMemoryState,
  resolveMemory, setMemoryBucket, clearMemoryBucket,
} from './presets.js'

/** 子模块标识：只用于日志，不是独立插件。 */
export const moduleName = 'roroko-memory'

const dshHome = (): string => process.env.DSH_HOME ?? join(homedir(), '.dsh')

/** 默认身份根（与 preinject / datas 同一个）。 */
export function defaultRoot(): string {
  return join(dshHome(), 'roroko')
}

/** ctx 上本模块用到的最小面。 */
interface Surface {
  tools: { register(definition: unknown): () => void }
  effect(callback: () => unknown, label?: string): unknown
  on(event: string, listener: (...args: any[]) => unknown): unknown
  inject(services: string[], callback: (scope: Context) => void): unknown
}

/** 工具输出统一渲染：text content block。 */
function textRender(_args: unknown, value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/** 工具入口：每次执行独立开关一条连接（与 roroko_datas_* 同款）。 */
function withDb(dbPath: string, fn: (db: DatabaseSync) => string): string {
  const db = openMemoryDb(dbPath)
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

/**
 * 挂载本子模块。由 host 在自己的 ctx 上调用，不单独占一行插件。
 * @param ctx - 宿主上下文（通常是 preset scope 里的子 fiber）。
 * @param rawConfig - 子模块配置（preset 的 config.memory）。
 */
export function mount(ctx: Context, rawConfig: MemoryConfig = {}): void {
  const surface = ctx as unknown as Surface
  const config: MemoryConfig = { ...rawConfig }
  const root = rawConfig.root !== undefined && rawConfig.root.trim().length > 0
    ? rawConfig.root.trim()
    : defaultRoot()

  /** 本实例最近一次在 pre-step 里见到的 preset id。 */
  let activePreset: string | undefined

  /** dream 的运行面：每个 mount 一份（模块级会跨 preset 串味）。 */
  const runtime = createDreamRuntime()

  /**
   * 总开关。默认关：设置页勾了才注册四把工具、才起 dream。
   *
   * 为什么能做到"点一下就开"：`ctx.tools.register()` 返回注销函数，工具是 scope
   * 里的活注册表 —— 加了下一轮请求头就带上、撤了下一轮就消失。所以这里不靠重挂载，
   * 靠每次 pre-step / agent/created 现读覆盖层后 start / stop。
   */
  let started = false
  let disposers: Array<() => void> = []

  /** dream 的服务面（agents / sessions 到齐才有值）。 */
  let dreamCtx: Context | undefined
  let timer: DreamTimer | undefined

  surface.effect(() => registerMemoryMount({ root, config, runtime }), 'memory.status()')

  // 透传监听器：只记 preset，不改决策（放在 next 之前，尽早拿到）。
  surface.on('agent/pre-step', (
    payload: { agent?: { session?: { header?: { agentPreset?: string } } } },
    next: () => Promise<unknown>,
  ) => {
    const presetId = payload.agent?.session?.header?.agentPreset
    if (presetId !== undefined) activePreset = presetId
    // 开或关在下一步之前对齐（设置页刚改完也能吃到）。
    sync()
    return next()
  })

  // 会话创建时就记（首装配可能早于首次 pre-step）。
  surface.on('agent/created', (payload: { agent?: { session?: { header?: { agentPreset?: string } } } }) => {
    const presetId = payload.agent?.session?.header?.agentPreset
    if (presetId !== undefined) activePreset = presetId
    sync()
  })

  /** 每次现读：preset 覆盖层可能刚被设置页改过。 */
  const resolved = (): ReturnType<typeof resolveMemory> =>
    resolveMemory(config, readMemoryState(root), activePreset)

  const dbPath = (): string => resolved().dbPath
  const owner = (): string => resolved().owner
  const dream = (): DreamConfig => resolved().dream

  const editTool = defineTool({
    name: 'roroko_mem_edit',
    description:
      '洛洛可记忆的写入与反思。'
      + 'op=add 记一条新记忆:content 是初摘要,summary 是粗筛/回查时看到的那句。'
      + '**写入前先过三问**:①人设或画像层已经有了?→ 不记 ②永久有效且每轮都该生效?→ 去改人设文件,不进这张表 '
      + '③它能改变我未来某个场景的行为?→ 记,并写成「触发条件 → 应做」。'
      + '必记四类:边界与安全词的演变 / 有效或无效的挑逗 / 未完成的钩子 / 我自己的失手记录。'
      + '不记素材与此刻状态(那是 roroko_datas_* 的地盘);不记人设里已有的偏好。'
      + 'op=reflect 反思已有那条(id):**整条覆盖 content**、刷新反思时间,summary 不传就保留原样;'
      + '适用 = 记错了 / 记得太啰嗦 / 有了更准的结论。'
      + '**观点变了或出现矛盾时别覆盖,用 op=add 另记一条**(保留矛盾,不消解)。'
      + '写进哪个桶由插件配置决定,工具不带桶参数。',
    parameters: {
      op: {
        type: 'string',
        required: true,
        enum: ['add', 'reflect'],
        description: 'add=写一条新记忆;reflect=反思并覆盖已有的那条。',
      },
      id: {
        type: 'number',
        description: 'op=reflect 必需:要反思的记忆 id(来自 roroko_mem_rough / roroko_mem_date 的结果)。',
      },
      content: {
        type: 'string',
        required: true,
        description: 'add=初摘要(发生了什么 + 结论);reflect=新的 content 正文,整条覆盖而非追加。',
      },
      summary: {
        type: 'string',
        description: 'add 必需;reflect 不传则保留原 summary。二次摘要:粗筛与按日期回查时看到的就是它(≤300 字)。',
      },
      source: {
        type: 'string',
        description: '可选出处:会话 id 或 会话 id#事件序号(回原文的唯一凭据;add 才用)。',
      },
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args) {
      const at = new Date()
      if (args.op === 'reflect') {
        const reflected = normalizeReflect({ id: args.id, content: args.content, summary: args.summary })
        if (reflected.input === undefined) return `反思失败: ${reflected.error}`
        return withDb(dbPath(), db => runReflect(db, reflected.input!, at))
      }
      const normalized = normalizeAdd({
        owner: owner(),
        content: args.content,
        summary: args.summary,
        source: args.source,
      })
      if (normalized.input === undefined) return `写入失败: ${normalized.error}`
      return withDb(dbPath(), db => runAdd(db, normalized.input!, at).text)
    },
    presentCall(args) {
      if (args.op === 'reflect') {
        return {
          card: 'generic',
          title: `反思 #${args.id}`,
          kind: 'other',
          rawInput: String(args.content ?? '').slice(0, 40),
        }
      }
      return {
        card: 'generic',
        title: '记一条记忆',
        kind: 'other',
        rawInput: String(args.summary ?? args.content ?? '').slice(0, 40),
      }
    },
  })

  const dateTool = defineTool({
    name: 'roroko_mem_date',
    description:
      '洛洛可记忆按日期回查:返回 id / 时间 / 类别 / 摘要 / 未反思标记。'
      + '默认区间 = 今天 + 昨天 —— **会话开始时先调它**;'
      + '他问"某天干了什么"时也用它。'
      + '要看某条的完整内容用 roroko_mem_id;想不起某事的细节用 roroko_mem_rough。',
    parameters: {
      from: {
        type: 'string',
        description: '起始日期 YYYY-MM-DD;不给 = 昨天(配 to 不给即今天+昨天)。',
      },
      to: {
        type: 'string',
        description: '结束日期 YYYY-MM-DD;只给 to = 查那一天。',
      },
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args) {
      const at = new Date()
      return withDb(dbPath(), db => runDate(db, { from: args.from, to: args.to }, owner(), at))
    },
    presentCall(args) {
      const span = args.from !== undefined && args.from.length > 0 ? args.from : '今天+昨天'
      return { card: 'generic', title: `回查记忆 · ${span}`, kind: 'read', rawInput: span }
    },
  })

  const roughTool = defineTool({
    name: 'roroko_mem_rough',
    description:
      '洛洛可记忆关键词检索:返回命中的 id / 时间 / 类别 / 摘要。'
      + '**想不起某事时先调它**,别硬编。keywords 用空格或逗号分隔(≤8 个词,**每个词都要出现**才命中)。'
      + '查不到会明说"没有匹配上" —— 那是关键词没对上,**不许据此编造记忆**;少给一个词再试。'
      + '摘要不够判断时再用 roroko_mem_id 取全文。',
    parameters: {
      keywords: {
        type: 'string',
        required: true,
        description: '检索词,空格/逗号分隔,如 "记忆 检索 落地"(每个词都要出现)。',
      },
      limit: {
        type: 'number',
        description: `返回条数,缺省 ${MEMORY_ROUGH_DEFAULT_LIMIT},上限 ${MEMORY_ROUGH_MAX_LIMIT}。`,
      },
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args) {
      return withDb(dbPath(), db => runRough(db, { keywords: args.keywords, limit: args.limit }, owner()))
    },
    presentCall(args) {
      const words = String(args.keywords ?? '').slice(0, 40)
      return { card: 'generic', title: `检索记忆 · ${words}`, kind: 'read', rawInput: words }
    },
  })

  const idTool = defineTool({
    name: 'roroko_mem_id',
    description:
      '洛洛可记忆按 id 取完整内容(初摘要 content + 出处 source)。'
      + 'id 从 roroko_mem_rough / roroko_mem_date 的结果里拿 —— **只在摘要不足以判断时才取,别一次捞一堆**。'
      + '只在本桶里找。',
    parameters: {
      id: {
        type: 'number',
        required: true,
        description: '记忆 id(正整数,来自检索或按日期回查的结果)。',
      },
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args) {
      return withDb(dbPath(), db => runId(db, { id: args.id }, owner()))
    },
    presentCall(args) {
      return { card: 'generic', title: `读记忆 #${args.id}`, kind: 'read', rawInput: String(args.id) }
    },
  })

  // ── dream 机制层 ──────────────────────────────────────────────────────

  /** 按当前配置造一次执行的依赖（现算，所以配置是活的）。 */
  const makeDeps = (
    cfg: DreamConfig,
    services: { agents: DreamAgentsLike; sessions: DreamSessionsLike; presets?: DreamPresetsLike },
  ): DreamDeps => ({
    dbPath: dbPath(),
    owner: owner(),
    provider: cfg.provider,
    model: cfg.model,
    batch: cfg.batch,
    logDir: defaultDreamLogDir(dbPath()),
    now: () => new Date(),
    runSession: (prompt, bookmark) => runDreamSession({
      agents: services.agents,
      sessions: services.sessions,
      presets: services.presets,
      cwd: cfg.cwd,
      presetId: cfg.preset,
      agentOptions: {
        provider: cfg.provider,
        model: cfg.model,
        maxTokens: DREAM_DEFAULT_MAX_TOKENS,
      },
    }, prompt, bookmark),
  })

  /** 起 dream：确认服务可用 → 认领本库的启动权 → 装运行面 → 起分段定时器。 */
  const startDream = (): void => {
    if (dreamCtx === undefined) return
    if (runtime.run !== undefined) return
    const cfg = dream()
    if (!cfg.enabled) return

    // ⚠️ 顺序要紧：**先确认能起会话，再认领启动权** —— 反过来会让一次"服务还没
    // 就绪"的装配白占掉名额，之后所有实例都被去重闸挡住，dream 永远接不上。
    const agents = (dreamCtx as unknown as { agents?: DreamAgentsLike }).agents
    const sessions = (dreamCtx as unknown as { sessions?: DreamSessionsLike }).sessions
    if (agents === undefined || sessions === undefined) {
      console.log('[roroko-memory] dream 未启动：agents/sessions 服务不可用')
      return
    }
    const path = dbPath()
    if (!claimDreamStart(path)) {
      console.log(`[roroko-memory] dream 已在管 ${path}，本实例不重复起定时器`)
      return
    }

    const presets = (dreamCtx as unknown as { agentPresets?: DreamPresetsLike }).agentPresets
    if (presets === undefined) {
      console.log('[roroko-memory] dream 起会话时没有 preset 名册：会话里不会有人设与工具行')
    }
    if (cfg.provider.length === 0) {
      console.log('[roroko-memory] dream 已启用但未配 provider/model，每次都会跳过')
    }
    const services = { agents, sessions, presets }

    /** 跑一次并把结果贴到共享面 —— 定时器与手动触发共用，顺便防并发。 */
    const runOnce = async (): Promise<DreamRunResult> => {
      const now = dream()
      const skip = (note: string): DreamRunResult => ({
        queued: 0, skippedLogs: 0, sessionId: '', preset: '', added: 0, changed: [], note,
      })
      if (!now.enabled) return skip('已在面板关闭,跳过')
      if (now.provider.length === 0 || now.model.length === 0) return skip('未配置模型(provider/model),跳过')
      if (runtime.running) return skip('上一次还在跑,本次跳过')
      runtime.running = true
      try {
        const result = await runDreamOnce(makeDeps(now, services))
        runtime.last = { ...result, at: fmtCst(new Date()) }
        return result
      } finally {
        runtime.running = false
      }
    }

    runtime.config = cfg
    runtime.resolve = dream
    runtime.run = runOnce

    timer = startDreamTimer({
      intervalMs: () => dream().intervalMs,
      run: async () => {
        const result = await runOnce()
        const line = `[roroko-memory] dream: ${result.note}`
        if (result.error !== undefined) ctx.logger?.warn?.(line)
        else ctx.logger?.info?.(line)
      },
      now: () => new Date(),
      onError: error => ctx.logger?.warn?.(`[roroko-memory] dream 定时器异常: ${String(error)}`),
    })
    disposers.push(() => {
      timer?.dispose()
      timer = undefined
      releaseDreamStart(path)
      runtime.run = undefined
      runtime.resolve = undefined
      console.log('[roroko-memory] dream 定时器已收起')
    })
    console.log('[roroko-memory] dream 已启动')
  }

  // ── 开关 ──────────────────────────────────────────────────────────────

  /** 打开：注册四把工具 + 起 dream。 */
  const start = (): void => {
    if (started) return
    started = true
    // 挂载即建表（幂等）：库不可写时不抛 —— 别让一个坏路径把整个子模块拖垮。
    try {
      openMemoryDb(dbPath()).close()
    } catch {
      // 真正取用时会报明确错误
    }
    disposers.push(surface.tools.register(editTool))
    disposers.push(surface.tools.register(dateTool))
    disposers.push(surface.tools.register(roughTool))
    disposers.push(surface.tools.register(idTool))
    startDream()
    console.log('[roroko-memory] enabled → 四把工具已注册')
  }

  /** 关掉：撤工具、收 dream 定时器。 */
  const stop = (): void => {
    if (!started) return
    started = false
    for (const dispose of disposers.splice(0).reverse()) {
      try {
        dispose()
      } catch (error) {
        console.log('[roroko-memory] stop:', error instanceof Error ? error.message : String(error))
      }
    }
    console.log('[roroko-memory] disabled → 工具已撤下')
  }

  /** 按总开关对齐一次（幂等，开关没变就什么都不做）。 */
  const sync = (): void => {
    try {
      if (resolved().enabled) start()
      else stop()
    } catch (error) {
      // 读覆盖层失败不该把 step 打崩：保持现状。
      console.log('[roroko-memory] sync skipped:', error instanceof Error ? error.message : String(error))
    }
  }

  // dream 的服务面：agents / sessions 到齐才点亮（缺席只让 dream 不起，工具照常）。
  surface.inject(['agents', 'sessions'], (scope) => {
    dreamCtx = scope
    sync()
    ;(scope as unknown as { effect(cb: () => unknown, label?: string): unknown }).effect(() => () => {
      dreamCtx = undefined
    }, 'roroko-memory: dream services')
  })

  // 初始对齐：挂载时先按当前覆盖层决定开不开（默认关）。
  sync()
}
