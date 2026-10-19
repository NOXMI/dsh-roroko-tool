/**
 * datas — 素材库子模块挂载口（roroko_datas_* 四把工具 + state 自动注入）。
 *
 * 0.1.6 里它是独立一行插件（`name: '@roroko-tool/dsh-roroko-tool/data'`），
 * 靠模块级 `inject = ['tools']` 静态接线。0.2.1 起收进单入口：preset 只要
 * 在 config 里给一个 datas 桶，host 就在 preset scope 里 ctx.inject(['tools'])
 * 起子 fiber 挂到这里 —— 工具注册因此天然按 preset 隔离。
 *
 * 分工：
 *   query.ts                → roroko_datas_query（取料：发散 / 收束）
 *   state.ts                → roroko_datas_lookup / register / state 的业务
 *   state-autoinject.ts     → state 短条自动注入机制（不注册工具）
 *   本文件                   → 三把非取料工具的注册 + dbPath 四层链
 *
 * ── 0.2.1 适配的关键一处 ────────────────────────────────────────────────
 * 工具 execute 是异步且可能跨 turn 的，而 dbPath 要按 preset 分桶。preset id
 * 只在 pre-step 的 payload 里拿得到，所以本模块自己挂一个透传 pre-step 监听器
 * 把它记进实例变量，工具每次 execute 现读。每个 preset 各挂一份实例，值对本
 * 实例稳定。
 */
import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { applyQuery } from './query.js'
import { runLookup, runRegister, runStateSnap, runStateUpdate } from './state.js'
import { applyStateAutoinject } from './state-autoinject.js'
import { readDatasState, resolveDatas, type DatasConfig } from './presets.js'
import { registerDatasMount } from '../state.js'

export type { DatasConfig } from './presets.js'
export { COMMON, DEFAULT_DB_PATH, datasStateFile, readDatasState, resolveDatas, setDatasBucket, clearDatasBucket } from './presets.js'

/** 子模块标识：只用于日志与消息来源签名，不是独立插件。 */
export const moduleName = 'roroko-datas'

const dshHome = (): string => process.env.DSH_HOME ?? join(homedir(), '.dsh')

/** 默认身份根（与 preinject 同一个）。 */
export function defaultRoot(): string {
  return join(dshHome(), 'roroko')
}

/** ctx 上本模块用到的最小面。 */
interface Surface {
  tools: { register(definition: unknown): () => void }
  effect(callback: () => unknown, label?: string): unknown
  on(event: string, listener: (...args: any[]) => unknown): unknown
}

