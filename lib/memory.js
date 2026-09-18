import { defineTool } from '@deepseek-ai/dsh-tools';
import { RorokoMemoryDefaultDbPath, RorokoMemoryDefaultOwner } from './settings.js';
import { MEMORY_OWNERS, normalizeAdd, normalizeOwner } from './memory-form.js';
import { openMemoryDb, runAdd, runDate } from './memory-store.js';
export const name = 'roroko-memory';
/** 注入 tools 服务(注册 agent 工具必需)。 */
export const inject = ['tools'];
/** "看全部桶"的显式取值。 */
const OWNER_ALL = 'all';
/** 工具输出统一渲染:text content block。 */
function textRender(_args, value) {
    return [{ type: 'text', text: value }];
}
/** 解析生效库路径:preset config 优先 → 内置默认。 */
function resolveDbPath(config) {
    if (config.dbPath !== undefined && config.dbPath.trim().length > 0)
        return config.dbPath.trim();
    return RorokoMemoryDefaultDbPath;
}
/** 解析生效 owner 桶:preset config 优先 → 内置默认。 */
function resolveOwner(config) {
    return normalizeOwner(config.owner) ?? RorokoMemoryDefaultOwner;
}
/** 注册两把记忆工具;preset 声明本插件即注册。 */
export function apply(ctx, config = {}) {
    const dbPath = resolveDbPath(config);
    const defaultOwner = resolveOwner(config);
    // 挂载即建表(幂等):库不可写时**不抛** —— 别让一个坏路径把 preset 挂载拖垮。
    try {
        openMemoryDb(dbPath).close();
    }
    catch {
        // 真正取用时会报明确错误
    }
    /** 每次调用独立开关连接。 */
    const withDb = (fn) => {
        const db = openMemoryDb(dbPath);
        try {
            return fn(db);
        }
        finally {
            db.close();
        }
    };
    const editTool = defineTool({
        name: 'roroko_mem_edit',
        description: '洛洛可记忆写入。op=add 记一条经历记忆:content 是初摘要,summary 是粗筛/回查时看到的那句。'
            + '写入前先过三问:①人设或画像层已经有了?→ 不记 ②永久有效且每轮都该生效?→ 去改人设文件,不进这张表 '
            + '③它能改变我未来某个场景的行为?→ 记,并写成「触发条件 → 应做」。'
            + '必记四类:边界与安全词的演变 / 有效或无效的挑逗 / 未完成的钩子 / 我自己的失手记录。'
            + '不记素材与此刻状态(那是 roroko_datas_* 的地盘);不记人设里已有的偏好。'
            + `owner 缺省 = 当前 preset 配的桶(常用:${MEMORY_OWNERS.join(' / ')})。`,
        parameters: {
            op: {
                type: 'string',
                required: true,
                enum: ['add'],
                description: 'add=写一条新记忆(reflect 反思待 M4 开放)。',
            },
            content: {
                type: 'string',
                required: true,
                description: '初摘要:发生了什么 + 结论。写成「触发条件 → 应做」的形式最难被遗忘。',
            },
            summary: {
                type: 'string',
                required: true,
                description: '二次摘要:一句话,粗筛与按日期回查时看到的就是它(≤300 字)。',
            },
            owner: {
                type: 'string',
                description: `桶名,缺省 = preset 配的桶(${MEMORY_OWNERS.join(' / ')})。`,
            },
            kind: {
                type: 'string',
                description: '可选类别:event|fact|boundary|preference|thread|reflection。',
            },
            source: {
                type: 'string',
                description: '可选出处:会话 id 或 会话 id#事件序号(回原文的唯一凭据)。',
            },
        },
        output: { schema: { type: 'string' }, render: textRender },
        async execute(args) {
            const normalized = normalizeAdd({
                owner: args.owner !== undefined && args.owner.trim().length > 0 ? args.owner : defaultOwner,
                content: args.content,
                summary: args.summary,
                kind: args.kind,
                source: args.source,
            });
            if (normalized.input === undefined)
                return `写入失败: ${normalized.error}`;
            return withDb(db => runAdd(db, normalized.input, new Date()).text);
        },
        presentCall(args) {
            return {
                card: 'generic',
                title: '记一条记忆',
                kind: 'other',
                rawInput: String(args.summary ?? args.content ?? '').slice(0, 40),
            };
        },
    });
    const dateTool = defineTool({
        name: 'roroko_mem_date',
        description: '洛洛可记忆按日期回查:返回 id / 时间 / 类别 / 摘要 / 未反思标记。'
            + '默认区间 = 今天 + 昨天 —— **会话开始时先调它**(它取代了旧的 memory/*.md 必读);'
            + '他问"某天干了什么"时也用它。'
            + `owner 缺省 = 当前 preset 配的桶(${MEMORY_OWNERS.join(' / ')});要看所有桶传 owner=all。`
            + '要看某条的完整内容用 roroko_mem_id(下一刀开放)。',
        parameters: {
            from: {
                type: 'string',
                description: '起始日期 YYYY-MM-DD;不给 = 昨天(配 to 不给即今天+昨天)。',
            },
            to: {
                type: 'string',
                description: '结束日期 YYYY-MM-DD;只给 to = 查那一天。',
            },
            owner: {
                type: 'string',
                description: `桶名,缺省 = preset 配的桶;传 ${OWNER_ALL} 看所有桶。`,
            },
        },
        output: { schema: { type: 'string' }, render: textRender },
        async execute(args) {
            const rawOwner = typeof args.owner === 'string' ? args.owner.trim().toLowerCase() : '';
            let owner;
            if (rawOwner === OWNER_ALL)
                owner = undefined;
            else if (rawOwner.length > 0) {
                owner = normalizeOwner(rawOwner);
                if (owner === undefined)
                    return `owner 非法: ${args.owner}`;
            }
            else
                owner = defaultOwner;
            return withDb(db => runDate(db, { from: args.from, to: args.to, owner }, new Date()));
        },
        presentCall(args) {
            const span = args.from !== undefined && args.from.length > 0 ? args.from : '今天+昨天';
            return { card: 'generic', title: `回查记忆 · ${span}`, kind: 'read', rawInput: span };
        },
    });
    ctx.tools.register(editTool);
    ctx.tools.register(dateTool);
}
