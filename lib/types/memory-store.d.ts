/**
 * roroko 记忆库访问层:开库建表 / 写入 / 按日期回查。
 *
 * 只依赖 `node:sqlite` 与 memory-form.ts(纯逻辑),**不 import DSH 运行时包** ——
 * 测试可以直接 import 本产物真跑临时库,不需要替身钩子。
 *
 * 连接策略:每次 execute 独立开关一条连接(与 roroko_datas_* 同款);开库即建表,
 * 幂等。sqlite 不会自己建目录,所以先补父目录。
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
 * summary 传了才一起换。owner/kind/source/recalled 一概不动。
 * 查不到 id 返回人话,不抛。
 */
export declare function runReflect(db: DatabaseSync, input: MemoryReflectInput, now: Date): string;
/** 按日期回查入参。 */
export interface DateQuery {
    from?: unknown;
    to?: unknown;
    /** undefined = 全部桶(不跨桶是默认纪律,这里是显式放宽口)。 */
    owner?: string;
}
/**
 * 按日期回查:拿 created_at 前 10 位(纯日期)做字符串比较,避开时间部分。
 * 区间非法时返回人话错误,不抛 —— 工具执行失败会污染整轮。
 */
export declare function runDate(db: DatabaseSync, query: DateQuery, now: Date): string;
/** 检索 / 取全文 / dream 共用的列(改动这里要顺手看一眼各处渲染)。 */
export declare const MEMORY_COLUMNS = "id, owner, content, summary, created_at, reflected_at, recalled, source, kind";
/** 关键词检索入参。 */
export interface RoughQuery {
    keywords?: unknown;
    /** undefined = 全部桶。 */
    owner?: string;
    limit?: unknown;
}
/**
 * 关键词模糊检索(字符 bigram + 覆盖度):候选先按 owner 全取回来,再在内存里打分。
 * 记忆量级是千级,全取比在 SQL 里做匹配更简单,也把打分逻辑留在纯函数里好测。
 * 关键词切不出东西时返回人话,不抛(工具抛错会污染整轮)。
 */
export declare function runRough(db: DatabaseSync, query: RoughQuery): string;
/** 按 id 取全文入参。 */
export interface IdQuery {
    id?: unknown;
    /** 有值就校验归属;不给 = 不限桶(id 全局唯一,调用方负责拿对)。 */
    owner?: string;
}
/**
 * 按 id 取一条的完整内容(摘要不足以判断时才用),顺带 recalled += 1。
 * 查不到返回人话,不抛。
 */
export declare function runId(db: DatabaseSync, query: IdQuery): string;
