/**
 * 解析钩子:把 DSH 运行时包指到本地替身,让 lib/preinject.js 能在无 node_modules
 * 的机器上被 import(它顶层 import 了 dsh-llm / dsh-system-prompt 的值)。
 */
const STUBS = {
  '@deepseek-ai/dsh-llm': './stubs/dsh-llm.mjs',
  '@deepseek-ai/dsh-system-prompt': './stubs/dsh-system-prompt.mjs',
  '@deepseek-ai/dsh-tools': './stubs/dsh-tools.mjs',
}

export async function resolve(specifier, context, nextResolve) {
  const stub = STUBS[specifier]
    ?? (specifier.startsWith('@deepseek-ai/') ? './stubs/empty.mjs' : undefined)
  if (stub !== undefined) {
    return { url: new URL(stub, import.meta.url).href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
