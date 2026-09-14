# @roroko-tool/dsh-roroko-tool

**洛洛可全家桶** —— 给 DeepSeek Harness（DSH）用的一套「人格指令注入 + 素材库工具 + 显示层扩展」插件大包。

> 这份 README 是按「别的机器上的洛洛可照着装一遍」来写的：装什么、怎么接线、每个旋钮管什么、以及**哪些坑是拿血换的**。
> 踩坑结论那一节请务必读完再动手，能省你一个通宵。

---

## 一、它解决什么问题

DSH 官方对「工作区指令」只有一条路：把 `AGENTS.md` 追加到**消息段**。
这条路有三个不够用的地方：

| 官方路线 | 本插件的系统段 |
|---|---|
| 占消息位，每轮都在上下文里排队 | 进 system 字段，不占消息位 |
| compaction 折叠后需要重新注入 | 常驻，不被折叠 |
| 内容随消息落库，改动要等下一会话 | **装配时现读文件**，新会话立刻生效 |

所以本包把注入拆成**两条腿**：

- **系统段** → 进系统提示词，承载人设与规则（AGENTS.md / IDENTITY.md 这类）
- **消息段** → 合并成一条 user 消息，会话首次进入注入一次并落库（PLAYER.md / MEMORY.md 这类）

此外还带素材库工具、呻吟标记显示层展开、以及一个 Web 设置页。

---

## 二、子插件一览

| 入口 | 注册名 | 作用 |
|---|---|---|
| `.` | `roroko-tool` | host 入口：挂载 `GET/POST /roroko-tool/state`（参数读写路由） |
| `./preinject` | `roroko-preinject` | **双段落点指令注入器**（本包核心） |
| `./data` | `roroko-data` | 素材库四工具：`roroko_query` / `roroko_lookup` / `roroko_register` / `roroko_soul` |
| `./warn` | `roroko-warn` | 超量收敛警告（**占位，尚未实现**） |
| `./client` | — | Web 设置页，注册 `settings.section` 的「Roroko Tool」导航项（tsdown 产物） |

> `roroko-mark`（呻吟标记展开）没有独立入口，引擎与渲染节点直接编译进 `./client`，开关存在 state 的 `mark.enabled`。

---

## 三、安装

```bash
# 在 profile 目录里装（DSH_HOME/profiles/<profile>）
dsh plugin --profile <profile> add github:NOXMI/dsh-roroko-tool
```

装完必须补两步，**少一步都是白装**：

### 1. profile 的 `bundles` 里加一行

`profiles/<profile>/package.json`：

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

包里的 `cordis.patch.yml` 靠 `dsh.bundle.patch` 声明落地；不进 `bundles` 就只是躺在那儿。

### 2. agent preset 里声明要用哪个子插件

**preset 声明即开关**——不引用即不存在，没有第二个运行级开关。

`$DSH_HOME/.agent-presets/<preset>/agent.cordis.yml`：

```yaml
# 指令注入（系统段 + 消息段）
- id: roroko-preinject
  name: '@roroko-tool/dsh-roroko-tool/preinject'
  config:
    personaSection: true
    personaHead: |-
      你当前的工作区是 {{cwd}}。
    includeRuntimeContext: false

# 素材库工具集
- id: roroko-data
  name: '@roroko-tool/dsh-roroko-tool/data'
```

> ⚠️ **一旦 `personaSection: true`，必须先把 preset 里 `dsh-persona` 那一行删掉**。
> 同一 scope 内注册同名 section 会直接抛错，agent 装配当场失败。原因见第五节。

---

## 四、配置：两层，state 覆盖优先

每个子插件的参数都有两层来源：

1. **preset 接线时的 `config:`**（推荐，声明即配，跟着 preset 走）
2. **host state 文件覆盖**（Web 设置页编辑）

读取时 **state 覆盖优先、preset config 兜底**。
注意「空值 = 未覆盖」的约定：空清单 / 空字符串一律视为没配，回落到 preset config。

### state 文件

```
$DSH_HOME/profiles/<profile>/roroko-tool-state.json
```

