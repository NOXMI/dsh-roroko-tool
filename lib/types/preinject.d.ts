/**
 * roroko-preinject — 一次性工作区指令注入器(roroko-tool 电箱子功能)。
 *
 * 自独立旧插件 dsh-roroko-preinject 收编迁入 roroko-tool 大包(2026-09-02)。
 * 原实现在 git 6dc2415 迁入后因 settings 退役被回退占位;本次恢复注入逻辑,
 * 闸门从「settings 服务」改为「读电箱 state 文件」(roroko-tool-state.json)。
 *
 * Reads a fixed list of files from the agent's session cwd and injects them
 * once as a single user message on the first entering agent step.
 *
 * Unlike `@deepseek-ai/dsh-agent-instructions`, this plugin does NOT watch for
 * file changes and never re-injects updated instructions.
 *
 * The one-shot guard is durable-history-driven: once the injected message is
 * appended to the session event log (agent.ts appends `decision.messages` as
 * `user/message` on step/start), every later pre-step — including a resumed
 * session after a process restart — finds it on the surface and skips
 * re-injection. Compaction folding the injection away naturally re-injects,
 * matching the `agent-instructions` baseline contract.
 *
 * 电箱闸门(roroko-tool 设置):agent 层动手前读 host 的 state 文件(roroko-tool-
 * state.json,同进程共享文件系统),`preinject.enabled === false` 即熄火、不注入。
 * 注入参数(files/header/footer/wrapInSystemReminder)同样读自 state,由 webgui
 * 设置页编辑;本插件的 config 不再要求接线方提供。
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "roroko-preinject";
/** Services required before the injector may scan the session surface.
 *  Aligns with `@deepseek-ai/dsh-agent-instructions` so the one-shot guard
 *  reads a fully-projected surface after a process restart (no re-injection
 *  on resume). */
export declare const inject: string[];
/** 兼容旧接线 config(可选;优先取电箱 state)。 */
export interface RorokoPreinjectConfig {
    /** File names, relative to the session cwd, in injection order. */
    files?: string[];
    /** Whether to wrap the final text in `<system-reminder> ... </system-reminder>`. */
    wrapInSystemReminder?: boolean;
    /** Optional text inserted before the merged file content. */
    header?: string;
    /** Optional text inserted after the merged file content. */
    footer?: string;
}
export declare function apply(ctx: Context, config: RorokoPreinjectConfig): void;
