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
export declare const RorokoPreinjectDefaultSystemFiles: string[];
/** 系统段基准 order。 */
export declare const RorokoPreinjectDefaultSystemOrder = 100;
/** 消息段默认文件清单(user 消息,会话首次进入时注入一次)。 */
export declare const RorokoPreinjectDefaultFiles: string[];
/** 预注入默认包裹壳(与旧 preset 接线草案一致,生成 <roroko-reminder> 注释块)。 */
export declare const RorokoPreinjectDefaultHeader: string;
export declare const RorokoPreinjectDefaultFooter: string;
/** roroko-data 素材库工具默认数据库路径(服务器 soul.db)。 */
export declare const RorokoDataDefaultDbPath = "/var/www/api/database/soul.db";
/** roroko-memory 记忆库默认路径(服务器;与 soul.db 同目录,备份一起走)。 */
export declare const RorokoMemoryDefaultDbPath = "/var/www/api/database/roroko_memory.db";
/** roroko-memory 缺省 owner 桶(本机开发侧;服务器 preset 接线里改 persona)。 */
export declare const RorokoMemoryDefaultOwner = "dev";
/**
 * 公共覆盖桶名:未指定 preset 时生效。旧版扁平 state 迁入此桶,让既有配置
 * 继续对每个 preset 生效;具体 preset 的桶叠在它之上。
 */
export declare const ROROKO_COMMON_SCOPE = "common";
/** 消息段落点:插在本批用户消息之后(默认,与官方 agent-instructions 同位)还是之前。 */
export type RorokoFilesPlacement = 'after-user' | 'before-user';
/**
 * preinject 覆盖层(部分字段)。字段缺失即"未覆盖",回落 preset config;
 * 字段存在(含空数组/空串)即"显式设定"。
 */
export interface RorokoPreinjectOverride {
    /** 系统段:会话 cwd(或宏解析后)下的待注入文件名(注入顺序)。 */
    systemFiles?: string[];
    /** 系统段 section order。 */
    systemOrder?: number;
    /** 系统段:内容前插入的文本。 */
    systemHeader?: string;
    /** 系统段:内容后插入的文本。 */
    systemFooter?: string;
    /** 消息段:待注入 user 消息的文件名(注入顺序)。 */
    files?: string[];
    /** 消息段:内容前插入的文本。 */
    header?: string;
    /** 消息段:内容后插入的文本。 */
    footer?: string;
    /** 消息段:是否整体包一层 <system-reminder>…</system-reminder>。 */
    wrapInSystemReminder?: boolean;
    /** 消息段落点:本批用户消息之后(默认)还是之前。 */
    filesPlacement?: RorokoFilesPlacement;
    /** 消息段是否每个文件各注入一条(默认 false=全部合并成一条)。 */
    splitFiles?: boolean;
}
/**
 * preinject 的全量参数形状:覆盖层 + preset config + 内置默认逐字段合并后的
 * 结果(旧 client 兼容视图 / 设置页显示的完整值都用它)。
 */
export interface RorokoPreinjectState {
    systemFiles: string[];
    systemOrder: number;
    systemHeader: string;
    systemFooter: string;
    files: string[];
    header: string;
    footer: string;
    wrapInSystemReminder: boolean;
    filesPlacement: RorokoFilesPlacement;
    splitFiles: boolean;
}
/** 一个 agent preset 的覆盖节(目前只有 preinject 是 per-preset 参数)。 */
export interface RorokoPresetOverride {
    preinject?: RorokoPreinjectOverride;
}
/** state 短条自动注入机制(data 节)的开关形状。 */
export interface RorokoAutoinjectState {
    /** 按轮数注入;关掉就只剩"工具后"那条路。 */
    rounds: boolean;
    /** 轮数阈值:每 N 轮最多注一次。 */
    every: number;
    /** 调过 roroko_datas_* 之后的下一步注入。 */
    afterTool: boolean;
    /** 最短间隔:两次注入之间至少隔 N 轮(0 = 不限制)。 */
    minGap: number;
}
/** 自动注入默认值:两个来源都开,阈值 8 轮,最短间隔 4 轮。 */
export declare const RorokoAutoinjectDefaults: RorokoAutoinjectState;
/**
 * data 一节的 wire 形状:数据库路径 + 自动注入机制开关。
 * enabled 已退役:preset 声明 roroko-data 即注册四把工具。
 */
