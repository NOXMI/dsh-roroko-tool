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
        # 接线层（可省）：systemFiles / userFiles / wrap，给这个 preset 当基线
        suppressHarnessIdentity: true
```

## 参数四层链

照 0.1.6 那套，逐字段回落：

```
内置默认 ← preset 接线 config ← 公共桶 common ← 分 preset 桶
```

| 层 | 在哪写 |
|---|---|
| 内置默认 | 代码里，两个清单都空、`wrap: true` |
| 接线 | preset 行的 `config.preinject` |
| 公共默认 | 设置页「公共默认」卡 → `<root>/state/preinject.json` 的 `presets.common` |
| 分预设 | 设置页每个 preset 一张卡 → `presets[<agentPreset id>]` |

字段缺失才算未覆盖；空清单 / 空串是显式设定，就是"这一段不注入"。

## 两张清单

| 清单 | 去处 | 生效方式 |
|---|---|---|
| `systemFiles` | 系统提示词（`deployment:persona-prefix`） | 常驻，每次装配现读 |
| `userFiles` | 一条 user 消息，追加在用户消息之后 | 每会话一次，判重记在 `<root>/state/injected.json` |

清单项相对 root 解析，`~/` 走主目录，绝对路径原样用；读不到的文件静默跳过，
设置页会把缺失标出来。

## 设置页

设置面板里与「通用」「模型」「插件」同级的一页（`settings.section`，order 50）：

- 公共默认一张卡（默认展开）+ 注册表里每个 preset 一张折叠卡，卡头带
  「基线 / 已覆盖 / 跟随继承 / 挂不起来」徽标
- 每组参数一个「覆盖」勾选框：不勾 = 一个字段都不发，跟随继承；勾了整组落盘
- 两组都不覆盖时保存 = 把这个桶删掉；另有「重置为继承」
- 文件状态（就绪 / 缺失 + 大小）
- 注入记录条数 + 「清空注入记录」

路由（webServer 普通路由，不碰 Remote / configForms）：

```
GET  /roroko-tool/state   桶 + roster + 各 scope 生效值 + 文件状态 + 跳闸记录
POST /roroko-tool/config  按 preset 写桶（字段传 null 删键，{preset, reset:true} 删桶）
POST /roroko-tool/reset   清空跳闸记录
```

## 0.2.1 适配：系统段怎么知道自己是哪个 preset

0.1.6 的 provider 从 `context.agent.session.header.agentPreset` 取；0.2.1 的
`AssembleContext` 只有 `scope`，没有 agent。所以：

- `agent/pre-step`（每 turn 都跑，且早于本 turn 的系统提示词装配）里把
  `session.header.agentPreset` 记进实例变量
- 系统段的 provider 直接读这个变量选桶
- 每个 preset 的 composition 各挂一份本模块实例，scope 路由只把该 preset 下的
  事件送过来，所以这个变量对本实例如同常量
- 真拿不到（装配早于任何 pre-step）就只吃公共桶，行为可预测、不串会话

不依赖 `dsh-scope` 的内部符号，也不要求宿主暴露额外服务——跨安装形态都成立。

用户段不受影响：`session.header.agentPreset` 直接可读。

## 测试

```bash
pnpm build
node test/preinject-smoke.mjs   # 四层链 + 双段注入 + 判重
node test/routes-smoke.mjs      # 三条路由 + 分桶读写
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
