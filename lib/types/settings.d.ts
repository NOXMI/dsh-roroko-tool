/**
 * roroko-tool 子插件配置类型与默认值(纯参数,无运行级开关)。
 *
 * 架构沿革(2026-09-03 三改):roroko-tool 从「host 电箱 + state 开关」转向
 * 「preset 声明即开关」。agent preset 在 agent.cordis.yml 里声明引用哪个子
 * 插件(roroko-data / roroko-preinject …),装配即生效;不引用即不存在。
 * 原四工具 enabled 运行级开关全部退役——运行级动态启停会随会话装配改变
 * 工具集,打爆 request-cache 上下文命中。
 *
 * 每个子插件的参数仍支持两层:
 *   1. preset 接线时写在 agent.cordis.yml 对应行的 `config:`(推荐,声明即配);
 *   2. host 侧 state 文件覆盖(roroko-tool-state.json,经设置页编辑),子插件
 *      读取时 state 覆盖优先、preset config 兜底。
 * 子插件参数只影响行为,不改工具 schema,不破坏缓存。
 *
 * 历史:2026-09-02 曾做 host 电箱四开关 + state HTTP route(client 经同源
 * fetch 读写,绕开官方 settings loopback 写限制);2026-09-03 阿一拍板退役
 * enabled 开关,state 只存参数覆盖。settings.ts 现在只留类型/默认值/工具键,
 * register 与 schemastery schema 逻辑早已删除。
 */
/** 预注入默认文件清单:roroko-workspace / 工作区根下的人格与纪律文件。 */
export declare const RorokoPreinjectDefaultFiles: string[];
/** 预注入默认包裹壳(与旧 preset 接线草案一致,生成 <roroko-reminder> 注释块)。 */
export declare const RorokoPreinjectDefaultHeader: string;
export declare const RorokoPreinjectDefaultFooter: string;
/** roroko-data 素材库工具默认数据库路径(服务器 soul.db)。 */
export declare const RorokoDataDefaultDbPath = "/var/www/api/database/soul.db";
/**
 * preinject 一节的 wire 形状(state 文件 / HTTP payload / UI)。
 * enabled 已退役:preset 声明本插件即启用;这里只存注入参数覆盖。
 */
export interface RorokoPreinjectState {
    /** 会话 cwd 下待注入的文件名(注入顺序)。 */
    files: string[];
    /** 包裹壳:内容前插入的文本。 */
    header: string;
    /** 包裹壳:内容后插入的文本。 */
    footer: string;
    /** 是否再整体包一层 <system-reminder>…</system-reminder>。 */
    wrapInSystemReminder: boolean;
}
/**
 * data 一节的 wire 形状:数据库路径覆盖。
 * enabled 已退役:preset 声明 roroko-data 即注册四把工具。
 */
export interface RorokoDataState {
    /** soul.db 绝对路径;缺省回落服务器默认路径。 */
    dbPath: string;
}
/** 四工具参数键(与 state 文件 / HTTP payload 一致)。 */
export type RorokoToolKey = 'preinject' | 'data' | 'warn' | 'mark';
/** 电箱参数状态:每个子插件一节参数;warn/mark 暂无参数。 */
export interface RorokoToolState {
    preinject: RorokoPreinjectState;
    data: RorokoDataState;
    warn: Record<string, never>;
    mark: Record<string, never>;
}
/** 四工具键的稳定序(渲染/校验共用)。 */
export declare const ROROKO_TOOL_KEYS: readonly ["preinject", "data", "warn", "mark"];
/** 默认参数(空参数节即「未覆盖」;子插件回落 preset config)。 */
export declare const RorokoToolStateDefault: RorokoToolState;
/** 窄化未知值为工具键。 */
export declare function isRorokoToolKey(value: unknown): value is RorokoToolKey;
/** preinject 一节的窄化与默认。 */
export declare function normalizePreinjectState(value: unknown): RorokoPreinjectState;
/** data 一节的窄化与默认。 */
export declare function normalizeDataState(value: unknown): RorokoDataState;
/** 把任意部分对象叠到默认状态上(容错:缺键用默认,未知键丢弃)。 */
export declare function normalizeState(value: unknown): RorokoToolState;
