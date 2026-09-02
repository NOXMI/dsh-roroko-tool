/**
 * roroko-warn — 超量收敛警告(骨架占位)。
 *
 * 设计:agent 层插件,参照官方 dsh-agent-default-model 先例,
 * 经 ctx.inject(['settings']) 读 host 的 `roroko-warn` settings
 * namespace(开关 UI 已在官方仓库 ui-conversation/RorokoSection 落地);
 * 监听 agent/pre-step,工具调用步数 / 思考长度超量时向 decision.messages
 * 追加收敛警告,开关关掉则停发。
 * 现状:空实现,行为未定稿,待确认需求后实现。
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'roroko-warn'

export interface RorokoWarnConfig {
  maxToolCalls?: number
  maxReasoningChars?: number
  maxThinkingSteps?: number
}

export function apply(_ctx: Context, _config: RorokoWarnConfig): void {
  // 待定稿后实现
}
