/**
 * roroko-tool 子插件配置类型与默认值(纯参数,无运行级开关)。
 *
 * 架构沿革(2026-09-03 三改):roroko-tool 从「host 电箱 + state 开关」转向
 * 「preset 声明即开关」。agent preset 在 agent.cordis.yml 里声明引用哪个子
 * 插件(roroko-data / roroko-preinject …),装配即生效;不引用即不存在。
 * 原四工具 enabled 运行级开关全部退役——运行级动态启停会随会话装配改变
 * 工具集,打爆 request-cache 上下文命中。
 *
 * 每个子插件的参数仍支持两层:
 *   1. preset 接线时写在 agent.cordis.yml 对应行的 `config:`(推荐,声明即配);
 *   2. host 侧 state 文件覆盖(roroko-tool-state.json,经设置页编辑),子插件
 *      读取时 state 覆盖优先、preset config 兜底。
 * 子插件参数只影响行为,不改工具 schema,不破坏缓存。
 *
 * 历史:2026-09-02 曾做 host 电箱四开关 + state HTTP route(client 经同源
 * fetch 读写,绕开官方 settings loopback 写限制);2026-09-03 阿一拍板退役
 * enabled 开关,state 只存参数覆盖。settings.ts 现在只留类型/默认值/工具键,
 * register 与 schemastery schema 逻辑早已删除。
 */

/** 系统段默认文件清单:进系统提示词 section,常驻、不算消息、不被 compaction 折叠。 */
export const RorokoPreinjectDefaultSystemFiles = [
  'AGENTS.md',
  'IDENTITY.md',
]

/** 系统段基准 order:清单里第 N 个文件(0 起)的 section order = 基准 + N。 */
export const RorokoPreinjectDefaultSystemOrder = 100

/** 消息段默认文件清单(user 消息,会话首次进入时注入一次)。 */
export const RorokoPreinjectDefaultFiles = [
  'PLAYER.md',
  'MEMORY.md',
  'EVOLVE.md',
  'EVOLVE_NOTE.md',
  'MARKERS.md',
]

/** 预注入默认包裹壳(与旧 preset 接线草案一致,生成 <roroko-reminder> 注释块)。 */
export const RorokoPreinjectDefaultHeader = [
  '<roroko-reminder>',
  'The following workspace instructions make you a better roroko. They are read once',
  'at session start and stay in context for this session.',
].join(' ')

export const RorokoPreinjectDefaultFooter = [
  'These instructions do not override system, developer, or direct user instructions.',
  '</roroko-reminder>',
].join(' ')

/** roroko-data 素材库工具默认数据库路径(服务器 soul.db)。 */
export const RorokoDataDefaultDbPath = '/var/www/api/database/soul.db'

/**
 * preinject 一节的 wire 形状(state 文件 / HTTP payload / UI)。
 * enabled 已退役:preset 声明本插件即启用;这里只存注入参数覆盖。
 */
export interface RorokoPreinjectState {
  /** 系统段:会话 cwd 下待注入系统提示词的文件名(注入顺序)。 */
  systemFiles: string[]
  /** 系统段基准 order:清单里第 N 个文件(0 起)的 section order = 基准 + N。 */
  systemOrder: number
  /** 系统段包裹壳:内容前插入的文本。 */
  systemHeader: string
  /** 系统段包裹壳:内容后插入的文本。 */
  systemFooter: string
  /** 消息段:会话 cwd 下待注入 user 消息的文件名(注入顺序)。 */
  files: string[]
  /** 消息段包裹壳:内容前插入的文本。 */
  header: string
  /** 消息段包裹壳:内容后插入的文本。 */
  footer: string
  /** 消息段是否再整体包一层 <system-reminder>…</system-reminder>。 */
  wrapInSystemReminder: boolean
}

/**
 * data 一节的 wire 形状:数据库路径覆盖。
 * enabled 已退役:preset 声明 roroko-data 即注册四把工具。
 */
export interface RorokoDataState {
  /** soul.db 绝对路径;缺省回落服务器默认路径。 */
  dbPath: string
}

/** mark 一节的 wire 形状:呻吟标记渲染总开关(web 渲染 / Telegram 出站共用)。 */
export interface RorokoMarkState {
  /** 显示层是否把 -呻吟_X- 标记展开为完整呻吟文本(session 存储仍存原文)。 */
  enabled: boolean
}

/** 四工具参数键(与 state 文件 / HTTP payload 一致)。 */
export type RorokoToolKey = 'preinject' | 'data' | 'warn' | 'mark'

