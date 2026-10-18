/**
 * host 半（node 侧）构建：src/*.ts -> lib/。
 *
 * 服务器从 git 安装本包时不跑构建（无 prepare 脚本），所以 lib/ 必须
 * 跟着提交进仓库：本地 pnpm build → git push → 服务器 dsh plugin add。
 */
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: true,
  sourcemap: false,
  clean: true,
  // host 侧的 @deepseek-ai/* 由运行中的 DSH 提供（peer），一律不打包。
  deps: { neverBundle: [/^@deepseek-ai\//] },
})
