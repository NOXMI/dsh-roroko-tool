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
		* dsh-roroko-tool client — 洛洛可全家桶设置页(电箱 + preinject 注入参数编辑)。
		*
		* 在 WebGUI 设置侧边栏注册「Roroko Tool」导航项,页内渲染四个工具的
		* enabled 开关(preinject / data / warn / mark);preinject 额外展开注入参数
		* 编辑器:文件清单动态增删、header/footer 包裹壳、是否 system-reminder 包裹。
		*
		* 读写不走官方 settingsScope(远程浏览器写 memory no-op),改经同源 fetch
		* 打 host 挂的 HTTP route:
		*   GET  /roroko-tool/state  → 读四开关 + preinject 配置
		*   POST /roroko-tool/state  → { tool, enabled } 写开关
		*                             → { tool:'preinject', files/header/footer/... } 写配置
		* UI 状态本地 useState。参照 dshmarket client 范式(api() 锚定 baseURI)。
		*/
		const name = "roroko-tool";
		const inject = ["slots", "locale"];
		/** 四工具元数据:id 须匹配 host 工具键。 */
		const TOOLS = [
			{
				id: "preinject",
				title: "指令预注入",
				desc: "会话开始一次性注入工作区指令 (preinject)"
			},
			{
				id: "data",
				title: "素材库工具",
				desc: "洛洛可素材库查询工具集 (data)"
			},
			{
				id: "warn",
				title: "超量收敛警告",
				desc: "工具调用/思考超量时注入收敛警告 (warn)"
			},
			{
				id: "mark",
				title: "呻吟标记扩展",
				desc: "-呻吟_X- 标记的渲染与处理 (mark)"
			}
		];
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
		const dangerButtonStyle = {
			...buttonStyle,
			borderColor: "var(--dsw-text-danger, #e5484d)",
			color: "var(--dsw-text-danger, #e5484d)"
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
		/** 单行开关:值来自 host state,拨动 POST 回写。 */
		function ToolRow(props) {
			const { tool, enabled, busy, onToggle } = props;
			return (0, react.createElement)("div", { style: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 16
			} }, (0, react.createElement)("div", {}, (0, react.createElement)("div", { style: { fontWeight: 600 } }, tool.title), (0, react.createElement)("div", { style: {
				color: "var(--dsw-text-secondary, #888)",
				fontSize: "0.9em",
				marginTop: 2
			} }, tool.desc)), (0, react.createElement)("label", {}, (0, react.createElement)("input", {
				type: "checkbox",
				checked: enabled,
				disabled: busy,
				onChange: () => {
					onToggle(!enabled);
				}
			})));
		}
		/** preinject 注入参数编辑面板:文件清单 + header/footer + wrap 包裹。 */
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
					enabled: config.enabled,
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
			return (0, react.createElement)("div", { style: {
				background: "var(--dsw-surface-secondary, rgba(128,128,128,.06))",
				borderRadius: 6,
				margin: "8px 0 4px",
				padding: "10px 12px"
			} }, (0, react.createElement)("div", { style: {
				fontWeight: 600,
				marginBottom: 8,
				fontSize: "0.9em"
			} }, "注入参数(存 state,会话开始注入时读取)"), (0, react.createElement)("div", { style: {
				fontSize: "0.85em",
				color: "var(--dsw-text-secondary, #888)",
				marginBottom: 8
			} }, "文件路径相对会话 cwd;缺失文件静默跳过。"), files.map((file, index) => (0, react.createElement)("div", {
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
					...dangerButtonStyle,
					flexShrink: 0
				},
				onClick: () => {
					removeFile(index);
				}
			}, "✕"))), (0, react.createElement)("div", { style: { marginTop: 4 } }, (0, react.createElement)("button", {
				type: "button",
				disabled: busy,
				style: buttonStyle,
				onClick: addFile
			}, "+ 添加文件")), (0, react.createElement)("label", { style: {
				display: "block",
				fontSize: "0.85em",
				marginBottom: 2,
				marginTop: 10,
				color: "var(--dsw-text-secondary, #888)"
			} }, "header(内容前插入)"), (0, react.createElement)("textarea", {
				value: header,
				disabled: busy,
				placeholder: "<roroko-reminder> …",
				style: textareaStyle,
				onChange: (event) => {
					setHeader(event.target.value);
					markDirty();
				}
			}), (0, react.createElement)("label", { style: {
				display: "block",
				fontSize: "0.85em",
				marginBottom: 2,
				marginTop: 8,
				color: "var(--dsw-text-secondary, #888)"
			} }, "footer(内容后插入)"), (0, react.createElement)("textarea", {
				value: footer,
				disabled: busy,
				placeholder: "… </roroko-reminder>",
				style: textareaStyle,
				onChange: (event) => {
					setFooter(event.target.value);
					markDirty();
				}
			}), (0, react.createElement)("label", { style: {
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
			}), "整体包一层 &lt;system-reminder&gt;…&lt;/system-reminder&gt;"), (0, react.createElement)("div", { style: {
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
			} }, "已保存") : null));
		}
		/** data 配置面板:数据库路径编辑(部分保存,enabled 随开关走)。 */
		function DataPanel(props) {
			const { config, busy, onSave } = props;
			const [dbPath, setDbPath] = (0, react.useState)(config.dbPath);
			const [dirty, setDirty] = (0, react.useState)(false);
			const [saved, setSaved] = (0, react.useState)(false);
			const save = () => {
				onSave({
					enabled: config.enabled,
					dbPath: dbPath.trim()
				});
				setDirty(false);
				setSaved(true);
			};
			return (0, react.createElement)("div", { style: {
				background: "var(--dsw-surface-secondary, rgba(128,128,128,.06))",
				borderRadius: 6,
				margin: "8px 0 4px",
				padding: "10px 12px"
			} }, (0, react.createElement)("div", { style: {
				fontWeight: 600,
				marginBottom: 8,
				fontSize: "0.9em"
			} }, "数据库路径(存 state,工具执行时读取)"), (0, react.createElement)("div", { style: {
				fontSize: "0.85em",
				color: "var(--dsw-text-secondary, #888)",
				marginBottom: 8
			} }, "soul.db 绝对路径,默认服务器 /var/www/api/database/soul.db。"), (0, react.createElement)("input", {
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
			}), (0, react.createElement)("div", { style: {
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
			} }, "已保存") : null));
		}
		/** 设置页内容:加载 host state,渲染四开关(preinject/data 带配置面板)。 */
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
			const toggle = async (tool, next) => {
				if (busy) return;
				setBusy(true);
				setBusyTool(tool);
				setError(null);
				try {
					const response = await fetch(api("/roroko-tool/state"), {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							tool,
							enabled: next
						})
					});
					const body = await response.json();
					if (!response.ok || body.ok !== true || body.state === void 0) {
						setError(body.error ?? `failed to toggle ${tool} (HTTP ${response.status})`);
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
							enabled: next.enabled,
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
			const enabledOf = (tool) => state?.[tool.id]?.enabled ?? false;
			const preinjectConfig = () => state?.preinject ?? null;
			const dataConfig = () => state?.data ?? null;
			return (0, react.createElement)("div", { style: { padding: "6px 0" } }, (0, react.createElement)("div", { style: {
				color: "var(--dsw-text-secondary, #888)",
				fontSize: "0.9em",
				marginBottom: 12
			} }, "洛洛可全家桶插件电箱 — 关闭某工具即熄火;状态存服务器 profile。"), state === null ? (0, react.createElement)("div", { style: {
				color: "var(--dsw-text-secondary, #888)",
				fontSize: "0.9em"
			} }, error === null ? "加载中…" : `加载失败: ${error}`) : (0, react.createElement)("div", {}, ...TOOLS.map((tool) => {
				const preinjectCfg = tool.id === "preinject" ? preinjectConfig() : null;
				const dataCfg = tool.id === "data" ? dataConfig() : null;
				return (0, react.createElement)("div", {
					key: tool.id,
					style: { marginTop: 6 }
				}, (0, react.createElement)(ToolRow, {
					tool,
					enabled: enabledOf(tool),
					busy: busy && busyTool === tool.id,
					onToggle: (next) => {
						toggle(tool.id, next);
					}
				}), tool.id === "preinject" && preinjectCfg !== null ? (0, react.createElement)(PreinjectPanel, {
					config: preinjectCfg,
					busy: busy && busyTool === "preinject",
					onSave: (next) => {
						savePreinject(next);
					}
				}) : null, tool.id === "data" && dataCfg !== null ? (0, react.createElement)(DataPanel, {
					config: dataCfg,
					busy: busy && busyTool === "data",
					onSave: (next) => {
						saveData(next);
					}
				}) : null);
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