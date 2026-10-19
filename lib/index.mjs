import z from "@deepseek-ai/schemastery";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
//#region src/state.ts
/**
* 运行时状态登记处：子模块挂载时把自己的目录与文件位置写进来，host 的 HTTP
* 路由读出来给设置页；同时负责跳闸记录（injected.json）的读取与清空。
*/
const MOUNTS = /* @__PURE__ */ new Map();
let nextKey = 1;
/**
* 登记一次子模块挂载。
* @param status - 本次挂载的实际配置。
* @returns 注销函数。
*/
function registerMount(status) {
	const key = nextKey;
	nextKey += 1;
	MOUNTS.set(key, status);
	return () => {
		MOUNTS.delete(key);
	};
}
/** 当前所有挂载的快照。 */
function mountedStatuses() {
	return [...MOUNTS.values()];
}
/** 首个挂载的完整登记项（设置页只跟一个 preinject 实例对话）。 */
function firstMount() {
	return mountedStatuses()[0];
}
/**
* 读取已注入的会话 id。
* @param file - injected.json 路径。
* @returns 会话 id 列表。
*/
async function readInjected(file) {
	try {
		const parsed = JSON.parse(await readFile(file, "utf8"));
		return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
	} catch {
		return [];
	}
}
/**
* 清空跳闸记录。
* @param file - injected.json 路径。
*/
async function resetInjected(file) {
	await rm(file, { force: true });
}
//#endregion
//#region src/preinject.ts
/**
* roroko-preinject —— 双段注入子模块。
*
* 就两张清单，谁都不认识、什么都不猜：
*   系统层 systemFiles —— 按顺序拼进系统提示词（`deployment:persona-prefix`，
*                         section 文本只放宏，正文由变量 provider 现读）。
*   用户层 userFiles   —— 按顺序拼成一条 user 消息，追加在本批用户消息之后，
*                         每会话一次。
*
* 清单只有一份，存在 `<root>/state/preinject.json`，设置页读写；preset 里只给
* `root`。两个清单都空 = 什么都不注入。
*
* 文件路径相对 root 解析，`~/` 走主目录，绝对路径原样用；读不到静默跳过。
* 判重记在 `<root>/state/injected.json`，跨重启有效。
*/
/** 子模块标识：只用于日志与消息来源签名，不是独立插件。 */
const moduleName = "roroko-preinject";
/** 抢占的槽位名（等同 PERSONA_PREFIX_SECTION）。 */
const SECTION_NAME = "deployment:persona-prefix";
/** 官方固定开场白段名，order -1000。 */
const HARNESS_IDENTITY = "harness:identity";
const VARIABLE = "roroko_preinject_system";
const MARK = "[roroko-preinject]";
const DEFAULTS = {
	systemFiles: [],
	userFiles: [],
	wrap: true
};
const dshHome = () => process.env.DSH_HOME ?? join(homedir(), ".dsh");
/** 默认身份根。 */
function defaultRoot() {
	return join(dshHome(), "roroko");
}
/** 清单文件。 */
function configFile(root) {
	return join(root, "state", "preinject.json");
}
/** 判重文件。 */
function injectedFile(root) {
	return join(root, "state", "injected.json");
}
/** 清单项解析：相对 root；`~/` 走主目录；绝对路径原样。 */
function entryPath(name, root) {
	if (isAbsolute(name)) return name;
	if (name === "~") return homedir();
	if (name.startsWith("~/") || name.startsWith("~\\")) return join(homedir(), name.slice(2));
	return resolve(root, name);
}
function readSync(path) {
	try {
		return readFileSync(path, "utf8").trim();
	} catch {
		return "";
	}
}
async function readAsync(path) {
	try {
		return (await readFile(path, "utf8")).trim();
	} catch {
		return "";
	}
}
/** 清单清洗：字符串、去空白、去空项。 */
function cleanList(value) {
	if (!Array.isArray(value)) return [];
	return value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}
