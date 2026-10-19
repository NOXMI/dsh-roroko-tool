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

  commonTitle: '公共默认',
  commonHint: '没写覆盖的 preset 都吃这一层，也是每个 preset 的基线。',
  presetHint: '会话 header.agentPreset 等于这个 id 时，这一层叠在公共默认之上。',

  badgeBaseline: '基线',
  badgeOverridden: '已覆盖',
  badgeInherit: '跟随继承',
  badgeBroken: '挂不起来',

  coverSystem: '覆盖系统层（进 system 提示词；不勾选 = 跟随继承）',
  coverUser: '覆盖用户层（进 user 消息；不勾选 = 跟随继承）',
  coverSuppress: '覆盖屏蔽段（装配后按段名抹掉；不勾选 = 跟随继承）',
  followSystem: '跟随继承',
  followUser: '跟随继承',
  followSuppress: '跟随继承',
  suppressHint: '如 context:file-reference',

  filesHint: '如 IDENTITY.md，或 /root/.dsh/roroko/AGENTS.md',
  addFile: '+ 添加文件',
  deleteRow: '删除此行',
  emptyFiles: '清单是空的',
  missing: '缺失',
  present: '就绪',

  save: '保存',
  saving: '保存中…',
  saved: '已保存',
  saveFailed: '保存失败',
  resetScope: '重置为继承',

  datasTitle: '素材库',
  datasHint: 'roroko_datas_* 四把工具连哪个库，以及 state 短条多久自动注一次。',
  coverDbPath: '覆盖库路径（不勾选 = 跟随继承）',
  followDbPath: '跟随继承',
  dbPathHint: '/var/www/api/database/soul.db',
  coverAutoinject: '覆盖自动注入（不勾选 = 跟随继承）',
  followAutoinject: '跟随继承',
  aiRounds: '轮数触发',
  aiAfterTool: '取过料后注入',
  aiEvery: '每 N 轮',
  aiMinGap: '最短间隔 N 轮',
  on: '开',
  off: '关',
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

  commonTitle: 'Common default',
  commonHint: 'Every preset without overrides reads this layer; it is the baseline.',
  presetHint: 'Applied on top of the common default when the session header carries this preset id.',

  badgeBaseline: 'baseline',
  badgeOverridden: 'overridden',
  badgeInherit: 'inherited',
  badgeBroken: 'broken',

  coverSystem: 'Override the system layer (system prompt; unchecked = inherit)',
  coverUser: 'Override the user layer (user message; unchecked = inherit)',
  coverSuppress: 'Override suppressed sections (dropped by name after assembly; unchecked = inherit)',
  followSystem: 'inherited',
  followUser: 'inherited',
  followSuppress: 'inherited',
  suppressHint: 'e.g. context:file-reference',

  filesHint: 'e.g. IDENTITY.md, or /root/.dsh/roroko/AGENTS.md',
  addFile: '+ Add file',
  deleteRow: 'Remove this line',
  emptyFiles: 'Empty list',
  missing: 'missing',
  present: 'ready',

  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved',
  saveFailed: 'Save failed',
  resetScope: 'Reset to inherit',

  datasTitle: 'Material library',
  datasHint: 'Which database the roroko_datas_* tools open, and how often the state digest is injected.',
  coverDbPath: 'Override the database path (unchecked = inherit)',
  followDbPath: 'inherited',
  dbPathHint: '/var/www/api/database/soul.db',
  coverAutoinject: 'Override auto-injection (unchecked = inherit)',
  followAutoinject: 'inherited',
  aiRounds: 'Inject by round count',
  aiAfterTool: 'Inject after tool use',
  aiEvery: 'every N rounds',
  aiMinGap: 'min gap N rounds',
  on: 'on',
  off: 'off',
}
