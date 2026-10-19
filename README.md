# @roroko-tool/dsh-roroko-tool

洛洛可全家桶：**一个插件入口，四个子模块**。装配进 DeepSeek Harness 0.2.1+。

## 结构

```
package.json          dsh.bundle.patch + engines.dsh（0.2.1 起兼容性先看 engines）
cordis.patch.yml      插入宿主行 + 「洛洛可」preset 行
src/index.ts          宿主入口 name='roroko-tool'，按配置桶挂载子模块
src/preinject.ts      roroko-preinject：双段上下文注入
src/datas/            roroko-datas：素材库四把工具 + state 短条自动注入
src/routes.ts         设置页数据口（GET /roroko-tool/state · POST /roroko-tool/config）
legacy/memory-0929/   0.1.6 时代 memory 源码存档（不参与构建）
lib/                  构建产物（随仓库提交，服务器安装时不编译）
```

子模块用 `ctx.inject(['服务'], scope => mount(scope, cfg))` 各自起子 fiber：
服务缺席只让那个子模块不激活，不拖累兄弟模块。

## 子模块

| 模块 | 状态 | 职责 |
|---|---|---|
| `preinject` | 可用 | 系统段（接管 `deployment:persona-prefix`）+ 消息段（pre-step 一次性 user 消息） |
| `datas` | 可用 | `roroko_datas_query / lookup / register / state` 四把工具 + state 短条自动注入 |
| `memory` | 源码存档 | 见 `legacy/memory-0929/`，等真搬时照 datas 的形状改 |
| `onahole` | 规划中 | 多端工具对接 |

## preset 里怎么用

```yaml
plugins:
  - id: roroko-tool
    name: '@roroko-tool/dsh-roroko-tool'
    config:
      preinject:
        root: ''                      # 留空 = $DSH_HOME/roroko
        # 接线层（可省）：systemFiles / userFiles，给这个 preset 当基线
        suppressHarnessIdentity: true
      datas:                          # 有桶就挂载：四把工具 + 自动注入
        dbPath: '/var/www/api/database/soul.db'
        autoinject: { rounds: true, every: 8, afterTool: true, minGap: 4 }
```

桶设成 `false` 或整块不写 = 这个模块不挂载；写成 `true` = 全走默认。

## 参数四层链

照 0.1.6 那套，逐字段回落：

```
内置默认 ← preset 接线 config ← 公共桶 common ← 分 preset 桶
```

| 层 | 在哪写 |
|---|---|
| 内置默认 | 代码里，两个清单都空 |
| 接线 | preset 行的 `config.preinject` |
| 公共默认 | 设置页「公共默认」卡 → `<root>/state/preinject.json` 的 `presets.common` |
| 分预设 | 设置页每个 preset 一张卡 → `presets[<agentPreset id>]` |

字段缺失才算未覆盖；空清单 / 空串是显式设定，就是"这一段不注入"。

## 两张清单

| 清单 | 去处 | 生效方式 |
|---|---|---|
| `systemFiles` | 系统提示词（`deployment:persona-prefix`） | 常驻，每次装配现读 |
| `userFiles` | 一条 user 消息，追加在用户消息之后 | 每会话一次，进程内存登记 |

用户层是**纯拼接**：文件内容原样拼起来，注入侧不加签名、不加 `<system-reminder>`
壳。首尾要什么，就在文件里自己写。

清单项相对 root 解析，`~/` 走主目录，绝对路径原样用；读不到的文件静默跳过，
设置页会把缺失标出来。

### 屏蔽系统段

装配瀑布 `system-prompt/assemble` 里按**段名**过滤，内置抹掉两类：

