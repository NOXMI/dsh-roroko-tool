/**
 * roroko-preinject — 工作区指令双段落点注入器(roroko-tool 电箱子功能)。
 *
 * 自独立旧插件 dsh-roroko-preinject 收编迁入 roroko-tool 大包(2026-09-02),
 * 2026-09-04 拆成两条腿:系统段进系统提示词,消息段进 user 消息。
 *
 * ── 系统段(system section)──────────────────────────────────────────────
 *
 * 文件内容进系统提示词:常驻、不占消息位、不被 compaction 折叠、每步现读。
 * 实现是「变量承载 + section 引用宏」两件套 —— 内容由 systemPrompt.variable
 * 提供(provider 每次装配按当前 agent 的会话 cwd 现读文件),section 的 text
 * 只写一个字面宏 `{{roroko_preinject_system}}`。
 *
 * 为什么绕这一道:renderPrompt 的 `{{}}` 插值是严格的,未知变量/空值/畸形
 * 引用一律抛错,文件正文里但凡有一个成组的 `{{xxx}}` 就直接打崩装配。而
 * "替换进去的值不会被二次扫描"是 renderPrompt 的明文语义 —— 内容走变量就
 * 天然免疫,文件正文里写什么花括号都安全。
 *
 * provider 三条硬规矩,缺一条都会打崩整个 turn:
 *   1. 内部 try/catch 兜底:provider 抛错会冒到 assemble();
 *   2. 读不到内容返回 `''` 而非 `undefined`:后者被判定「变量无值」同样抛错;
 *   3. header/footer 一并拼进变量值:留在 section 文本里就仍在插值扫描路径上。
 * 空串会让 renderPrompt 把该 section 整个 filter 掉 —— 未配置即零污染。
 *
 * 已知限制:section 的 order 在 apply(preset 挂载)时读一次,改 order 需要
 * 重新挂载 preset;文件清单则由 provider 每次装配现读 state,改了立刻生效。
 *
 * ── 消息段(user message)────────────────────────────────────────────────
 *
 * 文件合并成一条 user 消息,首个 entering step 注入一次,落库 `user/message`。
 *
 * The one-shot guard is durable-log-driven: once the injected message is
 * appended to the session log (agent.ts appends `decision.messages` as
 * `user/message` on step/start), every later pre-step — including a resumed
 * session after a process restart — finds it in `session.log` and skips
 * re-injection. Compaction folding the injection away naturally re-injects.
 * 系统段不落 log,不参与判重。
 *
 * 判重实现说明(2026-09-03 修复):曾尝试扫 `session.surface.nodes` 和
 * `session.events` 均失败——surface 是依赖 sessionProjections 的增量投影,
 * events 是 getter 在 agent preset 层访问实测为 undefined。改为直接遍历
 * `session.log`(Session 内部持久事件数组,seq 即索引,resume 后即完整),
 * 找带本插件 source 签名的 user/message,有则说明已注入过。实测:同一会话
 * 连续多 turn + 进程重启恢复后均不再重复注入。
 *
 * 参数三层(2026-09-11 四改):内置默认 ← preset 接线 `config` ← host state
 * 覆盖。覆盖层按会话的 agent preset id 取桶(state.presets[<id>]),具体桶叠在
 * 公共桶(common)之上;只有字段「缺失」才算未覆盖,空清单/空串都是显式设定。
 * 参数只影响注入内容,不改工具目录,不破坏 request-cache。
 *
 * preset id 取「当前生效」而非「创建时」(2026-09-14 修):`header.agentPreset`
 * 是创建事实,页面切 preset 只追加 `agent-preset/selected` 事件、header 不动,
 * 于是"先建后切"的会话里 `${presetDir}` 与参数分桶双双指向错的 preset。现改为
 * 读 log(见 resolveSessionPresetId),与官方 `agentPreset` Session 投影同一套语义。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { RorokoFilesPlacement } from './settings.js';
export declare const name = "roroko-preinject";
/** 系统提示词注册表必须就绪,才能注册 section 与变量。 */
export declare const inject: string[];
/** 接线 config(系统段 + 消息段的 preset 声明源,state 覆盖优先)。 */
export interface RorokoPreinjectConfig {
    /**
     * 接管 `deployment:persona` 槽位(带 complete,独占整个系统提示词),而非注册
     * 独立段。默认 false —— 未配置时用独立段名,即便被既有 complete 段压掉也不冲突。
     * 开启前必须先从 preset 删掉 `dsh-persona` 那行:同一 scope 内注册同名 section
     * 会直接抛错,agent 装配失败。
     */
    personaSection?: boolean;
    /**
     * 系统段文本的头部引子。字面拼进 section 文本,因此会走 renderPrompt 的严格
     * 插值 —— 可以写 `{{cwd}}` / `{{model}}` / `{{provider}}` 这类已注册宏,但写错
     * 一个未注册名就会当场抛错打崩装配。留空则整段只有正文。
     */
    personaHead?: string;
    /** 接管 persona 槽位时是否保留动态运行时上下文快照(默认保留;对应 dsh-persona 的 includeRuntimeContext)。 */
    includeRuntimeContext?: boolean;
    /** 系统段:待注入系统提示词的文件名(注入顺序)。 */
    systemFiles?: string[];
    /** 系统段基准 order(state 未覆盖时生效;接管 persona 槽位时固定用 DEPLOYMENT_PERSONA 的序位)。 */
    systemOrder?: number;
    /** 系统段:内容前插入的文本。 */
    systemHeader?: string;
    /** 系统段:内容后插入的文本。 */
    systemFooter?: string;
    /** 消息段:待注入 user 消息的文件名(注入顺序)。 */
    files?: string[];
    /** 消息段:是否整体包一层 <system-reminder>…</system-reminder>。 */
    wrapInSystemReminder?: boolean;
    /** 消息段:内容前插入的文本。 */
    header?: string;
    /** 消息段:内容后插入的文本。 */
    footer?: string;
    /**
     * 消息段落点:本批用户消息之后(默认,与官方 agent-instructions 同位)还是之前。
     * 想要"进 system 提示词"就把文件写进 `systemFiles` —— 那是另一条清单。
     */
    filesPlacement?: RorokoFilesPlacement;
    /** 消息段是否每个文件各注入一条(默认 false = 全部合并成一条)。 */
    splitFiles?: boolean;
}
/**
 * 取会话**当前生效**的 preset id,而不是「创建时」那个。
 *
 * `header.agentPreset` 是创建事实 —— 点"新建会话"就写死,此后在页面切 preset 只
 * 往 log 追加一条 `agent-preset/selected`,header 不更新(2026-09-14 本机实测:
 * header `roroko-gamedev`,4 秒后切 `roroko-dsh`,只有事件记着)。用 header 的后果
 * 是"先建后切"会话里 `${presetDir}` 指向不存在的目录 → 文件静默跳过、零报错,
 * 参数也静默回落公共桶。
 *
 * 语义与官方 `agentPreset` Session 投影一致(header 起手 + 最新一条选择事件,
 * 见 packages/preset/agent-presets/src/session.ts)。这里复刻而非声明
 * `sessionProjections` 服务依赖:服务缺席时插件整个不加载,为一个 id 不值。
 */
