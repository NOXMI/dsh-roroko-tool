/**
 * roroko-data — 洛洛可素材库查询工具集(roroko-tool 电箱子功能)。
 *
 * 设计来源:nanobot 工作区 skill `roroko-datas`(roroko_datas.py +
 * update_soul_state.py)的设计逻辑,用 DSH 姿势重写——agent preset 层注册
 * 四个 agent 工具,直接经 `node:sqlite` 访问服务器 soul.db,不再外包 python
 * CLI。
 *
 *   roroko_query    按关键词查素材(scene/clothing/items/companion),
 *                   返回 markdown 表格(省 token,LLM 原生友好)。
 *   roroko_lookup   按名在四张素材表查详情。
 *   roroko_register 兜底:场景/衣物/道具/伴侣不在库中时注册入 ad_hoc,
 *                   主表同名则合并关键词回主表。
 *   roroko_soul     soul_state 单行读写:snap 读当前状态(带 staleness
 *                   陈旧度 + 鞭策),update 按字段更新(自动同步 *_updated
 *                   时间戳 / 计数器 / hit_count 联动)。
 *
 * 电箱闸门:data.enabled 默认关(安装即熄火)。agent preset 接线本插件后,
 * apply 同步读 host state;enabled=false 时不注册任何工具(模型目录里干净,
 * 不占 token)。要启用:WebGUI 设置页拨开 data 开关 → 重启 host 让 agent
 * preset 重新挂载。dbPath 同样读 state(可覆盖默认 soul.db 路径)。
 *
 * 数据层限制(安全):
 *   - 只认 soul.db 素材库,表名经白名单映射,杜绝任意表 SELECT *;
 *   - 关键词/名字查询全部参数化,不做字符串拼接;
 *   - SQL 里出现的表名列名全来自编译期白名单常量。
 *
 * 注:soul.db 路径默认 /var/www/api/database/soul.db(可从电箱 data.dbPath
 * 覆盖)。node:sqlite 为 node22 实验特性,服务器 wrapper 已强制 node22。
 */
import { DatabaseSync } from 'node:sqlite';
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "roroko-data";
/** 注入 tools 服务(注册 agent 工具必需)。 */
export declare const inject: string[];
/** roroko_query 主逻辑:关键词查素材 → markdown。 */
export declare function runQuery(db: DatabaseSync, tableKey: string, kwRaw: string): string;
/** roroko_lookup 主逻辑:按名在四张素材表查详情 → markdown。 */
export declare function runLookup(db: DatabaseSync, nameQuery: string): string;
/** roroko_register 主逻辑:ad_hoc 注册,或主表同名合并关键词。 */
export declare function runRegister(db: DatabaseSync, typeKey: string, nameInput: string, desc: string): string;
/**
 * roroko_soul snap:读 soul_state 当前状态,输出 markdown + staleness 鞭策。
 * 跨天自动清零今日计数器。
 */
export declare function runSoulSnap(db: DatabaseSync, now: Date): string;
/** roroko_soul update:宽松 fields → 白名单列写回,含 incr 快捷计数。 */
export declare function runSoulUpdate(db: DatabaseSync, fields: Record<string, unknown>, now: Date): string;
/** 注册四个素材库工具;data.enabled=false 时不注册。 */
export declare function apply(ctx: Context): void;
