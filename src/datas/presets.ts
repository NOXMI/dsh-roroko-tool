/**
 * datas/presets.ts — 素材库参数的持久化：按 agent preset 分桶的覆盖层。
 *
 * 存储：`<root>/state/datas.json`，结构与 preinject.json 同形但**分文件**：
 *
 *   { "presets": { "common": { "dbPath": "...", "autoinject": { … } }, "roroko": { … } } }
 *
 * 分文件是刻意的：preinject 管「注入什么文件」，datas 管「连哪个库、多久注一次
 * 状态」，两套键混一个文件下个月没人看得懂。
 *
 * 合成链（逐字段回落，缺字段才算未覆盖）：
 *
 *   内置默认 ← preset 接线 config ← 公共桶 common ← 分 preset 桶
 *
 * 读写模式照抄 preinject：读同步（pre-step 里要用）、写原子（临时文件 + rename）、
 * 坏文件当没有。
 */
import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** 公共默认桶名。 */
export const COMMON = 'common'

/** 服务器默认库路径（0.1.6 一贯口径）。 */
export const DEFAULT_DB_PATH = '/var/www/api/database/soul.db'

/** state 自动注入的开关与节奏。 */
export interface AutoinjectSettings {
  /** 轮数触发总开关。 */
  rounds: boolean
  /** 每 N 轮注一次。 */
  every: number
  /** 取过料后注入。 */
  afterTool: boolean
  /** 两次注入之间至少隔 N 轮（0 = 不限制）。 */
  minGap: number
}

/** 内置默认（最底层）。 */
export const AUTOINJECT_DEFAULTS: AutoinjectSettings = {
  rounds: true,
  every: 8,
  afterTool: true,
  minGap: 4,
}

/** 接线参数（preset 的 config.datas）。 */
export interface DatasConfig {
  /** false 时不挂载本模块。 */
  enabled?: boolean
  /** 身份根（覆盖层目录的基准），默认 $DSH_HOME/roroko。 */
  root?: string
  /** soul.db 路径。 */
  dbPath?: string
  /** state 自动注入。 */
  autoinject?: Partial<AutoinjectSettings>
}

/** 一个桶里能覆盖的字段（autoinject 逐字段叠加，不是整组替换）。 */
export interface DatasBucket {
  /** 总开关：false/未设 = 不注册四把工具、不注入 state 短条。 */
  enabled?: boolean
  dbPath?: string
  autoinject?: Partial<AutoinjectSettings>
}

/** 整份覆盖层状态。 */
export interface DatasState {
  presets: Record<string, DatasBucket>
}

/** 四层合成后的有效参数。 */
export interface EffectiveDatas {
  /** 总开关：默认关，设置页勾选才开。 */
  enabled: boolean
  dbPath: string
  autoinject: AutoinjectSettings
}

/** 桶里认的键。 */
const BUCKET_KEYS = ['enabled', 'dbPath', 'autoinject'] as const

/** 覆盖层文件。 */
export function datasStateFile(root: string): string {
  return join(root, 'state', 'datas.json')
}

/** 整数收窄：有限数取整，钳到 [min, max]，非法回落 fallback。 */
function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  const int = Math.trunc(n)
  if (int < min) return min
  if (int > max) return max
  return int
}

/** autoinject 清洗：只留给了的字段，一个都没给就丢（返回 undefined = 这一组没覆盖）。 */
export function cleanAutoinject(value: unknown): Partial<AutoinjectSettings> | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const out: Partial<AutoinjectSettings> = {}
  if (typeof raw.rounds === 'boolean') out.rounds = raw.rounds
  if (typeof raw.afterTool === 'boolean') out.afterTool = raw.afterTool
  if (raw.every !== undefined) out.every = clampInt(raw.every, AUTOINJECT_DEFAULTS.every, 1, 200)
  if (raw.minGap !== undefined) out.minGap = clampInt(raw.minGap, AUTOINJECT_DEFAULTS.minGap, 0, 200)
  return Object.keys(out).length > 0 ? out : undefined
}

