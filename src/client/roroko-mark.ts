/**
 * roroko-mark client 侧开关存取:读服务器 state `mark.enabled`,决定 web
 * 渲染是否把 -呻吟_X- 标记展开。
 *
 * 不走官方 settingsScope(远程浏览器写 memory no-op),改经同源 fetch 打
 * host 的 GET/POST /roroko-tool/state(与 src/routes.ts 对应)。
 * 结果做 module 级缓存 + 订阅,shadow 节点用 useSyncExternalStore 消费,
 * 设置页 toggle 经 setRorokoMarkEnabled 落盘后同步刷新缓存。
 */

import { useSyncExternalStore } from 'react'
import { api } from './api.ts'

/** state 文件 mark 节 wire 形状(与 host settings.ts 一致)。 */
interface RorokoMarkWire {
  enabled: boolean
}

type Listener = () => void

let cached: RorokoMarkWire | null = null
let loading: Promise<void> | null = null
const listeners = new Set<Listener>()

/** 默认开(与 host state 默认一致):fetch 失败/未加载时按展开处理。 */
const FALLBACK_ENABLED = true

async function refresh(): Promise<void> {
  try {
    const response = await fetch(api('/roroko-tool/state'), { cache: 'no-store' })
    if (!response.ok) return
    const body = (await response.json()) as { mark?: { enabled?: unknown } }
    const enabled = typeof body?.mark?.enabled === 'boolean'
      ? body.mark.enabled
      : FALLBACK_ENABLED
    if (cached === null || cached.enabled !== enabled) {
      cached = { enabled }
      for (const listener of listeners) listener()
    }
  } catch {
    // 网络/网关暂不可用:保留当前值,下次渲染重试。
  }
}

/** 首次订阅时惰性拉取(只拉一次,module 级缓存跨组件共享)。 */
function ensureLoaded(): void {
  if (cached === null && loading === null) {
    loading = refresh().finally(() => { loading = null })
  }
}

/**
 * 订阅当前 mark 展开开关。
 * @returns 是否展开 -呻吟_X- 标记(默认 true)。
 */
export function useRorokoMarkEnabled(): boolean {
  ensureLoaded()
  return useSyncExternalStore(
    (onStoreChange: Listener) => {
      listeners.add(onStoreChange)
      return () => { listeners.delete(onStoreChange) }
    },
    () => cached?.enabled ?? FALLBACK_ENABLED,
  )
}

/**
 * 设置页 toggle:POST 落盘 mark.enabled 并同步本地缓存。
 * @param enabled - 新的展开开关值。
 * @returns 落盘后的完整 state(失败返回 null)。
 */
export async function setRorokoMarkEnabled(
  enabled: boolean,
): Promise<{ preinject: unknown; data: unknown; warn: unknown; mark: { enabled: boolean } } | null> {
  try {
    const response = await fetch(api('/roroko-tool/state'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'mark', enabled }),
    })
    const body = (await response.json()) as {
      ok?: boolean
      error?: string
      state?: { mark?: { enabled?: unknown } }
    }
    if (!response.ok || body.ok !== true || body.state === undefined) {
      return null
    }
    const next = typeof body.state.mark?.enabled === 'boolean'
      ? body.state.mark.enabled
      : enabled
    cached = { enabled: next }
    for (const listener of listeners) listener()
    return body.state as {
      preinject: unknown
      data: unknown
      warn: unknown
      mark: { enabled: boolean }
    }
  } catch {
    return null
  }
}
