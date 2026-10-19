/** 设置页文案。 */
export const zh = {
  title: 'roroko-tool',
  subtitle: '两段注入清单',
  loading: '插件插入中…',
  failed: '读取失败',
  version: '版本',
  refresh: '刷新',
  on: '开',
  off: '关',

  notMounted: '没有挂载 preinject',
  notMountedHint: 'preset 里没声明 config.preinject 桶，这个页面无事可做',

  root: '身份根',
  configFile: '清单文件',
  injectedFile: '记录文件',
  injectedCount: '已注入会话',
  injectedEmpty: '还没有会话被标记',
  reset: '清空注入记录',
  resetDone: '已清空，下次会话会重新注入',
  resetFailed: '清空失败',

  systemTitle: '系统层',
  systemHint: '按顺序拼进系统提示词，常驻，不占消息位。',
  userTitle: '用户层',
  userHint: '按顺序拼成一条 user 消息，追加在用户消息之后，每会话一次。',

  files: '文件清单',
  filesHint: '一行一个文件名或路径，相对身份根；留空 = 不注入',
  missing: '缺失',
  present: '就绪',
  emptyFiles: '清单是空的',

  wrap: '包 system-reminder',
  wrapHint: '只作用于用户层',

  save: '保存',
  saved: '清单已写入，下一步装配就生效',
  saveFailed: '保存失败',
}

export type LocaleKey = keyof typeof zh

/** English copy, same keys. */
export const en: Record<LocaleKey, string> = {
  title: 'roroko-tool',
  subtitle: 'Two injection lists',
  loading: 'Loading…',
  failed: 'Failed to load',
  version: 'Version',
  refresh: 'Refresh',
  on: 'on',
  off: 'off',

  notMounted: 'preinject is not mounted',
  notMountedHint: 'No config.preinject bucket in this preset, nothing to configure here',

  root: 'Root',
  configFile: 'List file',
  injectedFile: 'Record file',
  injectedCount: 'Sessions injected',
  injectedEmpty: 'No session marked yet',
  reset: 'Clear injection record',
  resetDone: 'Cleared — the next session injects again',
  resetFailed: 'Clear failed',

  systemTitle: 'System layer',
  systemHint: 'Joined in order into the system prompt; resident, no message slot.',
  userTitle: 'User layer',
  userHint: 'Joined into one user message appended after the user messages, once per session.',

  files: 'Files',
  filesHint: 'One file name or path per line, relative to root; empty means nothing is injected',
  missing: 'missing',
  present: 'ready',
  emptyFiles: 'Empty list',

  wrap: 'Wrap in system-reminder',
  wrapHint: 'User layer only',

  save: 'Save',
  saved: 'Lists written, effective on the next assembly',
  saveFailed: 'Save failed',
}
