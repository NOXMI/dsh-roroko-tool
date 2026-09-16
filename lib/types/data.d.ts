/**
 * roroko-data — 洛洛可素材库查询工具集(roroko-tool 电箱子功能)。
 *
 * 设计来源:nanobot 工作区 skill `roroko-datas`(roroko_datas.py +
 * update_soul_state.py)的设计逻辑,用 DSH 姿势重写——agent preset 层注册
 * 四个 agent 工具,直接经 `node:sqlite` 访问服务器 soul.db,不再外包 python
 * CLI。
 *
 *   roroko_datas_query  取料:表概览 + 候选召回(发散默认 / 条件收束),
 *                   穿搭按 slot 分组,返回 markdown 表格(省 token,LLM 原生友好)。
 *                   实现见 datas/query.ts + datas/query-form.ts。
 *   roroko_datas_lookup   按名在四张素材表查详情。
 *   roroko_datas_register 兜底:场景/衣物/道具/伴侣不在库中时注册入 ad_hoc,
 *                   主表同名则合并关键词回主表。
 *   roroko_datas_state     状态单行读写(表 soul_state):snap 读当前状态(带 staleness
 *                   陈旧度 + 鞭策),update 按字段更新(自动同步 *_updated
 *                   时间戳 / 计数器 / hit_count 联动)。
 *
 * 电箱闸门(2026-09-03 三改):原 `data.enabled` 运行级开关已退役——preset
 * 在 agent.cordis.yml 声明 `roroko-data` 行即注册四把工具,不声明即不存在。
 * 参数两层:preset 接线 `config.dbPath`(声明即配)优先,其次 host state 文件
 * data 节覆盖(设置页编辑),最后回落服务器默认路径。参数只影响连接哪个库,
 * 不改工具 schema,不破坏 request-cache。
 *
 * 数据层限制(安全):
 *   - 只认 soul.db 素材库,表名经白名单映射,杜绝任意表 SELECT *;
 *   - 关键词/名字查询全部参数化,不做字符串拼接;
 *   - SQL 里出现的表名列名全来自编译期白名单常量。
 *
 * 注:soul.db 路径默认 /var/www/api/database/soul.db(可经 preset config
 * 或设置页覆盖)。node:sqlite 为 node22 实验特性,服务器 wrapper 已强制 node22。
 */
import { DatabaseSync } from 'node:sqlite';
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "roroko-data";
/** 注入 tools 服务(注册 agent 工具必需)。 */
export declare const inject: string[];
/** roroko-data 接线 config:preset agent.cordis.yml 里 roroko-data 行可传。 */
export interface RorokoDataConfig {
    /** soul.db 绝对路径;缺省回落服务器默认路径(state 覆盖其次)。 */
    dbPath?: string;
}
/** roroko_datas_lookup 主逻辑:按名在四张素材表查详情 → markdown。 */
export declare function runLookup(db: DatabaseSync, nameQuery: string): string;
/** roroko_datas_register 主逻辑:ad_hoc 注册,或主表同名合并关键词。 */
export declare function runRegister(db: DatabaseSync, typeKey: string, nameInput: string, desc: string): string;
/**
 * roroko_datas_state snap:读 soul_state 当前状态,输出 markdown + staleness 鞭策。
 * 跨天自动清零今日计数器。
 */
export declare function runStateSnap(db: DatabaseSync, now: Date): string;
/** roroko_datas_state update:宽松 fields → 白名单列写回,含 incr 快捷计数。 */
export declare function runStateUpdate(db: DatabaseSync, fields: Record<string, unknown>, now: Date): string;
/** 注册四个素材库工具;preset 声明本插件即注册。 */
export declare function apply(ctx: Context, config?: RorokoDataConfig): void;
