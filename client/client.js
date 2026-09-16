window.__ModuleLoader__.load({
	id: "@roroko-tool/dsh-roroko-tool",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/preinject-form.ts
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
		/** 落盘前清洗:去首尾空白、去空行、去重。非数组一律当空单,不抛。 */
		function cleanList(list) {
			if (!Array.isArray(list)) return [];
			return list.filter((item) => typeof item === "string").map((item) => item.trim()).filter((item) => item.length > 0).filter((item, index, self) => self.indexOf(item) === index);
		}
		/** 覆盖层有没有系统段的显式设定(任取到字段即算已覆盖)。 */
		function hasSystemOverride(override) {
			return override.systemFiles !== void 0 || override.systemOrder !== void 0 || override.systemHeader !== void 0 || override.systemFooter !== void 0;
		}
		/** 覆盖层有没有消息段的显式设定。 */
		function hasMessageOverride(override) {
			return override.files !== void 0 || override.header !== void 0 || override.footer !== void 0 || override.wrapInSystemReminder !== void 0 || override.filesPlacement !== void 0 || override.splitFiles !== void 0;
		}
		/**
		* 由「覆盖层 + 继承基线」推出界面表单快照(设置页首次渲染/保存后同步都用它)。
		*
		* 语义与旧组件内联写法逐字一致:override 缺字段才回落 baseline;布尔严格
		* `=== true`(旧 state 里可能是 undefined);数组经 toList 兜底。
		*/
		function formFromState(override, baseline) {
			const layer = override ?? {};
			return {
				coverSystem: hasSystemOverride(layer),
				systemFiles: toList(layer.systemFiles ?? baseline.systemFiles),
				systemOrder: toNum(layer.systemOrder, baseline.systemOrder),
				systemHeader: toStr(layer.systemHeader ?? baseline.systemHeader),
				systemFooter: toStr(layer.systemFooter ?? baseline.systemFooter),
				coverMessage: hasMessageOverride(layer),
				files: toList(layer.files ?? baseline.files),
				header: toStr(layer.header ?? baseline.header),
				footer: toStr(layer.footer ?? baseline.footer),
				wrap: (layer.wrapInSystemReminder ?? baseline.wrapInSystemReminder) === true,
				placement: layer.filesPlacement ?? baseline.filesPlacement,
				split: (layer.splitFiles ?? baseline.splitFiles) === true
			};
		}
		/**
		* 由表单快照构造 POST 体。
		*
		* 不勾「覆盖」的那一组**一个字段都不发** —— 发空值会把 preset config 压住,
		* 语义从"跟随继承"变成"显式清空"。两组都不勾 = 空 payload,调用方按"清桶"
		* 处理(与「重置为继承」同义)。
		*/
		function payloadFromForm(form) {
			const payload = {};
			if (form.coverSystem) {
				payload.systemFiles = cleanList(form.systemFiles);
				payload.systemOrder = form.systemOrder;
				payload.systemHeader = form.systemHeader.trim();
				payload.systemFooter = form.systemFooter.trim();
			}
			if (form.coverMessage) {
				payload.files = cleanList(form.files);
				payload.header = form.header.trim();
				payload.footer = form.footer.trim();
				payload.wrapInSystemReminder = form.wrap;
				payload.filesPlacement = form.placement;
				payload.splitFiles = form.split;
			}
			return payload;
		}
		/** 两份表单快照是否等价(数组按内容逐个比,不看引用)。 */
		function formEquals(a, b) {
			return a.coverSystem === b.coverSystem && a.coverMessage === b.coverMessage && a.systemOrder === b.systemOrder && a.wrap === b.wrap && a.placement === b.placement && a.split === b.split && listEquals(a.systemFiles, b.systemFiles) && listEquals(a.files, b.files) && a.systemHeader === b.systemHeader && a.systemFooter === b.systemFooter && a.header === b.header && a.footer === b.footer;
		}
		/** 两个字符串清单逐项相等。 */
		function listEquals(a, b) {
			return a.length === b.length && a.every((item, index) => item === b[index]);
		}
		/**
		* 行身份牌对齐:长度对不上(外部整体替换,如切 preset / 重置)就整批换新,
		* 否则原样返回。
		*
		* 为什么需要:React 用 key 认行,旧代码拿**数组下标**当 key —— 删掉中间一行
		* 时后面每行的身份都被"顶替",输入框会被错误复用,症状是字跳行/被吃掉。
		* 自己触发的增删在事件里先行同步(见设置页),所以这里只管外部替换。
		*/
		function ensureRowIds(ids, count, mint) {
			if (ids.length === count) return ids;
			return Array.from({ length: count }, () => mint());
		}
		//#endregion
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
		/** 文件清单编辑器:若干行文本框 + 增删。系统段与消息段共用一份。 */
		function FileListEditor(props) {
			const { files, busy, placeholder, onChange } = props;
			const idsRef = (0, react.useRef)([]);
			const seqRef = (0, react.useRef)(0);
			const mint = () => {
				seqRef.current += 1;
				return `row-${seqRef.current}`;
			};
			idsRef.current = ensureRowIds(idsRef.current, files.length, mint);
			const ids = idsRef.current;
			return (0, react.createElement)("div", {}, ...files.map((file, index) => (0, react.createElement)("div", {
				key: ids[index],
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
					idsRef.current = ids.filter((_, i) => i !== index);
					onChange(files.filter((_, i) => i !== index));
				}
			}, "✕"))), (0, react.createElement)("div", { style: { marginTop: 4 } }, (0, react.createElement)("button", {
				type: "button",
				disabled: busy,
				style: buttonStyle,
				onClick: () => {
					idsRef.current = [...ids, mint()];
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
		/**
		* 有未保存改动时,离开页面前拦一下(浏览器原生确认框)。
		*
		* 只拦"刷新/关标签"这类真离开;DSH 内部切页面不走这个事件 —— 那种丢改动由
		* 界面上的「未保存」提示负责提醒,不做拦截(拦也拦不住,还显得像坏了)。
		*/
		function useUnsavedGuard(dirty) {
			(0, react.useEffect)(() => {
				if (!dirty) return void 0;
				const warn = (event) => {
					event.preventDefault();
					event.returnValue = "";
				};
				window.addEventListener("beforeunload", warn);
				return () => {
					window.removeEventListener("beforeunload", warn);
				};
			}, [dirty]);
		}
		/** 卡片外壳样式。 */
		const cardStyle = {
			border: "1px solid var(--dsw-text-secondary, #444)",
			borderRadius: 6,
			margin: "8px 0",
			padding: "8px 10px"
		};
		/** 卡片标题按钮样式(整行可点、左对齐)。 */
		const cardHeadStyle = {
			alignItems: "center",
			background: "none",
			border: "none",
			color: "inherit",
			cursor: "pointer",
			display: "flex",
			fontFamily: "inherit",
			fontSize: "0.95em",
			gap: 8,
			padding: 0,
			textAlign: "left",
			width: "100%"
		};
		/** 卡片状态徽标样式。 */
		const badgeStyle = {
			border: "1px solid var(--dsw-text-secondary, #666)",
			borderRadius: 4,
			color: "var(--dsw-text-secondary, #888)",
			fontSize: "0.78em",
			padding: "1px 6px"
		};
		/** "覆盖这一组"复选框所在行样式。 */
		const coverLabelStyle = {
			alignItems: "center",
			cursor: "pointer",
			display: "flex",
			fontSize: "0.88em",
			gap: 6,
			marginTop: 8
		};
		/** 可折叠卡片:标题一行,点开才渲染内容(设置页一个 preset 一张卡)。 */
		function PresetCard(props) {
			const { title, hint, badge, defaultOpen = false, children } = props;
			const [open, setOpen] = (0, react.useState)(defaultOpen);
			return (0, react.createElement)("div", { style: cardStyle }, (0, react.createElement)("button", {
				type: "button",
				style: cardHeadStyle,
				onClick: () => {
					setOpen((value) => !value);
				}
			}, (0, react.createElement)("span", { style: { fontWeight: 600 } }, `${open ? "▾" : "▸"} ${title}`), badge === void 0 ? null : (0, react.createElement)("span", { style: badgeStyle }, badge)), (0, react.createElement)("div", { style: {
				color: "var(--dsw-text-secondary, #888)",
				fontSize: "0.82em",
				marginTop: 2
			} }, hint), open === true ? (0, react.createElement)("div", { style: { marginTop: 8 } }, ...children) : null);
		}
		/**
		* 单个 preset 的注入参数编辑器(一张卡片的内容)。
		*
		* 两组参数各有独立"覆盖"开关,默认关闭即跟随继承:
		*   关闭 → 该组字段一个都不发,注入时读 公共桶 → preset config → 内置默认;
		*   打开 → 该组字段整组落盘,空清单/空串就是"显式清空"。
		* 两组都不覆盖时保存 = 清除该 preset 的覆盖,不留空桶把 preset config 压住。
		*
		* 字段一律经 toList/toStr/toNum 兜底:覆盖层本身就允许缺字段,直接取用会拿到
		* undefined,后续 .map/.trim 当场抛错,症状就是"点了保存什么也没发生"。
		*/
		function PreinjectScopePanel(props) {
			const { override, baseline, busy, onSave, onReset } = props;
			const [form, setForm] = (0, react.useState)(() => formFromState(override, baseline));
			const [saved, setSaved] = (0, react.useState)(false);
			const [saving, setSaving] = (0, react.useState)(false);
			const [saveError, setSaveError] = (0, react.useState)(null);
			const savingRef = (0, react.useRef)(false);
			const dirty = !formEquals(form, formFromState(override, baseline));
			useUnsavedGuard(dirty);
			(0, react.useEffect)(() => {
				if (savingRef.current) return;
				setForm(formFromState(override, baseline));
			}, [override, baseline]);
			const patch = (part) => {
				setForm((previous) => ({
					...previous,
					...part
				}));
			};
			const save = () => {
				setSaveError(null);
				setSaved(false);
				setSaving(true);
				savingRef.current = true;
				const payload = payloadFromForm(form);
				console.log("[roroko-tool] save preinject scope →", payload);
				(form.coverSystem || form.coverMessage ? onSave(payload) : onReset()).then((ok) => {
					if (ok) setSaved(true);
					else setSaveError("服务端未接受本次写入");
				}).catch((cause) => {
					setSaveError(cause instanceof Error ? cause.message : String(cause));
				}).finally(() => {
					savingRef.current = false;
					setSaving(false);
				});
			};
			const reset = () => {
				setSaveError(null);
				setSaved(false);
				setSaving(true);
				savingRef.current = true;
				onReset().then((ok) => {
					if (ok) setSaved(true);
					else setSaveError("服务端未接受本次重置");
				}).catch((cause) => {
					setSaveError(cause instanceof Error ? cause.message : String(cause));
				}).finally(() => {
					savingRef.current = false;
					setSaving(false);
				});
			};
			return (0, react.createElement)(PanelShell, { children: [
				(0, react.createElement)("label", { style: coverLabelStyle }, (0, react.createElement)("input", {
					type: "checkbox",
					checked: form.coverSystem,
					disabled: busy,
					onChange: () => {
						patch({ coverSystem: !form.coverSystem });
					}
				}), "覆盖系统段(进 system 提示词;不勾选 = 跟随继承)"),
				form.coverSystem ? (0, react.createElement)("div", {}, (0, react.createElement)(FileListEditor, {
					files: form.systemFiles,
					busy,
					placeholder: "如 AGENTS.md 或 ${presetDir}/IDENTITY.md",
					onChange: (next) => {
						patch({ systemFiles: next });
					}
				}), (0, react.createElement)("label", { style: groupLabelStyle }, "section order(改动需重挂载 preset)"), (0, react.createElement)("input", {
					type: "number",
					value: `${form.systemOrder}`,
					disabled: busy,
					style: {
						...inputStyle,
						maxWidth: 120
					},
					onChange: (event) => {
						const parsed = Number(event.target.value);
						patch({ systemOrder: Number.isFinite(parsed) ? parsed : 0 });
					}
				}), (0, react.createElement)("label", { style: groupLabelStyle }, "systemHeader / systemFooter(内容前后插入)"), (0, react.createElement)("textarea", {
					value: form.systemHeader,
					disabled: busy,
					style: textareaStyle,
					onChange: (event) => {
						patch({ systemHeader: event.target.value });
					}
				}), (0, react.createElement)("textarea", {
					value: form.systemFooter,
					disabled: busy,
					style: {
						...textareaStyle,
						marginTop: 4
					},
					onChange: (event) => {
						patch({ systemFooter: event.target.value });
					}
				})) : (0, react.createElement)("div", { style: hintStyle }, `跟随继承:${baseline.systemFiles.join(" / ") || "(空)"}(order ${baseline.systemOrder})`),
				(0, react.createElement)("label", { style: coverLabelStyle }, (0, react.createElement)("input", {
					type: "checkbox",
					checked: form.coverMessage,
					disabled: busy,
					onChange: () => {
						patch({ coverMessage: !form.coverMessage });
					}
				}), "覆盖消息段(进 user 消息;不勾选 = 跟随继承)"),
				form.coverMessage ? (0, react.createElement)("div", {}, (0, react.createElement)(FileListEditor, {
					files: form.files,
					busy,
					placeholder: "如 PLAYER.md 或 ${presetDir}/PLAYER.md",
					onChange: (next) => {
						patch({ files: next });
					}
				}), (0, react.createElement)("label", { style: groupLabelStyle }, "header / footer(内容前后插入)"), (0, react.createElement)("textarea", {
					value: form.header,
					disabled: busy,
					placeholder: "<roroko-reminder> …",
					style: textareaStyle,
					onChange: (event) => {
						patch({ header: event.target.value });
					}
				}), (0, react.createElement)("textarea", {
					value: form.footer,
					disabled: busy,
					placeholder: "… </roroko-reminder>",
					style: {
						...textareaStyle,
						marginTop: 4
					},
					onChange: (event) => {
						patch({ footer: event.target.value });
					}
				}), (0, react.createElement)("label", { style: coverLabelStyle }, (0, react.createElement)("input", {
					type: "checkbox",
					checked: form.wrap,
					disabled: busy,
					onChange: () => {
						patch({ wrap: !form.wrap });
					}
				}), "整体包一层 <system-reminder>…</system-reminder>"), (0, react.createElement)("label", { style: groupLabelStyle }, "落点(相对本批用户消息)"), (0, react.createElement)("div", { style: {
					display: "flex",
					fontSize: "0.86em",
					gap: 14
				} }, ...[["after-user", "之后(默认)"], ["before-user", "之前"]].map(([value, label]) => (0, react.createElement)("label", {
					key: value,
					style: {
						alignItems: "center",
						cursor: "pointer",
						display: "flex",
						gap: 4
					}
				}, (0, react.createElement)("input", {
					type: "radio",
					checked: form.placement === value,
					disabled: busy,
					onChange: () => {
						patch({ placement: value });
					}
				}), label))), (0, react.createElement)("label", { style: coverLabelStyle }, (0, react.createElement)("input", {
					type: "checkbox",
					checked: form.split,
					disabled: busy,
					onChange: () => {
						patch({ split: !form.split });
					}
				}), "每个文件各注入一条(不勾选 = 全部合并成一条)")) : (0, react.createElement)("div", { style: hintStyle }, `跟随继承:${baseline.files.join(" / ") || "(空)"}(${baseline.filesPlacement === "before-user" ? "本批之前" : "本批之后"}${baseline.splitFiles ? ",每文件一条" : ",合并一条"})`),
				(0, react.createElement)("div", { style: {
					alignItems: "center",
					display: "flex",
					flexWrap: "wrap",
					gap: 8,
					marginTop: 10
				} }, (0, react.createElement)("button", {
					type: "button",
					disabled: busy || saving,
					style: {
						...buttonStyle,
						borderColor: dirty ? "var(--dsw-text-primary, #eee)" : void 0,
						color: dirty ? "var(--dsw-text-primary, #eee)" : void 0
					},
					onClick: save
				}, saving ? "保存中…" : "保存"), (0, react.createElement)("button", {
					type: "button",
					disabled: busy || saving,
					style: buttonStyle,
					onClick: reset
				}, "重置为继承"), dirty ? (0, react.createElement)("span", { style: {
					color: "var(--dsw-text-warning, #e5a00d)",
					fontSize: "0.8em"
				} }, "● 未保存(点「保存」才写盘)") : null, saved && !dirty ? (0, react.createElement)("span", { style: {
					color: "var(--dsw-text-success, #46a758)",
					fontSize: "0.8em"
				} }, "已保存") : null, saveError !== null ? (0, react.createElement)("span", { style: {
					color: "var(--dsw-text-danger, #e5484d)",
					fontSize: "0.8em"
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
			useUnsavedGuard(dirty);
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
				}, saving ? "保存中…" : "保存路径"), dirty ? (0, react.createElement)("span", { style: {
					fontSize: "0.8em",
					color: "var(--dsw-text-warning, #e5a00d)"
				} }, "● 未保存(点「保存路径」才写盘)") : null, saved && !dirty ? (0, react.createElement)("span", { style: {
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
		/** 设置页内容:按 preset 分卡片编辑注入参数,data/mark 仍是全局参数。 */
		function RorokoToolSection() {
			const [state, setState] = (0, react.useState)(null);
			const [presets, setPresets] = (0, react.useState)([]);
			const [commonScope, setCommonScope] = (0, react.useState)("common");
			const [error, setError] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [busyTool, setBusyTool] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				let live = true;
				console.log("[roroko-tool] settings section mounted, fetching state + presets");
				(async () => {
					try {
						const [stateResponse, presetsResponse] = await Promise.all([fetch(api("/roroko-tool/state"), { cache: "no-store" }), fetch(api("/roroko-tool/presets"), { cache: "no-store" })]);
						const stateBody = await stateResponse.json();
						let presetsBody = {
							presets: [],
							commonScope: "common"
						};
						if (presetsResponse.ok) {
							const raw = await presetsResponse.json();
							presetsBody = {
								presets: Array.isArray(raw.presets) ? raw.presets : [],
								commonScope: typeof raw.commonScope === "string" && raw.commonScope.length > 0 ? raw.commonScope : "common"
							};
						} else console.log("[roroko-tool] presets route unavailable, HTTP", presetsResponse.status);
						console.log("[roroko-tool] state loaded:", stateBody);
						console.log("[roroko-tool] presets loaded:", presetsBody);
						if (!live) return;
						setState(stateBody);
						setPresets(presetsBody.presets);
						setCommonScope(presetsBody.commonScope);
					} catch (cause) {
						if (live) setError(cause instanceof Error ? cause.message : String(cause));
					}
				})();
				return () => {
					live = false;
				};
			}, []);
			const post = async (tool, payload, label) => {
				setBusy(true);
				setBusyTool(label);
				setError(null);
				try {
					const response = await fetch(api("/roroko-tool/state"), {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							tool,
							...payload
						})
					});
					const body = await response.json();
					if (!response.ok || body.ok !== true || body.state === void 0) {
						const message = body.error ?? `failed to save ${label} (HTTP ${response.status})`;
						console.log("[roroko-tool] save rejected:", label, message);
						setError(message);
						return false;
					}
					setState(body.state);
					return true;
				} catch (cause) {
					const message = cause instanceof Error ? cause.message : String(cause);
					console.log("[roroko-tool] save threw:", label, message);
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
			const baseline = state?.preinject;
			const scopeCards = [];
			if (state !== null && baseline !== void 0) {
				scopeCards.push((0, react.createElement)(PresetCard, {
					key: `scope-${commonScope}`,
					title: `公共默认(${commonScope})`,
					hint: "没写 preset、或某个 preset 没覆盖时生效的那一层。",
					badge: state.presets[commonScope]?.preinject === void 0 ? "跟随 config" : "已覆盖",
					defaultOpen: true,
					children: [(0, react.createElement)(PreinjectScopePanel, {
						override: state.presets[commonScope]?.preinject ?? {},
						baseline,
						busy: busy && busyTool === `preinject:${commonScope}`,
						onSave: (payload) => post("preinject", {
							preset: commonScope,
							...payload
						}, `preinject:${commonScope}`),
						onReset: () => post("preinject", {
							preset: commonScope,
							reset: true
						}, `preinject:${commonScope}`)
					})]
				}));
				for (const preset of presets) {
					const override = state.presets[preset.id]?.preinject;
					const badge = preset.composition !== true ? "缺 agent.cordis.yml" : override === void 0 ? "跟随继承" : "已覆盖";
					scopeCards.push((0, react.createElement)(PresetCard, {
						key: `scope-${preset.id}`,
						title: preset.name.length > 0 ? `${preset.id} · ${preset.name}` : preset.id,
						hint: `会话当前 preset 为 '${preset.id}' 时注入这一层(以会话 log 内最新一条 agent-preset/selected 为准,不是创建时的 header)。`,
						badge,
						defaultOpen: false,
						children: [(0, react.createElement)(PreinjectScopePanel, {
							override: override ?? {},
							baseline,
							busy: busy && busyTool === `preinject:${preset.id}`,
							onSave: (payload) => post("preinject", {
								preset: preset.id,
								...payload
							}, `preinject:${preset.id}`),
							onReset: () => post("preinject", {
								preset: preset.id,
								reset: true
							}, `preinject:${preset.id}`)
						})]
					}));
				}
			}
			return (0, react.createElement)("div", { style: { padding: "6px 0" } }, (0, react.createElement)("div", { style: {
				color: "var(--dsw-text-secondary, #888)",
				fontSize: "0.9em",
				marginBottom: 12
			} }, "洛洛可全家桶插件参数 — 功能由 agent preset 声明启用,这里只调参数;状态存服务器 profile。"), state === null || baseline === void 0 ? (0, react.createElement)("div", { style: {
				color: "var(--dsw-text-secondary, #888)",
				fontSize: "0.9em"
			} }, error === null ? "加载中…" : `加载失败: ${error}`) : (0, react.createElement)("div", {}, (0, react.createElement)(ToolHeader, {
				title: "指令预注入 (roroko-preinject)",
				desc: "系统段进 system 提示词(常驻不折叠),消息段进 user 消息(会话一次);注入文件与落点按 preset 一卡一层。"
			}), ...scopeCards, (0, react.createElement)(ToolHeader, {
				title: "素材库工具 (roroko-data)",
				desc: "取料 roroko_datas_query(发散默认 / 条件收束)+ roroko_datas_lookup / register / state;preset 声明即启用。"
			}), (0, react.createElement)(DataPanel, {
				config: state.data,
				busy: busy && busyTool === "data",
				onSave: (next) => post("data", { dbPath: next.dbPath }, "data")
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