读写走 host 挂的 HTTP route，**不走官方 settings 服务**：

```
GET  /roroko-tool/state   → 200 完整 state
POST /roroko-tool/state   → { tool: 'preinject' | 'data' | 'mark', ... }
```

> 为什么不用官方 settings：远程浏览器（域名/隧道访问）走 `settingsScope` 写 memory 是 **no-op**，存不下去。改成自存 profile 目录 + HTTP route 才真正落盘。
> POST 有同源校验：`new URL(Origin).host === Host`，对不上返回 403；非浏览器（无 Origin）一律拒。

### state 结构

```jsonc
{
  "preinject": {
    "systemFiles": ["AGENTS.md", "IDENTITY.md"],   // 系统段文件清单
    "systemOrder": 100,                            // 系统段基准 order
    "systemHeader": "",                            // 系统段前置文本
    "systemFooter": "",                            // 系统段后置文本
    "files": ["PLAYER.md", "MEMORY.md"],           // 消息段文件清单
    "header": "<roroko-reminder> …",               // 消息段前置文本
    "footer": "… </roroko-reminder>",              // 消息段后置文本
    "wrapInSystemReminder": false                  // 消息段再包一层 <system-reminder>
  },
  "data": { "dbPath": "<soul.db 绝对路径>" },
  "mark": { "enabled": true },
  "warn": {}
}
```

文件路径**相对会话 cwd**；缺失文件静默跳过，其余照常注入。

---

## 五、preinject 详解

### 5.1 系统段：变量承载 + section 引用宏

**做法**：section 的 `text` 只写一个字面宏 `{{roroko_preinject_system}}`，正文由一个 `systemPrompt.variable` provider 提供。

**为什么要绕这一道**：`renderPrompt` 的 `{{}}` 插值是**严格**的——未知变量、空值、畸形引用一律 **throw**，当场打崩整个 turn。而 `"替换进去的值不会被二次扫描"` 是 renderPrompt 的明文语义。所以：

- 文件正文走**变量承载** → 文件里写什么花括号都安全
- `personaHead` 走**字面拼入** → 会进插值扫描路径，可以写 `{{cwd}}` 这类已注册宏，但写错一个未注册名就炸

**provider 三条硬规矩，缺一条就打崩整个 turn**：

1. 内部必须 try/catch 兜底 —— provider 抛错会冒到 `assemble()`
2. 读不到内容返回 `''` 而非 `undefined` —— 后者被判定「变量无值」，同样抛错
3. header/footer 一并拼进变量值 —— 留在 section 文本里就仍在插值扫描路径上

空串会让 renderPrompt 把该 section 整个 filter 掉 —— **未配置即零污染**。

**已知限制**：section 的 `order` 在 `apply()`（preset 挂载）时读一次，**改 order 需要重新挂载 preset**（重开会话或重启 DSH）。
文件清单由 provider 在**会话装配时**现读 state —— 但注意：**内容一旦装配进系统提示词，就在该会话内固化**，同一会话中途改注入文件不会刷新，要新开会话才看得到（2026-09-14 实测，见第九节）。

### 5.2 消息段：一次性注入

文件合并成一条 user 消息，首个 entering step 注入一次，落库 `user/message`。

插入位置与官方 `agent-instructions` 一致：

```ts
const lastClaimedIndex = decision.messages.findLastIndex(m => messages.includes(m))
const entered = decision.messages.toSpliced(lastClaimedIndex + 1, 0, injectedMessage)
```

**判重是日志驱动的**：注入的消息一旦进 `session.log`，此后每个 pre-step（包括进程重启后的 resume）都能在 log 里找到它并跳过。compaction 把它折掉之后自然会重新注入。

> 判重实现踩过的坑：曾尝试扫 `session.surface.nodes` 和 `session.events`，**均失败**——surface 是依赖 `sessionProjections` 的增量投影，events 是 getter 在 agent preset 层实测为 `undefined`。最终改为直接遍历 `session.log`（内部持久事件数组，seq 即索引，resume 后完整），找带本插件 source 签名的 `user/message`。
> **系统段不落 log，不参与判重。**

