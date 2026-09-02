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
		* dsh-roroko-tool client — 洛洛可全家桶设置页。
		*
		* 注册一个 settings.section entry,在 WebGUI 设置侧边栏长出
		* 「Roroko Tool」导航项。参照 dsh-market 独立插件 client 范式:
		* ctx.slots.inject('settings.section', ...) + locale 双语注册 +
		* createElement as h(免 JSX 转换)。
		*
		* 本页当前为最小验证壳:显示包名与占位信息。后续子插件
		* (preinject / data / warn)的开关与配置面板在此聚合。
		*/
		const name = "roroko-tool";
		const inject = ["slots", "locale"];
		/** 设置页内容组件(纯 div 布局,placeholder 验证用)。 */
		function RorokoToolSection(_props) {
			return (0, react.createElement)("div", { style: { padding: "6px 0" } }, (0, react.createElement)("div", { style: { fontWeight: 600 } }, "Roroko Tool"), (0, react.createElement)("div", { style: {
				color: "var(--dsw-text-secondary, #888)",
				fontSize: "0.9em",
				marginTop: 4
			} }, "洛洛可全家桶插件设置页(骨架验证壳)。"), (0, react.createElement)("div", { style: {
				marginTop: 16,
				padding: "10px 12px",
				background: "var(--dsw-surface-secondary, rgba(128,128,128,.08))",
				borderRadius: 6,
				fontSize: "0.92em"
			} }, "version 0.0.0 — 子插件面板待接入"));
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
			}, (ownerProps = { close: () => {} }) => (0, react.createElement)(RorokoToolSection, ownerProps)));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map