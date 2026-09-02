/**
 * @roroko-tool/dsh-roroko-tool — 洛洛可全家桶插件大包。
 *
 * host 默认入口提供 profile bundle 骨架:挂载电箱状态 HTTP route
 * (GET/POST /roroko-tool/state),client 设置页经同源 fetch 读写四工具
 * enabled 开关。
 *
 * 设计沿革(2026-09-02):原"纯电箱"设计经 settings 服务把 schema register
 * 到 DSH settings namespace、client 用 settingsScope 双向同步——被官方
 * loopback 写限制证伪(远程浏览器 settings 写 memory no-op)。现改为
 * dshmarket 同款范式:状态自存 profile 目录 state 文件 + webServer HTTP
 * route,域名/隧道访问都能拨开关。
 *
 * 子插件入口(未迁入,占位):
 *   ./preinject / ./data / ./warn — agent 侧,未来读本电箱 state。
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "roroko-tool";
export declare const pkgName = "@roroko-tool/dsh-roroko-tool";
export declare const version = "0.0.0";
/**
 * roroko-tool 电箱宿主(profile 层)。
 *
 * 挂载 state HTTP route;webServer 服务不可用(非 web profile)时静默跳过。
 */
export declare function apply(ctx: Context): void;
