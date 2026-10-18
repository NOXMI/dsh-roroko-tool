/**
 * host 半（node 侧）：src/index.ts -> lib/，ESM。
 * 服务器从 git 安装本包时不跑构建（无 prepare 脚本），所以 lib/ 跟仓库一起提交。
 */
import { defineConfig } from 'tsdown'

const ID = '@roroko-tool/dsh-roroko-tool'

/** 模块表里由页面提供的运行时依赖，一律不打包。 */
const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime', 'react-dom']

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'node22',
    dts: true,
    sourcemap: false,
    clean: true,
    // host 侧的 @deepseek-ai/* 由运行中的 DSH 提供（peer），一律不打包。
    deps: { neverBundle: [/^@deepseek-ai\//] },
  },
  {
    // 浏览器半：lazy-CJS 工厂，向页面模块加载器登记包名。
    entry: { client: 'src/client/index.tsx' },
    outDir: 'client',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: false,
    clean: false,
    deps: { neverBundle: CLIENT_EXTERNALS },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
