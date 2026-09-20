import { createUserMessage } from '@deepseek-ai/dsh-llm';
/** 会话 id 前缀:会话列表里一眼能认出这是 dream 的会话。 */
const SESSION_PREFIX = 'dream';
/**
 * 跑一个一次性会话:挂 preset → 投任务书 → 等收敛 → 等落盘 → 收掉。
 * 任何一步失败都抛给调用方(它会收成结果里的 error,不往上冒)。
 * @param runtime - 真实的 agents / sessions / presets 与本次的 cwd、preset
 * @param prompt - 任务书正文(由执行序层组装,这里只负责投递)
 * @param bookmark - CST 时间戳,用来拼会话 id(便于在会话列表里认出来)
 */
export async function runDreamSession(runtime, prompt, bookmark) {
    const presetId = runtime.presetId.trim();
    const preset = runtime.presets === undefined
        ? undefined
        : await runtime.presets.resolve(presetId.length > 0 ? presetId : undefined);
    // 预热:把 preset 的组合实例先立起来(mount 时才不会现读名册撞上并发改文件)
    if (preset !== undefined)
        await runtime.presets?.standingKeyFor?.(preset.id);
    const stamp = bookmark.replace(/[^0-9]/g, '').slice(0, 14);
    const sessionId = `${SESSION_PREFIX}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
    const handle = await runtime.agents.create({
        sessionId,
        meta: {
            cwd: runtime.cwd.trim().length > 0 ? runtime.cwd.trim() : process.cwd(),
            ...preset === undefined ? {} : { agentPreset: preset.id },
        },
        agentOptions: runtime.agentOptions,
        setup: async (agentCtx) => {
            if (preset === undefined)
                return;
            await runtime.presets?.mount(agentCtx, preset.id);
        },
    });
    try {
        handle.agent.followup(createUserMessage({
            content: [{ type: 'text', text: prompt }],
            source: { kind: 'plugin', plugin: runtime.pluginName },
        }));
        await handle.agent.whenIdle();
        await runtime.sessions.flush(handle.agent.session);
        return { sessionId: String(sessionId), preset: preset?.id ?? '' };
    }
    finally {
        // 收掉会话:agent 从注册表移除、会话文件已 flush 落盘
        await handle.dispose?.();
    }
}
