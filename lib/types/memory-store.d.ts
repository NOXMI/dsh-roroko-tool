/**
 * roroko 记忆库访问层:开库建表 / 写入 / 按日期回查 / 关键词检索。
 *
 * 只依赖 `node:sqlite` 与 memory-form.ts(纯逻辑),**不 import DSH 运行时包** ——
 * 测试可以直接 import 本产物真跑临时库,不需要替身钩子。
 *
 * 连接策略:每次 execute 独立开关一条连接(与 roroko_datas_* 同款);开库即建表,
 * 幂等。sqlite 不会自己建目录,所以先补父目录。
 *
 * 减法(2026-09-21):检索从"全表取回 + bigram 打分"改成**一条 SQL**(每个关键词都要
 * 命中,LIKE 包含匹配);删掉召回计数与 owner 分桶开关。桶由调用方固定传进来。
 */
import { DatabaseSync } from 'node:sqlite';
import { type MemoryAddInput, type MemoryReflectInput } from './memory-form.js';
/**
 * 开库 + 建表(幂等)。父目录不存在则补建 —— sqlite 遇缺目录直接报错。
 * 建表失败会让插件 apply 抛错 → 调用方自己 try/catch,别拖垮 preset 挂载。
 */
export declare function openMemoryDb(dbPath: string): DatabaseSync;
/** 写一条记忆:created_at 由服务端按 CST 生成,reflected_at 留 NULL(待反思)。 */
export declare function runAdd(db: DatabaseSync, input: MemoryAddInput, now: Date): {
    id: number;
    createdAt: string;
    text: string;
};
/**
 * 反思一条记忆:直接覆盖 content(设计稿 §五 5.3,防膨胀)、刷 reflected_at,
 * summary 传了才一起换。owner/kind/source 一概不动。
 * 查不到 id 返回人话,不抛。
 */
export declare function runReflect(db: DatabaseSync, input: MemoryReflectInput, now: Date): string;
/** 按日期回查入参(区间两端)。 */
export interface DateQuery {
    from?: unknown;
    to?: unknown;
}
/**
 * 按日期回查:拿 created_at 前 10 位(纯日期)做字符串比较,避开时间部分。
 * 区间非法时返回人话错误,不抛 —— 工具执行失败会污染整轮。
 */
export declare function runDate(db: DatabaseSync, query: DateQuery, owner: string, now: Date): string;
/** 检索 / 取全文 / dream 共用的列(改动这里要顺手看一眼各处渲染)。 */
export declare const MEMORY_COLUMNS = "id, owner, content, summary, created_at, reflected_at, source, kind";
/** 关键词检索入参。 */
export interface RoughQuery {
    keywords?: unknown;
    limit?: unknown;
}
/**
 * 关键词检索:**一条 SQL**,每个关键词都要在 content 或 summary 里出现(LIKE 包含匹配,
 * 通配符已转义)。命中按时间倒序取 limit 条 —— 没有打分、没有相似度、没有召回计数。
 * 关键词切不出东西时返回人话,不抛(工具抛错会污染整轮)。
 */
export declare function runRough(db: DatabaseSync, query: RoughQuery, owner: string): string;
/** 按 id 取全文入参。 */
export interface IdQuery {
    id?: unknown;
}
/**
 * 按 id 取一条的完整内容(摘要不足以判断时才用)。只在**本桶**里找,查不到返回人话,不抛。
 */
export declare function runId(db: DatabaseSync, query: IdQuery, owner: string): string;
