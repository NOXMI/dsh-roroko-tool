/**
 * 运行时状态登记处：子模块挂载时把自己的目录与接线参数写进来，host 的 HTTP
 * 路由读出来给设置页。
 */
import type { PreinjectConfig } from './preinject.js'

export interface MountStatus {
  /** 文件基准目录（身份根）。 */
  root: string
  /** 接线层参数（preset config，不含覆盖层）。 */
  config: PreinjectConfig
}

const MOUNTS = new Map<number, MountStatus>()
let nextKey = 1

/**
 * 登记一次子模块挂载。
 * @param status - 本次挂载的实际配置。
 * @returns 注销函数。
 */
export function registerMount(status: MountStatus): () => void {
  const key = nextKey
  nextKey += 1
  MOUNTS.set(key, status)
  return () => {
    MOUNTS.delete(key)
  }
}

/** 当前所有挂载的快照。 */
export function mountedStatuses(): MountStatus[] {
  return [...MOUNTS.values()]
}

/** 首个挂载的完整登记项（设置页只跟一个 preinject 实例对话）。 */
export function firstMount(): MountStatus | undefined {
  return mountedStatuses()[0]
}
