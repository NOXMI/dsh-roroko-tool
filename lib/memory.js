import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { RorokoMemoryDefaultDbPath, RorokoMemoryDefaultOwner } from './settings.js';
import { MEMORY_OWNERS, MEMORY_ROUGH_DEFAULT_LIMIT, MEMORY_ROUGH_MAX_LIMIT, normalizeAdd, normalizeOwner, normalizeReflect, } from './memory-form.js';
import { openMemoryDb, runAdd, runDate, runId, runReflect, runRough } from './memory-store.js';
import { normalizeDreamConfig } from './memory-dream-form.js';
import { defaultDreamLogDir, runDreamOnce, startDreamTimer } from './memory-dream.js';
export const name = 'roroko-memory';
/** 注入 tools 服务(注册 agent 工具必需)。 */
export const inject = ['tools'];
/**
 * 调一次模型,拼出纯文本回复。
 * 消息走官方 `createUserMessage` 构造器(别手搓消息对象);终止原因不是 stop 就抛错 ——
 * 截断/报错的回复交给 dream 的解析层判失败,绝不"装作跑过"。
 */
async function callModelOnce(llm, dream, prompt) {
    const options = {
        provider: dream.provider,
        model: dream.model,
        messages: [createUserMessage({
                content: [{ type: 'text', text: prompt }],
                source: { kind: 'plugin', plugin: name },
            })],
        maxTokens: dream.maxTokens,
    };
    let text = '';
    for await (const chunk of llm.stream(options)) {
        if (chunk.type === 'text-delta') {
            if (typeof chunk.text === 'string')
                text += chunk.text;
            continue;
        }
        if (chunk.type === 'finish') {
            const kind = chunk.reason?.kind;
            if (kind === 'error' || kind === 'aborted') {
                throw new Error(`模型调用未完成(${kind}): ${chunk.reason?.failure?.message ?? ''}`);
            }
        }
    }
    if (text.trim().length === 0)
        throw new Error('模型没有输出任何文本');
    return text;
}
/**
 * 接 dream 机制。
 *
 * **刻意不声明 `inject: ['llm']`** —— 照机制结论 10 的教训:为一个可选功能去声明服务
 * 依赖,服务一旦缺席(诊断场合、headless 裁剪)会让**整个记忆子插件不加载**,四把工具
 * 一起消失。这里用 `ctx.get('llm')` 动态取,取不到就记一条日志、dream 不启动,工具照常。
 */
function applyDream(ctx, dbPath, owner, config) {
    const dream = normalizeDreamConfig(config.dream);
    if (!dream.enabled)
        return;
    const llm = ctx.get?.('llm');
    if (llm === undefined || typeof llm.stream !== 'function') {
        ctx.logger?.info?.('[roroko-memory] dream 未启动:llm 服务不可用');
        return;
    }
    if (dream.provider.length === 0 || dream.model.length === 0) {
        ctx.logger?.info?.('[roroko-memory] dream 已启用但未配 provider/model,每次都会跳过');
    }
    const deps = {
        dbPath,
        owner,
        provider: dream.provider,
        model: dream.model,
        batch: dream.batch,
        maxTokens: dream.maxTokens,
        logDir: dream.logDir.length > 0 ? dream.logDir : defaultDreamLogDir(dbPath),
        now: () => new Date(),
        callModel: prompt => callModelOnce(llm, dream, prompt),
    };
    const timer = startDreamTimer({
        intervalMs: dream.intervalMs,
        run: async () => {
            const result = await runDreamOnce(deps);
            if (result.error !== undefined)
                ctx.logger?.warn?.(`[roroko-memory] dream: ${result.note}`);
            else
                ctx.logger?.info?.(`[roroko-memory] dream: ${result.note}`);
        },
        now: () => new Date(),
        onError: error => ctx.logger?.warn?.(`[roroko-memory] dream 定时器异常: ${String(error)}`),
    });
    // 插件卸载时收掉定时器(定时器本身已 unref,漏了也不会挂住进程退出)
    ctx.effect(() => () => timer.dispose());
}
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
/**
 * 解析工具入参里的 owner:'all' → undefined(全桶)、空 → preset 缺省桶、
 * 其他走 normalizeOwner 收窄。非法时给 error 字符串(工具返回人话,不抛)。
 */
