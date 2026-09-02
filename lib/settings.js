/**
 * roroko-tool 电箱设置:注册四工具 enabled 开关。
 *
 * 设计(阿一拍板 2026-09-02):roroko-tool 是「纯电箱」——不做调度、不挂
 * 子插件,只在 profile 层注册 settings 命名空间,存四个工具的 enabled 布尔。
 * 各子插件(preinject/data/warn/mark)在 agent 层各跑各的,动手前自己读
 * 这份 settings,`enabled === false` 就熄火。接线(preset 里 insert 声明)
 * 决定工具在不在 agent 层跑,电箱决定通不通电。
 */
import z from '@deepseek-ai/schemastery';
/** settings 命名空间(须匹配 /^[a-z][a-z0-9-]*$/) */
export const ROROKO_TOOL_SETTINGS_NS = 'roroko-tool';
/** 一个工具的 enabled 子结构(未来各工具自己的闸门参数可在此扩展)。 */
const enabledSection = z.object({ enabled: z.boolean().default(true) });
export const RorokoToolSettings = z.object({
    preinject: enabledSection,
    data: enabledSection,
    warn: enabledSection,
    mark: enabledSection,
});
/** 默认值:全开(接线即触发;用户可在设置面板关闸)。 */
export const RorokoToolSettingsDefault = {
    preinject: { enabled: true },
    data: { enabled: true },
    warn: { enabled: true },
    mark: { enabled: true },
};
/**
 * 电箱接线入口:在 roroko-tool host(profile 层)注册四工具开关。
 * settings 服务不可用时静默跳过(插件照常挂载,闸门缺失按默认全开)。
 */
export function installRorokoToolSettings(ctx) {
    const capable = ctx;
    capable.inject?.(['settings'], (scoped) => {
        scoped.settings.register(ROROKO_TOOL_SETTINGS_NS, RorokoToolSettings, {
            base: RorokoToolSettingsDefault,
        });
    });
}
