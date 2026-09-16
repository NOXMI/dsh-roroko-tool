/**
 * roroko-tool 子插件参数覆盖 HTTP routes(仿 dshmarket /dsh-market/* 范式)。
 *
 * client 在设置页通过同源 fetch 读写本路由,绕开官方 settings 写只能
 * loopback 的限制(域名/隧道访问均可)。
 *
 *   GET  /roroko-tool/state  → 200 { presets:{<id>:{preinject}}, data:{dbPath}, … }
 *                             另带一份兼容视图 preinject(公共桶 + 内置默认),旧设置页照读
 *   POST /roroko-tool/state  → body { tool:'preinject', preset?, systemFiles/… } 写该 preset 覆盖
 *                            → body { tool:'data', dbPath, autoinject? } 写参数
 *                            → body { tool:'mark', enabled } 写渲染开关
 *   其余 method → 405;POST 非同一 Origin → 403。
 *
 * 2026-09-03 三改:enabled 开关退役(toggle 端点删除),state 只存参数覆盖,
 * 工具存在与否由 agent preset 声明决定。
 * 2026-09-11 四改:preinject 覆盖按 agent preset 分桶,body 省略 preset 即写公共桶
 * common;请求体上限由 4 KiB 提到 64 KiB —— 两份文件清单 + 两组 header/footer
 * 很容易破 4 KiB,而旧上限的表现是保存时 500「request body too large」。
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
