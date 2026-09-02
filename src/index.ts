/**
 * @roroko-tool/dsh-roroko-tool — 洛洛可全家桶插件大包。
 *
 * 设计:agent 侧 roroko 系列插件统一收编,exports 子路径多入口;
 * host 默认入口提供 profile bundle 骨架(client 设置页的宿主面),
 * client 子入口(client/client.js)在 WebGUI 设置侧边栏注册
 * 「Roroko Tool」导航项。
 *
 * 子插件入口:
 *   ./preinject — 一次性工作区指令注入器(自 dsh-roroko-preinject 迁入)
 *   ./data      — 洛洛可素材库查询工具集(自 dsh-roroko-data 迁入)
 *   ./warn      — 超量收敛警告(新写,agent 侧)
 *
 * 现状:host 默认入口为空骨架插件,不含任何实际逻辑;client 设置页为
 * 最小验证壳。子插件逐步迁入。
 */
import type { Context } from '@deepseek-ai/cordis'
import { installRorokoToolSettings } from './settings'

export const name = 'roroko-tool'

export const pkgName = '@roroko-tool/dsh-roroko-tool'
export const version = '0.0.0'

/**
 * roroko-tool 电箱宿主(profile 层)。
 *
 * 职责:注册 settings 命名空间,存四工具(preinject/data/warn/mark)的
 * enabled 开关。不做调度、不动态挂子插件——各子插件在 agent 层各跑各的,
 * 动手前读本电箱,`enabled === false` 即熄火。
 *
 * 子插件作为本包的 exports 子入口(./preinject 等)提供;agent preset 里
 * insert 声明即接线,没声明不触发。
 */
export function apply(ctx: Context): void {
  installRorokoToolSettings(ctx)
}