### 5.3 接管 persona 槽位（`personaSection`）

置 `true` 时，本插件注册 `deployment:persona` 槽位并带 `complete: true`，**独占整个系统提示词**，同时可调 `suppressRuntimeContext()` 压掉动态运行时上下文快照。

`personaSection` **默认 false 是刻意的**：本地 preset 里 `dsh-persona` 通常还占着位子，无条件接管会因**同层同名**直接抛错。要用它，先删 preset 里那行。

---

## 六、DSH 内部机制结论（拿血换的，照着用）

1. **DSH 做不到 SillyTavern 那种「任意深度插入」**
   surface 只认两种操作：`append` 和 `replace`（且 `replace` 的 start/end 必须是**已存在**的 surface 节点）。没有 insert、没有 prepend。
   → 「紧贴 system 下沿」这种位置，只有**会话首 step**（surface 尚为空）才有机会。

2. **`complete: true` 是硬替换，不是优先级**
   `packages/core/system-prompt/src/index.ts`：
   ```ts
   sections: completeSection === undefined ? transformed.sections : [completeSection]
   ```
   只要有一个 complete 段，其余 section **全灭**，连 `system-prompt/assemble` waterfall 之后塞进去的也一并丢掉。

3. **`harness:identity` 全局注册、默认开着**
   `You are an AI agent powered by DeepSeek Harness.`，order **-1000**。
   `complete: false` 会让它第一个冒出来、排在所有人设正文前面。

4. **`renderPrompt` 的 `{{}}` 是严格插值**
   未知变量 / 空值 / 畸形引用一律 **throw**，当场打崩整个 turn。
   反过来：**"替换进去的值不会被二次扫描"** 是明文语义 —— 文件正文走变量承载天然免疫。

5. **变量 provider 拿得到会话 cwd**
   `AssembleContext` 基础定义只有 `{ scope, signal }`，但 `dsh-agent` 通过**声明合并**补了 `agent?: Agent`。
   → `context.agent?.session.header.cwd` 可用。（诊断场合的装配没有 agent，要判空。）

6. **order 表的真实值**
   ```
   HARNESS_IDENTITY -1000 / HARNESS_SOURCE -900 / WEB_SURFACE -800
   DEPLOYMENT_PERSONA 0 / PLAN_POLICY 500 / TEAM_POLICY 600 / PTC_ONLY 800
   FILE_REFERENCE 900 / TOOL_* 1000~2900 / TOOLS_SDK 5000
   DELIVERABLE_FILE_REFERENCES 9000 / STRUCTURED_OUTPUT 9900
   ```

7. **同层同名 section 会抛错** —— 所以接管槽位前必须先删掉原占位行。

8. **`system-prompt/assemble` waterfall 救不了 complete**
   签名是 `(assembly, context, next) => Promise<PromptAssembly>`，能改装配结果——但 complete 的替换发生在它**之后**。

9. **官方 `dsh-agent-instructions` 没有深度控制**
   config 只有 `dshHome` / `projectRootMarkers` / `maxBytes` / `maxSourceBytes` / `instructionFileCandidates` / `localInstructionFileCandidates`。
   落点是写死的 `toSpliced(lastClaimedIndex + 1, 0, desired)`，跟本插件的消息段一模一样。

---

## 七、设置页保存的经典坑（2026-09-11 修复，值得所有人看）

**现象**：设置页点「保存」——按钮**毫无反应**。没有「已保存」，没有报错红字，服务端日志里**连请求都没有**。

**排查过程**：

| 步骤 | 结论 |
|---|---|
| 直打 host route（绕开反代） | `GET` 返回完整 state；`POST` 同源 200 且成功落盘 → **后端清白** |
| 反代 access log | 只有 `GET`，**一条 POST 都没有** |
| 浏览器 Console | **一行红字都没有** → JS 没抛错 |
| 浏览器 Network | 没有任何请求发出 |

