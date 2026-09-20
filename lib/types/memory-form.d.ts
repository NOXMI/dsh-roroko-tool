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
 *
 * 减法(2026-09-21,阿一拍板"工具就只是简单的 sqlite 工具"):
 *   - 检索**只剩一条 SQL**(关键词全都要命中,LIKE 包含匹配):删掉整套汉字 bigram
 *     打分 / 覆盖度 / 命中数 / 拉丁整词分流 —— 那些概念模型用不上,人也维护不动
 *   - **删召回计数**(recalled):它只当排序次序用,还让同一次查询的结果顺序漂移
 *     (字段仍留在库里,旧库不需要迁移,只是代码不再读写)
 *   - **删 owner 分桶开关**(owner=all / 工具入参 owner):桶固定取 preset 配的那个
 *   - **删 kind 入参**:kind 只剩一个用途 —— 标记导入的历史流水(`log`),由导入脚本
 *     直接写库,模型侧不再暴露分类概念
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
/** source(provenance:会话 id + 事件 seq)上限。 */
export declare const MEMORY_SOURCE_MAX = 200;
/** 默认 owner 桶(本机开发侧)。 */
export declare const MEMORY_DEFAULT_OWNER = "dev";
/**
 * owner 收窄:小写字母数字开头,可带 . _ -,≤32 字。
 * 拒绝中文/空格/大写 —— 桶名会被当成过滤键,污串一进库就再难收拾。
 * 工具侧不再收 owner 入参,这里只服务于 preset config。
 */
export declare function normalizeOwner(raw: unknown): string | undefined;
/** 写入一条记忆的合法形状。 */
export interface MemoryAddInput {
    owner: string;
    content: string;
    summary: string;
    /** 内部字段:只有导入历史流水的脚本会写 'log';工具侧不再暴露。 */
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
/** add 入参收窄:owner/content/summary 必填,source 可省;kind 固定留空(导入脚本自己填)。 */
export declare function normalizeAdd(raw: Record<string, unknown>): AddResult;
/** 反思一条记忆的合法形状。 */
export interface MemoryReflectInput {
    id: number;
    content: string;
    /** 空串 = 保留原 summary 不动。 */
    summary: string;
}
/** reflect 入参收窄结果。 */
export type ReflectResult = {
    input: MemoryReflectInput;
    error?: undefined;
} | {
    input?: undefined;
    error: string;
};
/**
 * reflect 入参收窄:id 必需、content 必需(**整条覆盖,不是追加**)、summary 可省。
 * 覆盖是设计稿定的(§五 5.3)——省掉历史版本,换表不膨胀;要留旧理解就别覆盖,
 * 用 op=add 另记一条(「保留矛盾」铁律)。
 */
export declare function normalizeReflect(raw: Record<string, unknown>): ReflectResult;
/** 库里读回来的一行(只列本工具用得到的列)。 */
export interface MemoryRow {
    id: number;
    owner: string;
    content?: string;
    summary: string;
    created_at: string;
    reflected_at: string | null;
    kind: string | null;
    source?: string | null;
}
/** 写入回执:'已记 #id · 时间 · owner'。 */
export declare function renderAddResult(input: MemoryAddInput, id: number, createdAt: string): string;
/** 反思回执入参。 */
export interface RenderReflectInput {
    id: number;
    reflectedAt: string;
    /** 覆盖前的 content 字数。 */
    beforeChars: number;
    afterChars: number;
    summary: string;
    /** true = 本次没动 summary。 */
    summaryKept: boolean;
}
/** 反思回执:'已反思 #id · 时间 · 字数 旧→新' —— 一眼看出是**改写**不是新增。 */
export declare function renderReflectResult(input: RenderReflectInput): string;
/** 按日期回查的渲染入参。 */
export interface RenderDateInput {
    rows: MemoryRow[];
    range: DateRange;
    owner: string;
}
/**
 * 渲染按日期回查结果。**空区间要明说"没有记忆"** —— 别让模型对着空表脑补。
 * 标记列只标「未反思」(reflected_at 为空),它就是将来的反思作业队列。
 */
export declare function renderDate(input: RenderDateInput): string;
/** 单次检索喂进 SQL 的关键词个数上限(词越多命中越稀)。 */
export declare const MEMORY_ROUGH_MAX_KEYWORDS = 8;
/** 检索默认返回条数。 */
export declare const MEMORY_ROUGH_DEFAULT_LIMIT = 5;
/** 检索返回条数上限。 */
export declare const MEMORY_ROUGH_MAX_LIMIT = 20;
/**
 * 切关键词:按分隔符切、转小写、去重、保序,超上限截断。
 * 词原样拿去 SQL 做包含匹配 —— 不做分词、不做相似度。
 */
export declare function splitKeywords(raw: unknown): string[];
/**
 * 转义 LIKE 的通配符 —— 关键词里的 % _ \ 必须当普通字符,否则
 * `100%` 会变成"以 100 开头的一切"。
 */
export declare function escapeLike(word: string): string;
/** limit 收窄:非数字或 ≤0 → 默认;超上限 → 上限;小数取整。 */
export declare function normalizeLimit(raw: unknown): number;
/** id 收窄:正整数(兼容模型传字符串数字);不合法返回 undefined。 */
export declare function normalizeId(raw: unknown): number | undefined;
/** 检索结果的渲染入参。 */
export interface RenderRoughInput {
    /** SQL 命中的行(已按时间倒序、已截断到 limit)。 */
    rows: MemoryRow[];
    keywords: string[];
    owner: string;
    /** 桶内总条数 —— 用来区分"桶里没记忆"和"没匹配上"。 */
    candidates: number;
}
/** 渲染检索结果。**查不到要明说**,别留给模型"好像有"的余地。 */
export declare function renderRough(input: RenderRoughInput): string;
/** 按 id 取全文的渲染入参。 */
export interface RenderIdInput {
    row: MemoryRow;
}
/** 渲染单条记忆全文(含 provenance,方便回会话原文)。 */
export declare function renderId(input: RenderIdInput): string;
/**
 * 建表语句(设计稿 §四原文;幂等,每次开库都跑一遍)。
 * ⚠️ `recalled` 列仍然保留:2026-09-21 删掉了召回计数逻辑,但**不动表结构** ——
 * 老库不需要迁移,新库多一个没人读的列,代价为零。
 */
export declare const MEMORY_DDL: string[];
/** 开库即生效的连接级 pragma:WAL 抗并发、busy_timeout 别一撞就抛。 */
export declare const MEMORY_PRAGMAS: string[];
