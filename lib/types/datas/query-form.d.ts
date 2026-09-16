/**
 * roroko_datas_query 的纯逻辑:关键词匹配 / 收束过滤 / 候选抽取 / markdown 渲染。
 *
 * 与 DB 访问分离(query.ts 负责开库取行),所以本文件**不 import node 内置与
 * DSH 运行时包** —— 零依赖测试直读编译产物,不点界面、不连库就能验整套取料行为。
 *
 * 口径(2026-09-16 阿一拍板,证据见 refs/notes/roroko-datas-query-slice1-plan.md):
 *   - 发散为默认(池内均匀随机),收束为可选(条件由模型给,库不当裁判)
 *   - 记录侧 keywords 里 62%~84% 是单字 token(register 分词造成),**单字不作
 *     命中依据** —— 实测误炸「透」7→1、「夜」5→0、「高跟」6→3 条
 *   - 拿现有列,不加列;slot 分组键**从库里动态取**(库里实有 headwear/panties/
 *     swimsuit,设计稿写的 outerwear 是 0 条)
 *   - hit_count / last_used_at 只作展示,不参与排序(按它排会永远推同几条)
 *   - 时间一律本地口径算出相对时间;库里 companion_pool 的时间列叫 last_used
 */
/** 能查的四张素材表(与旧 roroko_query 的 table 枚举一致)。 */
export type QueryTableKey = 'scene' | 'clothing' | 'items' | 'companion';
/** 表的真实形状 —— 列名以库为准,不以文档为准。 */
export interface TableSpec {
    table: string;
    nameCol: string;
    /** "最后使用"列:companion_pool 用 last_used,其余用 last_used_at。 */
    timeCol: string;
    hasSlot: boolean;
    hasLevels: boolean;
    defaultLimit: number;
}
export declare const TABLES: Record<QueryTableKey, TableSpec>;
export type Row = Record<string, unknown>;
/** 收束条件(全部可选;一个都不给 = 发散)。 */
export interface QueryFilters {
    slot?: string[];
    revealLevel?: number;
    signalLevel?: number;
}
export interface PickOptions {
    tableKey: QueryTableKey;
    kws: string[];
    filters: QueryFilters;
    /** 每槽位(clothing)或总数(其余)的条数。 */
    limit: number;
    /** 随机源,测试注入固定序列用。 */
    rng?: () => number;
}
/** 一级收束留痕:砍之前多少条 → 砍之后多少条。 */
export interface FilterStep {
    label: string;
    before: number;
    after: number;
}
/** clothing 的槽位分组:每槽位给前 limit 条候选。 */
export interface SlotGroup {
    /** 显示名:空槽位显示 `(未分类)`。 */
    slot: string;
    /** 库里的原始 slot 值(空槽位是空串)—— 分组过滤只能用它,别拿显示名当键。 */
    raw: string;
    rows: Row[];
    /** 该槽位在收束后的候选总数(≥ rows.length)。 */
    poolSize: number;
}
export interface PickResult {
    /** 命中池大小(收束后)。 */
    poolSize: number;
    /** 关键词匹配命中数(收束前)。 */
    matched: number;
    steps: FilterStep[];
    /** 非 clothing 的最终候选。 */
    rows: Row[];
    /** clothing 的槽位分组(按池内条数降序)。 */
    groups: SlotGroup[];
    /** 全表槽位分布(clothing 用,显示"库里还有什么")。 */
    slotStats: Array<{
        slot: string;
        count: number;
    }>;
    /** 参与匹配的查询词(≥2 字)。 */
    usedKws: string[];
    /** 被单字规则挡下的查询词。 */
    droppedKws: string[];
}
/** 关键词列解析:JSON 数组优先,回落裸逗号串(库里两种形态都出现过)。 */
export declare function parseKeywords(value: unknown): string[];
/** 查询词拆分:逗号分隔、去空白、去重。 */
export declare function splitKws(raw: unknown): string[];
/** 逗号分隔清单 → 数组(slot 参数)。 */
export declare function splitSlots(raw: unknown): string[];
/**
 * 关键词打分:只认**长度 ≥2** 的记录侧 token(单字 token 不作命中依据)。
 * 完全相等 +2,单向包含 +1。无查询词 → 恒 0(走发散)。
 */
export declare function scoreRow(row: Row, kws: string[]): number;
/**
 * 取候选:匹配 → 收束 → 池内抽取。
 *
 * 先洗牌再按分数**稳定**排序 —— 分数段内天然随机(每次调用结果会变),
 * 不用 hit_count 也不用"多久没用"当排序键。
 */
export declare function pickCandidates(rows: Row[], options: PickOptions): PickResult;
/** 槽位分布:按条数降序;空槽位归 `(未分类)`,排在最后。 */
export declare function slotDistribution(rows: Row[]): Array<{
    slot: string;
    count: number;
}>;
/** 条数钳制:1~50,非有限数回落默认。 */
export declare function clampLimit(value: unknown, fallback?: number): number;
/** 时间戳 → 相对时间文案(本地口径,库里的时间串本身就是 CST)。 */
export declare function fmtLastUsed(ts: unknown, now: Date): string;
export interface RenderInput {
    tableKey: QueryTableKey;
    kws: string[];
    pick: PickResult;
    /** 表总条数 / 被用过条数(表概览用)。 */
    total: number;
    usedCount: number;
    /** 本次生效的条数(clothing 是每槽位条数)。 */
    limit: number;
    /** ad_hoc 补位候选(调用方已按 name 去重)。 */
    adhoc: Array<{
        name: string;
        description: string;
    }>;
    now?: Date;
}
/** 渲染 query 结果为 markdown(有 kw 标题带关键词,无 kw 标"发散")。 */
export declare function renderQuery(input: RenderInput): string;
