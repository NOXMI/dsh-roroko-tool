/**
 * roroko-tool 电箱状态持久化:state 文件 IO。
 *
 * 存储:当前 profile 目录下 `roroko-tool-state.json`(与 cordis.patch.yml 同
 * 层),跨重启保留。profile 目录由 `--profile <name>` + DSH_HOME(默认
 * ~/.dsh)推导,仿 dshmarket 的 activeProfileDir 解析。
 *
 * 读写全部原子化(写先落临时文件再 rename),避免并发/中断写坏文件。
 */

import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { readFile, rename, mkdir, writeFile } from 'node:fs/promises'
import {
  normalizeDataState, normalizePreinjectState, normalizeState,
  RorokoDataState, RorokoPreinjectState, RorokoToolState, RorokoToolStateDefault,
} from './settings.js'

/** 当前运行的 profile 名(默认 web)。 */
function runningProfile(): string {
  const argv = process.argv
  const flag = argv.indexOf('--profile')
  if (flag !== -1 && flag + 1 < argv.length && !argv[flag + 1].startsWith('-')) {
    return argv[flag + 1]
  }
  return 'web'
}

/** state 文件绝对路径。 */
export function rorokoToolStatePath(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'profiles', runningProfile(), 'roroko-tool-state.json')
}

/** 读 state;文件缺失/损坏时回落到默认(不抛)。 */
export async function loadState(): Promise<RorokoToolState> {
  const file = rorokoToolStatePath()
  try {
    const raw = await readFile(file, 'utf8')
    return normalizeState(JSON.parse(raw) as unknown)
  } catch {
    return structuredClone(RorokoToolStateDefault)
  }
}

/**
 * 同步读 state(agent preset 层插件 apply 阶段用,不能 await 时)。
 * 文件缺失/损坏时回落到默认(不抛)。
 */
export function loadStateSync(): RorokoToolState {
  const file = rorokoToolStatePath()
  try {
    const raw = readFileSync(file, 'utf8')
    return normalizeState(JSON.parse(raw) as unknown)
  } catch {
    return structuredClone(RorokoToolStateDefault)
  }
}

/** 原子写 state(临时文件 + rename)。 */
export async function saveState(state: RorokoToolState): Promise<void> {
  const file = rorokoToolStatePath()
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8')
  await rename(tmp, file)
}

/** 读状态并更新单工具 enabled,落盘。返回新状态。 */
export async function setToolEnabled(tool: string, enabled: boolean): Promise<RorokoToolState> {
  const current = await loadState()
  if (!(tool in current)) throw new Error(`unknown tool "${tool}"`)
  const next = structuredClone(current)
  if (tool === 'preinject') {
    // 只翻转 enabled,保留已保存的 files/header/footer/wrap。
    next.preinject = { ...next.preinject, enabled }
  } else if (tool === 'data') {
    // 只翻转 enabled,保留 dbPath。
    next.data = { ...next.data, enabled }
  } else if (tool === 'warn' || tool === 'mark') {
    next[tool] = { enabled }
  } else {
    throw new Error(`unknown tool "${tool}"`)
  }
  await saveState(next)
  return next
}

/** 可由 HTTP body 部分提供的 preinject 配置字段(宽松 unknown,内部收窄)。 */
export interface RorokoPreinjectConfigInput {
  enabled?: boolean
  files?: unknown
  header?: unknown
  footer?: unknown
  wrapInSystemReminder?: boolean
}

/**
 * 覆盖保存 preinject 配置节。body 中提供的字段(非 undefined)覆盖当前值,
 * 未提供的保留现有值(部分保存语义)。落盘后返回新状态。
 */
export async function setPreinjectConfig(
  config: RorokoPreinjectConfigInput,
): Promise<RorokoToolState> {
  const current = await loadState()
  const existing = current.preinject
  const merged: RorokoPreinjectState = {
    enabled: typeof config.enabled === 'boolean'
      ? config.enabled
      : existing.enabled,
    files: Array.isArray(config.files)
      ? config.files.filter((item): item is string => typeof item === 'string')
      : existing.files,
    header: typeof config.header === 'string'
      ? config.header
      : existing.header,
    footer: typeof config.footer === 'string'
      ? config.footer
      : existing.footer,
    wrapInSystemReminder: typeof config.wrapInSystemReminder === 'boolean'
      ? config.wrapInSystemReminder
      : existing.wrapInSystemReminder,
  }
  const next: RorokoToolState = {
    ...current,
    preinject: normalizePreinjectState(merged),
  }
  await saveState(next)
  return next
}

/** data 配置节可部分覆盖的字段(宽松 unknown,内部收窄)。 */
export interface RorokoDataConfigInput {
  enabled?: boolean
  dbPath?: unknown
}

/**
 * 覆盖保存 data 配置节。body 中提供的字段(非 undefined)覆盖当前值,
 * 未提供的保留现有值。落盘后返回新状态。
 */
export async function setDataConfig(
  config: RorokoDataConfigInput,
): Promise<RorokoToolState> {
  const current = await loadState()
  const existing = current.data
  const merged: RorokoDataState = {
    enabled: typeof config.enabled === 'boolean'
      ? config.enabled
      : existing.enabled,
    dbPath: typeof config.dbPath === 'string' && config.dbPath.trim().length > 0
      ? config.dbPath.trim()
      : existing.dbPath,
  }
  const next: RorokoToolState = {
    ...current,
    data: normalizeDataState(merged),
  }
  await saveState(next)
  return next
}
