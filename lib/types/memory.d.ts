/**
 * roroko-memory — 洛洛可经历记忆工具集(roroko-tool 电箱子功能)。
 *
 * 设计来源:`refs/notes/roroko-memory-design-v1.md`(2026-09-17 定稿)。用 DSH 姿势
 * 实现:agent preset 层注册四把 agent 工具,直连独立库 `roroko_memory.db`
 * (`node:sqlite`),不外包 python、不引入向量、不新增注入。
 *
 *   roroko_mem_edit  写记忆 / 反思:add 落一条;reflect 整条覆盖 + 刷反思时间。
 *   roroko_mem_date  按日期回查:默认今天 + 昨天(会话开始必读),带未反思统计。
 *   roroko_mem_rough 关键词检索:一条 SQL LIKE(每个词都要命中)。
 *   roroko_mem_id    按 id 取全文(含 source provenance)。
 *
 * 2026-09-21 减法(阿一:"工具就只是简单的 sqlite 工具"):删掉 bigram 打分 / 覆盖度 /
 * 召回计数 / owner=all / kind 入参 —— 细节见 memory-form.ts 的文件头与 README §5.6。
 *
 * 电箱闸门(2026-09-18 阿一拍板 · A 案):**preset 声明即开关** ——
 * 需要在哪个工作区用记忆,就在那个 preset 里写 `roroko-memory` 行;不写即不存在。
 * 不做运行级开关:工具集属会话装配面,动态启停会打爆 request-cache(见 `fac49eb`)。
 *
 * 参数两层:preset 接线 config.dbPath / config.owner 优先,其次内置默认
 * (库路径服务器默认 /var/www/api/database/roroko_memory.db,owner 默认 dev)。
 * 参数只影响连哪个库、写哪个桶,不改工具 schema。
 *
 * 数据层限制(安全):只认 memory 一张表,表名列名全来自编译期常量;所有值走
 * 参数化绑定,不做字符串拼接;owner 走白名单式收窄(小写字母数字与 . _ -)。
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "roroko-memory";
/** 注入 tools 服务(注册 agent 工具必需)。 */
export declare const inject: string[];
/** roroko-memory 接线 config:preset agent.cordis.yml 里 roroko-memory 行可传。 */
export interface RorokoMemoryConfig {
    /** 记忆库绝对路径;缺省回落服务器默认路径。 */
    dbPath?: string;
    /** 缺省 owner 桶(工具不传 owner 时用它);缺省回落 dev。 */
    owner?: string;
    /** dream 配置(enabled / intervalMs / batch / provider / model / preset / cwd)。 */
    dream?: unknown;
}
/** 注册四把记忆工具;preset 声明本插件即注册。 */
export declare function apply(ctx: Context, config?: RorokoMemoryConfig): void;
