/**
 * roroko-tool 子插件配置类型与默认值(纯参数,无运行级开关)。
 *
 * 架构沿革:
 * - 2026-09-02:host 电箱四开关 + state HTTP route(client 同源 fetch 读写,
 *   绕开官方 settings loopback 写限制)。
 * - 2026-09-03 三改:enabled 开关退役——agent preset 在 agent.cordis.yml 里
 *   声明引用哪个子插件(roroko-data / roroko-preinject …)即生效,不引用即
 *   不存在。运行级动态启停会随会话装配改变工具集,打爆 request-cache。
 * - 2026-09-11 四改:preinject 参数改按 agent preset 分桶(state.presets[id]),
 *   注入哪些文件本就因 preset 而异(工作区 preset 与服务器 preset 吃不同人设);
 *   data / mark 仍是部署级全局参数,不随 preset 变。
 *
 * 覆盖语义(四改起统一,修掉旧 wrapInSystemReminder 恒被 state 吃掉的 bug):
 *   字段缺失 = 未覆盖 → 回落 preset 接线 config → 内置默认
 *   字段存在(含空清单/空串) = 显式设定 → 空清单就是"不注入"
 *   旧版扁平 state 迁移时只带走非空字段,保持旧的"空 = 未覆盖"语义。
 *
 * 参数只影响行为,不改工具 schema,不破坏缓存。
 */
