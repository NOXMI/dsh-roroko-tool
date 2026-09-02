/**
 * roroko-tool 子插件参数覆盖 HTTP routes(仿 dshmarket /dsh-market/* 范式)。
 *
 * client 在设置页通过同源 fetch 读写本路由,绕开官方 settings 写只能
 * loopback 的限制(域名/隧道访问均可)。
 *
 *   GET  /roroko-tool/state  → 200 { preinject:{files,...}, data:{dbPath}, ... }
 *   POST /roroko-tool/state  → body { tool:'preinject', files/header/footer/... } 写参数
 *                            → body { tool:'data', dbPath } 写参数
 *   其余 method → 405;POST 非同一 Origin → 403。
 *
 * 2026-09-03 三改:enabled 开关退役(toggle 端点删除),state 只存参数覆盖,
 * 工具存在与否由 agent preset 声明决定。
 *
 * 状态存当前 profile 目录 roroko-tool-state.json(见 state.ts),跨重启保留。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
/** webServer 服务的最小结构面(host 提供真实 WebServer;此处只声明用到的面)。 */
export interface WebServerLike {
    register(route: {
        kind: 'exact';
        path: string;
        handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;
    }): () => void;
}
/** 挂载 state 路由,返回卸载函数。 */
export declare function registerStateRoutes(webServer: WebServerLike): () => void;
