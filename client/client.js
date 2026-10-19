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
			subtitle: "插件运行状态与注入开关",
			loading: "插件插入中…",
			failed: "读取失败",
			version: "版本",
			mounts: "已挂载子模块",
			none: "没有子模块在运行（preset 里未声明 config 桶）",
			root: "身份根目录",
			identityFiles: "身份文件",
			workspaceFiles: "工作区文件",
			includeWorkspace: "系统段拼工作区",
			injected: "已注入会话",
			injectedFile: "记录文件",
			reset: "清空注入记录",
			resetDone: "已清空，下次会话会重新注入",
			resetFailed: "清空失败",
			refresh: "刷新",
			on: "开",
			off: "关"
		};
		/** English copy, same keys. */
		const en = {
			title: "roroko-tool",
			subtitle: "Runtime status and injection switches",
			loading: "Loading…",
			failed: "Failed to load",
			version: "Version",
			mounts: "Mounted submodules",
			none: "No submodule is mounted (no config bucket in this preset)",
			root: "Identity root",
			identityFiles: "Identity files",
			workspaceFiles: "Workspace files",
			includeWorkspace: "Workspace in system prompt",
			injected: "Sessions injected",
			injectedFile: "Record file",
			reset: "Clear injection record",
			resetDone: "Cleared — the next session injects again",
			resetFailed: "Clear failed",
			refresh: "Refresh",
			on: "on",
			off: "off"
		};
		//#endregion
		//#region src/client/index.tsx
		/**
		* 洛洛可设置页（浏览器半侧）。
		*
		* 挂进 Plugins 页的 `plugins.tab`：一个自绘的「洛洛可」页签，读
		* GET /roroko-tool/state 展示子模块挂载情况，并提供清空注入记录的按钮。
		* 不依赖 configForms —— 数据走宿主自己的 HTTP 路由，改动最小。
		*/
		/** 文案命名空间。 */
		const NS = "rorokoTool";
		/** 需要的客户端服务。 */
		const inject = ["slots", "locale"];
		/**
		* 左栏一级图标。
		* @param props - 尺寸与激活态。
		* @returns 图标元素。
		*/
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
		const box = {
			display: "flex",
			flexDirection: "column",
			gap: "14px",
			padding: "4px 2px",
			fontSize: "13px",
			lineHeight: 1.6
		};
		const row = {
			display: "grid",
			gridTemplateColumns: "104px 1fr",
			gap: "10px",
			alignItems: "baseline"
		};
		const label = { opacity: .6 };
		const mono = {
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
			fontSize: "12px"
		};
		const card = {
			border: "1px solid color-mix(in srgb, currentColor 14%, transparent)",
			borderRadius: "10px",
			padding: "12px 14px",
			display: "flex",
			flexDirection: "column",
			gap: "6px"
		};
		const button = {
			alignSelf: "flex-start",
			marginTop: "4px",
			padding: "6px 12px",
			borderRadius: "8px",
			border: "1px solid color-mix(in srgb, currentColor 22%, transparent)",
			background: "transparent",
			color: "inherit",
			cursor: "pointer",
			fontSize: "12px"
		};
		function Field({ name, value }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: row,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: label,
					children: name
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: mono,
					children: value
				})]
			});
		}
		/**
		* 设置页主体。
		* @param props - 页签所有者传入的属性（本页不使用）。
		* @returns 设置页元素。
		*/
		function RorokoSettingsPage(props) {
			const { t } = props;
			const [state, setState] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [note, setNote] = (0, react.useState)(null);
			const load = (0, react.useCallback)(async () => {
				setError(null);
				try {
					const response = await fetch("/roroko-tool/state", { credentials: "same-origin" });
					if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
					setState(await response.json());
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				}
			}, []);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			const reset = (0, react.useCallback)(async () => {
				setNote(null);
				try {
					const body = await (await fetch("/roroko-tool/reset", {
						method: "POST",
						credentials: "same-origin"
					})).json();
					setNote(body.ok === true ? t("resetDone") : t("resetFailed"));
					await load();
				} catch {
					setNote(t("resetFailed"));
				}
			}, [load, t]);
			if (error !== null) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: box,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: label,
					children: [
						t("failed"),
						": ",
						error
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					style: button,
					onClick: () => {
						load();
					},
					children: t("refresh")
				})]
			});
			if (state === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: box,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: label,
					children: t("loading")
				})
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: box,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: "15px",
							fontWeight: 600
						},
						children: t("title")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: label,
						children: [
							t("subtitle"),
							" · ",
							t("version"),
							" ",
							state.version
						]
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: card,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: { fontWeight: 600 },
							children: t("mounts")
						}), state.mounts.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: label,
							children: t("none")
						}) : state.mounts.map((mount, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: "4px"
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
									name: t("root"),
									value: mount.root
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
									name: t("identityFiles"),
									value: mount.identityFiles.join(", ")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
									name: t("workspaceFiles"),
									value: mount.workspaceFiles.join(", ")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
									name: t("includeWorkspace"),
									value: mount.includeWorkspace ? t("on") : t("off")
								})
							]
						}, `${mount.root}-${String(index)}`))]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: card,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: { fontWeight: 600 },
								children: [
									t("injected"),
									" · ",
									String(state.injected.length)
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
								name: t("injectedFile"),
								value: state.injectedFile ?? "—"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								style: button,
								onClick: () => {
									reset();
								},
								children: t("reset")
							}),
							note === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: label,
								children: note
							})
						]
					})
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
