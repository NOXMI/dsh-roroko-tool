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
			loading: "加载中…",
			failed: "加载失败",
			version: "版本",
			refresh: "刷新",
			notMounted: "没有挂载 preinject",
			notMountedHint: "preset 里没声明 config.preinject 桶，这个页面无事可做",
			root: "身份根",
			configFile: "清单文件",
			injectedFile: "记录文件",
			injectedCount: "注入记录",
			injectedEmpty: "还没有会话被标记",
			injectedHint: "记录文件清空后，下次会话会重新注入一遍。",
			reset: "清空注入记录",
			resetDone: "已清空，下次会话会重新注入",
			resetFailed: "清空失败",
			systemTitle: "系统层",
			systemHint: "按顺序拼进系统提示词，常驻、不占消息位、不被压缩折叠。",
			userTitle: "用户层",
			userHint: "按顺序拼成一条 user 消息，落在本批用户消息之后，每会话一次。",
			filesHint: "如 IDENTITY.md，或 /root/.dsh/roroko/AGENTS.md",
			addFile: "+ 添加文件",
			deleteRow: "删除此行",
			emptyFiles: "清单是空的",
			missing: "缺失",
			present: "就绪",
			wrap: "整体包一层 <system-reminder>…</system-reminder>",
			save: "保存",
			saving: "保存中…",
			saved: "已保存",
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
			notMounted: "preinject is not mounted",
			notMountedHint: "No config.preinject bucket in this preset, nothing to configure here",
			root: "Root",
			configFile: "List file",
			injectedFile: "Record file",
			injectedCount: "Injection record",
			injectedEmpty: "No session marked yet",
			injectedHint: "Clear the record file and the next session injects again.",
			reset: "Clear injection record",
			resetDone: "Cleared — the next session injects again",
			resetFailed: "Clear failed",
			systemTitle: "System layer",
			systemHint: "Joined in order into the system prompt; resident, no message slot, survives compaction.",
			userTitle: "User layer",
			userHint: "Joined into one user message after the user messages, once per session.",
			filesHint: "e.g. IDENTITY.md, or /root/.dsh/roroko/AGENTS.md",
			addFile: "+ Add file",
			deleteRow: "Remove this line",
			emptyFiles: "Empty list",
			missing: "missing",
			present: "ready",
			wrap: "Wrap the whole thing in <system-reminder>…</system-reminder>",
			save: "Save",
			saving: "Saving…",
			saved: "Saved",
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
		* 版式沿用旧版 roroko-tool 设置页那套：灰色说明行 + 浅底 PanelShell +
		* 逐行可增删的文件清单 + 底部保存按钮与内联的已保存/失败提示。
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
		/** 文件清单编辑器：若干行文本框 + 增删。系统层与用户层共用一份。 */
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
		/** 清单读盘状态：就绪 / 缺失，标在清单下面。 */
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
		/**
		* 设置页主体。
		* @param props - 页签所有者传入的属性。
		* @returns 设置页元素。
		*/
		function RorokoSettingsPage(props) {
			const { t } = props;
			const [state, setState] = (0, react.useState)(null);
			const [systemFiles, setSystemFiles] = (0, react.useState)([]);
			const [userFiles, setUserFiles] = (0, react.useState)([]);
			const [wrap, setWrap] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)(null);
			const [note, setNote] = (0, react.useState)(null);
			const [saved, setSaved] = (0, react.useState)(false);
			const [saving, setSaving] = (0, react.useState)(false);
			const [saveError, setSaveError] = (0, react.useState)(null);
			const load = (0, react.useCallback)(async () => {
				setError(null);
				try {
					const body = await fetchState();
					setState(body);
					if (body.config !== void 0) {
						setSystemFiles(body.config.systemFiles);
						setUserFiles(body.config.userFiles);
						setWrap(body.config.wrap);
					}
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				}
			}, []);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			const save = (0, react.useCallback)(() => {
				setSaved(false);
				setSaveError(null);
				setSaving(true);
				saveConfig({
					systemFiles: cleanList(systemFiles),
					userFiles: cleanList(userFiles),
					wrap
				}).then(async (ack) => {
					if (!ack.ok) throw new Error(ack.reason ?? t("saveFailed"));
					setSaved(true);
					await load();
				}).catch((cause) => {
					setSaveError(cause instanceof Error ? cause.message : String(cause));
				}).finally(() => {
					setSaving(false);
				});
			}, [
				systemFiles,
				userFiles,
				wrap,
				load,
				t
			]);
			const reset = (0, react.useCallback)(() => {
				setNote(null);
				resetInjected().then((ack) => {
					setNote(ack.ok ? t("resetDone") : t("resetFailed"));
					return load();
				}).catch(() => {
					setNote(t("resetFailed"));
				});
			}, [load, t]);
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
			if (!state.mounted) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { padding: "6px 0" },
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: { fontWeight: 600 },
					children: t("notMounted")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: hintStyle,
					children: t("notMountedHint")
				})]
			});
			const busy = saving;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { padding: "6px 0" },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							color: "var(--dsw-text-secondary, #888)",
							fontSize: "0.9em",
							marginBottom: 12
						},
						children: [
							t("title"),
							" · ",
							t("subtitle")
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolHeader, {
						title: t("systemTitle"),
						desc: t("systemHint")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(PanelShell, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileListEditor, {
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
						infos: state.files?.system,
						t
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolHeader, {
						title: t("userTitle"),
						desc: t("userHint")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(PanelShell, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileListEditor, {
							files: userFiles,
							busy,
							placeholder: t("filesHint"),
							addLabel: t("addFile"),
							deleteLabel: t("deleteRow"),
							onChange: (next) => {
								setUserFiles(next);
								setSaved(false);
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							style: {
								alignItems: "center",
								cursor: "pointer",
								display: "flex",
								fontSize: "0.85em",
								gap: 6,
								marginTop: 10
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: wrap,
								disabled: busy,
								onChange: () => {
									setWrap((value) => !value);
									setSaved(false);
								}
							}), t("wrap")]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileStatus, {
							infos: state.files?.user,
							t
						})
					] }),
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
									load();
								},
								children: t("refresh")
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolHeader, {
						title: t("injectedCount"),
						desc: t("injectedHint")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(PanelShell, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							fontSize: "0.85em",
							lineHeight: 1.9
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								t("root"),
								": ",
								state.root ?? "—"
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								t("configFile"),
								": ",
								state.configFile ?? "—"
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								t("injectedFile"),
								": ",
								state.injectedFile ?? "—"
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								t("injectedCount"),
								": ",
								state.injected?.length ?? 0
							] })
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							alignItems: "center",
							display: "flex",
							flexWrap: "wrap",
							gap: 8,
							marginTop: 10
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle,
							onClick: () => {
								reset();
							},
							children: t("reset")
						}), note === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								color: "var(--dsw-text-secondary, #888)",
								fontSize: "0.8em"
							},
							children: note
						})]
					})] })
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
