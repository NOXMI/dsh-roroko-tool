/** 设置页文案。 */
export const zh = {
  title: 'roroko-tool',
  subtitle: '插件运行状态与注入开关',
  loading: '插件插入中…',
  failed: '读取失败',
  version: '版本',
  mounts: '已挂载子模块',
  none: '没有子模块在运行（preset 里未声明 config 桶）',
  root: '身份根目录',
  identityFiles: '身份文件',
  workspaceFiles: '工作区文件',
  includeWorkspace: '系统段拼工作区',
  injected: '已注入会话',
  injectedFile: '记录文件',
  reset: '清空注入记录',
  resetDone: '已清空，下次会话会重新注入',
  resetFailed: '清空失败',
  refresh: '刷新',
  on: '开',
  off: '关',
}

export type LocaleKey = keyof typeof zh

/** English copy, same keys. */
export const en: Record<LocaleKey, string> = {
  title: 'Roroko',
  subtitle: 'Runtime status and injection switches',
  loading: 'Loading…',
  failed: 'Failed to load',
  version: 'Version',
  mounts: 'Mounted submodules',
  none: 'No submodule is mounted (no config bucket in this preset)',
  root: 'Identity root',
  identityFiles: 'Identity files',
  workspaceFiles: 'Workspace files',
  includeWorkspace: 'Workspace in system prompt',
  injected: 'Sessions injected',
  injectedFile: 'Record file',
  reset: 'Clear injection record',
  resetDone: 'Cleared — the next session injects again',
  resetFailed: 'Clear failed',
  refresh: 'Refresh',
  on: 'on',
  off: 'off',
}