/** 系统段默认文件清单:进系统提示词 section,常驻、不算消息、不被 compaction 折叠。 */
export const RorokoPreinjectDefaultSystemFiles = [
    'AGENTS.md',
    'IDENTITY.md',
];
/** 系统段基准 order。 */
export const RorokoPreinjectDefaultSystemOrder = 100;
/** 消息段默认文件清单(user 消息,会话首次进入时注入一次)。 */
export const RorokoPreinjectDefaultFiles = [
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
/** roroko-memory 记忆库默认路径(服务器;与 soul.db 同目录,备份一起走)。 */
export const RorokoMemoryDefaultDbPath = '/var/www/api/database/roroko_memory.db';
/** roroko-memory 缺省 owner 桶(本机开发侧;服务器 preset 接线里改 persona)。 */
export const RorokoMemoryDefaultOwner = 'dev';
/**
 * 公共覆盖桶名:未指定 preset 时生效。旧版扁平 state 迁入此桶,让既有配置
 * 继续对每个 preset 生效;具体 preset 的桶叠在它之上。
 */
export const ROROKO_COMMON_SCOPE = 'common';
/** 自动注入默认值:两个来源都开,阈值 8 轮,最短间隔 4 轮。 */
export const RorokoAutoinjectDefaults = {
    rounds: true,
    every: 8,
    afterTool: true,
    minGap: 4,
};
/** 四工具键的稳定序(渲染/校验共用)。 */
export const ROROKO_TOOL_KEYS = ['preinject', 'data', 'warn', 'mark', 'dream'];
/** preinject 内置默认:覆盖层与 preset config 都没给时的最终兜底。 */
export const RorokoPreinjectDefaults = {
    systemFiles: [...RorokoPreinjectDefaultSystemFiles],
    systemOrder: RorokoPreinjectDefaultSystemOrder,
    systemHeader: '',
    systemFooter: '',
    files: [...RorokoPreinjectDefaultFiles],
    header: RorokoPreinjectDefaultHeader,
    footer: RorokoPreinjectDefaultFooter,
    wrapInSystemReminder: false,
    filesPlacement: 'after-user',
    splitFiles: false,
};
/**
 * 默认状态:presets 空对象(即"无覆盖",全部回落 preset config)。
 * 默认值本身不写进 state,否则会把 preset config 永久压住。
 */
export const RorokoToolStateDefault = {
    presets: {},
    data: {
        dbPath: RorokoDataDefaultDbPath,
        autoinject: { ...RorokoAutoinjectDefaults },
    },
    warn: {},
    mark: { enabled: true },
    dream: {},
};
/** 窄化未知值为工具键。 */
export function isRorokoToolKey(value) {
    return typeof value === 'string' && ROROKO_TOOL_KEYS.includes(value);
}
/** 窄化字符串数组:非数组不认,数组内只留字符串。 */
function stringList(value) {
    if (!Array.isArray(value))
        return undefined;
    return value.filter((item) => typeof item === 'string');
}
/**
 * preinject 覆盖层归一化:只保留合法字段,非法值丢弃(等于未覆盖)。
 * 没有任何合法字段时返回 undefined —— 空桶不进 state,文件保持干净。
 */
export function normalizePreinjectOverride(value) {
    if (typeof value !== 'object' || value === null)
        return undefined;
    const section = value;
    const out = {};
    const systemFiles = stringList(section.systemFiles);
    if (systemFiles !== undefined)
        out.systemFiles = systemFiles;
    if (typeof section.systemOrder === 'number' && Number.isFinite(section.systemOrder)) {
        out.systemOrder = section.systemOrder;
    }
    if (typeof section.systemHeader === 'string')
        out.systemHeader = section.systemHeader;
    if (typeof section.systemFooter === 'string')
        out.systemFooter = section.systemFooter;
    const files = stringList(section.files);
    if (files !== undefined)
        out.files = files;
    if (typeof section.header === 'string')
        out.header = section.header;
    if (typeof section.footer === 'string')
        out.footer = section.footer;
    if (typeof section.wrapInSystemReminder === 'boolean') {
        out.wrapInSystemReminder = section.wrapInSystemReminder;
    }
    if (section.filesPlacement === 'after-user' || section.filesPlacement === 'before-user') {
        out.filesPlacement = section.filesPlacement;
    }
    if (typeof section.splitFiles === 'boolean')
        out.splitFiles = section.splitFiles;
    return Object.keys(out).length > 0 ? out : undefined;
}
/** 一个 preset 覆盖节归一化;节内无有效字段则整体丢弃。 */
export function normalizePresetOverride(value) {
    if (typeof value !== 'object' || value === null)
        return undefined;
    const section = value;
    const preinject = normalizePreinjectOverride(section.preinject);
    return preinject === undefined ? undefined : { preinject };
}
/**
 * 旧版扁平 preinject 节(2026-09-11 之前)迁移:只带走非空字段。
 * 旧语义下空清单/空串等于"未覆盖",迁移时丢掉它们,行为不发生跳变。
 */
function migrateLegacyPreinject(value) {
    if (typeof value !== 'object' || value === null)
        return undefined;
    const section = value;
    const out = {};
    const systemFiles = stringList(section.systemFiles);
    if (systemFiles !== undefined && systemFiles.length > 0)
        out.systemFiles = systemFiles;
    if (typeof section.systemOrder === 'number' && Number.isFinite(section.systemOrder)) {
        out.systemOrder = section.systemOrder;
    }
    if (typeof section.systemHeader === 'string' && section.systemHeader.length > 0) {
        out.systemHeader = section.systemHeader;
    }
    if (typeof section.systemFooter === 'string' && section.systemFooter.length > 0) {
        out.systemFooter = section.systemFooter;
    }
    const files = stringList(section.files);
    if (files !== undefined && files.length > 0)
        out.files = files;
    if (typeof section.header === 'string' && section.header.length > 0)
        out.header = section.header;
    if (typeof section.footer === 'string' && section.footer.length > 0)
        out.footer = section.footer;
    if (section.wrapInSystemReminder === true)
        out.wrapInSystemReminder = true;
    return Object.keys(out).length > 0 ? out : undefined;
}
/** 自动注入开关窄化:布尔兜底,阈值钳到整数 1~200、最短间隔钳到 0~200。 */
export function normalizeAutoinject(value) {
    const base = RorokoAutoinjectDefaults;
    if (typeof value !== 'object' || value === null)
        return { ...base };
    const section = value;
    const raw = Number(section.every);
    const every = Number.isFinite(raw)
        ? Math.min(200, Math.max(1, Math.trunc(raw)))
        : base.every;
    const rawGap = Number(section.minGap);
    const minGap = Number.isFinite(rawGap)
        ? Math.min(200, Math.max(0, Math.trunc(rawGap)))
        : base.minGap;
    return {
        rounds: typeof section.rounds === 'boolean' ? section.rounds : base.rounds,
        every,
        afterTool: typeof section.afterTool === 'boolean' ? section.afterTool : base.afterTool,
        minGap,
    };
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
    return { dbPath, autoinject: normalizeAutoinject(section.autoinject) };
}
/** mark 一节的窄化与默认(enabled 布尔兜底)。 */
export function normalizeMarkState(value) {
    const base = RorokoToolStateDefault.mark;
    if (typeof value !== 'object' || value === null)
        return { ...base };
    const section = value;
    const enabled = typeof section.enabled === 'boolean' ? section.enabled : base.enabled;
    return { enabled };
}
/**
 * dream 一节的窄化:**只留出现过的合法字段**(不做默认填充)。
 * 全非法 → 空对象,等于"未覆盖",preset config 照常生效。
 */
export function normalizeDreamState(value) {
    if (typeof value !== 'object' || value === null)
        return {};
    const section = value;
    const out = {};
    if (typeof section.enabled === 'boolean')
        out.enabled = section.enabled;
    const ints = ['intervalMs', 'batch'];
    for (const key of ints) {
        const raw = section[key];
        if (typeof raw === 'number' && Number.isFinite(raw))
            out[key] = Math.floor(raw);
    }
    const strings = ['provider', 'model'];
    for (const key of strings) {
        const raw = section[key];
        if (typeof raw === 'string')
            out[key] = raw.trim();
    }
    return out;
}
/**
 * 把任意(部分/旧版)状态对象叠到默认上。
 * 兼容旧形状:顶层 `preinject` 节迁进 `presets[ROROKO_COMMON_SCOPE]`。
 * 容错:缺键用默认、未知键丢弃、非法桶丢弃;绝不抛。
 */
export function normalizeState(value) {
    const base = structuredClone(RorokoToolStateDefault);
    if (typeof value !== 'object' || value === null)
        return base;
    const source = value;
    const rawPresets = source.presets;
    if (typeof rawPresets === 'object' && rawPresets !== null) {
        for (const [scope, section] of Object.entries(rawPresets)) {
            const normalized = normalizePresetOverride(section);
            if (normalized !== undefined)
                base.presets[scope] = normalized;
        }
    }
    else {
        // 旧形状:顶层扁平 preinject 节。
        const migrated = migrateLegacyPreinject(source.preinject);
        if (migrated !== undefined)
            base.presets[ROROKO_COMMON_SCOPE] = { preinject: migrated };
    }
    base.data = normalizeDataState(source.data);
    base.mark = normalizeMarkState(source.mark);
    base.dream = normalizeDreamState(source.dream);
    return base;
}
/** 解析某 preset 生效的覆盖层:具体桶叠在公共桶之上(只叠"存在"的字段)。 */
export function resolvePresetOverride(state, presetId) {
    const common = state.presets[ROROKO_COMMON_SCOPE]?.preinject;
    const specific = presetId === undefined ? undefined : state.presets[presetId]?.preinject;
    if (common === undefined)
        return specific ?? {};
    if (specific === undefined)
        return common;
    const merged = { ...common };
    for (const [key, value] of Object.entries(specific)) {
        if (value !== undefined) {
            ;
            merged[key] = value;
        }
    }
    return merged;
}
/** 覆盖层 + 内置默认合成的完整参数(兼容视图 / 设置页显示用)。 */
export function preinjectView(override) {
    return {
        systemFiles: override.systemFiles ?? RorokoPreinjectDefaults.systemFiles,
        systemOrder: override.systemOrder ?? RorokoPreinjectDefaults.systemOrder,
        systemHeader: override.systemHeader ?? RorokoPreinjectDefaults.systemHeader,
        systemFooter: override.systemFooter ?? RorokoPreinjectDefaults.systemFooter,
        files: override.files ?? RorokoPreinjectDefaults.files,
        header: override.header ?? RorokoPreinjectDefaults.header,
        footer: override.footer ?? RorokoPreinjectDefaults.footer,
        wrapInSystemReminder: override.wrapInSystemReminder ?? RorokoPreinjectDefaults.wrapInSystemReminder,
        filesPlacement: override.filesPlacement ?? RorokoPreinjectDefaults.filesPlacement,
        splitFiles: override.splitFiles ?? RorokoPreinjectDefaults.splitFiles,
    };
}
