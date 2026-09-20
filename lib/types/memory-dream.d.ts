import type { DreamSessionOutcome } from './memory-dream-session.js';
import { type DreamConfig, type DreamOutcome } from './memory-dream-form.js';
/** 机制依赖(全部注入 —— 测试里换成假的就能跑整个执行序)。 */
export interface DreamDeps {
    dbPath: string;
    /** 桶;dream 只整理本桶(默认不跨桶)。 */
    owner: string;
    provider: string;
    model: string;
    /** 一次取多少条。 */
    batch: number;
    /** 审计目录;空串 = 不落盘。 */
    logDir: string;
    /** 起一次性会话把任务书跑完(接线层用 agents/sessions/presets 实现)。 */
    runSession: (prompt: string, bookmark: string) => Promise<DreamSessionOutcome>;
    now: () => Date;
}
/** 一次 dream 的完整结果。 */
export interface DreamRunResult extends DreamOutcome {
    /** 审计文件路径(没落盘就是 undefined)。 */
    auditPath?: string;
    /** 出错时的原因 —— **不抛**,连错误都是结果的一部分。 */
    error?: string;
}
/**
 * 进程内共享的 dream 运行面:接线层(`memory.ts`)注册,host 侧 route 读它。
 * 两边同进程同模块实例,所以一个模块级对象就够 —— 不需要任何服务依赖。
 */
export interface DreamRuntime {
    /** 生效配置;dream 未启用时为 undefined。 */
    config?: DreamConfig;
    /** 动态解析当前生效配置(面板改了立刻反映;优先于 config)。 */
    resolve?: () => DreamConfig;
    /** 手动触发一次;未启用时为 undefined。 */
    run?: () => Promise<DreamRunResult>;
    /** 最近一次结果(CST 时间戳)。 */
    last?: DreamRunResult & {
        at: string;
    };
    /** 正在跑(防并发触发)。 */
    running: boolean;
}
/** 模块级共享面;route 层直接读,永远不为空。 */
export declare const dreamRuntime: DreamRuntime;
/** 认领一个库的 dream 启动权;已被认领过则返回 false。 */
export declare function claimDreamStart(dbPath: string): boolean;
/**
 * 跑一次 dream。**任何异常都在这里收住**并当成结果返回 —— 调用方(定时器)
 * 不该因为一次整理失败而死掉。
 */
export declare function runDreamOnce(deps: DreamDeps): Promise<DreamRunResult>;
/** 定时器句柄。 */
export interface DreamTimer {
    dispose(): void;
    /** 上一次跑完的时间(CST 字符串)或空。 */
    lastRunAt(): string | undefined;
}
/** 分段定时器入参。 */
export interface DreamTimerOptions {
    /** 间隔(毫秒);给函数则每轮重新取 —— 面板改了间隔不必重启宿主。 */
    intervalMs: number | (() => number);
    /** 启动后首次检查的延迟(默认 5 分钟:进程刚起来别抢资源)。 */
    startupDelayMs?: number;
    run: () => Promise<void>;
    now: () => Date;
    onError: (error: unknown) => void;
    /** 定时器接口(测试可替)。 */
    setIntervalFn?: (fn: () => void, ms: number) => {
        unref?: () => void;
        cancel?: () => void;
    };
    clearIntervalFn?: (handle: unknown) => void;
}
/**
 * 分段定时器:每 `DREAM_TICK_MS` 醒一次,自查墙钟到点没 —— 到期即跑,跑完重新计时。
 * **异常一律吞进 onError**,定时器绝不能被一次失败的整理打崩(照抄计划 §四 第 8 步)。
 */
export declare function startDreamTimer(options: DreamTimerOptions): DreamTimer;
/** 审计目录:默认落在库旁边的 `dream-log/`(不需要 cwd,零配置可用)。 */
export declare function defaultDreamLogDir(dbPath: string): string;
