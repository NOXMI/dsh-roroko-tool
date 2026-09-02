/**
 * roroko-tool 电箱状态:四工具 enabled 的类型与默认值。
 *
 * 2026-09-02 晚修订:原设计经 ctx.inject(['settings']) 把 schema register 到
 * DSH settings namespace、client 用 settingsScope 双向同步——被官方 loopback
 * 写限制卡死(远程浏览器 persistence='memory',开关点击 no-op;dshmarket 源码
 * 注释亲证 "settings scope is host-mode only")。按 dshmarket 范式退役:
 * 开关状态改由 host 自存 state 文件 + webServer HTTP route 读写(GET/POST
 * /roroko-tool/state),client 纯 fetch。本文件只留类型/默认值/工具键,
 * register 与 schemastery schema 逻辑全部删除。
 *
 * 未来 agent 侧子插件(preinject/data/warn/mark)读本电箱状态,可经
 * roroko-tool host 的 state(文件或服务)取,不再走 settings namespace。
 */

/** 四工具的稳定键(与 state 文件 / HTTP payload 一致)。 */
export type RorokoToolKey = 'preinject' | 'data' | 'warn' | 'mark'

/** 电箱状态:每工具一个 enabled 布尔。 */
export interface RorokoToolState {
  preinject: { enabled: boolean }
  data: { enabled: boolean }
  warn: { enabled: boolean }
  mark: { enabled: boolean }
}

/** 四工具键的稳定序(渲染/校验共用)。 */
export const ROROKO_TOOL_KEYS = ['preinject', 'data', 'warn', 'mark'] as const

/** 默认状态:全关(安装即熄火;用户按需在设置页逐个开)。 */
export const RorokoToolStateDefault: RorokoToolState = {
  preinject: { enabled: false },
  data: { enabled: false },
  warn: { enabled: false },
  mark: { enabled: false },
}

/** 窄化未知值为工具键。 */
export function isRorokoToolKey(value: unknown): value is RorokoToolKey {
  return typeof value === 'string' && (ROROKO_TOOL_KEYS as readonly string[]).includes(value)
}

/** 把任意部分对象叠到默认状态上(容错:缺键用默认,未知键丢弃)。 */
export function normalizeState(value: unknown): RorokoToolState {
  const base = structuredClone(RorokoToolStateDefault)
  if (typeof value !== 'object' || value === null) return base
  const source = value as Record<string, unknown>
  for (const key of ROROKO_TOOL_KEYS) {
    const section = source[key]
    if (typeof section === 'object' && section !== null) {
      const enabled = (section as { enabled?: unknown }).enabled
      if (typeof enabled === 'boolean') base[key].enabled = enabled
    }
  }
  return base
}
