/**
 * roroko 记忆 dream 的纯逻辑:队列口径 / 任务书组装 / 门禁判定 / 审计渲染。
 *
 * 设计来源:`refs/notes/roroko-memory-design-v1.md` §七(第七刀 = 记忆系统的下游)+
 * `refs/notes/roroko-datas-dream-slice7-plan.md`(照抄 nanobot 的九步执行序)。
 *
 * 2026-09-21 会话化改写(阿一:光给它一段提示词"像啥也不知道的外人来弄"):
 *   - **不再让模型回 JSON** —— 改成起一个一次性会话,上下文由那个 preset 供
 *     (人设靠 preinject 注入的系统段、工具靠 preset 声明的插件行),模型自己
 *     `roroko_mem_id` 取全文、自己 `roroko_mem_edit` 改回去。
 *   - 因此任务书里**只给清单**(id / 时间 / 摘要),正文让它自己按需取 ——
 *     既省上下文,也逼它走一遍"取全文再改"的正路。
 *   - 门禁照旧:**只认 `reflected_at` 真落下去**(不认模型自述),另外统计
 *     会话前后桶内条数差 = 它自己 `add` 了几条(保留矛盾那条通道)。
 *
 * 本文件**不 import node 内置与 DSH 运行时包** —— 零依赖测试直读编译产物。
 */
import { MEMORY_CONTENT_MAX, type MemoryRow } from './memory-form.js'

/** 默认间隔:4 小时(照抄 nanobot 的 everyMs=14400000)。 */
export const DREAM_DEFAULT_INTERVAL_MS = 4 * 60 * 60 * 1000

/** 间隔下限:5 分钟(防手滑配成 0 秒把模型当风扇吹)。 */
export const DREAM_MIN_INTERVAL_MS = 5 * 60 * 1000

/** 间隔上限:24 小时。 */
export const DREAM_MAX_INTERVAL_MS = 24 * 60 * 60 * 1000

/** 一次取多少条(照抄 nanobot 的 max_entries=20)。 */
export const DREAM_DEFAULT_BATCH = 20

/** 批量上限。 */
export const DREAM_MAX_BATCH = 50

/** 清单里每条摘要的预览长度 —— 只够粗筛,正文要它自己取。 */
export const DREAM_PREVIEW_MAX = 120

/**
 * 分段定时器的每段长度:最多 1 小时醒一次,醒来自查墙钟到点没。
 * Node 的 timer 上限是 2147483647ms(约 24.8 天),分段是照抄 dsh-schedule 的做法。
 */
export const DREAM_TICK_MS = 60 * 60 * 1000

/**
 * 不进反思队列的 kind —— 历史日志(`kind=log`)是逐字入库的开发流水,
 * 再让模型逐条提炼一遍纯属白烧 token(2026-09-20 阿一拍)。
 */
export const DREAM_SKIP_KINDS: readonly string[] = ['log']

/** 审计落盘目录(相对库所在目录)。 */
export const DREAM_LOG_DIR = 'dream-log'

/**
 * 会话每次请求的 token 上限。
 * ⚠️ **必须够推理模型用**:`deepseek-v4-flash` 这类带 thinking 的模型会先把
 * reasoning 写完再吐正文,2048 会被 thinking 吃满 → 正文一个字都没有
 * (2026-09-20 在服务器上实测踩到,提到 8192 立刻通)。
 * 会话化之后它仍要传进 `agentOptions.maxTokens`,所以保留为常量。
 */
export const DREAM_DEFAULT_MAX_TOKENS = 8192

/**
 * dream 配置。默认**开着**但没配模型 —— 未配就每次静默跳过(照抄 nanobot 的
 * "默认开",隔离靠 preset 里换/关配置,不靠默认值)。
 */
export interface DreamConfig {
  enabled: boolean
  intervalMs: number
  batch: number
  provider: string
  model: string
  /** 用哪个 preset 起会话(空串 = 该部署的默认 preset)。 */
  preset: string
  /** 会话的工作目录(空串 = 进程 cwd)。 */
  cwd: string
}

