import { installRorokoToolSettings } from './settings.js';
export const name = 'roroko-tool';
export const pkgName = '@roroko-tool/dsh-roroko-tool';
export const version = '0.0.0';
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
export function apply(ctx) {
    installRorokoToolSettings(ctx);
}
