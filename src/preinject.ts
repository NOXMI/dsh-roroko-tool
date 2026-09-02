/**
 * roroko-preinject — 一次性工作区指令注入器(骨架占位)。
 *
 * 待迁入:dsh-roroko-preinject 全量逻辑(监听 agent/pre-step,
 * 读取会话 cwd 下 AGENTS.md / IDENTITY.md 等固定文件,一次性注入)。
 * 现状:空实现,保证骨架可编译可挂载。
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'roroko-preinject'

export interface RorokoPreinjectConfig {
  files?: string[]
  wrapInSystemReminder?: boolean
  header?: string
  footer?: string
}

export function apply(_ctx: Context, _config: RorokoPreinjectConfig): void {
  // 待迁入实际注入逻辑
}