/** 工具输出统一渲染：text content block。 */
function textRender(_args: unknown, value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/** 工具入口：按白名单操作 sqlite（表名列名全来自常量）。 */
function withDb(dbPath: string, fn: (db: DatabaseSync) => string): string {
  const db = new DatabaseSync(dbPath)
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

/**
 * 挂载本子模块。由 host 在自己的 ctx 上调用，不单独占一行插件。
 * @param ctx - 宿主上下文（通常是 preset scope 里的子 fiber）。
 * @param rawConfig - 子模块配置（preset 的 config.datas）。
 */
export function mount(ctx: Context, rawConfig: DatasConfig = {}): void {
  const surface = ctx as unknown as Surface
  const config: DatasConfig = { ...rawConfig }
  const root = rawConfig.root !== undefined && rawConfig.root.trim().length > 0
    ? rawConfig.root.trim()
    : defaultRoot()

  /** 本实例最近一次在 pre-step 里见到的 preset id。 */
  let activePreset: string | undefined

  /**
   * 总开关。默认关：设置页勾了才注册四把工具、才注入 state 短条。
   *
   * 为什么能做到"点一下就开"：`ctx.tools.register()` 返回注销函数，工具是
   * scope 里的活注册表，加了下一轮请求头就会带上、撤了下一轮就消失（agent-loop
   * 每个 step 比对 header 决定是否重发工具表）。所以这里不靠重挂载，靠每次
   * pre-step / agent/created 现读覆盖层后 start / stop。
   */
  let started = false
  let disposers: Array<() => void> = []

  surface.effect(() => registerDatasMount({ root, config }), 'datas.status()')
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

  // 会话创建时就记（首次装配/首个工具调用都可能早于首次 pre-step 之后的记账）。
  surface.on('agent/created', async (payload: { agent?: { session?: { header?: { agentPreset?: string } } } }) => {
    const presetId = payload.agent?.session?.header?.agentPreset
    if (presetId !== undefined) activePreset = presetId
    sync()
  })

  /** 每次执行现读：preset 覆盖层可能刚被设置页改过。 */
  const dbPath = (): string => resolveDatas(config, readDatasState(root), activePreset).dbPath

  /** 打开：注册四把工具 + 起自动注入。 */
  const start = (): void => {
    if (started) return
    started = true
    disposers.push(applyQuery(ctx, dbPath))
    disposers.push(applyStateAutoinject(ctx, root, config, () => activePreset))
    disposers.push(surface.tools.register(lookupTool))
    disposers.push(surface.tools.register(registerTool))
    disposers.push(surface.tools.register(stateTool))
    console.log('[roroko-datas] enabled → 四把工具已注册')
  }

  /** 关掉：撤工具、拆监听器。 */
  const stop = (): void => {
    if (!started) return
    started = false
    for (const dispose of disposers.splice(0).reverse()) {
      try {
        dispose()
      } catch (error) {
        console.log('[roroko-datas] stop:', error instanceof Error ? error.message : String(error))
      }
    }
    console.log('[roroko-datas] disabled → 工具已撤下')
  }

  /** 按总开关对齐一次（幂等，开关没变就什么都不做）。 */
  const sync = (): void => {
    try {
      if (resolveDatas(config, readDatasState(root), activePreset).enabled) start()
      else stop()
    } catch (error) {
      // 读覆盖层失败不该把 step 打崩：保持现状。
      console.log('[roroko-datas] sync skipped:', error instanceof Error ? error.message : String(error))
    }
  }

  const lookupTool = defineTool({
    name: 'roroko_datas_lookup',
    description: '按名字精确查某素材(场景/穿搭/道具/伴侣)的完整详情,返回过滤后的字段。遇到不认识的名字先查这里。',
    parameters: {
      name: {
        type: 'string',
        required: true,
        description: '要查的元素名,如 "白衬衫" / "健身教练"。',
      },
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args) {
      return withDb(dbPath(), db => runLookup(db, args.name))
    },
    presentCall(args) {
      return { card: 'generic', title: `查详情 ${args.name}`, kind: 'read', rawInput: args.name }
    },
  })

  const registerTool = defineTool({
    name: 'roroko_datas_register',
    description:
      '素材兜底注册:场景/穿搭/道具/伴侣不在库里时注册入 ad_hoc 表。'
      + '若主表已有同名,则把名字分词合并进关键词,不重复录入。type 取 scene|clothing|items|companion。',
    parameters: {
      type: {
        type: 'string',
        required: true,
        enum: ['scene', 'companion', 'clothing', 'items'],
        description: '注册类型:scene=场景,clothing=穿搭,items=道具,companion=伴侣。',
      },
      name: {
        type: 'string',
        required: true,
        description: '要注册的名字,如 "地铁" / "外卖骑手"。',
      },
      desc: {
        type: 'string',
        description: '一句话描述,存 ad_hoc.description。',
      },
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args) {
      return withDb(dbPath(), db => runRegister(db, args.type, args.name, args.desc ?? ''))
    },
    presentCall(args) {
      return { card: 'generic', title: `注册 ${args.type}/${args.name}`, kind: 'other', rawInput: args.name }
    },
  })

  const stateTool = defineTool({
    name: 'roroko_datas_state',
    description:
      '洛洛可状态读写:单行状态存叙事(scene/truth/decision/position/body_state/behavior)'
      + '、身体(sex_state/arousal/fatigue/companion_*)、穿搭(outfit_*)、道具(sexual_items)与计数器'
      + '(oral/vaginal/anal today+total)。'
      + 'action=snap 读当前状态(markdown,含 stale 陈旧度鞭策,今日计数器跨天自动清零);'
      + 'action=update 写字段:fields 传 {字段: 值}。合法字段见白名单;'
      + '性状态可用 sex_state;计数器快捷累加传 incr_oral/incr_vaginal/incr_anal 为 true;'
      + '写 scene/outfit_*/sexual_items 会自动同步对应素材表 hit_count。',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['snap', 'update'],
        description: 'snap=读状态,update=写字段。',
      },
      fields: {
        type: 'json',
        description:
          'action=update 时的字段对象。合法字段:scene/truth/decision/position/body_state/behavior/'
          + 'sex_state/arousal/fatigue/companion_present/companion_role/outfit_top/outfit_bottom/'
          + 'outfit_bra/outfit_underwear/outfit_socks/outfit_footwear/outfit_hair/outfit_accessory/'
          + 'outfit_outerwear/sexual_items/oral_today/vaginal_today/anal_today/oral_total/vaginal_total/'
          + 'anal_total/last_sex_date,以及 incr_oral/incr_vaginal/incr_anal(布尔快捷+1)。',
      },
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args) {
      const now = new Date()
      return withDb(dbPath(), db => {
        if (args.action === 'snap') return runStateSnap(db, now)
        const fields = args.fields !== undefined && typeof args.fields === 'object' && args.fields !== null
          ? args.fields as Record<string, unknown>
          : {}
        return runStateUpdate(db, fields, now)
      })
    },
    presentCall(args) {
      const sub = args.action === 'snap' ? 'snap' : JSON.stringify(args.fields ?? {}).slice(0, 40)
      const kind = args.action === 'snap' ? 'read' : 'other'
      return { card: 'generic', title: `state ${args.action}`, kind, rawInput: sub }
    },
  })

  // 初始对齐：挂载时先按当前覆盖层决定开不开（默认关）。
  sync()
}
