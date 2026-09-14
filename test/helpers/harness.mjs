/** 极简断言工具:沿用 expander-smoke 的风格,零依赖。 */
export function makeAsserts() {
  let passed = 0
  let failed = 0

  /** 稳定序列化:对象键排序,避免"内容相同但键序不同"被误判为不等。 */
  const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable)
    if (value !== null && typeof value === 'object') {
      return Object.keys(value).sort().reduce((acc, key) => {
        acc[key] = stable(value[key])
        return acc
      }, {})
    }
    return value
  }

  const ok = (cond, msg) => {
    if (cond) {
      passed += 1
      console.log('PASS:', msg)
    } else {
      failed += 1
      console.error('FAIL:', msg)
    }
  }

  const eq = (actual, expected, msg) => {
    const a = JSON.stringify(stable(actual))
    const b = JSON.stringify(stable(expected))
    ok(a === b, `${msg}${a === b ? '' : `  期望 ${b} 得到 ${a}`}`)
  }

  const done = (title) => {
    console.log(failed === 0
      ? `\n✅ ${title}:${passed} 项全通过`
      : `\n❌ ${title}:${failed} 失败 / ${passed} 通过`)
    return failed
  }

  return { ok, eq, done }
}

/** 用临时目录当 DSH_HOME,返回清理函数。必须在 import lib 之前调用。 */
export async function useTempDshHome(prefix = 'roroko-test-') {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), prefix))
  process.env.DSH_HOME = dir
  return {
    dir,
    profileDir: join(dir, 'profiles', 'web'),
    statePath: join(dir, 'profiles', 'web', 'roroko-tool-state.json'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

/**
 * 把一个 WebServerLike 的 register 收集起来,起一个真实 http server 分发。
 * 返回 { url, routes, close }。
 */
export async function startRouteServer(registerRoutes) {
  const http = await import('node:http')
  const routes = []
  const dispose = registerRoutes({
    register: (route) => {
      routes.push(route)
      return () => {}
    },
  })

  const server = http.createServer(async (request, response) => {
    const path = (request.url ?? '').split('?')[0]
    const hit = routes.find(route => route.kind === 'exact' && route.path === path)
    if (hit === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    try {
      await hit.handler(request, response)
    } catch (error) {
      response.writeHead(500)
      response.end(String(error))
    }
  })

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  return {
    url: `http://127.0.0.1:${port}`,
    routes,
    async close() {
      if (typeof dispose === 'function') dispose()
      await new Promise(resolve => server.close(resolve))
    },
  }
}