/** dream 内置默认(preset 不传就用它)。 */
export const DREAM_DEFAULTS: DreamConfig = {
  enabled: true,
  intervalMs: DREAM_DEFAULT_INTERVAL_MS,
  batch: DREAM_DEFAULT_BATCH,
  provider: '',
  model: '',
  preset: '',
  cwd: '',
}

/**
 * 整数收窄:非数字/非有限值回落默认,越界夹到区间。
 * ⚠️ **空串必须回落默认而不是当 0** —— `Number('')` 是 0 不是 NaN,踩过一次:
 * 未提供的 intervalMs 会一路夹到下限,变成"每 5 分钟跑一次"(比设计勤 48 倍)。
 */
function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return fallback
    return Math.min(Math.max(Math.floor(raw), min), max)
  }
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text.length === 0) return fallback
  const value = Number(text)
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.floor(value), min), max)
}

/** dream 配置归一化:非法字段逐个回落默认,不抛。 */
export function normalizeDreamConfig(raw: unknown): DreamConfig {
  if (typeof raw !== 'object' || raw === null) return { ...DREAM_DEFAULTS }
  const value = raw as Record<string, unknown>
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DREAM_DEFAULTS.enabled,
    intervalMs: clampInt(value.intervalMs, DREAM_MIN_INTERVAL_MS, DREAM_MAX_INTERVAL_MS, DREAM_DEFAULTS.intervalMs),
    batch: clampInt(value.batch, 1, DREAM_MAX_BATCH, DREAM_DEFAULTS.batch),
    provider: typeof value.provider === 'string' ? value.provider.trim() : '',
    model: typeof value.model === 'string' ? value.model.trim() : '',
    preset: typeof value.preset === 'string' ? value.preset.trim() : '',
    cwd: typeof value.cwd === 'string' ? value.cwd.trim() : '',
  }
}

/** 队列筛选结果。 */
export interface DreamQueue {
  /** 本次要整理的条目(最久没反思的在前)。 */
  entries: MemoryRow[]
  /** 排除掉的日志条数(给回执说明用)。 */
  skippedLogs: number
}

/**
 * 队列口径:`reflected_at` 为空、不在跳过 kind 里,按 created_at 升序取前 limit 条。
 * 库里取回来时已按时间排好,这里只做过滤与截断 —— 纯函数,好测。
 */
export function pickQueue(rows: MemoryRow[], limit: number): DreamQueue {
  const fresh = rows.filter(row => {
    const reflected = row.reflected_at
    return reflected === null || reflected === undefined || reflected === ''
  })
  const entries = fresh.filter(row => !DREAM_SKIP_KINDS.includes(String(row.kind ?? '').toLowerCase()))
  const skippedLogs = fresh.length - entries.length
  return { entries: entries.slice(0, Math.max(1, limit)), skippedLogs }
}

/**
 * 组装任务书。**只给清单**(id / 时间 / 摘要预览),正文让模型自己用
 * `roroko_mem_id` 取、改完用 `roroko_mem_edit(op=reflect)` 覆盖回去。
 * 第一段是"记忆整理模式"声明 —— 这是阿一定的那句:让它知道现在不是对话/开发情景。
 */
export function buildDreamTask(entries: MemoryRow[]): string {
  const head = [
    '现在进入**记忆整理模式**。',
    '- 这不是对话,也不是开发:不要回应任何人的话,不要动工作区文件,不要开 shell,不要上网。',
    '- 只做一件事:看下面这份待整理清单(它来自你自己的记忆库),判断哪几条记得太啰嗦、',
    '  措辞不准、或该收敛结论。',
    '- 对要改的:先用 `roroko_mem_id` 取全文,再用 `roroko_mem_edit`(op=reflect)把改写后的',
    '  **完整正文**覆盖回去(summary 一起给就一起换)。',
    '- 不值得改的就跳过 —— **一条都不改也是正常结果**。改完给一行结论就停。',
    '- **观点变了或出现矛盾时不要抹平**:用 op=add 另记一条,保留矛盾。',
    '',
    `## 待整理清单(共 ${entries.length} 条,按时间升序)`,
  ]
  const lines = entries.map(row => {
    const summary = String(row.summary ?? '').replaceAll('\n', ' ')
    const preview = summary.length > DREAM_PREVIEW_MAX ? `${summary.slice(0, DREAM_PREVIEW_MAX)}…` : summary
    const kind = row.kind === null || row.kind === undefined || String(row.kind).length === 0 ? '' : ` · ${String(row.kind)}`
    return `- #${row.id} · ${row.created_at}${kind} · ${preview}`
  })
  return [...head, ...lines].join('\n')
}

