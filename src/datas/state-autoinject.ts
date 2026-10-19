/**
 * datas/state-autoinject.ts — state 短条自动注入机制（两个入口，一个出口）。
 *
 * 不进 schema、不注册工具：preset 声明了 config.datas 桶就随取料工具一起生效，
 * 开关在设置页（覆盖层 `<root>/state/datas.json` 的 autoinject 字段）。
 *
 *   tools/result   → 命中 roroko_datas_* → 标记本会话该注入
 *   session/event  → 压缩（compaction/*）后置 forced：下一轮不再干等 N 轮
 *   agent/pre-step → injectOnce()：唯一出口，判定命中才追加到消息尾部
 *
 * 为什么挂 pre-step 而不是装配层：它是唯一拿得到 `turn` 的通道，且往
 * `decision.messages` 尾部追加只影响后缀 —— 不碰 system 段、不发 schema，
 * 不破 KV 前缀缓存（与 preinject 的消息段同一路数）。
 *
 * 头号纪律：**绝不在这里抛错**。pre-step 监听器抛异常会让整个 step proposal
 * 失败，读库失败、渲染异常一律内部吞掉。
 *
 * ── 0.2.1 适配 ──────────────────────────────────────────────────────────
 *   - 注入消息的 source 必须是生产者自有 kind：`{ kind: 'roroko-datas-autoinject' }`。
 *     v4 之后没有 catch-all 的 `plugin` kind，旧写法会被 session 格式拒掉。
 *   - preset id 同样靠 pre-step 记进实例变量（provider/写入侧都拿不到 session）。
 */
import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Row } from './query-form.js'
import { readDatasState, resolveDatas, type AutoinjectSettings, type DatasConfig } from './presets.js'
import {
  buildInjectText, clampMinGap, clampRounds, decide, isRorokoDatasTool, renderStateShort,
} from './state-autoinject-form.js'

/** 本模块注入消息的来源签名。 */
export const moduleName = 'roroko-datas-autoinject'

/**
 * 消息来源是 merge-extensible 的和类型：每个生产者在自己模块里声明自己的 kind。
 * v4 之后没有 catch-all 的 `plugin` kind，所以这里必须自己登记。
 */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'roroko-datas-autoinject': { kind: 'roroko-datas-autoinject' }
  }
}

/** 本会话的计数与标记（session 为键：子代理天然隔离，不会污染主会话）。 */
interface AutoinjectCounter {
  /** 上次实际注入的回合号（NaN = 从未）。 */
  lastTurn: number
  /** 本回合已注入过的回合号（NaN = 未注）。 */
  injectedTurn: number
  /** 本回合取过料（tools/result 命中）。 */
  pending: boolean
  /** 压缩释放：下一次轮数判定必然命中。 */
  forced: boolean
}

/** ctx 上本模块用到的最小面。 */
interface Surface {
  on(event: string, listener: (...args: any[]) => unknown): unknown
}

/** 取一条 state 行（只读；跨天清零的写侧归 state 刀，注入不改库）。 */
function readStateRow(dbPath: string): Row | undefined {
  const db = new DatabaseSync(dbPath)
  try {
    return db.prepare('SELECT * FROM soul_state WHERE id = 1').get() as unknown as Row | undefined
  } finally {
    db.close()
  }
}

/**
 * 注册自动注入机制。
 * @param ctx - preset scope 的子 fiber。
 * @param root - 身份根（覆盖层目录基准）。
 * @param config - preset 接线参数。
 * @param presetId - 本实例所在 preset id 的 getter（由 datas/index.ts 在 pre-step 里记）。
 */
export function applyStateAutoinject(
  ctx: Context,
  root: string,
  config: DatasConfig,
  presetId: () => string | undefined,
): void {
  const surface = ctx as unknown as Surface
  const counters = new WeakMap<object, AutoinjectCounter>()

  const settings = (): { autoinject: AutoinjectSettings; dbPath: string } =>
    resolveDatas(config, readDatasState(root), presetId())

  const counterOf = (session: object): AutoinjectCounter => {
    const existing = counters.get(session)
    if (existing !== undefined) return existing
    const fresh: AutoinjectCounter = {
      lastTurn: Number.NaN,
      injectedTurn: Number.NaN,
      pending: false,
      forced: false,
    }
    counters.set(session, fresh)
    return fresh
  }

  // 入口 1：取过料就标记（错误结果也算 —— 取过就是取过）。
  surface.on('tools/result', (exec: { name?: string; agent?: { session?: object } }) => {
    try {
      if (exec === undefined || !isRorokoDatasTool(exec.name)) return
      const session = exec.agent?.session
      if (session === undefined) return
      counterOf(session).pending = true
    } catch {
      // 观察者不该影响工具执行本身
    }
  })

  // 入口 2：压缩把短条甩掉后，别干等 N 轮 —— 置 forced，下一次 pre-step 立即注。
  surface.on('session/event', (session: object, event: { type?: string }) => {
    try {
      const type = String(event?.type ?? '')
      if (!type.startsWith('compaction/')) return
      const counter = counters.get(session)
      if (counter === undefined) return
      counter.forced = true
      console.log('[roroko-datas-autoinject] compaction → forced re-inject', type)
    } catch {
      // 同上
    }
  })

  // 唯一出口。
  surface.on('agent/pre-step', async (
    payload: { agent?: { session?: { id?: string; header?: { id?: string; agentPreset?: string } } }; turn: number },
    next: () => Promise<PreStepDecision>,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const session = payload.agent?.session
    if (session === undefined) return decision
    const counter = counterOf(session)

    try {
      const resolved = settings()
      const verdict = decide({
        turn: payload.turn,
        lastTurn: counter.lastTurn,
        injectedTurn: counter.injectedTurn,
        pending: counter.pending,
        forced: counter.forced,
        roundsEnabled: resolved.autoinject.rounds,
        afterToolEnabled: resolved.autoinject.afterTool,
        every: clampRounds(resolved.autoinject.every),
        minGap: clampMinGap(resolved.autoinject.minGap),
      })
      if (!verdict.inject) {
        // 被最短间隔（或闸门/开关）挡下 → 消耗掉这次工具触发，
        // 不让它挂到间隔开了才兑现（否则等于变相多出一条通道）
        counter.pending = false
        return decision
      }

      const row = readStateRow(resolved.dbPath)
      if (row === undefined) {
        console.log('[roroko-datas-autoinject] state 行不存在,跳过注入')
        counter.pending = false
        counter.forced = false
        return decision
      }

      const text = buildInjectText(renderStateShort(row, new Date()))
      const message = createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: moduleName },
      })

      // 记账：只有真注入才刷新（开关关掉时不刷新，关了就是关了）。
      counter.lastTurn = payload.turn
      counter.injectedTurn = payload.turn
      counter.pending = false
      counter.forced = false
      console.log('[roroko-datas-autoinject] inject', verdict.source ?? '-', 'turn', payload.turn,
        'chars', text.length)

      return { ...decision, messages: [...decision.messages, message] }
    } catch (error) {
      // 头号纪律：任何意外都吃掉，绝不把 pre-step 打崩。
      console.log('[roroko-datas-autoinject] skipped:', error instanceof Error ? error.message : String(error))
      return decision
    }
  })
}
