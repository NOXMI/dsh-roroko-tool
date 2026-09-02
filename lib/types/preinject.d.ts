/**
 * roroko-preinject — 一次性工作区指令注入器(roroko-tool 电箱子功能)。
 *
 * 自独立旧插件 dsh-roroko-preinject 收编迁入 roroko-tool 大包(2026-09-02)。
 *
 * Reads a fixed list of files from the agent's session cwd and injects them
 * once as a single user message on the first entering agent step.
 *
 * Unlike `@deepseek-ai/dsh-agent-instructions`, this plugin does NOT watch for
 * file changes and never re-injects updated instructions.
 *
 * The one-shot guard is durable-log-driven: once the injected message is
 * appended to the session log (agent.ts appends `decision.messages` as
 * `user/message` on step/start), every later pre-step — including a resumed
 * session after a process restart — finds it in `session.events` and skips
 * re-injection. Compaction folding the injection away naturally re-injects.
 *
 * 电箱闸门(roroko-tool 设置):agent 层动手前读 host 的 state 文件(roroko-tool-
 * state.json,同进程共享文件系统),`preinject.enabled === false` 即熄火、不注入。
 * 注入参数(files/header/footer/wrapInSystemReminder)同样读自 state,由 webgui
 * 设置页编辑。
 *
 * 判重实现说明(2026-09-03 修复):曾尝试扫 `session.surface.nodes` 和
 * `session.events` 均失败——surface 是依赖 sessionProjections 的增量投影,
 * events 是 getter 在 agent preset 层访问实测为 undefined。改为直接遍历
 * `session.log`(Session 内部持久事件数组,seq 即索引,resume 后即完整),
 * 找带本插件 source 签名的 user/message,有则说明已注入过。实测:同一会话
 * 连续多 turn + 进程重启恢复后均不再重复注入。
 *
 * 参数(2026-09-03 三改):enabled 运行级开关退役——preset 声明本插件即启用
 * 注入。files/header/footer/wrapInSystemReminder 两层:preset 接线
 * `config`(声明即配)兜底,host state 文件 preinject 节覆盖优先(设置页编辑)。
 * 参数只影响注入内容,不改工具目录,不破坏 request-cache。
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "roroko-preinject";
/** 接线 config(2026-09-03 三改:成为注入参数的 preset 声明源)。 */
export interface RorokoPreinjectConfig {
    files?: string[];
    wrapInSystemReminder?: boolean;
    header?: string;
    footer?: string;
}
export declare function apply(ctx: Context, config?: RorokoPreinjectConfig): void;
