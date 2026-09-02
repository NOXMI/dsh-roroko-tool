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
/** 默认状态:全关(安装即熄火;用户按需在设置页逐个开)。 */
export const RorokoToolStateDefault = {
    preinject: {
        enabled: false,
        files: [...RorokoPreinjectDefaultFiles],
        header: RorokoPreinjectDefaultHeader,
        footer: RorokoPreinjectDefaultFooter,
        wrapInSystemReminder: false,
    },
    data: {
        enabled: false,
        dbPath: RorokoDataDefaultDbPath,
    },
    warn: { enabled: false },
    mark: { enabled: false },
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
    const enabled = typeof section.enabled === 'boolean' ? section.enabled : base.enabled;
    const files = Array.isArray(section.files)
        ? section.files.filter((item) => typeof item === 'string')
        : [...base.files];
    const header = typeof section.header === 'string' ? section.header : base.header;
    const footer = typeof section.footer === 'string' ? section.footer : base.footer;
    const wrapInSystemReminder = typeof section.wrapInSystemReminder === 'boolean'
        ? section.wrapInSystemReminder
        : base.wrapInSystemReminder;
    return { enabled, files, header, footer, wrapInSystemReminder };
}
/** data 一节的窄化与默认。 */
export function normalizeDataState(value) {
    const base = RorokoToolStateDefault.data;
    if (typeof value !== 'object' || value === null)
        return { ...base };
    const section = value;
    const enabled = typeof section.enabled === 'boolean' ? section.enabled : base.enabled;
    const dbPath = typeof section.dbPath === 'string' && section.dbPath.trim().length > 0
        ? section.dbPath
        : base.dbPath;
    return { enabled, dbPath };
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
        const enabled = section.enabled;
        if (typeof enabled === 'boolean')
            base[key].enabled = enabled;
    }
    return base;
}
