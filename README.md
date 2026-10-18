# @roroko-tool/dsh-roroko-tool

洛洛可全家桶：**一个插件入口，四个子模块**。装配进 DeepSeek Harness 0.2.1+。

## 结构

```
package.json          dsh.bundle.patch + engines.dsh（0.2.1 起兼容性先看 engines）
cordis.patch.yml      插入宿主行 + 「洛洛可」preset 行
src/index.ts          宿主入口 name='roroko-tool'，按配置桶挂载子模块
src/preinject.ts      roroko-preinject：双段上下文注入
lib/                  构建产物（随仓库提交，服务器安装时不编译）
```

子模块用 `ctx.inject(['服务'], scope => mount(scope, cfg))` 各自起子 fiber：
服务缺席只让那个子模块不激活，不拖累兄弟模块。

## 子模块

| 模块 | 状态 | 职责 |
|---|---|---|
| `preinject` | 0.1 可用 | 系统段（接管 `deployment:persona-prefix`）+ 消息段（pre-step 一次性 user 消息） |
| `datas` | 规划中 | 素材库四表 + soul_state 读写 |
| `memory` | 规划中 | MEMORY.md / 日记的读写与检索 |
| `onahole` | 规划中 | 多端工具对接 |

## preset 里怎么用

```yaml
plugins:
  - id: roroko-tool
    name: '@roroko-tool/dsh-roroko-tool'
    config:
      preinject:
        identityFiles: [IDENTITY.md]
        workspaceFiles: [AGENTS.md]
        suppressHarnessIdentity: true
```

## 文件归属

| 文件 | 归属 | 解析 |
|---|---|---|
| `IDENTITY.md` 等身份文件 | 预设 | 相对 `$DSH_HOME/roroko`（可用 `root` 覆盖） |
| `AGENTS.md` 等工作区文件 | 工作区 | 相对会话 cwd |

## 构建与发布

```bash
pnpm install
pnpm build          # tsdown -> lib/
git add lib && git commit
git push origin dsh-0.2.1
```

服务器安装（**零编译**，仓库里已带 `lib/`，没有 `prepare` 脚本）：

```bash
dsh plugin --profile web add github:NOXMI/dsh-roroko-tool#<commit>
```