export declare function resolveSessionPresetId(log: readonly unknown[] | null | undefined, headerPreset: string | undefined): string | undefined;
/**
 * 解析单条注入路径;返回 undefined 表示这条跳过(空串,或宏拿不到值)。
 *
 * 支持写法:
 *   ${presetDir}/IDENTITY.md  → <dshHome>/.agent-presets/<会话 preset id>/
 *   ${dshHome}/roroko/X.md    → $DSH_HOME(缺省 ~/.dsh)
 *   ~/shared/X.md             → 用户主目录
 *   其他相对路径               → 相对会话 cwd(与旧行为一致)
 *   绝对路径                   → path.resolve 原样返回(天然支持)
 *
 * 限制:${presetDir} 用的是推导路径 —— 官方 shipped root 或自定义 root 下的
 * preset 不在此列,那类 preset 请直接写绝对路径。
 */
export declare function resolveInjectionPath(raw: string, cwd: string, presetId: string | undefined): string | undefined;
/**
 * 计算注入位置:紧跟本插件"认领"的那批用户消息之后(默认,与官方
 * agent-instructions 同位),或之前。
 *
 * claimedIndex<0(本步没有认领到任何用户消息)时一律落到数组开头 —— 此刻
 * "之后"没有可依附的对象,而且 toSpliced 收负数会从尾部倒数,不夹住就会把
 * 注入插到消息流中间。
 */
export declare function injectionIndex(claimedIndex: number, placement: RorokoFilesPlacement): number;
export declare function apply(ctx: Context, config?: RorokoPreinjectConfig): void;
