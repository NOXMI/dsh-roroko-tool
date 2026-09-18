/**
 * 测试总入口:跑全部套件,汇总退出码。
 * 运行:node test/run-all.mjs    (或 npm test)
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)

const suites = [
  { file: 'expander-smoke.mjs', nodeArgs: [] },
  { file: 'settings-unit.mjs', nodeArgs: [] },
  { file: 'state-io.mjs', nodeArgs: [] },
  { file: 'datas-query.mjs', nodeArgs: [] },
  { file: 'memory-unit.mjs', nodeArgs: [] },
  {
    file: 'memory-tool.mjs',
    // memory.js 顶层 import dsh-tools 的 defineTool(值导入),同样走替身。
    nodeArgs: ['--import', pathToFileURL(join(here, 'helpers', 'register-stubs.mjs')).href],
  },
  { file: 'route-state.mjs', nodeArgs: [] },
  { file: 'preinject-form.mjs', nodeArgs: [] },
  {
    file: 'datas-autoinject.mjs',
    // 机制本体 import 了 dsh-llm 的 createUserMessage(值导入),同样走替身。
    nodeArgs: ['--import', pathToFileURL(join(here, 'helpers', 'register-stubs.mjs')).href],
  },
  {
    file: 'preinject-unit.mjs',
    // preinject.js 顶层 import 了 DSH 运行时包,靠解析钩子换成本地替身。
    // 注意:--import 在 Windows 上必须给 file:// URL,盘符路径会被判成协议 'g:'。
    nodeArgs: ['--import', pathToFileURL(join(here, 'helpers', 'register-stubs.mjs')).href],
  },
]

const results = []
for (const { file, nodeArgs } of suites) {
  console.log(`\n${'='.repeat(64)}\n▶ ${file}\n${'='.repeat(64)}`)
  const run = spawnSync(
    process.execPath,
    [...nodeArgs, join(here, file)],
    { cwd: root, stdio: 'inherit' },
  )
  results.push({ file, code: run.status ?? 1 })
}

console.log(`\n${'='.repeat(64)}\n汇总\n${'='.repeat(64)}`)
for (const { file, code } of results) {
  console.log(`${code === 0 ? '✅' : '❌'} ${file}`)
}
const failed = results.filter(item => item.code !== 0).length
console.log(failed === 0 ? '\n🎉 全部套件通过' : `\n❌ ${failed} 个套件失败`)
process.exit(failed === 0 ? 0 : 1)