/** 桶清洗：只留合法字段，一个都不剩就当没这个桶。 */
function cleanBucket(value: unknown): DatasBucket | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const out: DatasBucket = {}
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled
  if (typeof raw.dbPath === 'string' && raw.dbPath.trim().length > 0) out.dbPath = raw.dbPath.trim()
  const autoinject = cleanAutoinject(raw.autoinject)
  if (autoinject !== undefined) out.autoinject = autoinject
  return Object.keys(out).length > 0 ? out : undefined
}

/** 读整份覆盖层（同步：pre-step 判定要用）。 */
export function readDatasState(root: string): DatasState {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(datasStateFile(root), 'utf8'))
  } catch {
    return { presets: {} }
  }
  if (parsed === null || typeof parsed !== 'object') return { presets: {} }
  const presets: Record<string, DatasBucket> = {}
  const raw = (parsed as { presets?: unknown }).presets
  if (raw !== null && typeof raw === 'object') {
    for (const [scope, bucket] of Object.entries(raw as Record<string, unknown>)) {
      const cleaned = cleanBucket(bucket)
      if (cleaned !== undefined) presets[scope] = cleaned
    }
  }
  return { presets }
}

/** 原子写整份覆盖层。 */
async function saveDatasState(root: string, state: DatasState): Promise<void> {
  const file = datasStateFile(root)
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
}

/**
 * 部分覆盖某个桶：body 里给了的字段盖上去，没给的保留。
 * 传 `null` 表示删掉该键；合并后空桶直接删掉（回到跟随下层）。
 * @param root - 身份根。
 * @param scope - 桶名（common 或 preset id）。
 * @param patch - 待写入字段。
 * @returns 落盘后的整份状态。
 */
export async function setDatasBucket(
  root: string,
  scope: string,
  patch: Record<string, unknown>,
): Promise<DatasState> {
  const current = readDatasState(root)
  const merged: Record<string, unknown> = { ...current.presets[scope] }
  for (const key of BUCKET_KEYS) {
    if (!(key in patch)) continue
    if (patch[key] === null) delete merged[key]
    else merged[key] = patch[key]
  }
  const cleaned = cleanBucket(merged)
  const presets = { ...current.presets }
  if (cleaned === undefined) delete presets[scope]
  else presets[scope] = cleaned
  const next: DatasState = { presets }
  await saveDatasState(root, next)
  return next
}

/**
 * 删掉某个桶（该 preset 回到公共默认 / 接线 config）。
 * @param root - 身份根。
 * @param scope - 桶名。
 * @returns 落盘后的整份状态。
 */
export async function clearDatasBucket(root: string, scope: string): Promise<DatasState> {
  const current = readDatasState(root)
  if (!(scope in current.presets)) return current
  const presets = { ...current.presets }
  delete presets[scope]
  const next: DatasState = { presets }
  await saveDatasState(root, next)
  return next
}

/** 接线层原样（没写的字段就是没写）。 */
export function datasWiring(config: DatasConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (config.enabled !== undefined) out.enabled = config.enabled
  if (config.dbPath !== undefined) out.dbPath = config.dbPath
  if (config.autoinject !== undefined) out.autoinject = config.autoinject
  return out
}

/**
 * 四层合成：默认 ← 接线 config ← 公共桶 ← 分 preset 桶。
 * @param config - preset 接线层。
 * @param state - 覆盖层状态。
 * @param presetId - 会话的 preset id；空 = 只吃公共桶。
 * @returns 该 preset 生效的参数。
 */
export function resolveDatas(
  config: DatasConfig,
  state: DatasState,
  presetId: string | undefined,
): EffectiveDatas {
  const specific = presetId === undefined || presetId === COMMON ? undefined : state.presets[presetId]
  const merged: DatasBucket = {
    ...state.presets[COMMON],
    ...specific,
  }
  const wiringPath = config.dbPath !== undefined && config.dbPath.trim().length > 0 ? config.dbPath.trim() : undefined
  return {
    // 总开关默认关：设置页勾了才开（接线 config 只能开，不能把默认关掉）。
    enabled: merged.enabled ?? config.enabled ?? false,
    dbPath: merged.dbPath ?? wiringPath ?? DEFAULT_DB_PATH,
    autoinject: {
      ...AUTOINJECT_DEFAULTS,
      ...config.autoinject,
      ...merged.autoinject,
    },
  }
}
