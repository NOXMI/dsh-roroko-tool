/**
 * roroko-tool 电箱状态持久化:state 文件 IO。
 *
 * 存储:当前 profile 目录下 `roroko-tool-state.json`(与 cordis.patch.yml 同
 * 层),跨重启保留。profile 目录由 `--profile <name>` + DSH_HOME(默认
 * ~/.dsh)推导,仿 dshmarket 的 activeProfileDir 解析。
 *
 * 读写全部原子化(写先落临时文件再 rename),避免并发/中断写坏文件。
 */
import { RorokoToolState } from './settings.js';
/** state 文件绝对路径。 */
export declare function rorokoToolStatePath(): string;
/** 读 state;文件缺失/损坏时回落到默认(不抛)。 */
export declare function loadState(): Promise<RorokoToolState>;
/**
 * 同步读 state(agent preset 层插件 apply 阶段用,不能 await 时)。
 * 文件缺失/损坏时回落到默认(不抛)。
 */
export declare function loadStateSync(): RorokoToolState;
/** 原子写 state(临时文件 + rename)。 */
export declare function saveState(state: RorokoToolState): Promise<void>;
/** 读状态并更新单工具 enabled,落盘。返回新状态。 */
export declare function setToolEnabled(tool: string, enabled: boolean): Promise<RorokoToolState>;
/** 可由 HTTP body 部分提供的 preinject 配置字段(宽松 unknown,内部收窄)。 */
export interface RorokoPreinjectConfigInput {
    enabled?: boolean;
    files?: unknown;
    header?: unknown;
    footer?: unknown;
    wrapInSystemReminder?: boolean;
}
/**
 * 覆盖保存 preinject 配置节。body 中提供的字段(非 undefined)覆盖当前值,
 * 未提供的保留现有值(部分保存语义)。落盘后返回新状态。
 */
export declare function setPreinjectConfig(config: RorokoPreinjectConfigInput): Promise<RorokoToolState>;
/** data 配置节可部分覆盖的字段(宽松 unknown,内部收窄)。 */
export interface RorokoDataConfigInput {
    enabled?: boolean;
    dbPath?: unknown;
}
/**
 * 覆盖保存 data 配置节。body 中提供的字段(非 undefined)覆盖当前值,
 * 未提供的保留现有值。落盘后返回新状态。
 */
export declare function setDataConfig(config: RorokoDataConfigInput): Promise<RorokoToolState>;
