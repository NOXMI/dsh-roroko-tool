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
 * 参数三层(2026-09-11 四改):内置默认 ← preset 接线 `config` ← host state
 * 覆盖。覆盖层按会话的 agent preset id 取桶(state.presets[<id>]),具体桶叠在
 * 公共桶(common)之上;只有字段「缺失」才算未覆盖,空清单/空串都是显式设定。
 * 参数只影响注入内容,不改工具目录,不破坏 request-cache。
 *
 * preset id 取「当前生效」而非「创建时」(2026-09-14 修):`header.agentPreset`
 * 是创建事实,页面切 preset 只追加 `agent-preset/selected` 事件、header 不动,
 * 于是"先建后切"的会话里 `${presetDir}` 与参数分桶双双指向错的 preset。现改为
 * 读 log(见 resolveSessionPresetId),与官方 `agentPreset` Session 投影同一套语义。
 */
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { PERSONA_SECTION } from '@deepseek-ai/dsh-system-prompt';
import { dshHomeDirectory, loadState, loadStateSync } from './state.js';
import { resolvePresetOverride, RorokoPreinjectDefaults } from './settings.js';
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
/** 路径宏:${presetDir} 指会话 preset 目录,${dshHome} 指 DSH 家,${cwd} 指会话工作目录。 */
const PRESET_DIR_MACRO = '${presetDir}';
const DSH_HOME_MACRO = '${dshHome}';
const CWD_MACRO = '${cwd}';
/** DSH 官方 preset id 契约(与 agent-presets discovery 同一正则):id 当路径段用,必须受限。 */
const PRESET_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
/** DSH 官方用户 preset 根目录名(与 @deepseek-ai/dsh-agent-presets 的 USER_PRESET_DIR 一致)。 */
const USER_PRESET_DIR = '.agent-presets';
/** 读 Session 内部持久事件数组(log;seq 即索引,resume 后即完整)。非数组当空。 */
function sessionLog(session) {
    const raw = session?.log;
    return Array.isArray(raw) ? raw : undefined;
}
/**
 * 取会话**当前生效**的 preset id,而不是「创建时」那个。
 *
 * `header.agentPreset` 是创建事实 —— 点"新建会话"就写死,此后在页面切 preset 只
 * 往 log 追加一条 `agent-preset/selected`,header 不更新(2026-09-14 本机实测:
 * header `roroko-gamedev`,4 秒后切 `roroko-dsh`,只有事件记着)。用 header 的后果
 * 是"先建后切"会话里 `${presetDir}` 指向不存在的目录 → 文件静默跳过、零报错,
 * 参数也静默回落公共桶。
 *
 * 语义与官方 `agentPreset` Session 投影一致(header 起手 + 最新一条选择事件,
 * 见 packages/preset/agent-presets/src/session.ts)。这里复刻而非声明
 * `sessionProjections` 服务依赖:服务缺席时插件整个不加载,为一个 id 不值。
 */
export function resolveSessionPresetId(log, headerPreset) {
    if (Array.isArray(log)) {
        for (let index = log.length - 1; index >= 0; index -= 1) {
            const event = log[index];
            if (event?.type !== 'agent-preset/selected')
                continue;
            const id = event.data?.agentPreset;
            if (typeof id === 'string' && id.length > 0)
                return id;
        }
    }
    return headerPreset;
}
/**
 * 解析单条注入路径;返回 undefined 表示这条跳过(空串,或宏拿不到值)。
 *
 * 支持写法:
 *   ${presetDir}/IDENTITY.md  → <dshHome>/.agent-presets/<会话 preset id>/
 *   ${dshHome}/roroko/X.md    → $DSH_HOME(缺省 ~/.dsh)
 *   ~/shared/X.md             → 用户主目录
 *   其他相对路径               → 相对会话 cwd(与旧行为一致)
 *   绝对路径                   → path.resolve 原样返回(天然支持)
 *
 * 限制:${presetDir} 用的是推导路径 —— 官方 shipped root 或自定义 root 下的
 * preset 不在此列,那类 preset 请直接写绝对路径。
 */
