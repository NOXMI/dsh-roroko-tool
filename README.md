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
| `./memory` | `roroko-memory` | **经历记忆**：`roroko_mem_edit`（记一条）/ `roroko_mem_date`（按日期回查，默认今天 + 昨天）/ `roroko_mem_rough`（关键词检索）/ `roroko_mem_id`（按 id 取全文） |
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

# 经历记忆(独立 sqlite;config 两项都有缺省值,不需要就整段省掉)
- id: roroko-memory
  name: '@roroko-tool/dsh-roroko-tool/memory'
  config:
    dbPath: '/var/www/api/database/roroko_memory.db'
    owner: persona
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

- `roroko_mem_edit` **写入与反思**：`op=add` 记一条（`content` 初摘要 + `summary` 二次摘要 + `owner` 分桶（`dev` / `persona`），`created_at` 由服务端按 **CST+0800** 生成）
- `roroko_mem_edit` `op=reflect` **反思已有那条**（`id`）：**整条覆盖 `content`** + 刷 `reflected_at`，`summary` 不传则保留原样，回执给「字数 旧 → 新」；`owner` / `kind` / `source` / `recalled` 一概不动。**观点变了或出现矛盾时用 `add` 另记一条 —— 不覆盖**（保留矛盾，不消解）
- `roroko_mem_date` **按日期回查**：默认区间 = **今天 + 昨天**（会话开始时先调它）；区间为空时**明说"没有记忆"**，不给模型脑补的空间
- `roroko_mem_rough` **关键词检索**：**汉字走字符 bigram + 覆盖度**、**拉丁/数字词走整词子串**（零向量、不分词，中文模糊、英文精确 —— 理由见下）→ 返回 `id / 时间 / 命中数 / 覆盖度 / 召回数 / 摘要`；`keywords` 空格或逗号分隔（≤8 个词，单字词也认）；**排序 = 命中数降序，召回数与新近度只作同分次序**（不让新鲜度偷偷爬回排序）；相关性下限 = 命中 ≥2 个 gram 或覆盖度 ≥0.5，够不上就**明说"没匹配上"**（跟"桶里没记忆"分两条文案）；命中条 `recalled += 1`
  - 为什么拉丁词不走 bigram：字符二元组对字母没有区分度（`minGap` 切出的 `mi/in/ng/ga/ap` 里 `to`/`en`/`se` 在任何英文段落里都烂大街）—— 实测旧口径下 `minGap` 命中 30 条仅 1 条真相关、`ds-persona` 是 0/30；改整词子串后拉丁侧 **0 误命中 / 0 漏**，中文侧膨胀仍是 **1.00 倍 / 零漏**
- `roroko_mem_id` **按 id 取全文**：只在摘要不足以判断时用；返回 `content` 全文 + `source`（回会话原文的唯一凭据）+ 最新召回计数（同样 +1）
- 独立库，表只有一张 `memory`（默认 `/var/www/api/database/roroko_memory.db`）；**原文不入表**——DSH 会话文件就是原文仓库，`source` 指回去
- **推只有 `MEMORY.md`**：记忆内容全靠工具**拉取**，不新增系统段注入 → 对 request-cache 零冲击
- 写入纪律写在**工具描述**里（常驻 schema，每轮可见）：三问判据（人设层已有 → 不记；永久生效 → 去改人设文件；能改变未来某场景行为 → 记成「触发条件 → 应做」）+ 四类必记（边界演变 / 有效与无效的挑逗 / 未完成的钩子 / 自己的失手）
- `owner` 走白名单式收窄（小写字母数字与 `. _ -`），检索**默认不跨桶**，要看全桶显式传 `owner=all`
- `reflected_at` 就是**反思作业队列**：待办 = `WHERE reflected_at IS NULL ORDER BY created_at ASC`（第七刀 `dream` 按这个契约消费；`roroko_mem_date` 的「未反思 N」是同一队列的计数）

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
