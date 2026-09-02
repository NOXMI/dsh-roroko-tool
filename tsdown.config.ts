/**
 * Browser client bundle for the dsh-roroko-tool plugin, mirroring the
 * dsh-market client preset for an external package: a closure-factory
 * artifact that calls window.__ModuleLoader__.load({ id, factory }) and
 * resolves externals through the injected require (loader module table).
 *
 * 本页当前为纯 div + inline style,无需 CSS Modules,故省略 dsh-market
 * 的 lightningcss 插件;若后续引入 .module.css 再补回。
 */
import { defineConfig } from 'tsdown'

const id = '@roroko-tool/dsh-roroko-tool'

/**
 * Externals resolved from the loader module table at runtime. 只有本包
 * 真正用到的平台种子条目;其余全部 inline。
 */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@deepseek-ai/dsh-client-ui-primitives',
]

export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  // 产物落点:package.json exports "./client" 指向 client/client.js。
  outDir: 'client',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  // tsdown 会自动 external 化 package dependencies;loader module table 答
  // 不出的 require 是运行时必然炸,所以其它依赖必须 inline。
  noExternal: (source: string) => (CLIENT_EXTERNALS.includes(source) ? undefined : true),
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.MODE': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
