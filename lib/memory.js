import { defineTool } from '@deepseek-ai/dsh-tools';
import { RorokoMemoryDefaultDbPath, RorokoMemoryDefaultOwner } from './settings.js';
import { loadStateSync } from './state.js';
import { MEMORY_ROUGH_DEFAULT_LIMIT, MEMORY_ROUGH_MAX_LIMIT, fmtCst, normalizeAdd, normalizeOwner, normalizeReflect, } from './memory-form.js';
import { openMemoryDb, runAdd, runDate, runId, runReflect, runRough } from './memory-store.js';
import { DREAM_DEFAULT_MAX_TOKENS, normalizeDreamConfig } from './memory-dream-form.js';
import { claimDreamStart, defaultDreamLogDir, dreamRuntime, runDreamOnce, startDreamTimer, } from './memory-dream.js';
import { runDreamSession, } from './memory-dream-session.js';
export const name = 'roroko-memory';
/** 注入 tools 服务(注册 agent 工具必需)。 */
export const inject = ['tools'];
/**
 * 接 dream 机制。
 *
 * **刻意不声明 `inject`** —— 照机制结论 10 的教训:为一个可选功能去声明服务依赖,
 * 服务一旦缺席(诊断场合、headless 裁剪)会让**整个记忆子插件不加载**,四把工具一起消失。
 * 这里一律用 `ctx.get(...)` 动态取,取不到就记一条日志、dream 不启动,工具照常。
 *
 * 2026-09-21 会话化:载体从"一次性 llm 调用"换成**一次性会话** —— 于是要拿的是
 * agents / sessions(必)与 agentPresets(可选:没有它就没有人设与工具,但仍能跑)。
 */
function applyDream(ctx, dbPath, owner, config) {
    // preset config 的 dream 当底座,state 覆盖层(面板)叠在上面 —— 字段级,state 优先
    const presetDream = typeof config.dream === 'object' && config.dream !== null
        ? config.dream
        : {};
    /** 每次现算生效配置:面板改了 provider/model/间隔,不必重启宿主。 */
    const resolveDream = () => normalizeDreamConfig({ ...presetDream, ...loadStateSync().dream });
    if (!resolveDream().enabled)
        return;
    // 进程级去重:同一个库只跑一份定时器(插件按 preset/会话装配,apply 可能被调多次)
    if (!claimDreamStart(dbPath)) {
        ctx.logger?.info?.(`[roroko-memory] dream 已在管 ${dbPath},本次不重复启动定时器`);
        return;
    }
    const get = (key) => ctx.get?.(key);
    const agents = get('agents');
    const sessions = get('sessions');
    const presets = get('agentPresets');
    if (agents === undefined || sessions === undefined) {
        ctx.logger?.info?.('[roroko-memory] dream 未启动:agents/sessions 服务不可用');
        return;
    }
    if (presets === undefined) {
        ctx.logger?.info?.('[roroko-memory] dream 起会话时没有 preset 名册:会话里不会有人设与工具行');
    }
    if (resolveDream().provider.length === 0) {
        ctx.logger?.info?.('[roroko-memory] dream 已启用但未配 provider/model,每次都会跳过');
    }
    /** 按当前配置造一次执行的依赖(现算,所以配置是活的)。 */
    const makeDeps = (dream) => ({
        dbPath,
        owner,
        provider: dream.provider,
        model: dream.model,
        batch: dream.batch,
        logDir: defaultDreamLogDir(dbPath),
        now: () => new Date(),
        runSession: (prompt, bookmark) => runDreamSession({
            agents,
            sessions,
            presets,
            pluginName: name,
            cwd: dream.cwd,
            presetId: dream.preset,
            agentOptions: {
                provider: dream.provider,
                model: dream.model,
                maxTokens: DREAM_DEFAULT_MAX_TOKENS,
            },
        }, prompt, bookmark),
    });
    /**
     * 跑一次并把结果贴到共享面 —— 定时器与手动触发共用同一条路,顺便防并发
     * (同一时刻只允许一个 dream 在跑,免得两轮同时写同一条记忆)。
     */
    const runOnce = async () => {
        const dream = resolveDream();
        const skip = (note) => ({
            queued: 0, skippedLogs: 0, sessionId: '', preset: '', added: 0, changed: [], note,
        });
        if (!dream.enabled)
            return skip('已在面板关闭,跳过');
        if (dream.provider.length === 0 || dream.model.length === 0)
            return skip('未配置模型(provider/model),跳过');
        if (dreamRuntime.running)
            return skip('上一次还在跑,本次跳过');
        dreamRuntime.running = true;
        try {
            const result = await runDreamOnce(makeDeps(dream));
            dreamRuntime.last = { ...result, at: fmtCst(new Date()) };
            return result;
        }
        finally {
            dreamRuntime.running = false;
        }
    };
    dreamRuntime.config = resolveDream();
    dreamRuntime.resolve = resolveDream;
    dreamRuntime.run = runOnce;
    const timer = startDreamTimer({
        intervalMs: () => resolveDream().intervalMs,
        run: async () => {
            const result = await runOnce();
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
/** 注册四把记忆工具;preset 声明本插件即注册。 */
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
            + '写进哪个桶由插件配置决定,工具不带桶参数。',
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
                owner: defaultOwner,
                content: args.content,
                summary: args.summary,
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
        },
        output: { schema: { type: 'string' }, render: textRender },
        async execute(args) {
            return withDb(db => runDate(db, { from: args.from, to: args.to }, defaultOwner, new Date()));
        },
        presentCall(args) {
            const span = args.from !== undefined && args.from.length > 0 ? args.from : '今天+昨天';
            return { card: 'generic', title: `回查记忆 · ${span}`, kind: 'read', rawInput: span };
        },
    });
    const roughTool = defineTool({
        name: 'roroko_mem_rough',
        description: '洛洛可记忆关键词检索:返回命中的 id / 时间 / 类别 / 摘要。'
            + '**想不起某事时先调它**,别硬编。keywords 用空格或逗号分隔(≤8 个词,**每个词都要出现**才命中)。'
            + '查不到会明说"没有匹配上" —— 那是关键词没对上,**不许据此编造记忆**;少给一个词再试。'
            + '摘要不够判断时再用 roroko_mem_id 取全文。',
        parameters: {
            keywords: {
                type: 'string',
                required: true,
                description: '检索词,空格/逗号分隔,如 "记忆 检索 落地"(每个词都要出现)。',
            },
            limit: {
                type: 'number',
                description: `返回条数,缺省 ${MEMORY_ROUGH_DEFAULT_LIMIT},上限 ${MEMORY_ROUGH_MAX_LIMIT}。`,
            },
        },
        output: { schema: { type: 'string' }, render: textRender },
        async execute(args) {
            return withDb(db => runRough(db, { keywords: args.keywords, limit: args.limit }, defaultOwner));
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
            + '只在本桶里找。',
        parameters: {
            id: {
                type: 'number',
                required: true,
                description: '记忆 id(正整数,来自检索或按日期回查的结果)。',
            },
        },
        output: { schema: { type: 'string' }, render: textRender },
        async execute(args) {
            return withDb(db => runId(db, { id: args.id }, defaultOwner));
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
