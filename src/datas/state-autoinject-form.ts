/**
 * datas/state-autoinject-form.ts — state 自动注入的纯逻辑(可离线测)。
 *
 * 本文件不碰 DB、不碰 cordis、不碰日志:只做「判定要不要注」与「短条怎么长」。
 * 挂点与注入动作在 state-autoinject.ts。
 *
 * 三条硬规则(设计稿 §5,落成这里的 decide):
 *   1. 来源「工具后」注入后刷新来源「轮数」的计数 —— 一次交互只注一条;
 *   2. 同一 turn 只注一次(兜底闸门,两个开关全开也安全);
 *   3. 只有实际注入才刷新计数(调用方只在 inject=true 时改计数)。
 *
 * 拍板(2026-09-16 阿一):内容不去重(触发即注);短条含 truth/decision/behavior;
 * **不做字数截断**(先不限,后面再调);口径照抄 nanobot(「黑川不可见也不知情」)。
 */
import type { Row } from './query-form.js'

/** 轮数阈值默认值(面板可改)。 */
export const AutoinjectDefaultRounds = 8

/** 注入来源:轮数触发 / 工具调用后触发。 */
export type InjectSource = 'rounds' | 'after-tool'

/** 触发判定输入(全部显式传入,便于离线复现)。 */
export interface AutoinjectDecideInput {
  /** 本步所在回合号(agent/pre-step 的 payload.turn)。 */
  turn: number
  /** 上次实际注入的回合号;从未注入过传 Number.NaN。 */
  lastTurn: number
  /** 本回合已经注入过的回合号(兜底闸门);从未注入过传 Number.NaN。 */
  injectedTurn: number
  /** 本回合有 roroko_datas_* 工具执行过。 */
  pending: boolean
  /** 压缩释放:下一次必然注入(仍受轮数开关约束)。 */
  forced: boolean
  roundsEnabled: boolean
  afterToolEnabled: boolean
  /** 轮数阈值。 */
  every: number
}

/** 判定结果:要不要注、以哪个来源注。 */
export interface AutoinjectDecision {
  inject: boolean
  source: InjectSource | null
}

/** 轮数阈值收窄:整数、1~200,非法值回落默认。 */
export function clampRounds(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return AutoinjectDefaultRounds
  const int = Math.trunc(n)
  if (int < 1) return 1
  if (int > 200) return 200
  return int
}

/** 本地日期戳(YYYY-MM-DD)。禁用 toISOString —— 那是 UTC,会差 8 小时。 */
export function todayStamp(now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 轮数是否到期:从未注过(NaN)视为到期。 */
export function dueByRounds(turn: number, lastTurn: number, every: number): boolean {
  if (!Number.isFinite(lastTurn)) return true
  const gap = Number.isFinite(turn) ? turn - lastTurn : 0
  return gap >= clampRounds(every)
}

/** 工具名是否属于取料工具族(机制本身不注册工具,不会被自己的监听器命中)。 */
export function isRorokoDatasTool(name: unknown): boolean {
  return typeof name === 'string' && name.startsWith('roroko_datas_')
}

/**
 * 唯一判定出口。优先级:闸门 → 压缩释放 → 工具后 → 轮数。
 * 同一 turn 已注过则一律不注(哪怕 forced)。
 */
export function decide(input: AutoinjectDecideInput): AutoinjectDecision {
  if (Number.isFinite(input.injectedTurn) && input.injectedTurn === input.turn) {
    return { inject: false, source: null }
  }
  if (input.forced && input.roundsEnabled) return { inject: true, source: 'rounds' }
  if (input.pending && input.afterToolEnabled) return { inject: true, source: 'after-tool' }
  if (input.roundsEnabled && dueByRounds(input.turn, input.lastTurn, input.every)) {
    return { inject: true, source: 'rounds' }
  }
  return { inject: false, source: null }
}

/** 字段取值:空/「无」/空数组一律当没有(与 snap 的 display 同一口径)。 */
function fieldValue(row: Row, key: string): string {
  const raw = row[key]
  if (raw === undefined || raw === null) return ''
  const text = String(raw).trim()
  if (text.length === 0 || text === '无' || text === '[]') return ''
  return text.replaceAll('|', '/')
}

/**
 * 计数器当日值:库里的 last_daily_reset 不是今天 → 当日计数按 0 显示。
 * 这里**只读不写**:跨天清零的写侧归 state 刀,注入不该改库。
 */
export function counterToday(row: Row, base: string, today: string): number {
  const stamp = String(row.last_daily_reset ?? '').trim()
  if (stamp !== today) return 0
  return Number(row[`${base}_today`] ?? 0)
}

/**
 * 渲染短条。段序固定:叙事 → 计数 → 着装。
 * 2026-09-16 阿一拍板:**不限字数**(先让状态说全,长度后面再调)——
 * 曾试过 150 字上限,生产库实测一项 position 就 34 字,当场被砍掉着装与计数器。
 */
export function renderStateShort(row: Row, now: Date): string {
  const today = todayStamp(now)
  const parts: string[] = []
  const push = (key: string): void => {
    const value = fieldValue(row, key)
    if (value.length > 0) parts.push(`${key}=${value}`)
  }
  push('scene')
  push('truth')
  push('decision')
  push('position')
  push('body_state')
  push('behavior')
  push('arousal')

  const counters = ['oral', 'vaginal', 'anal']
    .map(base => `${base} ${counterToday(row, base, today)}/${Number(row[`${base}_total`] ?? 0)}`)
    .join(' · ')
  parts.push(`计 ${counters}`)

  const outfit = ['outfit_top', 'outfit_bottom', 'outfit_bra', 'outfit_underwear']
    .map(key => fieldValue(row, key))
    .filter(value => value.length > 0)
  if (outfit.length > 0) parts.push(`着装=${outfit.join('/')}`)

  return `[state] ${parts.join(' | ')}`
}

/** 注入壳:照抄 nanobot 口径(黑川不可见也不知情 —— 只看她说出口的)。 */
export const AutoinjectNotice = [
  '###下方内容由脚本自动注入###',
  'roroko_datas_state（黑川不可见也不知情，他只知道姐姐在消息里说出口的内容）:',
].join('\n')

/** 拼最终注入文本。 */
export function buildInjectText(short: string): string {
  return `${AutoinjectNotice} ${short}`
}
