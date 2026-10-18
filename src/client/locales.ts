/** 设置页文案。 */
export const zh = {
  title: '洛洛可',
  subtitle: '插件运行状态与注入开关',
  loading: '读取中…',
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
