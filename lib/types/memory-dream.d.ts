import { type DreamOutcome } from './memory-dream-form.js';
/** 机制依赖(全部注入 —— 测试里换成假的就能跑整个执行序)。 */
export interface DreamDeps {
    dbPath: string;
    /** 桶;dream 只整理本桶(默认不跨桶)。 */
    owner: string;
    provider: string;
    model: string;
    /** 一次取多少条。 */
    batch: number;
    maxTokens: number;
    /** 审计目录;空串 = 不落盘。 */
    logDir: string;
    /** 调一次模型拿纯文本回复(接线层用 ctx.llm.stream 拼装)。 */
    callModel: (prompt: string) => Promise<string>;
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
    intervalMs: number;
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
