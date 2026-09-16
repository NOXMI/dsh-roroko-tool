/**
 * roroko_datas_query 的纯逻辑:关键词匹配 / 收束过滤 / 候选抽取 / markdown 渲染。
 *
 * 与 DB 访问分离(query.ts 负责开库取行),所以本文件**不 import node 内置与
 * DSH 运行时包** —— 零依赖测试直读编译产物,不点界面、不连库就能验整套取料行为。
 *
 * 口径(2026-09-16 阿一拍板,证据见 refs/notes/roroko-datas-query-slice1-plan.md):
 *   - 发散为默认(池内均匀随机),收束为可选(条件由模型给,库不当裁判)
 *   - 记录侧 keywords 里 62%~84% 是单字 token(register 分词造成),**单字不作
 *     命中依据** —— 实测误炸「透」7→1、「夜」5→0、「高跟」6→3 条
 *   - 拿现有列,不加列;slot 分组键**从库里动态取**(库里实有 headwear/panties/
 *     swimsuit,设计稿写的 outerwear 是 0 条)
 *   - hit_count / last_used_at 只作展示,不参与排序(按它排会永远推同几条)
 *   - 时间一律本地口径算出相对时间;库里 companion_pool 的时间列叫 last_used
 */
export const TABLES = {
    scene: { table: 'scenes', nameCol: 'name', timeCol: 'last_used_at', hasSlot: false, hasLevels: false, defaultLimit: 5 },
    clothing: { table: 'clothing', nameCol: 'name', timeCol: 'last_used_at', hasSlot: true, hasLevels: true, defaultLimit: 2 },
    items: { table: 'sexual_items', nameCol: 'name', timeCol: 'last_used_at', hasSlot: false, hasLevels: false, defaultLimit: 3 },
    companion: { table: 'companion_pool', nameCol: 'profession', timeCol: 'last_used', hasSlot: false, hasLevels: false, defaultLimit: 5 },
};
/** 关键词列解析:JSON 数组优先,回落裸逗号串(库里两种形态都出现过)。 */
export function parseKeywords(value) {
    if (typeof value !== 'string' || value.trim().length === 0)
        return [];
    const raw = value.trim();
    if (raw.startsWith('[')) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed.map(String).map(s => s.trim()).filter(s => s.length > 0);
            }
        }
        catch {
            // 畸形 JSON 回落逗号切
        }
    }
    return raw.split(',').map(s => s.trim()).filter(s => s.length > 0);
}
/** 查询词拆分:逗号分隔、去空白、去重。 */
export function splitKws(raw) {
    if (typeof raw !== 'string')
        return [];
    const out = [];
    for (const part of raw.split(',')) {
        const kw = part.trim();
        if (kw.length > 0 && !out.includes(kw))
            out.push(kw);
    }
    return out;
}
/** 逗号分隔清单 → 数组(slot 参数)。 */
export function splitSlots(raw) {
    if (typeof raw !== 'string')
        return [];
    const out = [];
    for (const part of raw.split(',')) {
        const slot = part.trim();
        if (slot.length > 0 && !out.includes(slot))
            out.push(slot);
    }
    return out;
}
/** 数值字段兜底。 */
function num(value, fallback) {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
}
/**
 * 关键词打分:只认**长度 ≥2** 的记录侧 token(单字 token 不作命中依据)。
 * 完全相等 +2,单向包含 +1。无查询词 → 恒 0(走发散)。
 */
export function scoreRow(row, kws) {
    if (kws.length === 0)
        return 0;
    const tokens = parseKeywords(row.keywords).filter(t => t.length >= 2);
    let score = 0;
    for (const qk of kws) {
        for (const tk of tokens) {
            if (qk === tk)
                score += 2;
            else if (tk.includes(qk) || qk.includes(tk))
                score += 1;
        }
    }
    return score;
}
/** 洗牌(rng 注入)。 */
function shuffle(items, rng) {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = items[i];
        items[i] = items[j];
        items[j] = tmp;
    }
    return items;
}
/**
 * 取候选:匹配 → 收束 → 池内抽取。
 *
 * 先洗牌再按分数**稳定**排序 —— 分数段内天然随机(每次调用结果会变),
 * 不用 hit_count 也不用"多久没用"当排序键。
 */
