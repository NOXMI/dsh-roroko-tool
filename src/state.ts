/**
 * 运行时状态登记处：子模块挂载时把自己的目录与接线参数写进来，host 的 HTTP
 * 路由读出来给设置页。
 *
 * 两个子模块各一张表：preinject 管注入清单，datas 管库路径与自动注入节奏。
 * 设置页按「拿得到哪张就渲染哪块」处理，缺一张不影响另一张。
 */
import type { PreinjectConfig } from './preinject.js'
import type { DatasConfig } from './datas/presets.js'

export interface MountStatus {
  /** 文件基准目录（身份根）。 */
  root: string
  /** 接线层参数（preset config，不含覆盖层）。 */
  config: PreinjectConfig
}

/** datas 子模块的挂载登记。 */
export interface DatasMountStatus {
  /** 覆盖层基准目录（与 preinject 同一个身份根）。 */
  root: string
  /** 接线层参数。 */
  config: DatasConfig
}

/** 一张挂载表：登记 + 注销 + 取首个。 */
function slots<T>(): { register(status: T): () => void; all(): T[]; first(): T | undefined } {
  const items = new Map<number, T>()
  let key = 0
  return {
    register(status: T): () => void {
      key += 1
      const mine = key
      items.set(mine, status)
      return () => {
        items.delete(mine)
      }
    },
    all: () => [...items.values()],
    first: () => [...items.values()][0],
  }
}

const PREINJECT = slots<MountStatus>()
const DATAS = slots<DatasMountStatus>()

/**
 * 登记一次 preinject 挂载。
 * @param status - 本次挂载的实际配置。
 * @returns 注销函数。
 */
export function registerMount(status: MountStatus): () => void {
  return PREINJECT.register(status)
}

/** 当前所有 preinject 挂载的快照。 */
export function mountedStatuses(): MountStatus[] {
  return PREINJECT.all()
}

/** 首个 preinject 挂载（设置页只跟一个实例对话）。 */
export function firstMount(): MountStatus | undefined {
  return PREINJECT.first()
}

/**
 * 登记一次 datas 挂载。
 * @param status - 本次挂载的实际配置。
 * @returns 注销函数。
 */
export function registerDatasMount(status: DatasMountStatus): () => void {
  return DATAS.register(status)
}

/** 首个 datas 挂载。 */
export function firstDatasMount(): DatasMountStatus | undefined {
  return DATAS.first()
}
