/**
 * dnd 子模块的配置形状与开关覆盖层。
 *
 * 开关**按 preset 分桶**，与 preinject / datas / memory 同一套路子：
 *
 *   { "presets": { "common": { "enabled": false }, "roroko_DND": { "enabled": true } } }
 *
 * 默认关；某个 preset 想开就在自己的桶里覆盖。具体桶叠在 common 之上。
 * 存在 `<root>/state/dnd.json`，与三个模块的桶文件各管各的。
 */
import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface DndConfig {
  /** false 时不挂载本模块（接线层，改这个要重启）。 */
  enabled?: boolean
  /** 身份根（默认 $DSH_HOME/roroko_DND）。IDENTITY.md 与 state 都在这下面。 */
  root?: string
  /** dnd.db 路径（默认 <root>/data/dnd.db）。 */
  dbPath?: string
  /** bridge 地址；false = 不连（只留工具）。默认 ws://127.0.0.1:8792。 */
  bridge?: string | false
  /** 是否注册三把工具；false = 只跑桥。默认 true。 */
  tools?: boolean
  /** 与 gateway 约定的 token；缺省读 ROROKO_DND_TOKEN。 */
  token?: string
  /** 会话工作目录。 */
  cwd?: string
  /** 用哪个 preset 起会话（默认 roroko_DND）。桥侧读哪个桶也用它。 */
  preset?: string
  provider?: string
  model?: string
  maxTokens?: number
  log?: boolean
}

export const DND_DEFAULTS: DndConfig = {
  bridge: 'ws://127.0.0.1:8792',
  preset: 'roroko_DND',
  // 库跟 gateway 放一起（/var/www/dnd），不放身份根下面 —— 它俩是一套的
  dbPath: '/var/www/dnd/data/dnd.db',
  log: true,
}

/** 公共默认桶名（与 preinject / datas / memory 同一个）。 */
export const COMMON = 'common'

/** 一个桶里能覆盖的字段。 */
export interface DndBucket {
  enabled?: boolean
}

/** 整份状态。 */
export interface DndState {
  presets: Record<string, DndBucket>
}

/** 没被任何桶覆盖时的默认：**关**。要用得让 preset 自己覆盖。 */
export const DND_COMMON: Required<DndBucket> = { enabled: false }

/** state 文件位置。 */
export function dndStateFile(root: string): string {
  return join(root, 'state', 'dnd.json')
}

/** 桶清洗：只认 enabled 布尔，其余丢弃。 */
function cleanBucket(value: unknown): DndBucket | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const enabled = (value as { enabled?: unknown }).enabled
  return typeof enabled === 'boolean' ? { enabled } : undefined
}

/** 读整份状态（同步：sync() 不能 await）。坏文件当没写过。 */
export function readDndState(root: string): DndState {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(dndStateFile(root), 'utf8'))
  } catch {
    return { presets: {} }
  }
  if (parsed === null || typeof parsed !== 'object') return { presets: {} }
  const presets: Record<string, DndBucket> = {}
  const raw = (parsed as { presets?: unknown }).presets
  if (raw !== null && typeof raw === 'object') {
    for (const [scope, bucket] of Object.entries(raw as Record<string, unknown>)) {
      const cleaned = cleanBucket(bucket)
      if (cleaned !== undefined) presets[scope] = cleaned
    }
  }
  return { presets }
}

/** 原子写整份状态。 */
async function saveState(root: string, state: DndState): Promise<void> {
  const file = dndStateFile(root)
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
}

/**
 * 写某个桶。合并后空桶直接删掉（回到跟随下层），不留空桶压住 common。
 * @param root - 身份根。
 * @param scope - 桶名（common 或 preset id）。
 * @param patch - 待写入字段。
 * @returns 落盘后的整份状态。
 */
export async function setDndBucket(
  root: string,
  scope: string,
  patch: Record<string, unknown>,
): Promise<DndState> {
  const current = readDndState(root)
  const merged: DndBucket = { ...current.presets[scope] }
  if (typeof patch.enabled === 'boolean') merged.enabled = patch.enabled
  const cleaned = cleanBucket(merged)
  const presets = { ...current.presets }
  if (cleaned === undefined) delete presets[scope]
  else presets[scope] = cleaned
  const next: DndState = { presets }
  await saveState(root, next)
  return next
}

/**
 * 删掉某个桶（该 preset 回到 common）。
 * @param root - 身份根。
 * @param scope - 桶名。
 * @returns 落盘后的整份状态。
 */
export async function clearDndBucket(root: string, scope: string): Promise<DndState> {
  const current = readDndState(root)
  if (!(scope in current.presets)) return current
  const presets = { ...current.presets }
  delete presets[scope]
  const next: DndState = { presets }
  await saveState(root, next)
  return next
}

/**
 * 解析某个 preset 的生效开关：具体桶叠在 common 之上。
 * @param state - 整份状态。
 * @param presetId - 会话的 preset id；空 = 只看 common。
 * @returns 合成后的开关。
 */
export function resolveDnd(state: DndState, presetId: string | undefined): Required<DndBucket> {
  const common = { ...DND_COMMON, ...(state.presets[COMMON] ?? {}) }
  if (presetId === undefined || presetId === COMMON) return common
  return { ...common, ...(state.presets[presetId] ?? {}) }
}
