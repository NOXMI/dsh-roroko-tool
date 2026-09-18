/**
 * roroko 记忆工具的纯逻辑:时间口径 / 日期区间 / 入参收窄 / 渲染 / DDL 常量。
 *
 * 与 DB 访问分离(memory-store.ts 负责开库读写),本文件**不 import node 内置与
 * DSH 运行时包** —— 零依赖测试直读编译产物,不连库、不点界面就能验整套口径。
 *
 * 口径(2026-09-18 定稿,见 refs/notes/roroko-memory-design-v1.md):
 *   - 时间一律 **CST+0800**,用固定偏移算、**不读运行环境时区**(服务器被设成 UTC 也照对)
 *   - 存库格式与 soul.db 的 datetime('now','localtime') 一致:'YYYY-MM-DD HH:mm:ss'
 *   - 日期查询拿 created_at 前 10 位做字符串比较,不拼 '23:59:59' 落边界
 *   - 默认区间 = **今天 + 昨天**(直接承接既有记忆纪律「今天 + 昨天必读」)
 */
/** 东八区固定偏移(毫秒)。 */
const CST_OFFSET_MS = 8 * 60 * 60 * 1000;
/** 一天的毫秒数。 */
const DAY_MS = 24 * 60 * 60 * 1000;
/** 两位补零。 */
function pad2(n) {
    return String(n).padStart(2, '0');
}
/** 把绝对时刻搬到东八区那面钟上,再用 UTC getter 读(于是与运行环境时区无关)。 */
function cstParts(date) {
    const shifted = new Date(date.getTime() + CST_OFFSET_MS);
    return {
        y: shifted.getUTCFullYear(),
        m: shifted.getUTCMonth() + 1,
        d: shifted.getUTCDate(),
        hh: shifted.getUTCHours(),
        mm: shifted.getUTCMinutes(),
        ss: shifted.getUTCSeconds(),
    };
}
/** CST 时间戳 'YYYY-MM-DD HH:mm:ss'(禁用 toISOString —— 那是 UTC,库会早 8 小时)。 */
export function fmtCst(date) {
    const p = cstParts(date);
    return `${p.y}-${pad2(p.m)}-${pad2(p.d)} ${pad2(p.hh)}:${pad2(p.mm)}:${pad2(p.ss)}`;
}
/** CST 日期 'YYYY-MM-DD'。 */
export function cstDate(date) {
    return fmtCst(date).slice(0, 10);
}
/** 真日期校验:挡 '2026-02-30' 这种格式对、值不存在的输入。 */
export function isDateStr(value) {
    if (typeof value !== 'string')
        return false;
    const raw = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw))
        return false;
    const [y, m, d] = raw.split('-').map(Number);
    const probe = new Date(Date.UTC(y, m - 1, d));
    return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}
/** 宽松日期输入:取前 10 位,'2026-09-18' / '2026-09-18 11:30' / ISO 串都认;不合法返回 undefined。 */
export function normalizeDateInput(raw) {
    if (typeof raw !== 'string')
        return undefined;
    const head = raw.trim().slice(0, 10);
    return isDateStr(head) ? head : undefined;
}
/** 日期加减天数(纯 UTC 算术,不涉时区)。 */
export function shiftDate(dateStr, days) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const shifted = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
    return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}
/**
 * 解析查询区间:
 *   都不给 → [今天-1, 今天];只给 from → [from, 今天];只给 to → [to, to];都给 → [from, to]
 *   from 晚于 to → 报错(不猜、不自动交换,免得回一堆不是他要的)
 */
export function resolveRange(fromRaw, toRaw, now) {
    const today = cstDate(now);
    const hasFrom = typeof fromRaw === 'string' && fromRaw.trim().length > 0;
    const hasTo = typeof toRaw === 'string' && toRaw.trim().length > 0;
    const from = hasFrom ? normalizeDateInput(fromRaw) : undefined;
    const to = hasTo ? normalizeDateInput(toRaw) : undefined;
    if (hasFrom && from === undefined)
        return { error: `from 不是合法日期(要 YYYY-MM-DD): ${String(fromRaw)}` };
    if (hasTo && to === undefined)
        return { error: `to 不是合法日期(要 YYYY-MM-DD): ${String(toRaw)}` };
    if (from !== undefined && to !== undefined) {
        if (from > to)
            return { error: `from(${from}) 晚于 to(${to})` };
        return { range: { from, to } };
    }
    if (from !== undefined) {
        // from 落在未来时退化成单日 —— 否则会拼出反区间
        return { range: { from, to: from <= today ? today : from } };
    }
    if (to !== undefined)
        return { range: { from: to, to } };
    return { range: { from: shiftDate(today, -1), to: today } };
}
/** owner 桶名上限。 */
export const MEMORY_OWNER_MAX = 32;
/** content(初摘要)上限 —— 只报错不静默截断,让模型自己压。 */
export const MEMORY_CONTENT_MAX = 2000;
/** summary(二次摘要)上限。 */
export const MEMORY_SUMMARY_MAX = 300;
/** kind 上限。 */
export const MEMORY_KIND_MAX = 32;
/** source(provenance:会话 id + 事件 seq)上限。 */
export const MEMORY_SOURCE_MAX = 200;
/** 已知 owner 桶(不强制枚举,只作描述与默认值;将来加角色不必改代码)。 */
export const MEMORY_OWNERS = ['dev', 'persona'];
/** 默认 owner 桶(本机开发侧)。 */
export const MEMORY_DEFAULT_OWNER = 'dev';
/**
 * owner 收窄:小写字母数字开头,可带 . _ -,≤32 字。
 * 拒绝中文/空格/大写 —— 桶名会被当成过滤键,污串一进库就再难收拾。
 */
