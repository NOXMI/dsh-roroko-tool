import z from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
//#region src/presets.d.ts
/** 公共默认桶名。 */
declare const COMMON = "common";
/** 一个桶里能覆盖的字段。 */
interface PreinjectBucket {
  systemFiles?: string[];
  userFiles?: string[];
  suppressSections?: string[];
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
/**
 * 段名是否命中抹除清单。
 * 清单项以 `*` 结尾时按前缀匹配（`tool:*` 抹掉所有 `tool:` 开头的段）。
 */
declare function matchesSuppress(name: string, patterns: readonly string[]): boolean;
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
  /** 要抹掉的系统段名清单（装配后按名过滤）。 */
  suppressSections?: string[];
}
/** 内置默认（最底层）。 */
declare const DEFAULTS: Required<Omit<PreinjectConfig, 'enabled' | 'root' | 'suppressHarnessIdentity'>>;
/** 四层合成后的有效参数。 */
interface EffectiveConfig {
  systemFiles: string[];
  userFiles: string[];
  suppressSections: string[];
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
  /** 总开关：false/未设 = 不注册四把工具、不注入 state 短条。 */
  enabled?: boolean;
  dbPath?: string;
  autoinject?: Partial<AutoinjectSettings>;
}
/** 整份覆盖层状态。 */
interface DatasState {
  presets: Record<string, DatasBucket>;
}
/** 四层合成后的有效参数。 */
interface EffectiveDatas {
  /** 总开关：默认关，设置页勾选才开。 */
  enabled: boolean;
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
//#region src/memory/form.d.ts
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
declare function fmtCst(date: Date): string;
/** 闭区间 [from, to],两端都是 'YYYY-MM-DD'。 */
interface DateRange {
  from: string;
  to: string;
}
/** 区间解析结果:要么给区间,要么给一条人话错误。 */
type RangeResult = {
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
declare function resolveRange(fromRaw: unknown, toRaw: unknown, now: Date): RangeResult;
/** 写入一条记忆的合法形状。 */
interface MemoryAddInput {
  owner: string;
  content: string;
  summary: string;
  /** 内部字段:只有导入历史流水的脚本会写 'log';工具侧不再暴露。 */
  kind: string;
  source: string;
}
/** add 入参收窄结果。 */
type AddResult = {
  input: MemoryAddInput;
  error?: undefined;
} | {
  input?: undefined;
  error: string;
};
/** add 入参收窄:owner/content/summary 必填,source 可省;kind 固定留空(导入脚本自己填)。 */
declare function normalizeAdd(raw: Record<string, unknown>): AddResult;
/** 反思一条记忆的合法形状。 */
interface MemoryReflectInput {
  id: number;
  content: string;
  /** 空串 = 保留原 summary 不动。 */
  summary: string;
}
/** reflect 入参收窄结果。 */
type ReflectResult = {
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
declare function normalizeReflect(raw: Record<string, unknown>): ReflectResult;
/** 库里读回来的一行(只列本工具用得到的列)。 */
interface MemoryRow {
  id: number;
  owner: string;
  content?: string;
  summary: string;
  created_at: string;
  reflected_at: string | null;
  kind: string | null;
  source?: string | null;
}
/**
 * 切关键词:按分隔符切、转小写、去重、保序,超上限截断。
 * 词原样拿去 SQL 做包含匹配 —— 不做分词、不做相似度。
 */
declare function splitKeywords(raw: unknown): string[];
/**
 * 转义 LIKE 的通配符 —— 关键词里的 % _ \ 必须当普通字符,否则
 * `100%` 会变成"以 100 开头的一切"。
 */
declare function escapeLike(word: string): string;
//#endregion
//#region src/memory/dream-form.d.ts
/**
 * 不进反思队列的 kind —— 历史日志(`kind=log`)是逐字入库的开发流水,
 * 再让模型逐条提炼一遍纯属白烧 token(2026-09-20 阿一拍)。
 */
declare const DREAM_SKIP_KINDS: readonly string[];
/**
 * dream 配置。默认**开着**但没配模型 —— 未配就每次静默跳过(照抄 nanobot 的
 * "默认开",隔离靠 preset 里换/关配置,不靠默认值)。
 */
interface DreamConfig {
  enabled: boolean;
  intervalMs: number;
  batch: number;
  provider: string;
  model: string;
  /** 用哪个 preset 起会话(空串 = 该部署的默认 preset)。 */
  preset: string;
  /** 会话的工作目录(空串 = 进程 cwd)。 */
  cwd: string;
}
/** dream 内置默认(preset 不传就用它)。 */
declare const DREAM_DEFAULTS: DreamConfig;
/** dream 配置归一化:非法字段逐个回落默认,不抛。 */
declare function normalizeDreamConfig(raw: unknown): DreamConfig;
/** 队列筛选结果。 */
interface DreamQueue {
  /** 本次要整理的条目(最久没反思的在前)。 */
  entries: MemoryRow[];
  /** 排除掉的日志条数(给回执说明用)。 */
  skippedLogs: number;
}
/**
 * 队列口径:`reflected_at` 为空、不在跳过 kind 里,按 created_at 升序取前 limit 条。
 * 库里取回来时已按时间排好,这里只做过滤与截断 —— 纯函数,好测。
 */
declare function pickQueue(rows: MemoryRow[], limit: number): DreamQueue;
/**
 * 组装任务书。**只给清单**(id / 时间 / 摘要预览),正文让模型自己用
 * `roroko_mem_id` 取、改完用 `roroko_mem_edit(op=reflect)` 覆盖回去。
 * 第一段是"记忆整理模式"声明 —— 这是阿一定的那句:让它知道现在不是对话/开发情景。
 */
declare function buildDreamTask(entries: MemoryRow[]): string;
/**
 * 门禁:比对写回前后的 `reflected_at`,只认真落下去的那些(照抄 nanobot 的
 * "审计只认 diff,不认模型自述")。返回真变了的 id。
 */
declare function diffReflected(before: MemoryRow[], after: MemoryRow[]): number[];
//#endregion
//#region src/memory/presets.d.ts
/** 公共默认桶名。 */
declare const COMMON$1 = "common";
/** 服务器默认库路径（与 soul.db 同目录，备份一起走）。 */
declare const DEFAULT_MEMORY_DB_PATH = "/var/www/api/database/roroko_memory.db";
/** 默认 owner 桶。 */
declare const DEFAULT_OWNER = "dev";
/** 接线参数（preset 的 config.memory）。 */
interface MemoryConfig {
  /** false 时不挂载本模块。 */
  enabled?: boolean;
  /** 身份根（覆盖层目录的基准），默认 $DSH_HOME/roroko。 */
  root?: string;
  /** 记忆库路径。 */
  dbPath?: string;
  /** owner 桶。 */
  owner?: string;
  /** dream（定时反思）的接线层字段。 */
  dream?: Partial<DreamConfig>;
}
/** 一个桶里能覆盖的字段（dream 逐字段叠加，不是整组替换）。 */
interface MemoryBucket {
  /** 总开关：false/未设 = 不注册四把工具、不起 dream。 */
  enabled?: boolean;
  dbPath?: string;
  owner?: string;
  dream?: Partial<DreamConfig>;
}
/** 整份覆盖层状态。 */
interface MemoryState {
  presets: Record<string, MemoryBucket>;
}
/** 四层合成后的有效参数。 */
interface EffectiveMemory {
  /** 总开关：默认关，设置页勾选才开。 */
  enabled: boolean;
  dbPath: string;
  owner: string;
  dream: DreamConfig;
}
/** 覆盖层文件。 */
declare function memoryStateFile(root: string): string;
/** 读整份覆盖层（同步：pre-step 判定要用）。 */
declare function readMemoryState(root: string): MemoryState;
/**
 * 部分覆盖某个桶：body 里给了的字段盖上去，没给的保留。
 * 传 `null` 表示删掉该键；合并后空桶直接删掉（回到跟随下层）。
 */
declare function setMemoryBucket(root: string, scope: string, patch: Record<string, unknown>): Promise<MemoryState>;
/** 删掉某个桶（该 preset 回到公共默认 / 接线 config）。 */
declare function clearMemoryBucket(root: string, scope: string): Promise<MemoryState>;
/** 接线层原样（没写的字段就是没写）。 */
declare function memoryWiring(config: MemoryConfig): Record<string, unknown>;
/**
 * 四层合成：默认 ← 接线 config ← 公共桶 ← 分 preset 桶。
 * @param config - preset 接线层。
 * @param state - 覆盖层状态。
 * @param presetId - 会话的 preset id；空 = 只吃公共桶。
 */
declare function resolveMemory(config: MemoryConfig, state: MemoryState, presetId: string | undefined): EffectiveMemory;
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
  memory?: MemoryConfig | boolean;
}
/**
 * 跨 scope 的服务句柄：playest scope 是独立子 fiber，agent / session 注册表那类
 * 全局服务在里面不一定看得见 —— dream 要起会话，只能由 profile 层这一侧先握在手里
 * 再交给子模块。晚到也没关系：inject 的回调会在服务就绪时补上。
 */
interface AgentServices {
  agents?: unknown;
  sessions?: unknown;
  presets?: unknown;
}
/**
 * 插件入口。
 * @param ctx - 本行插件所在的上下文（profile 层或 preset scope）。
 * @param config - 见 {@link RorokoToolConfig}。
 */
declare function apply(ctx: Context, config?: RorokoToolConfig): void;
//#endregion
export { AUTOINJECT_DEFAULTS, AgentServices, COMMON, Config, DEFAULTS, DEFAULT_DB_PATH, DEFAULT_MEMORY_DB_PATH, DEFAULT_OWNER, DREAM_DEFAULTS, DREAM_SKIP_KINDS, COMMON$1 as MEMORY_COMMON, RorokoToolConfig, TABLES, apply, buildDreamTask, cleanAutoinject, clearBucket, clearDatasBucket, clearMemoryBucket, datasStateFile, datasWiring, diffReflected, escapeLike, fmtCst, matchesSuppress, memoryStateFile, memoryWiring, name, normalizeAdd, normalizeDreamConfig, normalizeReflect, pickCandidates, pickQueue, readDatasState, readMemoryState, readState, renderQuery, resolveBucket, resolveDatas, resolveEffective, resolveMemory, resolveRange, scoreRow, setBucket, setDatasBucket, setMemoryBucket, splitKeywords, splitKws, version };