export function resolveInjectionPath(raw, cwd, presetId) {
    const trimmed = raw.trim();
    if (trimmed.length === 0)
        return undefined;
    let text = trimmed;
    if (text.includes(PRESET_DIR_MACRO)) {
        // 会话没有 preset(或 id 不合法)时拼不出目录 —— 整条跳过,绝不猜路径。
        if (presetId === undefined || !PRESET_ID_RE.test(presetId))
            return undefined;
        text = text.replaceAll(PRESET_DIR_MACRO, join(dshHomeDirectory(), USER_PRESET_DIR, presetId));
    }
    if (text.includes(DSH_HOME_MACRO))
        text = text.replaceAll(DSH_HOME_MACRO, dshHomeDirectory());
    if (text.includes(CWD_MACRO))
        text = text.replaceAll(CWD_MACRO, cwd);
    if (text === '~')
        return homedir();
    if (text.startsWith('~/') || text.startsWith('~\\'))
        return join(homedir(), text.slice(2));
    return resolve(cwd, text);
}
/** 同步读并合并文件(系统段用;section/变量 provider 都是同步函数,不能 await)。 */
function loadMergedTextSync(baseDir, files, presetId) {
    const parts = [];
    for (const file of files) {
        const target = resolveInjectionPath(file, baseDir, presetId);
        if (target === undefined)
            continue;
        try {
            const text = readFileSync(target, 'utf8');
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
async function loadMergedText(baseDir, files, presetId) {
    const parts = [];
    for (const file of files) {
        const target = resolveInjectionPath(file, baseDir, presetId);
        if (target === undefined)
            continue;
        try {
            const text = await readFile(target, 'utf8');
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
 * 每文件一份文本(splitFiles=true 时用),顺序与清单一致。
 * 读不到/空白文件直接跳过,不占位 —— 与合并模式同一套"缺失静默跳过"约定。
 */
async function loadFileTexts(baseDir, files, presetId) {
    const out = [];
    for (const file of files) {
        const target = resolveInjectionPath(file, baseDir, presetId);
        if (target === undefined)
            continue;
        try {
            const text = await readFile(target, 'utf8');
            if (text.trim().length > 0)
                out.push(text.trim());
        }
        catch {
            // Missing or unreadable files are skipped; the rest still inject.
        }
    }
    return out;
}
/**
 * 计算注入位置:紧跟本插件"认领"的那批用户消息之后(默认,与官方
 * agent-instructions 同位),或之前。
 *
 * claimedIndex<0(本步没有认领到任何用户消息)时一律落到数组开头 —— 此刻
 * "之后"没有可依附的对象,而且 toSpliced 收负数会从尾部倒数,不夹住就会把
 * 注入插到消息流中间。
 */
export function injectionIndex(claimedIndex, placement) {
    if (claimedIndex < 0)
        return 0;
    return placement === 'before-user' ? claimedIndex : claimedIndex + 1;
}
/**
 * 合并系统段参数:内置默认 ← preset 接线 config ← state 覆盖(字段级)。
 *
 * 2026-09-11 四改统一了覆盖语义:字段「缺失」才算未覆盖;字段存在即显式设定,
 * 空清单/空串就是"这一段不注入"。旧版那种 length>0 判据会让用户没法把清单
 * 清空,也让布尔字段(见下)完全失声。
 */
function resolveSystemParams(config, override) {
    return {
        files: override.systemFiles ?? config.systemFiles ?? RorokoPreinjectDefaults.systemFiles,
        header: override.systemHeader ?? config.systemHeader ?? RorokoPreinjectDefaults.systemHeader,
        footer: override.systemFooter ?? config.systemFooter ?? RorokoPreinjectDefaults.systemFooter,
    };
}
/**
 * 解析系统段 section 的 order:state 覆盖 → preset config → 内置默认。
 *
 * 注意 order 在 apply(preset 挂载)时读一次,那时**没有会话**,所以只认公共桶
 * (common)的覆盖,per-preset 桶里的 systemOrder 读不到;要改 order 就得重挂载
 * preset。文件清单则相反 —— provider 每次装配现读,按会话 preset 精确取桶。
 */
function resolveSystemOrder(config, override) {
    return override.systemOrder ?? config.systemOrder ?? RorokoPreinjectDefaults.systemOrder;
}
/**
 * 系统段内容 provider:按当前装配的 agent 现读会话 cwd 下的文件。
 *
 * 三条兜底见文件头:整段 try/catch、失败返回空串、header/footer 拼进值。
 * 覆盖层按会话的 agent preset 取桶(具体桶叠公共桶),与消息段同一套解析。
 */
function systemTextProvider(config, context) {
    try {
        // 诊断场合的装配没有 agent;此时不注入。
        const agent = context.agent;
        const session = agent?.session;
        const cwd = session?.header.cwd;
        if (cwd === undefined)
            return '';
        // 当前生效的 preset(读 log,不读创建时的 header;见 resolveSessionPresetId)。
        const presetId = resolveSessionPresetId(sessionLog(session), session?.header.agentPreset);
        const override = resolvePresetOverride(loadStateSync(), presetId);
        const params = resolveSystemParams(config, override);
        const content = loadMergedTextSync(cwd, params.files, presetId);
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
 * 合并消息段参数:内置默认 ← preset config ← state 覆盖(字段级)。
 *
 * 修掉的旧 bug:wrap 原先写 `override.wrapInSystemReminder ?? config.…`,而
 * normalize 后的 override 恒为布尔,`??` 右侧永不生效 —— preset config 里写的
 * wrapInSystemReminder: true 会被 state 的 false 静静吃掉。现在 override 是
 * 部分对象,字段缺失才是未覆盖,wrap 与其他字段语义一致。
 */
function resolveInjectParams(config, override) {
    return {
        files: override.files ?? config.files ?? RorokoPreinjectDefaults.files,
        wrap: override.wrapInSystemReminder
            ?? config.wrapInSystemReminder
            ?? RorokoPreinjectDefaults.wrapInSystemReminder,
        header: override.header ?? config.header ?? RorokoPreinjectDefaults.header,
        footer: override.footer ?? config.footer ?? RorokoPreinjectDefaults.footer,
        placement: override.filesPlacement ?? config.filesPlacement ?? RorokoPreinjectDefaults.filesPlacement,
        split: override.splitFiles ?? config.splitFiles ?? RorokoPreinjectDefaults.splitFiles,
    };
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
    const rawLog = sessionLog(session);
    if (rawLog === undefined)
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
    // order 是挂载期参数:此刻还没有会话,只认公共桶(common)覆盖 ——
    // per-preset 桶里的 systemOrder 读不到,改了要重挂载 preset 才生效。
    const order = personaSection
        ? ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA')
        : resolveSystemOrder(config, resolvePresetOverride(loadStateSync(), undefined));
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
        // 覆盖层按会话的 agent preset 取桶:具体桶叠在公共桶之上(与系统段同一套解析)。
        // preset id 取当前生效值(读 log),否则"先建后切"会话会静默落进公共桶。
        const presetId = resolveSessionPresetId(sessionLog(agent.session), agent.session.header.agentPreset);
        const override = resolvePresetOverride(await loadState(), presetId);
        const params = resolveInjectParams(config, override);
        // 拆分策略:每文件一条时各自包壳;默认把所有文件合并成一条。
        const contents = params.split
            ? await loadFileTexts(cwd, params.files, presetId)
            : [await loadMergedText(cwd, params.files, presetId)];
        const payloads = contents
            .filter(content => content.length > 0)
            .map(content => buildInjectionText(content, {
            wrapInSystemReminder: params.wrap,
            header: params.header,
            footer: params.footer,
        }));
        if (payloads.length === 0)
            return decision;
        const injected = payloads.map(text => createUserMessage({
            content: [{ type: 'text', text }],
            source: { kind: 'plugin', plugin: name },
        }));
        // 落点:本插件认领的用户消息批次之后(默认,与 agent-instructions 同位)或之前。
        const lastClaimedIndex = decision.messages.findLastIndex(message => messages.includes(message));
        const entered = decision.messages.toSpliced(injectionIndex(lastClaimedIndex, params.placement), 0, ...injected);
        return { ...decision, messages: entered };
    });
}
