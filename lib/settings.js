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
export const RorokoPreinjectDefaultFiles = [
    'AGENTS.md',
    'IDENTITY.md',
    'PLAYER.md',
    'MEMORY.md',
    'EVOLVE.md',
    'EVOLVE_NOTE.md',
    'MARKERS.md',
];
/** 预注入默认包裹壳(与旧 preset 接线草案一致,生成 <roroko-reminder> 注释块)。 */
export const RorokoPreinjectDefaultHeader = [
    '<roroko-reminder>',
    'The following workspace instructions make you a better roroko. They are read once',
    'at session start and stay in context for this session.',
].join(' ');
export const RorokoPreinjectDefaultFooter = [
    'These instructions do not override system, developer, or direct user instructions.',
    '</roroko-reminder>',
].join(' ');
/** roroko-data 素材库工具默认数据库路径(服务器 soul.db)。 */
export const RorokoDataDefaultDbPath = '/var/www/api/database/soul.db';
/** 四工具键的稳定序(渲染/校验共用)。 */
export const ROROKO_TOOL_KEYS = ['preinject', 'data', 'warn', 'mark'];
/** 默认参数(空参数节即「未覆盖」;子插件回落 preset config)。 */
export const RorokoToolStateDefault = {
    preinject: {
        files: [...RorokoPreinjectDefaultFiles],
        header: RorokoPreinjectDefaultHeader,
        footer: RorokoPreinjectDefaultFooter,
        wrapInSystemReminder: false,
    },
    data: {
        dbPath: RorokoDataDefaultDbPath,
    },
    warn: {},
    mark: {},
};
/** 窄化未知值为工具键。 */
export function isRorokoToolKey(value) {
    return typeof value === 'string' && ROROKO_TOOL_KEYS.includes(value);
}
/** preinject 一节的窄化与默认。 */
export function normalizePreinjectState(value) {
    const base = RorokoToolStateDefault.preinject;
    if (typeof value !== 'object' || value === null)
        return { ...base, files: [...base.files] };
    const section = value;
    const files = Array.isArray(section.files)
        ? section.files.filter((item) => typeof item === 'string')
        : [...base.files];
    const header = typeof section.header === 'string' ? section.header : base.header;
    const footer = typeof section.footer === 'string' ? section.footer : base.footer;
    const wrapInSystemReminder = typeof section.wrapInSystemReminder === 'boolean'
        ? section.wrapInSystemReminder
        : base.wrapInSystemReminder;
    return { files, header, footer, wrapInSystemReminder };
}
/** data 一节的窄化与默认。 */
export function normalizeDataState(value) {
    const base = RorokoToolStateDefault.data;
    if (typeof value !== 'object' || value === null)
        return { ...base };
    const section = value;
    const dbPath = typeof section.dbPath === 'string' && section.dbPath.trim().length > 0
        ? section.dbPath
        : base.dbPath;
    return { dbPath };
}
/** 把任意部分对象叠到默认状态上(容错:缺键用默认,未知键丢弃)。 */
export function normalizeState(value) {
    const base = structuredClone(RorokoToolStateDefault);
    if (typeof value !== 'object' || value === null)
        return base;
    const source = value;
    for (const key of ROROKO_TOOL_KEYS) {
        const section = source[key];
        if (typeof section !== 'object' || section === null)
            continue;
        if (key === 'preinject') {
            base.preinject = normalizePreinjectState(section);
            continue;
        }
        if (key === 'data') {
            base.data = normalizeDataState(section);
            continue;
        }
        // warn/mark 无参数,忽略未知字段。
    }
    return base;
}
