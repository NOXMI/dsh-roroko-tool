/**
 * roroko-tool 子插件参数覆盖持久化:state 文件 IO。
 *
 * 存储:当前 profile 目录下 `roroko-tool-state.json`(与 cordis.patch.yml 同
 * 层),跨重启保留。profile 目录由 `--profile <name>` + DSH_HOME(默认
 * ~/.dsh)推导,仿 dshmarket 的 activeProfileDir 解析。
 *
 * 语义(2026-09-03 三改):enabled 开关已退役,state 只存「参数覆盖层」——
 * 子插件存在与否由 agent preset 声明决定,参数由 state 覆盖优先 + preset
 * config 兜底。本文件仍提供 loadState/loadStateSync(子插件读取覆盖)与
 * setPreinjectConfig/setDataConfig(设置页写覆盖)。
 *
 * 语义(2026-09-11 四改):preinject 覆盖层按 agent preset id 分桶
 * (`state.presets[<id>].preinject`),未指定 preset 时写公共桶 common。
 * 具体桶叠在公共桶之上,字段缺失即未覆盖。data / mark 仍是全局节。
 * 旧版扁平 state 由 normalizeState 迁进 common 桶,既有配置不丢。
 *
 * 读写全部原子化(写先落临时文件再 rename),避免并发/中断写坏文件。
 */

