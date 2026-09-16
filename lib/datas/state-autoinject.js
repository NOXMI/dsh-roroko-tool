/**
 * datas/state-autoinject.ts — state 短条自动注入机制(两个入口,一个出口)。
 *
 * 不进 schema、不注册工具:preset 声明 roroko-data 即随取料工具一起生效,
 * 开关在设置面板(状态存 roroko-tool-state.json 的 data.autoinject 节)。
 *
 *   tools/result   → onToolResult():命中 roroko_datas_* → 标记本会话该注入
 *   session/event  → 压缩(compaction/*)后置 forced:下一轮不再干等 8 轮
 *   agent/pre-step → injectOnce():唯一出口,判定命中才追加到消息尾部
 *
 * 为什么挂 pre-step 而不是装配层:它是唯一拿得到 `turn` 的通道,且往
 * `decision.messages` 尾部追加只影响后缀 —— 不碰 system 段、不发 schema,
 * 不破 KV 前缀缓存(与 preinject 的消息段同一路数)。
 *
 * 头号纪律:**绝不在这里抛错**。pre-step 监听器抛异常会让整个 step proposal
 * 失败(DSH 的 interception 测试专门钉了这条),读库失败、渲染异常一律内部吞掉。
 */
import { DatabaseSync } from 'node:sqlite';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { loadState } from '../state.js';
import { buildInjectText, clampRounds, decide, isRorokoDatasTool, renderStateShort, } from './state-autoinject-form.js';
/** 取一条 state 行(只读;跨天清零的写侧归 state 刀,注入不改库)。 */
function readStateRow(dbPath) {
    const db = new DatabaseSync(dbPath);
    try {
        return db.prepare('SELECT * FROM soul_state WHERE id = 1').get();
    }
    finally {
        db.close();
    }
}
/** 注册自动注入机制;由 data.ts 在 preset 挂载时调用。 */
export function applyStateAutoinject(ctx, dbPath) {
    const counters = new WeakMap();
    const counterOf = (session) => {
        const existing = counters.get(session);
        if (existing !== undefined)
            return existing;
        const fresh = {
            lastTurn: Number.NaN,
            injectedTurn: Number.NaN,
            pending: false,
            forced: false,
        };
        counters.set(session, fresh);
        return fresh;
    };
    // 入口 1:取过料就标记(错误结果也算 —— 取过就是取过)。
    ctx.on('tools/result', exec => {
        try {
            if (exec === undefined || !isRorokoDatasTool(exec.name))
                return;
            const session = exec.agent?.session;
            if (session === undefined)
                return;
            counterOf(session).pending = true;
        }
        catch {
            // 观察者不该影响工具执行本身
        }
    });
    // 入口 2:压缩把短条甩掉后,别干等 8 轮 —— 置 forced,下一次 pre-step 立即注。
    ctx.on('session/event', (session, event) => {
        try {
            const type = String(event?.type ?? '');
            if (!type.startsWith('compaction/'))
                return;
            const counter = counters.get(session);
            if (counter === undefined)
                return;
            counter.forced = true;
            console.log('[roroko-datas-autoinject] compaction → forced re-inject', type);
        }
        catch {
            // 同上
        }
    });
    // 唯一出口。
    ctx.on('agent/pre-step', async ({ agent, turn }, next) => {
        const decision = await next();
        if (decision.kind !== 'enter')
            return decision;
        const session = agent?.session;
        if (session === undefined)
            return decision;
        const counter = counterOf(session);
        try {
            const settings = (await loadState()).data.autoinject;
            const verdict = decide({
                turn,
                lastTurn: counter.lastTurn,
                injectedTurn: counter.injectedTurn,
                pending: counter.pending,
                forced: counter.forced,
                roundsEnabled: settings.rounds,
                afterToolEnabled: settings.afterTool,
                every: clampRounds(settings.every),
                minGap: settings.minGap,
            });
            if (!verdict.inject) {
                // 被最短间隔(或闸门/开关)挡下 → 消耗掉这次工具触发,
                // 不让它挂到间隔开了才兑现(否则等于变相多出一条 4 轮通道)
                counter.pending = false;
                return decision;
            }
            const row = readStateRow(dbPath);
            if (row === undefined) {
                console.log('[roroko-datas-autoinject] state 行不存在,跳过注入');
                counter.pending = false;
                counter.forced = false;
                return decision;
            }
            const text = buildInjectText(renderStateShort(row, new Date()));
            const message = createUserMessage({
                content: [{ type: 'text', text }],
                source: { kind: 'plugin', plugin: 'roroko-data' },
            });
            // 记账:只有真注入才刷新(开关关掉时不刷新,关了就是关了)。
            counter.lastTurn = turn;
            counter.injectedTurn = turn;
            counter.pending = false;
            counter.forced = false;
            console.log('[roroko-datas-autoinject] inject', verdict.source ?? '-', 'turn', turn, 'chars', text.length);
            return { ...decision, messages: [...decision.messages, message] };
        }
        catch (error) {
            // 头号纪律:任何意外都吃掉,绝不把 pre-step 打崩。
            console.log('[roroko-datas-autoinject] skipped:', error instanceof Error ? error.message : String(error));
            return decision;
        }
    });
}
