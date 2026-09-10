/**
 * roroko-preinject — 工作区指令双段落点注入器(roroko-tool 电箱子功能)。
 *
 * 自独立旧插件 dsh-roroko-preinject 收编迁入 roroko-tool 大包(2026-09-02),
 * 2026-09-04 拆成两条腿:系统段进系统提示词,消息段进 user 消息。
 *
 * ── 系统段(system section)──────────────────────────────────────────────
 *
 * 文件内容进系统提示词:常驻、不占消息位、不被 compaction 折叠、每步现读。
 * 实现是「变量承载 + section 引用宏」两件套 —— 内容由 systemPrompt.variable
 * 提供(provider 每次装配按当前 agent 的会话 cwd 现读文件),section 的 text
 * 只写一个字面宏 `{{roroko_preinject_system}}`。
 *
 * 为什么绕这一道:renderPrompt 的 `{{}}` 插值是严格的,未知变量/空值/畸形
 * 引用一律抛错,文件正文里但凡有一个成组的 `{{xxx}}` 就直接打崩装配。而
 * "替换进去的值不会被二次扫描"是 renderPrompt 的明文语义 —— 内容走变量就
 * 天然免疫,文件正文里写什么花括号都安全。
 *
 * provider 三条硬规矩,缺一条都会打崩整个 turn:
 *   1. 内部 try/catch 兜底:provider 抛错会冒到 assemble();
 *   2. 读不到内容返回 `''` 而非 `undefined`:后者被判定「变量无值」同样抛错;
 *   3. header/footer 一并拼进变量值:留在 section 文本里就仍在插值扫描路径上。
 * 空串会让 renderPrompt 把该 section 整个 filter 掉 —— 未配置即零污染。
 *
 * 已知限制:section 的 order 在 apply(preset 挂载)时读一次,改 order 需要
 * 重新挂载 preset;文件清单则由 provider 每次装配现读 state,改了立刻生效。
 *
 * ── 消息段(user message)────────────────────────────────────────────────
 *
 * 文件合并成一条 user 消息,首个 entering step 注入一次,落库 `user/message`。
 *
 * The one-shot guard is durable-log-driven: once the injected message is
 * appended to the session log (agent.ts appends `decision.messages` as
 * `user/message` on step/start), every later pre-step — including a resumed
 * session after a process restart — finds it in `session.log` and skips
 * re-injection. Compaction folding the injection away naturally re-injects.
 * 系统段不落 log,不参与判重。
 *
 * 判重实现说明(2026-09-03 修复):曾尝试扫 `session.surface.nodes` 和
 * `session.events` 均失败——surface 是依赖 sessionProjections 的增量投影,
 * events 是 getter 在 agent preset 层访问实测为 undefined。改为直接遍历
 * `session.log`(Session 内部持久事件数组,seq 即索引,resume 后即完整),
 * 找带本插件 source 签名的 user/message,有则说明已注入过。实测:同一会话
 * 连续多 turn + 进程重启恢复后均不再重复注入。
 *
 * 参数两层:preset 接线 `config` 兜底,host state 文件 preinject 节覆盖优先
 * (设置页编辑)。参数只影响注入内容,不改工具目录,不破坏 request-cache。
 */
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { PERSONA_SECTION } from '@deepseek-ai/dsh-system-prompt';
import { loadState, loadStateSync } from './state.js';
import { RorokoPreinjectDefaultSystemOrder } from './settings.js';
export const name = 'roroko-preinject';
/** 系统段 section 名(同层唯一;scoped 注册会 shadow 同名全局段)。 */
const SYSTEM_SECTION = 'roroko:preinject';
/** 系统段内容承载变量名(必须匹配 ^[a-z][a-z0-9_]*$)。 */
const SYSTEM_VARIABLE = 'roroko_preinject_system';
/** 系统提示词注册表必须就绪,才能注册 section 与变量。 */
export const inject = ['systemPrompt'];
/** 合并 header + 内容 + footer(两段共用同一套拼接语义)。 */
function buildInjectionText(content, config) {
    const sections = [config.header?.trim(), content, config.footer?.trim()]
        .filter((part) => part !== undefined && part.length > 0);
    const body = sections.join('\n\n');
    return config.wrapInSystemReminder === true
        ? `<system-reminder>\n${body}\n</system-reminder>`
        : body;
}
/** 同步读并合并文件(系统段用;section/变量 provider 都是同步函数,不能 await)。 */
function loadMergedTextSync(baseDir, files) {
    const parts = [];
    for (const file of files) {
        try {
            const text = readFileSync(resolve(baseDir, file), 'utf8');
            if (text.trim().length > 0)
                parts.push(text.trim());
        }
        catch {
            // Missing or unreadable files are skipped; the rest still inject.
        }
    }
    return parts.join('\n\n');
}
/** 异步读并合并文件(消息段用,跑在 pre-step 里)。 */
async function loadMergedText(baseDir, files) {
    const parts = [];
    for (const file of files) {
        try {
            const text = await readFile(resolve(baseDir, file), 'utf8');
            if (text.trim().length > 0)
                parts.push(text.trim());
        }
        catch {
            // Missing or unreadable files are skipped; the rest still inject.
        }
    }
    return parts.join('\n\n');
}
/**
 * 合并系统段参数:preset config 兜底,state preinject 节覆盖优先。
 * 空清单/空文本视为「未覆盖」(与消息段 files 同一条约定)。
 */
