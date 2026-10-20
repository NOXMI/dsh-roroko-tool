/**
 * memory/presets.ts — 记忆子模块参数的持久化：按 agent preset 分桶的覆盖层。
 *
 * 存储：`<root>/state/memory.json`，与 preinject.json / datas.json 同形但分文件：
 *
 *   { "presets": { "common": { "enabled": true, "dbPath": "…", "owner": "roroko",
 *                             "dream": { "provider": "…", "model": "…" } }, "roroko": { … } } }
 *
 * 分文件的理由跟 datas 一样：preinject 管「注入什么文件」，datas 管「连哪个库」，
 * memory 管「记什么、多久反思一次」——三套键混一个文件下个月没人看得懂。
 *
 * 合成链（逐字段回落，缺字段才算未覆盖）：
 *
 *   内置默认 ← preset 接线 config ← 公共桶 common ← 分 preset 桶
 *
 * 读写模式照抄 preinject / datas：读同步（pre-step 里要用）、写原子（临时文件 +
 * rename）、坏文件当没有。
 */
import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { normalizeOwner } from './form.js'
import { DREAM_DEFAULTS, normalizeDreamConfig, type DreamConfig } from './dream-form.js'

/** 公共默认桶名。 */
export const COMMON = 'common'

/** 服务器默认库路径（与 soul.db 同目录，备份一起走）。 */
export const DEFAULT_MEMORY_DB_PATH = '/var/www/api/database/roroko_memory.db'

/** 默认 owner 桶。 */
export const DEFAULT_OWNER = 'dev'

/** 接线参数（preset 的 config.memory）。 */
export interface MemoryConfig {
  /** false 时不挂载本模块。 */
  enabled?: boolean
  /** 身份根（覆盖层目录的基准），默认 $DSH_HOME/roroko。 */
  root?: string
  /** 记忆库路径。 */
  dbPath?: string
  /** owner 桶。 */
  owner?: string
  /** dream（定时反思）的接线层字段。 */
  dream?: Partial<DreamConfig>
}

/** 一个桶里能覆盖的字段（dream 逐字段叠加，不是整组替换）。 */
export interface MemoryBucket {
  /** 总开关：false/未设 = 不注册四把工具、不起 dream。 */
  enabled?: boolean
  dbPath?: string
  owner?: string
  dream?: Partial<DreamConfig>
}

/** 整份覆盖层状态。 */
export interface MemoryState {
  presets: Record<string, MemoryBucket>
}

/** 四层合成后的有效参数。 */
export interface EffectiveMemory {
  /** 总开关：默认关，设置页勾选才开。 */
  enabled: boolean
  dbPath: string
  owner: string
  dream: DreamConfig
}

/** 桶里认的键。 */
const BUCKET_KEYS = ['enabled', 'dbPath', 'owner', 'dream'] as const

/** 覆盖层文件。 */
export function memoryStateFile(root: string): string {
  return join(root, 'state', 'memory.json')
}

/**
 * 整数收窄：有限数取整，钳到 [min, max]。
 * ⚠️ **空串必须回落 fallback**：`Number('')` 是 0 不是 NaN —— 设置页把数字框清空
 * 再保存，会让 intervalMs 一路钳到下限（5 分钟），dream 变成每 5 分钟跑一次。
 */
function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  let n: number
  if (typeof value === 'number') {
    n = value
  } else if (typeof value === 'string') {
    const text = value.trim()
    if (text.length === 0) return fallback
    n = Number(text)
  } else {
    return fallback
  }
  if (!Number.isFinite(n)) return fallback
  const int = Math.trunc(n)
  if (int < min) return min
  if (int > max) return max
  return int
}

