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
		* dsh-roroko-tool client — 洛洛可全家桶设置页(纯 UI 壳 + 四持久化开关)。
		*
		* 在 WebGUI 设置侧边栏注册「Roroko Tool」导航项,页内渲染四个工具的
		* enabled 开关(preinject / data / warn / mark)。
		*
		* 读写不走官方 settingsScope(远程浏览器写 memory no-op),改经同源 fetch
		* 打 host 挂的 HTTP route:
		*   GET  /roroko-tool/state  → 读四开关
		*   POST /roroko-tool/state  → { tool, enabled } 写单开关,以 server 返回为准
		* UI 状态本地 useState。参照 dshmarket client 范式(api() 锚定 baseURI)。
		*/
		const name = "roroko-tool";
		const inject = ["slots", "locale"];
		/** 四工具元数据:id 须匹配 host 工具键。 */
		const TOOLS = [
			{
				id: "preinject",
				title: "指令预注入",
				desc: "会话开始时注入一次性工作区指令 (preinject)"
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
		/** 设置页内容:加载 host state,渲染四开关。 */
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
			const enabledOf = (tool) => state?.[tool.id]?.enabled ?? false;
			return (0, react.createElement)("div", { style: { padding: "6px 0" } }, (0, react.createElement)("div", { style: {
				color: "var(--dsw-text-secondary, #888)",
				fontSize: "0.9em",
				marginBottom: 12
			} }, "洛洛可全家桶插件电箱 — 关闭某工具即熄火;状态存服务器 profile。"), state === null ? (0, react.createElement)("div", { style: {
				color: "var(--dsw-text-secondary, #888)",
				fontSize: "0.9em"
			} }, error === null ? "加载中…" : `加载失败: ${error}`) : (0, react.createElement)("div", {}, ...TOOLS.map((tool) => (0, react.createElement)("div", {
				key: tool.id,
				style: { marginTop: 6 }
			}, (0, react.createElement)(ToolRow, {
				tool,
				enabled: enabledOf(tool),
				busy: busy && busyTool === tool.id,
				onToggle: (next) => {
					toggle(tool.id, next);
				}
			}))), error !== null ? (0, react.createElement)("div", { style: {
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