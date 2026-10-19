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
			subtitle: "两段注入清单",
			loading: "插件插入中…",
			failed: "读取失败",
			version: "版本",
			refresh: "刷新",
			on: "开",
			off: "关",
			notMounted: "没有挂载 preinject",
			notMountedHint: "preset 里没声明 config.preinject 桶，这个页面无事可做",
			root: "身份根",
			configFile: "清单文件",
			injectedFile: "记录文件",
			injectedCount: "已注入会话",
			injectedEmpty: "还没有会话被标记",
			reset: "清空注入记录",
			resetDone: "已清空，下次会话会重新注入",
			resetFailed: "清空失败",
			systemTitle: "系统层",
			systemHint: "按顺序拼进系统提示词，常驻，不占消息位。",
			userTitle: "用户层",
			userHint: "按顺序拼成一条 user 消息，追加在用户消息之后，每会话一次。",
			files: "文件清单",
			filesHint: "一行一个文件名或路径，相对身份根；留空 = 不注入",
			missing: "缺失",
			present: "就绪",
			emptyFiles: "清单是空的",
			wrap: "包 system-reminder",
			wrapHint: "只作用于用户层",
			save: "保存",
			saved: "清单已写入，下一步装配就生效",
			saveFailed: "保存失败"
		};
		/** English copy, same keys. */
		const en = {
			title: "roroko-tool",
			subtitle: "Two injection lists",
			loading: "Loading…",
			failed: "Failed to load",
			version: "Version",
			refresh: "Refresh",
			on: "on",
			off: "off",
			notMounted: "preinject is not mounted",
			notMountedHint: "No config.preinject bucket in this preset, nothing to configure here",
			root: "Root",
			configFile: "List file",
			injectedFile: "Record file",
			injectedCount: "Sessions injected",
			injectedEmpty: "No session marked yet",
			reset: "Clear injection record",
			resetDone: "Cleared — the next session injects again",
			resetFailed: "Clear failed",
			systemTitle: "System layer",
			systemHint: "Joined in order into the system prompt; resident, no message slot.",
			userTitle: "User layer",
			userHint: "Joined into one user message appended after the user messages, once per session.",
			files: "Files",
			filesHint: "One file name or path per line, relative to root; empty means nothing is injected",
			missing: "missing",
			present: "ready",
			emptyFiles: "Empty list",
			wrap: "Wrap in system-reminder",
			wrapHint: "User layer only",
			save: "Save",
			saved: "Lists written, effective on the next assembly",
			saveFailed: "Save failed"
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
		* 整份写清单（全量替换）。
		* @param config - 两张清单 + wrap。
		* @returns 宿主回执。
		*/
		function saveConfig(config) {
			return request("/roroko-tool/config", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(config)
			});
		}
		/** 清空跳闸记录。 */
		function resetInjected() {
			return request("/roroko-tool/reset", { method: "POST" });
		}
		//#endregion
		//#region src/client/index.tsx
		/**
		* 洛洛可设置页（浏览器半侧）。
		*
		* 挂进设置面板的 `settings.section`：两张清单，一块拼进系统层，一块拼进用户层。
		* 保存即写 `<root>/state/preinject.json`，preinject 的 provider 每次装配现读，
		* 改完下一步就生效。
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
		const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";
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
			gridTemplateColumns: "112px 1fr",
			gap: "10px",
			alignItems: "baseline"
		};
		const label = { opacity: .6 };
		const dim = {
			opacity: .55,
			fontSize: "12px"
		};
		const code = {
			fontFamily: mono,
			fontSize: "12px",
			wordBreak: "break-all"
		};
		const card = {
			border: "1px solid color-mix(in srgb, currentColor 14%, transparent)",
			borderRadius: "10px",
			padding: "12px 14px",
			display: "flex",
			flexDirection: "column",
			gap: "8px"
		};
		const input = {
			width: "100%",
			boxSizing: "border-box",
			fontFamily: mono,
			fontSize: "12px",
			lineHeight: 1.6,
			padding: "7px 10px",
			borderRadius: "8px",
			border: "1px solid color-mix(in srgb, currentColor 18%, transparent)",
			background: "color-mix(in srgb, currentColor 4%, transparent)",
			color: "inherit",
			resize: "vertical"
		};
		const button = (disabled = false) => ({
			padding: "6px 12px",
			borderRadius: "8px",
			border: "1px solid color-mix(in srgb, currentColor 22%, transparent)",
			background: "transparent",
			color: "inherit",
			cursor: disabled ? "default" : "pointer",
			opacity: disabled ? .45 : 1,
			fontSize: "12px"
		});
		function Field({ name, value }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: row,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: label,
					children: name
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: code,
					children: value
				})]
			});
		}
		/** 清单文本 → 文件名数组（一行一个，去掉空行）。 */
		function splitLines(text) {
			return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
		}
		function formatBytes(bytes) {
			return bytes < 1024 ? `${String(bytes)} B` : `${(bytes / 1024).toFixed(1)} KB`;
		}
		/**
		* 设置页主体。
		* @param props - 页签所有者传入的属性。
		* @returns 设置页元素。
		*/
		function RorokoSettingsPage(props) {
			const { t } = props;
			const [state, setState] = (0, react.useState)(null);
			const [draft, setDraft] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [note, setNote] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const load = (0, react.useCallback)(async () => {
				setError(null);
				try {
					const body = await fetchState();
					setState(body);
					const config = body.config;
					setDraft(config === void 0 ? null : {
						systemFiles: config.systemFiles.join("\n"),
						userFiles: config.userFiles.join("\n"),
						wrap: config.wrap
					});
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				}
			}, []);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			const save = (0, react.useCallback)(async () => {
				if (draft === null) return;
				setBusy(true);
				setNote(null);
				try {
					const ack = await saveConfig({
						systemFiles: splitLines(draft.systemFiles),
						userFiles: splitLines(draft.userFiles),
						wrap: draft.wrap
					});
					setNote(ack.ok ? t("saved") : `${t("saveFailed")}: ${ack.reason ?? ""}`);
					await load();
				} catch (cause) {
					setNote(`${t("saveFailed")}: ${cause instanceof Error ? cause.message : String(cause)}`);
				} finally {
					setBusy(false);
				}
			}, [
				draft,
				load,
				t
			]);
			const reset = (0, react.useCallback)(async () => {
				setNote(null);
				try {
					const ack = await resetInjected();
					setNote(ack.ok ? t("resetDone") : t("resetFailed"));
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
					style: button(),
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
			if (!state.mounted) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: box,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: "15px",
						fontWeight: 600
					},
					children: t("notMounted")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: label,
					children: t("notMountedHint")
				})]
			});
			if (draft === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: box,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: label,
					children: t("loading")
				})
			});
			const set = (key, value) => {
				setDraft((current) => current === null ? current : {
					...current,
					[key]: value
				});
			};
			/** 文件状态条（缺文件也照列，标出来就好）。 */
			const fileStatus = (infos) => {
				if (infos === void 0 || infos.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: dim,
					children: t("emptyFiles")
				});
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						display: "flex",
						flexWrap: "wrap",
						gap: "10px"
					},
					children: infos.map((info) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: {
							...code,
							opacity: info.exists ? .85 : .45
						},
						children: [
							info.name,
							" · ",
							info.exists ? `${t("present")} ${formatBytes(info.bytes)}` : t("missing")
						]
					}, info.path))
				});
			};
			/**
			* 一张清单。
			* @param opts - 标题、说明、草稿字段、文件状态、附加控件。
			* @returns 卡片元素。
			*/
			const layer = (opts) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: card,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: { fontWeight: 600 },
						children: opts.title
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: dim,
						children: opts.hint
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						style: {
							...input,
							minHeight: "96px"
						},
						spellCheck: false,
						value: draft[opts.filesKey],
						placeholder: t("filesHint"),
						onChange: (event) => {
							set(opts.filesKey, event.target.value);
						}
					}),
					fileStatus(opts.infos),
					opts.extra
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: box,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							justifyContent: "space-between",
							alignItems: "baseline"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
						})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							style: button(busy),
							disabled: busy,
							onClick: () => {
								load();
							},
							children: t("refresh")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: card,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
								name: t("root"),
								value: state.root ?? "—"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
								name: t("configFile"),
								value: state.configFile ?? "—"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
								name: t("injectedFile"),
								value: state.injectedFile ?? "—"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: label,
									children: t("injectedCount")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: {
										display: "flex",
										alignItems: "center",
										gap: "10px",
										flexWrap: "wrap"
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: code,
											children: state.injected?.length ?? 0
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											style: button(),
											onClick: () => {
												reset();
											},
											children: t("reset")
										}),
										(state.injected?.length ?? 0) === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: dim,
											children: t("injectedEmpty")
										}) : null
									]
								})]
							})
						]
					}),
					layer({
						title: t("systemTitle"),
						hint: t("systemHint"),
						filesKey: "systemFiles",
						infos: state.files?.system
					}),
					layer({
						title: t("userTitle"),
						hint: t("userHint"),
						filesKey: "userFiles",
						infos: state.files?.user,
						extra: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: "7px",
								cursor: "pointer"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: draft.wrap,
								onChange: (event) => {
									set("wrap", event.target.checked);
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: dim,
								children: [
									t("wrap"),
									" · ",
									t("wrapHint")
								]
							})]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							alignItems: "center",
							gap: "10px",
							flexWrap: "wrap"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							style: button(busy),
							disabled: busy,
							onClick: () => {
								save();
							},
							children: t("save")
						}), note === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: label,
							children: note
						})]
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
