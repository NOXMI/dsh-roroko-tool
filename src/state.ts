/**
 * 运行时状态登记处：子模块挂载时把自己的实际配置写进来，host 的 HTTP 路由把它
 * 读出来给设置页；同时负责跳闸记录（injected.json）的读取与清空。
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface MountStatus {
  /** 身份文件根目录。 */
  root: string
  /** 实际使用的身份文件（相对 root）。 */
  identityFiles: readonly string[]
  /** 实际使用的工作区文件（相对会话 cwd）。 */
  workspaceFiles: readonly string[]
  /** 系统段是否也拼工作区文件。 */
  includeWorkspace: boolean
}

const MOUNTS = new Map<number, MountStatus>()
let nextKey = 1

/**
 * 登记一次子模块挂载。
 * @param status - 本次挂载的实际配置。
 * @returns 注销函数。
 */
export function registerMount(status: MountStatus): () => void {
  const key = nextKey
  nextKey += 1
  MOUNTS.set(key, status)
  return () => {
    MOUNTS.delete(key)
  }
}

/** 当前所有挂载的快照。 */
export function mountedStatuses(): MountStatus[] {
  return [...MOUNTS.values()]
}

/** 跳闸记录文件路径（跟随第一个挂载的 root）。 */
export function injectedFile(): string | undefined {
  const first = mountedStatuses()[0]
  return first === undefined ? undefined : join(first.root, 'state', 'injected.json')
}

/**
 * 读取已注入的会话 id。
 * @param file - injected.json 路径。
 * @returns 会话 id 列表。
 */
export async function readInjected(file: string): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/**
 * 写入已注入的会话 id。
 * @param file - injected.json 路径。
 * @param ids - 会话 id 列表。
 */
export async function writeInjected(file: string, ids: readonly string[]): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify([...ids]), 'utf8')
}

/**
 * 清空跳闸记录。
 * @param file - injected.json 路径。
 */
export async function resetInjected(file: string): Promise<void> {
  await rm(file, { force: true })
}