function resolveOwnerArg(raw, fallback) {
    const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (value === OWNER_ALL)
        return {};
    if (value.length === 0)
        return { owner: fallback };
    const owner = normalizeOwner(value);
    if (owner === undefined)
        return { error: `owner 非法: ${String(raw)}` };
    return { owner };
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
        description: '洛洛可记忆的写入与反思。'
            + 'op=add 记一条新记忆:content 是初摘要,summary 是粗筛/回查时看到的那句。'
            + '**写入前先过三问**:①人设或画像层已经有了?→ 不记 ②永久有效且每轮都该生效?→ 去改人设文件,不进这张表 '
            + '③它能改变我未来某个场景的行为?→ 记,并写成「触发条件 → 应做」。'
            + '必记四类:边界与安全词的演变 / 有效或无效的挑逗 / 未完成的钩子 / 我自己的失手记录。'
            + '不记素材与此刻状态(那是 roroko_datas_* 的地盘);不记人设里已有的偏好。'
            + 'op=reflect 反思已有那条(id):**整条覆盖 content**、刷新反思时间,summary 不传就保留原样;'
            + '适用 = 记错了 / 记得太啰嗦 / 有了更准的结论。'
            + '**观点变了或出现矛盾时别覆盖,用 op=add 另记一条**(保留矛盾,不消解)。'
            + `owner 缺省 = 当前 preset 配的桶(常用:${MEMORY_OWNERS.join(' / ')});reflect 不看 owner。`,
        parameters: {
            op: {
                type: 'string',
                required: true,
                enum: ['add', 'reflect'],
                description: 'add=写一条新记忆;reflect=反思并覆盖已有的那条。',
            },
            id: {
                type: 'number',
                description: 'op=reflect 必需:要反思的记忆 id(来自 roroko_mem_rough / roroko_mem_date 的结果)。',
            },
            content: {
                type: 'string',
                required: true,
                description: 'add=初摘要(发生了什么 + 结论);reflect=新的 content 正文,整条覆盖而非追加。',
            },
            summary: {
                type: 'string',
                description: 'add 必需;reflect 不传则保留原 summary。二次摘要:粗筛与按日期回查时看到的就是它(≤300 字)。',
            },
            owner: {
                type: 'string',
                description: `桶名,缺省 = preset 配的桶(${MEMORY_OWNERS.join(' / ')})。`,
            },
            kind: {
                type: 'string',
                description: '可选类别:event|fact|boundary|preference|thread|reflection(add 才用)。',
            },
            source: {
                type: 'string',
                description: '可选出处:会话 id 或 会话 id#事件序号(回原文的唯一凭据;add 才用)。',
            },
        },
        output: { schema: { type: 'string' }, render: textRender },
        async execute(args) {
            if (args.op === 'reflect') {
                const reflected = normalizeReflect({ id: args.id, content: args.content, summary: args.summary });
                if (reflected.input === undefined)
                    return `反思失败: ${reflected.error}`;
                return withDb(db => runReflect(db, reflected.input, new Date()));
            }
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
            if (args.op === 'reflect') {
                return {
                    card: 'generic',
                    title: `反思 #${args.id}`,
                    kind: 'other',
                    rawInput: String(args.content ?? '').slice(0, 40),
                };
            }
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
            + '要看某条的完整内容用 roroko_mem_id;想不起某事的细节用 roroko_mem_rough。',
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
            const resolved = resolveOwnerArg(args.owner, defaultOwner);
            if (resolved.error !== undefined)
                return resolved.error;
            return withDb(db => runDate(db, { from: args.from, to: args.to, owner: resolved.owner }, new Date()));
        },
        presentCall(args) {
            const span = args.from !== undefined && args.from.length > 0 ? args.from : '今天+昨天';
            return { card: 'generic', title: `回查记忆 · ${span}`, kind: 'read', rawInput: span };
        },
    });
    const roughTool = defineTool({
        name: 'roroko_mem_rough',
        description: '洛洛可记忆关键词检索:按字符 bigram 算命中与覆盖度(零向量),返回 id / 时间 / 命中数 / 覆盖度 / 摘要。'
            + '**想不起某事时先调它**,别硬编。keywords 用空格或逗号分隔(≤8 个词,单字词也认)。'
            + '查不到会明说"没有匹配上" —— 那是关键词没对上,**不许据此编造记忆**。'
            + '返回的每条 recalled 自动 +1;摘要不够判断时再用 roroko_mem_id 取全文。'
            + `owner 缺省 = 当前 preset 配的桶(${MEMORY_OWNERS.join(' / ')});传 ${OWNER_ALL} 看所有桶。`,
        parameters: {
            keywords: {
                type: 'string',
                required: true,
                description: '检索词,空格/逗号分隔,如 "记忆 召回 bigram"。',
            },
            owner: {
                type: 'string',
                description: `桶名,缺省 = preset 配的桶(${MEMORY_OWNERS.join(' / ')});传 ${OWNER_ALL} 看所有桶。`,
            },
            limit: {
                type: 'number',
                description: `返回条数,缺省 ${MEMORY_ROUGH_DEFAULT_LIMIT},上限 ${MEMORY_ROUGH_MAX_LIMIT}。`,
            },
        },
        output: { schema: { type: 'string' }, render: textRender },
        async execute(args) {
            const resolved = resolveOwnerArg(args.owner, defaultOwner);
            if (resolved.error !== undefined)
                return resolved.error;
            return withDb(db => runRough(db, { keywords: args.keywords, owner: resolved.owner, limit: args.limit }));
        },
        presentCall(args) {
            const words = String(args.keywords ?? '').slice(0, 40);
            return { card: 'generic', title: `检索记忆 · ${words}`, kind: 'read', rawInput: words };
        },
    });
    const idTool = defineTool({
        name: 'roroko_mem_id',
        description: '洛洛可记忆按 id 取完整内容(初摘要 content + 出处 source)。'
            + 'id 从 roroko_mem_rough / roroko_mem_date 的结果里拿 —— **只在摘要不足以判断时才取,别一次捞一堆**。'
            + '取用会把该条 recalled +1。owner 不给就跨桶(id 全局唯一),带了就只认该桶。',
        parameters: {
            id: {
                type: 'number',
                required: true,
                description: '记忆 id(正整数,来自检索或按日期回查的结果)。',
            },
            owner: {
                type: 'string',
                description: '可选:限定桶名,防跨桶误取。',
            },
        },
        output: { schema: { type: 'string' }, render: textRender },
        async execute(args) {
            const raw = typeof args.owner === 'string' ? args.owner.trim() : '';
            const owner = raw.length > 0 ? normalizeOwner(raw) : undefined;
            if (raw.length > 0 && owner === undefined)
                return `owner 非法: ${raw}`;
            return withDb(db => runId(db, { id: args.id, owner }));
        },
        presentCall(args) {
            return { card: 'generic', title: `读记忆 #${args.id}`, kind: 'read', rawInput: String(args.id) };
        },
    });
    ctx.tools.register(editTool);
    ctx.tools.register(dateTool);
    ctx.tools.register(roughTool);
    ctx.tools.register(idTool);
    // 机制层:dream 定时整理(不发 schema,不注册工具;开关在 config.dream)
    applyDream(ctx, dbPath, defaultOwner, config);
}