| 模式 | 抹掉什么 |
|---|---|
| `context:file-reference` | "Tokens prefixed with @ are paths…" 那段 @ 语法说明 |
| `tool:*` | 各工具的使用说明大段（`tool:read` / `tool:write` / `tool:edit` / `tool:glob` / `tool:grep` / `tool:bash` / `tool:web_search` / `tool:web_fetch` …）——工具 schema 里本来就有参数说明 |
| `ui:deliverable-file-references` | "Prefer showing the primary results…" 交付物卡片与文件链接规范 |
| `harness:source` | 实现仓库自检指引（`Use this checkout only to inspect or extend DSH itself`） |
| `app:web-surface` | Web GUI 自述与「别乱起服务器」那一段 |

清单项以 `*` 结尾按**前缀匹配**，所以 `tool:*` 一网打尽，新装工具不用改代码。
配置层的 `suppressSections` 是**叠加**语义——内置的永远在，三层（接线 / 公共桶 /
分预设桶）只能往上加，清空清单也取消不掉。

## datas：素材库四把工具

`node:sqlite` 直连 `soul.db`（默认 `/var/www/api/database/soul.db`），表名列名全在
编译期白名单里，SQL 不做字符串拼接。

| 工具 | 干什么 |
|---|---|
| `roroko_datas_query` | 取料。无 `kw` = 发散（池内均匀随机）；给 `kw` 或收束条件 = 收束 |
| `roroko_datas_lookup` | 按名查详情（clothing / sexual_items / companion_pool / scenes） |
| `roroko_datas_register` | 兜底注册：主表同名合并关键词，否则进 `ad_hoc` |
| `roroko_datas_state` | `snap` 读 soul_state（带 staleness 鞭策）/ `update` 白名单写回 |

取料口径（从 0.1.6 原样搬，别"优化"）：

- 库不当裁判——发散为默认，收束条件由模型给
- 记录侧 keywords 里 62%~84% 是单字，**单字 token 不作命中依据**（会误炸）
- 用现有列、不加列；`slot` 分组键从库里动态取
- `hit_count` / `last_used_at` **只展示，不排序**
- 全表进内存再匹配（最大表 128 行，规则可控优先）

收束参数：`slot`（逗号分隔）、`reveal_level`（上限）、`signal_level`（下限）、
`limit`（clothing 是每槽位条数）。渲染带表概览、收束链留痕、槽位分组、`ad_hoc`
补位，候选不足时提示去 `register`。

**自动注入**：取过料 / 每 N 轮 / 压缩后，往 pre-step 的消息尾部追加一条 state 短条
（`truth` / `decision` / `position` 这些）。不注册工具、不发 schema、不碰 system 段，
不破 KV 前缀缓存。开关与节奏在设置页按 preset 配。

## 设置页

设置面板里与「通用」「模型」「插件」同级的一页（`settings.section`，order 50）：

- 公共默认一张卡（默认展开）+ 注册表里每个 preset 一张折叠卡，卡头带
  「基线 / 已覆盖 / 跟随继承 / 挂不起来」徽标
- 每组参数一个「覆盖」勾选框：不勾 = 一个字段都不发，跟随继承；勾了整组落盘
- 两组都不覆盖时保存 = 把这个桶删掉；另有「重置为继承」
- 文件状态（就绪 / 缺失 + 大小）
- 同一张卡下半部分是素材库：库路径 + 自动注入四开关（`rounds` / `afterTool` /
  `every` / `minGap`），同样按「覆盖」勾选决定发不发

路由（webServer 普通路由，不碰 Remote / configForms）：

```
GET  /roroko-tool/state   桶 + roster + 各 scope 生效值 + 文件状态 + datas 一块
POST /roroko-tool/config  按 preset 写桶：{preset, section:'preinject'|'datas', …}
                          字段传 null 删键，{preset, section, reset:true} 删桶
```

两个模块的覆盖层分文件存：`<root>/state/preinject.json` 与 `<root>/state/datas.json`，
结构同形（`{ presets: { common: {…}, <presetId>: {…} } }`）。

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
node test/routes-smoke.mjs      # 两条路由 + 分桶读写
node test/datas-smoke.mjs       # 取料匹配/收束/渲染 + datas 四层链 + 覆盖层落盘
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
