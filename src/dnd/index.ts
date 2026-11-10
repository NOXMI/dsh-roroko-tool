/**
 * dnd — 跑团子模块挂载口（掷骰 / 队伍 / 改数值 三把工具 + 桥插件）。
 *
 * 职责边界：**只管 DSH 侧的会话**。房间、玩家、消息组合、广播全在
 * gateway.py 那边 —— 这里只知道「有人塞进来一段文本」和「我回了一段文本」。
 *
 * 通讯：作为 WS 客户端连 gateway（默认 ws://127.0.0.1:8792?role=bridge）。
 *   inject → agents.create / followup → whenIdle → 取最后一条 assistant → reply
 * 除这两条命令外，本模块什么都不接。房间逻辑一行都不进来。
 *
 * 数值归代码：骰子在这里掷，HP 在这里改，模型只写叙事。
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { openBridge, type Bridge, type InjectFrame } from './bridge.js'
import { DND_DEFAULTS, readDndState, resolveDnd } from './presets.js'
import { registerDndMount } from '../state.js'

export type { DndBucket, DndConfig, DndState } from './presets.js'
export {
  COMMON, DND_COMMON, DND_DEFAULTS, clearDndBucket, dndStateFile,
  readDndState, resolveDnd, setDndBucket,
} from './presets.js'

/** 子模块标识：只用于日志与消息来源签名，不是独立插件。 */
export const moduleName = 'roroko-dnd'

/**
 * 当前活跃房间：**桥写、工具读**。
 *
 * 桥（profile 层）与工具（preset 层）是同一进程里的两个实例，各自的实例变量
 * 互相看不见 —— 所以这个必须放在模块级共享。同一时刻只有一个房间在跑
 * （见设计里的硬约束），后一次 inject 覆盖前一次是可接受的。
 */
let sharedRoom: string | undefined

const dshHome = (): string => process.env.DSH_HOME ?? join(homedir(), '.dsh')

export function defaultRoot(): string {
  return join(dshHome(), 'roroko_DND')
}

/** ctx 上本模块用到的最小面。 */
interface Surface {
  tools: { register(definition: unknown): () => void }
  effect(callback: () => unknown, label?: string): unknown
  on(event: string, listener: (...args: any[]) => unknown): unknown
}

/** 跨 scope 递进来的服务句柄（host 层先握在手里）。 */
export interface AgentBag {
  agents?: {
    create(options: unknown): Promise<AgentHandle>
  }
  presets?: {
    resolve(id: string): Promise<{ id: string } | undefined>
    mount(ctx: unknown, id: string): Promise<unknown>
  }
}

interface AgentHandle {
  agent: {
    followup(message: unknown): void
    whenIdle(): Promise<void>
    session: unknown
  }
  dispose?(): void
}

