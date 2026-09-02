import { registerStateRoutes } from './routes.js';
export const name = 'roroko-tool';
export const pkgName = '@roroko-tool/dsh-roroko-tool';
export const version = '0.0.0';
/**
 * roroko-tool 宿主(profile 层)。
 *
 * 挂载参数覆盖 HTTP route;webServer 服务不可用(非 web profile)时静默跳过。
 */
export function apply(ctx) {
    const host = ctx;
    host.inject?.(['webServer'], (scoped) => {
        const dispose = registerStateRoutes(scoped.webServer);
        host.effect?.(() => dispose, 'roroko-tool: state routes');
    });
}