import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { readFile, rename, mkdir, writeFile } from 'node:fs/promises'
import {
  normalizeAutoinject, normalizeDataState, normalizeDreamState, normalizeMarkState, normalizeState,
  RorokoDataState, RorokoDreamState, RorokoMarkState, RorokoPreinjectOverride, RorokoToolState,
  RorokoToolStateDefault,
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

/** DSH 家目录($DSH_HOME,缺省 `~/.dsh`)。preinject 解析 ${dshHome} 宏时用。 */
export function dshHomeDirectory(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** state 文件绝对路径。 */
export function rorokoToolStatePath(): string {
  return join(dshHomeDirectory(), 'profiles', runningProfile(), 'roroko-tool-state.json')
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

/** 可由 HTTP body 部分提供的 preinject 覆盖字段(宽松 unknown,内部收窄)。 */
export interface RorokoPreinjectConfigInput {
  systemFiles?: unknown
  systemOrder?: unknown
  systemHeader?: unknown
  systemFooter?: unknown
  files?: unknown
  header?: unknown
  footer?: unknown
  wrapInSystemReminder?: unknown
  filesPlacement?: unknown
  splitFiles?: unknown
}

/** 从 input 收窄出合法覆盖字段:只取 body 真正提供的,非法值一律不认。 */
function pickPreinjectOverride(config: RorokoPreinjectConfigInput): RorokoPreinjectOverride {
  const out: RorokoPreinjectOverride = {}
  if (Array.isArray(config.systemFiles)) {
    out.systemFiles = config.systemFiles.filter((item): item is string => typeof item === 'string')
  }
  if (typeof config.systemOrder === 'number' && Number.isFinite(config.systemOrder)) {
    out.systemOrder = config.systemOrder
  }
  if (typeof config.systemHeader === 'string') out.systemHeader = config.systemHeader
  if (typeof config.systemFooter === 'string') out.systemFooter = config.systemFooter
  if (Array.isArray(config.files)) {
    out.files = config.files.filter((item): item is string => typeof item === 'string')
  }
  if (typeof config.header === 'string') out.header = config.header
  if (typeof config.footer === 'string') out.footer = config.footer
  if (typeof config.wrapInSystemReminder === 'boolean') {
    out.wrapInSystemReminder = config.wrapInSystemReminder
  }
  if (config.filesPlacement === 'after-user' || config.filesPlacement === 'before-user') {
    out.filesPlacement = config.filesPlacement
  }
  if (typeof config.splitFiles === 'boolean') out.splitFiles = config.splitFiles
  return out
}

/**
 * 覆盖保存某个 preset 的 preinject 参数节:body 提供的字段覆盖当前值,
 * 未提供的保留(部分保存语义)。合并后为空的桶直接移除,回到 preset config
 * 兜底(而不是把空桶留在 state 里把 config 压住)。落盘后返回新状态。
 */
export async function setPreinjectConfig(
  scope: string,
  config: RorokoPreinjectConfigInput,
): Promise<RorokoToolState> {
  const current = await loadState()
  const existing: RorokoPreinjectOverride = current.presets[scope]?.preinject ?? {}
  // pick 里不会出现 undefined 值,展开不会把既有字段冲掉。
  const merged: RorokoPreinjectOverride = { ...existing, ...pickPreinjectOverride(config) }
  const presets = { ...current.presets }
  if (Object.keys(merged).length > 0) presets[scope] = { preinject: merged }
  else delete presets[scope]
  const next: RorokoToolState = { ...current, presets }
  await saveState(next)
  return next
}

/**
 * 删除某个 preset 的 preinject 覆盖桶:该 preset 回到 preset config / 内置默认兜底。
 * 桶本来就不存在时是 no-op(照样落盘,状态幂等)。落盘后返回新状态。
 */
export async function clearPreinjectConfig(scope: string): Promise<RorokoToolState> {
  const current = await loadState()
  const presets = { ...current.presets }
  delete presets[scope]
  const next: RorokoToolState = { ...current, presets }
  await saveState(next)
  return next
}

/** data 参数节可部分覆盖的字段(宽松 unknown,内部收窄)。 */
export interface RorokoDataConfigInput {
  dbPath?: unknown
  /** 自动注入开关;字段缺失 = 不改(部分保存语义)。 */
  autoinject?: unknown
}

/**
 * 覆盖保存 data 参数节。body 中提供的字段(非 undefined)覆盖当前值,
 * 未提供的保留现有值。落盘后返回新状态。
 */
export async function setDataConfig(
  config: RorokoDataConfigInput,
): Promise<RorokoToolState> {
  const current = await loadState()
  const existing = current.data
  const merged: RorokoDataState = {
    dbPath: typeof config.dbPath === 'string' && config.dbPath.trim().length > 0
      ? config.dbPath.trim()
      : existing.dbPath,
    autoinject: config.autoinject === undefined
      ? existing.autoinject
      : normalizeAutoinject(config.autoinject),
  }
  const next: RorokoToolState = {
    ...current,
    data: normalizeDataState(merged),
  }
  await saveState(next)
  return next
}

/** mark 参数节可覆盖的字段(宽松 unknown,内部收窄)。 */
export interface RorokoMarkConfigInput {
  enabled?: unknown
}

/**
 * 覆盖保存 mark 参数节。body 中提供的字段(非 undefined)覆盖当前值,
 * 未提供的保留现有值。落盘后返回新状态。
 */
export async function setMarkConfig(
  config: RorokoMarkConfigInput,
): Promise<RorokoToolState> {
  const current = await loadState()
  const merged: RorokoMarkState = {
    enabled: typeof config.enabled === 'boolean'
      ? config.enabled
      : current.mark.enabled,
  }
  const next: RorokoToolState = {
    ...current,
    mark: normalizeMarkState(merged),
  }
  await saveState(next)
  return next
}

/** dream 参数节可覆盖的字段(宽松 unknown,内部收窄)。 */
export interface RorokoDreamConfigInput {
  enabled?: unknown
  intervalMs?: unknown
  batch?: unknown
  provider?: unknown
  model?: unknown
  preset?: unknown
  cwd?: unknown
}

/** dream 节可覆盖的键(与 RorokoDreamState 对齐)。 */
const DREAM_INPUT_KEYS = ['enabled', 'intervalMs', 'batch', 'provider', 'model', 'preset', 'cwd'] as const

/**
 * 覆盖保存 dream 参数节:body 里**出现过**的字段才写(部分覆盖语义)。
 * 全部字段都没出现时结果仍是空桶 —— 空桶等价于"未覆盖",preset config 照常生效,
 * 所以 dream 不需要单独的 reset 端点(要清就显式提交空值)。
 */
export async function setDreamConfig(config: RorokoDreamConfigInput): Promise<RorokoToolState> {
  const current = await loadState()
  const merged: Record<string, unknown> = { ...current.dream }
  for (const key of DREAM_INPUT_KEYS) {
    if (config[key] !== undefined) merged[key] = config[key]
  }
  const next: RorokoToolState = { ...current, dream: normalizeDreamState(merged) }
  await saveState(next)
  return next
}
