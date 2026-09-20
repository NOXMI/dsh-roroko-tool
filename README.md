# @roroko-tool/dsh-roroko-tool

**洛洛可全家桶** —— 给 DeepSeek Harness（DSH）用的一套插件大包：人格指令注入 + 素材库工具 + 呻吟标记显示层展开 + Web 设置页。

---

## 一、它能做什么

DSH 官方对「工作区指令」只提供一条路：把 `AGENTS.md` 追加到**消息段**。本包把注入拆成两条腿：

| 落点 | 效果 |
|---|---|
| **系统段** | 文件内容进系统提示词：常驻、不占消息位、不被上下文压缩折叠 |
| **消息段** | 文件合并成一条 user 消息，会话首次进入时注入一次 |

另外还带：素材库四工具、`-呻吟_X-` 标记的显示层展开、一个网页版设置页。

---

## 二、子插件一览

| 入口 | 注册名 | 作用 |
|---|---|---|
| `.` | `roroko-tool` | host 入口：挂载 `GET/POST /roroko-tool/state` 与 `GET /roroko-tool/presets` |
| `./preinject` | `roroko-preinject` | **指令注入器**（系统段 + 消息段两条腿） |
| `./data` | `roroko-data` | 素材库工具集：`roroko_datas_query` / `roroko_datas_lookup` / `roroko_datas_register` / `roroko_datas_state` |
| `./memory` | `roroko-memory` | **经历记忆**：`roroko_mem_edit`（记一条 / 反思）/ `roroko_mem_date`（按日期回查，默认今天 + 昨天）/ `roroko_mem_rough`（关键词检索）/ `roroko_mem_id`（按 id 取全文）+ **`dream`**（趁没对话时让记忆自己消化一遍，设置页可开关） |
| `./warn` | `roroko-warn` | 超量收敛警告（**尚未实现**） |
| `./client` | — | Web 设置页（含 `-呻吟_X-` 展开的显示层节点） |

---

## 三、安装

```bash
# 在 profile 目录里装（DSH_HOME/profiles/<profile>）
dsh plugin --profile <profile> add github:NOXMI/dsh-roroko-tool
```

装完补两步，少一步都是白装：

**1. profile 的 `bundles` 里加一行**（`profiles/<profile>/package.json`）：

```json
{
  "dependencies": {
    "@roroko-tool/dsh-roroko-tool": "github:NOXMI/dsh-roroko-tool"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@roroko-tool/dsh-roroko-tool"
      ]
    }
  }
}
```

**2. agent preset 里声明要用哪个子插件**（`$DSH_HOME/.agent-presets/<preset>/agent.cordis.yml`）：

```yaml
# 指令注入
- id: roroko-preinject
  name: '@roroko-tool/dsh-roroko-tool/preinject'

# 素材库工具集
- id: roroko-data
  name: '@roroko-tool/dsh-roroko-tool/data'

# 经历记忆(独立 sqlite;config 各项都有缺省值,不需要就整段省掉)
- id: roroko-memory
  name: '@roroko-tool/dsh-roroko-tool/memory'
  config:
    dbPath: '/var/www/api/database/roroko_memory.db'
    owner: persona
    # dream:趁没对话时让记忆自己消化一遍(只在 config 里配也行,设置页里配也行)
    dream:
      enabled: true
      provider: deepseek-official      # 不配 provider + model 就等于没开
      model: deepseek-v4-flash         # ⚠️ 各机器的 model id 不同,读那台机自己的 settings.yaml
      intervalMs: 14400000             # 4 小时
      batch: 20
```

> **preset 声明即开关**——不引用即不存在，没有第二个运行级开关。

> ⚠️ **升级后新增的子插件导出，必须先重启 DSH 宿主**：Node 把 `package.json` 的 `exports` 缓存在**进程内**，宿主启动时尚不存在的子路径（比如某次升级新出现的 `./memory`）在该进程里**永远解析不到**。症状：preset 行报 `never started`，**新建会话与「在新对话中分支」双双失败**（HTTP 200 但 body `ok:false`，界面零提示）。只改 preset 文件是"新会话生效"，**引入新的导出子路径属于进程级变更**，只能重启。详见第六节。

---

## 四、配置

参数有两层来源，**state 覆盖优先、preset config 兜底**：

1. preset 接线时的 `config:`（跟着 preset 走）
2. host state 文件（网页设置页编辑）

