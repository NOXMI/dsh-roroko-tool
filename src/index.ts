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

export const name = 'roroko-tool'

export const pkgName = '@roroko-tool/dsh-roroko-tool'
export const version = '0.0.0'

/** host 侧骨架插件:当前仅占位,子插件逻辑逐步收编。 */
export function apply(_ctx: Context): void {
  // 空实现:作为 profile bundle 的宿主面存在,client 侧另行注入。
}
