/**
 * dsh-roroko-tool client — 洛洛可全家桶设置页(纯电箱)。
 *
 * 在 WebGUI 设置侧边栏注册「Roroko Tool」导航项,页内渲染四个工具的
 * enabled 开关:preinject / data / warn / mark。
 *
 * 值与 host 侧 settings 命名空间 `roroko-tool`(settings.ts 注册)双向同步:
 *   - 读:scope.getSnapshot().value?.[tool]?.enabled(默认 true)
 *   - 写:scope.mutate([{ op:'set', path:[tool,'enabled'], value }])
 * 走深路径写,不整段覆盖——未来某工具在 enabled 旁扩展自己的参数时,
 * 别的开关不受影响。
 *
 * 参照范式:官方 ui-conversation RorokoSection.tsx(settingsScope.bind +
 * useSyncExternalStore + 原生 checkbox)。类型全部本地结构声明,零外部
 * 类型依赖(loader 只认 react / ui-primitives 两个 external)。
 */
import { createElement as h, useSyncExternalStore } from 'react'
import { NS, en, zh } from './locales.ts'

/** 本插件用到的 slots 服务子面(结构类型,不依赖 monorepo 内部类型)。 */
interface SlotsService {
  inject(slot: string, register: () => unknown): void
  register(meta: Record<string, unknown>, component: unknown): unknown
}

/** settings 服务:slots.register 的 section 注册 options。 */
type SectionOptions = {
  name: string
  id: string
  order: number
  label: () => string
  locale?: string
  inject?: () => RorokoToolSectionInjected
}

/** roroko-tool client 上下文(host 提供真实 Context;此处只声明用到的面)。 */
interface RorokoToolClientContext {
  effect(callback: () => unknown, label?: string): void
  locale: {
    register(namespace: string, dicts: { zh: unknown; en: unknown }): unknown
    bind(namespace: string): (key: keyof typeof zh) => string
  }
  slots: {
    inject(slot: string, register: () => unknown): void
    register(meta: SectionOptions, component: unknown): unknown
  }
  settingsScope: SettingsScopeBinder
}

/** settings 命名空间绑定器(bind 一次,得到对单命名空间的读写 scope)。 */
interface SettingsScopeBinder {
  bind<T>(spec: { namespace: string }): SettingsScope<T>
}

/** 单命名空间同步快照(契约子面,见 ui-settings settings-contract.ts)。 */
interface SettingsScopeSnapshot<T> {
  status: 'loading' | 'ready' | 'unavailable'
  value: T | undefined
  writable: boolean
}

/** 单命名空间读写 scope(契约子面)。 */
interface SettingsScope<T> {
  getSnapshot(): SettingsScopeSnapshot<T>
  subscribe(listener: () => void): () => void
  mutate(
    ops: readonly (
      | { op: 'set'; path: string[]; value: unknown }
      | { op: 'unset'; path: string[] }
    )[],
  ): Promise<void>
}

/** host `roroko-tool` 命名空间 wire 形状(与 src/settings.ts 一致)。 */
interface RorokoToolSettings {
  preinject: { enabled: boolean }
  data: { enabled: boolean }
  warn: { enabled: boolean }
  mark: { enabled: boolean }
}

export const name = 'roroko-tool'
export const inject = ['slots', 'locale', 'settingsScope']

/** 设置页组件注入面:host scope(settings 服务不可用时为 undefined)。 */
interface RorokoToolSectionInjected {
  scope: SettingsScope<RorokoToolSettings> | undefined
}

/** settings.section owner props(壳层注入 `close`)。 */
interface SectionOwnerProps {
  close?: () => void
}

/** 四个工具的静态元数据:id 须匹配 host schema 键。 */
const TOOLS = [
  { id: 'preinject', title: '指令预注入', desc: '会话开始时注入一次性工作区指令 (preinject)' },
  { id: 'data', title: '素材库工具', desc: '洛洛可素材库查询工具集 (data)' },
  { id: 'warn', title: '超量收敛警告', desc: '工具调用/思考超量时注入收敛警告 (warn)' },
  { id: 'mark', title: '呻吟标记扩展', desc: '-呻吟_X- 标记的渲染与处理 (mark)' },
] as const

/** 单行开关:读 scope 对应工具的 enabled,拨动时写深路径。 */
function ToolRow(props: {
  tool: (typeof TOOLS)[number]
  scope: SettingsScope<RorokoToolSettings> | undefined
}): ReturnType<typeof h> {
  const { tool, scope } = props
  const enabled = useSyncExternalStore(
    (onStoreChange) => (scope === undefined ? () => {} : scope.subscribe(onStoreChange)),
    () => scope?.getSnapshot().value?.[tool.id]?.enabled ?? true,
  )
  const disabled = scope === undefined
  const toggle = () => {
    if (scope === undefined) return
    void scope.mutate([{ op: 'set', path: [tool.id, 'enabled'], value: !enabled }])
  }
  return h('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  },
    h('div', {},
      h('div', { style: { fontWeight: 600 } }, tool.title),
      h('div', {
        style: {
          color: 'var(--dsw-text-secondary, #888)',
          fontSize: '0.9em',
          marginTop: 2,
        },
      }, tool.desc),
    ),
    h('label', {},
      h('input', {
        type: 'checkbox',
        checked: enabled,
        disabled,
        onChange: toggle,
      }),
    ),
  )
}

/** 设置页内容:四工具开关纵列。 */
function RorokoToolSection(props: RorokoToolSectionInjected & SectionOwnerProps): ReturnType<typeof h> {
  const { scope } = props
  return h('div', { style: { padding: '6px 0' } },
    h('div', {
      style: {
        color: 'var(--dsw-text-secondary, #888)',
        fontSize: '0.9em',
        marginBottom: 12,
      },
    }, '洛洛可全家桶插件电箱 — 关闭某工具即熄火,接线(preset 声明)照常。'),
    ...TOOLS.map((tool) =>
      h('div', { key: tool.id, style: { marginTop: 6 } },
        h(ToolRow, { tool, scope }),
      )),
    scope === undefined
      ? h('div', {
        style: {
          marginTop: 12,
          padding: '10px 12px',
          background: 'var(--dsw-surface-secondary, rgba(128,128,128,.08))',
          borderRadius: 6,
          fontSize: '0.85em',
          color: 'var(--dsw-text-secondary, #888)',
        },
      }, 'settings 服务不可用,开关暂被禁用。')
      : null,
  )
}

export function apply(ctx: RorokoToolClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'roroko-tool: dictionaries')
  const t = ctx.locale.bind(NS)
  const scope = ctx.settingsScope.bind<RorokoToolSettings>({ namespace: 'roroko-tool' })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'roroko-tool',
    order: 30,
    label: () => t('nav'),
    locale: NS,
    inject: (): RorokoToolSectionInjected => ({ scope }),
  }, RorokoToolSection))
}