```jsonc
// $DSH_HOME/profiles/<profile>/roroko-tool-state.json
{
  "presets": {
    "common": {                      // 公共层:没写 preset 的会话用这一层
      "preinject": {
        "systemFiles": ["AGENTS.md", "IDENTITY.md"],   // 系统段文件清单
        "systemOrder": 100,                            // 系统段 order
        "systemHeader": "",                            // 系统段前置文本
        "systemFooter": "",                            // 系统段后置文本
        "files": ["PLAYER.md", "MEMORY.md"],           // 消息段文件清单
        "header": "<roroko-reminder> …",               // 消息段前置文本
        "footer": "… </roroko-reminder>",              // 消息段后置文本
        "wrapInSystemReminder": false,                 // 消息段再包一层 <system-reminder>
        "filesPlacement": "after-user",                // 消息段落点
        "splitFiles": false                            // 每文件各一条
      }
    },
    "<preset-id>": { "preinject": { /* 只写要覆盖的字段 */ } }
  },
  "data": { "dbPath": "<soul.db 绝对路径>" },
  "mark": { "enabled": true },
  "warn": {}
}
```

**覆盖语义**：字段**缺失** = 跟随继承；字段**存在**（含空清单、空串）= 显式设定（空清单就是"不注入"）。具体 preset 的桶叠在 `common` 之上。

读写走 host 挂的 HTTP route，不用官方 settings 服务（远程浏览器走域名/隧道时官方那套写不进去）：

```
GET  /roroko-tool/state    → 200 完整 state（另带一份兼容视图 preinject）
POST /roroko-tool/state    → { tool: 'preinject' | 'data' | 'mark', … }
GET  /roroko-tool/presets  → 扫 $DSH_HOME/.agent-presets 列出 preset 卡片
```

> POST 有同源校验：`new URL(Origin).host === Host`，对不上即 403；非浏览器（无 Origin）一律拒。

---

## 五、参数说明

### 5.1 注入文件怎么找（preinject）

| 写法 | 解析到 |
|---|---|
| `AGENTS.md` | 会话工作区（cwd） |
| `${presetDir}/AGENTS.md` | `$DSH_HOME/.agent-presets/<本会话当前 preset id>/` |
| `${dshHome}/x.md` | `$DSH_HOME`（缺省 `~/.dsh`） |
| `${cwd}/x.md` | 会话工作区路径 |
| `~/x.md` | 用户主目录 |
| `/abs/path/x.md` | 绝对路径原样 |

「当前 preset」= 会话 log 里最新一条 `agent-preset/selected`（页面切 preset 后立刻生效），不是创建会话时写进 header 的那个。

文件不存在则**静默跳过**，其余照常注入。

### 5.2 系统段

- `systemFiles` / `systemHeader` / `systemFooter` / `systemOrder`
- `systemOrder` 改动**需要重新挂载 preset**（重开会话或重启 DSH）才生效；文件清单与内容则是**新开会话时现读**
- 可选开启 `personaSection: true` 接管 `deployment:persona` 槽位（独占整个系统提示词）——开启前**必须先从 preset 删掉 `dsh-persona` 那一行**，同层同名会直接抛错

### 5.3 消息段

- `files` / `header` / `footer` / `wrapInSystemReminder` / `filesPlacement` / `splitFiles`
- 默认落点 = 本批用户消息**之后**（与官方 `agent-instructions` 同位），可改为之前
- 判重是持久会话日志驱动的：注入过的会话（含进程重启后恢复的）不会重复注入；上下文被压缩折叠掉之后会自然重新注入

### 5.4 素材库（data）

