/** 设置页文案。 */
export const zh = {
  title: 'roroko-tool',
  subtitle: '预注入参数',
  loading: '加载中…',
  failed: '加载失败',
  version: '版本',
  refresh: '刷新',

  notMounted: '没有挂载 preinject',
  notMountedHint: 'preset 里没声明 config.preinject 桶，这个页面无事可做',

  root: '身份根',
  stateFile: '覆盖文件',
  injectedFile: '记录文件',
  injectedCount: '注入记录',
  injectedEmpty: '还没有会话被标记',
  injectedHint: '记录文件清空后，下次会话会重新注入一遍。',
  reset: '清空注入记录',
  resetDone: '已清空，下次会话会重新注入',
  resetFailed: '清空失败',

  commonTitle: '公共默认',
  commonHint: '没写覆盖的 preset 都吃这一层，也是每个 preset 的基线。',
  presetHint: '会话 header.agentPreset 等于这个 id 时，这一层叠在公共默认之上。',

  badgeBaseline: '基线',
  badgeOverridden: '已覆盖',
  badgeInherit: '跟随继承',
  badgeBroken: '挂不起来',

  coverSystem: '覆盖系统层（进 system 提示词；不勾选 = 跟随继承）',
  coverUser: '覆盖用户层（进 user 消息；不勾选 = 跟随继承）',
  followSystem: '跟随继承',
  followUser: '跟随继承',

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
  resetScope: '重置为继承',
}

export type LocaleKey = keyof typeof zh

/** English copy, same keys. */
export const en: Record<LocaleKey, string> = {
  title: 'roroko-tool',
  subtitle: 'Pre-injection parameters',
  loading: 'Loading…',
  failed: 'Failed to load',
  version: 'Version',
  refresh: 'Refresh',

  notMounted: 'preinject is not mounted',
  notMountedHint: 'No config.preinject bucket in this preset, nothing to configure here',

  root: 'Root',
  stateFile: 'Override file',
  injectedFile: 'Record file',
  injectedCount: 'Injection record',
  injectedEmpty: 'No session marked yet',
  injectedHint: 'Clear the record file and the next session injects again.',
  reset: 'Clear injection record',
  resetDone: 'Cleared — the next session injects again',
  resetFailed: 'Clear failed',

  commonTitle: 'Common default',
  commonHint: 'Every preset without overrides reads this layer; it is the baseline.',
  presetHint: 'Applied on top of the common default when the session header carries this preset id.',

  badgeBaseline: 'baseline',
  badgeOverridden: 'overridden',
  badgeInherit: 'inherited',
  badgeBroken: 'broken',

  coverSystem: 'Override the system layer (system prompt; unchecked = inherit)',
  coverUser: 'Override the user layer (user message; unchecked = inherit)',
  followSystem: 'inherited',
  followUser: 'inherited',

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
  resetScope: 'Reset to inherit',
}