export function normalizeOwner(raw) {
    if (typeof raw !== 'string')
        return undefined;
    const value = raw.trim().toLowerCase();
    if (value.length === 0 || value.length > MEMORY_OWNER_MAX)
        return undefined;
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(value))
        return undefined;
    return value;
}
/** 必填文本收窄:trim 后非空、不超长。 */
function requiredText(raw, label, max) {
    if (typeof raw !== 'string' || raw.trim().length === 0)
        return { error: `${label} 为空` };
    const value = raw.trim();
    if (value.length > max)
        return { error: `${label} 超长(${value.length}>${max} 字),先自己压一遍再来` };
    return { value };
}
/** add 入参收窄:owner/content/summary 必填,kind/source 可省。 */
export function normalizeAdd(raw) {
    const owner = normalizeOwner(raw.owner);
    if (owner === undefined) {
        return { error: `owner 非法或缺失(只收小写字母数字与 . _ -,≤${MEMORY_OWNER_MAX} 字;常用桶: ${MEMORY_OWNERS.join(' / ')})` };
    }
    const content = requiredText(raw.content, 'content', MEMORY_CONTENT_MAX);
    if ('error' in content)
        return { error: content.error };
    const summary = requiredText(raw.summary, 'summary', MEMORY_SUMMARY_MAX);
    if ('error' in summary)
        return { error: summary.error };
    const kind = typeof raw.kind === 'string' ? raw.kind.trim().slice(0, MEMORY_KIND_MAX) : '';
    const source = typeof raw.source === 'string' ? raw.source.trim().slice(0, MEMORY_SOURCE_MAX) : '';
    return { input: { owner, content: content.value, summary: summary.value, kind, source } };
}
/** 表格单元格:竖线会打断 markdown 表,换成斜杠。 */
function cell(text) {
    return String(text ?? '').replaceAll('|', '/').replaceAll('\n', ' ');
}
/** 写入回执:'已记 #id · 时间 · owner · kind'。 */
export function renderAddResult(input, id, createdAt) {
    const lines = [`已记 #${id} · ${createdAt} CST · owner=${input.owner}`];
    if (input.kind.length > 0)
        lines.push(`kind: ${input.kind}`);
    if (input.source.length > 0)
        lines.push(`source: ${input.source}`);
    lines.push(`summary: ${input.summary}`);
    return lines.join('\n');
}
/**
 * 渲染按日期回查结果。**空区间要明说"没有记忆"** —— 别让模型对着空表脑补。
 * 标记列只标「未反思」(reflected_at 为空),它就是将来的反思作业队列。
 */
export function renderDate(input) {
    const { rows, range, owner } = input;
    const scope = owner === undefined ? 'owner=(全部)' : `owner=${owner}`;
    const head = `## 记忆 · ${range.from} ~ ${range.to} · ${scope}`;
    if (rows.length === 0) {
        return `${head}\n该区间没有记忆。换个区间,或先 \`roroko_mem_edit\` op=add 落一条。`;
    }
    const unreflected = rows.filter(row => row.reflected_at === null || row.reflected_at === '').length;
    const recalled = rows.reduce((sum, row) => sum + (Number(row.recalled) || 0), 0);
    const lines = [
        head,
        `条数 ${rows.length} · 未反思 ${unreflected} · 累计召回 ${recalled}`,
        '',
        '| id | 时间 | 类别 | 摘要 | 标记 |',
        '|---|---|---|---|---|',
    ];
    for (const row of rows) {
        const stamp = String(row.created_at ?? '');
        const short = stamp.length >= 16 ? stamp.slice(5, 16) : stamp;
        const flags = row.reflected_at === null || row.reflected_at === '' ? '未反思' : '';
        lines.push(`| ${row.id} | ${short} | ${cell(row.kind)} | ${cell(row.summary)} | ${flags} |`);
    }
    return lines.join('\n');
}
/** 建表语句(设计稿 §四原文;幂等,每次开库都跑一遍)。 */
export const MEMORY_DDL = [
    `CREATE TABLE IF NOT EXISTS memory (
  id            INTEGER PRIMARY KEY,
  owner         TEXT    NOT NULL,
  content       TEXT    NOT NULL,
  summary       TEXT    NOT NULL,
  created_at    TEXT    NOT NULL,
  reflected_at  TEXT,
  recalled      INTEGER NOT NULL DEFAULT 0,
  source        TEXT,
  kind          TEXT
)`,
    'CREATE INDEX IF NOT EXISTS idx_memory_owner_date ON memory(owner, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_memory_reflected ON memory(reflected_at)',
];
/** 开库即生效的连接级 pragma:WAL 抗并发、busy_timeout 别一撞就抛。 */
export const MEMORY_PRAGMAS = [
    'PRAGMA journal_mode = WAL',
    'PRAGMA busy_timeout = 3000',
];
