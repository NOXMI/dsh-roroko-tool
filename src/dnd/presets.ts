/**
 * dnd 子模块的配置形状与总开关状态。
 *
 * 开关**不分桶**：一个 enabled 管整个子模块（工具 + 桥），写在
 * `<root>/state/dnd.json`，与 preinject / datas / memory 的桶文件各管各的。
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
  /** 用哪个 preset 起会话（默认 roroko_DND）。 */
  preset?: string
  provider?: string
  model?: string
  maxTokens?: number
  log?: boolean
}

export const DND_DEFAULTS: DndConfig = {
  bridge: 'ws://127.0.0.1:8792',
  preset: 'roroko_DND',
  log: true,
}

/** 总开关状态：就一个布尔。 */
export interface DndState {
  enabled: boolean
}

/** 没写过文件时的默认：挂了桶就是要用，默认开。 */
export const DND_STATE_DEFAULTS: DndState = { enabled: true }

/** state 文件位置。 */
export function dndStateFile(root: string): string {
  return join(root, 'state', 'dnd.json')
}

/** 读开关（坏文件当没写过）。 */
export function readDndState(root: string): DndState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(dndStateFile(root), 'utf8'))
    if (parsed !== null && typeof parsed === 'object') {
      const enabled = (parsed as { enabled?: unknown }).enabled
      if (typeof enabled === 'boolean') return { enabled }
    }
  } catch {
    // 没有文件 / 坏文件：回默认
  }
  return { ...DND_STATE_DEFAULTS }
}

/**
 * 写开关（只认 enabled 一个字段）。原子写：临时文件 + rename。
 * @param root - 身份根。
 * @param patch - 待写入字段。
 * @returns 落盘后的状态。
 */
export async function setDndState(root: string, patch: Partial<DndState>): Promise<DndState> {
  const next: DndState = {
    ...readDndState(root),
    ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}),
  }
  const file = dndStateFile(root)
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
  return next
}
