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
 * 参数两层:preset 接线 `config` 兜底,host state 文件 preinject 节覆盖优先
 * (设置页编辑)。参数只影响注入内容,不改工具目录,不破坏 request-cache。
 */
import type { Context } from '@deepseek-ai/cordis';
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
}
export declare function apply(ctx: Context, config?: RorokoPreinjectConfig): void;
