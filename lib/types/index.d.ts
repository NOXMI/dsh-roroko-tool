/**
 * @roroko-tool/dsh-roroko-tool — 洛洛可全家桶插件大包。
 *
 * host 默认入口提供 profile bundle 骨架:挂载子插件参数覆盖 HTTP route
 * (GET/POST /roroko-tool/state),client 设置页经同源 fetch 编辑参数。
 *
 * 设计沿革:
 * - 2026-09-02:原"纯电箱"设计经 settings 服务把 schema register 到 DSH
 *   settings namespace、client 用 settingsScope 双向同步——被官方 loopback
 *   写限制证伪(远程浏览器 settings 写 memory no-op)。改为 dshmarket 同款
 *   范式:状态自存 profile 目录 state 文件 + webServer HTTP route。
 * - 2026-09-03:四工具 enabled 运行级开关退役——agent preset 声明哪个子
 *   插件,装配就带哪个功能;state 只存参数覆盖(设置页编辑),预设 config
 *   兜底。运行级动态启停会改变会话工具集/注入,打爆 request-cache。
 *
 * 子插件入口:
 *   ./preinject — 一次性注入器:preset 声明即启用,注入参数读 state 覆盖。
 *   ./data      — 素材库查询/注册 + soul_state 读写四工具,preset 声明即注册。
 *   ./warn / ./mark — 占位未迁入。
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "roroko-tool";
export declare const pkgName = "@roroko-tool/dsh-roroko-tool";
export declare const version = "0.0.0";
/**
 * roroko-tool 宿主(profile 层)。
 *
 * 挂载参数覆盖 HTTP route;webServer 服务不可用(非 web profile)时静默跳过。
 */
export declare function apply(ctx: Context): void;
