/**
 * roroko-tool 电箱状态:四工具 enabled 及 preinject 注入参数的默认值。
 *
 * 2026-09-02 晚修订:原设计经 ctx.inject(['settings']) 把 schema register 到
 * DSH settings namespace、client 用 settingsScope 双向同步——被官方 loopback
 * 写限制卡死(远程浏览器 persistence='memory',开关点击 no-op;dshmarket 源码
 * 注释亲证 "settings scope is host-mode only")。按 dshmarket 范式退役:
 * 开关状态改由 host 自存 state 文件 + webServer HTTP route 读写(GET/POST
 * /roroko-tool/state),client 纯 fetch。本文件只留类型/默认值/工具键,
 * register 与 schemastery schema 逻辑全部删除。
 *
 * 2026-09-02(二改):preinject 从独立旧插件收编为 roroko-tool 功能——注入
 * 参数(文件清单 files / 包裹壳 header、footer / 是否 system-reminder 包裹)
 * 也进 UI 编辑,存电箱 state。agent 侧子插件 roroko-preinject 动手前经
 * roroko-tool host 的 state(文件或服务)取 enabled + files/header/footer,
 * 不再走 settings namespace,也不再要求 preset 接线传 config。
 *
 * 未来 agent 侧子插件(data/warn/mark)读本电箱状态同理。
 */
/** 预注入默认文件清单:roroko-workspace / 工作区根下的人格与纪律文件。 */
export declare const RorokoPreinjectDefaultFiles: string[];
/** 预注入默认包裹壳(与旧 preset 接线草案一致,生成 <roroko-reminder> 注释块)。 */
export declare const RorokoPreinjectDefaultHeader: string;
export declare const RorokoPreinjectDefaultFooter: string;
/** preinject 一节的 wire 形状(与 state 文件 / HTTP payload / UI 一致)。 */
export interface RorokoPreinjectState {
    enabled: boolean;
    /** 会话 cwd 下待注入的文件名(注入顺序)。 */
    files: string[];
    /** 包裹壳:内容前插入的文本。 */
    header: string;
    /** 包裹壳:内容后插入的文本。 */
    footer: string;
    /** 是否再整体包一层 <system-reminder>…</system-reminder>。 */
    wrapInSystemReminder: boolean;
}
/** 四工具的稳定键(与 state 文件 / HTTP payload 一致)。 */
export type RorokoToolKey = 'preinject' | 'data' | 'warn' | 'mark';
/** 电箱状态:每工具一个 enabled 布尔;preinject 额外携带注入参数。 */
export interface RorokoToolState {
    preinject: RorokoPreinjectState;
    data: {
        enabled: boolean;
    };
    warn: {
        enabled: boolean;
    };
    mark: {
        enabled: boolean;
    };
}
/** 四工具键的稳定序(渲染/校验共用)。 */
export declare const ROROKO_TOOL_KEYS: readonly ["preinject", "data", "warn", "mark"];
/** 默认状态:全关(安装即熄火;用户按需在设置页逐个开)。 */
export declare const RorokoToolStateDefault: RorokoToolState;
/** 窄化未知值为工具键。 */
export declare function isRorokoToolKey(value: unknown): value is RorokoToolKey;
/** preinject 一节的窄化与默认。 */
export declare function normalizePreinjectState(value: unknown): RorokoPreinjectState;
/** 把任意部分对象叠到默认状态上(容错:缺键用默认,未知键丢弃)。 */
export declare function normalizeState(value: unknown): RorokoToolState;
