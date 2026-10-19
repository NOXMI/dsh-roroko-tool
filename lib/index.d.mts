import z from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
//#region src/presets.d.ts
/** 公共默认桶名。 */
declare const COMMON = "common";
/** 一个桶里能覆盖的字段。 */
interface PreinjectBucket {
  systemFiles?: string[];
  userFiles?: string[];
}
/** 整份状态。 */
interface PreinjectState {
  presets: Record<string, PreinjectBucket>;
}
/** 读整份状态（同步：系统段 provider 不能 await）。 */
declare function readState(root: string): PreinjectState;
/**
 * 部分覆盖某个桶：body 里给了的字段盖上去，没给的保留。
 * 合并后空桶直接删掉（回到跟随公共默认 / 接线 config），不留空桶压住下层。
 * @param root - 身份根。
 * @param scope - 桶名（common 或 preset id）。
 * @param patch - 待写入字段。
 * @returns 落盘后的整份状态。
 */
declare function setBucket(root: string, scope: string, patch: Record<string, unknown>): Promise<PreinjectState>;
/**
 * 删掉某个桶（该 preset 回到公共默认 / 接线 config）。
 * @param root - 身份根。
 * @param scope - 桶名。
 * @returns 落盘后的整份状态。
 */
declare function clearBucket(root: string, scope: string): Promise<PreinjectState>;
/**
 * 解析某个 preset 的覆盖层：具体桶叠在公共桶之上，只叠存在的字段。
 * @param state - 整份状态。
 * @param presetId - 会话的 preset id；空 = 只看公共桶。
 * @returns 合成后的覆盖层。
 */
declare function resolveBucket(state: PreinjectState, presetId: string | undefined): PreinjectBucket;
//#endregion
//#region src/preinject.d.ts
/**
 * 消息来源是 merge-extensible 的和类型：每个生产者在自己模块里声明自己的 kind。
 * v4 之后没有 catch-all 的 `plugin` kind，所以这里必须自己登记。
 */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'roroko-preinject': {
      kind: 'roroko-preinject';
    };
  }
}
/** 接线参数（preset 的 config.preinject）：一层可选基线，不写就走默认。 */
interface PreinjectConfig {
  /** false 时不挂载本模块。 */
  enabled?: boolean;
  /** 文件基准目录，默认 $DSH_HOME/roroko。 */
  root?: string;
  /** 接线层的系统层清单。 */
  systemFiles?: string[];
  /** 接线层的用户层清单。 */
  userFiles?: string[];
  /** 顶掉 "You are an AI agent powered by DeepSeek Harness." 这个开场白。 */
  suppressHarnessIdentity?: boolean;
}
/** 内置默认（最底层）。 */
declare const DEFAULTS: Required<Omit<PreinjectConfig, 'enabled' | 'root' | 'suppressHarnessIdentity'>>;
/** 四层合成后的有效参数。 */
interface EffectiveConfig {
  systemFiles: string[];
  userFiles: string[];
}
/**
 * 四层合成：默认 ← 接线 config ← 公共桶 ← 分 preset 桶。
 * @param config - preset 接线层。
 * @param state - 覆盖层状态。
 * @param presetId - 会话的 preset id；空 = 只吃公共桶。
 * @returns 该 preset 生效的参数。
 */
declare function resolveEffective(config: PreinjectConfig, state: PreinjectState, presetId: string | undefined): EffectiveConfig;
//#endregion
//#region src/datas/presets.d.ts
/** 服务器默认库路径（0.1.6 一贯口径）。 */
declare const DEFAULT_DB_PATH = "/var/www/api/database/soul.db";
/** state 自动注入的开关与节奏。 */
interface AutoinjectSettings {
  /** 轮数触发总开关。 */
  rounds: boolean;
  /** 每 N 轮注一次。 */
  every: number;
  /** 取过料后注入。 */
  afterTool: boolean;
  /** 两次注入之间至少隔 N 轮（0 = 不限制）。 */
  minGap: number;
}
/** 内置默认（最底层）。 */
declare const AUTOINJECT_DEFAULTS: AutoinjectSettings;
/** 接线参数（preset 的 config.datas）。 */
interface DatasConfig {
  /** false 时不挂载本模块。 */
  enabled?: boolean;
  /** 身份根（覆盖层目录的基准），默认 $DSH_HOME/roroko。 */
  root?: string;
  /** soul.db 路径。 */
  dbPath?: string;
  /** state 自动注入。 */
  autoinject?: Partial<AutoinjectSettings>;
}
/** 一个桶里能覆盖的字段（autoinject 逐字段叠加，不是整组替换）。 */
interface DatasBucket {
  dbPath?: string;
  autoinject?: Partial<AutoinjectSettings>;
}
/** 整份覆盖层状态。 */
interface DatasState {
  presets: Record<string, DatasBucket>;
}
/** 四层合成后的有效参数。 */
interface EffectiveDatas {
  dbPath: string;
  autoinject: AutoinjectSettings;
}
/** 覆盖层文件。 */
declare function datasStateFile(root: string): string;
/** autoinject 清洗：只留给了的字段，一个都没给就丢（返回 undefined = 这一组没覆盖）。 */
declare function cleanAutoinject(value: unknown): Partial<AutoinjectSettings> | undefined;
/** 读整份覆盖层（同步：pre-step 判定要用）。 */
declare function readDatasState(root: string): DatasState;
/**
 * 部分覆盖某个桶：body 里给了的字段盖上去，没给的保留。
 * 传 `null` 表示删掉该键；合并后空桶直接删掉（回到跟随下层）。
 * @param root - 身份根。
 * @param scope - 桶名（common 或 preset id）。
 * @param patch - 待写入字段。
 * @returns 落盘后的整份状态。
 */
