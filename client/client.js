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
			subtitle: "预注入参数",
			loading: "加载中…",
			failed: "加载失败",
			version: "版本",
			refresh: "刷新",
			notMounted: "没有挂载 preinject",
			notMountedHint: "preset 里没声明 config.preinject 桶，这个页面无事可做",
			root: "身份根",
			commonTitle: "公共默认",
			commonHint: "没写覆盖的 preset 都吃这一层，也是每个 preset 的基线。",
			presetHint: "会话 header.agentPreset 等于这个 id 时，这一层叠在公共默认之上。",
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
			datasTitle: "素材库",
			datasHint: "roroko_datas_* 四把工具连哪个库，以及 state 短条多久自动注一次。",
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
			off: "关"
		};
		/** English copy, same keys. */
		const en = {
			title: "roroko-tool",
			subtitle: "Pre-injection parameters",
			loading: "Loading…",
			failed: "Failed to load",
			version: "Version",
			refresh: "Refresh",
			notMounted: "preinject is not mounted",
			notMountedHint: "No config.preinject bucket in this preset, nothing to configure here",
			root: "Root",
			commonTitle: "Common default",
			commonHint: "Every preset without overrides reads this layer; it is the baseline.",
			presetHint: "Applied on top of the common default when the session header carries this preset id.",
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
			datasTitle: "Material library",
			datasHint: "Which database the roroko_datas_* tools open, and how often the state digest is injected.",
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
			off: "off"
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
		/** 工具卡片头：标题 + 一句说明。 */
		function ToolHeader(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { margin: "14px 0 4px" },
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: { fontWeight: 600 },
					children: props.title
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: hintStyle,
					children: props.desc
				})]
			});
		}
		/** 可折叠卡片：标题一行，点开才渲染内容。 */
		function ScopeCard(props) {
			const [open, setOpen] = (0, react.useState)(props.defaultOpen);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: cardStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						style: cardHeadStyle,
						onClick: () => {
							setOpen((value) => !value);
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: { fontWeight: 600 },
							children: [
								open ? "▾" : "▸",
								" ",
								props.title
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: badgeStyle,
							children: props.badge
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: hintStyle,
						children: props.hint
					}),
					open ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
					dbPath: coverPath ? dbPath.trim() : null,
					autoinject: coverAuto ? auto : null
				});
			};
			const busy = saving;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(PanelShell, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolHeader, {
					title: t("datasTitle"),
					desc: t("datasHint")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					style: coverLabelStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						checked: coverPath,
						disabled: busy,
						onChange: () => {
							setCoverPath((value) => !value);
							setSaved(false);
						}
					}), t("coverDbPath")]
				}),
				coverPath ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type: "text",
					value: dbPath,
					disabled: busy,
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
					style: coverLabelStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						checked: coverAuto,
						disabled: busy,
						onChange: () => {
							setCoverAuto((value) => !value);
							setSaved(false);
						}
					}), t("coverAutoinject")]
				}),
				coverAuto ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AutoinjectEditor, {
					value: auto,
					busy,
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
		* 设置页主体。
		* @param props - 页签所有者传入的属性。
		* @returns 设置页元素。
		*/ function RorokoSettingsPage(props) {
			const { t } = props;
			const [state, setState] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
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
			if (!state.mounted && state.datas?.mounted !== true) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { padding: "6px 0" },
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						color: "var(--dsw-text-secondary, #888)",
						fontSize: "0.9em",
						marginBottom: 12
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
				}), scopes.map((scope) => {
					const bucket = state.presets?.[scope];
					const isCommon = scope === "common";
					const row = roster.get(scope);
					const badge = isCommon ? t("badgeBaseline") : row?.broken !== void 0 ? t("badgeBroken") : bucket === void 0 ? t("badgeInherit") : t("badgeOverridden");
					const title = isCommon ? t("commonTitle") : row?.name === void 0 || row.name.length === 0 ? scope : `${scope} · ${row.name}`;
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ScopeCard, {
						title,
						hint: isCommon ? t("commonHint") : t("presetHint"),
						badge,
						defaultOpen: isCommon,
						children: [state.mounted ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ScopePanel, {
							t,
							scope,
							bucket,
							effective: state.effective?.[scope],
							files: state.files?.[scope],
							onSaved: load
						}) : null, state.datas?.mounted ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DatasPanel, {
							t,
							scope,
							bucket: state.datas.presets[scope],
							effective: state.datas.effective[scope],
							defaults: state.datas.defaults,
							onSaved: load
						}) : null]
					}, `${scope}:${JSON.stringify(bucket ?? {})}`);
				})]
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
