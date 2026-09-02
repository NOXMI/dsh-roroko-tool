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
import { readFile, rename, mkdir, writeFile } from 'node:fs/promises'
import {
  normalizeState, RorokoToolState, RorokoToolStateDefault,
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
  const next: RorokoToolState = {
    ...current,
    [tool as keyof RorokoToolState]: { enabled },
  }
  await saveState(next)
  return next
}
