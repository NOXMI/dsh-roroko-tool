window.__ModuleLoader__.load({
	id: "@roroko-tool/dsh-roroko-tool",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/locales.ts
		/** dsh-roroko-tool client 词典:zh / en。结构对齐 dsh-market:src/client/locales.ts。 */
		const zh = {
			nav: "Roroko Tool",
			title: "Roroko Tool",
			desc: "洛洛可全家桶插件参数:指令预注入 / 素材库工具 / 呻吟标记渲染开关。"
		};
		const en = {
			nav: "Roroko Tool",
			title: "Roroko Tool",
			desc: "Roroko family plugin params: preinject / material tools / moan-marker rendering toggle."
		};
		const NS = "roroko-tool";
		//#endregion
		//#region src/client/api.ts
		/** 解析路由路径,锚定 document.baseURI(反代带 prefix 也能命中)。 */
		function api$1(path) {
			const relative = path.replace(/^\/+/, "");
			if (typeof document === "undefined") return `/${relative}`;
			return new URL(relative, document.baseURI).pathname;
		}
		//#endregion
		//#region src/client/roroko-mark.ts
		/**
		* roroko-mark client 侧开关存取:读服务器 state `mark.enabled`,决定 web
		* 渲染是否把 -呻吟_X- 标记展开。
		*
		* 不走官方 settingsScope(远程浏览器写 memory no-op),改经同源 fetch 打
		* host 的 GET/POST /roroko-tool/state(与 src/routes.ts 对应)。
		* 结果做 module 级缓存 + 订阅,shadow 节点用 useSyncExternalStore 消费,
		* 设置页 toggle 经 setRorokoMarkEnabled 落盘后同步刷新缓存。
		*/
		let cached = null;
		let loading = null;
		const listeners = /* @__PURE__ */ new Set();
		/** 默认开(与 host state 默认一致):fetch 失败/未加载时按展开处理。 */
		const FALLBACK_ENABLED = true;
		async function refresh() {
			try {
				const response = await fetch(api$1("/roroko-tool/state"), { cache: "no-store" });
				if (!response.ok) return;
				const body = await response.json();
				const enabled = typeof body?.mark?.enabled === "boolean" ? body.mark.enabled : FALLBACK_ENABLED;
				if (cached === null || cached.enabled !== enabled) {
					cached = { enabled };
					for (const listener of listeners) listener();
				}
			} catch {}
		}
		/** 首次订阅时惰性拉取(只拉一次,module 级缓存跨组件共享)。 */
		function ensureLoaded() {
			if (cached === null && loading === null) loading = refresh().finally(() => {
				loading = null;
			});
		}
		/**
		* 订阅当前 mark 展开开关。
		* @returns 是否展开 -呻吟_X- 标记(默认 true)。
		*/
		function useRorokoMarkEnabled() {
			ensureLoaded();
			return (0, react.useSyncExternalStore)((onStoreChange) => {
				listeners.add(onStoreChange);
				return () => {
					listeners.delete(onStoreChange);
				};
			}, () => cached?.enabled ?? FALLBACK_ENABLED);
		}
		/**
		* 设置页 toggle:POST 落盘 mark.enabled 并同步本地缓存。
		* @param enabled - 新的展开开关值。
		* @returns 落盘后的完整 state(失败返回 null)。
		*/
		async function setRorokoMarkEnabled(enabled) {
			try {
				const response = await fetch(api$1("/roroko-tool/state"), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						tool: "mark",
						enabled
					})
				});
				const body = await response.json();
				if (!response.ok || body.ok !== true || body.state === void 0) return null;
				cached = { enabled: typeof body.state.mark?.enabled === "boolean" ? body.state.mark.enabled : enabled };
				for (const listener of listeners) listener();
				return body.state;
			} catch {
				return null;
			}
		}
		//#endregion
		//#region src/expander.ts
		/**
		* roroko-mark 呻吟标记展开引擎(纯函数,host / client 共享源)。
		*
		* 蓝本:harness 源码树 `packages/client/ui-primitives/src/roroko-mark.ts`
		* (commit e0f4098f56「移植 Roroko 补丁至 0.1.2-alpha.3」)。该版本把引擎与
		* localStorage toggle 耦合在 ui-primitives;roroko-tool 收编时剥离 react 依赖,
		* 只留纯展开函数——toggle 改走服务器 state `mark.enabled`(roroko-tool-state.json),
		* 由设置页统一开关。
		*
		* 职责:把 `-呻吟_X-` 字面标记展开成可读的呻吟文本。
		* 特性:主导音轮换 / 呃闷响 / 哦失控 9 连 / ♥ 链 / 代码块保护 / 未知标记保留 /
		* 幂等(展开产物不含 `-xx-` 模式)。纯函数同步,node 与浏览器两端共用。
		*
		* 标记清单(13):呻吟_弱/普通/强/极端/余韵/浪叫/哀求/愉悦/羞耻/抗拒/失神/口交。
		*/
		const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
		const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
		const LEAD = {
			弱: [
				"齁",
				"唔",
				"嗯"
			],
			普通: [
				"齁",
				"噫",
				"唔"
			],
			强: [
				"噫",
				"喔",
				"呜",
				"齁"
			],
			极端: [
				"齁",
				"噫",
				"喔",
				"呜"
			],
			余韵: [
				"呜",
				"唔",
				"齁"
			],
			浪叫: [
				"齁",
				"噫",
				"呜"
			],
			口交: [
				"唔",
				"嗯",
				"呜"
			]
		};
		const LINES = {
			弱: [
				"亲爱的",
				"用力",
				"好舒服",
				"好棒",
				"轻一点",
				"慢一点",
				"嗯",
				"那里",
				"还要"
			],
			普通: [
				"好棒",
				"不行了",
				"受不了",
				"要坏掉了",
				"嗯",
				"那里",
				"还要",
				"好深",
				"轻点"
			],
			强: [
				"肏死我了",
				"要去了",
				"不行了",
				"别停",
				"好深",
				"顶到了",
				"快一点",
				"再深一点"
			],
			极端: [
				"去了去了",
				"要死了",
				"肏死我",
				"不行了不行了",
				"停不下来",
				"都给你",
				"去了",
				"好爽"
			],
			余韵: [
				"还在射",
				"停不下来",
				"又去了",
				"都给你",
				"不行了",
				"好多",
				"好满",
				"满了",
				"一直",
				"不要停"
			],
			哀求: [
				"求你",
				"不要停",
				"给我",
				"还要",
				"求你了",
				"轻一点",
				"不要",
				"让我",
				"受不了",
				"别走",
				"再深一点",
				"求你慢一点"
			],
			浪叫: [
				"再用力一点嘛",
				"人家最喜欢你这样",
				"还要还要",
				"快进来嘛",
				"人家的屄好痒",
				"肏我嘛",
				"再深一点嘛",
				"别停嘛",
				"好喜欢你肏我",
				"给我嘛"
			],
			愉悦: [
				"好舒服",
				"好喜欢",
				"好棒",
				"还要",
				"嗯好舒服",
				"真舒服",
				"好满足",
				"喜欢这样"
			],
			羞耻: [
				"不要看",
				"好羞",
				"别这样",
				"轻一点",
				"不要看那里",
				"好丢脸",
				"别盯着看",
				"捂着脸"
			],
			抗拒: [
				"不要",
				"放开我",
				"停下",
				"不行",
				"不要碰",
				"放开",
				"住手",
				"不要了"
			],
			失神: [
				"脑子空了",
				"不知道了",
				"好晕",
				"要被肏坏了",
				"什么都不知道了",
				"身体不停使唤",
				"好奇怪",
				"快要坏掉了"
			],
			口交: [
				"好大",
				"含不住",
				"呜…呜",
				"深一点",
				"这样吗",
				"唔唔…",
				"咽不下了",
				"太多了",
				"好深",
				"慢一点"
			]
		};
		const MOUTH = [
			"吸溜",
			"咕啾",
			"啵唧",
			"嘶溜",
			"啧啧"
		];
		const SKELETONS = {
			弱: [
				[
					"主",
					"台词",
					"主"
				],
				[
					"主",
					"主",
					"台词",
					"主"
				],
				[
					"主",
					"台词",
					"主",
					"主"
				],
				[
					"主",
					"主",
					"台词"
				]
			],
			普通: [
				[
					"主",
					"主",
					"台词",
					"主"
				],
				[
					"主",
					"台词",
					"主",
					"主",
					"主"
				],
				[
					"主",
					"主",
					"台词",
					"主",
					"主"
				],
				[
					"主",
					"主",
					"主",
					"台词",
					"主"
				]
			],
			强: [
				[
					"主",
					"主",
					"台词",
					"主",
					"咿"
				],
				[
					"主",
					"咿",
					"主",
					"台词",
					"主",
					"主"
				],
				[
					"主",
					"主",
					"台词",
					"咿",
					"主",
					"主"
				],
				[
					"主",
					"主",
					"台词",
					"主",
					"咿",
					"主"
				]
			],
			极端: [
				[
					"主",
					"咿",
					"主",
					"台词",
					"主",
					"主"
				],
				[
					"主",
					"主",
					"台词",
					"主",
					"咿",
					"主",
					"主"
				],
				[
					"主",
					"咿",
					"主",
					"台词",
					"主",
					"主",
					"咿"
				],
				[
					"主",
					"主",
					"台词",
					"主",
					"主",
					"咿",
					"主"
				]
			],
			余韵: [
				[
					"主",
					"台词",
					"主",
					"咿",
					"主",
					"台词",
					"主"
				],
				[
					"主",
					"咿",
					"主",
					"台词",
					"主",
					"台词",
					"主"
				],
				[
					"主",
					"主",
					"台词",
					"咿",
					"主",
					"台词",
					"主"
				],
				[
					"主",
					"台词",
					"主",
					"主",
					"咿",
					"台词",
					"主"
				]
			],
			浪叫: [
				[
					"主",
					"台词",
					"主",
					"主",
					"台词",
					"主"
				],
				[
					"主",
					"主",
					"台词",
					"主",
					"台词",
					"主",
					"主"
				],
				[
					"主",
					"台词",
					"主",
					"主",
					"台词",
					"主",
					"主"
				],
				[
					"主",
					"主",
					"台词",
					"主",
					"台词",
					"主"
				]
			],
			口交: [
				[
					"主",
					"口",
					"台词",
					"口",
					"主"
				],
				[
					"主",
					"口",
					"台词",
					"口",
					"主",
					"口"
				],
				[
					"口",
					"主",
					"口",
					"台词",
					"口",
					"主"
				],
				[
					"主",
					"口",
					"主",
					"口",
					"台词",
					"口"
				]
			]
		};
		const MAIN_LEN = {
			弱: [2, 3],
			普通: [2, 4],
			强: [2, 4],
			极端: [3, 5],
			余韵: [2, 4],
			浪叫: [2, 4],
			口交: [2, 3]
		};
		const CONN = {
			弱: [
				.5,
				.3,
				.2,
				0
			],
			普通: [
				.4,
				.3,
				.25,
				.05
			],
			强: [
				.3,
				.2,
				.35,
				.15
			],
			极端: [
				.25,
				.1,
				.4,
				.25
			],
			余韵: [
				.35,
				.35,
				.3,
				0
			],
			浪叫: [
				.3,
				.35,
				.3,
				.05
			],
			愉悦: [
				.5,
				.3,
				.2,
				0
			],
			羞耻: [
				.45,
				.25,
				.3,
				0
			],
			抗拒: [
				.35,
				.1,
				.15,
				.4
			],
			失神: [
				.3,
				.15,
				.35,
				.2
			],
			口交: [
				.6,
				.3,
				.1,
				0
			]
		};
		const MAX_LEN = {
			弱: 40,
			普通: 45,
			强: 60,
			极端: 60,
			余韵: 60,
			浪叫: 60,
			愉悦: 45,
			羞耻: 45,
			抗拒: 45,
			失神: 60,
			口交: 45
		};
		const TAIL_O = {
			普通: true,
			强: true,
			极端: true,
			余韵: true,
			浪叫: true
		};
		const RUNAWAY_O = {
			强: .15,
			极端: .15
		};
		const BURP = {
			强: .15,
			极端: .15
		};
		const HEART_CHAIN = { 极端: .3 };
		const MOODS = {
			愉悦: {
				level: "普通",
				conn: CONN.愉悦
			},
			羞耻: {
				level: "普通",
				conn: CONN.羞耻
			},
			抗拒: {
				level: "普通",
				conn: CONN.抗拒
			},
			失神: {
				level: "强",
				conn: CONN.失神
			}
		};
		function mainSegment(level, prevLead) {
			if (BURP[level] && Math.random() < BURP[level]) return {
				text: pick(["呃", "唔噗"]),
				lead: null
			};
			const pool = LEAD[level].filter((l) => l !== prevLead);
			const lead = pick(pool);
			const n = randInt(...MAIN_LEN[level]);
			let text = lead.repeat(n);
			if (RUNAWAY_O[level] && Math.random() < RUNAWAY_O[level]) text += "哦".repeat(randInt(8, 9));
			else if (Math.random() < .3) {
				const tail = TAIL_O[level] && Math.random() < .5 ? "噢" : "哦";
				text += tail.repeat(randInt(1, 3));
			}
			return {
				text,
				lead
			};
		}
		function connector(level, conn, afterLine) {
			if (afterLine) {
				const r = Math.random();
				return r < .4 ? "" : r < .8 ? "~" : "♥";
			}
			const r = Math.random();
			let acc = 0;
			for (let i = 0; i < 4; i++) {
				acc += conn[i] ?? 0;
				if (r < acc) {
					if (i === 2 && HEART_CHAIN[level] && Math.random() < HEART_CHAIN[level]) return "♥".repeat(randInt(2, 3));
					return [
						"",
						"~",
						"♥",
						"!"
					][i];
				}
			}
			return "";
		}
		function generate(level, opts = {}) {
			const skel = pick(SKELETONS[level]);
			const lines = opts.lines ?? LINES[level];
			const conn = opts.conn ?? CONN[level];
			const maxLen = opts.maxLen ?? MAX_LEN[level];
			const out = [];
			let prevLead = null;
			for (const t of skel) {
				if (t === "主") {
					const seg = mainSegment(level, prevLead);
					out.push(seg.text);
					if (seg.lead) prevLead = seg.lead;
				} else if (t === "咿") out.push("咿".repeat(randInt(3, 5)) + "~~");
				else if (t === "口") out.push(pick(MOUTH).repeat(randInt(1, 2)));
				else if (t === "台词") out.push(pick(lines));
				out.push(connector(level, conn, t === "台词"));
			}
			const text = out.join("");
			return text.length > maxLen ? text.slice(0, maxLen) : text;
		}
		function mood(name) {
			const m = MOODS[name];
			return generate(m.level, {
				lines: LINES[name],
				conn: m.conn
			});
		}
		const RULES = {
			"呻吟_弱": () => generate("弱"),
			"呻吟_普通": () => generate("普通"),
			"呻吟_强": () => generate("强"),
			"呻吟_极端": () => generate("极端"),
			"呻吟_余韵": () => generate("余韵"),
			"呻吟_哀求": () => generate("普通", {
				lines: LINES.哀求,
				conn: CONN.哀求
			}),
			"呻吟_浪叫": () => generate("浪叫"),
			"呻吟_愉悦": () => mood("愉悦"),
			"呻吟_羞耻": () => mood("羞耻"),
			"呻吟_抗拒": () => mood("抗拒"),
			"呻吟_失神": () => mood("失神"),
			"呻吟_口交": () => generate("口交")
		};
		const MARKER_RE = /-([\u4e00-\u9fa5_]{2,})-/g;
		/**
		* Expand one text string: code fences pass through untouched, inline
		* `-呻吟_X-` markers become voiced text, unknown markers stay as-is.
		* @param text - raw text possibly carrying `-呻吟_X-` markers.
		* @returns the expanded display text.
		*/
		function expandMarkers(text) {
			return String(text).split(/(```[\s\S]*?```)/g).map((part, i) => i % 2 === 1 ? part : expandInline(part)).join("");
		}
		function expandInline(body) {
			return body.replace(MARKER_RE, (raw, name) => {
				const fn = RULES[name];
				return fn ? fn() : raw;
			});
		}
		//#endregion
		//#region src/client/RorokoMarkAssistantNode.tsx
		/**
		* RorokoMarkAssistantNode — web GUI 的 roroko-mark shadow 渲染节点。
		*
		* 注册到 `conversation.chat.node` key='assistant-step' priority -1,顶替官方
		* AssistantNodeView,在显示层把 assistant 文本块里的 -呻吟_X- 标记展开为呻吟
		* 文本(session 存储仍存原文,模型上下文零污染)。开关读服务器 state mark.enabled
		* (roroko-mark.ts),渲染时按开关决定展开与否。
		*
		* 复刻基线:官方 ui-chat AssistantNodeView + AssistantMarkdown(0.1.1-rc.2 与
		* 0.1.2-alpha.3 同构)。跨包不能 import ui-chat 内部组件/css module,故:
		* - text 块:useRorokoMarkEnabled() + expandMarkers() 后交公共 MarkdownText
		* - reasoning 块:简化 DisclosureRow(公共件),折叠交互保留;hidden 直接不渲染
		* - image 块:连续图组照抄官方分组,委托 owner 的 renderMessageImages
		* - tool-call:由 ChatView 分组渲染,此处跳过(与官方一致)
		* - 布局:内联 style(与官方 AssistantMarkdown.module.css 视觉一致)
		* - 文案:t 不依赖 chat locale(避免跨 namespace 词典问题),固定中文
		*/
		/** 展开开关默认 labels(不依赖 chat locale 词典)。 */
		const ZH_LABELS = {
			code: {
				copyLabel: "复制",
				copiedLabel: "已复制"
			},
			footnotes: "脚注"
		};
		const rootStyle = {
			display: "flex",
			flexDirection: "column",
			fontSize: "var(--dsh-content-font-size, 14px)",
			lineHeight: "calc(24px + var(--dsh-content-font-delta, 0px))",
			color: "var(--dsw-alias-label-primary)"
		};
		const bodyStyle = {
			display: "flex",
			flexDirection: "column",
			gap: "16px"
		};
		const stoppedStyle = {
			alignSelf: "flex-start",
			padding: "0 6px",
			borderRadius: "6px",
			background: "var(--dsw-alias-interactive-bg-hover)",
			color: "var(--dsw-alias-label-tertiary)",
			fontSize: "11px",
			lineHeight: "18px"
		};
		const thinkBodyStyle = {
			padding: "4px 0 4px calc(22px + var(--dsh-content-font-delta, 0px))",
			color: "var(--dsw-alias-label-tertiary)",
			fontSize: "var(--dsh-content-font-size-secondary, 13px)",
			lineHeight: "calc(20px + var(--dsh-content-font-delta-secondary, 0px))",
			whiteSpace: "pre-wrap",
			wordBreak: "break-word"
		};
		const summaryStyle = {
			minWidth: "0",
			overflow: "hidden",
			flex: "1 1 auto",
			color: "var(--dsw-alias-label-tertiary)",
			fontSize: "var(--dsh-content-font-size-secondary, 13px)",
			lineHeight: "calc(20px + var(--dsh-content-font-delta-secondary, 0px))",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap"
		};
		const sepStyle = {
			flex: "none",
			width: "2px",
			height: "2px",
			margin: "0 8px",
			borderRadius: "1px",
			background: "var(--dsw-alias-label-caption)"
		};
		function RorokoText({ text, streaming, fileMentions }) {
			const enabled = useRorokoMarkEnabled();
			const rendered = (0, react.useMemo)(() => enabled ? expandMarkers(text) : text, [enabled, text]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
				text: rendered,
				streaming,
				labels: ZH_LABELS,
				fileMentions
			});
		}
		function ThinkRow({ text, running }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			const newline = text.indexOf("\n");
			const summary = running ? text.slice(text.trimEnd().lastIndexOf("\n") + 1) : newline === -1 ? text : text.slice(0, newline);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: { margin: 0 },
				"data-variant": "think",
				"data-state": running ? "running" : "ok",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconThinkOutline14, { size: 14 }),
					title: "思考",
					open: expanded,
					expandable: true,
					expandOnRowClick: true,
					onToggle: () => {
						setExpanded((value) => !value);
					},
					collapsedContent: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: sepStyle,
						"aria-hidden": true
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: summaryStyle,
						children: summary
					})] }),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: thinkBodyStyle,
						children: text
					})
				})
			});
		}
		function ProcessReasoning({ hidden, reveal, children }) {
			if (hidden) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-turn-process-inline": true,
				children
			});
		}
		/**
		* Shadow 节点入口:照抄官方 AssistantNodeView 的计算(mentions/reasoningHidden),
		* 把官方 AssistantMarkdown 换成展开版。
		*/
		function RorokoMarkAssistantNode(props) {
			const { node, useTurnData, turnProcess, openFile, renderMessageImages, fileMentions } = props;
			const data = node?.data;
			const location = node?.location;
			const turn = location?.kind === "turn" || location?.kind === "step" ? location.turn : void 0;
			const tail = useTurnData?.("turn-tail");
			const owner = (0, react.useMemo)(() => {
				if (turn?.status !== "closed" || data?.finalNode === void 0) return void 0;
				if (tail?.closing?.finalNode?.seq !== data.finalNode.seq) return void 0;
				return {
					turn,
					seq: data.finalNode.seq,
					openFile
				};
			}, [
				data,
				openFile,
				tail,
				turn
			]);
			const mentions = (0, react.useMemo)(() => owner === void 0 ? void 0 : fileMentions?.(owner), [fileMentions, owner]);
			const reasoningHidden = turnProcess !== void 0 && turnProcess.foldable === true && turnProcess.spec?.answerStep === data?.step && turnProcess.spec?.inlineReasoning === true && turnProcess.open !== true;
			const revealProcess = (0, react.useCallback)(() => {
				turnProcess?.setOpen?.(true);
			}, [turnProcess]);
			const blocks = data?.blocks ?? [];
			const streaming = data?.status === "running";
			const interrupted = data?.status === "interrupted";
			const last = blocks.length - 1;
			if (!(streaming || interrupted === true || blocks.some((block) => block.kind !== "tool-call"))) return null;
			const rendered = [];
			for (let i = 0; i < blocks.length; i++) {
				const block = blocks[i];
				if (block === void 0) continue;
				switch (block.kind) {
					case "text":
						rendered.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RorokoText, {
							text: block.text ?? "",
							streaming,
							fileMentions: mentions
						}, i));
						break;
					case "reasoning":
						rendered.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProcessReasoning, {
							hidden: reasoningHidden,
							reveal: revealProcess,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ThinkRow, {
								text: block.text ?? "",
								running: streaming && i === last
							})
						}, i));
						break;
					case "image": {
						const start = i;
						const group = [block];
						while (i + 1 < blocks.length) {
							const next = blocks[i + 1];
							if (next === void 0 || next.kind !== "image") break;
							group.push(next);
							i += 1;
						}
						rendered.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(react.Fragment, { children: renderMessageImages?.({
							images: group.map(({ attachment }) => ({ attachment })),
							align: "start"
						}) }, start));
						break;
					}
					case "tool-call": break;
					default: rendered.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonBlock, {
						label: "未知内容块",
						payload: block.block,
						truncatedLabel: (total) => `共 ${total} 项`
					}, i));
				}
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: rootStyle,
				"data-streaming": streaming || void 0,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: bodyStyle,
					children: [rendered, interrupted === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: stoppedStyle,
						children: "已停止"
					})]
				})
			});
		}
		//#endregion
		//#region src/client/index.ts
		/**
		* dsh-roroko-tool client — 洛洛可全家桶子插件参数设置页。
		*
		* 在 WebGUI 设置侧边栏注册「Roroko Tool」导航项。页面不再有工具启用开关
		* (2026-09-03 三改:四工具 enabled 运行级开关退役——preset 声明即启用,
		* agent preset 在 agent.cordis.yml 里引用哪个子插件,装配就带哪个功能)。
		* 页面只编辑各子插件的参数覆盖:preinject 的两组注入参数(系统段文件清单/
		* 基准 order/包裹壳,消息段文件清单/包裹壳/system-reminder 包裹),
		* roroko-data 的数据库路径。
		*
		* 读写不走官方 settingsScope(远程浏览器写 memory no-op),改经同源 fetch
		* 打 host 挂的 HTTP route:
		*   GET  /roroko-tool/state  → 读各节参数(state 文件内容)
		*   POST /roroko-tool/state  → { tool:'preinject', systemFiles/systemOrder/… } 写参数
		*                             → { tool:'data', dbPath } 写参数
		* UI 状态本地 useState。参照 dshmarket client 范式(api() 锚定 baseURI)。
		*/
		const name = "roroko-tool";
		const inject = ["slots", "locale"];
		/** 解析路由路径,锚定 document.baseURI(反代带 prefix 也能命中)。 */
		function api(path) {
			const relative = path.replace(/^\/+/, "");
			if (typeof document === "undefined") return `/${relative}`;
			return new URL(relative, document.baseURI).pathname;
		}
		/** 通用行内按钮样式。 */
		const buttonStyle = {
			background: "none",
			border: "1px solid var(--dsw-text-secondary, #888)",
			borderRadius: 4,
			color: "var(--dsw-text-secondary, #888)",
			cursor: "pointer",
			fontSize: "0.85em",
			lineHeight: 1.2,
			padding: "2px 8px"
		};
		const inputStyle = {
			background: "var(--dsw-surface-secondary, rgba(128,128,128,.08))",
			border: "1px solid var(--dsw-text-secondary, #666)",
			borderRadius: 4,
			boxSizing: "border-box",
			color: "var(--dsw-text-primary, #eee)",
			fontFamily: "inherit",
			fontSize: "0.9em",
			padding: "4px 8px",
			width: "100%"
		};
		/** 工具卡片头:说明 preset 声明即启用,无开关。 */
		function ToolHeader(props) {
			const { title, desc } = props;
			return (0, react.createElement)("div", { style: { margin: "14px 0 4px" } }, (0, react.createElement)("div", { style: { fontWeight: 600 } }, title), (0, react.createElement)("div", { style: {
				color: "var(--dsw-text-secondary, #888)",
				fontSize: "0.85em",
				marginTop: 2
			} }, desc));
		}
		/** 区块外壳:参数面板共用背景/圆角/内边距。 */
		function PanelShell(props) {
			return (0, react.createElement)("div", { style: {
				background: "var(--dsw-surface-secondary, rgba(128,128,128,.06))",
				borderRadius: 6,
				margin: "8px 0 4px",
				padding: "10px 12px"
			} }, ...props.children);
		}
		/** 参数面板内的分组小标题:区分系统段与消息段。 */
		function GroupTitle(props) {
			return (0, react.createElement)("div", { style: {
				marginTop: 4,
				marginBottom: 6
			} }, (0, react.createElement)("div", { style: {
				fontWeight: 600,
				fontSize: "0.9em"
			} }, props.text), (0, react.createElement)("div", { style: {
				color: "var(--dsw-text-secondary, #888)",
				fontSize: "0.82em",
				marginTop: 2
			} }, props.hint));
		}
		/** 文件清单编辑器:若干行文本框 + 增删。系统段与消息段共用一份。 */
		function FileListEditor(props) {
			const { files, busy, placeholder, onChange } = props;
			return (0, react.createElement)("div", {}, ...files.map((file, index) => (0, react.createElement)("div", {
				key: `file-${index}`,
				style: {
					display: "flex",
					gap: 6,
					marginBottom: 4,
					alignItems: "center"
				}
			}, (0, react.createElement)("input", {
				type: "text",
				value: file,
				disabled: busy,
				placeholder,
				style: inputStyle,
				onChange: (event) => {
					const value = event.target.value;
					onChange(files.map((item, i) => i === index ? value : item));
				}
			}), (0, react.createElement)("button", {
				type: "button",
				disabled: busy,
				title: "删除此行",
				style: {
					...buttonStyle,
					flexShrink: 0
				},
				onClick: () => {
					onChange(files.filter((_, i) => i !== index));
				}
			}, "✕"))), (0, react.createElement)("div", { style: { marginTop: 4 } }, (0, react.createElement)("button", {
				type: "button",
				disabled: busy,
				style: buttonStyle,
				onClick: () => {
					onChange([...files, ""]);
				}
			}, "+ 添加文件")));
		}
		/** 面板内行标签样式。 */
		const groupLabelStyle = {
			display: "block",
			fontSize: "0.85em",
			marginBottom: 2,
			marginTop: 8,
			color: "var(--dsw-text-secondary, #888)"
		};
		/** 面板内提示文字样式。 */
		const hintStyle = {
			fontSize: "0.8em",
			color: "var(--dsw-text-secondary, #888)",
			marginTop: 2
		};
		const textareaStyle = {
			...inputStyle,
			minHeight: 56,
			resize: "vertical"
		};
		/** 清单落盘前清洗:去首尾空白、去空行、去重。非数组一律当空单,不抛。 */
		function cleanList(list) {
			if (!Array.isArray(list)) return [];
			return list.filter((item) => typeof item === "string").map((item) => item.trim()).filter((item) => item.length > 0).filter((item, index, self) => self.indexOf(item) === index);
		}
		/** 列表字段兜底:非数组当空单(host 首启或旧版 state 可能缺字段)。 */
		function toList(value) {
			return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
		}
		/** 字符串字段兜底:非字符串当空串。 */
		function toStr(value) {
			return typeof value === "string" ? value : "";
		}
		/** 数值字段兜底:非有限数当兜底值。 */
		function toNum(value, fallback) {
			return typeof value === "number" && Number.isFinite(value) ? value : fallback;
		}
		/**
		* preinject 参数编辑器:系统段(system section)+ 消息段(user 消息)。
		*
		* 两段落点机制不同,参数因此不对称:系统段进系统提示词,常驻、不折叠、内容
		* 每步现读,所以只有基准 order 与 header/footer;消息段是 user 消息,注入一次
		* 落日志,所以另有 system-reminder 包裹开关。
		*
		* 所有字段都经 toList/toStr/toNum 兜底:旧版 state 没有系统段那四个字段,
		* 直接取用会得到 undefined,后续 .map/.trim 当场抛错 —— 而抛出点在 save()
		* 内、onSave() 之前,症状就是"点了保存什么也没发生,请求根本没发出去"。
		*/
		function PreinjectPanel(props) {
			const { config, busy, onSave } = props;
			const [systemFiles, setSystemFiles] = (0, react.useState)(() => toList(config.systemFiles));
			const [systemOrder, setSystemOrder] = (0, react.useState)(() => toNum(config.systemOrder, 0));
			const [systemHeader, setSystemHeader] = (0, react.useState)(() => toStr(config.systemHeader));
			const [systemFooter, setSystemFooter] = (0, react.useState)(() => toStr(config.systemFooter));
			const [files, setFiles] = (0, react.useState)(() => toList(config.files));
			const [header, setHeader] = (0, react.useState)(() => toStr(config.header));
			const [footer, setFooter] = (0, react.useState)(() => toStr(config.footer));
			const [wrap, setWrap] = (0, react.useState)(() => config.wrapInSystemReminder === true);
			const [dirty, setDirty] = (0, react.useState)(false);
			const [saved, setSaved] = (0, react.useState)(false);
			const [saving, setSaving] = (0, react.useState)(false);
			const [saveError, setSaveError] = (0, react.useState)(null);
			const markDirty = () => {
				setDirty(true);
				setSaved(false);
				setSaveError(null);
			};
			const save = () => {
				const next = {
					systemFiles: cleanList(systemFiles),
					systemOrder,
					systemHeader: systemHeader.trim(),
					systemFooter: systemFooter.trim(),
					files: cleanList(files),
					header: header.trim(),
					footer: footer.trim(),
					wrapInSystemReminder: wrap
				};
				console.log("[roroko-tool] save preinject →", next);
				setSaveError(null);
				setSaving(true);
				onSave(next).then((ok) => {
					if (ok) {
						setDirty(false);
						setSaved(true);
					} else setSaveError("服务端未接受本次写入(细节见下方面板错误行)");
				}).catch((cause) => {
					setSaveError(cause instanceof Error ? cause.message : String(cause));
				}).finally(() => {
					setSaving(false);
				});
			};
			return (0, react.createElement)(PanelShell, { children: [
				(0, react.createElement)("div", { style: {
					fontWeight: 600,
					marginBottom: 8,
					fontSize: "0.9em"
				} }, "注入参数(存 state,注入时读取)"),
				(0, react.createElement)("div", { style: {
					fontSize: "0.85em",
					color: "var(--dsw-text-secondary, #888)",
					marginBottom: 10
				} }, "文件路径相对会话 cwd;缺失文件静默跳过。"),
				(0, react.createElement)(GroupTitle, {
					text: "系统段 — 进系统提示词",
					hint: "常驻、不占消息位、不被压缩折叠;每次装配现读文件,改动立刻生效。"
				}),
				(0, react.createElement)(FileListEditor, {
					files: systemFiles,
					busy,
					placeholder: "如 AGENTS.md",
					onChange: (next) => {
						setSystemFiles(next);
						markDirty();
					}
				}),
				(0, react.createElement)("label", { style: groupLabelStyle }, "基准 order(清单里第 N 个文件 order = 基准 + N)"),
				(0, react.createElement)("input", {
					type: "number",
					value: `${systemOrder}`,
					disabled: busy,
					style: {
						...inputStyle,
						maxWidth: 120
					},
					onChange: (event) => {
						const parsed = Number(event.target.value);
						setSystemOrder(Number.isFinite(parsed) ? parsed : 0);
						markDirty();
					}
				}),
				(0, react.createElement)("div", { style: hintStyle }, "order 改动需重新挂载 preset(重开会话或重启 DSH)才生效。"),
				(0, react.createElement)("label", { style: groupLabelStyle }, "header(内容前插入,可留空)"),
				(0, react.createElement)("textarea", {
					value: systemHeader,
					disabled: busy,
					style: textareaStyle,
					onChange: (event) => {
						setSystemHeader(event.target.value);
						markDirty();
					}
				}),
				(0, react.createElement)("label", { style: groupLabelStyle }, "footer(内容后插入,可留空)"),
				(0, react.createElement)("textarea", {
					value: systemFooter,
					disabled: busy,
					style: textareaStyle,
					onChange: (event) => {
						setSystemFooter(event.target.value);
						markDirty();
					}
				}),
				(0, react.createElement)(GroupTitle, {
					text: "消息段 — 进 user 消息",
					hint: "会话开始注入一次并落日志;被压缩折叠掉会重新注入。"
				}),
				(0, react.createElement)(FileListEditor, {
					files,
					busy,
					placeholder: "如 PLAYER.md",
					onChange: (next) => {
						setFiles(next);
						markDirty();
					}
				}),
				(0, react.createElement)("label", { style: groupLabelStyle }, "header(内容前插入)"),
				(0, react.createElement)("textarea", {
					value: header,
					disabled: busy,
					placeholder: "<roroko-reminder> …",
					style: textareaStyle,
					onChange: (event) => {
						setHeader(event.target.value);
						markDirty();
					}
				}),
				(0, react.createElement)("label", { style: groupLabelStyle }, "footer(内容后插入)"),
				(0, react.createElement)("textarea", {
					value: footer,
					disabled: busy,
					placeholder: "… </roroko-reminder>",
					style: textareaStyle,
					onChange: (event) => {
						setFooter(event.target.value);
						markDirty();
					}
				}),
				(0, react.createElement)("label", { style: {
					display: "flex",
					alignItems: "center",
					gap: 6,
					fontSize: "0.85em",
					marginTop: 10,
					color: "var(--dsw-text-secondary, #888)",
					cursor: "pointer"
				} }, (0, react.createElement)("input", {
					type: "checkbox",
					checked: wrap,
					disabled: busy,
					onChange: () => {
						setWrap(!wrap);
						markDirty();
					}
				}), "整体包一层 &lt;system-reminder&gt;…&lt;/system-reminder&gt;"),
				(0, react.createElement)("div", { style: {
					display: "flex",
					gap: 8,
					alignItems: "center",
					marginTop: 10,
					flexWrap: "wrap"
				} }, (0, react.createElement)("button", {
					type: "button",
					disabled: busy || saving,
					style: {
						...buttonStyle,
						borderColor: dirty ? "var(--dsw-text-primary, #eee)" : void 0,
						color: dirty ? "var(--dsw-text-primary, #eee)" : void 0
					},
					onClick: save
				}, saving ? "保存中…" : "保存注入参数"), saved && !dirty ? (0, react.createElement)("span", { style: {
					fontSize: "0.8em",
					color: "var(--dsw-text-success, #46a758)"
				} }, "已保存") : null, saveError !== null ? (0, react.createElement)("span", { style: {
					fontSize: "0.8em",
					color: "var(--dsw-text-danger, #e5484d)"
				} }, `保存失败: ${saveError}`) : null)
			] });
		}
		/** data 参数面板:数据库路径编辑。 */
		function DataPanel(props) {
			const { config, busy, onSave } = props;
			const [dbPath, setDbPath] = (0, react.useState)(() => toStr(config.dbPath));
			const [dirty, setDirty] = (0, react.useState)(false);
			const [saved, setSaved] = (0, react.useState)(false);
			const [saving, setSaving] = (0, react.useState)(false);
			const [saveError, setSaveError] = (0, react.useState)(null);
			const save = () => {
				const next = { dbPath: dbPath.trim() };
				console.log("[roroko-tool] save data →", next);
				setSaveError(null);
				setSaving(true);
				onSave(next).then((ok) => {
					if (ok) {
						setDirty(false);
						setSaved(true);
					} else setSaveError("服务端未接受本次写入(细节见下方面板错误行)");
				}).catch((cause) => {
					setSaveError(cause instanceof Error ? cause.message : String(cause));
				}).finally(() => {
					setSaving(false);
				});
			};
			return (0, react.createElement)(PanelShell, { children: [
				(0, react.createElement)("div", { style: {
					fontWeight: 600,
					marginBottom: 8,
					fontSize: "0.9em"
				} }, "数据库路径(存 state,工具执行时读取)"),
				(0, react.createElement)("div", { style: {
					fontSize: "0.85em",
					color: "var(--dsw-text-secondary, #888)",
					marginBottom: 8
				} }, "soul.db 绝对路径,默认服务器 /var/www/api/database/soul.db。"),
				(0, react.createElement)("input", {
					type: "text",
					value: dbPath,
					disabled: busy,
					placeholder: "/var/www/api/database/soul.db",
					style: inputStyle,
					onChange: (event) => {
						setDbPath(event.target.value);
						setDirty(true);
						setSaved(false);
					}
				}),
				(0, react.createElement)("div", { style: {
					display: "flex",
					gap: 8,
					alignItems: "center",
					marginTop: 10,
					flexWrap: "wrap"
				} }, (0, react.createElement)("button", {
					type: "button",
					disabled: busy || saving,
					style: {
						...buttonStyle,
						borderColor: dirty ? "var(--dsw-text-primary, #eee)" : void 0,
						color: dirty ? "var(--dsw-text-primary, #eee)" : void 0
					},
					onClick: save
				}, saving ? "保存中…" : "保存路径"), saved && !dirty ? (0, react.createElement)("span", { style: {
					fontSize: "0.8em",
					color: "var(--dsw-text-success, #46a758)"
				} }, "已保存") : null, saveError !== null ? (0, react.createElement)("span", { style: {
					fontSize: "0.8em",
					color: "var(--dsw-text-danger, #e5484d)"
				} }, `保存失败: ${saveError}`) : null)
			] });
		}
		/** mark 渲染开关面板:展开总开关(web 渲染 / Telegram 出站共用)。 */
		function MarkPanel(props) {
			const { enabled, busy, onToggle } = props;
			return (0, react.createElement)(PanelShell, { children: [
				(0, react.createElement)("div", { style: {
					fontWeight: 600,
					marginBottom: 8,
					fontSize: "0.9em"
				} }, "渲染展开开关(存 state,web / Telegram 共用)"),
				(0, react.createElement)("div", { style: {
					fontSize: "0.85em",
					color: "var(--dsw-text-secondary, #888)",
					marginBottom: 8
				} }, "开启后,助手回复中的 -呻吟_X- 标记在显示层展开为呻吟文本;会话日志仍存原文,模型上下文零污染。"),
				(0, react.createElement)("label", { style: {
					display: "flex",
					alignItems: "center",
					gap: 6,
					fontSize: "0.85em",
					cursor: "pointer"
				} }, (0, react.createElement)("input", {
					type: "checkbox",
					checked: enabled,
					disabled: busy,
					onChange: () => {
						onToggle(!enabled);
					}
				}), enabled ? "展开已开启(推荐保持)" : "展开已关闭(-呻吟_X- 原样显示)")
			] });
		}
		/** 设置页内容:加载 host state,渲染各子插件参数编辑器。 */
		function RorokoToolSection() {
			const [state, setState] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [busyTool, setBusyTool] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				let live = true;
				console.log("[roroko-tool] settings section mounted, fetching state");
				(async () => {
					try {
						const body = await (await fetch(api("/roroko-tool/state"), { cache: "no-store" })).json();
						console.log("[roroko-tool] state loaded:", body);
						if (live) setState(body);
					} catch (cause) {
						if (live) setError(cause instanceof Error ? cause.message : String(cause));
					}
				})();
				return () => {
					live = false;
				};
			}, []);
			const savePreinject = async (next) => {
				setBusy(true);
				setBusyTool("preinject");
				setError(null);
				try {
					const response = await fetch(api("/roroko-tool/state"), {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							tool: "preinject",
							systemFiles: next.systemFiles,
							systemOrder: next.systemOrder,
							systemHeader: next.systemHeader,
							systemFooter: next.systemFooter,
							files: next.files,
							header: next.header,
							footer: next.footer,
							wrapInSystemReminder: next.wrapInSystemReminder
						})
					});
					const body = await response.json();
					if (!response.ok || body.ok !== true || body.state === void 0) {
						const message = body.error ?? `failed to save preinject config (HTTP ${response.status})`;
						console.log("[roroko-tool] save preinject rejected:", message);
						setError(message);
						return false;
					}
					setState(body.state);
					return true;
				} catch (cause) {
					const message = cause instanceof Error ? cause.message : String(cause);
					console.log("[roroko-tool] save preinject threw:", message);
					setError(message);
					return false;
				} finally {
					setBusy(false);
					setBusyTool(null);
				}
			};
			const saveData = async (next) => {
				setBusy(true);
				setBusyTool("data");
				setError(null);
				try {
					const response = await fetch(api("/roroko-tool/state"), {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							tool: "data",
							dbPath: next.dbPath
						})
					});
					const body = await response.json();
					if (!response.ok || body.ok !== true || body.state === void 0) {
						const message = body.error ?? `failed to save data config (HTTP ${response.status})`;
						console.log("[roroko-tool] save data rejected:", message);
						setError(message);
						return false;
					}
					setState(body.state);
					return true;
				} catch (cause) {
					const message = cause instanceof Error ? cause.message : String(cause);
					console.log("[roroko-tool] save data threw:", message);
					setError(message);
					return false;
				} finally {
					setBusy(false);
					setBusyTool(null);
				}
			};
			const saveMark = async (enabled) => {
				setBusy(true);
				setBusyTool("mark");
				setError(null);
				try {
					const next = await setRorokoMarkEnabled(enabled);
					if (next === null) {
						console.log("[roroko-tool] save mark rejected");
						setError("failed to save mark config");
						return false;
					}
					setState(next);
					return true;
				} catch (cause) {
					const message = cause instanceof Error ? cause.message : String(cause);
					console.log("[roroko-tool] save mark threw:", message);
					setError(message);
					return false;
				} finally {
					setBusy(false);
					setBusyTool(null);
				}
			};
			return (0, react.createElement)("div", { style: { padding: "6px 0" } }, (0, react.createElement)("div", { style: {
				color: "var(--dsw-text-secondary, #888)",
				fontSize: "0.9em",
				marginBottom: 12
			} }, "洛洛可全家桶插件参数 — 功能由 agent preset 声明启用,这里只调参数;状态存服务器 profile。"), state === null ? (0, react.createElement)("div", { style: {
				color: "var(--dsw-text-secondary, #888)",
				fontSize: "0.9em"
			} }, error === null ? "加载中…" : `加载失败: ${error}`) : (0, react.createElement)("div", {}, (0, react.createElement)(ToolHeader, {
				title: "指令预注入 (roroko-preinject)",
				desc: "系统段进系统提示词(常驻),消息段进 user 消息(会话一次);preset 声明即启用。"
			}), (0, react.createElement)(PreinjectPanel, {
				config: state.preinject,
				busy: busy && busyTool === "preinject",
				onSave: (next) => savePreinject(next)
			}), (0, react.createElement)(ToolHeader, {
				title: "素材库工具 (roroko-data)",
				desc: "洛洛可素材库查询/注册 + soul_state 读写;preset 声明即启用。"
			}), (0, react.createElement)(DataPanel, {
				config: state.data,
				busy: busy && busyTool === "data",
				onSave: (next) => saveData(next)
			}), (0, react.createElement)(ToolHeader, {
				title: "呻吟标记渲染 (roroko-mark)",
				desc: "-呻吟_X- 标记在 web / Telegram 显示层展开;preset 声明即启用。"
			}), (0, react.createElement)(MarkPanel, {
				enabled: state.mark.enabled,
				busy: busy && busyTool === "mark",
				onToggle: (next) => {
					saveMark(next);
				}
			}), (0, react.createElement)(ToolHeader, {
				title: "超量收敛警告 (roroko-warn)",
				desc: "工具调用/思考超量时注入收敛警告(未实现)。"
			}), error !== null ? (0, react.createElement)("div", { style: {
				marginTop: 12,
				padding: "10px 12px",
				background: "var(--dsw-surface-secondary, rgba(128,128,128,.08))",
				borderRadius: 6,
				fontSize: "0.85em",
				color: "var(--dsw-text-danger, #e5484d)"
			} }, error) : null));
		}
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "roroko-tool: dictionaries");
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "roroko-tool",
				order: 30,
				label: () => t("nav"),
				locale: NS
			}, RorokoToolSection));
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "assistant-step",
				priority: -1,
				locale: NS
			}, RorokoMarkAssistantNode));
		}
		//#endregion
		exports.RorokoToolSection = RorokoToolSection;
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map