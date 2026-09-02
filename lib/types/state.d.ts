/**
 * roroko-tool 子插件参数覆盖持久化:state 文件 IO。
 *
 * 存储:当前 profile 目录下 `roroko-tool-state.json`(与 cordis.patch.yml 同
 * 层),跨重启保留。profile 目录由 `--profile <name>` + DSH_HOME(默认
 * ~/.dsh)推导,仿 dshmarket 的 activeProfileDir 解析。
 *
 * 语义(2026-09-03 三改):enabled 开关已退役,state 只存「参数覆盖层」——
 * 子插件存在与否由 agent preset 声明决定,参数由 state 覆盖优先 + preset
 * config 兜底。本文件仍提供 loadState/loadStateSync(子插件读取覆盖)与
 * setPreinjectConfig/setDataConfig(设置页写覆盖)。
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
/** 可由 HTTP body 部分提供的 preinject 配置字段(宽松 unknown,内部收窄)。 */
export interface RorokoPreinjectConfigInput {
    files?: unknown;
    header?: unknown;
    footer?: unknown;
    wrapInSystemReminder?: boolean;
}
/**
 * 覆盖保存 preinject 参数节。body 中提供的字段(非 undefined)覆盖当前值,
 * 未提供的保留现有值(部分保存语义)。落盘后返回新状态。
 */
export declare function setPreinjectConfig(config: RorokoPreinjectConfigInput): Promise<RorokoToolState>;
/** data 参数节可部分覆盖的字段(宽松 unknown,内部收窄)。 */
export interface RorokoDataConfigInput {
    dbPath?: unknown;
}
/**
 * 覆盖保存 data 参数节。body 中提供的字段(非 undefined)覆盖当前值,
 * 未提供的保留现有值。落盘后返回新状态。
 */
export declare function setDataConfig(config: RorokoDataConfigInput): Promise<RorokoToolState>;