/** 布尔 / 字符串字段的白名单收窄（没给就丢，不填默认）。 */
function cleanDream(value: unknown): Partial<DreamConfig> | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const out: Partial<DreamConfig> = {}
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled
  if (raw.intervalMs !== undefined) out.intervalMs = clampInt(raw.intervalMs, DREAM_DEFAULTS.intervalMs, 5 * 60 * 1000, 24 * 60 * 60 * 1000)
  if (raw.batch !== undefined) out.batch = clampInt(raw.batch, DREAM_DEFAULTS.batch, 1, 50)
  for (const key of ['provider', 'model', 'preset', 'cwd'] as const) {
    const v = raw[key]
    if (typeof v === 'string') out[key] = v.trim()
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** 桶清洗：只留合法字段，一个都不剩就当没这个桶。 */
function cleanBucket(value: unknown): MemoryBucket | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const out: MemoryBucket = {}
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled
  if (typeof raw.dbPath === 'string' && raw.dbPath.trim().length > 0) out.dbPath = raw.dbPath.trim()
  const owner = normalizeOwner(raw.owner)
  if (owner !== undefined) out.owner = owner
  const dream = cleanDream(raw.dream)
  if (dream !== undefined) out.dream = dream
  return Object.keys(out).length > 0 ? out : undefined
}

/** 读整份覆盖层（同步：pre-step 判定要用）。 */
export function readMemoryState(root: string): MemoryState {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(memoryStateFile(root), 'utf8'))
  } catch {
    return { presets: {} }
  }
  if (parsed === null || typeof parsed !== 'object') return { presets: {} }
  const presets: Record<string, MemoryBucket> = {}
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
async function saveMemoryState(root: string, state: MemoryState): Promise<void> {
  const file = memoryStateFile(root)
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
}

/**
 * 部分覆盖某个桶：body 里给了的字段盖上去，没给的保留。
 * 传 `null` 表示删掉该键；合并后空桶直接删掉（回到跟随下层）。
 */
export async function setMemoryBucket(
  root: string,
  scope: string,
  patch: Record<string, unknown>,
): Promise<MemoryState> {
  const current = readMemoryState(root)
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
  const next: MemoryState = { presets }
  await saveMemoryState(root, next)
  return next
}

/** 删掉某个桶（该 preset 回到公共默认 / 接线 config）。 */
export async function clearMemoryBucket(root: string, scope: string): Promise<MemoryState> {
  const current = readMemoryState(root)
  if (!(scope in current.presets)) return current
  const presets = { ...current.presets }
  delete presets[scope]
  const next: MemoryState = { presets }
  await saveMemoryState(root, next)
  return next
}

/** 接线层原样（没写的字段就是没写）。 */
export function memoryWiring(config: MemoryConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (config.enabled !== undefined) out.enabled = config.enabled
  if (config.dbPath !== undefined) out.dbPath = config.dbPath
  if (config.owner !== undefined) out.owner = config.owner
  if (config.dream !== undefined) out.dream = config.dream
  return out
}

/**
 * 四层合成：默认 ← 接线 config ← 公共桶 ← 分 preset 桶。
 * @param config - preset 接线层。
 * @param state - 覆盖层状态。
 * @param presetId - 会话的 preset id；空 = 只吃公共桶。
 */
export function resolveMemory(
  config: MemoryConfig,
  state: MemoryState,
  presetId: string | undefined,
): EffectiveMemory {
  const commonBucket = state.presets[COMMON]
  const specific = presetId === undefined || presetId === COMMON ? undefined : state.presets[presetId]
  const merged: MemoryBucket = {
    ...commonBucket,
    ...specific,
  }
  // ⚠️ dream 要**逐字段**叠：整组浅合并会让分桶只写一个 batch 就把公共桶的
  // provider/model 抹掉（datas 那边 autoinject 是同一个坑，等阿一发话再一并修）。
  const dreamFields = { ...commonBucket?.dream, ...specific?.dream }
  const wiringPath = config.dbPath !== undefined && config.dbPath.trim().length > 0 ? config.dbPath.trim() : undefined
  return {
    // 总开关默认关：设置页勾了才开（接线 config 只能开，不能把默认关掉）。
    enabled: merged.enabled ?? config.enabled ?? false,
    dbPath: merged.dbPath ?? wiringPath ?? DEFAULT_MEMORY_DB_PATH,
    owner: normalizeOwner(merged.owner) ?? normalizeOwner(config.owner) ?? DEFAULT_OWNER,
    dream: normalizeDreamConfig({ ...config.dream, ...dreamFields }),
  }
}