/** 读清单（同步：系统段 provider 不能 await）。坏文件当空。 */
function readConfig(root) {
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(configFile(root), "utf8"));
	} catch {
		return { ...DEFAULTS };
	}
	if (parsed === null || typeof parsed !== "object") return { ...DEFAULTS };
	const raw = parsed;
	return {
		systemFiles: cleanList(raw.systemFiles),
		userFiles: cleanList(raw.userFiles),
		wrap: typeof raw.wrap === "boolean" ? raw.wrap : DEFAULTS.wrap
	};
}
/**
* 整份写清单（全量替换，不合并）。
* @param root - 身份根。
* @param patch - 页面提交的字段，缺的走默认。
* @returns 落盘后的清单。
*/
async function writeConfig(root, patch) {
	const next = {
		systemFiles: cleanList(patch.systemFiles),
		userFiles: cleanList(patch.userFiles),
		wrap: typeof patch.wrap === "boolean" ? patch.wrap : DEFAULTS.wrap
	};
	const file = configFile(root);
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	return next;
}
/** 系统层正文：清单现读，读不到的文件跳过。 */
function systemText(root) {
	return readConfig(root).systemFiles.map((name) => readSync(entryPath(name, root))).filter(Boolean).join("\n\n");
}
/** 用户层正文：带签名，可选 system-reminder 壳。 */
async function userSegmentText(root) {
	const config = readConfig(root);
	const body = (await Promise.all(config.userFiles.map((name) => readAsync(entryPath(name, root))))).filter(Boolean).join("\n\n");
	if (!body) return "";
	const named = `${MARK} 用户层注入（${config.userFiles.join(", ")}）：\n\n${body}`;
	return config.wrap ? `<system-reminder>\n${named}\n</system-reminder>` : named;
}
async function loadInjected(file) {
	try {
		const parsed = JSON.parse(await readFile(file, "utf8"));
		return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []);
	} catch {
		return /* @__PURE__ */ new Set();
	}
}
async function markInjected(file, sessionId) {
	const set = await loadInjected(file);
	if (set.has(sessionId)) return;
	set.add(sessionId);
	try {
		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, JSON.stringify([...set]), "utf8");
	} catch {}
}
/**
* 挂载本子模块。由 host 在自己的 ctx 上调用，不单独占一行插件。
* @param ctx - 宿主上下文（通常是 preset scope 里的子 fiber）。
* @param rawConfig - 子模块配置（preset 的 config.preinject）。
*/
function mount(ctx, rawConfig = {}) {
	const surface = ctx;
	const root = rawConfig.root !== void 0 && rawConfig.root.length > 0 ? rawConfig.root : defaultRoot();
	const file = injectedFile(root);
	const status = {
		root,
		configFile: configFile(root),
		injectedFile: file
	};
	surface.effect(() => registerMount(status), "preinject.status()");
	surface.effect(() => surface.systemPrompt.variable(VARIABLE, () => systemText(root)), "preinject.variable()");
	surface.effect(() => surface.systemPrompt.section({
		name: SECTION_NAME,
		order: surface.systemPrompt.getSectionOrder("DEPLOYMENT_PERSONA_PREFIX"),
		text: `{{${VARIABLE}}}`
	}), "preinject.section()");
	if (rawConfig.suppressHarnessIdentity !== false) surface.effect(() => surface.systemPrompt.section({
		name: HARNESS_IDENTITY,
		order: surface.systemPrompt.getSectionOrder("HARNESS_IDENTITY"),
		text: ""
	}), "preinject.suppressHarnessIdentity()");
	surface.on("agent/pre-step", async (payload, next) => {
		const decision = await next();
		if (decision.kind !== "enter") return decision;
		const session = payload.agent.session;
		const sessionId = session?.id ?? session?.header?.id;
		if (sessionId !== void 0 && (await loadInjected(file)).has(sessionId)) return decision;
		const text = await userSegmentText(root);
		if (!text) return decision;
		if (sessionId !== void 0) await markInjected(file, sessionId);
		const message = createUserMessage({
			content: [{
				type: "text",
				text
			}],
			source: { kind: moduleName }
		});
		return {
			...decision,
			messages: [...decision.messages ?? [], message]
		};
	});
}
//#endregion
//#region src/routes.ts
const PREFIX = "/roroko-tool";
/** 配置请求体上限（两张清单，1MB 绰绰有余）。 */
const BODY_LIMIT = 1048576;
function json(res, status, body) {
	const text = JSON.stringify(body, null, 2);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(text);
}
/** 读请求体并当 JSON 解析；空体返回 null。 */
async function readJson(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk;
		size += buffer.length;
		if (size > BODY_LIMIT) throw new Error("请求体过大");
		chunks.push(buffer);
	}
	const text = Buffer.concat(chunks).toString("utf8").trim();
	if (text.length === 0) return null;
	return JSON.parse(text);
}
/** 清单 → 文件状态（缺文件不报错，标 exists:false 让页面上看得见）。 */
async function fileInfos(names, root) {
	return Promise.all(names.map(async (name) => {
		const path = entryPath(name, root);
		try {
			const info = await stat(path);
			const isFile = info.isFile();
			return {
				name,
				path,
				exists: isFile,
				bytes: isFile ? info.size : 0
			};
		} catch {
			return {
				name,
				path,
				exists: false,
				bytes: 0
			};
		}
	}));
}
/**
* 注册设置页数据路由。
* @param server - webServer 服务。
* @param version - 本包版本，仅供页面显示。
* @returns 注销函数。
*/
function registerStateRoutes(server, version) {
	const offState = server.register({
		kind: "exact",
		path: `${PREFIX}/state`,
		handler: async (req, res) => {
			if (req.method !== "GET" && req.method !== "HEAD") {
				json(res, 405, { error: "GET only" });
				return;
			}
			const mount = firstMount();
			if (mount === void 0) {
				json(res, 200, {
					version,
					mounted: false
				});
				return;
			}
			const config = readConfig(mount.root);
			json(res, 200, {
				version,
				mounted: true,
				root: mount.root,
				configFile: mount.configFile,
				injectedFile: mount.injectedFile,
				injected: await readInjected(mount.injectedFile),
				config,
				files: {
					system: await fileInfos(config.systemFiles, mount.root),
					user: await fileInfos(config.userFiles, mount.root)
				}
			});
		}
	});
	const offConfig = server.register({
		kind: "exact",
		path: `${PREFIX}/config`,
		handler: async (req, res) => {
			if (req.method !== "POST") {
				json(res, 405, { error: "POST only" });
				return;
			}
			const mount = firstMount();
			if (mount === void 0) {
				json(res, 200, {
					ok: false,
					reason: "未挂载 preinject，没有可写的清单"
				});
				return;
			}
			let body;
			try {
				body = await readJson(req);
			} catch (cause) {
				json(res, 400, {
					ok: false,
					reason: cause instanceof Error ? cause.message : "请求体解析失败"
				});
				return;
			}
			if (body === null || typeof body !== "object") {
				json(res, 400, {
					ok: false,
					reason: "请求体必须是 JSON 对象"
				});
				return;
			}
			json(res, 200, {
				ok: true,
				config: await writeConfig(mount.root, body)
			});
		}
	});
	const offReset = server.register({
		kind: "exact",
		path: `${PREFIX}/reset`,
		handler: async (req, res) => {
			if (req.method !== "POST") {
				json(res, 405, { error: "POST only" });
				return;
			}
			const mount = firstMount();
			if (mount === void 0) {
				json(res, 200, {
					ok: false,
					reason: "未挂载 preinject，没有可清空的记录"
				});
				return;
			}
			await resetInjected(mount.injectedFile);
			json(res, 200, { ok: true });
		}
	});
	return () => {
		offState();
		offConfig();
		offReset();
	};
}
//#endregion
//#region src/index.ts
const name = "roroko-tool";
/** 子模块配置：schema 化之后，Plugins 页才有本插件自己的页面与表单。 */
const Config = z.object({ preinject: z.union([z.boolean(), z.object({
	root: z.string().description("文件基准目录（默认 $DSH_HOME/roroko）"),
	suppressHarnessIdentity: z.boolean().description("顶掉官方开场白段")
})]).description("上下文注入子模块（两张清单在设置页里写）") });
/** 本包版本（设置页显示用）。 */
const version = "0.1.0";
/**
* 插件入口。
* @param ctx - 本行插件所在的上下文（profile 层或 preset scope）。
* @param config - 见 {@link RorokoToolConfig}。
*/
function apply(ctx, config = {}) {
	const surface = ctx;
	surface.inject(["webServer"], (scope) => {
		const server = scope.webServer;
		scope.effect(() => registerStateRoutes(server, version), "roroko-tool: 设置页路由");
	});
	const preinject = config.preinject;
	if (preinject !== void 0 && preinject !== false && preinject?.enabled !== false) surface.inject(["systemPrompt"], (scope) => {
		mount(scope, preinject === true ? {} : preinject);
	});
}
//#endregion
export { Config, apply, name, version };
