/**
 * @roroko-tool/dsh-roroko-tool —— 洛洛可全家桶。
 *
 * 设计：**一个插件、一行声明**，子模块在包内按需挂载，不对外暴露子路径。
 *
 *   preset 里只写：
 *     - id: roroko-tool
 *       name: '@roroko-tool/dsh-roroko-tool'
 *       config: { preinject: { … } }
 *
 * 每个子模块用 ctx.inject(['服务'], scope => mount(scope, cfg)) 起独立子 fiber：
 * 某个服务缺席只会让那个子模块不激活，不拖累兄弟模块，也不用静态 inject 求并集。
 *
 * 子模块只在配置桶**存在**时才挂载：bundle 层那条不带 config 的宿主行因此什么
 * 模块都不挂（否则会在全局 scope 抢 persona 位，与 prompt registry 冲突）。
 *
 * 宿主职责：webServer 可用时挂三条设置页数据路由（/roroko-tool/state、/config、
 * /reset），与子模块互不依赖。
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { mount as mountPreinject, type PreinjectConfig } from './preinject.js'
import { registerStateRoutes, type WebServerLike } from './routes.js'

export const name = 'roroko-tool'

/** 子模块配置：schema 化之后，Plugins 页才有本插件自己的页面与表单。 */
export const Config: z<RorokoToolConfig> = z.object({
  preinject: z.union([
    z.boolean(),
    z.object({
      root: z.string().description('文件基准目录（默认 $DSH_HOME/roroko）'),
      suppressHarnessIdentity: z.boolean().description('顶掉官方开场白段'),
    }),
  ]).description('上下文注入子模块（两张清单在设置页里写）'),
}) as z<RorokoToolConfig>
/** 本包版本（设置页显示用）。 */
export const version = '0.1.0'

/** 插件配置：一层桶对应一个子模块；桶设成 false 即不挂载。 */
export interface RorokoToolConfig {
  preinject?: PreinjectConfig | boolean
  // datas?: DatasConfig | boolean
  // memory?: MemoryConfig | boolean
  // onahole?: OnaholeConfig | boolean
}

interface InjectSurface {
  inject(services: string[], callback: (scope: Context) => void): unknown
}

/**
 * 插件入口。
 * @param ctx - 本行插件所在的上下文（profile 层或 preset scope）。
 * @param config - 见 {@link RorokoToolConfig}。
 */
export function apply(ctx: Context, config: RorokoToolConfig = {}): void {
  const surface = ctx as unknown as InjectSurface

  surface.inject(['webServer'], (scope) => {
    const server = (scope as unknown as { webServer: WebServerLike }).webServer
    ;(scope as unknown as { effect(fn: () => unknown, label?: string): unknown })
      .effect(() => registerStateRoutes(server, version), 'roroko-tool: 设置页路由')
  })

  const preinject = config.preinject
  if (preinject !== undefined && preinject !== false && preinject?.enabled !== false) {
    surface.inject(['systemPrompt'], (scope) => {
      mountPreinject(scope, preinject === true ? {} : preinject)
    })
  }
}