- `roroko_datas_query` **取料**：表概览 + 候选召回。默认**发散**（池内均匀随机，每次结果不同）；给 `kw` 按关键词收束，`clothing` 另可给 `slot` / `reveal_level`（暴露上限 ≤N）/ `signal_level`（信号下限 ≥N）。穿搭按槽位动态分组（每槽位 `limit` 条，默认 2），候选不足时提示用 `roroko_datas_register` 落库
- `roroko_datas_lookup` 按名字查详情
- `roroko_datas_register` 不在库里时注册进 `ad_hoc`
- `roroko_datas_state` 读写状态单行（`snap` 读 / `update` 写；库里表名仍是历史遗留的 `soul_state`）
- `dbPath` 默认 `/var/www/api/database/soul.db`，可经 preset config 或设置页覆盖
- 取料口径：`hit_count` 与「多久没用」只作展示、**不参与排序**（按它排会永远推同几条）；记录侧单字关键词**不作命中依据**（库里 62%~84% 是分词产生的单字 token，会误炸）；时间一律本地口径
- **state 短条自动注入**（机制层，不发工具 schema，开关在设置页）：`data.autoinject` 两个独立来源 —— `rounds`（每 N 轮，`every` 默认 8）与 `afterTool`（调过 `roroko_datas_*` 之后的下一步）。短条内容 = `scene / truth / decision / position / body_state / behavior / arousal / 着装四件 / 计数器`，追加在对话**尾部**（只动后缀，不破前缀缓存）；同一回合只注一次；**最短间隔** `minGap`（默认 4 轮，0 = 不限制）——取料工具调得再勤也不会轮轮都注；压缩后自动重注一次（不用干等 N 轮）

### 5.5 呻吟标记（mark）

- `mark.enabled`：显示层是否把 `-呻吟_X-` 展开成呻吟文本；会话日志仍存原文，模型上下文零污染

### 5.6 经历记忆（memory）

- `roroko_mem_edit` **写入与反思**：`op=add` 记一条（`content` 初摘要 + `summary` 二次摘要，`created_at` 由服务端按 **CST+0800** 生成）
- `roroko_mem_edit` `op=reflect` **反思已有那条**（`id`）：**整条覆盖 `content`** + 刷 `reflected_at`，`summary` 不传则保留原样，回执给「字数 旧 → 新」；`owner` / `kind` / `source` 一概不动。**观点变了或出现矛盾时用 `add` 另记一条 —— 不覆盖**（保留矛盾，不消解）
- `roroko_mem_date` **按日期回查**：默认区间 = **今天 + 昨天**（会话开始时先调它）；区间为空时**明说"没有记忆"**，不给模型脑补的空间
- `roroko_mem_rough` **关键词检索**：**一条 SQL + LIKE 包含匹配**（`content` 或 `summary` 里出现过就算命中）→ 返回 `id / 时间 / 类别 / 摘要`；`keywords` 空格或逗号分隔（≤8 个词，**每个词都要命中**才返回该条）；通配符 `% _ \` **会转义**（不会把 `100%` 当成"以 100 开头的一切"）；查不到就**明说"没匹配上"**（跟"桶里没有记忆"分两条文案）
- `roroko_mem_id` **按 id 取全文**：只在摘要不足以判断时用；返回 `content` 全文 + `source`（回会话原文的唯一凭据）
- 独立库，表只有一张 `memory`（默认 `/var/www/api/database/roroko_memory.db`）；**原文不入表**——DSH 会话文件就是原文仓库，`source` 指回去
- **推只有 `MEMORY.md`**：记忆内容全靠工具**拉取**，不新增系统段注入 → 对 request-cache 零冲击
- 写入纪律写在**工具描述**里（常驻 schema，每轮可见）：三问判据（人设层已有 → 不记；永久生效 → 去改人设文件；能改变未来某场景行为 → 记成「触发条件 → 应做」）+ 四类必记（边界演变 / 有效与无效的挑逗 / 未完成的钩子 / 自己的失手）
- `owner` 只在 preset config 里配（小写字母数字与 `. _ -` 白名单），**工具面不暴露桶参数** → 一个 preset 只看得到自己那个桶
- `kind` 只在库里有意义：**只有导入历史流水的脚本会写 `log`**（dream 靠它跳过流水），工具面不暴露分类
- `reflected_at` 就是**反思作业队列**：待办 = `WHERE reflected_at IS NULL ORDER BY created_at ASC`（`roroko_mem_date` 的「未反思 N」是同一队列的计数）
- **2026-09-21 减法**（"工具就只是简单的 sqlite 工具"）：检索删掉汉字 bigram 打分 / 覆盖度 / 命中数与排序权重，退回**一条 SQL**；删掉召回计数 `recalled`（列仍留在表里、代码不读写，老库不用迁移）；删掉 `owner=all` 与工具级 `owner` 参数；删掉 `kind` 入参；dream 的 `maxTokens` / `logDir` 从配置项降回内置常量

#### dream —— 趁没对话的时候，让记忆自己消化一遍

记忆只写不改会越堆越臃肿，措辞也会飘。dream 干的事只有一件：把**还没反思过**的记忆挑出来，**起一个一次性会话**让它自己整理一遍，并记下「什么时候反思的」。

- **挑哪些**：`reflected_at` 为空、且 **`kind ≠ log`**（导入的开发日志不算 —— 那是逐字流水，再让模型提炼一遍纯属白烧 token）
- **它不是外人**：会话按指定的 **preset** 装配 —— 人设走 preinject 注入的系统段（妈妈的设定、你的设定都在），工具走那个 preset 声明的插件行（含 `roroko_mem_*`）。所以它**能自己 `roroko_mem_id` 取全文、自己 `roroko_mem_edit` 改回去**，而不是"拿一段提示词盲改"
- **任务书里只给清单**（`#id · 时间 · 摘要预览`），正文让它自己按需取 —— 省上下文，也逼它走一遍"取全文再改"的正路；第一句就是「**现在进入记忆整理模式**」，并划清边界（不是对话、不是开发、不动文件、不开 shell、不上网）
- **什么时候跑**：默认每 **4 小时**一次，一批最多 **20 条**；也可以在设置页点「**立即整理一次**」当场跑
- **改法有边界**：清单里的条目只做「**整条覆盖**」；**矛盾不抹平** —— 观点变了就被要求另记一条（`op=add`，回执里的「自记 N 条」就是它）；`owner` / `kind` / `source` 一概不动
- **跑没跑成看什么**：只看 `reflected_at` 有没有**真落下去** —— 没落就不推进队列，下次原样再跑（回执会明说「完成，反思 N 条」还是「**没有记忆变更**」，并顺带报会话 id 与它自己 `add` 了几条）
- **花不花钱**：**没配 `provider` + `model` 就静默跳过**（不报错、也不烧 token）；**队列为空时连会话都不起** —— 一次模型都不调
- **去哪看结果**：`roroko_mem_date` 的「未反思 N」跟着减；每次整理的审计落在 `<库目录>/dream-log/<时间>.md`，记**会话 id / preset / 字数 diff**（只记事实，不记模型自述）；dream 起的会话本身也留在会话列表里（id 带 `dream-` 前缀，可回放）
- ⚠️ **会话的 `maxTokens` 是内置常量 8192**：带 thinking 的推理模型（如 `deepseek-v4-flash`）在 2048 下会把额度全花在 reasoning 上、**正文一个字都不吐** —— 换模型时留意这条

