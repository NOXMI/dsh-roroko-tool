/**
 * roroko 记忆库访问层:开库建表 / 写入 / 按日期回查。
 *
 * 只依赖 `node:sqlite` 与 memory-form.ts(纯逻辑),**不 import DSH 运行时包** ——
 * 测试可以直接 import 本产物真跑临时库,不需要替身钩子。
 *
 * 连接策略:每次 execute 独立开关一条连接(与 roroko_datas_* 同款);开库即建表,
 * 幂等。sqlite 不会自己建目录,所以先补父目录。
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MEMORY_DDL, MEMORY_PRAGMAS, fmtCst, normalizeId, normalizeLimit, renderAddResult, renderDate, renderId, renderRough, resolveRange, scoreRough, splitKeywords, } from './memory-form.js';
/**
 * 开库 + 建表(幂等)。父目录不存在则补建 —— sqlite 遇缺目录直接报错。
 * 建表失败会让插件 apply 抛错 → 调用方自己 try/catch,别拖垮 preset 挂载。
 */
export function openMemoryDb(dbPath) {
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    for (const sql of MEMORY_PRAGMAS)
        db.exec(sql);
    for (const sql of MEMORY_DDL)
        db.exec(sql);
    return db;
}
/** 写一条记忆:created_at 由服务端按 CST 生成,reflected_at 留 NULL(待反思)。 */
export function runAdd(db, input, now) {
    const createdAt = fmtCst(now);
    const inserted = db
        .prepare('INSERT INTO memory (owner, content, summary, created_at, source, kind) VALUES (?, ?, ?, ?, ?, ?)')
        .run(input.owner, input.content, input.summary, createdAt, input.source.length > 0 ? input.source : null, input.kind.length > 0 ? input.kind : null);
    const id = Number(inserted.lastInsertRowid);
    return { id, createdAt, text: renderAddResult(input, id, createdAt) };
}
/**
 * 按日期回查:拿 created_at 前 10 位(纯日期)做字符串比较,避开时间部分。
 * 区间非法时返回人话错误,不抛 —— 工具执行失败会污染整轮。
 */
export function runDate(db, query, now) {
    const resolved = resolveRange(query.from, query.to, now);
    if (resolved.range === undefined)
        return `区间非法: ${resolved.error}`;
    const range = resolved.range;
    const where = ['substr(created_at, 1, 10) >= ?', 'substr(created_at, 1, 10) <= ?'];
    const params = [range.from, range.to];
    if (query.owner !== undefined && query.owner.length > 0) {
        where.push('owner = ?');
        params.push(query.owner);
    }
    const rows = db
        .prepare(`SELECT id, owner, summary, created_at, reflected_at, recalled, kind FROM memory
       WHERE ${where.join(' AND ')} ORDER BY created_at ASC, id ASC`)
        .all(...params);
    return renderDate({ rows, range, owner: query.owner, now });
}
/** 检索与取全文共用的列(改动这里要顺手看一眼两处渲染)。 */
const MEMORY_COLUMNS = 'id, owner, content, summary, created_at, reflected_at, recalled, source, kind';
/** 按 owner 取候选行:owner 有值就过滤,否则全桶(是否全桶由调用方决定)。 */
function selectCandidates(db, owner) {
    const base = `SELECT ${MEMORY_COLUMNS} FROM memory`;
    const tail = ' ORDER BY created_at DESC, id DESC';
    const scoped = owner !== undefined && owner.length > 0;
    const statement = db.prepare(scoped ? `${base} WHERE owner = ?${tail}` : `${base}${tail}`);
    const rows = scoped ? statement.all(owner) : statement.all();
    return rows;
}
/** 召回计数 +1 —— **只给真正被取用的条**,落选的候选不该因一次检索就涨计数。 */
function bumpRecalled(db, ids) {
    if (ids.length === 0)
        return;
    const statement = db.prepare('UPDATE memory SET recalled = recalled + 1 WHERE id = ?');
    for (const id of ids)
        statement.run(id);
}
/**
 * 关键词模糊检索(字符 bigram + 覆盖度):候选先按 owner 全取回来,再在内存里打分。
 * 记忆量级是千级,全取比在 SQL 里做匹配更简单,也把打分逻辑留在纯函数里好测。
 * 关键词切不出东西时返回人话,不抛(工具抛错会污染整轮)。
 */
export function runRough(db, query) {
    const keywords = splitKeywords(query.keywords);
    if (keywords.length === 0)
        return '关键词为空:给一句要检索的话或几个词(空格分隔)。';
    const rows = selectCandidates(db, query.owner);
    const hits = scoreRough({ rows, keywords, limit: normalizeLimit(query.limit) });
    bumpRecalled(db, hits.map(hit => hit.id));
    // 库里已 +1,渲染跟着走,免得回执与库对不上
    for (const hit of hits)
        hit.recalled += 1;
    return renderRough({ hits, keywords, owner: query.owner, candidates: rows.length });
}
/**
 * 按 id 取一条的完整内容(摘要不足以判断时才用),顺带 recalled += 1。
 * 查不到返回人话,不抛。
 */
export function runId(db, query) {
    const id = normalizeId(query.id);
    if (id === undefined) {
        return `id 非法: ${String(query.id)}(要正整数;id 从检索或按日期回查的结果里拿)`;
    }
    const owner = query.owner !== undefined && query.owner.length > 0 ? query.owner : undefined;
    const sql = `SELECT ${MEMORY_COLUMNS} FROM memory WHERE id = ?${owner === undefined ? '' : ' AND owner = ?'}`;
    const row = (owner === undefined
        ? db.prepare(sql).get(id)
        : db.prepare(sql).get(id, owner));
    if (row === undefined) {
        return `没有 #${id} 这条记忆${owner === undefined ? '' : `(owner=${owner})`}。`;
    }
    db.prepare('UPDATE memory SET recalled = recalled + 1 WHERE id = ?').run(id);
    return renderId({ row, recalled: (Number(row.recalled) || 0) + 1 });
}