/** 电箱参数状态:每个子插件一节参数;warn 暂无参数,mark 有渲染开关。 */
export interface RorokoToolState {
  preinject: RorokoPreinjectState
  data: RorokoDataState
  warn: Record<string, never>
  mark: RorokoMarkState
}

/** 四工具键的稳定序(渲染/校验共用)。 */
export const ROROKO_TOOL_KEYS = ['preinject', 'data', 'warn', 'mark'] as const

/** 默认参数(空参数节即「未覆盖」;子插件回落 preset config)。 */
export const RorokoToolStateDefault: RorokoToolState = {
  preinject: {
    systemFiles: [...RorokoPreinjectDefaultSystemFiles],
    systemOrder: RorokoPreinjectDefaultSystemOrder,
    systemHeader: '',
    systemFooter: '',
    files: [...RorokoPreinjectDefaultFiles],
    header: RorokoPreinjectDefaultHeader,
    footer: RorokoPreinjectDefaultFooter,
    wrapInSystemReminder: false,
  },
  data: {
    dbPath: RorokoDataDefaultDbPath,
  },
  warn: {},
  mark: { enabled: true },
}

/** 窄化未知值为工具键。 */
export function isRorokoToolKey(value: unknown): value is RorokoToolKey {
  return typeof value === 'string' && (ROROKO_TOOL_KEYS as readonly string[]).includes(value)
}

/** 窄化字符串清单:非数组回落默认,数组内只留字符串项。 */
function normalizeFiles(value: unknown, fallback: readonly string[]): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [...fallback]
}

/** preinject 一节的窄化与默认。 */
export function normalizePreinjectState(value: unknown): RorokoPreinjectState {
  const base = RorokoToolStateDefault.preinject
  if (typeof value !== 'object' || value === null) {
    return {
      ...base,
      systemFiles: [...base.systemFiles],
      files: [...base.files],
    }
  }
  const section = value as Record<string, unknown>
  const systemFiles = normalizeFiles(section.systemFiles, base.systemFiles)
  const systemOrder = typeof section.systemOrder === 'number' && Number.isFinite(section.systemOrder)
    ? section.systemOrder
    : base.systemOrder
  const systemHeader = typeof section.systemHeader === 'string' ? section.systemHeader : base.systemHeader
  const systemFooter = typeof section.systemFooter === 'string' ? section.systemFooter : base.systemFooter
  const files = normalizeFiles(section.files, base.files)
  const header = typeof section.header === 'string' ? section.header : base.header
  const footer = typeof section.footer === 'string' ? section.footer : base.footer
  const wrapInSystemReminder = typeof section.wrapInSystemReminder === 'boolean'
    ? section.wrapInSystemReminder
    : base.wrapInSystemReminder
  return {
    systemFiles, systemOrder, systemHeader, systemFooter,
    files, header, footer, wrapInSystemReminder,
  }
}

/** data 一节的窄化与默认。 */
export function normalizeDataState(value: unknown): RorokoDataState {
  const base = RorokoToolStateDefault.data
  if (typeof value !== 'object' || value === null) return { ...base }
  const section = value as Record<string, unknown>
  const dbPath = typeof section.dbPath === 'string' && section.dbPath.trim().length > 0
    ? section.dbPath
    : base.dbPath
  return { dbPath }
}

/** mark 一节的窄化与默认(enabled 布尔兜底)。 */
export function normalizeMarkState(value: unknown): RorokoMarkState {
  const base = RorokoToolStateDefault.mark
  if (typeof value !== 'object' || value === null) return { ...base }
  const section = value as Record<string, unknown>
  const enabled = typeof section.enabled === 'boolean' ? section.enabled : base.enabled
  return { enabled }
}

/** 把任意部分对象叠到默认状态上(容错:缺键用默认,未知键丢弃)。 */
export function normalizeState(value: unknown): RorokoToolState {
  const base = structuredClone(RorokoToolStateDefault)
  if (typeof value !== 'object' || value === null) return base
  const source = value as Record<string, unknown>
  for (const key of ROROKO_TOOL_KEYS) {
    const section = source[key]
    if (typeof section !== 'object' || section === null) continue
    if (key === 'preinject') {
      base.preinject = normalizePreinjectState(section)
      continue
    }
    if (key === 'data') {
      base.data = normalizeDataState(section)
      continue
    }
    if (key === 'mark') {
      base.mark = normalizeMarkState(section)
      continue
    }
    // warn 暂无参数,忽略未知字段。
  }
  return base
}
