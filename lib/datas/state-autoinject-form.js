/** 轮数阈值默认值(面板可改)。 */
export const AutoinjectDefaultRounds = 8;
/** 最短间隔默认值:两次注入之间至少隔 N 轮(0 = 不限制)。 */
export const AutoinjectDefaultMinGap = 4;
/** 轮数阈值收窄:整数、1~200,非法值回落默认。 */
export function clampRounds(value) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return AutoinjectDefaultRounds;
    const int = Math.trunc(n);
    if (int < 1)
        return 1;
    if (int > 200)
        return 200;
    return int;
}
/** 最短间隔收窄:整数、0~200,非法值回落默认(4)。 */
export function clampMinGap(value) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return AutoinjectDefaultMinGap;
    const int = Math.trunc(n);
    if (int < 0)
        return 0;
    if (int > 200)
        return 200;
    return int;
}
/**
 * 最短间隔是否已满足。从未注入过(NaN)放行;minGap ≤ 0 视为不限制。
 * 存在的意义:取料工具一多,"工具后注入"会退化成每轮都注的漏斗。
 */
export function gapSatisfied(turn, lastTurn, minGap) {
    if (!Number.isFinite(lastTurn))
        return true;
    const gap = clampMinGap(minGap);
    if (gap <= 0)
        return true;
    return Number.isFinite(turn) && turn - lastTurn >= gap;
}
/** 本地日期戳(YYYY-MM-DD)。禁用 toISOString —— 那是 UTC,会差 8 小时。 */
export function todayStamp(now) {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
/** 轮数是否到期:从未注过(NaN)视为到期。 */
export function dueByRounds(turn, lastTurn, every) {
    if (!Number.isFinite(lastTurn))
        return true;
    const gap = Number.isFinite(turn) ? turn - lastTurn : 0;
    return gap >= clampRounds(every);
}
/** 工具名是否属于取料工具族(机制本身不注册工具,不会被自己的监听器命中)。 */
export function isRorokoDatasTool(name) {
    return typeof name === 'string' && name.startsWith('roroko_datas_');
}
/**
 * 唯一判定出口。优先级:闸门 → 压缩释放 → **最短间隔** → 工具后 → 轮数。
 * 同一 turn 已注过则一律不注(哪怕 forced)。
 */
export function decide(input) {
    if (Number.isFinite(input.injectedTurn) && input.injectedTurn === input.turn) {
        return { inject: false, source: null };
    }
    // 压缩释放是显式信号:不受最短间隔约束(刚被压缩甩掉,不该再干等)
    if (input.forced && input.roundsEnabled)
        return { inject: true, source: 'rounds' };
    // 最短间隔:任何注入之后至少隔 N 轮(首次注入放行)
    if (!gapSatisfied(input.turn, input.lastTurn, input.minGap)) {
        return { inject: false, source: null };
    }
    if (input.pending && input.afterToolEnabled)
        return { inject: true, source: 'after-tool' };
    if (input.roundsEnabled && dueByRounds(input.turn, input.lastTurn, input.every)) {
        return { inject: true, source: 'rounds' };
    }
    return { inject: false, source: null };
}
/** 字段取值:空/「无」/空数组一律当没有(与 snap 的 display 同一口径)。 */
function fieldValue(row, key) {
    const raw = row[key];
    if (raw === undefined || raw === null)
        return '';
    const text = String(raw).trim();
    if (text.length === 0 || text === '无' || text === '[]')
        return '';
    return text.replaceAll('|', '/');
}
/**
 * 计数器当日值:库里的 last_daily_reset 不是今天 → 当日计数按 0 显示。
 * 这里**只读不写**:跨天清零的写侧归 state 刀,注入不该改库。
 */
export function counterToday(row, base, today) {
    const stamp = String(row.last_daily_reset ?? '').trim();
    if (stamp !== today)
        return 0;
    return Number(row[`${base}_today`] ?? 0);
}
/**
 * 渲染短条。段序固定:叙事 → 计数 → 着装。
 * 2026-09-16 阿一拍板:**不限字数**(先让状态说全,长度后面再调)——
 * 曾试过 150 字上限,生产库实测一项 position 就 34 字,当场被砍掉着装与计数器。
 */
export function renderStateShort(row, now) {
    const today = todayStamp(now);
    const parts = [];
    const push = (key) => {
        const value = fieldValue(row, key);
        if (value.length > 0)
            parts.push(`${key}=${value}`);
    };
    push('scene');
    push('truth');
    push('decision');
    push('position');
    push('body_state');
    push('behavior');
    push('arousal');
    const counters = ['oral', 'vaginal', 'anal']
        .map(base => `${base} ${counterToday(row, base, today)}/${Number(row[`${base}_total`] ?? 0)}`)
        .join(' · ');
    parts.push(`计 ${counters}`);
    const outfit = ['outfit_top', 'outfit_bottom', 'outfit_bra', 'outfit_underwear']
        .map(key => fieldValue(row, key))
        .filter(value => value.length > 0);
    if (outfit.length > 0)
        parts.push(`着装=${outfit.join('/')}`);
    return `[state] ${parts.join(' | ')}`;
}
/** 注入壳:照抄 nanobot 口径(黑川不可见也不知情 —— 只看洛洛可说出口的)。 */
export const AutoinjectNotice = [
    '###下方内容由脚本自动注入###',
    'roroko_datas_state（黑川不可见也不知情，他只知道洛洛可在消息里说出口的内容）:',
].join('\n');
/** 拼最终注入文本。 */
export function buildInjectText(short) {
    return `${AutoinjectNotice} ${short}`;
}
