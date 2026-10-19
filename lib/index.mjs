import z from "@deepseek-ai/schemastery";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
//#region src/presets.ts
/**
* preinject 的参数持久化：按 agent preset 分桶的覆盖层。
*
* 存储：`<root>/state/preinject.json`，结构照 0.1.6 那套——
*
*   { "presets": { "common": { … }, "roroko": { … } } }
*
* `common` 是公共默认，任何 preset 没覆盖的字段都落回它；具体 preset 的桶
* 叠在它上面，字段缺失才算未覆盖（空清单 / 空串都是显式设定）。
*
* 读写全部原子化（临时文件 + rename），坏文件当没有，不抛。
*/
/** 公共默认桶名。 */
const COMMON = "common";
/** 桶里认的键，其余一律丢弃。 */
const BUCKET_KEYS = ["systemFiles", "userFiles"];
/** state 文件。 */
function stateFile(root) {
	return join(root, "state", "preinject.json");
}
/** 清单清洗：字符串、去空白、去空项。 */
function cleanList(value) {
	if (!Array.isArray(value)) return void 0;
	return value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}
/** 桶清洗：只留合法字段，一个都不剩就当没这个桶。 */
function cleanBucket(value) {
	if (value === null || typeof value !== "object") return void 0;
	const raw = value;
	const out = {};
	if ("systemFiles" in raw) {
		const list = cleanList(raw.systemFiles);
		if (list !== void 0) out.systemFiles = list;
	}
	if ("userFiles" in raw) {
		const list = cleanList(raw.userFiles);
		if (list !== void 0) out.userFiles = list;
	}
	return Object.keys(out).length > 0 ? out : void 0;
}
/** 读整份状态（同步：系统段 provider 不能 await）。 */
function readState(root) {
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(stateFile(root), "utf8"));
	} catch {
		return { presets: {} };
	}
	if (parsed === null || typeof parsed !== "object") return { presets: {} };
	const presets = {};
	const raw = parsed.presets;
	if (raw !== null && typeof raw === "object") for (const [scope, bucket] of Object.entries(raw)) {
		const cleaned = cleanBucket(bucket);
		if (cleaned !== void 0) presets[scope] = cleaned;
	}
	return { presets };
}
/** 原子写整份状态。 */
async function saveState(root, state) {
	const file = stateFile(root);
	await mkdir(dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	await rename(tmp, file);
}
/**
* 部分覆盖某个桶：body 里给了的字段盖上去，没给的保留。
* 合并后空桶直接删掉（回到跟随公共默认 / 接线 config），不留空桶压住下层。
* @param root - 身份根。
* @param scope - 桶名（common 或 preset id）。
* @param patch - 待写入字段。
* @returns 落盘后的整份状态。
*/
async function setBucket(root, scope, patch) {
	const current = readState(root);
	const merged = { ...current.presets[scope] };
	for (const key of BUCKET_KEYS) {
		if (!(key in patch)) continue;
		const cleaned = cleanList(patch[key]);
		if (cleaned === void 0) delete merged[key];
		else merged[key] = cleaned;
	}
	const cleaned = cleanBucket(merged);
	const presets = { ...current.presets };
	if (cleaned === void 0) delete presets[scope];
	else presets[scope] = cleaned;
	const next = { presets };
	await saveState(root, next);
	return next;
}
/**
* 删掉某个桶（该 preset 回到公共默认 / 接线 config）。
* @param root - 身份根。
* @param scope - 桶名。
* @returns 落盘后的整份状态。
*/
async function clearBucket(root, scope) {
	const current = readState(root);
	if (!(scope in current.presets)) return current;
	const presets = { ...current.presets };
	delete presets[scope];
	const next = { presets };
	await saveState(root, next);
	return next;
}
/**
* 解析某个 preset 的覆盖层：具体桶叠在公共桶之上，只叠存在的字段。
* @param state - 整份状态。
* @param presetId - 会话的 preset id；空 = 只看公共桶。
* @returns 合成后的覆盖层。
*/
function resolveBucket(state, presetId) {
	const common = state.presets["common"] ?? {};
	const specific = presetId === void 0 || presetId === "common" ? void 0 : state.presets[presetId];
	if (specific === void 0) return { ...common };
	return {
		...common,
		...specific
	};
}
//#endregion
//#region src/state.ts
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
//#endregion
//#region src/preinject.ts
/**
* roroko-preinject —— 双段注入子模块。
*
* 参数解析照 0.1.6 那条四层链，逐字段回落：
*
*   内置默认 ← preset 接线 config ← 公共桶 common ← 分 preset 桶
*
* 两张清单：
*   系统层 systemFiles —— 按顺序拼进系统提示词（`deployment:persona-prefix`，
*                         section 文本只放宏，正文由变量 provider 现读）。
*   用户层 userFiles   —— 按顺序拼成一条 user 消息，落在本批用户消息之后，
*                         每会话一次。
*
* 覆盖层存 `<root>/state/preinject.json`，按 preset 分桶（见 presets.ts）。
* 文件路径相对 root 解析，`~/` 走主目录，绝对路径原样用；读不到静默跳过。
* 判重：每个会话只注入一次，登记在进程内存里。DSH 0.2.1 的 Session.log 是私有
* 字段、surface 只给 seq，扫不到注入痕迹，所以不落盘——进程重启后老会话会再
* 注入一次，仅此而已。
*
* ── 0.2.1 适配：系统段怎么知道自己是哪个 preset ────────────────────────
* 0.1.6 的 provider 从 `context.agent.session.header.agentPreset` 取；0.2.1 的
* AssembleContext 只有 `scope`，没有 agent，拿不到会话。于是改成：pre-step
* （异步、每 turn 都跑，且一定早于本 turn 的系统提示词装配）里把
* `session.header.agentPreset` 记进实例变量，系统段 provider 直接读它。
*
* 每个 preset 的 composition 各挂一份本模块实例，scope 路由只把该 preset 下的
* 事件送过来，所以这个实例变量对本实例如同常量。不依赖 dsh-scope 的内部符号。
*/
/** 子模块标识：只用于日志与消息来源签名，不是独立插件。 */
const moduleName = "roroko-preinject";
/** 抢占的槽位名（等同 PERSONA_PREFIX_SECTION）。 */
const SECTION_NAME = "deployment:persona-prefix";
/** 官方固定开场白段名，order -1000。 */
const HARNESS_IDENTITY = "harness:identity";
const VARIABLE = "roroko_preinject_system";
/** 内置默认（最底层）。 */
const DEFAULTS = {
	systemFiles: [],
	userFiles: []
};
/**
* 四层合成：默认 ← 接线 config ← 公共桶 ← 分 preset 桶。
* @param config - preset 接线层。
* @param state - 覆盖层状态。
* @param presetId - 会话的 preset id；空 = 只吃公共桶。
* @returns 该 preset 生效的参数。
*/
function resolveEffective(config, state, presetId) {
	const bucket = resolveBucket(state, presetId);
	return {
		systemFiles: bucket.systemFiles ?? config.systemFiles ?? DEFAULTS.systemFiles,
		userFiles: bucket.userFiles ?? config.userFiles ?? DEFAULTS.userFiles
	};
}
const dshHome = () => process.env.DSH_HOME ?? join(homedir(), ".dsh");
/** 默认身份根。 */
function defaultRoot() {
	return join(dshHome(), "roroko");
}
/** 清单项解析：相对 root；`~/` 走主目录；绝对路径原样。 */
function entryPath(name, root) {
	if (isAbsolute(name)) return name;
	if (name === "~") return homedir();
	if (name.startsWith("~/") || name.startsWith("~\\")) return join(homedir(), name.slice(2));
	return resolve(root, name);
}
/**
* 本实例最近一次在 pre-step 里见到的 preset id。
*
* 每个 preset 的 composition 各挂一份本模块实例，而 scope 路由只把该 preset
* 下的事件送到这里，所以这个值对本实例是稳定的。首个 turn 的 pre-step 早于
* 系统提示词装配，首装配就能用上；真拿不到（装配早于任何 pre-step）才回落
* 公共桶。不依赖 dsh-scope 的内部符号，跨安装形态都成立。
*/
let activePreset;
/** 已注入过的会话（进程内存，重启即清空）。 */
const INJECTED = /* @__PURE__ */ new Set();
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
function mergeTexts(texts) {
	return texts.filter(Boolean).join("\n\n");
}
/** 系统层正文：按该 preset 生效的清单读，缺文件跳过。 */
function systemText(root, config, presetId) {
	return mergeTexts(resolveEffective(config, readState(root), presetId).systemFiles.map((name) => readSync(entryPath(name, root))));
}
/** 用户层正文：纯拼接，不加签名、不加壳——首尾要什么，清单里的文件自己带。 */
async function userSegmentText(root, config, presetId) {
	const effective = resolveEffective(config, readState(root), presetId);
	return mergeTexts(await Promise.all(effective.userFiles.map((name) => readAsync(entryPath(name, root)))));
}
/**
* 挂载本子模块。由 host 在自己的 ctx 上调用，不单独占一行插件。
* @param ctx - 宿主上下文（通常是 preset scope 里的子 fiber）。
* @param rawConfig - 子模块配置（preset 的 config.preinject）。
*/
function mount(ctx, rawConfig = {}) {
	const surface = ctx;
	const config = { ...rawConfig };
	const root = rawConfig.root !== void 0 && rawConfig.root.length > 0 ? rawConfig.root : defaultRoot();
	const status = {
		root,
		config
	};
	surface.effect(() => registerMount(status), "preinject.status()");
	surface.effect(() => surface.systemPrompt.variable(VARIABLE, () => {
		try {
			return systemText(root, config, activePreset);
		} catch {
			return "";
		}
	}), "preinject.variable()");
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
		const presetId = session?.header?.agentPreset;
		if (presetId !== void 0) activePreset = presetId;
		const sessionId = session?.id ?? session?.header?.id;
		if (sessionId !== void 0 && INJECTED.has(sessionId)) return decision;
		const text = await userSegmentText(root, config, presetId);
		if (!text) return decision;
		if (sessionId !== void 0) INJECTED.add(sessionId);
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
/** 本包包名：preset 里那行的 moduleName。 */
const PACKAGE_NAME = "@roroko-tool/dsh-roroko-tool";
const PREFIX = "/roroko-tool";
/** 配置请求体上限（几张清单，1MB 绰绰有余）。 */
const BODY_LIMIT = 1048576;
/** 桶名契约：preset id 也是桶名，限制字符免得出脏键。 */
const SCOPE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
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
/** 接线层原样（没写的字段就是没写）。 */
function wiring(config) {
	const out = {};
	if (config.systemFiles !== void 0) out.systemFiles = config.systemFiles;
	if (config.userFiles !== void 0) out.userFiles = config.userFiles;
	return out;
}
/** 各 scope 的生效值与文件状态。 */
async function scopeViews(config, state, root, scopes) {
	const effective = {};
	const files = {};
	for (const scope of scopes) {
		const value = resolveEffective(config, state, scope === "common" ? void 0 : scope);
		effective[scope] = value;
		files[scope] = {
			system: await fileInfos(value.systemFiles, root),
			user: await fileInfos(value.userFiles, root)
		};
	}
	return {
		effective,
		files
	};
}
/**
* 注册设置页数据路由。
* @param server - webServer 服务。
* @param version - 本包版本，仅供页面显示。
* @param registry - preset 注册表取用函数（拿不到就只列已有桶）。
* @returns 注销函数。
*/
function registerStateRoutes(server, version, registry) {
	/**
	* roster：只留真挂了我们插件的 preset。
	*
	* 官方 preset（standard / minimal / duck …）不会加载 roroko-tool，给它们出卡
	* 纯属占地方。靠 compositionInventory 的插件行过滤；注册表没这个方法（或
	* 读失败）就退回全量，页面照样能用。
	*/
	const roster = async () => {
		try {
			const service = registry?.();
			if (service === void 0) return [];
			const rows = await service.list();
			if (service.compositionInventory === void 0) return rows;
			let inventory;
			try {
				inventory = await service.compositionInventory();
			} catch {
				return rows;
			}
			const ours = new Set(inventory.filter((item) => item.rows.some((row) => row.moduleName.includes(PACKAGE_NAME))).map((item) => item.id));
			return rows.filter((row) => ours.has(row.id));
		} catch {
			return [];
		}
	};
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
			const state = readState(mount.root);
			const rows = await roster();
			const scopes = [COMMON];
			for (const row of rows) if (!scopes.includes(row.id)) scopes.push(row.id);
			for (const key of Object.keys(state.presets)) if (!scopes.includes(key)) scopes.push(key);
			const views = await scopeViews(mount.config, state, mount.root, scopes);
			json(res, 200, {
				version,
				mounted: true,
				root: mount.root,
				stateFile: stateFile(mount.root),
				presets: state.presets,
				defaults: DEFAULTS,
				wiring: wiring(mount.config),
				roster: rows,
				scopes,
				effective: views.effective,
				files: views.files
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
					reason: "未挂载 preinject，没有可写的桶"
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
			const patch = body;
			const scope = typeof patch.preset === "string" ? patch.preset : COMMON;
			if (!SCOPE_RE.test(scope)) {
				json(res, 400, {
					ok: false,
					reason: `桶名不合法：${scope}`
				});
				return;
			}
			json(res, 200, {
				ok: true,
				state: patch.reset === true ? await clearBucket(mount.root, scope) : await setBucket(mount.root, scope, patch)
			});
		}
	});
	return () => {
		offState();
		offConfig();
	};
}
//#endregion
//#region src/index.ts
const name = "roroko-tool";
/** 子模块配置：schema 化之后，Plugins 页才有本插件自己的页面与表单。 */
const Config = z.object({ preinject: z.union([z.boolean(), z.object({
	root: z.string().description("文件基准目录（默认 $DSH_HOME/roroko）"),
	systemFiles: z.array(z.string()).description("接线层：系统层清单"),
	userFiles: z.array(z.string()).description("接线层：用户层清单"),
	suppressHarnessIdentity: z.boolean().description("顶掉官方开场白段")
})]).description("上下文注入子模块（覆盖层在设置页里按 preset 分桶）") });
/** 本包版本（设置页显示用）。 */
const version = "0.1.0";
/**
* 插件入口。
* @param ctx - 本行插件所在的上下文（profile 层或 preset scope）。
* @param config - 见 {@link RorokoToolConfig}。
*/
function apply(ctx, config = {}) {
	const surface = ctx;
	/** preset 注册表：晚到也没关系，路由按"拿得到就列"处理。 */
	let registry;
	surface.inject(["agentPresets"], (scope) => {
		const service = scope.agentPresets;
		scope.effect(() => {
			registry = service;
			return () => {
				registry = void 0;
			};
		}, "roroko-tool: preset 注册表");
	});
	surface.inject(["webServer"], (scope) => {
		const server = scope.webServer;
		scope.effect(() => registerStateRoutes(server, version, () => registry), "roroko-tool: 设置页路由");
	});
	const preinject = config.preinject;
	if (preinject !== void 0 && preinject !== false && preinject?.enabled !== false) surface.inject(["systemPrompt"], (scope) => {
		mount(scope, preinject === true ? {} : preinject);
	});
}
//#endregion
export { COMMON, Config, DEFAULTS, apply, clearBucket, name, readState, resolveBucket, resolveEffective, setBucket, version };
