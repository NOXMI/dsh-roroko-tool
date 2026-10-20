window.__ModuleLoader__.load({
	id: "@roroko-tool/dsh-roroko-tool",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/locales.ts
		/** 设置页文案。 */
		const zh = {
			title: "roroko-tool",
			subtitle: "子模块参数",
			loading: "加载中…",
			failed: "加载失败",
			version: "版本",
			refresh: "刷新",
			preinjectTitle: "① 上下文注入（preinject）",
			preinjectHint: "系统层文件进 system 提示词，用户层文件拼成一条 user 消息；另可按段名抹掉不想要的系统段。",
			notMounted: "没有挂载 preinject",
			notMountedHint: "preset 里没声明 config.preinject 桶，这个页面无事可做",
			root: "身份根",
			commonTitle: "公共默认",
			commonHint: "没写覆盖的 preset 都吃这一层，也是每个 preset 的基线。",
			presetHint: "会话 header.agentPreset 等于这个 id 时，这一层叠在公共默认之上。",
			scopeLabel: "作用域",
			applyTo: "正在编辑",
			collapse: "收起",
			expand: "展开",
			badgeBaseline: "基线",
			badgeOverridden: "已覆盖",
			badgeInherit: "跟随继承",
			badgeBroken: "挂不起来",
			coverSystem: "覆盖系统层（进 system 提示词；不勾选 = 跟随继承）",
			coverUser: "覆盖用户层（进 user 消息；不勾选 = 跟随继承）",
			coverSuppress: "覆盖屏蔽段（装配后按段名抹掉；不勾选 = 跟随继承）",
			followSystem: "跟随继承",
			followUser: "跟随继承",
			followSuppress: "跟随继承",
			suppressHint: "内置已抹 context:file-reference 与 tool:*，这里只往上加（末尾 * 是前缀匹配）",
			filesHint: "如 IDENTITY.md，或 /root/.dsh/roroko/AGENTS.md",
			addFile: "+ 添加文件",
			deleteRow: "删除此行",
			emptyFiles: "清单是空的",
			missing: "缺失",
			present: "就绪",
			save: "保存",
			saving: "保存中…",
			saved: "已保存",
			saveFailed: "保存失败",
			resetScope: "重置为继承",
			datasTitle: "② 素材库（datas）",
			datasHint: "roroko_datas_* 四把工具连哪个库，以及 state 短条多久自动注一次。",
			datasEnabled: "启用素材库（默认关闭）",
			datasEnabledHint: "关着 = 四把工具根本不存在、也不注入 state 短条。勾上保存后，下一轮请求就带上工具。",
			coverDbPath: "覆盖库路径（不勾选 = 跟随继承）",
			followDbPath: "跟随继承",
			dbPathHint: "/var/www/api/database/soul.db",
			coverAutoinject: "覆盖自动注入（不勾选 = 跟随继承）",
			followAutoinject: "跟随继承",
			aiRounds: "轮数触发",
			aiAfterTool: "取过料后注入",
			aiEvery: "每 N 轮",
			aiMinGap: "最短间隔 N 轮",
			on: "开",
			off: "关",
			memoryTitle: "③ 记忆（memory）",
			memoryHint: "roroko_mem_* 四把工具：记一条 / 按日期回查 / 关键词检索 / 按 id 取全文；dream 定时把旧条反思收敛。",
			memoryEnabled: "启用记忆（默认关闭）",
			memoryEnabledHint: "关着 = 四把工具根本不存在、dream 也不跑。勾上保存后，下一轮请求就带上工具。",
			coverOwner: "覆盖 owner 桶（不勾选 = 跟随继承）",
			ownerHint: "dev",
			coverDream: "覆盖 dream（不勾选 = 跟随继承）",
			dreamEnabled: "定时反思",
			dreamInterval: "间隔（小时）",
			dreamBatch: "一次整理 N 条",
			dreamProvider: "provider",
			dreamModel: "model",
			dreamPreset: "preset（空 = 默认）",
			dreamCwd: "工作目录（空 = 进程 cwd）",
			dreamNow: "立即整理一次",
			dreamRunning: "正在整理…",
			dreamIdle: "dream 未启动",
			dreamLast: "最近一次"
		};
		/** English copy, same keys. */
		const en = {
			title: "roroko-tool",
			subtitle: "Submodule settings",
			loading: "Loading…",
			failed: "Failed to load",
			version: "Version",
			refresh: "Refresh",
			preinjectTitle: "① Context injection (preinject)",
			preinjectHint: "System-layer files go into the system prompt, user-layer files become one user message; unwanted system sections can be dropped by name.",
			notMounted: "preinject is not mounted",
			notMountedHint: "No config.preinject bucket in this preset, nothing to configure here",
			root: "Root",
			commonTitle: "Common default",
			commonHint: "Every preset without overrides reads this layer; it is the baseline.",
			presetHint: "Applied on top of the common default when the session header carries this preset id.",
			scopeLabel: "Scope",
			applyTo: "Editing",
			collapse: "Collapse",
			expand: "Expand",
			badgeBaseline: "baseline",
			badgeOverridden: "overridden",
			badgeInherit: "inherited",
			badgeBroken: "broken",
			coverSystem: "Override the system layer (system prompt; unchecked = inherit)",
			coverUser: "Override the user layer (user message; unchecked = inherit)",
			coverSuppress: "Override suppressed sections (dropped by name after assembly; unchecked = inherit)",
			followSystem: "inherited",
			followUser: "inherited",
			followSuppress: "inherited",
			suppressHint: "context:file-reference and tool:* are already suppressed; entries only add (trailing * = prefix)",
			filesHint: "e.g. IDENTITY.md, or /root/.dsh/roroko/AGENTS.md",
			addFile: "+ Add file",
			deleteRow: "Remove this line",
			emptyFiles: "Empty list",
			missing: "missing",
			present: "ready",
			save: "Save",
			saving: "Saving…",
			saved: "Saved",
			saveFailed: "Save failed",
			resetScope: "Reset to inherit",
			datasTitle: "② Material library (datas)",
			datasHint: "Which database the roroko_datas_* tools open, and how often the state digest is injected.",
			datasEnabled: "Enable the material library (off by default)",
			datasEnabledHint: "While off, the four tools do not exist and no state digest is injected. Save with it ticked and the next request carries them.",
			coverDbPath: "Override the database path (unchecked = inherit)",
			followDbPath: "inherited",
			dbPathHint: "/var/www/api/database/soul.db",
			coverAutoinject: "Override auto-injection (unchecked = inherit)",
			followAutoinject: "inherited",
			aiRounds: "Inject by round count",
			aiAfterTool: "Inject after tool use",
			aiEvery: "every N rounds",
			aiMinGap: "min gap N rounds",
			on: "on",
			off: "off",
			memoryTitle: "③ Memory (memory)",
			memoryHint: "The four roroko_mem_* tools (write / by date / keyword search / full text); dream condenses old entries on a timer.",
			memoryEnabled: "Enable memory (off by default)",
			memoryEnabledHint: "While off, the four tools do not exist and dream never runs. Save with it ticked and the next request carries them.",
			coverOwner: "Override the owner bucket (unchecked = inherit)",
			ownerHint: "dev",
			coverDream: "Override dream (unchecked = inherit)",
			dreamEnabled: "Scheduled reflection",
			dreamInterval: "interval (hours)",
			dreamBatch: "entries per run",
			dreamProvider: "provider",
			dreamModel: "model",
			dreamPreset: "preset (empty = default)",
			dreamCwd: "cwd (empty = process cwd)",
			dreamNow: "Reflect now",
			dreamRunning: "Running…",
			dreamIdle: "dream is not running",
			dreamLast: "last run"
		};
		//#endregion
		//#region src/client/api.ts
		async function request(path, init) {
			const response = await fetch(path, {
				credentials: "same-origin",
				...init
			});
			if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
			return await response.json();
		}
		/** 读全量状态。 */
		function fetchState() {
			return request("/roroko-tool/state");
		}
		/**
		* 写某个桶。字段传 `null` 表示删掉该键（回到跟随下层）。
		* @param patch - 至少带 preset。
		* @returns 宿主回执。
		*/
		function saveConfig(patch) {
			return request("/roroko-tool/config", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(patch)
			});
		}
		/** 立即整理一次。 */
		function runDream() {
			return request("/roroko-tool/dream", { method: "POST" });
		}
		//#endregion
		//#region src/client/index.tsx
		/**
		* 洛洛可设置页（浏览器半侧）。
		*
		* 版式照 0.1.6 那套：灰色说明行 + 浅底面板 + 逐行可增删的文件清单 +
		* 底部保存按钮与内联的已保存/失败提示。
		*
		* 内容换成新版的分桶结构：公共默认一张卡（默认展开），注册表里每个 preset
		* 一张折叠卡。每组参数一个「覆盖」勾选框——不勾就一个字段都不发，跟随继承；
		* 勾了整组落盘，空清单就是显式清空。两组都不覆盖时保存 = 把桶删掉。
		*
		* 数据走宿主自己的 HTTP 路由（见 api.ts），不碰 Remote/configForms。
		*/
		/** 文案命名空间。 */
		const NS = "rorokoTool";
		/** 需要的客户端服务。 */
		const inject = ["slots", "locale"];
		/** 左栏一级图标。 */
		function RorokoIcon({ size = 18, active = false }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": "true",
				style: { opacity: active ? 1 : .72 },
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M4 17.5V9.2L12 4l8 5.2v8.3",
					stroke: "currentColor",
					strokeWidth: "1.7",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M8.3 20v-6.2h7.4V20",
					stroke: "currentColor",
					strokeWidth: "1.7",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})]
			});
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
		const hintStyle = {
			color: "var(--dsw-text-secondary, #888)",
			fontSize: "0.8em",
			marginTop: 2
		};
		const groupLabelStyle = {
			color: "var(--dsw-text-secondary, #888)",
			display: "block",
			fontSize: "0.85em",
			marginBottom: 4,
			marginTop: 8
		};
		/** 卡片外壳。 */
		const cardStyle = {
			border: "1px solid var(--dsw-text-secondary, #444)",
			borderRadius: 6,
			margin: "8px 0",
			padding: "8px 10px"
		};
		/** 卡片标题按钮（整行可点、左对齐）。 */
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
		/** 卡片状态徽标。 */
		const badgeStyle = {
			border: "1px solid var(--dsw-text-secondary, #666)",
			borderRadius: 4,
			color: "var(--dsw-text-secondary, #888)",
			fontSize: "0.78em",
			padding: "1px 6px"
		};
		/** 作用域 chips 那一行：横向滚动，越多越滚，绝不换行把面板撑高。 */
		const chipsRowStyle = {
			display: "flex",
			gap: 6,
			margin: "2px 0 10px",
			overflowX: "auto",
			paddingBottom: 2,
			scrollbarWidth: "none"
		};
		/** 未选中的作用域 chip。 */
		const chipStyle = {
			...buttonStyle,
			alignItems: "center",
			display: "inline-flex",
			flex: "0 0 auto",
			gap: 5,
			fontSize: "0.85em",
			padding: "3px 9px",
			whiteSpace: "nowrap"
		};
		/** 当前作用域 chip：实底 + 主色描边。 */
		const chipActiveStyle = {
			...chipStyle,
			background: "var(--dsw-surface-secondary, rgba(128,128,128,.16))",
			borderColor: "var(--dsw-text-primary, #ddd)",
			color: "var(--dsw-text-primary, #eee)",
			fontWeight: 600
		};
		/** 「覆盖这一组」复选框所在行。 */
		const coverLabelStyle = {
			alignItems: "center",
			cursor: "pointer",
			display: "flex",
			fontSize: "0.88em",
			gap: 6,
			marginTop: 8
		};
		/** 区块外壳：参数面板共用背景/圆角/内边距。 */
		function PanelShell(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					background: "var(--dsw-surface-secondary, rgba(128,128,128,.06))",
					borderRadius: 6,
					margin: "8px 0 4px",
					padding: "10px 12px"
				},
				children: props.children
			});
		}
		/**
		* 一节可折叠的外壳：标题 + 一串徽标 + 右侧「收起 / 展开」。
		*
		* 作用域不再各占一张卡（那是 0.1.6 的形态，preset 一多就纵向爆炸）：
		* 顶部 chips 选作用域，这里只按模块分节，三节就是全部。
		*/
		function Section(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: cardStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						style: cardHeadStyle,
						onClick: props.onToggle,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: { fontWeight: 600 },
								children: [
									props.open ? "▾" : "▸",
									" ",
									props.title
								]
							}),
							props.badges.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: badgeStyle,
								children: item
							}, item)),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									...hintStyle,
									marginLeft: "auto",
									marginTop: 0
								},
								children: props.open ? props.collapseLabel : props.expandLabel
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: hintStyle,
						children: props.hint
					}),
					props.open ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: { marginTop: 8 },
						children: props.children
					}) : null
				]
			});
		}
		/** 文件清单编辑器：若干行文本框 + 增删。 */
		function FileListEditor(props) {
			const { files, busy, placeholder, addLabel, deleteLabel, onChange } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [files.map((file, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					gap: 6,
					marginBottom: 4,
					alignItems: "center"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type: "text",
					value: file,
					disabled: busy,
					placeholder,
					style: inputStyle,
					onChange: (event) => {
						const next = files.slice();
						next[index] = event.target.value;
						onChange(next);
					}
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					disabled: busy,
					title: deleteLabel,
					style: {
						...buttonStyle,
						flexShrink: 0
					},
					onClick: () => {
						onChange(files.filter((_, i) => i !== index));
					},
					children: "✕"
				})]
			}, `file-${String(index)}`)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: { marginTop: 4 },
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					disabled: busy,
					style: buttonStyle,
					onClick: () => {
						onChange([...files, ""]);
					},
					children: addLabel
				})
			})] });
		}
		/** 清单读盘状态：就绪 / 缺失。 */
		function FileStatus(props) {
			const { infos, t } = props;
			if (infos === void 0 || infos.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					...hintStyle,
					marginTop: 6
				},
				children: infos.map((info, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [index > 0 ? " · " : "", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					style: { color: info.exists ? "var(--dsw-text-success, #46a758)" : "var(--dsw-text-danger, #e5484d)" },
					children: [
						info.name,
						" ",
						info.exists ? `✓ ${t("present")}` : `✗ ${t("missing")}`
					]
				})] }, info.path))
			});
		}
		/** 清单落盘前清洗：去首尾空白、去空行、去重。 */
		function cleanList(list) {
			return list.map((item) => item.trim()).filter((item) => item.length > 0).filter((item, index, self) => self.indexOf(item) === index);
		}
		/** 一张卡的内容：三组参数 + 保存 / 重置。 */
		function ScopePanel(props) {
			const { t, scope, bucket, effective, files, onSaved } = props;
			const [coverSystem, setCoverSystem] = (0, react.useState)(() => bucket?.systemFiles !== void 0);
			const [coverUser, setCoverUser] = (0, react.useState)(() => bucket?.userFiles !== void 0);
			const [coverSuppress, setCoverSuppress] = (0, react.useState)(() => bucket?.suppressSections !== void 0);
			const [systemFiles, setSystemFiles] = (0, react.useState)(() => [...bucket?.systemFiles ?? effective?.systemFiles ?? []]);
			const [userFiles, setUserFiles] = (0, react.useState)(() => [...bucket?.userFiles ?? effective?.userFiles ?? []]);
			const [suppressSections, setSuppressSections] = (0, react.useState)(() => [...bucket?.suppressSections ?? effective?.suppressSections ?? []]);
			const [saved, setSaved] = (0, react.useState)(false);
			const [saving, setSaving] = (0, react.useState)(false);
			const [saveError, setSaveError] = (0, react.useState)(null);
			const save = () => {
				setSaved(false);
				setSaveError(null);
				setSaving(true);
				const patch = { preset: scope };
				patch.systemFiles = coverSystem ? cleanList(systemFiles) : null;
				patch.userFiles = coverUser ? cleanList(userFiles) : null;
				patch.suppressSections = coverSuppress ? cleanList(suppressSections) : null;
				saveConfig(patch).then(async (ack) => {
					if (!ack.ok) throw new Error(ack.reason ?? t("saveFailed"));
					setSaved(true);
					await onSaved();
				}).catch((cause) => {
					setSaveError(cause instanceof Error ? cause.message : String(cause));
				}).finally(() => {
					setSaving(false);
				});
			};
			const resetScope = () => {
				setSaved(false);
				setSaveError(null);
				setSaving(true);
				saveConfig({
					preset: scope,
					reset: true
				}).then(async (ack) => {
					if (!ack.ok) throw new Error(ack.reason ?? t("saveFailed"));
					setSaved(true);
					await onSaved();
				}).catch((cause) => {
					setSaveError(cause instanceof Error ? cause.message : String(cause));
				}).finally(() => {
					setSaving(false);
				});
			};
			const busy = saving;
			const followSystem = effective?.systemFiles.join(" / ") ?? "";
			const followUser = effective?.userFiles.join(" / ") ?? "";
			const followSuppress = effective?.suppressSections.join(" / ") ?? "";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(PanelShell, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					style: coverLabelStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						checked: coverSystem,
						disabled: busy,
						onChange: () => {
							setCoverSystem((value) => !value);
							setSaved(false);
						}
					}), t("coverSystem")]
				}),
				coverSystem ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileListEditor, {
					files: systemFiles,
					busy,
					placeholder: t("filesHint"),
					addLabel: t("addFile"),
					deleteLabel: t("deleteRow"),
					onChange: (next) => {
						setSystemFiles(next);
						setSaved(false);
					}
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileStatus, {
					infos: files?.system,
					t
				})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: hintStyle,
					children: [
						t("followSystem"),
						": ",
						followSystem.length > 0 ? followSystem : t("emptyFiles")
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					style: coverLabelStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						checked: coverUser,
						disabled: busy,
						onChange: () => {
							setCoverUser((value) => !value);
							setSaved(false);
						}
					}), t("coverUser")]
				}),
				coverUser ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileListEditor, {
					files: userFiles,
					busy,
					placeholder: t("filesHint"),
					addLabel: t("addFile"),
					deleteLabel: t("deleteRow"),
					onChange: (next) => {
						setUserFiles(next);
						setSaved(false);
					}
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileStatus, {
					infos: files?.user,
					t
				})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: hintStyle,
					children: [
						t("followUser"),
						": ",
						followUser.length > 0 ? followUser : t("emptyFiles")
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					style: coverLabelStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						checked: coverSuppress,
						disabled: busy,
						onChange: () => {
							setCoverSuppress((value) => !value);
							setSaved(false);
						}
					}), t("coverSuppress")]
				}),
				coverSuppress ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileListEditor, {
					files: suppressSections,
					busy,
					placeholder: t("suppressHint"),
					addLabel: t("addFile"),
					deleteLabel: t("deleteRow"),
					onChange: (next) => {
						setSuppressSections(next);
						setSaved(false);
					}
				}) }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: hintStyle,
					children: [
						t("followSuppress"),
						": ",
						followSuppress.length > 0 ? followSuppress : t("emptyFiles")
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						alignItems: "center",
						display: "flex",
						flexWrap: "wrap",
						gap: 8,
						marginTop: 10
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: busy,
							style: buttonStyle,
							onClick: save,
							children: saving ? t("saving") : t("save")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: busy,
							style: buttonStyle,
							onClick: resetScope,
							children: t("resetScope")
						}),
						saved ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								color: "var(--dsw-text-success, #46a758)",
								fontSize: "0.8em"
							},
							children: t("saved")
						}) : null,
						saveError === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								color: "var(--dsw-text-danger, #e5484d)",
								fontSize: "0.8em"
							},
							children: [
								t("saveFailed"),
								": ",
								saveError
							]
						})
					]
				})
			] });
		}
		/** 一组自动注入开关：两个布尔 + 两个数字。 */
		function AutoinjectEditor(props) {
			const { value, busy, t, onChange } = props;
			const num = (key) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
				type: "number",
				min: key === "every" ? 1 : 0,
				max: 200,
				value: value[key],
				disabled: busy,
				style: {
					...inputStyle,
					width: 90
				},
				onChange: (event) => {
					const next = Number(event.target.value);
					onChange({
						...value,
						[key]: Number.isFinite(next) ? Math.trunc(next) : value[key]
					});
				}
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					style: coverLabelStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						checked: value.rounds,
						disabled: busy,
						onChange: () => {
							onChange({
								...value,
								rounds: !value.rounds
							});
						}
					}), t("aiRounds")]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					style: coverLabelStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						checked: value.afterTool,
						disabled: busy,
						onChange: () => {
							onChange({
								...value,
								afterTool: !value.afterTool
							});
						}
					}), t("aiAfterTool")]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						...coverLabelStyle,
						cursor: "default"
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("aiEvery") }),
						num("every"),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("aiMinGap") }),
						num("minGap")
					]
				})
			] });
		}
		/** 素材库参数：库路径 + 自动注入节奏。 */
		function DatasPanel(props) {
			const { t, scope, bucket, effective, defaults, onSaved } = props;
			const follow = effective ?? defaults;
			const [enabled, setEnabled] = (0, react.useState)(() => follow.enabled);
			const [coverPath, setCoverPath] = (0, react.useState)(() => bucket?.dbPath !== void 0);
			const [coverAuto, setCoverAuto] = (0, react.useState)(() => bucket?.autoinject !== void 0);
			const [dbPath, setDbPath] = (0, react.useState)(() => bucket?.dbPath ?? follow.dbPath);
			const [auto, setAuto] = (0, react.useState)(() => ({ ...follow.autoinject }));
			const [saved, setSaved] = (0, react.useState)(false);
			const [saving, setSaving] = (0, react.useState)(false);
			const [saveError, setSaveError] = (0, react.useState)(null);
			const run = (patch) => {
				setSaved(false);
				setSaveError(null);
				setSaving(true);
				saveConfig(patch).then(async (ack) => {
					if (!ack.ok) throw new Error(ack.reason ?? t("saveFailed"));
					setSaved(true);
					await onSaved();
				}).catch((cause) => {
					setSaveError(cause instanceof Error ? cause.message : String(cause));
				}).finally(() => {
					setSaving(false);
				});
			};
			const save = () => {
				run({
					preset: scope,
					section: "datas",
					enabled,
					dbPath: coverPath ? dbPath.trim() : null,
					autoinject: coverAuto ? auto : null
				});
			};
			const busy = saving;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(PanelShell, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					style: {
						...coverLabelStyle,
						fontWeight: 600
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						checked: enabled,
						disabled: busy,
						onChange: () => {
							setEnabled((value) => !value);
							setSaved(false);
						}
					}), t("datasEnabled")]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						...hintStyle,
						marginBottom: 6
					},
					children: t("datasEnabledHint")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					style: {
						...coverLabelStyle,
						opacity: enabled ? 1 : .5
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						checked: coverPath,
						disabled: busy || !enabled,
						onChange: () => {
							setCoverPath((value) => !value);
							setSaved(false);
						}
					}), t("coverDbPath")]
				}),
				coverPath ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type: "text",
					value: dbPath,
					disabled: busy || !enabled,
					placeholder: t("dbPathHint"),
					style: inputStyle,
					onChange: (event) => {
						setDbPath(event.target.value);
						setSaved(false);
					}
				}) }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: hintStyle,
					children: [
						t("followDbPath"),
						": ",
						follow.dbPath
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					style: {
						...coverLabelStyle,
						opacity: enabled ? 1 : .5
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						checked: coverAuto,
						disabled: busy || !enabled,
						onChange: () => {
							setCoverAuto((value) => !value);
							setSaved(false);
						}
					}), t("coverAutoinject")]
				}),
				coverAuto ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AutoinjectEditor, {
					value: auto,
					busy: busy || !enabled,
					t,
					onChange: (next) => {
						setAuto(next);
						setSaved(false);
					}
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: hintStyle,
					children: [
						t("followAutoinject"),
						": ",
						follow.autoinject.rounds ? t("on") : t("off"),
						" · ",
						t("aiEvery"),
						follow.autoinject.every,
						" · ",
						t("aiMinGap"),
						follow.autoinject.minGap
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						alignItems: "center",
						display: "flex",
						flexWrap: "wrap",
						gap: 8,
						marginTop: 10
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: busy,
							style: buttonStyle,
							onClick: save,
							children: saving ? t("saving") : t("save")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: busy,
							style: buttonStyle,
							onClick: () => {
								run({
									preset: scope,
									section: "datas",
									reset: true
								});
							},
							children: t("resetScope")
						}),
						saved ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								color: "var(--dsw-text-success, #46a758)",
								fontSize: "0.8em"
							},
							children: t("saved")
						}) : null,
						saveError === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								color: "var(--dsw-text-danger, #e5484d)",
								fontSize: "0.8em"
							},
							children: [
								t("saveFailed"),
								": ",
								saveError
							]
						})
					]
				})
			] });
		}
		/**
		* 记忆参数：库路径 + owner 桶 + dream 定时反思。
		* @param props - 页签所有者传入的属性。
		* @returns 面板元素。
		*/
		function MemoryPanel(props) {
			const { t, scope, bucket, effective, defaults, dream, onSaved } = props;
			const follow = effective ?? defaults;
			const [enabled, setEnabled] = (0, react.useState)(() => follow.enabled);
			const [coverPath, setCoverPath] = (0, react.useState)(() => bucket?.dbPath !== void 0);
			const [coverOwner, setCoverOwner] = (0, react.useState)(() => bucket?.owner !== void 0);
			const [coverDream, setCoverDream] = (0, react.useState)(() => bucket?.dream !== void 0);
			const [dbPath, setDbPath] = (0, react.useState)(() => bucket?.dbPath ?? follow.dbPath);
			const [owner, setOwner] = (0, react.useState)(() => bucket?.owner ?? follow.owner);
			const [cfg, setCfg] = (0, react.useState)(() => ({ ...follow.dream }));
			const [saved, setSaved] = (0, react.useState)(false);
			const [saving, setSaving] = (0, react.useState)(false);
			const [saveError, setSaveError] = (0, react.useState)(null);
			const [dreamBusy, setDreamBusy] = (0, react.useState)(false);
			const [dreamNote, setDreamNote] = (0, react.useState)(null);
			const run = (patch) => {
				setSaved(false);
				setSaveError(null);
				setSaving(true);
				saveConfig(patch).then(async (ack) => {
					if (!ack.ok) throw new Error(ack.reason ?? t("saveFailed"));
					setSaved(true);
					await onSaved();
				}).catch((cause) => {
					setSaveError(cause instanceof Error ? cause.message : String(cause));
				}).finally(() => {
					setSaving(false);
				});
			};
			const save = () => {
				run({
					preset: scope,
					section: "memory",
					enabled,
					dbPath: coverPath ? dbPath.trim() : null,
					owner: coverOwner ? owner.trim() : null,
					dream: coverDream ? cfg : null
				});
			};
			const reflectNow = () => {
				setDreamBusy(true);
				setDreamNote(null);
				runDream().then((ack) => {
					if (!ack.ok) throw new Error(ack.reason ?? "dream 失败");
					setDreamNote(ack.result?.note ?? null);
					return onSaved();
				}).catch((cause) => {
					setDreamNote(cause instanceof Error ? cause.message : String(cause));
				}).finally(() => {
					setDreamBusy(false);
				});
			};
			const busy = saving;
			const hours = () => Math.round(cfg.intervalMs / 36e5 * 10) / 10;
			const text = (key, placeholder) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
				type: "text",
				value: cfg[key],
				disabled: busy || !enabled,
				placeholder,
				style: {
					...inputStyle,
					width: 220
				},
				onChange: (event) => {
					setCfg({
						...cfg,
						[key]: event.target.value
					});
					setSaved(false);
				}
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(PanelShell, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					style: {
						...coverLabelStyle,
						fontWeight: 600
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						checked: enabled,
						disabled: busy,
						onChange: () => {
							setEnabled((value) => !value);
							setSaved(false);
						}
					}), t("memoryEnabled")]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						...hintStyle,
						marginBottom: 6
					},
					children: t("memoryEnabledHint")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					style: {
						...coverLabelStyle,
						opacity: enabled ? 1 : .5
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						checked: coverPath,
						disabled: busy || !enabled,
						onChange: () => {
							setCoverPath((value) => !value);
							setSaved(false);
						}
					}), t("coverDbPath")]
				}),
				coverPath ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type: "text",
					value: dbPath,
					disabled: busy || !enabled,
					placeholder: t("dbPathHint"),
					style: inputStyle,
					onChange: (event) => {
						setDbPath(event.target.value);
						setSaved(false);
					}
				}) }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: hintStyle,
					children: [
						t("followDbPath"),
						": ",
						follow.dbPath
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					style: {
						...coverLabelStyle,
						opacity: enabled ? 1 : .5
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						checked: coverOwner,
						disabled: busy || !enabled,
						onChange: () => {
							setCoverOwner((value) => !value);
							setSaved(false);
						}
					}), t("coverOwner")]
				}),
				coverOwner ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type: "text",
					value: owner,
					disabled: busy || !enabled,
					placeholder: t("ownerHint"),
					style: {
						...inputStyle,
						width: 180
					},
					onChange: (event) => {
						setOwner(event.target.value);
						setSaved(false);
					}
				}) }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: hintStyle,
					children: [
						t("followDbPath"),
						": ",
						follow.owner
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					style: {
						...coverLabelStyle,
						opacity: enabled ? 1 : .5
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						checked: coverDream,
						disabled: busy || !enabled,
						onChange: () => {
							setCoverDream((value) => !value);
							setSaved(false);
						}
					}), t("coverDream")]
				}),
				coverDream ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: coverLabelStyle,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: cfg.enabled,
							disabled: busy || !enabled,
							onChange: () => {
								setCfg({
									...cfg,
									enabled: !cfg.enabled
								});
								setSaved(false);
							}
						}), t("dreamEnabled")] })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: coverLabelStyle,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("dreamInterval") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "number",
								min: .1,
								max: 24,
								step: .5,
								value: hours(),
								disabled: busy || !enabled,
								style: {
									...inputStyle,
									width: 90
								},
								onChange: (event) => {
									const next = Number(event.target.value);
									setCfg({
										...cfg,
										intervalMs: Number.isFinite(next) ? Math.round(next * 36e5) : cfg.intervalMs
									});
									setSaved(false);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("dreamBatch") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "number",
								min: 1,
								max: 50,
								value: cfg.batch,
								disabled: busy || !enabled,
								style: {
									...inputStyle,
									width: 90
								},
								onChange: (event) => {
									const next = Number(event.target.value);
									setCfg({
										...cfg,
										batch: Number.isFinite(next) ? Math.trunc(next) : cfg.batch
									});
									setSaved(false);
								}
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: coverLabelStyle,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("dreamProvider") }),
							text("provider", "deepseek"),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("dreamModel") }),
							text("model", "deepseek-chat")
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: coverLabelStyle,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("dreamPreset") }),
							text("preset", "roroko"),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("dreamCwd") }),
							text("cwd", "/root/roroko-workplace")
						]
					})
				] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: hintStyle,
					children: [
						t("followAutoinject"),
						": ",
						follow.dream.enabled ? t("on") : t("off"),
						" · ",
						t("dreamInterval"),
						Math.round(follow.dream.intervalMs / 36e5 * 10) / 10,
						" · ",
						t("dreamBatch"),
						follow.dream.batch,
						follow.dream.provider.length > 0 ? ` · ${follow.dream.provider}/${follow.dream.model}` : ""
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						alignItems: "center",
						display: "flex",
						flexWrap: "wrap",
						gap: 8,
						marginTop: 10
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: busy,
							style: buttonStyle,
							onClick: save,
							children: saving ? t("saving") : t("save")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: busy,
							style: buttonStyle,
							onClick: () => {
								run({
									preset: scope,
									section: "memory",
									reset: true
								});
							},
							children: t("resetScope")
						}),
						saved ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								color: "var(--dsw-text-success, #46a758)",
								fontSize: "0.8em"
							},
							children: t("saved")
						}) : null,
						saveError === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								color: "var(--dsw-text-danger, #e5484d)",
								fontSize: "0.8em"
							},
							children: [
								t("saveFailed"),
								": ",
								saveError
							]
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						alignItems: "center",
						display: "flex",
						flexWrap: "wrap",
						gap: 8,
						marginTop: 10
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						disabled: busy || dreamBusy,
						style: buttonStyle,
						onClick: reflectNow,
						children: dreamBusy ? t("dreamRunning") : t("dreamNow")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: hintStyle,
						children: [
							dream.started ? null : `${t("dreamIdle")} · `,
							dream.last?.at !== void 0 ? `${t("dreamLast")}: ${dream.last.at}` : "",
							dream.last?.note !== void 0 ? ` · ${dream.last.note}` : "",
							dreamNote !== null ? ` · ${dreamNote}` : ""
						]
					})]
				})
			] });
		}
		/**
		* 设置页主体。
		* @param props - 页签所有者传入的属性。
		* @returns 设置页元素。
		*/ function RorokoSettingsPage(props) {
			const { t } = props;
			const [state, setState] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			/**
			* ⚠️ 这两个 state 必须放在**任何 early return 之前**。
			* 曾经放在"加载完再往下走"的分支里 → 首渲染 4 个 hook、数据到位后变 6 个，
			* React 直接报 #310（Rendered more hooks than during the previous render），
			* 整个设置页白屏。hooks 的数量每次渲染必须一模一样。
			*/
			const [activeScope, setActiveScope] = (0, react.useState)("common");
			const [closed, setClosed] = (0, react.useState)({});
			const load = (0, react.useCallback)(async () => {
				setError(null);
				try {
					setState(await fetchState());
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				}
			}, []);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			if (error !== null) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					padding: "6px 0",
					color: "var(--dsw-text-secondary, #888)",
					fontSize: "0.9em"
				},
				children: [
					t("failed"),
					": ",
					error,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: { marginTop: 8 },
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							style: buttonStyle,
							onClick: () => {
								load();
							},
							children: t("refresh")
						})
					})
				]
			});
			if (state === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					padding: "6px 0",
					color: "var(--dsw-text-secondary, #888)",
					fontSize: "0.9em"
				},
				children: t("loading")
			});
			if (!state.mounted && state.datas?.mounted !== true && state.memory?.mounted !== true) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { padding: "6px 0" },
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: { fontWeight: 600 },
					children: t("notMounted")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: hintStyle,
					children: t("notMountedHint")
				})]
			});
			const scopes = state.scopes ?? ["common"];
			const roster = new Map((state.roster ?? []).map((row) => [row.id, row]));
			const datas = state.datas;
			const memory = state.memory;
			const current = scopes.includes(activeScope) ? activeScope : scopes[0] ?? "common";
			/** 该作用域有没有自己的桶（三个模块任一）—— 决定 chips 上的实心点。 */
			const hasBucket = (scope) => state.presets?.[scope] !== void 0 || datas?.presets[scope] !== void 0 || memory?.presets[scope] !== void 0;
			/** 作用域显示名：公共默认用文案，preset 用「id · 名字」。 */
			const scopeLabel = (scope) => {
				if (scope === "common") return t("commonTitle");
				const row = roster.get(scope);
				return row?.name === void 0 || row.name.length === 0 ? scope : `${scope} · ${row.name}`;
			};
			/** 一节：标题 + 徽标 + 当前作用域的内容（key 带 scope → 切作用域时强制重挂载）。 */
			const sectionOf = (key, title, hint, badges, body) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Section, {
				title,
				hint,
				badges,
				open: closed[key] !== true,
				onToggle: () => {
					setClosed((value) => ({
						...value,
						[key]: !value[key]
					}));
				},
				collapseLabel: t("collapse"),
				expandLabel: t("expand"),
				children: body
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { padding: "6px 0" },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							color: "var(--dsw-text-secondary, #888)",
							fontSize: "0.9em",
							marginBottom: 10
						},
						children: [
							t("title"),
							" · ",
							t("subtitle"),
							" — ",
							t("root"),
							": ",
							state.root ?? "—"
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							...groupLabelStyle,
							marginBottom: 2
						},
						children: t("scopeLabel")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: chipsRowStyle,
						children: scopes.map((scope) => {
							const overridden = hasBucket(scope);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								title: overridden ? t("badgeOverridden") : t("badgeInherit"),
								style: scope === current ? chipActiveStyle : chipStyle,
								onClick: () => {
									setActiveScope(scope);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { opacity: overridden ? 1 : .4 },
									children: overridden ? "●" : "○"
								}), scopeLabel(scope)]
							}, `chip:${scope}`);
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							...hintStyle,
							marginBottom: 10
						},
						children: current === "common" ? t("commonHint") : `${t("presetHint")} · ${t("applyTo")}: ${scopeLabel(current)}`
					}),
					state.mounted ? sectionOf("preinject", t("preinjectTitle"), t("preinjectHint"), [state.presets?.[current] !== void 0 ? t("badgeOverridden") : t("badgeInherit")], /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ScopePanel, {
						t,
						scope: current,
						bucket: state.presets?.[current],
						effective: state.effective?.[current],
						files: state.files?.[current],
						onSaved: load
					}, `preinject:${current}`)) : null,
					datas !== void 0 && datas.mounted ? sectionOf("datas", t("datasTitle"), t("datasHint"), [datas.presets[current]?.enabled ?? datas.effective[current]?.enabled ?? false ? t("on") : t("off"), datas.presets[current] !== void 0 ? t("badgeOverridden") : t("badgeInherit")], /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DatasPanel, {
						t,
						scope: current,
						bucket: datas.presets[current],
						effective: datas.effective[current],
						defaults: datas.defaults ?? {
							enabled: false,
							dbPath: "",
							autoinject: {
								rounds: true,
								every: 8,
								afterTool: true,
								minGap: 4
							}
						},
						onSaved: load
					}, `datas:${current}`)) : null,
					memory !== void 0 && memory.mounted ? sectionOf("memory", t("memoryTitle"), t("memoryHint"), [memory.presets[current]?.enabled ?? memory.effective[current]?.enabled ?? false ? t("on") : t("off"), memory.presets[current] !== void 0 ? t("badgeOverridden") : t("badgeInherit")], /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MemoryPanel, {
						t,
						scope: current,
						bucket: memory.presets[current],
						effective: memory.effective[current],
						defaults: memory.defaults ?? {
							enabled: false,
							dbPath: "",
							owner: "dev",
							dream: {
								enabled: true,
								intervalMs: 144e5,
								batch: 20,
								provider: "",
								model: "",
								preset: "",
								cwd: ""
							}
						},
						dream: memory.dream ?? {
							running: false,
							started: false,
							config: null,
							last: null
						},
						onSaved: load
					}, `memory:${current}`)) : null
				]
			});
		}
		/**
		* 注册设置页。
		* @param ctx - 浏览器插件上下文。
		*/
		function apply(ctx) {
			const slots = ctx.slots;
			const locale = ctx.locale;
			try {
				ctx.effect(() => locale.register(NS, {
					zh,
					en
				}), "roroko-tool: 文案");
				slots.inject("settings.section", () => slots.register({
					name: "settings.section",
					id: "roroko-tool",
					order: 50,
					label: () => "洛洛可",
					locale: NS
				}, RorokoSettingsPage));
			} catch (error) {
				console.error("[roroko-tool] 设置页注册失败：", error);
			}
		}
		//#endregion
		exports.NS = NS;
		exports.RorokoIcon = RorokoIcon;
		exports.RorokoSettingsPage = RorokoSettingsPage;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