/**
 * 门禁:比对写回前后的 `reflected_at`,只认真落下去的那些(照抄 nanobot 的
 * "审计只认 diff,不认模型自述")。返回真变了的 id。
 */
export function diffReflected(before: MemoryRow[], after: MemoryRow[]): number[] {
  const wasUnreflected = new Map<number, boolean>()
  for (const row of before) {
    wasUnreflected.set(Number(row.id), row.reflected_at === null || row.reflected_at === undefined || row.reflected_at === '')
  }
  const changed: number[] = []
  for (const row of after) {
    const id = Number(row.id)
    if (wasUnreflected.get(id) !== true) continue
    const reflected = row.reflected_at
    if (reflected !== null && reflected !== undefined && reflected !== '') changed.push(id)
  }
  return changed
}

/** 一次 dream 的结果(给状态与审计用)。 */
export interface DreamOutcome {
  /** 队列里有多少条(不含跳过的日志)。 */
  queued: number
  /** 排除了多少条日志。 */
  skippedLogs: number
  /** 本次会话的 id(空串 = 压根没起会话)。 */
  sessionId: string
  /** 会话挂上的 preset(空串 = 没挂)。 */
  preset: string
  /** 会话自己 add 了几条(桶内条数差;≥0)。 */
  added: number
  /** 真写进库并落了 reflected_at 的 id。 */
  changed: number[]
  /** 一句话结论。 */
  note: string
}

/** 渲染一次 dream 的回执/状态。 */
export function renderDreamOutcome(outcome: DreamOutcome): string {
  const lines = [
    `dream: ${outcome.note}`,
    `队列 ${outcome.queued} 条(跳过日志 ${outcome.skippedLogs} 条)· 真反思 ${outcome.changed.length} 条 · 自记 ${outcome.added} 条`,
  ]
  if (outcome.sessionId.length > 0) {
    lines.push(`会话 ${outcome.sessionId}${outcome.preset.length > 0 ? ` · preset=${outcome.preset}` : ' · 未挂 preset'}`)
  }
  if (outcome.changed.length > 0) lines.push(`已反思: ${outcome.changed.map(id => `#${id}`).join(' ')}`)
  return lines.join('\n')
}

/**
 * 审计正文 —— **只记事实 diff,不记模型自述**(照抄 nanobot D12:
 * "the audit record reflects the filesystem's truth, not the model's self-report")。
 */
export function renderDreamAudit(input: {
  at: string
  provider: string
  model: string
  sessionId: string
  preset: string
  queued: number
  skippedLogs: number
  added: number
  changed: number[]
  before: MemoryRow[]
  after: MemoryRow[]
  error?: string
}): string {
  const beforeChars = new Map<number, number>()
  for (const row of input.before) beforeChars.set(Number(row.id), String(row.content ?? '').length)
  const lines = [
    `# dream ${input.at} CST`,
    '',
    `provider/model: ${input.provider} / ${input.model}`,
    input.sessionId.length > 0
      ? `会话: ${input.sessionId}${input.preset.length > 0 ? ` · preset=${input.preset}` : ' · 未挂 preset'}`
      : '会话: (未起)',
    `队列 ${input.queued} 条(跳过日志 ${input.skippedLogs} 条)· 真反思 ${input.changed.length} 条 · 自记 ${input.added} 条`,
  ]
  if (input.error !== undefined) lines.push('', `error: ${input.error}`)
  if (input.changed.length > 0) {
    lines.push('', '| id | 字数 旧 → 新 |', '|---|---|')
    for (const row of input.after) {
      const id = Number(row.id)
      if (!input.changed.includes(id)) continue
      lines.push(`| ${id} | ${beforeChars.get(id) ?? '?'} → ${String(row.content ?? '').length} |`)
    }
  }
  return lines.join('\n')
}

/** 内容上限(与 add 共用同一把尺,渲染说明里用得到)。 */
export { MEMORY_CONTENT_MAX }
