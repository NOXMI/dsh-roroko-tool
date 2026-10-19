/**
 * preinject 的参数持久化：按 agent preset 分桶的覆盖层。
 *
 * 存储：`<root>/state/preinject.json`，结构照 0.1.6 那套——
 *
 *   { "presets": { "common": { … }, "roroko": { … } } }
 *
 * `common` 是公共默认，任何 preset 没覆盖的字段都落回它；具体 preset 的桶
 * 叠在它上面，字段缺失才算未覆盖（空清单 / 空串都是显式设定）。
 *
 * 读写全部原子化（临时文件 + rename），坏文件当没有，不抛。
 */
import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** 公共默认桶名。 */
export const COMMON = 'common'

/** 一个桶里能覆盖的字段。 */
export interface PreinjectBucket {
  systemFiles?: string[]
  userFiles?: string[]
  suppressSections?: string[]
}

/** 整份状态。 */
export interface PreinjectState {
  presets: Record<string, PreinjectBucket>
}

/** 桶里认的键，其余一律丢弃。 */
const BUCKET_KEYS = ['systemFiles', 'userFiles', 'suppressSections'] as const

/** state 文件。 */
export function stateFile(root: string): string {
  return join(root, 'state', 'preinject.json')
}

/** 清单清洗：字符串、去空白、去空项。 */
function cleanList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
}

/** 桶清洗：只留合法字段，一个都不剩就当没这个桶。 */
function cleanBucket(value: unknown): PreinjectBucket | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const out: PreinjectBucket = {}
  if ('systemFiles' in raw) {
    const list = cleanList(raw.systemFiles)
    if (list !== undefined) out.systemFiles = list
  }
  if ('userFiles' in raw) {
    const list = cleanList(raw.userFiles)
    if (list !== undefined) out.userFiles = list
  }
  if ('suppressSections' in raw) {
    const list = cleanList(raw.suppressSections)
    if (list !== undefined) out.suppressSections = list
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** 读整份状态（同步：系统段 provider 不能 await）。 */
export function readState(root: string): PreinjectState {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(stateFile(root), 'utf8'))
  } catch {
    return { presets: {} }
  }
  if (parsed === null || typeof parsed !== 'object') return { presets: {} }
  const presets: Record<string, PreinjectBucket> = {}
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
async function saveState(root: string, state: PreinjectState): Promise<void> {
  const file = stateFile(root)
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
}

/**
 * 部分覆盖某个桶：body 里给了的字段盖上去，没给的保留。
 * 合并后空桶直接删掉（回到跟随公共默认 / 接线 config），不留空桶压住下层。
 * @param root - 身份根。
 * @param scope - 桶名（common 或 preset id）。
 * @param patch - 待写入字段。
 * @returns 落盘后的整份状态。
 */
export async function setBucket(
  root: string,
  scope: string,
  patch: Record<string, unknown>,
): Promise<PreinjectState> {
  const current = readState(root)
  const merged: Record<string, unknown> = { ...current.presets[scope] }
  for (const key of BUCKET_KEYS) {
    if (!(key in patch)) continue
    const cleaned = cleanList(patch[key])
    if (cleaned === undefined) delete merged[key]
    else merged[key] = cleaned
  }
  const cleaned = cleanBucket(merged)
  const presets = { ...current.presets }
  if (cleaned === undefined) delete presets[scope]
  else presets[scope] = cleaned
  const next: PreinjectState = { presets }
  await saveState(root, next)
  return next
}

/**
 * 删掉某个桶（该 preset 回到公共默认 / 接线 config）。
 * @param root - 身份根。
 * @param scope - 桶名。
 * @returns 落盘后的整份状态。
 */
export async function clearBucket(root: string, scope: string): Promise<PreinjectState> {
  const current = readState(root)
  if (!(scope in current.presets)) return current
  const presets = { ...current.presets }
  delete presets[scope]
  const next: PreinjectState = { presets }
  await saveState(root, next)
  return next
}

/**
 * 解析某个 preset 的覆盖层：具体桶叠在公共桶之上，只叠存在的字段。
 * @param state - 整份状态。
 * @param presetId - 会话的 preset id；空 = 只看公共桶。
 * @returns 合成后的覆盖层。
 */
export function resolveBucket(state: PreinjectState, presetId: string | undefined): PreinjectBucket {
  const common = state.presets[COMMON] ?? {}
  const specific = presetId === undefined || presetId === COMMON ? undefined : state.presets[presetId]
  if (specific === undefined) return { ...common }
  return { ...common, ...specific }
}
