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
import { type MemoryAddInput } from './memory-form.js';
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
