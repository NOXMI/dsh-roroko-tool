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
        root: ''                      # 留空 = $DSH_HOME/roroko
        suppressHarnessIdentity: true
```

清单不在 preset 里写，只在设置页写。

## 两张清单

就两张，谁都不认识、什么都不猜：

| 清单 | 去处 | 生效方式 |
|---|---|---|
| `systemFiles` | 系统提示词（`deployment:persona-prefix`） | 常驻，每次装配现读 |
| `userFiles` | 一条 user 消息，追加在用户消息之后 | 每会话一次，判重记在 `<root>/state/injected.json` |

清单存在 `<root>/state/preinject.json`，设置页读写。清单项相对 root 解析，
`~/` 走主目录，绝对路径原样用；读不到的文件静默跳过，设置页会把缺失标出来。
两个清单都空 = 什么都不注入。

## 设置页

设置面板里与「通用」「模型」「插件」同级的一页（`settings.section`，order 50）：

- 上下两张清单，一行一个文件名，保存即写 `<root>/state/preinject.json`，
  下一步装配生效，不用重挂载 preset
- 用户层一个 `system-reminder` 开关
- 文件状态（就绪 / 缺失 + 大小）
- 已注入会话计数 + 「清空注入记录」

路由（webServer 普通路由，不碰 Remote / configForms）：

```
GET  /roroko-tool/state   两张清单 + 文件状态 + 跳闸记录
POST /roroko-tool/config  整份写清单（全量替换）
POST /roroko-tool/reset   清空跳闸记录
```

## 测试

```bash
pnpm build
node test/preinject-smoke.mjs   # 双段注入 + 清单现读 + 判重
node test/routes-smoke.mjs      # 三条路由 + 清单读写
```

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