function textRender(_args: unknown, value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/** json 数组转字符串数组（坏数据当空）。 */
function asList(value: unknown): string[] {
  try {
    const parsed: unknown = JSON.parse(String(value ?? '[]'))
    return Array.isArray(parsed) ? parsed.map(item => String(item)) : []
  } catch {
    return []
  }
}

/** 物品栏 json 转「长剑×1、火把×3」。 */
function asItems(value: unknown): string {
  try {
    const parsed: unknown = JSON.parse(String(value ?? '[]'))
    if (!Array.isArray(parsed) || parsed.length === 0) return '—'
    return parsed
      .map((item) => {
        const bag = item as { name?: unknown; qty?: unknown }
        const qty = Number(bag.qty)
        const name = String(bag.name ?? '?')
        return qty > 1 ? `${name}×${qty}` : name
      })
      .join('、')
  } catch {
    return '—'
  }
}

function withDb<T>(dbPath: string, fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(dbPath)
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

const DICE = /^(\d{0,2})[dD](\d{1,4})([+-]\d{1,3})?$/

/** 掷骰：本地真随机。支持 NdM+K，N 缺省 1。 */
export function rollDice(expr: string): {
  n: number
  sides: number
  mod: number
  dice: number[]
  total: number
} | null {
  const text = expr.replace(/\s+/g, '')
  const matched = DICE.exec(text)
  if (!matched) return null
  const n = Math.min(Number(matched[1] || 1), 50)
  const sides = Math.min(Number(matched[2]), 1000)
  const mod = matched[3] ? Number(matched[3]) : 0
  if (n < 1 || sides < 2) return null
  const dice: number[] = []
  for (let index = 0; index < n; index += 1) dice.push(1 + Math.floor(Math.random() * sides))
  const total = dice.reduce((sum, value) => sum + value, 0) + mod
  return { n, sides, mod, dice, total }
}

/** 桥插件这边要知道"这一轮在哪个房间"：最后一次 inject 带进来的那个。 */
interface Peer {
  handle: AgentHandle
  queue: Array<{ round: number; text: string }>
  busy: boolean
}

export interface DndServices {
  agents?: unknown
  presets?: unknown
}

/**
 * 挂载本子模块。由 host 在自己的 ctx 上调用，不单独占一行插件。
 * @param ctx - 宿主上下文（preset scope 里的子 fiber）。
 * @param rawConfig - 子模块配置（preset 的 config.dnd）。
 * @param getServices - 取 host 层递进来的 agent / preset 服务句柄。
 */
export function mount(
  ctx: Context,
  rawConfig: import('./presets.js').DndConfig = {},
  getServices: () => DndServices = () => ({}),
): () => void {
  const surface = ctx as unknown as Surface
  const config = { ...rawConfig }
  const log = (...args: unknown[]): void => {
    if (config.log === false) return
    console.log('[roroko-dnd]', ...args)
  }

  const dbPath = (): string =>
    config.dbPath && config.dbPath.trim().length > 0
      ? config.dbPath.trim()
      : (DND_DEFAULTS.dbPath as string)

  /** 每个房间一个常驻会话，与 qq-gateway 的 peers 同构。 */
  const peers = new Map<string, Peer>()
  const disposers: Array<() => void> = []

  // ── 会话 ───────────────────────────────────────────────────
  let createUserMessage: ((input: unknown) => unknown) | undefined
  import('@deepseek-ai/dsh-llm')
    .then((mod) => {
      createUserMessage = (mod as { createUserMessage?: (input: unknown) => unknown }).createUserMessage
    })
    .catch(() => {
      log('dsh-llm 取不到 createUserMessage，改用手工结构')
    })

  function buildUserMessage(text: string): unknown {
    const source = { kind: 'roroko-dnd' }
    if (createUserMessage) {
      try {
        return createUserMessage({ content: [{ type: 'text', text }], source })
      } catch {
        // 落到手工结构
      }
    }
    return { role: 'user', content: [{ type: 'text', text }], source }
  }

  async function ensurePeer(room: string): Promise<Peer> {
    const existing = peers.get(room)
    if (existing) return existing
    const services = getServices() as AgentBag
    const agents = services.agents
    if (!agents) throw new Error('agents 服务没就绪，桥插件暂时建不了会话')
    const presets = services.presets
    let preset: { id: string } | undefined
    try {
      preset = presets && config.preset ? await presets.resolve(config.preset) : undefined
    } catch (error) {
      log('preset 解析失败', error instanceof Error ? error.message : String(error))
    }
    const sessionId = `dnd-${room}-${Date.now().toString(36)}`
    const handle = await agents.create({
      sessionId,
      meta: { cwd: config.cwd ?? process.cwd(), ...(preset ? { agentPreset: preset.id } : {}) },
      agentOptions: {
        ...(config.provider ? { provider: config.provider } : {}),
        ...(config.model ? { model: config.model } : {}),
        ...(config.maxTokens ? { maxTokens: config.maxTokens } : {}),
      },
      setup: async (agentCtx: unknown): Promise<void> => {
        if (preset && presets) await presets.mount(agentCtx, preset.id)
      },
    })
    const peer: Peer = { handle, queue: [], busy: false }
    peers.set(room, peer)
    log('会话已建立', sessionId, 'preset=' + (preset?.id ?? '(默认)'))
    return peer
  }

  /** 从任意形状里挖出最后一个文本块（chunk 流 / message / content 都吃）。 */
  function digText(node: unknown, depth = 0): string {
    if (!node || depth > 7) return ''
    if (Array.isArray(node)) {
      for (let index = node.length - 1; index >= 0; index -= 1) {
        const found = digText(node[index], depth + 1)
        if (found) return found
      }
      return ''
    }
    if (typeof node !== 'object') return ''
    const bag = node as Record<string, unknown>
    if (bag.type === 'text' && typeof bag.text === 'string' && bag.text.trim()) return bag.text
    if (bag.type === 'reasoning') return ''
    for (const key of ['block', 'message', 'content', 'chunk', 'data', 'blocks', 'items', 'response']) {
      if (key in bag) {
        const found = digText(bag[key], depth + 1)
        if (found) return found
      }
    }
    return ''
  }

  /** 倒查最后一条 assistant 文本：先走官方 derive，再退到底层事件里挖。 */
  function lastAssistantText(session: unknown): string {
    let events: unknown[] = []
    try {
      const reader = session as { ownEvents?: () => unknown[] }
      events = reader.ownEvents?.() ?? []
    } catch {
      events = []
    }
    if (!events.length) {
      log('session.ownEvents() 空，取不到回复')
      return ''
    }

    const derive = (session as { deriveEventMessage?: (ev: unknown) => unknown }).deriveEventMessage
    if (typeof derive === 'function') {
      for (let index = events.length - 1; index >= 0; index -= 1) {
        let message: { role?: string; content?: unknown[] } | null = null
        try {
          message = (derive(events[index]) ?? null) as { role?: string; content?: unknown[] } | null
        } catch {
          message = null
        }
        if (!message || message.role !== 'assistant') continue
        const joined = (message.content ?? [])
          .filter((block) => (block as { type?: string })?.type === 'text')
          .map((block) => String((block as { text?: unknown }).text ?? ''))
          .join('\n')
          .trim()
        if (joined) return joined
      }
    }

    // derive 不认（chunk 流式写入的回复），退到底层 events 里挖
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const found = digText(events[index]).trim()
      if (found) {
        log('derive 取不到，从 events 里挖到回复', found.length + '字')
        return found
      }
    }
    const types = new Map<string, number>()
    for (const event of events) {
      const kind = String((event as { type?: unknown })?.type ?? '?')
      types.set(kind, (types.get(kind) ?? 0) + 1)
    }
    log('事件里挖不到文本', events.length, [...types.entries()].map(([k, v]) => `${k}:${v}`).join(' '))
    return ''
  }

  async function drain(room: string): Promise<void> {
    const peer = peers.get(room)
    if (!peer || peer.busy) return
    peer.busy = true
    try {
      while (peer.queue.length) {
        const job = peer.queue.shift()
        if (!job) break
        const startedAt = Date.now()
        try {
          peer.handle.agent.followup(buildUserMessage(job.text))
          await peer.handle.agent.whenIdle()
          const reply = lastAssistantText(peer.handle.agent.session)
          bridge?.send({
            cmd: 'reply',
            room,
            round: job.round,
            text: reply,
            ms: Date.now() - startedAt,
          })
          log('一轮完成', room, 'round=' + job.round, Date.now() - startedAt + 'ms')
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          bridge?.send({ cmd: 'error', room, round: job.round, msg })
          log('这一轮炸了', room, msg)
        }
      }
    } finally {
      peer.busy = false
    }
  }

  function onInject(frame: InjectFrame): void {
    const room = String(frame.room ?? '')
    const round = Number(frame.round ?? 0)
    const text = String(frame.text ?? '')
    if (!room || !text) return
    sharedRoom = room
    ensurePeer(room)
      .then((peer) => {
        peer.queue.push({ round, text })
        drain(room).catch((error) => log('drain 失败', error instanceof Error ? error.message : String(error)))
      })
      .catch((error) => {
        const msg = error instanceof Error ? error.message : String(error)
        bridge?.send({ cmd: 'error', room, round, msg })
        log('建会话失败', msg)
      })
  }

  // ── 桥 ─────────────────────────────────────────────────────
  let bridge: Bridge | undefined

  /** 起桥。总开关关着时走不到这里。 */
  function startBridge(): void {
    if (bridge !== undefined || config.bridge === false) return
    const base = typeof config.bridge === 'string' && config.bridge.trim().length > 0
      ? config.bridge.trim()
      : 'ws://127.0.0.1:8792'
    let url: string
    try {
      const parsed = new URL(base)
      parsed.searchParams.set('role', 'bridge')
      const token = config.token ?? process.env.ROROKO_DND_TOKEN ?? ''
      if (token) parsed.searchParams.set('token', token)
      url = parsed.toString()
    } catch {
      url = base
    }
    bridge = openBridge(url, { onInject, log: (...args) => log(...args) })
    disposers.push(() => {
      bridge?.close()
      bridge = undefined
    })
  }

  // ── 工具 ───────────────────────────────────────────────────
  const rollTool = defineTool({
    name: 'dnd_roll',
    description:
      '掷骰：本地真随机，服务端算。支持 NdM+K（如 d20 / 2d6+3 / 8d6）。'
      + '所有需要随机性的检定、命中、伤害、豁免都必须调这里，不许自己报数。',
    parameters: {
      expr: { type: 'string', required: true, description: '骰式，如 "d20" / "2d6+3" / "8d6"。' },
      why: { type: 'string', description: '为什么掷（检定名 / 谁在打什么），写进日志。' },
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args: { expr: string; why?: string }) {
      const result = rollDice(String(args.expr ?? ''))
      if (!result) return `骰式看不懂：${args.expr}（要 NdM+K 的形状）`
      const detail = result.dice.join(' + ')
      const mod = result.mod === 0 ? '' : result.mod > 0 ? ` + ${result.mod}` : ` - ${Math.abs(result.mod)}`
      const head = args.why ? `${args.why}\n` : ''
      return `${head}${result.n}d${result.sides}${result.mod === 0 ? '' : (result.mod > 0 ? '+' + result.mod : result.mod)} = [${detail}]${mod} → **${result.total}**`
    },
    presentCall(args: { expr: string; why?: string }) {
      return { card: 'generic', title: `掷骰 ${args.expr}`, kind: 'other', rawInput: args.why ?? args.expr }
    },
  })

  const partyTool = defineTool({
    name: 'dnd_party',
    description: '读当前房间的全员角色卡（属性与调整值 / HP / AC / 条件 / 手持 / 经验），裁定前先看这个，别凭记忆。',
    parameters: {},
    output: { schema: { type: 'string' }, render: textRender },
    async execute() {
      const room = sharedRoom
      if (!room) return '当前没有活跃房间：等 gateway 塞进来一轮行动先。'
      const path = dbPath()
      if (!existsSync(path)) return `库还没建：${path}`
      try {
        return withDb(path, (db) => {
          const rows = db
            .prepare(
              'SELECT name, race, class, level, hp, hp_max, hp_temp, ac, exhaustion, conditions, concentration,'
              + ' str, dex, con, int_, wis, cha,'
              + ' str_mod, dex_mod, con_mod, int_mod, wis_mod, cha_mod, prof_bonus, inventory, xp'
              + ' FROM v_characters WHERE room_id = ? ORDER BY id',
            )
            .all(room) as Array<Record<string, unknown>>
          if (!rows.length) return `房间 ${room} 里还没人捏角色。`
          const head = '| 角色 | 种族/职业 | 等级 | HP | AC | 六属性（调整） | 熟练 | 状态 | 手持 | XP |'
          const line = '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
          const body = rows.map((row) => {
            const attrs = [
              [row.str, row.str_mod], [row.dex, row.dex_mod], [row.con, row.con_mod],
              [row.int_, row.int_mod], [row.wis, row.wis_mod], [row.cha, row.cha_mod],
            ]
              .map(([score, mod]) => `${score}(${Number(mod) >= 0 ? '+' : ''}${mod})`)
              .join(' ')
            const hp = `${row.hp}/${row.hp_max}${Number(row.hp_temp) > 0 ? `+${row.hp_temp}` : ''}`
            const marks = [
              ...asList(row.conditions),
              Number(row.exhaustion) > 0 ? `力竭${row.exhaustion}` : '',
              row.concentration ? `专注:${row.concentration}` : '',
            ].filter(Boolean)
            return `| ${row.name} | ${row.race ?? '?'}/${row.class ?? '?'} | ${row.level} | ${hp} | ${row.ac}`
              + ` | ${attrs} | +${row.prof_bonus} | ${marks.length ? marks.join('、') : '—'}`
              + ` | ${asItems(row.inventory)} | ${row.xp} |`
          })
          return ['## 队伍 · ' + room, '', head, line, ...body].join('\n')
        })
      } catch (error) {
        return '读库失败：' + (error instanceof Error ? error.message : String(error))
      }
    },
    presentCall() {
      return { card: 'generic', title: '看队伍状态', kind: 'read' }
    },
  })

  const APPLY_FIELDS = ['hp', 'hp_max', 'ac', 'level', 'xp', 'inventory', 'spells', 'skills', 'name'] as const

  const applyTool = defineTool({
    name: 'dnd_apply',
    description:
      '改角色卡：HP / 上限 / AC / 等级 / 经验 / 物品 / 法术 / 技能。'
      + '数值变化一律走这里落库，叙事里说的数字要和库里一致。',
    parameters: {
      character: { type: 'string', required: true, description: '角色名（同名取第一个）。' },
      patch: { type: 'json', required: true, description: '要改的字段对象，如 {"hp":12}。' },
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args: { character: string; patch: unknown }) {
      const room = sharedRoom
      if (!room) return '当前没有活跃房间，改不了。'
      const path = dbPath()
      if (!existsSync(path)) return `库还没建：${path}`
      const patch = (args.patch ?? {}) as Record<string, unknown>
      const keys = Object.keys(patch).filter((key) => (APPLY_FIELDS as readonly string[]).includes(key))
      if (!keys.length) return '可改字段：' + APPLY_FIELDS.join(' / ')
      try {
        return withDb(path, (db) => {
          const target = db
            .prepare('SELECT id FROM characters WHERE room_id = ? AND name = ? LIMIT 1')
            .get(room, String(args.character)) as { id?: number } | undefined
          if (!target?.id) return `房间 ${room} 里没有叫「${args.character}」的角色。`
          const sets = keys.map((key) => `${key} = ?`).join(', ')
          const values = keys.map((key) => {
            const value = patch[key]
            return Array.isArray(value) || (value !== null && typeof value === 'object')
              ? JSON.stringify(value)
              : (value as string | number | null)
          })
          db.prepare(`UPDATE characters SET ${sets} WHERE id = ?`).run(...values, target.id)
          const after = db
            .prepare('SELECT name, hp, hp_max, ac, level, xp FROM characters WHERE id = ?')
            .get(target.id) as Record<string, unknown>
          return `已更新 ${after.name}：HP ${after.hp}/${after.hp_max} · AC ${after.ac} · ${after.level} 级 · XP ${after.xp}`
        })
      } catch (error) {
        return '写库失败：' + (error instanceof Error ? error.message : String(error))
      }
    },
    presentCall(args: { character: string; patch?: unknown }) {
      return { card: 'generic', title: `改 ${args.character}`, kind: 'edit', rawInput: JSON.stringify(args.patch) }
    },
  })

  // ── 总开关（按 preset 分桶）───────────────────────────────
  // 一个开关管整个子模块：工具 + 桥。默认关，哪个 preset 想开就在自己的桶里
  // 覆盖。关掉只是撤下工具、断开桥，dnd.db 与 IDENTITY.md 一个字节不碰。
  const root = config.root !== undefined && config.root.trim().length > 0
    ? config.root.trim()
    : defaultRoot()
  let started = false
  /** 本实例最近一次见到的 preset id（工具侧靠它选桶）。 */
  let activePreset: string | undefined

  /** 开：按 tools / bridge 两个接线开关分别挂。 */
  const start = (): void => {
    if (started) return
    started = true
    if (config.tools !== false) {
      disposers.push(surface.tools.register(rollTool))
      disposers.push(surface.tools.register(partyTool))
      disposers.push(surface.tools.register(applyTool))
    }
    startBridge()
    log('开 → 工具' + (config.tools === false ? '关' : '三把已注册') + '，桥=' + (bridge ? '连' : '关'))
  }

  /** 关：撤工具、断桥、清会话。库与人格文件原样留着。 */
  const stop = (): void => {
    if (!started) return
    started = false
    for (const dispose of disposers.splice(0).reverse()) {
      try {
        dispose()
      } catch (error) {
        log('stop:', error instanceof Error ? error.message : String(error))
      }
    }
    for (const peer of peers.values()) {
      try {
        peer.handle.dispose?.()
      } catch {
      }
    }
    peers.clear()
    log('关 → 工具撤下、桥断开')
  }

  /** 这个实例该读哪个桶：工具侧跟着会话的 preset 走，桥侧用配置里那个。 */
  const scopedPreset = (): string | undefined => activePreset ?? config.preset

  /** 读开关对齐一次（幂等，状态没变就什么都不做）。 */
  const sync = (): void => {
    let on = false
    try {
      on = config.enabled === false ? false : resolveDnd(readDndState(root), scopedPreset()).enabled
    } catch (error) {
      log('读开关失败，保持现状', error instanceof Error ? error.message : String(error))
      return
    }
    if (on) start()
    else stop()
  }

  // 工具侧要知道自己在替哪个 preset 干活 —— 桶名就是 preset id。
  surface.on('agent/pre-step', (
    payload: { agent?: { session?: { header?: { agentPreset?: string } } } },
    next: () => Promise<unknown>,
  ) => {
    const id = payload.agent?.session?.header?.agentPreset
    if (id !== undefined) activePreset = id
    sync()
    return next()
  })
  surface.on('agent/created', (payload: { agent?: { session?: { header?: { agentPreset?: string } } } }) => {
    const id = payload.agent?.session?.header?.agentPreset
    if (id !== undefined) activePreset = id
    sync()
  })

  surface.effect(() => registerDndMount({ root, config }), 'dnd.status()')
  // 轮询兜底：profile 层的桥实例收不分桶、也未必收得到 agent 事件，
  // 两份实例读同一份 state 文件最不容易漏。
  const timer = setInterval(sync, 3000)
  surface.effect(
    () => () => {
      clearInterval(timer)
      stop()
    },
    'roroko-dnd: 总开关',
  )
  sync()

  return stop
}