export function pickCandidates(rows, options) {
    const spec = TABLES[options.tableKey];
    const rng = options.rng ?? Math.random;
    const usedKws = options.kws.filter(k => k.length >= 2);
    const droppedKws = options.kws.filter(k => k.length < 2);
    let matched = rows.map((row, index) => ({ row, index, score: scoreRow(row, options.kws) }));
    if (options.kws.length > 0)
        matched = matched.filter(item => item.score > 0);
    shuffle(matched, rng);
    matched.sort((a, b) => b.score - a.score);
    const matchedCount = matched.length;
    let pool = matched;
    const steps = [];
    const narrow = (label, keep) => {
        const before = pool.length;
        pool = pool.filter(item => keep(item.row));
        steps.push({ label, before, after: pool.length });
    };
    const slotFilter = options.filters.slot ?? [];
    if (spec.hasSlot && slotFilter.length > 0) {
        narrow(`slot∈[${slotFilter.join(',')}]`, row => slotFilter.includes(String(row.slot ?? '')));
    }
    if (spec.hasLevels && options.filters.revealLevel !== undefined) {
        const cap = options.filters.revealLevel;
        narrow(`reveal_level≤${cap}`, row => num(row.reveal_level, 1) <= cap);
    }
    if (spec.hasLevels && options.filters.signalLevel !== undefined) {
        const floor = options.filters.signalLevel;
        narrow(`signal_level≥${floor}`, row => num(row.signal_level, 0) >= floor);
    }
    const slotStats = spec.hasSlot ? slotDistribution(rows) : [];
    const limit = clampLimit(options.limit);
    const groups = [];
    if (spec.hasSlot) {
        // 按**原始** slot 值分组:显示名才把空值写成 (未分类),拿显示名当过滤键会漏掉空槽位
        const buckets = new Map();
        for (const item of pool) {
            const raw = String(item.row.slot ?? '').trim();
            const list = buckets.get(raw);
            if (list === undefined)
                buckets.set(raw, [item]);
            else
                list.push(item);
        }
        const keys = [...buckets.keys()].sort((a, b) => {
            if (a === '')
                return 1;
            if (b === '')
                return -1;
            return buckets.get(b).length - buckets.get(a).length;
        });
        for (const raw of keys) {
            const list = buckets.get(raw);
            groups.push({
                slot: raw.length > 0 ? raw : '(未分类)',
                raw,
                rows: list.slice(0, limit).map(item => item.row),
                poolSize: list.length,
            });
        }
        // 显式点名但被收束筛空的槽位也要列出来 —— 让模型看见"这个部位没货",好去 register
        for (const raw of options.filters.slot ?? []) {
            if (buckets.has(raw))
                continue;
            groups.push({ slot: raw, raw, rows: [], poolSize: 0 });
        }
    }
    return {
        poolSize: pool.length,
        matched: matchedCount,
        steps,
        rows: spec.hasSlot ? [] : pool.slice(0, limit).map(item => item.row),
        groups,
        slotStats,
        usedKws,
        droppedKws,
    };
}
/** 槽位分布:按条数降序;空槽位归 `(未分类)`,排在最后。 */
export function slotDistribution(rows) {
    const counter = new Map();
    for (const row of rows) {
        const slot = String(row.slot ?? '').trim();
        const key = slot.length > 0 ? slot : '(未分类)';
        counter.set(key, (counter.get(key) ?? 0) + 1);
    }
    const out = [...counter.entries()].map(([slot, count]) => ({ slot, count }));
    out.sort((a, b) => {
        if (a.slot === '(未分类)')
            return 1;
        if (b.slot === '(未分类)')
            return -1;
        return b.count - a.count;
    });
    return out;
}
/** 条数钳制:1~50,非有限数回落默认。 */
export function clampLimit(value, fallback = 5) {
    const n = num(value, fallback);
    if (n < 1)
        return 1;
    if (n > 50)
        return 50;
    return Math.trunc(n);
}
/** 时间戳 → 相对时间文案(本地口径,库里的时间串本身就是 CST)。 */
export function fmtLastUsed(ts, now) {
    if (typeof ts !== 'string' || ts.trim().length === 0)
        return '从未';
    const parsed = new Date(ts.trim().replace(' ', 'T'));
    if (Number.isNaN(parsed.getTime()))
        return '从未';
    const minutes = (now.getTime() - parsed.getTime()) / 60_000;
    if (minutes < 1)
        return '刚刚';
    if (minutes < 60)
        return `${Math.floor(minutes)}min前`;
    if (minutes < 1440)
        return `${Math.floor(minutes / 60)}h前`;
    return `${Math.floor(minutes / 1440)}d前`;
}
/** 单行"已用次数 / 最后使用"单元格。 */
function usageCell(row, spec, now) {
    const hits = num(row.hit_count, 0);
    const last = fmtLastUsed(row[spec.timeCol], now);
    // hit_count 有值但没记时间(旧库脱节:clothing 62/95 条如此)—— 明说"未记录",不猜时间
    return [String(hits), hits > 0 && last === '从未' ? '未记录' : last];
}
/** 渲染 query 结果为 markdown(有 kw 标题带关键词,无 kw 标"发散")。 */
export function renderQuery(input) {
    const spec = TABLES[input.tableKey];
    const pick = input.pick;
    const now = input.now ?? new Date();
    const title = input.kws.length > 0 ? input.kws.join('、') : '发散(无条件)';
    const lines = [`## 素材 · ${spec.table} · \`${title}\``];
    const heads = [`${input.total} 条`, `被用过 ${input.usedCount} 条`];
    if (spec.hasSlot && pick.slotStats.length > 0) {
        heads.push(`槽位 ${pick.slotStats.map(s => `${s.slot} ${s.count}`).join(' / ')}`);
    }
    lines.push(`表概览:${heads.join(' · ')}`);
    if (pick.steps.length > 0) {
        lines.push(`收束:${pick.steps.map(s => `${s.label} ${s.before}→${s.after}`).join(' ｜ ')}`);
    }
    if (pick.droppedKws.length > 0) {
        lines.push(`(单字词 ${pick.droppedKws.join('、')} 不作命中依据,已忽略)`);
    }
    const hasNote = pick.rows.some(r => String(r.note ?? '').length > 0)
        || pick.groups.some(g => g.rows.some(r => String(r.note ?? '').length > 0));
    const head = ['名称'];
    if (spec.hasSlot)
        head.push('槽位');
    if (spec.hasLevels)
        head.push('reveal', 'signal');
    if (input.tableKey === 'items')
        head.push('intensity');
    head.push('已用', '最后使用');
    if (hasNote)
        head.push('备注');
    const rowOf = (row) => {
        const cells = [String(row[spec.nameCol] ?? '?').replaceAll('|', '/')];
        if (spec.hasSlot)
            cells.push(String(row.slot ?? '').trim() || '(未分类)');
        if (spec.hasLevels)
            cells.push(String(num(row.reveal_level, 1)), String(num(row.signal_level, 0)));
        if (input.tableKey === 'items')
            cells.push(`${num(row.intensity_min, 0)}~${num(row.intensity_max, 0)}`);
        const [hits, last] = usageCell(row, spec, now);
        cells.push(hits, last);
        if (hasNote)
            cells.push(String(row.note ?? '').replaceAll('|', '/'));
        return `| ${cells.join(' | ')} |`;
    };
    lines.push('');
    lines.push(`| ${head.join(' | ')} |`);
    lines.push(`|${head.map(() => '---').join('|')}|`);
    if (spec.hasSlot) {
        for (const group of pick.groups) {
            lines.push(`| **${group.slot}** |${head.slice(1).map(() => ' |').join('')}`);
            if (group.rows.length === 0) {
                lines.push(`| *(无候选)* |${head.slice(1).map(() => ' |').join('')}`);
                continue;
            }
            for (const row of group.rows)
                lines.push(rowOf(row));
        }
    }
    else {
        for (const row of pick.rows)
            lines.push(rowOf(row));
    }
    const short = spec.hasSlot
        ? pick.groups.length === 0
        : pick.poolSize < input.limit;
    if (pick.poolSize === 0 || (input.kws.length > 0 && pick.matched === 0)) {
        lines.push('');
        lines.push('关键词未命中 → 建议 `roroko_datas_register` 把新条目落库,别凭空设计');
    }
    else if (short) {
        lines.push('');
        lines.push(`候选不足(${pick.poolSize} 条)→ 可用 \`roroko_datas_register\` 补充落库`);
    }
    if (!spec.hasSlot && input.adhoc.length > 0) {
        lines.push('');
        lines.push('| ad_hoc 临时条目 | 说明 |');
        lines.push('|---|---|');
        for (const item of input.adhoc.slice(0, 8)) {
            lines.push(`| ${item.name.replaceAll('|', '/')} | ${item.description.replaceAll('|', '/')} |`);
        }
    }
    return lines.join('\n');
}
