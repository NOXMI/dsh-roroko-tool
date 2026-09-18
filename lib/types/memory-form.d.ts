/**
 * roroko 记忆工具的纯逻辑:时间口径 / 日期区间 / 入参收窄 / 渲染 / DDL 常量。
 *
 * 与 DB 访问分离(memory-store.ts 负责开库读写),本文件**不 import node 内置与
 * DSH 运行时包** —— 零依赖测试直读编译产物,不连库、不点界面就能验整套口径。
 *
 * 口径(2026-09-18 定稿,见 refs/notes/roroko-memory-design-v1.md):
 *   - 时间一律 **CST+0800**,用固定偏移算、**不读运行环境时区**(服务器被设成 UTC 也照对)
 *   - 存库格式与 soul.db 的 datetime('now','localtime') 一致:'YYYY-MM-DD HH:mm:ss'
 *   - 日期查询拿 created_at 前 10 位做字符串比较,不拼 '23:59:59' 落边界
 *   - 默认区间 = **今天 + 昨天**(直接承接既有记忆纪律「今天 + 昨天必读」)
 */
/** CST 时间戳 'YYYY-MM-DD HH:mm:ss'(禁用 toISOString —— 那是 UTC,库会早 8 小时)。 */
export declare function fmtCst(date: Date): string;
/** CST 日期 'YYYY-MM-DD'。 */
export declare function cstDate(date: Date): string;
/** 真日期校验:挡 '2026-02-30' 这种格式对、值不存在的输入。 */
export declare function isDateStr(value: unknown): value is string;
/** 宽松日期输入:取前 10 位,'2026-09-18' / '2026-09-18 11:30' / ISO 串都认;不合法返回 undefined。 */
export declare function normalizeDateInput(raw: unknown): string | undefined;
/** 日期加减天数(纯 UTC 算术,不涉时区)。 */
export declare function shiftDate(dateStr: string, days: number): string;
/** 闭区间 [from, to],两端都是 'YYYY-MM-DD'。 */
export interface DateRange {
    from: string;
    to: string;
}
/** 区间解析结果:要么给区间,要么给一条人话错误。 */
export type RangeResult = {
    range: DateRange;
    error?: undefined;
} | {
    range?: undefined;
    error: string;
};
/**
 * 解析查询区间:
 *   都不给 → [今天-1, 今天];只给 from → [from, 今天];只给 to → [to, to];都给 → [from, to]
 *   from 晚于 to → 报错(不猜、不自动交换,免得回一堆不是他要的)
 */
export declare function resolveRange(fromRaw: unknown, toRaw: unknown, now: Date): RangeResult;
/** owner 桶名上限。 */
export declare const MEMORY_OWNER_MAX = 32;
/** content(初摘要)上限 —— 只报错不静默截断,让模型自己压。 */
export declare const MEMORY_CONTENT_MAX = 2000;
/** summary(二次摘要)上限。 */
export declare const MEMORY_SUMMARY_MAX = 300;
/** kind 上限。 */
export declare const MEMORY_KIND_MAX = 32;
/** source(provenance:会话 id + 事件 seq)上限。 */
export declare const MEMORY_SOURCE_MAX = 200;
/** 已知 owner 桶(不强制枚举,只作描述与默认值;将来加角色不必改代码)。 */
export declare const MEMORY_OWNERS: readonly ["dev", "persona"];
/** 默认 owner 桶(本机开发侧)。 */
export declare const MEMORY_DEFAULT_OWNER = "dev";
/**
 * owner 收窄:小写字母数字开头,可带 . _ -,≤32 字。
 * 拒绝中文/空格/大写 —— 桶名会被当成过滤键,污串一进库就再难收拾。
 */
export declare function normalizeOwner(raw: unknown): string | undefined;
/** 写入一条记忆的合法形状。 */
export interface MemoryAddInput {
    owner: string;
    content: string;
    summary: string;
    kind: string;
    source: string;
}
/** add 入参收窄结果。 */
export type AddResult = {
    input: MemoryAddInput;
    error?: undefined;
} | {
    input?: undefined;
    error: string;
};
/** add 入参收窄:owner/content/summary 必填,kind/source 可省。 */
export declare function normalizeAdd(raw: Record<string, unknown>): AddResult;
/** 库里读回来的一行(只列本工具用得到的列)。 */
export interface MemoryRow {
    id: number;
    owner: string;
    content?: string;
    summary: string;
    created_at: string;
    reflected_at: string | null;
    recalled: number;
    kind: string | null;
}
/** 写入回执:'已记 #id · 时间 · owner · kind'。 */
export declare function renderAddResult(input: MemoryAddInput, id: number, createdAt: string): string;
/** 按日期回查的渲染入参。 */
export interface RenderDateInput {
    rows: MemoryRow[];
    range: DateRange;
    /** 生效的 owner 过滤值;undefined = 全部桶。 */
    owner?: string;
    now: Date;
}
/**
 * 渲染按日期回查结果。**空区间要明说"没有记忆"** —— 别让模型对着空表脑补。
 * 标记列只标「未反思」(reflected_at 为空),它就是将来的反思作业队列。
 */
export declare function renderDate(input: RenderDateInput): string;
/** 建表语句(设计稿 §四原文;幂等,每次开库都跑一遍)。 */
export declare const MEMORY_DDL: string[];
/** 开库即生效的连接级 pragma:WAL 抗并发、busy_timeout 别一撞就抛。 */
export declare const MEMORY_PRAGMAS: string[];