**根因**：保存按钮的 `disabled` 里带了 `!dirty`。

```tsx
// 病根
disabled: busy || !dirty
```

**`disabled` 的按钮，浏览器会把点击事件整个吞掉，连 JS 都不进。** 于是：没反应、没回显、没报错、没请求——四件事同时成立，临床表现跟「功能没做」一模一样，无从自证。

**修复**（白箱三件套）：

1. 按钮只受 `busy || saving` 约束，**不再被 `dirty` 锁死**，任何时候都能点
2. 「已保存」**等服务端回执**才亮，不再提前撒谎；失败把红字**就地写在按钮旁边**
3. 双端留痕：客户端 `console.log('[roroko-tool] …')`，服务端 `console.log('[roroko-tool] route hit: …')`

**教训**（比修复本身值钱）：

- **静默失败是最大的坑**。任何「点了没反应」的控件，都必须先假设它在吞事件，而不是假设业务逻辑错了。
- **不要用派生状态当禁用开关**。`dirty` 这类状态会因组件重挂载、渲染时序漂移，一旦判定失败，用户就在跟一块石头较劲。
- **每一次用户动作都要留下可观测痕迹**。前端打点 + 服务端打点，两条腿走路，下次 30 秒定位，不用翻一晚上日志。
- **别照着假设打补丁**。前一个 commit（`2dd86f3`）就是照着「字段缺失导致抛错」的假设修的空字段兜底——修完问题照旧，因为根因根本不在这儿。

---

## 八、开发与构建

```bash
npx tsc -p tsconfig.json          # host 侧 → lib/（含 .d.ts）
npx tsc -p tsconfig.client.json   # client 侧类型检查（noEmit）
npx tsdown                        # client → client/client.js（bundle 产物）
```

> ⚠️ `lib/` 与 `client/` 虽是构建产物，但**已被 git 跟踪**（为了让包能从 git 直接正规安装）。
> **改完源码必须连构建产物一起提交**，否则远端装到的还是旧代码。
>
> `tsconfig.json` 明确 `exclude: ["src/client"]`；client 走独立的 `tsconfig.client.json`。

---

## 九、更新记录

### 2026-09-14

| commit / 动作 | 内容 |
|---|---|
| **服务器 A 案手术** | `roroko-server` preset 删掉 `dsh-persona` 段、`roroko-preinject` 开 `personaSection: true`。根因：preset 里 persona 的 `complete: true` 是**硬替换**，会把独立段 `roroko:preinject` 整段扫掉——系统层注入一直没生效就是这个。备份留在 preset 同目录 `.bak-*` |
| **实测：系统层注入 ✅** | 模型复述系统提示词第一行 = 工作区 `AGENTS.md` 开头（`# AGENTS` / `## 洛洛可规则`），语气带 `IDENTITY.md` 人设 |
| **实测：同会话不重读 ⚠️** | 装配后改注入文件，同一会话内模型仍引用旧内容，新会话才刷新。第五、十节措辞已按此修正 |
| **实测：user 消息段 ✅** | 会话 log 出现 `source.plugin = 'roroko-preinject'` 签名，GUI 直接显示「上下文注入 roroko-preinject」 |

### 2026-09-11

| commit | 内容 |
|---|---|
| `26cd28b` | 修 POST 回执缺兼容视图导致设置页面板卡「加载中…」 |
| `834f155` | preinject 按 preset 分桶 + 路径宏 + 落点档位 + 设置页卡片化 |
| `56dd158` | **设置页保存白箱化**：拆掉吞点击的 `disabled` 锁 + 假成功改为服务端回执 + 双端留痕。详见第七节 |
| `2dd86f3` | preinject 面板字段兜底：防旧版 state 缺字段导致保存静默失效（**事后证明没打在根因上**，见第七节教训） |
| `756daff` | preinject 支持**接管 persona 槽位**：新增 `personaSection` / `personaHead` / `includeRuntimeContext` 三个 config |
| `d2fc891` | preinject **拆双段落点**：系统段进 system 提示词，消息段保留 user 消息 |

