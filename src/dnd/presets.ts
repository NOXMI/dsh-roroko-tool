/**
 * dnd 子模块的配置形状。preset 里直接给这一份，不做设置页桶
 * （跑团这套是给玩家的，参数少，改一次就定）。
 */
export interface DndConfig {
  /** false 时不挂载本模块。 */
  enabled?: boolean
  /** 身份根（默认 $DSH_HOME/roroko_DND）。IDENTITY.md 也在这下面。 */
  root?: string
  /** dnd.db 路径（默认 <root>/data/dnd.db）。 */
  dbPath?: string
  /** bridge 地址；false = 不连（只留工具）。默认 ws://127.0.0.1:8792。 */
  bridge?: string | false
  /** 是否注册三把工具；false = 只跑桥。默认 true。 */
  tools?: boolean
  /** 与 gateway 约定的 token；缺省读 ROROKO_DND_TOKEN。 */
  token?: string
  /** 会话工作目录。 */
  cwd?: string
  /** 用哪个 preset 起会话（默认 roroko_DND）。 */
  preset?: string
  provider?: string
  model?: string
  maxTokens?: number
  log?: boolean
}

export const DND_DEFAULTS: DndConfig = {
  bridge: 'ws://127.0.0.1:8792',
  preset: 'roroko_DND',
  log: true,
}
