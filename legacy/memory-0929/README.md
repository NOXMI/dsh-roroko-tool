# legacy/memory-0929 — 0.1.6 时代 memory 子模块源码存档

**不是能编译的代码，是存档。** 本目录不在 `tsdown.config.ts` 的 entry 里，也不进 `lib/`，
构建与运行都不碰它。

## 为什么躺在这儿

2026-09-29 那版 `@roroko-tool/dsh-roroko-tool` 的 memory 子模块（`roroko_mem_*` 六把工具 +
做梦/反思流程）**从来没有进过 git**——它只存在于本机 profile 的
`node_modules/@roroko-tool/dsh-roroko-tool/src/` 里。profile 一重装，这份设计就没了。

2026-10-19 的 0.2.1 重写没有搬它：新分支是「一个插件入口 + 配置桶」的结构，memory 排
在 datas 之后。先把源码存进仓库保命，等真要搬的时候照下面的对应关系改。

## 文件

| 文件 | 职责 |
|---|---|
| `memory.ts` | 子模块入口：六把 `roroko_mem_*` 工具注册 + 接线 config |
| `memory-store.ts` | 独立 sqlite（`roroko_memory.db`）的建表与读写 |
| `memory-form.ts` | 记忆 CRUD 的参数清洗与 markdown 渲染（纯逻辑） |
| `memory-dream.ts` | 反思/做梦流程：触发条件与产出落库 |
| `memory-dream-session.ts` | 做梦与 session 的挂点（pre-step / 压缩后） |
| `memory-dream-form.ts` | 做梦流程的纯逻辑（候选抽取、摘要渲染） |

## 搬进 0.2.1 时要改的地方（照着 datas 抄）

1. **挂载口**：模块级 `export const inject = ['tools']` 要退休。改成
   `src/memory/index.ts` 导出 `mount(ctx, cfg)`，由 `src/index.ts` 在 `config.memory` 桶存在时
   `ctx.inject(['tools'], scope => mountMemory(scope, cfg))`。
2. **消息来源**：注入消息的 `source` 不能再用 `{ kind: 'plugin', plugin: … }`（session format v4
   已弃用），改自有 kind，如 `{ kind: 'roroko-memory-dream' }`。
3. **参数覆盖层**：不要复用 `settings.ts` 那套全局 state 文件，照 `src/state.ts` +
   `src/datas/presets.ts` 的按 preset 分桶写法，落 `<root>/state/memory.json`。
4. **设置页**：照 `src/client/index.tsx` 里 `DatasPanel` 的形状加一块，走
   `POST /roroko-tool/config` 的 `section: 'memory'`。
5. **事件面**：`agent/pre-step`（0.2.1 有 `agent` / `turn` / `step` / `signal`）与
   `tools/result`（带 `exec.agent?.session`）都验证过可用，做梦的轮数/压缩口径可以直接搬。

## 原始出处

`C:\Users\Administrator\.dsh\profiles\web\node_modules\@roroko-tool\dsh-roroko-tool\src\`（2026-09-29 构建）。
本目录只是 source 副本，`lib/` 产物没存——需要运行时的旧行为就去那个路径找。
