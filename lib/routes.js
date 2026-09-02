/**
 * roroko-tool 电箱状态 HTTP routes(仿 dshmarket /dsh-market/* 范式)。
 *
 * client 在设置页通过同源 fetch 读写本路由,绕开官方 settings 写只能
 * loopback 的限制(域名/隧道访问均可)。
 *
 *   GET  /roroko-tool/state  → 200 { preinject:{enabled}, ... }
 *   POST /roroko-tool/state  → body { tool, enabled } → 200 { ok, state }
 *   其余 method → 405;POST 非同一 Origin → 403。
 *
 * 状态存当前 profile 目录 roroko-tool-state.json(见 state.ts),跨重启保留。
 */
import { isRorokoToolKey } from './settings.js';
import { loadState, setPreinjectConfig, setToolEnabled } from './state.js';
/** 写 JSON 响应(no-store)。 */
function sendJson(response, status, payload) {
    response.writeHead(status, {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
    });
    response.end(JSON.stringify(payload));
}
/** Origin 与 Host 一致才放行(变异端点必须;非浏览器无 Origin 一律拒)。 */
function sameOrigin(request) {
    const origin = request.headers.origin;
    const host = request.headers.host;
    if (origin === undefined || host === undefined)
        return false;
    try {
        return new URL(origin).host === host;
    }
    catch {
        return false;
    }
}
/** 读 JSON body,超 4 KiB 拒绝。 */
async function readJsonBody(request, maxBytes = 4096) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > maxBytes)
            throw new Error('request body too large');
        chunks.push(buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
/** 挂载 state 路由,返回卸载函数。 */
export function registerStateRoutes(webServer) {
    return webServer.register({
        kind: 'exact',
        path: '/roroko-tool/state',
        handler: async (request, response) => {
            try {
                if (request.method === 'GET') {
                    sendJson(response, 200, await loadState());
                    return;
                }
                if (request.method === 'POST') {
                    if (!sameOrigin(request)) {
                        sendJson(response, 403, { error: 'untrusted origin' });
                        return;
                    }
                    const body = (await readJsonBody(request));
                    if (!isRorokoToolKey(body.tool)) {
                        sendJson(response, 400, { error: 'tool must be one of preinject/data/warn/mark' });
                        return;
                    }
                    // preinject 配置节写入:body 带 files/header/footer/wrapInSystemReminder
                    // 任意一个即视为配置保存(仅 body 提供的字段覆盖);仅带 enabled 走开关 toggle。
                    if (body.tool === 'preinject'
                        && (body.files !== undefined
                            || body.header !== undefined
                            || body.footer !== undefined
                            || body.wrapInSystemReminder !== undefined)) {
                        const state = await setPreinjectConfig({
                            ...typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {},
                            ...body.files !== undefined ? { files: body.files } : {},
                            ...body.header !== undefined ? { header: body.header } : {},
                            ...body.footer !== undefined ? { footer: body.footer } : {},
                            ...typeof body.wrapInSystemReminder === 'boolean'
                                ? { wrapInSystemReminder: body.wrapInSystemReminder }
                                : {},
                        });
                        sendJson(response, 200, { ok: true, state });
                        return;
                    }
                    if (typeof body.enabled !== 'boolean') {
                        sendJson(response, 400, { error: 'enabled must be a boolean' });
                        return;
                    }
                    const state = await setToolEnabled(body.tool, body.enabled);
                    sendJson(response, 200, { ok: true, state });
                    return;
                }
                response.writeHead(405, { allow: 'GET, POST' });
                response.end();
            }
            catch (error) {
                sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
            }
        },
    });
}