**怎么开**（两种都行，面板优先）

- config 形状：`dream: { enabled, intervalMs, batch, provider, model, preset, cwd }` —— 全部可选；`provider` + `model` 不配齐就等于没开；**`preset` 决定它看到的人设与工具**（留空 = 用部署默认 preset，会话里就没有人设行），**`cwd` 是会话工作目录**（留空 = 进程 cwd）
- **设置页「经历记忆与 dream」分区**：开关 / provider / model / 间隔 / 批量 / **preset** / **cwd** + 「立即整理一次」+ 状态回读（`GET/POST /roroko-tool/dream`）。面板值存 state **覆盖层**、字段级叠在 preset config 之上（**默认值一个都不写进 state**，免得把 config 压住）；**provider / model / preset / cwd 改完立刻生效**（下一轮整理就用新的），间隔改动在下一轮重新计时时生效 —— 都不必重启宿主

---

## 六、已知限制

- `roroko-warn` **尚未实现**。
- 系统段 `order` 改动**需要重新挂载 preset**；文件清单改动则新开会话即生效。
- 接管 persona 槽位（`personaSection: true`）**必须先删掉 preset 里的 `dsh-persona`**，且完整装配只在**新建会话**时发生——旧会话不会重装配。
- 系统段内容**在会话装配时读取、会话内固化**：同一会话中途改注入文件不会刷新，要新开会话。
- 系统段与官方 `dsh-agent-instructions` 可能**重复吃同一份 `AGENTS.md`**，接线时二选一。
- **新增子插件导出子路径（`package.json` 的 `exports`）后必须重启 DSH 宿主**：宿主进程内缓存 exports，启动之后才出现的子路径永远是 `never started`（fiber 没建起来，连堆栈都没有）。判据很好记——**同一份代码，在刚启动的实例里挂得上、在长期运行的实例里挂不上**，就是它。想确诊可以临时加一个"行指向已知可挂模块"的对照，或在隔离实例（`DSH_HOME=<临时目录>`）里复现。

---

## 许可

MIT
