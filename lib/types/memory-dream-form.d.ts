/**
 * roroko 记忆 dream 的纯逻辑:队列口径 / prompt 组装 / 回复解析 / 门禁判定。
 *
 * 设计来源:`refs/notes/roroko-memory-design-v1.md` §七(第七刀 = 记忆系统的下游)+
 * `refs/notes/roroko-datas-dream-slice7-plan.md`(照抄 nanobot 的九步执行序)。
 *
 * 与 09-16 那份计划的**唯一差别**:靶子从"三个记忆文件"换成 sqlite 记忆表。
 * 因为不写文件,所以 E2 的快照目录、`.dream_cursor`、受限工具集、prune 全部作废 ——
 * **队列本身就是游标**(`reflected_at IS NULL`)。
 *
 * 本文件**不 import node 内置与 DSH 运行时包** —— 零依赖测试直读编译产物。
 */
import { type MemoryRow } from './memory-form.js';
/** 默认间隔:4 小时(照抄 nanobot 的 everyMs=14400000)。 */
export declare const DREAM_DEFAULT_INTERVAL_MS: number;
/** 间隔下限:5 分钟(防手滑配成 0 秒把模型当风扇吹)。 */
export declare const DREAM_MIN_INTERVAL_MS: number;
/** 间隔上限:24 小时。 */
export declare const DREAM_MAX_INTERVAL_MS: number;
/** 一次取多少条(照抄 nanobot 的 max_entries=20)。 */
export declare const DREAM_DEFAULT_BATCH = 20;
/** 批量上限。 */
export declare const DREAM_MAX_BATCH = 50;
/** 单条喂给模型的截断长度(照抄 nanobot 的 truncate_text(content, 300))。 */
export declare const DREAM_ENTRY_MAX = 300;
/**
 * 分段定时器的每段长度:最多 1 小时醒一次,醒来自查墙钟到点没。
 * Node 的 timer 上限是 2147483647ms(约 24.8 天),分段是照抄 dsh-schedule 的做法。
 */
export declare const DREAM_TICK_MS: number;
/**
 * 不进反思队列的 kind —— 历史日志(`kind=log`)是逐字入库的开发流水,
 * 再让模型逐条提炼一遍纯属白烧 token(2026-09-20 阿一拍)。
 */
export declare const DREAM_SKIP_KINDS: readonly string[];
/** 审计落盘目录(相对工作区)。 */
export declare const DREAM_LOG_DIR = "dream-log";
/**
 * 单次调用的 token 上限。
 * ⚠️ **默认必须够推理模型用**:`deepseek-v4-flash` 这类带 thinking 的模型会先把
 * reasoning 写完再吐正文,2048 会被 thinking 吃满 → 正文一个字都没有(2026-09-20
 * 在服务器上实测踩到,提到 8192 立刻通)。
 */
export declare const DREAM_DEFAULT_MAX_TOKENS = 8192;
/** maxTokens 上限。 */
export declare const DREAM_MAX_TOKENS_LIMIT = 16384;
/**
 * dream 配置。默认**开着**但没配模型 —— 未配就每次静默跳过(照抄 nanobot 的
 * "默认开",隔离靠 preset 里换/关配置,不靠默认值)。
 */
export interface DreamConfig {
    enabled: boolean;
    intervalMs: number;
    batch: number;
    provider: string;
    model: string;
    maxTokens: number;
    /** 审计目录;空串 = 落在库旁边 `dream-log/`。 */
    logDir: string;
}
/** dream 内置默认(preset 不传就用它)。 */
export declare const DREAM_DEFAULTS: DreamConfig;
/** dream 配置归一化:非法字段逐个回落默认,不抛。 */
export declare function normalizeDreamConfig(raw: unknown): DreamConfig;
/** 一次 dream 里对单条的改写。 */
export interface DreamEdit {
    id: number;
    content: string;
    summary: string;
}
/** 队列筛选结果。 */
export interface DreamQueue {
    /** 本次要整理的条目(最久没反思的在前)。 */
    entries: MemoryRow[];
    /** 排除掉的日志条数(给回执说明用)。 */
    skippedLogs: number;
}
/**
 * 队列口径:`reflected_at` 为空、不在跳过 kind 里,按 created_at 升序取前 limit 条。
 * 库里取回来时已按时间排好,这里只做过滤与截断 —— 纯函数,好测。
 */
export declare function pickQueue(rows: MemoryRow[], limit: number): DreamQueue;
/**
 * 组装 dream 的提示词。要求模型只回一个 JSON 数组,**整条覆盖**语义,
 * 且**不抹平矛盾**(阿一的铁律:保留矛盾)。
 */
export declare function buildDreamPrompt(entries: MemoryRow[]): string;
/** 解析结果。 */
export type DreamParseResult = {
    edits: DreamEdit[];
    error?: undefined;
} | {
    edits?: undefined;
    error: string;
};
/**
 * 解析模型回复。**失败就是失败** —— 不给"装作跑过了"的后路(照抄 nanobot
 * "没跑完 → 游标不动"):解析不出来就返回 error,调用方不写库、不推队列。
 * 越界的 id(不在本批里)与超长正文一律丢掉单条,不算整体失败。
 */
export declare function parseDreamReply(text: string, allowedIds: number[]): DreamParseResult;
/**
 * 门禁:比对写回前后的 reflected_at,只认真落下去的那些(照抄 nanobot 的
 * "审计只认 diff,不认模型自述")。返回真变了的 id。
 */
export declare function diffReflected(before: MemoryRow[], after: MemoryRow[]): number[];
/** 一次 dream 的结果(给状态与审计用)。 */
export interface DreamOutcome {
    /** 队列里有多少条(不含跳过的日志)。 */
    queued: number;
    /** 排除了多少条日志。 */
    skippedLogs: number;
    /** 模型给了几条改写。 */
    proposed: number;
    /** 真写进库并落了 reflected_at 的 id。 */
    changed: number[];
    /** 一句话结论。 */
    note: string;
}
/** 渲染一次 dream 的回执/状态。 */
export declare function renderDreamOutcome(outcome: DreamOutcome): string;
/**
 * 审计正文 —— **只记事实 diff,不记模型自述**(照抄 nanobot D12:
 * "the audit record reflects the filesystem's truth, not the model's self-report")。
 */
export declare function renderDreamAudit(input: {
    at: string;
    provider: string;
    model: string;
    queued: number;
    skippedLogs: number;
    proposed: number;
    changed: number[];
    before: MemoryRow[];
    after: MemoryRow[];
    error?: string;
}): string;