declare function setDatasBucket(root: string, scope: string, patch: Record<string, unknown>): Promise<DatasState>;
/**
 * 删掉某个桶（该 preset 回到公共默认 / 接线 config）。
 * @param root - 身份根。
 * @param scope - 桶名。
 * @returns 落盘后的整份状态。
 */
declare function clearDatasBucket(root: string, scope: string): Promise<DatasState>;
/** 接线层原样（没写的字段就是没写）。 */
declare function datasWiring(config: DatasConfig): Record<string, unknown>;
/**
 * 四层合成：默认 ← 接线 config ← 公共桶 ← 分 preset 桶。
 * @param config - preset 接线层。
 * @param state - 覆盖层状态。
 * @param presetId - 会话的 preset id；空 = 只吃公共桶。
 * @returns 该 preset 生效的参数。
 */
declare function resolveDatas(config: DatasConfig, state: DatasState, presetId: string | undefined): EffectiveDatas;
//#endregion
//#region src/datas/query-form.d.ts
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
type QueryTableKey = 'scene' | 'clothing' | 'items' | 'companion';
/** 表的真实形状 —— 列名以库为准,不以文档为准。 */
interface TableSpec {
  table: string;
  nameCol: string;
  /** "最后使用"列:companion_pool 用 last_used,其余用 last_used_at。 */
  timeCol: string;
  hasSlot: boolean;
  hasLevels: boolean;
  defaultLimit: number;
}
declare const TABLES: Record<QueryTableKey, TableSpec>;
type Row = Record<string, unknown>;
/** 收束条件(全部可选;一个都不给 = 发散)。 */
interface QueryFilters {
  slot?: string[];
  revealLevel?: number;
  signalLevel?: number;
}
interface PickOptions {
  tableKey: QueryTableKey;
  kws: string[];
  filters: QueryFilters;
  /** 每槽位(clothing)或总数(其余)的条数。 */
  limit: number;
  /** 随机源,测试注入固定序列用。 */
  rng?: () => number;
}
/** 一级收束留痕:砍之前多少条 → 砍之后多少条。 */
interface FilterStep {
  label: string;
  before: number;
  after: number;
}
/** clothing 的槽位分组:每槽位给前 limit 条候选。 */
interface SlotGroup {
  /** 显示名:空槽位显示 `(未分类)`。 */
  slot: string;
  /** 库里的原始 slot 值(空槽位是空串)—— 分组过滤只能用它,别拿显示名当键。 */
  raw: string;
  rows: Row[];
  /** 该槽位在收束后的候选总数(≥ rows.length)。 */
  poolSize: number;
}
interface PickResult {
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
/** 查询词拆分:逗号分隔、去空白、去重。 */
declare function splitKws(raw: unknown): string[];
/**
 * 关键词打分:只认**长度 ≥2** 的记录侧 token(单字 token 不作命中依据)。
 * 完全相等 +2,单向包含 +1。无查询词 → 恒 0(走发散)。
 */
declare function scoreRow(row: Row, kws: string[]): number;
/**
 * 取候选:匹配 → 收束 → 池内抽取。
 *
 * 先洗牌再按分数**稳定**排序 —— 分数段内天然随机(每次调用结果会变),
 * 不用 hit_count 也不用"多久没用"当排序键。
 */
declare function pickCandidates(rows: Row[], options: PickOptions): PickResult;
interface RenderInput {
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
declare function renderQuery(input: RenderInput): string;
//#endregion
//#region src/index.d.ts
declare const name = "roroko-tool";
/** 子模块配置：schema 化之后，Plugins 页才有本插件自己的页面与表单。 */
declare const Config: z<RorokoToolConfig>;
/** 本包版本（设置页显示用）。 */
declare const version = "0.1.0";
/** 插件配置：一层桶对应一个子模块；桶设成 false 即不挂载。 */
interface RorokoToolConfig {
  preinject?: PreinjectConfig | boolean;
  datas?: DatasConfig | boolean;
}
/**
 * 插件入口。
 * @param ctx - 本行插件所在的上下文（profile 层或 preset scope）。
 * @param config - 见 {@link RorokoToolConfig}。
 */
declare function apply(ctx: Context, config?: RorokoToolConfig): void;
//#endregion
export { AUTOINJECT_DEFAULTS, COMMON, Config, DEFAULTS, DEFAULT_DB_PATH, RorokoToolConfig, TABLES, apply, cleanAutoinject, clearBucket, clearDatasBucket, datasStateFile, datasWiring, name, pickCandidates, readDatasState, readState, renderQuery, resolveBucket, resolveDatas, resolveEffective, scoreRow, setBucket, setDatasBucket, splitKws, version };