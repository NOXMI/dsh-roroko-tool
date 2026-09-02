/**
 * @roroko-tool/dsh-roroko-tool — 洛洛可全家桶插件大包(空骨架)。
 *
 * 设计:agent 侧 roroko 系列插件统一收编,exports 子路径多入口,
 * 逐步从独立插件(dsh-roroko-preinject / dsh-roroko-data)迁入。
 * 现状:空骨架,src 内仅有占位入口,不含任何实际工具逻辑。
 *
 * 规划子插件:
 *   ./preinject — 一次性工作区指令注入器(自 dsh-roroko-preinject 迁入)
 *   ./data      — 洛洛可素材库查询工具集(自 dsh-roroko-data 迁入)
 *   ./warn      — 超量收敛警告(新写,agent 侧)
 */

export const pkgName = '@roroko-tool/dsh-roroko-tool'
export const version = '0.0.0'
