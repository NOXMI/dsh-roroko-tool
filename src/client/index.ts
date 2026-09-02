/**
 * dsh-roroko-tool client — 洛洛可全家桶设置页。
 *
 * 注册一个 settings.section entry,在 WebGUI 设置侧边栏长出
 * 「Roroko Tool」导航项。参照 dsh-market 独立插件 client 范式:
 * ctx.slots.inject('settings.section', ...) + locale 双语注册 +
 * createElement as h(免 JSX 转换)。
 *
 * 本页当前为最小验证壳:显示包名与占位信息。后续子插件
 * (preinject / data / warn)的开关与配置面板在此聚合。
 */
import { createElement as h } from 'react'
import { NS, en, zh } from './locales.ts'

/** 本插件用到的 slots 服务子面(结构类型,不依赖 monorepo 内部类型)。 */
interface SlotsService {
  inject(slot: string, register: () => unknown): void
  register(meta: Record<string, unknown>, component: () => unknown): unknown
}

/** roroko-tool client 上下文(host 提供真实 Context;此处只声明用到的面)。 */
interface RorokoToolClientContext {
  effect(callback: () => unknown, label?: string): void
  locale: {
    register(namespace: string, dicts: { zh: unknown; en: unknown }): unknown
    bind(namespace: string): (key: keyof typeof zh) => string
  }
  slots: SlotsService
}

export const name = 'roroko-tool'
export const inject = ['slots', 'locale']

/** 设置页内容组件(纯 div 布局,placeholder 验证用)。 */
function RorokoToolSection(_props: { close: () => void }): ReturnType<typeof h> {
  return h('div', { style: { padding: '6px 0' } },
    h('div', { style: { fontWeight: 600 } }, 'Roroko Tool'),
    h('div', {
      style: {
        color: 'var(--dsw-text-secondary, #888)',
        fontSize: '0.9em',
        marginTop: 4,
      },
    }, '洛洛可全家桶插件设置页(骨架验证壳)。'),
    h('div', {
      style: {
        marginTop: 16,
        padding: '10px 12px',
        background: 'var(--dsw-surface-secondary, rgba(128,128,128,.08))',
        borderRadius: 6,
        fontSize: '0.92em',
      },
    }, 'version 0.0.0 — 子插件面板待接入'),
  )
}

export function apply(ctx: RorokoToolClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'roroko-tool: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'roroko-tool',
    order: 30,
    label: () => t('nav'),
    locale: NS,
  }, (ownerProps: { close: () => void } = { close: () => {} }) => h(RorokoToolSection, ownerProps)))
}