function resolveSystemParams(config, state) {
    const override = state.preinject;
    const files = override.systemFiles.length > 0 ? override.systemFiles : (config.systemFiles ?? []);
    const header = override.systemHeader.length > 0 ? override.systemHeader : (config.systemHeader ?? '');
    const footer = override.systemFooter.length > 0 ? override.systemFooter : (config.systemFooter ?? '');
    return { files, header, footer };
}
/**
 * 解析系统段 section 的 order。
 *
 * normalizePreinjectState 保证 state.systemOrder 恒为数字,所以「用户没改过」
 * 只能靠与默认值相等来判断;相等时让 preset config 有话语权,否则 state 赢。
 */
function resolveSystemOrder(config, state) {
    const fromState = state.preinject.systemOrder;
    if (fromState !== RorokoPreinjectDefaultSystemOrder)
        return fromState;
    return config.systemOrder ?? fromState;
}
/**
 * 系统段内容 provider:按当前装配的 agent 现读会话 cwd 下的文件。
 *
 * 三条兜底见文件头:整段 try/catch、失败返回空串、header/footer 拼进值。
 */
function systemTextProvider(config, context) {
    try {
        // 诊断场合的装配没有 agent;此时不注入。
        const cwd = context.agent?.session.header.cwd;
        if (cwd === undefined)
            return '';
        const params = resolveSystemParams(config, loadStateSync());
        const content = loadMergedTextSync(cwd, params.files);
        if (content.length === 0)
            return '';
        return buildInjectionText(content, params);
    }
    catch {
        // provider 抛错会冒到 assemble 打崩整个 turn;兜底成空串(该 section 被丢弃)。
        return '';
    }
}
/**
 * 合并消息段参数:preset config 兜底,state preinject 节覆盖优先。
 * state 缺失/损坏时纯用 config。返回最终 files/header/footer/wrap。
 */
async function resolveInjectParams(config) {
    const state = await loadState();
    const override = state.preinject;
    const files = override.files.length > 0 ? override.files : (config.files ?? []);
    const wrap = override.wrapInSystemReminder ?? config.wrapInSystemReminder ?? false;
    const header = override.header.length > 0 ? override.header : (config.header ?? '');
    const footer = override.footer.length > 0 ? override.footer : (config.footer ?? '');
    return { files, wrap, header, footer };
}
/**
 * Whether this session's durable log already carries a roroko-preinject
 * injection. Scans the whole persisted event log for a user/message whose
 * source carries this plugin's signature. Survives process restarts — unlike a
 * process-local WeakSet — because the log is the durable source of truth.
 */
function hasInjected(session) {
    // session.log 是内部事件数组(seq 即索引);session.events 是 getter,在 agent
    // preset 层实测访问为 undefined(见 2026-09-03 排查),改用 log 直读。
    const sess = session;
    const rawLog = sess.log;
    if (!Array.isArray(rawLog))
        return false;
    for (const event of rawLog) {
        if (event?.type === 'user/message'
            && event.data?.source?.kind === 'plugin'
            && event.data.source.plugin === name)
            return true;
    }
    return false;
}
/**
 * section 文本组装:personaHead 字面拼入(因此走 renderPrompt 的严格插值,
 * 可写 {{cwd}} 这类已注册宏),正文则用变量宏引用(走变量承载,文件里的
 * {{}} 不会被二次扫描)。head 为空则整段只剩正文宏。
 */
function buildSectionText(config) {
    const head = config.personaHead?.trim() ?? '';
    return head.length > 0 ? `${head}\n\n{{${SYSTEM_VARIABLE}}}` : `{{${SYSTEM_VARIABLE}}}`;
}
export function apply(ctx, config = {}) {
    // ── 系统段:变量承载正文 + section 引用宏 ──
    // 变量先注册;求值发生在装配时,注册先后不影响结果,但先有值再有引用更直白。
    ctx.effect(() => ctx.systemPrompt.variable(SYSTEM_VARIABLE, context => systemTextProvider(config, context)), 'roroko-preinject.variable()');
    // 接管 persona 槽位时与 dsh-persona 同层同名,注册会抛错 —— 所以开启前
    // 必须先从 preset 删掉那行。接管后带 complete,独占整个系统提示词。
    const personaSection = config.personaSection === true;
    const order = personaSection
        ? ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA')
        : resolveSystemOrder(config, loadStateSync());
    ctx.effect(() => ctx.systemPrompt.section({
        name: personaSection ? PERSONA_SECTION : SYSTEM_SECTION,
        order,
        text: buildSectionText(config),
        ...personaSection ? { complete: true } : {},
    }), 'roroko-preinject.section()');
    if (personaSection && config.includeRuntimeContext === false) {
        ctx.systemPrompt.suppressRuntimeContext();
    }
    // ── 消息段:原一次性注入逻辑 ──
    ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
        const decision = await next();
        if (decision.kind !== 'enter')
            return decision;
        // 一次性注入判重:已注入过的会话跳过(见 hasInjected)。
        if (hasInjected(agent.session))
            return decision;
        const cwd = agent.session.header.cwd ?? process.cwd();
        const params = await resolveInjectParams(config);
        const content = await loadMergedText(cwd, params.files);
        if (content.length === 0)
            return decision;
        const text = buildInjectionText(content, {
            wrapInSystemReminder: params.wrap,
            header: params.header,
            footer: params.footer,
        });
        const injectedMessage = createUserMessage({
            content: [{ type: 'text', text }],
            source: { kind: 'plugin', plugin: name },
        });
        // Insert right after the claimed user batch, the same position where
        // `agent-instructions` would normally place its baseline.
        const lastClaimedIndex = decision.messages.findLastIndex(message => messages.includes(message));
        const entered = decision.messages.toSpliced(lastClaimedIndex + 1, 0, injectedMessage);
        return { ...decision, messages: entered };
    });
}