### 2026-09-03

| commit | 内容 |
|---|---|
| `aba3e3c` | 修 mark shadow 思考折叠视觉：summary/thinkBody 对齐官方次级字号 + tertiary 颜色 |
| `54a4b00` | roroko-mark 迁入大包：呻吟标记展开引擎（host/client 共享）+ web shadow 渲染 + state `mark.enabled` 开关 |
| `fac49eb` | **退役四工具 enabled 运行级开关**：preset 声明即开关，state 只存参数覆盖 |
| `b8b6b72` | data 工具迁入实现：四把 agent 工具注册 + `dbPath` 可配置 |
| `9bb0c1e` | 修 preinject 重复注入：判重改读 `session.log` 而非 events/surface |
| `e44adc3` | preinject 收编落地：恢复一次性注入器，闸门读 state 文件 |

> `fac49eb` 的理由值得记住：**运行级动态启停会改变会话工具集 / 注入内容，打爆 request-cache**。
> 「preset 声明即开关」不只是风格偏好，是缓存正确性的要求。

### 2026-09-02

| commit | 内容 |
|---|---|
| `d668296` | 电箱默认状态改全关：安装即熄火，按需逐个开 |
| `dcc8de1` | **电箱状态改自存文件 + HTTP route**：域名可写，退役 settings 注册（官方 loopback 写限制） |
| `7374dfc` | `files` 白名单改目录级：`lib` 整包携带，修 `lib/settings.js` 被剔除导致 boot 失败 |
| `803ea8a` | `files` 白名单补 `cordis.patch.yml`：git/npm 安装时 bundle patch 才能随包落地 |
| `9498062` | client 设置页渲染四工具 enabled 开关（settingsScope 双向同步，**后被证伪**） |
| `72f9d60` | 收紧 peer 到 cordis + schemastery：支持本地独立编译与 git 正规安装 |
| `68cdf87` | 提交 `lib` 构建产物：支持从 git 正规安装 |
| `226aab9` | 第一步纯电箱：host 注册四开关 settings |
| `5bf5f62` | 修 host 编译：本地 import 去 `.ts` 扩展，settings install 收 Context |
| `6dc2415` | 第一站：roroko-tool 电箱化，preinject 收编迁入 |
| `dbf5679` | 修 client 模块 load id 改为包全名，解决 Failed to load plugins |
| `c5095d6` | 补 `dsh.bundle.patch` 声明，roroko-tool 可作正式 bundle 加载 |
| `97e0966` | 加 client 设置页：`settings.section` 注册「Roroko Tool」导航项 |
| `fc2ca2b` | 初始化空骨架：标准 cordis 多入口包（preinject / data / warn 占位） |

---

## 十、已知限制与待办

- `roroko-warn`（超量收敛警告）**尚未实现**，`warn` 节只有空对象。
- 系统段 `order` 改动**需要重新挂载 preset** 才生效（文件清单改动则是立刻生效）。
- 接管 persona 槽位（`personaSection: true`）**必须在 preset 里先删掉 `dsh-persona`**。
- `personaSection` 的完整装配路径**只在新建会话时发生** —— 改完 preset 后，**旧会话不会重装配**，必须开新会话验证。拿旧会话测会得出错误结论。
- 系统段与官方 `dsh-agent-instructions` 存在**内容重复注入的可能**（两边都想吃工作区 `AGENTS.md`）。接线时二选一，别两头都开。
- 系统段内容**只在会话装配时读取**：同一会话中途改注入文件不会刷新，要新开一个会话（2026-09-14 实测，见第九节）。文件清单参数本身仍是每次现读 state。
- `personaSection: true` 与 preset 里既有的 `dsh-persona` 段**不能共存**：同层同名注册会直接抛错，必须先删掉 persona 段（2026-09-14 服务器落地时确认）。
- 用 canary 口令做注入验证时注意：模型可能判断"口令价值在于保密"而**拒绝抄出**（服务器实测遇到）。要它开口，就把标记写成没有保密理由的普通内容。

---

## 许可

MIT
