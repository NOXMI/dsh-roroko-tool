/** 设置页文案。 */
export const zh = {
  title: 'roroko-tool',
  subtitle: '两段注入清单',
  loading: '加载中…',
  failed: '加载失败',
  version: '版本',
  refresh: '刷新',

  notMounted: '没有挂载 preinject',
  notMountedHint: 'preset 里没声明 config.preinject 桶，这个页面无事可做',

  root: '身份根',
  configFile: '清单文件',
  injectedFile: '记录文件',
  injectedCount: '注入记录',
  injectedEmpty: '还没有会话被标记',
  injectedHint: '记录文件清空后，下次会话会重新注入一遍。',
  reset: '清空注入记录',
  resetDone: '已清空，下次会话会重新注入',
  resetFailed: '清空失败',

  systemTitle: '系统层',
  systemHint: '按顺序拼进系统提示词，常驻、不占消息位、不被压缩折叠。',
  userTitle: '用户层',
  userHint: '按顺序拼成一条 user 消息，落在本批用户消息之后，每会话一次。',

  filesHint: '如 IDENTITY.md，或 /root/.dsh/roroko/AGENTS.md',
  addFile: '+ 添加文件',
  deleteRow: '删除此行',
  emptyFiles: '清单是空的',
  missing: '缺失',
  present: '就绪',

  wrap: '整体包一层 <system-reminder>…</system-reminder>',

  save: '保存',
  saving: '保存中…',
  saved: '已保存',
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

  notMounted: 'preinject is not mounted',
  notMountedHint: 'No config.preinject bucket in this preset, nothing to configure here',

  root: 'Root',
  configFile: 'List file',
  injectedFile: 'Record file',
  injectedCount: 'Injection record',
  injectedEmpty: 'No session marked yet',
  injectedHint: 'Clear the record file and the next session injects again.',
  reset: 'Clear injection record',
  resetDone: 'Cleared — the next session injects again',
  resetFailed: 'Clear failed',

  systemTitle: 'System layer',
  systemHint: 'Joined in order into the system prompt; resident, no message slot, survives compaction.',
  userTitle: 'User layer',
  userHint: 'Joined into one user message after the user messages, once per session.',

  filesHint: 'e.g. IDENTITY.md, or /root/.dsh/roroko/AGENTS.md',
  addFile: '+ Add file',
  deleteRow: 'Remove this line',
  emptyFiles: 'Empty list',
  missing: 'missing',
  present: 'ready',

  wrap: 'Wrap the whole thing in <system-reminder>…</system-reminder>',

  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved',
  saveFailed: 'Save failed',
}
