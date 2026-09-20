/**
 * roroko 记忆 dream 的纯逻辑:队列口径 / 任务书组装 / 门禁判定 / 审计渲染。
 *
 * 设计来源:`refs/notes/roroko-memory-design-v1.md` §七(第七刀 = 记忆系统的下游)+
 * `refs/notes/roroko-datas-dream-slice7-plan.md`(照抄 nanobot 的九步执行序)。
 *
 * 2026-09-21 会话化改写(阿一:光给它一段提示词"像啥也不知道的外人来弄"):
 *   - **不再让模型回 JSON** —— 改成起一个一次性会话,上下文由那个 preset 供
 *     (人设靠 preinject 注入的系统段、工具靠 preset 声明的插件行),模型自己
 *     `roroko_mem_id` 取全文、自己 `roroko_mem_edit` 改回去。
 *   - 因此任务书里**只给清单**(id / 时间 / 摘要),正文让它自己按需取 ——
 *     既省上下文,也逼它走一遍"取全文再改"的正路。
 *   - 门禁照旧:**只认 `reflected_at` 真落下去**(不认模型自述),另外统计
 *     会话前后桶内条数差 = 它自己 `add` 了几条(保留矛盾那条通道)。
 *
 * 本文件**不 import node 内置与 DSH 运行时包** —— 零依赖测试直读编译产物。
 */
import { MEMORY_CONTENT_MAX, type MemoryRow } from './memory-form.js';
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
/** 清单里每条摘要的预览长度 —— 只够粗筛,正文要它自己取。 */
export declare const DREAM_PREVIEW_MAX = 120;
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
/** 审计落盘目录(相对库所在目录)。 */
export declare const DREAM_LOG_DIR = "dream-log";
/**
 * 会话每次请求的 token 上限。
 * ⚠️ **必须够推理模型用**:`deepseek-v4-flash` 这类带 thinking 的模型会先把
 * reasoning 写完再吐正文,2048 会被 thinking 吃满 → 正文一个字都没有
 * (2026-09-20 在服务器上实测踩到,提到 8192 立刻通)。
 * 会话化之后它仍要传进 `agentOptions.maxTokens`,所以保留为常量。
 */
export declare const DREAM_DEFAULT_MAX_TOKENS = 8192;
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
    /** 用哪个 preset 起会话(空串 = 该部署的默认 preset)。 */
    preset: string;
    /** 会话的工作目录(空串 = 进程 cwd)。 */
    cwd: string;
}
/** dream 内置默认(preset 不传就用它)。 */
export declare const DREAM_DEFAULTS: DreamConfig;
/** dream 配置归一化:非法字段逐个回落默认,不抛。 */
export declare function normalizeDreamConfig(raw: unknown): DreamConfig;
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
 * 组装任务书。**只给清单**(id / 时间 / 摘要预览),正文让模型自己用
 * `roroko_mem_id` 取、改完用 `roroko_mem_edit(op=reflect)` 覆盖回去。
 * 第一段是"记忆整理模式"声明 —— 这是阿一定的那句:让它知道现在不是对话/开发情景。
 */
export declare function buildDreamTask(entries: MemoryRow[]): string;
/**
 * 门禁:比对写回前后的 `reflected_at`,只认真落下去的那些(照抄 nanobot 的
 * "审计只认 diff,不认模型自述")。返回真变了的 id。
 */
export declare function diffReflected(before: MemoryRow[], after: MemoryRow[]): number[];
/** 一次 dream 的结果(给状态与审计用)。 */
export interface DreamOutcome {
    /** 队列里有多少条(不含跳过的日志)。 */
    queued: number;
    /** 排除了多少条日志。 */
    skippedLogs: number;
    /** 本次会话的 id(空串 = 压根没起会话)。 */
    sessionId: string;
    /** 会话挂上的 preset(空串 = 没挂)。 */
    preset: string;
    /** 会话自己 add 了几条(桶内条数差;≥0)。 */
    added: number;
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
    sessionId: string;
    preset: string;
    queued: number;
    skippedLogs: number;
    added: number;
    changed: number[];
    before: MemoryRow[];
    after: MemoryRow[];
    error?: string;
}): string;
/** 内容上限(与 add 共用同一把尺,渲染说明里用得到)。 */
export { MEMORY_CONTENT_MAX };