export interface RorokoDataState {
    /** soul.db 绝对路径;缺省回落服务器默认路径。 */
    dbPath: string;
    /** 自动注入开关(机制层:不发 schema,故运行级开关在此是安全的)。 */
    autoinject: RorokoAutoinjectState;
}
/** mark 一节的 wire 形状:呻吟标记渲染总开关(web 渲染 / Telegram 出站共用)。 */
export interface RorokoMarkState {
    /** 显示层是否把 -呻吟_X- 标记展开为完整呻吟文本(session 存储仍存原文)。 */
    enabled: boolean;
}
/** 四工具参数键(与 HTTP payload 一致)。 */
export type RorokoToolKey = 'preinject' | 'data' | 'warn' | 'mark';
/**
 * 电箱参数状态。
 * presets 按 agent preset id 分桶(空对象 = 全部走 preset config 兜底),
 * data / mark 为部署级全局参数。
 */
export interface RorokoToolState {
    presets: Record<string, RorokoPresetOverride>;
    data: RorokoDataState;
    warn: Record<string, never>;
    mark: RorokoMarkState;
}
/** 四工具键的稳定序(渲染/校验共用)。 */
export declare const ROROKO_TOOL_KEYS: readonly ["preinject", "data", "warn", "mark"];
/** preinject 内置默认:覆盖层与 preset config 都没给时的最终兜底。 */
export declare const RorokoPreinjectDefaults: RorokoPreinjectState;
/**
 * 默认状态:presets 空对象(即"无覆盖",全部回落 preset config)。
 * 默认值本身不写进 state,否则会把 preset config 永久压住。
 */
export declare const RorokoToolStateDefault: RorokoToolState;
/** 窄化未知值为工具键。 */
export declare function isRorokoToolKey(value: unknown): value is RorokoToolKey;
/**
 * preinject 覆盖层归一化:只保留合法字段,非法值丢弃(等于未覆盖)。
 * 没有任何合法字段时返回 undefined —— 空桶不进 state,文件保持干净。
 */
export declare function normalizePreinjectOverride(value: unknown): RorokoPreinjectOverride | undefined;
/** 一个 preset 覆盖节归一化;节内无有效字段则整体丢弃。 */
export declare function normalizePresetOverride(value: unknown): RorokoPresetOverride | undefined;
/** 自动注入开关窄化:布尔兜底,阈值钳到整数 1~200、最短间隔钳到 0~200。 */
export declare function normalizeAutoinject(value: unknown): RorokoAutoinjectState;
/** data 一节的窄化与默认。 */
export declare function normalizeDataState(value: unknown): RorokoDataState;
/** mark 一节的窄化与默认(enabled 布尔兜底)。 */
export declare function normalizeMarkState(value: unknown): RorokoMarkState;
/**
 * 把任意(部分/旧版)状态对象叠到默认上。
 * 兼容旧形状:顶层 `preinject` 节迁进 `presets[ROROKO_COMMON_SCOPE]`。
 * 容错:缺键用默认、未知键丢弃、非法桶丢弃;绝不抛。
 */
export declare function normalizeState(value: unknown): RorokoToolState;
/** 解析某 preset 生效的覆盖层:具体桶叠在公共桶之上(只叠"存在"的字段)。 */
export declare function resolvePresetOverride(state: RorokoToolState, presetId: string | undefined): RorokoPreinjectOverride;
/** 覆盖层 + 内置默认合成的完整参数(兼容视图 / 设置页显示用)。 */
export declare function preinjectView(override: RorokoPreinjectOverride): RorokoPreinjectState;
