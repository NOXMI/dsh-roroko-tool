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
			desc: "洛洛可全家桶插件设置。子插件(preinject / data / warn)面板将在此聚合。",
			placeholder: "version 0.0.0 — 骨架占位，子插件面板待接入"
		};
		const en = {
			nav: "Roroko Tool",
			title: "Roroko Tool",
			desc: "Roroko family plugin settings. Sub-plugin panels (preinject / data / warn) will aggregate here.",
			placeholder: "version 0.0.0 — skeleton stub, sub-plugin panels pending"
		};
		const NS = "roroko-tool";
		//#endregion
		//#region src/client/index.ts
		/**
		* dsh-roroko-tool client — 洛洛可全家桶设置页(纯电箱)。
		*
		* 在 WebGUI 设置侧边栏注册「Roroko Tool」导航项,页内渲染四个工具的
		* enabled 开关:preinject / data / warn / mark。
		*
		* 值与 host 侧 settings 命名空间 `roroko-tool`(settings.ts 注册)双向同步:
		*   - 读:scope.getSnapshot().value?.[tool]?.enabled(默认 true)
		*   - 写:scope.mutate([{ op:'set', path:[tool,'enabled'], value }])
		* 走深路径写,不整段覆盖——未来某工具在 enabled 旁扩展自己的参数时,
		* 别的开关不受影响。
		*
		* 参照范式:官方 ui-conversation RorokoSection.tsx(settingsScope.bind +
		* useSyncExternalStore + 原生 checkbox)。类型全部本地结构声明,零外部
		* 类型依赖(loader 只认 react / ui-primitives 两个 external)。
		*/
		const name = "roroko-tool";
		const inject = [
			"slots",
			"locale",
			"settingsScope"
		];
		/** 四个工具的静态元数据:id 须匹配 host schema 键。 */
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
		/** 单行开关:读 scope 对应工具的 enabled,拨动时写深路径。 */
		function ToolRow(props) {
			const { tool, scope } = props;
			const enabled = (0, react.useSyncExternalStore)((onStoreChange) => scope === void 0 ? () => {} : scope.subscribe(onStoreChange), () => scope?.getSnapshot().value?.[tool.id]?.enabled ?? true);
			const disabled = scope === void 0;
			const toggle = () => {
				if (scope === void 0) return;
				scope.mutate([{
					op: "set",
					path: [tool.id, "enabled"],
					value: !enabled
				}]);
			};
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
				disabled,
				onChange: toggle
			})));
		}
		/** 设置页内容:四工具开关纵列。 */
		function RorokoToolSection(props) {
			const { scope } = props;
			return (0, react.createElement)("div", { style: { padding: "6px 0" } }, (0, react.createElement)("div", { style: {
				color: "var(--dsw-text-secondary, #888)",
				fontSize: "0.9em",
				marginBottom: 12
			} }, "洛洛可全家桶插件电箱 — 关闭某工具即熄火,接线(preset 声明)照常。"), ...TOOLS.map((tool) => (0, react.createElement)("div", {
				key: tool.id,
				style: { marginTop: 6 }
			}, (0, react.createElement)(ToolRow, {
				tool,
				scope
			}))), scope === void 0 ? (0, react.createElement)("div", { style: {
				marginTop: 12,
				padding: "10px 12px",
				background: "var(--dsw-surface-secondary, rgba(128,128,128,.08))",
				borderRadius: 6,
				fontSize: "0.85em",
				color: "var(--dsw-text-secondary, #888)"
			} }, "settings 服务不可用,开关暂被禁用。") : null);
		}
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "roroko-tool: dictionaries");
			const t = ctx.locale.bind(NS);
			const scope = ctx.settingsScope.bind({ namespace: "roroko-tool" });
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "roroko-tool",
				order: 30,
				label: () => t("nav"),
				locale: NS,
				inject: () => ({ scope })
			}, RorokoToolSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map