window.__ModuleLoader__.load({
	id: "@roroko-tool/dsh-roroko-tool",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/locales.ts
		/** dsh-roroko-tool client 词典:zh / en。结构对齐 dsh-market:src/client/locales.ts。 */
		const zh = {
			nav: "Roroko Tool",
			title: "Roroko Tool",
			desc: "洛洛可全家桶插件电箱:四工具的独立 enabled 开关。"
		};
		const en = {
			nav: "Roroko Tool",
			title: "Roroko Tool",
			desc: "Roroko family plugin switchboard: per-tool enabled toggles."
		};
		const NS = "roroko-tool";
		//#endregion
		//#region src/client/index.ts
		/**
		* dsh-roroko-tool client — 洛洛可全家桶子插件参数设置页。
		*
		* 在 WebGUI 设置侧边栏注册「Roroko Tool」导航项。页面不再有工具启用开关
		* (2026-09-03 三改:四工具 enabled 运行级开关退役——preset 声明即启用,
		* agent preset 在 agent.cordis.yml 里引用哪个子插件,装配就带哪个功能)。
		* 页面只编辑各子插件的参数覆盖:preinject 的注入文件清单/包裹壳/是否
		* system-reminder 包裹,roroko-data 的数据库路径。
		*
		* 读写不走官方 settingsScope(远程浏览器写 memory no-op),改经同源 fetch
		* 打 host 挂的 HTTP route:
		*   GET  /roroko-tool/state  → 读各节参数(state 文件内容)
		*   POST /roroko-tool/state  → { tool:'preinject', files/header/footer/... } 写参数
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
		/** preinject 注入参数编辑器:文件清单 + header/footer + wrap 包裹。 */
		function PreinjectPanel(props) {
			const { config, busy, onSave } = props;
			const [files, setFiles] = (0, react.useState)(config.files);
			const [header, setHeader] = (0, react.useState)(config.header);
			const [footer, setFooter] = (0, react.useState)(config.footer);
			const [wrap, setWrap] = (0, react.useState)(config.wrapInSystemReminder);
			const [dirty, setDirty] = (0, react.useState)(false);
			const [saved, setSaved] = (0, react.useState)(false);
			const markDirty = () => {
				setDirty(true);
				setSaved(false);
			};
			const updateFile = (index, value) => {
				setFiles((prev) => prev.map((item, i) => i === index ? value : item));
				markDirty();
			};
			const addFile = () => {
				setFiles((prev) => [...prev, ""]);
				markDirty();
			};
			const removeFile = (index) => {
				setFiles((prev) => prev.filter((_, i) => i !== index));
				markDirty();
			};
			const save = () => {
				const next = {
					files: files.map((item) => item.trim()).filter((item) => item.length > 0).filter((item, index, self) => self.indexOf(item) === index),
					header: header.trim(),
					footer: footer.trim(),
					wrapInSystemReminder: wrap
				};
				onSave(next);
				setDirty(false);
				setSaved(true);
			};
			const textareaStyle = {
				...inputStyle,
				minHeight: 56,
				resize: "vertical"
			};
			return (0, react.createElement)(PanelShell, { children: [
				(0, react.createElement)("div", { style: {
					fontWeight: 600,
					marginBottom: 8,
					fontSize: "0.9em"
				} }, "注入参数(存 state,会话开始注入时读取)"),
				(0, react.createElement)("div", { style: {
					fontSize: "0.85em",
					color: "var(--dsw-text-secondary, #888)",
					marginBottom: 8
				} }, "文件路径相对会话 cwd;缺失文件静默跳过。"),
				...files.map((file, index) => (0, react.createElement)("div", {
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
					placeholder: "如 AGENTS.md",
					style: inputStyle,
					onChange: (event) => {
						updateFile(index, event.target.value);
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
						removeFile(index);
					}
				}, "✕"))),
				(0, react.createElement)("div", { style: { marginTop: 4 } }, (0, react.createElement)("button", {
					type: "button",
					disabled: busy,
					style: buttonStyle,
					onClick: addFile
				}, "+ 添加文件")),
				(0, react.createElement)("label", { style: {
					display: "block",
					fontSize: "0.85em",
					marginBottom: 2,
					marginTop: 10,
					color: "var(--dsw-text-secondary, #888)"
				} }, "header(内容前插入)"),
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
				(0, react.createElement)("label", { style: {
					display: "block",
					fontSize: "0.85em",
					marginBottom: 2,
					marginTop: 8,
					color: "var(--dsw-text-secondary, #888)"
				} }, "footer(内容后插入)"),
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
					marginTop: 10
				} }, (0, react.createElement)("button", {
					type: "button",
					disabled: busy || !dirty,
					style: {
						...buttonStyle,
						borderColor: dirty ? "var(--dsw-text-primary, #eee)" : void 0,
						color: dirty ? "var(--dsw-text-primary, #eee)" : void 0
					},
					onClick: save
				}, "保存注入参数"), saved && !dirty ? (0, react.createElement)("span", { style: {
					fontSize: "0.8em",
					color: "var(--dsw-text-success, #46a758)"
				} }, "已保存") : null)
			] });
		}
		/** data 参数面板:数据库路径编辑。 */
		function DataPanel(props) {
			const { config, busy, onSave } = props;
			const [dbPath, setDbPath] = (0, react.useState)(config.dbPath);
			const [dirty, setDirty] = (0, react.useState)(false);
			const [saved, setSaved] = (0, react.useState)(false);
			const save = () => {
				onSave({ dbPath: dbPath.trim() });
				setDirty(false);
				setSaved(true);
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
					marginTop: 10
				} }, (0, react.createElement)("button", {
					type: "button",
					disabled: busy || !dirty,
					style: {
						...buttonStyle,
						borderColor: dirty ? "var(--dsw-text-primary, #eee)" : void 0,
						color: dirty ? "var(--dsw-text-primary, #eee)" : void 0
					},
					onClick: save
				}, "保存路径"), saved && !dirty ? (0, react.createElement)("span", { style: {
					fontSize: "0.8em",
					color: "var(--dsw-text-success, #46a758)"
				} }, "已保存") : null)
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
				(async () => {
					try {
						const body = await (await fetch(api("/roroko-tool/state"), { cache: "no-store" })).json();
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
				if (busy) return;
				setBusy(true);
				setBusyTool("preinject");
				setError(null);
				try {
					const response = await fetch(api("/roroko-tool/state"), {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							tool: "preinject",
							files: next.files,
							header: next.header,
							footer: next.footer,
							wrapInSystemReminder: next.wrapInSystemReminder
						})
					});
					const body = await response.json();
					if (!response.ok || body.ok !== true || body.state === void 0) {
						setError(body.error ?? `failed to save preinject config (HTTP ${response.status})`);
						return;
					}
					setState(body.state);
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setBusy(false);
					setBusyTool(null);
				}
			};
			const saveData = async (next) => {
				if (busy) return;
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
						setError(body.error ?? `failed to save data config (HTTP ${response.status})`);
						return;
					}
					setState(body.state);
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
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
				desc: "会话开始一次性注入工作区指令;preset 声明即启用。"
			}), (0, react.createElement)(PreinjectPanel, {
				config: state.preinject,
				busy: busy && busyTool === "preinject",
				onSave: (next) => {
					savePreinject(next);
				}
			}), (0, react.createElement)(ToolHeader, {
				title: "素材库工具 (roroko-data)",
				desc: "洛洛可素材库查询/注册 + soul_state 读写;preset 声明即启用。"
			}), (0, react.createElement)(DataPanel, {
				config: state.data,
				busy: busy && busyTool === "data",
				onSave: (next) => {
					saveData(next);
				}
			}), (0, react.createElement)(ToolHeader, {
				title: "超量收敛警告 (roroko-warn)",
				desc: "工具调用/思考超量时注入收敛警告(未实现)。"
			}), (0, react.createElement)(ToolHeader, {
				title: "呻吟标记扩展 (roroko-mark)",
				desc: "-呻吟_X- 标记的渲染与处理(未实现)。"
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