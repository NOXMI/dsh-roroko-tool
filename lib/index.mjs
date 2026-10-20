import z from "@deepseek-ai/schemastery";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { DatabaseSync } from "node:sqlite";
import { defineTool } from "@deepseek-ai/dsh-tools";
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
const BUCKET_KEYS$2 = [
	"systemFiles",
	"userFiles",
	"suppressSections"
];
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
function cleanBucket$2(value) {
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
	if ("suppressSections" in raw) {
		const list = cleanList(raw.suppressSections);
		if (list !== void 0) out.suppressSections = list;
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
		const cleaned = cleanBucket$2(bucket);
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
	for (const key of BUCKET_KEYS$2) {
		if (!(key in patch)) continue;
		const cleaned = cleanList(patch[key]);
		if (cleaned === void 0) delete merged[key];
		else merged[key] = cleaned;
	}
	const cleaned = cleanBucket$2(merged);
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
/** 一张挂载表：登记 + 注销 + 取首个。 */
function slots() {
	const items = /* @__PURE__ */ new Map();
	let key = 0;
	return {
		register(status) {
			key += 1;
			const mine = key;
			items.set(mine, status);
			return () => {
				items.delete(mine);
			};
		},
		all: () => [...items.values()],
		first: () => [...items.values()][0]
	};
}
const PREINJECT = slots();
const DATAS = slots();
const MEMORY = slots();
/**
* 登记一次 preinject 挂载。
* @param status - 本次挂载的实际配置。
* @returns 注销函数。
*/
function registerMount(status) {
	return PREINJECT.register(status);
}
/** 首个 preinject 挂载（设置页只跟一个实例对话）。 */
function firstMount() {
	return PREINJECT.first();
}
/**
* 登记一次 datas 挂载。
* @param status - 本次挂载的实际配置。
* @returns 注销函数。
*/
function registerDatasMount(status) {
	return DATAS.register(status);
}
/** 首个 datas 挂载。 */
function firstDatasMount() {
	return DATAS.first();
}
/**
* 登记一次 memory 挂载。
* @param status - 本次挂载的实际配置与 dream 运行面。
* @returns 注销函数。
*/
function registerMemoryMount(status) {
	return MEMORY.register(status);
}
/** 首个 memory 挂载（设置页与手动触发只跟一个实例对话）。 */
function firstMemoryMount() {
	return MEMORY.first();
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
const moduleName$2 = "roroko-preinject";
/** 抢占的槽位名（等同 PERSONA_PREFIX_SECTION）。 */
const SECTION_NAME = "deployment:persona-prefix";
/** 官方固定开场白段名，order -1000。 */
const HARNESS_IDENTITY = "harness:identity";
const VARIABLE = "roroko_preinject_system";
/**
* 段名是否命中抹除清单。
* 清单项以 `*` 结尾时按前缀匹配（`tool:*` 抹掉所有 `tool:` 开头的段）。
*/
function matchesSuppress(name, patterns) {
	for (const pattern of patterns) if (pattern.endsWith("*")) {
		if (name.startsWith(pattern.slice(0, -1))) return true;
	} else if (name === pattern) return true;
	return false;
}
/**
* 内置抹除的段：清单只能加，不能减。
*
*   context:file-reference          @文件引用语法说明（"Tokens prefixed with @ …"）
*   tool:*                          各工具的使用说明大段（read/write/edit/glob/grep/
*                                   bash/web_search/web_fetch…）—— 工具 schema 里本来
*                                   就有参数说明，这一大段是重复叙事
*   ui:deliverable-file-references  "Prefer showing the primary results…" 交付物/链接规范
*   harness:source                  实现仓库自检指引（我们不在改 DSH 本体）
*   app:web-surface                 Web GUI 自述与「别乱起服务器」指引
*
* 支持尾部 `*` 前缀匹配，所以 `tool:*` 一网打尽，新装工具也不用改代码。
*/
const BUILTIN_SUPPRESS_SECTIONS = [
	"context:file-reference",
	"tool:*",
	"ui:deliverable-file-references",
	"harness:source",
	"app:web-surface"
];
/** 内置默认（最底层）。 */
const DEFAULTS = {
	systemFiles: [],
	userFiles: [],
	suppressSections: []
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
	const extra = bucket.suppressSections ?? config.suppressSections ?? DEFAULTS.suppressSections;
	return {
		systemFiles: bucket.systemFiles ?? config.systemFiles ?? DEFAULTS.systemFiles,
		userFiles: bucket.userFiles ?? config.userFiles ?? DEFAULTS.userFiles,
		suppressSections: [.../* @__PURE__ */ new Set([...BUILTIN_SUPPRESS_SECTIONS, ...extra])]
	};
}
const dshHome$2 = () => process.env.DSH_HOME ?? join(homedir(), ".dsh");
/** 默认身份根。 */
function defaultRoot$2() {
	return join(dshHome$2(), "roroko");
}
/** 清单项解析：相对 root；`~/` 走主目录；绝对路径原样。 */
function entryPath(name, root) {
	if (isAbsolute(name)) return name;
	if (name === "~") return homedir();
	if (name.startsWith("~/") || name.startsWith("~\\")) return join(homedir(), name.slice(2));
	return resolve(root, name);
}
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
function mount$2(ctx, rawConfig = {}) {
	const surface = ctx;
	const config = { ...rawConfig };
	const root = rawConfig.root !== void 0 && rawConfig.root.length > 0 ? rawConfig.root : defaultRoot$2();
	/**
	* 本实例所属 preset id（**实例变量，不是模块变量**——两个 preset 的实例共享
	* 同一份模块，模块级变量会互相串）。
	*
	* 为什么必须在 pre-step 之外也记一次：一次 step 的顺序是
	* `assemble(系统提示词) → agent/pre-step`（见 agent-loop 的 preStep），所以
	* 一个会话的**首次装配**永远早于它的首次 pre-step。只听 pre-step 的话，
	* 新会话第一轮的系统段就是空的——之前就是栽在这儿。`agent/created` 在会话
	* 创建时就触发且被等待，从那里拿 header.agentPreset 才能喂到首装配。
	*/
	let activePreset;
	const remember = (presetId) => {
		if (presetId !== void 0 && presetId.length > 0) activePreset = presetId;
	};
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
	/**
	* 按名抹掉系统段。装配瀑布是 scope 过滤的，这里只收本 preset 的装配；
	* `complete` 段由装配侧恢复，所以抹不掉李代桃僵的那一段（也不该抹）。
	*/
	surface.on("system-prompt/assemble", async (assembly, _context, next) => {
		const result = await next();
		try {
			const drop = resolveEffective(config, readState(root), activePreset).suppressSections;
			if (drop.length === 0) return result;
			const kept = result.sections.filter((section) => !matchesSuppress(section.name, drop));
			return kept.length === result.sections.length ? result : {
				...result,
				sections: kept
			};
		} catch {
			return result;
		}
	});
	surface.on("agent/created", async (payload) => {
		remember(payload.agent?.session?.header?.agentPreset);
	});
	surface.on("agent/pre-step", async (payload, next) => {
		const decision = await next();
		if (decision.kind !== "enter") return decision;
		const session = payload.agent.session;
		const presetId = session?.header?.agentPreset;
		remember(presetId);
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
			source: { kind: moduleName$2 }
		});
		return {
			...decision,
			messages: [...decision.messages ?? [], message]
		};
	});
}
//#endregion
//#region src/datas/query-form.ts
const TABLES = {
	scene: {
		table: "scenes",
		nameCol: "name",
		timeCol: "last_used_at",
		hasSlot: false,
		hasLevels: false,
		defaultLimit: 5
	},
	clothing: {
		table: "clothing",
		nameCol: "name",
		timeCol: "last_used_at",
		hasSlot: true,
		hasLevels: true,
		defaultLimit: 2
	},
	items: {
		table: "sexual_items",
		nameCol: "name",
		timeCol: "last_used_at",
		hasSlot: false,
		hasLevels: false,
		defaultLimit: 3
	},
	companion: {
		table: "companion_pool",
		nameCol: "profession",
		timeCol: "last_used",
		hasSlot: false,
		hasLevels: false,
		defaultLimit: 5
	}
};
/** 关键词列解析:JSON 数组优先,回落裸逗号串(库里两种形态都出现过)。 */
function parseKeywords(value) {
	if (typeof value !== "string" || value.trim().length === 0) return [];
	const raw = value.trim();
	if (raw.startsWith("[")) try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) return parsed.map(String).map((s) => s.trim()).filter((s) => s.length > 0);
	} catch {}
	return raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}
/** 查询词拆分:逗号分隔、去空白、去重。 */
function splitKws(raw) {
	if (typeof raw !== "string") return [];
	const out = [];
	for (const part of raw.split(",")) {
		const kw = part.trim();
		if (kw.length > 0 && !out.includes(kw)) out.push(kw);
	}
	return out;
}
/** 逗号分隔清单 → 数组(slot 参数)。 */
function splitSlots(raw) {
	if (typeof raw !== "string") return [];
	const out = [];
	for (const part of raw.split(",")) {
		const slot = part.trim();
		if (slot.length > 0 && !out.includes(slot)) out.push(slot);
	}
	return out;
}
/** 数值字段兜底。 */
function num(value, fallback) {
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) ? n : fallback;
}
/**
* 关键词打分:只认**长度 ≥2** 的记录侧 token(单字 token 不作命中依据)。
* 完全相等 +2,单向包含 +1。无查询词 → 恒 0(走发散)。
*/
function scoreRow(row, kws) {
	if (kws.length === 0) return 0;
	const tokens = parseKeywords(row.keywords).filter((t) => t.length >= 2);
	let score = 0;
	for (const qk of kws) for (const tk of tokens) if (qk === tk) score += 2;
	else if (tk.includes(qk) || qk.includes(tk)) score += 1;
	return score;
}
/** 洗牌(rng 注入)。 */
function shuffle(items, rng) {
	for (let i = items.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		const tmp = items[i];
		items[i] = items[j];
		items[j] = tmp;
	}
	return items;
}
/**
* 取候选:匹配 → 收束 → 池内抽取。
*
* 先洗牌再按分数**稳定**排序 —— 分数段内天然随机(每次调用结果会变),
* 不用 hit_count 也不用"多久没用"当排序键。
*/
function pickCandidates(rows, options) {
	const spec = TABLES[options.tableKey];
	const rng = options.rng ?? Math.random;
	const usedKws = options.kws.filter((k) => k.length >= 2);
	const droppedKws = options.kws.filter((k) => k.length < 2);
	let matched = rows.map((row, index) => ({
		row,
		index,
		score: scoreRow(row, options.kws)
	}));
	if (options.kws.length > 0) matched = matched.filter((item) => item.score > 0);
	shuffle(matched, rng);
	matched.sort((a, b) => b.score - a.score);
	const matchedCount = matched.length;
	let pool = matched;
	const steps = [];
	const narrow = (label, keep) => {
		const before = pool.length;
		pool = pool.filter((item) => keep(item.row));
		steps.push({
			label,
			before,
			after: pool.length
		});
	};
	const slotFilter = options.filters.slot ?? [];
	if (spec.hasSlot && slotFilter.length > 0) narrow(`slot∈[${slotFilter.join(",")}]`, (row) => slotFilter.includes(String(row.slot ?? "")));
	if (spec.hasLevels && options.filters.revealLevel !== void 0) {
		const cap = options.filters.revealLevel;
		narrow(`reveal_level≤${cap}`, (row) => num(row.reveal_level, 1) <= cap);
	}
	if (spec.hasLevels && options.filters.signalLevel !== void 0) {
		const floor = options.filters.signalLevel;
		narrow(`signal_level≥${floor}`, (row) => num(row.signal_level, 0) >= floor);
	}
	const slotStats = spec.hasSlot ? slotDistribution(rows) : [];
	const limit = clampLimit(options.limit);
	const groups = [];
	if (spec.hasSlot) {
		const buckets = /* @__PURE__ */ new Map();
		for (const item of pool) {
			const raw = String(item.row.slot ?? "").trim();
			const list = buckets.get(raw);
			if (list === void 0) buckets.set(raw, [item]);
			else list.push(item);
		}
		const keys = [...buckets.keys()].sort((a, b) => {
			if (a === "") return 1;
			if (b === "") return -1;
			return buckets.get(b).length - buckets.get(a).length;
		});
		for (const raw of keys) {
			const list = buckets.get(raw);
			groups.push({
				slot: raw.length > 0 ? raw : "(未分类)",
				raw,
				rows: list.slice(0, limit).map((item) => item.row),
				poolSize: list.length
			});
		}
		for (const raw of options.filters.slot ?? []) {
			if (buckets.has(raw)) continue;
			groups.push({
				slot: raw,
				raw,
				rows: [],
				poolSize: 0
			});
		}
	}
	return {
		poolSize: pool.length,
		matched: matchedCount,
		steps,
		rows: spec.hasSlot ? [] : pool.slice(0, limit).map((item) => item.row),
		groups,
		slotStats,
		usedKws,
		droppedKws
	};
}
/** 槽位分布:按条数降序;空槽位归 `(未分类)`,排在最后。 */
function slotDistribution(rows) {
	const counter = /* @__PURE__ */ new Map();
	for (const row of rows) {
		const slot = String(row.slot ?? "").trim();
		const key = slot.length > 0 ? slot : "(未分类)";
		counter.set(key, (counter.get(key) ?? 0) + 1);
	}
	const out = [...counter.entries()].map(([slot, count]) => ({
		slot,
		count
	}));
	out.sort((a, b) => {
		if (a.slot === "(未分类)") return 1;
		if (b.slot === "(未分类)") return -1;
		return b.count - a.count;
	});
	return out;
}
/** 条数钳制:1~50,非有限数回落默认。 */
function clampLimit(value, fallback = 5) {
	const n = num(value, fallback);
	if (n < 1) return 1;
	if (n > 50) return 50;
	return Math.trunc(n);
}
/** 时间戳 → 相对时间文案(本地口径,库里的时间串本身就是 CST)。 */
function fmtLastUsed(ts, now) {
	if (typeof ts !== "string" || ts.trim().length === 0) return "从未";
	const parsed = new Date(ts.trim().replace(" ", "T"));
	if (Number.isNaN(parsed.getTime())) return "从未";
	const minutes = (now.getTime() - parsed.getTime()) / 6e4;
	if (minutes < 1) return "刚刚";
	if (minutes < 60) return `${Math.floor(minutes)}min前`;
	if (minutes < 1440) return `${Math.floor(minutes / 60)}h前`;
	return `${Math.floor(minutes / 1440)}d前`;
}
/** 单行"已用次数 / 最后使用"单元格。 */
function usageCell(row, spec, now) {
	const hits = num(row.hit_count, 0);
	const last = fmtLastUsed(row[spec.timeCol], now);
	return [String(hits), hits > 0 && last === "从未" ? "未记录" : last];
}
/** 渲染 query 结果为 markdown(有 kw 标题带关键词,无 kw 标"发散")。 */
function renderQuery(input) {
	const spec = TABLES[input.tableKey];
	const pick = input.pick;
	const now = input.now ?? /* @__PURE__ */ new Date();
	const title = input.kws.length > 0 ? input.kws.join("、") : "发散(无条件)";
	const lines = [`## 素材 · ${spec.table} · \`${title}\``];
	const heads = [`${input.total} 条`, `被用过 ${input.usedCount} 条`];
	if (spec.hasSlot && pick.slotStats.length > 0) heads.push(`槽位 ${pick.slotStats.map((s) => `${s.slot} ${s.count}`).join(" / ")}`);
	lines.push(`表概览:${heads.join(" · ")}`);
	if (pick.steps.length > 0) lines.push(`收束:${pick.steps.map((s) => `${s.label} ${s.before}→${s.after}`).join(" ｜ ")}`);
	if (pick.droppedKws.length > 0) lines.push(`(单字词 ${pick.droppedKws.join("、")} 不作命中依据,已忽略)`);
	const hasNote = pick.rows.some((r) => String(r.note ?? "").length > 0) || pick.groups.some((g) => g.rows.some((r) => String(r.note ?? "").length > 0));
	const head = ["名称"];
	if (spec.hasSlot) head.push("槽位");
	if (spec.hasLevels) head.push("reveal", "signal");
	if (input.tableKey === "items") head.push("intensity");
	head.push("已用", "最后使用");
	if (hasNote) head.push("备注");
	const rowOf = (row) => {
		const cells = [String(row[spec.nameCol] ?? "?").replaceAll("|", "/")];
		if (spec.hasSlot) cells.push(String(row.slot ?? "").trim() || "(未分类)");
		if (spec.hasLevels) cells.push(String(num(row.reveal_level, 1)), String(num(row.signal_level, 0)));
		if (input.tableKey === "items") cells.push(`${num(row.intensity_min, 0)}~${num(row.intensity_max, 0)}`);
		const [hits, last] = usageCell(row, spec, now);
		cells.push(hits, last);
		if (hasNote) cells.push(String(row.note ?? "").replaceAll("|", "/"));
		return `| ${cells.join(" | ")} |`;
	};
	lines.push("");
	lines.push(`| ${head.join(" | ")} |`);
	lines.push(`|${head.map(() => "---").join("|")}|`);
	if (spec.hasSlot) for (const group of pick.groups) {
		lines.push(`| **${group.slot}** |${head.slice(1).map(() => " |").join("")}`);
		if (group.rows.length === 0) {
			lines.push(`| *(无候选)* |${head.slice(1).map(() => " |").join("")}`);
			continue;
		}
		for (const row of group.rows) lines.push(rowOf(row));
	}
	else for (const row of pick.rows) lines.push(rowOf(row));
	const short = spec.hasSlot ? pick.groups.length === 0 : pick.poolSize < input.limit;
	if (pick.poolSize === 0 || input.kws.length > 0 && pick.matched === 0) {
		lines.push("");
		lines.push("关键词未命中 → 建议 `roroko_datas_register` 把新条目落库,别凭空设计");
	} else if (short) {
		lines.push("");
		lines.push(`候选不足(${pick.poolSize} 条)→ 可用 \`roroko_datas_register\` 补充落库`);
	}
	if (!spec.hasSlot && input.adhoc.length > 0) {
		lines.push("");
		lines.push("| ad_hoc 临时条目 | 说明 |");
		lines.push("|---|---|");
		for (const item of input.adhoc.slice(0, 8)) lines.push(`| ${item.name.replaceAll("|", "/")} | ${item.description.replaceAll("|", "/")} |`);
	}
	return lines.join("\n");
}
//#endregion
//#region src/datas/query.ts
/**
* roroko_datas_query — 取料:表概览 + 候选召回(发散默认 / 条件收束)。
*
* 本文件只管 DB 访问与工具注册,取料逻辑全在 query-form.ts(纯函数,可离线测)。
*
* 设计铁律(2026-09-15 定稿):
*   - 库不当裁判 —— 只给池子,条件由模型给;不给条件即发散
*   - 新鲜度与 hit_count 不参与排序(会永远推同几条 / 推出不合情景的东西)
*   - 用现有列,不加列;slot 分组键从库里动态取
*
* 性能口径:素材表最大规模 128 行(clothing),**全取进内存再匹配** —— SQL 的
* `keywords LIKE` 无法表达"单字 token 不算命中",硬塞进 SQL 只会把口径搞脏;
* 这个量级全取的成本可以忽略,换来的是匹配规则完全可控、可离线复现。
*/
const TABLE_KEYS = [
	"scene",
	"clothing",
	"items",
	"companion"
];
/** 关键词热度累加(搜索侧的既有口径:只累加 keywords 字典,不碰主表 hit_count)。 */
function ensureKeywords(db, kws) {
	if (kws.length === 0) return;
	try {
		const upsert = db.prepare("INSERT INTO keywords (word, hit_count) VALUES (?, 1) ON CONFLICT(word) DO UPDATE SET hit_count = hit_count + 1");
		for (const kw of kws) upsert.run(kw);
	} catch {}
}
/** ad_hoc 补位候选:同名只留最新一条(现库里有"烟"×3、"冰饮"×2 这种重复行)。 */
function adHocRows(db, tableName, exclude) {
	const rows = db.prepare("SELECT name, description FROM ad_hoc WHERE type = ? ORDER BY id DESC").all(tableName);
	const seen = new Set(exclude);
	const out = [];
	for (const row of rows) {
		const name = String(row.name ?? "").trim();
		if (name.length === 0 || seen.has(name)) continue;
		seen.add(name);
		out.push({
			name,
			description: String(row.description ?? "")
		});
	}
	return out;
}
/** 工具输出统一渲染:text content block。 */
function textRender$2(_args, value) {
	return [{
		type: "text",
		text: value
	}];
}
/** 注册 roroko_datas_query；总开关打开时由 datas/index.ts 调用。
*  @returns 注销函数（关掉总开关时要把工具撤下来）。 */
function applyQuery(ctx, dbPath) {
	return ctx.tools.register(defineTool({
		name: "roroko_datas_query",
		description: "洛洛可素材库取料:查场景/穿搭/道具/伴侣的候选,返回 markdown 表。默认**发散**(池内均匀随机,每次结果不同);给了 kw 或收束条件即**收束**。kw 逗号分隔(如 \"职场,干练\"),关键词越贴切排名越前;clothing 另可给 slot(逗号分隔,如 \"top,bottom\")/ reveal_level(暴露上限≤N)/ signal_level(信号下限≥N);穿搭按槽位分组返回,每组取 limit 条(默认 2),其余表默认 5 条(items 3)。候选不足时会提示用 roroko_datas_register 落库。hit_count 与\"多久没用\"只作展示,不参与排序。",
		parameters: {
			table: {
				type: "string",
				required: true,
				enum: TABLE_KEYS,
				description: "素材表:scene=场景,clothing=穿搭,items=道具,companion=伴侣。"
			},
			kw: {
				type: "string",
				description: "逗号分隔关键词(如 \"职场,干练\")。不给 = 发散:池内均匀随机抽候选。单字词会被忽略。"
			},
			slot: {
				type: "string",
				description: "仅 clothing:限定槽位,逗号分隔(top,bottom,bra,underwear,socks,footwear,hair,accessory,headwear…)。不给 = 全槽位。"
			},
			reveal_level: {
				type: "number",
				description: "仅 clothing:暴露上限。给 2 表示只要 reveal_level ≤ 2 的单品(场合收敛用)。"
			},
			signal_level: {
				type: "number",
				description: "仅 clothing:信号下限。给 3 表示只要 signal_level ≥ 3 的单品(暗示强度下限)。"
			},
			limit: {
				type: "number",
				description: "条数:clothing 是**每个槽位**的条数(默认 2),其余表是总数(默认 5,items 3)。上限 50。"
			}
		},
		output: {
			schema: { type: "string" },
			render: textRender$2
		},
		async execute(args) {
			const spec = TABLES[args.table];
			const db = new DatabaseSync(dbPath());
			try {
				const rows = db.prepare(`SELECT * FROM ${spec.table}`).all();
				const kws = splitKws(args.kw);
				ensureKeywords(db, kws);
				const usedCount = rows.filter((row) => Number(row.hit_count ?? 0) > 0).length;
				const limit = clampLimit(args.limit, spec.defaultLimit);
				const pick = pickCandidates(rows, {
					tableKey: args.table,
					kws,
					filters: {
						slot: splitSlots(args.slot),
						revealLevel: args.reveal_level,
						signalLevel: args.signal_level
					},
					limit
				});
				const adhoc = spec.hasSlot || pick.poolSize >= limit ? [] : adHocRows(db, spec.table, new Set(pick.rows.map((row) => String(row[spec.nameCol] ?? ""))));
				return renderQuery({
					tableKey: args.table,
					kws,
					pick,
					total: rows.length,
					usedCount,
					limit,
					adhoc
				});
			} finally {
				db.close();
			}
		},
		presentCall(args) {
			const sub = args.kw !== void 0 && args.kw.length > 0 ? args.kw : "发散";
			return {
				card: "generic",
				title: `取素材 ${args.table} · ${sub}`,
				kind: "read",
				rawInput: sub
			};
		}
	}));
}
//#endregion
//#region src/datas/state.ts
/** 素材表映射：alias → (真实表名, 名字列)。 */
const TABLE_META = {
	scene: {
		table: "scenes",
		nameCol: "name"
	},
	clothing: {
		table: "clothing",
		nameCol: "name"
	},
	items: {
		table: "sexual_items",
		nameCol: "name"
	},
	sexual_items: {
		table: "sexual_items",
		nameCol: "name"
	},
	companion: {
		table: "companion_pool",
		nameCol: "profession"
	}
};
/** roroko_datas_register 合法 type 键（ad_hoc type 用主表名存）。 */
const REGISTER_TYPES = {
	scene: "scenes",
	clothing: "clothing",
	items: "sexual_items",
	companion: "companion_pool"
};
/** roroko_datas_lookup：按名在四张素材表查详情 → markdown。 */
function runLookup(db, nameQuery) {
	const tables = [
		{
			table: "clothing",
			nameCol: "name",
			cols: [
				"name",
				"slot",
				"reveal_level",
				"signal_level",
				"note"
			]
		},
		{
			table: "sexual_items",
			nameCol: "name",
			cols: [
				"name",
				"intensity_min",
				"intensity_max",
				"note"
			]
		},
		{
			table: "companion_pool",
			nameCol: "profession",
			cols: [
				"profession",
				"body_type",
				"trait",
				"note"
			]
		},
		{
			table: "scenes",
			nameCol: "name",
			cols: ["name", "description"]
		}
	];
	const lines = [];
	for (const meta of tables) {
		const rows = db.prepare(`SELECT * FROM ${meta.table} WHERE ${meta.nameCol} = ?`).all(nameQuery);
		for (const row of rows) {
			lines.push(`## ${meta.table} · ${String(row[meta.nameCol])}`);
			for (const col of meta.cols) {
				const v = row[col];
				if (v === void 0 || v === null || String(v).length === 0) continue;
				lines.push(`- ${col}: ${String(v)}`);
			}
			lines.push("");
		}
	}
	return lines.length > 0 ? lines.join("\n").trim() : `未找到: ${nameQuery}`;
}
/** 名字分词（单字 + 双字），register 合并关键词用。 */
function tokenizeName(name) {
	const cleaned = name.replace(/[·\s　]/g, "");
	const tokens = /* @__PURE__ */ new Set();
	for (const ch of cleaned) tokens.add(ch);
	for (let i = 0; i < cleaned.length - 1; i++) tokens.add(cleaned.slice(i, i + 2));
	return [...tokens];
}
/** roroko_datas_register：ad_hoc 注册，或主表同名合并关键词。 */
function runRegister(db, typeKey, nameInput, desc) {
	const tableName = REGISTER_TYPES[typeKey];
	const meta = TABLE_META[typeKey] ?? {
		table: tableName,
		nameCol: "name"
	};
	const existing = db.prepare(`SELECT id, keywords FROM ${tableName} WHERE ${meta.nameCol} = ?`).get(nameInput);
	if (existing) {
		const merged = /* @__PURE__ */ new Set([...tokenizeName(nameInput)]);
		const curKws = parseKeywords(existing.keywords);
		const newKws = [.../* @__PURE__ */ new Set([...curKws, ...merged])];
		db.prepare(`UPDATE ${tableName} SET keywords = ?, updated_at = datetime('now','localtime') WHERE id = ?`).run(JSON.stringify(newKws), Number(existing.id));
		for (const kw of merged) db.prepare("INSERT OR IGNORE INTO keywords (word) VALUES (?)").run(kw);
		return `已合并关键词到 ${tableName}.${nameInput} (id=${existing.id})\n新增: ${[...merged].join("、")}`;
	}
	return `已注册 ad_hoc #${db.prepare("INSERT INTO ad_hoc (type, name, description) VALUES (?, ?, ?)").run(tableName, nameInput, desc).lastInsertRowid}: ${tableName}/${nameInput}`;
}
/**
* roroko_datas_state snap：读 soul_state 当前状态，输出 markdown + staleness 鞭策。
* 跨天自动清零今日计数器。
*/
function runStateSnap(db, now) {
	const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	const row0 = db.prepare("SELECT last_daily_reset FROM soul_state WHERE id = 1").get();
	if (row0 && String(row0.last_daily_reset ?? "") !== today) db.prepare("UPDATE soul_state SET oral_today=0, vaginal_today=0, anal_today=0, last_daily_reset=? WHERE id=1").run(today);
	const row = db.prepare("SELECT * FROM soul_state WHERE id = 1").get();
	if (!row) return "状态表为空(id=1 不存在)";
	/** 字段 → (类别, 陈旧度阈值分钟列表[score1..4])。 */
	const CATS = {
		body_state: {
			cat: "body",
			minutes: [
				10,
				25,
				60,
				180
			]
		},
		position: {
			cat: "body",
			minutes: [
				10,
				25,
				60,
				180
			]
		},
		sex_state: {
			cat: "body",
			minutes: [
				10,
				25,
				60,
				180
			]
		},
		arousal: {
			cat: "body",
			minutes: [
				10,
				25,
				60,
				180
			]
		},
		fatigue: {
			cat: "body",
			minutes: [
				10,
				25,
				60,
				180
			]
		},
		behavior: {
			cat: "body",
			minutes: [
				10,
				25,
				60,
				180
			]
		},
		companion_role: {
			cat: "body",
			minutes: [
				10,
				25,
				60,
				180
			]
		},
		outfit_top: {
			cat: "outfit",
			minutes: [
				60,
				180,
				360,
				720
			]
		},
		outfit_bottom: {
			cat: "outfit",
			minutes: [
				60,
				180,
				360,
				720
			]
		},
		outfit_bra: {
			cat: "outfit",
			minutes: [
				60,
				180,
				360,
				720
			]
		},
		outfit_underwear: {
			cat: "outfit",
			minutes: [
				60,
				180,
				360,
				720
			]
		},
		outfit_socks: {
			cat: "outfit",
			minutes: [
				60,
				180,
				360,
				720
			]
		},
		outfit_footwear: {
			cat: "outfit",
			minutes: [
				60,
				180,
				360,
				720
			]
		},
		outfit_hair: {
			cat: "outfit",
			minutes: [
				60,
				180,
				360,
				720
			]
		},
		outfit_accessory: {
			cat: "outfit",
			minutes: [
				60,
				180,
				360,
				720
			]
		},
		outfit_outerwear: {
			cat: "outfit",
			minutes: [
				60,
				180,
				360,
				720
			]
		},
		scene: {
			cat: "narrative",
			minutes: [
				20,
				60,
				180,
				360
			]
		},
		truth: {
			cat: "narrative",
			minutes: [
				20,
				60,
				180,
				360
			]
		},
		decision: {
			cat: "narrative",
			minutes: [
				20,
				60,
				180,
				360
			]
		},
		sexual_items: {
			cat: "narrative",
			minutes: [
				20,
				60,
				180,
				360
			]
		}
	};
	/** 各字段鞭策短语（score 1→index 0,4→index 3）。 */
	const WHIPS = {
		body_state: [
			"身体该有变化了,更新~",
			"身体僵了,扭扭换个体位~",
			"同一状态太久,快更新~",
			"体温都要凉了,赶紧更新~"
		],
		position: [
			"该挪挪屁股换地方了,更新~",
			"还在原地?快更新~",
			"位置陈旧,换个场景~",
			"定住了?立刻更新!"
		],
		sex_state: [
			"该动动了,在等下个阶段~",
			"状态凝固了,快更新~",
			"原地踏步太久,赶紧更新~",
			"死水一潭,立刻更新!"
		],
		arousal: [
			"放了这么久,更新数值~",
			"数值不动弹,快更新~",
			"时间太久,赶紧更新~",
			"arousal冻住了,赶紧更新!"
		],
		fatigue: [
			"隔了这么久,更新~",
			"数值不动弹,快更新~",
			"时间太久,赶紧更新~",
			"fatigue烂了,赶紧更新!"
		],
		behavior: [
			"该换种演法了,更新~",
			"同一套演太久,快更新~",
			"演技套路化,赶紧更新~",
			"behavior烂了,立刻更新!"
		],
		companion_role: [
			"该换伴侣了,更新~",
			"同一角色太久,快更新~",
			"伴侣陈旧,赶紧更新~",
			"没人陪?立刻更新!"
		],
		scene: [
			"该换场景了,更新~",
			"场景陈旧,快更新~",
			"还在原地?赶紧更新~",
			"场景烂了,立刻更新!"
		],
		truth: [
			"真相该发酵了,更新~",
			"truth静置太久,快更新~",
			"真相没推进,赶紧更新~",
			"truth冻住了,立刻更新!"
		],
		decision: [
			"该换说法骗他了,更新~",
			"decision陈旧,快更新~",
			"同一套谎话用太久,赶紧更新~",
			"decision馊了,立刻更新!"
		],
		sexual_items: [
			"该加道具了,更新~",
			"道具栏空着?快更新~",
			"没有道具,赶紧更新~",
			"空手道!立刻更新!"
		]
	};
	const OUTFIT_WHIPS = [
		"{item}皱了没?更新穿搭~",
		"{item}该让衣料讲故事了,快更新~",
		"{item}穿太久了,赶紧更新~",
		"{item}穿出包浆了,立刻更新!"
	];
	const SCORE_WHIPS = [
		[70, "所有state都过期啦!快全量更新!"],
		[60, "该完全重构state啦!"],
		[50, "这个瞬间已完全过期,快更新!"],
		[40, "大半state过期啦,快更新!"],
		[30, "间隔太长啦,快更新state!"],
		[20, "洛洛可是定在原地了吗?快更新!"],
		[10, "好久没动啦,快更新!"],
		[0, "有些state过期,更新对应值!"]
	];
	let total = 0;
	const whipMap = /* @__PURE__ */ new Map();
	const maxScore = Object.keys(CATS).length * 4;
	for (const [field, spec] of Object.entries(CATS)) {
		const tsStr = row[`${field}_updated`];
		if (typeof tsStr !== "string" || tsStr.trim().length === 0) continue;
		const t = new Date(tsStr.replace(" ", "T"));
		if (Number.isNaN(t.getTime())) continue;
		const minutes = (now.getTime() - t.getTime()) / 6e4;
		const score = spec.minutes.filter((m) => minutes > m).length;
		if (score <= 0) continue;
		total += score;
		const idx = score - 1;
		const phrase = spec.cat === "outfit" ? OUTFIT_WHIPS[idx].replace("{item}", String(row[field] ?? "它")) : WHIPS[field]?.[idx];
		if (phrase) whipMap.set(field, phrase);
	}
	let finalWhip = SCORE_WHIPS[SCORE_WHIPS.length - 1][1];
	for (const [threshold, phrase] of SCORE_WHIPS) if (total >= threshold) {
		finalWhip = phrase;
		break;
	}
	const display = (key) => {
		const v = row[key];
		if (v === void 0 || v === null || String(v).length === 0 || String(v) === "无" || String(v) === "[]") return "";
		if (key === "sexual_items") try {
			const items = JSON.parse(String(v));
			if (Array.isArray(items)) return items.map((i) => i.name ?? "").filter(Boolean).join(", ");
		} catch {}
		return String(v).replaceAll("|", "/");
	};
	const order = [
		"scene",
		"truth",
		"decision",
		"position",
		"body_state",
		"behavior",
		"sex_state",
		"arousal",
		"fatigue",
		"outfit_top",
		"outfit_bottom",
		"outfit_bra",
		"outfit_underwear",
		"outfit_socks",
		"outfit_footwear",
		"outfit_hair",
		"outfit_accessory",
		"outfit_outerwear",
		"companion_role",
		"sexual_items"
	];
	const lines = [
		"## state",
		"",
		"| 字段 | 值 | 鞭策 |",
		"|------|-----|------|"
	];
	for (const key of order) {
		const value = display(key);
		if (!value) continue;
		lines.push(`| ${key} | ${value} | ${whipMap.get(key) ?? ""} |`);
	}
	lines.push("", "## 计数器", "| name | today | total |", "|------|-------|-------|");
	for (const base of [
		"oral",
		"vaginal",
		"anal"
	]) lines.push(`| ${base} | ${String(row[`${base}_today`] ?? 0)} | ${String(row[`${base}_total`] ?? 0)} |`);
	lines.push("", `now: ${now.toISOString().slice(0, 16).replace("T", " ")} (UTC)`, `staleness: ${total}/${maxScore} ${finalWhip}`);
	return lines.join("\n");
}
/** roroko_datas_state update 字段白名单。 */
const STATE_FIELD_COLS = [
	"scene",
	"truth",
	"decision",
	"position",
	"body_state",
	"behavior",
	"sex_state",
	"arousal",
	"fatigue",
	"companion_present",
	"companion_role",
	"outfit_top",
	"outfit_bottom",
	"outfit_bra",
	"outfit_underwear",
	"outfit_socks",
	"outfit_footwear",
	"outfit_hair",
	"outfit_accessory",
	"outfit_outerwear",
	"sexual_items",
	"oral_today",
	"vaginal_today",
	"anal_today",
	"oral_total",
	"vaginal_total",
	"anal_total",
	"last_sex_date"
];
/** 带 `*_updated` 自动同步时间戳的字段。 */
const TS_SYNC_FIELDS = /* @__PURE__ */ new Set([
	"scene",
	"truth",
	"decision",
	"position",
	"body_state",
	"behavior",
	"sex_state",
	"arousal",
	"fatigue",
	"companion_role",
	"sexual_items",
	"outfit_top",
	"outfit_bottom",
	"outfit_bra",
	"outfit_underwear",
	"outfit_socks",
	"outfit_footwear",
	"outfit_hair",
	"outfit_accessory",
	"outfit_outerwear"
]);
/** 整数约束字段。 */
const INT_FIELDS = /* @__PURE__ */ new Set([
	"arousal",
	"fatigue",
	"companion_present",
	"oral_today",
	"vaginal_today",
	"anal_today",
	"oral_total",
	"vaginal_total",
	"anal_total"
]);
/** roroko_datas_state update：宽松 fields → 白名单列写回，含 incr 快捷计数。 */
function runStateUpdate(db, fields, now) {
	const tsNow = now.toISOString().slice(0, 19).replace("T", " ");
	const updates = /* @__PURE__ */ new Map();
	const unknown = [];
	for (const [key, raw] of Object.entries(fields)) {
		if (key.startsWith("incr_")) continue;
		if (!STATE_FIELD_COLS.includes(key)) {
			unknown.push(key);
			continue;
		}
		if (INT_FIELDS.has(key)) {
			const n = Number(raw);
			updates.set(key, Number.isFinite(n) ? Math.trunc(n) : 0);
		} else updates.set(key, String(raw));
		if (TS_SYNC_FIELDS.has(key)) updates.set(`${key}_updated`, tsNow);
	}
	const incrBases = [];
	for (const base of [
		"oral",
		"vaginal",
		"anal"
	]) if (fields[`incr_${base}`] === true) incrBases.push(base);
	if (updates.size > 0) {
		const sql = `UPDATE soul_state SET ${[...updates.keys()].map((c) => `${c} = ?`).join(", ")} WHERE id = 1`;
		db.prepare(sql).run(...updates.values());
	}
	if (incrBases.length > 0) {
		const sets = incrBases.map((b) => `${b}_today = ${b}_today + 1, ${b}_total = ${b}_total + 1`).join(", ");
		db.prepare(`UPDATE soul_state SET ${sets} WHERE id = 1`).run();
	}
	if (updates.has("scene")) db.prepare("UPDATE scenes SET hit_count = hit_count + 1, updated_at = ?, last_used_at = ? WHERE name = ?").run(tsNow, tsNow, String(updates.get("scene")));
	if (updates.has("sexual_items")) {
		const names = String(updates.get("sexual_items")).split(",").map((s) => {
			const trimmed = s.trim().replace(/^\[|\]$/g, "");
			const jsonMatch = trimmed.match(/"name"\s*:\s*"([^"]*)"/);
			return (jsonMatch ? jsonMatch[1] : trimmed.replace(/^"|"$/g, "")).trim();
		}).filter((s) => s.length > 0);
		for (const nm of names) db.prepare("UPDATE sexual_items SET hit_count = hit_count + 1, updated_at = ?, last_used_at = ? WHERE name = ?").run(tsNow, tsNow, nm);
	}
	for (const [key, value] of updates) {
		if (!key.startsWith("outfit_") || key.endsWith("_updated")) continue;
		db.prepare("UPDATE clothing SET hit_count = hit_count + 1, updated_at = ?, last_used_at = ? WHERE name = ?").run(tsNow, tsNow, String(value));
	}
	const summary = [];
	if (updates.size > 0) {
		const setKeys = [...updates.keys()].filter((k) => !k.endsWith("_updated"));
		summary.push(`已更新: ${setKeys.join("、")}`);
	}
	if (incrBases.length > 0) summary.push(`计数器 +1: ${incrBases.join("、")}`);
	if (unknown.length > 0) summary.push(`忽略未知字段: ${unknown.join("、")}`);
	summary.push(`now: ${tsNow}`);
	return summary.join("\n");
}
//#endregion
//#region src/datas/presets.ts
/**
* datas/presets.ts — 素材库参数的持久化：按 agent preset 分桶的覆盖层。
*
* 存储：`<root>/state/datas.json`，结构与 preinject.json 同形但**分文件**：
*
*   { "presets": { "common": { "dbPath": "...", "autoinject": { … } }, "roroko": { … } } }
*
* 分文件是刻意的：preinject 管「注入什么文件」，datas 管「连哪个库、多久注一次
* 状态」，两套键混一个文件下个月没人看得懂。
*
* 合成链（逐字段回落，缺字段才算未覆盖）：
*
*   内置默认 ← preset 接线 config ← 公共桶 common ← 分 preset 桶
*
* 读写模式照抄 preinject：读同步（pre-step 里要用）、写原子（临时文件 + rename）、
* 坏文件当没有。
*/
/** 公共默认桶名。 */
const COMMON$2 = "common";
/** 服务器默认库路径（0.1.6 一贯口径）。 */
const DEFAULT_DB_PATH = "/var/www/api/database/soul.db";
/** 内置默认（最底层）。 */
const AUTOINJECT_DEFAULTS = {
	rounds: true,
	every: 8,
	afterTool: true,
	minGap: 4
};
/** 桶里认的键。 */
const BUCKET_KEYS$1 = [
	"enabled",
	"dbPath",
	"autoinject"
];
/** 覆盖层文件。 */
function datasStateFile(root) {
	return join(root, "state", "datas.json");
}
/** 整数收窄：有限数取整，钳到 [min, max]，非法回落 fallback。 */
function clampInt$2(value, fallback, min, max) {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n)) return fallback;
	const int = Math.trunc(n);
	if (int < min) return min;
	if (int > max) return max;
	return int;
}
/** autoinject 清洗：只留给了的字段，一个都没给就丢（返回 undefined = 这一组没覆盖）。 */
function cleanAutoinject(value) {
	if (value === null || typeof value !== "object") return void 0;
	const raw = value;
	const out = {};
	if (typeof raw.rounds === "boolean") out.rounds = raw.rounds;
	if (typeof raw.afterTool === "boolean") out.afterTool = raw.afterTool;
	if (raw.every !== void 0) out.every = clampInt$2(raw.every, AUTOINJECT_DEFAULTS.every, 1, 200);
	if (raw.minGap !== void 0) out.minGap = clampInt$2(raw.minGap, AUTOINJECT_DEFAULTS.minGap, 0, 200);
	return Object.keys(out).length > 0 ? out : void 0;
}
/** 桶清洗：只留合法字段，一个都不剩就当没这个桶。 */
function cleanBucket$1(value) {
	if (value === null || typeof value !== "object") return void 0;
	const raw = value;
	const out = {};
	if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
	if (typeof raw.dbPath === "string" && raw.dbPath.trim().length > 0) out.dbPath = raw.dbPath.trim();
	const autoinject = cleanAutoinject(raw.autoinject);
	if (autoinject !== void 0) out.autoinject = autoinject;
	return Object.keys(out).length > 0 ? out : void 0;
}
/** 读整份覆盖层（同步：pre-step 判定要用）。 */
function readDatasState(root) {
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(datasStateFile(root), "utf8"));
	} catch {
		return { presets: {} };
	}
	if (parsed === null || typeof parsed !== "object") return { presets: {} };
	const presets = {};
	const raw = parsed.presets;
	if (raw !== null && typeof raw === "object") for (const [scope, bucket] of Object.entries(raw)) {
		const cleaned = cleanBucket$1(bucket);
		if (cleaned !== void 0) presets[scope] = cleaned;
	}
	return { presets };
}
/** 原子写整份覆盖层。 */
async function saveDatasState(root, state) {
	const file = datasStateFile(root);
	await mkdir(dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	await rename(tmp, file);
}
/**
* 部分覆盖某个桶：body 里给了的字段盖上去，没给的保留。
* 传 `null` 表示删掉该键；合并后空桶直接删掉（回到跟随下层）。
* @param root - 身份根。
* @param scope - 桶名（common 或 preset id）。
* @param patch - 待写入字段。
* @returns 落盘后的整份状态。
*/
async function setDatasBucket(root, scope, patch) {
	const current = readDatasState(root);
	const merged = { ...current.presets[scope] };
	for (const key of BUCKET_KEYS$1) {
		if (!(key in patch)) continue;
		if (patch[key] === null) delete merged[key];
		else merged[key] = patch[key];
	}
	const cleaned = cleanBucket$1(merged);
	const presets = { ...current.presets };
	if (cleaned === void 0) delete presets[scope];
	else presets[scope] = cleaned;
	const next = { presets };
	await saveDatasState(root, next);
	return next;
}
/**
* 删掉某个桶（该 preset 回到公共默认 / 接线 config）。
* @param root - 身份根。
* @param scope - 桶名。
* @returns 落盘后的整份状态。
*/
async function clearDatasBucket(root, scope) {
	const current = readDatasState(root);
	if (!(scope in current.presets)) return current;
	const presets = { ...current.presets };
	delete presets[scope];
	const next = { presets };
	await saveDatasState(root, next);
	return next;
}
/** 接线层原样（没写的字段就是没写）。 */
function datasWiring(config) {
	const out = {};
	if (config.enabled !== void 0) out.enabled = config.enabled;
	if (config.dbPath !== void 0) out.dbPath = config.dbPath;
	if (config.autoinject !== void 0) out.autoinject = config.autoinject;
	return out;
}
/**
* 四层合成：默认 ← 接线 config ← 公共桶 ← 分 preset 桶。
* @param config - preset 接线层。
* @param state - 覆盖层状态。
* @param presetId - 会话的 preset id；空 = 只吃公共桶。
* @returns 该 preset 生效的参数。
*/
function resolveDatas(config, state, presetId) {
	const specific = presetId === void 0 || presetId === "common" ? void 0 : state.presets[presetId];
	const merged = {
		...state.presets[COMMON$2],
		...specific
	};
	const wiringPath = config.dbPath !== void 0 && config.dbPath.trim().length > 0 ? config.dbPath.trim() : void 0;
	return {
		enabled: merged.enabled ?? config.enabled ?? false,
		dbPath: merged.dbPath ?? wiringPath ?? "/var/www/api/database/soul.db",
		autoinject: {
			...AUTOINJECT_DEFAULTS,
			...config.autoinject,
			...merged.autoinject
		}
	};
}
/** 轮数阈值收窄:整数、1~200,非法值回落默认。 */
function clampRounds(value) {
	const n = Number(value);
	if (!Number.isFinite(n)) return 8;
	const int = Math.trunc(n);
	if (int < 1) return 1;
	if (int > 200) return 200;
	return int;
}
/** 最短间隔收窄:整数、0~200,非法值回落默认(4)。 */
function clampMinGap(value) {
	const n = Number(value);
	if (!Number.isFinite(n)) return 4;
	const int = Math.trunc(n);
	if (int < 0) return 0;
	if (int > 200) return 200;
	return int;
}
/**
* 最短间隔是否已满足。从未注入过(NaN)放行;minGap ≤ 0 视为不限制。
* 存在的意义:取料工具一多,"工具后注入"会退化成每轮都注的漏斗。
*/
function gapSatisfied(turn, lastTurn, minGap) {
	if (!Number.isFinite(lastTurn)) return true;
	const gap = clampMinGap(minGap);
	if (gap <= 0) return true;
	return Number.isFinite(turn) && turn - lastTurn >= gap;
}
/** 本地日期戳(YYYY-MM-DD)。禁用 toISOString —— 那是 UTC,会差 8 小时。 */
function todayStamp(now) {
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
/** 轮数是否到期:从未注过(NaN)视为到期。 */
function dueByRounds(turn, lastTurn, every) {
	if (!Number.isFinite(lastTurn)) return true;
	return (Number.isFinite(turn) ? turn - lastTurn : 0) >= clampRounds(every);
}
/** 工具名是否属于取料工具族(机制本身不注册工具,不会被自己的监听器命中)。 */
function isRorokoDatasTool(name) {
	return typeof name === "string" && name.startsWith("roroko_datas_");
}
/**
* 唯一判定出口。优先级:闸门 → 压缩释放 → **最短间隔** → 工具后 → 轮数。
* 同一 turn 已注过则一律不注(哪怕 forced)。
*/
function decide(input) {
	if (Number.isFinite(input.injectedTurn) && input.injectedTurn === input.turn) return {
		inject: false,
		source: null
	};
	if (input.forced && input.roundsEnabled) return {
		inject: true,
		source: "rounds"
	};
	if (!gapSatisfied(input.turn, input.lastTurn, input.minGap)) return {
		inject: false,
		source: null
	};
	if (input.pending && input.afterToolEnabled) return {
		inject: true,
		source: "after-tool"
	};
	if (input.roundsEnabled && dueByRounds(input.turn, input.lastTurn, input.every)) return {
		inject: true,
		source: "rounds"
	};
	return {
		inject: false,
		source: null
	};
}
/** 字段取值:空/「无」/空数组一律当没有(与 snap 的 display 同一口径)。 */
function fieldValue(row, key) {
	const raw = row[key];
	if (raw === void 0 || raw === null) return "";
	const text = String(raw).trim();
	if (text.length === 0 || text === "无" || text === "[]") return "";
	return text.replaceAll("|", "/");
}
/**
* 计数器当日值:库里的 last_daily_reset 不是今天 → 当日计数按 0 显示。
* 这里**只读不写**:跨天清零的写侧归 state 刀,注入不该改库。
*/
function counterToday(row, base, today) {
	if (String(row.last_daily_reset ?? "").trim() !== today) return 0;
	return Number(row[`${base}_today`] ?? 0);
}
/**
* 渲染短条。段序固定:叙事 → 计数 → 着装。
* 2026-09-16 阿一拍板:**不限字数**(先让状态说全,长度后面再调)——
* 曾试过 150 字上限,生产库实测一项 position 就 34 字,当场被砍掉着装与计数器。
*/
function renderStateShort(row, now) {
	const today = todayStamp(now);
	const parts = [];
	const push = (key) => {
		const value = fieldValue(row, key);
		if (value.length > 0) parts.push(`${key}=${value}`);
	};
	push("scene");
	push("truth");
	push("decision");
	push("position");
	push("body_state");
	push("behavior");
	push("arousal");
	const counters = [
		"oral",
		"vaginal",
		"anal"
	].map((base) => `${base} ${counterToday(row, base, today)}/${Number(row[`${base}_total`] ?? 0)}`).join(" · ");
	parts.push(`计 ${counters}`);
	const outfit = [
		"outfit_top",
		"outfit_bottom",
		"outfit_bra",
		"outfit_underwear"
	].map((key) => fieldValue(row, key)).filter((value) => value.length > 0);
	if (outfit.length > 0) parts.push(`着装=${outfit.join("/")}`);
	return `[state] ${parts.join(" | ")}`;
}
/** 注入壳:照抄 nanobot 口径(黑川不可见也不知情 —— 只看洛洛可说出口的)。 */
const AutoinjectNotice = ["###下方内容由脚本自动注入###", "roroko_datas_state（黑川不可见也不知情，他只知道洛洛可在消息里说出口的内容）:"].join("\n");
/** 拼最终注入文本。 */
function buildInjectText(short) {
	return `${AutoinjectNotice} ${short}`;
}
//#endregion
//#region src/datas/state-autoinject.ts
/**
* datas/state-autoinject.ts — state 短条自动注入机制（两个入口，一个出口）。
*
* 不进 schema、不注册工具：preset 声明了 config.datas 桶就随取料工具一起生效，
* 开关在设置页（覆盖层 `<root>/state/datas.json` 的 autoinject 字段）。
*
*   tools/result   → 命中 roroko_datas_* → 标记本会话该注入
*   session/event  → 压缩（compaction/*）后置 forced：下一轮不再干等 N 轮
*   agent/pre-step → injectOnce()：唯一出口，判定命中才追加到消息尾部
*
* 为什么挂 pre-step 而不是装配层：它是唯一拿得到 `turn` 的通道，且往
* `decision.messages` 尾部追加只影响后缀 —— 不碰 system 段、不发 schema，
* 不破 KV 前缀缓存（与 preinject 的消息段同一路数）。
*
* 头号纪律：**绝不在这里抛错**。pre-step 监听器抛异常会让整个 step proposal
* 失败，读库失败、渲染异常一律内部吞掉。
*
* ── 0.2.1 适配 ──────────────────────────────────────────────────────────
*   - 注入消息的 source 必须是生产者自有 kind：`{ kind: 'roroko-datas-autoinject' }`。
*     v4 之后没有 catch-all 的 `plugin` kind，旧写法会被 session 格式拒掉。
*   - preset id 同样靠 pre-step 记进实例变量（provider/写入侧都拿不到 session）。
*/
/** 本模块注入消息的来源签名。 */
const moduleName$1 = "roroko-datas-autoinject";
/** 取一条 state 行（只读；跨天清零的写侧归 state 刀，注入不改库）。 */
function readStateRow(dbPath) {
	const db = new DatabaseSync(dbPath);
	try {
		return db.prepare("SELECT * FROM soul_state WHERE id = 1").get();
	} finally {
		db.close();
	}
}
/**
* 注册自动注入机制。
* @param ctx - preset scope 的子 fiber。
* @param root - 身份根（覆盖层目录基准）。
* @param config - preset 接线参数。
* @param presetId - 本实例所在 preset id 的 getter（由 datas/index.ts 在 pre-step 里记）。
* @returns 注销函数（总开关关掉时由调用方拆掉这三个监听器）。
*/
function applyStateAutoinject(ctx, root, config, presetId) {
	const surface = ctx;
	const counters = /* @__PURE__ */ new WeakMap();
	const disposers = [];
	const off = (disposer) => {
		if (typeof disposer === "function") disposers.push(disposer);
	};
	const settings = () => resolveDatas(config, readDatasState(root), presetId());
	const counterOf = (session) => {
		const existing = counters.get(session);
		if (existing !== void 0) return existing;
		const fresh = {
			lastTurn: NaN,
			injectedTurn: NaN,
			pending: false,
			forced: false
		};
		counters.set(session, fresh);
		return fresh;
	};
	off(surface.on("tools/result", (exec) => {
		try {
			if (exec === void 0 || !isRorokoDatasTool(exec.name)) return;
			const session = exec.agent?.session;
			if (session === void 0) return;
			counterOf(session).pending = true;
		} catch {}
	}));
	off(surface.on("session/event", (session, event) => {
		try {
			const type = String(event?.type ?? "");
			if (!type.startsWith("compaction/")) return;
			const counter = counters.get(session);
			if (counter === void 0) return;
			counter.forced = true;
			console.log("[roroko-datas-autoinject] compaction → forced re-inject", type);
		} catch {}
	}));
	off(surface.on("agent/pre-step", async (payload, next) => {
		const decision = await next();
		if (decision.kind !== "enter") return decision;
		const session = payload.agent?.session;
		if (session === void 0) return decision;
		const counter = counterOf(session);
		try {
			const resolved = settings();
			const verdict = decide({
				turn: payload.turn,
				lastTurn: counter.lastTurn,
				injectedTurn: counter.injectedTurn,
				pending: counter.pending,
				forced: counter.forced,
				roundsEnabled: resolved.autoinject.rounds,
				afterToolEnabled: resolved.autoinject.afterTool,
				every: clampRounds(resolved.autoinject.every),
				minGap: clampMinGap(resolved.autoinject.minGap)
			});
			if (!verdict.inject) {
				counter.pending = false;
				return decision;
			}
			const row = readStateRow(resolved.dbPath);
			if (row === void 0) {
				console.log("[roroko-datas-autoinject] state 行不存在,跳过注入");
				counter.pending = false;
				counter.forced = false;
				return decision;
			}
			const text = buildInjectText(renderStateShort(row, /* @__PURE__ */ new Date()));
			const message = createUserMessage({
				content: [{
					type: "text",
					text
				}],
				source: { kind: moduleName$1 }
			});
			counter.lastTurn = payload.turn;
			counter.injectedTurn = payload.turn;
			counter.pending = false;
			counter.forced = false;
			console.log("[roroko-datas-autoinject] inject", verdict.source ?? "-", "turn", payload.turn, "chars", text.length);
			return {
				...decision,
				messages: [...decision.messages, message]
			};
		} catch (error) {
			console.log("[roroko-datas-autoinject] skipped:", error instanceof Error ? error.message : String(error));
			return decision;
		}
	}));
	/** 注销三个监听器（总开关关掉时调用）。 */
	return () => {
		for (const dispose of disposers.splice(0)) try {
			dispose();
		} catch {}
	};
}
//#endregion
//#region src/datas/index.ts
/**
* datas — 素材库子模块挂载口（roroko_datas_* 四把工具 + state 自动注入）。
*
* 0.1.6 里它是独立一行插件（`name: '@roroko-tool/dsh-roroko-tool/data'`），
* 靠模块级 `inject = ['tools']` 静态接线。0.2.1 起收进单入口：preset 只要
* 在 config 里给一个 datas 桶，host 就在 preset scope 里 ctx.inject(['tools'])
* 起子 fiber 挂到这里 —— 工具注册因此天然按 preset 隔离。
*
* 分工：
*   query.ts                → roroko_datas_query（取料：发散 / 收束）
*   state.ts                → roroko_datas_lookup / register / state 的业务
*   state-autoinject.ts     → state 短条自动注入机制（不注册工具）
*   本文件                   → 三把非取料工具的注册 + dbPath 四层链
*
* ── 0.2.1 适配的关键一处 ────────────────────────────────────────────────
* 工具 execute 是异步且可能跨 turn 的，而 dbPath 要按 preset 分桶。preset id
* 只在 pre-step 的 payload 里拿得到，所以本模块自己挂一个透传 pre-step 监听器
* 把它记进实例变量，工具每次 execute 现读。每个 preset 各挂一份实例，值对本
* 实例稳定。
*/
const dshHome$1 = () => process.env.DSH_HOME ?? join(homedir(), ".dsh");
/** 默认身份根（与 preinject 同一个）。 */
function defaultRoot$1() {
	return join(dshHome$1(), "roroko");
}
/** 工具输出统一渲染：text content block。 */
function textRender$1(_args, value) {
	return [{
		type: "text",
		text: value
	}];
}
/** 工具入口：按白名单操作 sqlite（表名列名全来自常量）。 */
function withDb$1(dbPath, fn) {
	const db = new DatabaseSync(dbPath);
	try {
		return fn(db);
	} finally {
		db.close();
	}
}
/**
* 挂载本子模块。由 host 在自己的 ctx 上调用，不单独占一行插件。
* @param ctx - 宿主上下文（通常是 preset scope 里的子 fiber）。
* @param rawConfig - 子模块配置（preset 的 config.datas）。
*/
function mount$1(ctx, rawConfig = {}) {
	const surface = ctx;
	const config = { ...rawConfig };
	const root = rawConfig.root !== void 0 && rawConfig.root.trim().length > 0 ? rawConfig.root.trim() : defaultRoot$1();
	/** 本实例最近一次在 pre-step 里见到的 preset id。 */
	let activePreset;
	/**
	* 总开关。默认关：设置页勾了才注册四把工具、才注入 state 短条。
	*
	* 为什么能做到"点一下就开"：`ctx.tools.register()` 返回注销函数，工具是
	* scope 里的活注册表，加了下一轮请求头就会带上、撤了下一轮就消失（agent-loop
	* 每个 step 比对 header 决定是否重发工具表）。所以这里不靠重挂载，靠每次
	* pre-step / agent/created 现读覆盖层后 start / stop。
	*/
	let started = false;
	let disposers = [];
	surface.effect(() => registerDatasMount({
		root,
		config
	}), "datas.status()");
	surface.on("agent/pre-step", (payload, next) => {
		const presetId = payload.agent?.session?.header?.agentPreset;
		if (presetId !== void 0) activePreset = presetId;
		sync();
		return next();
	});
	surface.on("agent/created", async (payload) => {
		const presetId = payload.agent?.session?.header?.agentPreset;
		if (presetId !== void 0) activePreset = presetId;
		sync();
	});
	/** 每次执行现读：preset 覆盖层可能刚被设置页改过。 */
	const dbPath = () => resolveDatas(config, readDatasState(root), activePreset).dbPath;
	/** 打开：注册四把工具 + 起自动注入。 */
	const start = () => {
		if (started) return;
		started = true;
		disposers.push(applyQuery(ctx, dbPath));
		disposers.push(applyStateAutoinject(ctx, root, config, () => activePreset));
		disposers.push(surface.tools.register(lookupTool));
		disposers.push(surface.tools.register(registerTool));
		disposers.push(surface.tools.register(stateTool));
		console.log("[roroko-datas] enabled → 四把工具已注册");
	};
	/** 关掉：撤工具、拆监听器。 */
	const stop = () => {
		if (!started) return;
		started = false;
		for (const dispose of disposers.splice(0).reverse()) try {
			dispose();
		} catch (error) {
			console.log("[roroko-datas] stop:", error instanceof Error ? error.message : String(error));
		}
		console.log("[roroko-datas] disabled → 工具已撤下");
	};
	/** 按总开关对齐一次（幂等，开关没变就什么都不做）。 */
	const sync = () => {
		try {
			if (resolveDatas(config, readDatasState(root), activePreset).enabled) start();
			else stop();
		} catch (error) {
			console.log("[roroko-datas] sync skipped:", error instanceof Error ? error.message : String(error));
		}
	};
	const lookupTool = defineTool({
		name: "roroko_datas_lookup",
		description: "按名字精确查某素材(场景/穿搭/道具/伴侣)的完整详情,返回过滤后的字段。遇到不认识的名字先查这里。",
		parameters: { name: {
			type: "string",
			required: true,
			description: "要查的元素名,如 \"白衬衫\" / \"健身教练\"。"
		} },
		output: {
			schema: { type: "string" },
			render: textRender$1
		},
		async execute(args) {
			return withDb$1(dbPath(), (db) => runLookup(db, args.name));
		},
		presentCall(args) {
			return {
				card: "generic",
				title: `查详情 ${args.name}`,
				kind: "read",
				rawInput: args.name
			};
		}
	});
	const registerTool = defineTool({
		name: "roroko_datas_register",
		description: "素材兜底注册:场景/穿搭/道具/伴侣不在库里时注册入 ad_hoc 表。若主表已有同名,则把名字分词合并进关键词,不重复录入。type 取 scene|clothing|items|companion。",
		parameters: {
			type: {
				type: "string",
				required: true,
				enum: [
					"scene",
					"companion",
					"clothing",
					"items"
				],
				description: "注册类型:scene=场景,clothing=穿搭,items=道具,companion=伴侣。"
			},
			name: {
				type: "string",
				required: true,
				description: "要注册的名字,如 \"地铁\" / \"外卖骑手\"。"
			},
			desc: {
				type: "string",
				description: "一句话描述,存 ad_hoc.description。"
			}
		},
		output: {
			schema: { type: "string" },
			render: textRender$1
		},
		async execute(args) {
			return withDb$1(dbPath(), (db) => runRegister(db, args.type, args.name, args.desc ?? ""));
		},
		presentCall(args) {
			return {
				card: "generic",
				title: `注册 ${args.type}/${args.name}`,
				kind: "other",
				rawInput: args.name
			};
		}
	});
	const stateTool = defineTool({
		name: "roroko_datas_state",
		description: "洛洛可状态读写:单行状态存叙事(scene/truth/decision/position/body_state/behavior)、身体(sex_state/arousal/fatigue/companion_*)、穿搭(outfit_*)、道具(sexual_items)与计数器(oral/vaginal/anal today+total)。action=snap 读当前状态(markdown,含 stale 陈旧度鞭策,今日计数器跨天自动清零);action=update 写字段:fields 传 {字段: 值}。合法字段见白名单;性状态可用 sex_state;计数器快捷累加传 incr_oral/incr_vaginal/incr_anal 为 true;写 scene/outfit_*/sexual_items 会自动同步对应素材表 hit_count。",
		parameters: {
			action: {
				type: "string",
				required: true,
				enum: ["snap", "update"],
				description: "snap=读状态,update=写字段。"
			},
			fields: {
				type: "json",
				description: "action=update 时的字段对象。合法字段:scene/truth/decision/position/body_state/behavior/sex_state/arousal/fatigue/companion_present/companion_role/outfit_top/outfit_bottom/outfit_bra/outfit_underwear/outfit_socks/outfit_footwear/outfit_hair/outfit_accessory/outfit_outerwear/sexual_items/oral_today/vaginal_today/anal_today/oral_total/vaginal_total/anal_total/last_sex_date,以及 incr_oral/incr_vaginal/incr_anal(布尔快捷+1)。"
			}
		},
		output: {
			schema: { type: "string" },
			render: textRender$1
		},
		async execute(args) {
			const now = /* @__PURE__ */ new Date();
			return withDb$1(dbPath(), (db) => {
				if (args.action === "snap") return runStateSnap(db, now);
				return runStateUpdate(db, args.fields !== void 0 && typeof args.fields === "object" && args.fields !== null ? args.fields : {}, now);
			});
		},
		presentCall(args) {
			const sub = args.action === "snap" ? "snap" : JSON.stringify(args.fields ?? {}).slice(0, 40);
			const kind = args.action === "snap" ? "read" : "other";
			return {
				card: "generic",
				title: `state ${args.action}`,
				kind,
				rawInput: sub
			};
		}
	});
	sync();
}
//#endregion
//#region src/memory/form.ts
/**
* roroko 记忆工具的纯逻辑:时间口径 / 日期区间 / 入参收窄 / 渲染 / DDL 常量。
*
* 与 DB 访问分离(memory-store.ts 负责开库读写),本文件**不 import node 内置与
* DSH 运行时包** —— 零依赖测试直读编译产物,不连库、不点界面就能验整套口径。
*
* 口径(2026-09-18 定稿,见 refs/notes/roroko-memory-design-v1.md):
*   - 时间一律 **CST+0800**,用固定偏移算、**不读运行环境时区**(服务器被设成 UTC 也照对)
*   - 存库格式与 soul.db 的 datetime('now','localtime') 一致:'YYYY-MM-DD HH:mm:ss'
*   - 日期查询拿 created_at 前 10 位做字符串比较,不拼 '23:59:59' 落边界
*   - 默认区间 = **今天 + 昨天**(直接承接既有记忆纪律「今天 + 昨天必读」)
*
* 减法(2026-09-21,阿一拍板"工具就只是简单的 sqlite 工具"):
*   - 检索**只剩一条 SQL**(关键词全都要命中,LIKE 包含匹配):删掉整套汉字 bigram
*     打分 / 覆盖度 / 命中数 / 拉丁整词分流 —— 那些概念模型用不上,人也维护不动
*   - **删召回计数**(recalled):它只当排序次序用,还让同一次查询的结果顺序漂移
*     (字段仍留在库里,旧库不需要迁移,只是代码不再读写)
*   - **删 owner 分桶开关**(owner=all / 工具入参 owner):桶固定取 preset 配的那个
*   - **删 kind 入参**:kind 只剩一个用途 —— 标记导入的历史流水(`log`),由导入脚本
*     直接写库,模型侧不再暴露分类概念
*/
/** 东八区固定偏移(毫秒)。 */
const CST_OFFSET_MS = 288e5;
/** 一天的毫秒数。 */
const DAY_MS = 864e5;
/** 两位补零。 */
function pad2(n) {
	return String(n).padStart(2, "0");
}
/** 把绝对时刻搬到东八区那面钟上,再用 UTC getter 读(于是与运行环境时区无关)。 */
function cstParts(date) {
	const shifted = new Date(date.getTime() + CST_OFFSET_MS);
	return {
		y: shifted.getUTCFullYear(),
		m: shifted.getUTCMonth() + 1,
		d: shifted.getUTCDate(),
		hh: shifted.getUTCHours(),
		mm: shifted.getUTCMinutes(),
		ss: shifted.getUTCSeconds()
	};
}
/** CST 时间戳 'YYYY-MM-DD HH:mm:ss'(禁用 toISOString —— 那是 UTC,库会早 8 小时)。 */
function fmtCst(date) {
	const p = cstParts(date);
	return `${p.y}-${pad2(p.m)}-${pad2(p.d)} ${pad2(p.hh)}:${pad2(p.mm)}:${pad2(p.ss)}`;
}
/** CST 日期 'YYYY-MM-DD'。 */
function cstDate(date) {
	return fmtCst(date).slice(0, 10);
}
/** 真日期校验:挡 '2026-02-30' 这种格式对、值不存在的输入。 */
function isDateStr(value) {
	if (typeof value !== "string") return false;
	const raw = value.trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
	const [y, m, d] = raw.split("-").map(Number);
	const probe = new Date(Date.UTC(y, m - 1, d));
	return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}
/** 宽松日期输入:取前 10 位,'2026-09-18' / '2026-09-18 11:30' / ISO 串都认;不合法返回 undefined。 */
function normalizeDateInput(raw) {
	if (typeof raw !== "string") return void 0;
	const head = raw.trim().slice(0, 10);
	return isDateStr(head) ? head : void 0;
}
/** 日期加减天数(纯 UTC 算术,不涉时区)。 */
function shiftDate(dateStr, days) {
	const [y, m, d] = dateStr.split("-").map(Number);
	const shifted = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
	return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}
/**
* 解析查询区间:
*   都不给 → [今天-1, 今天];只给 from → [from, 今天];只给 to → [to, to];都给 → [from, to]
*   from 晚于 to → 报错(不猜、不自动交换,免得回一堆不是他要的)
*/
function resolveRange(fromRaw, toRaw, now) {
	const today = cstDate(now);
	const hasFrom = typeof fromRaw === "string" && fromRaw.trim().length > 0;
	const hasTo = typeof toRaw === "string" && toRaw.trim().length > 0;
	const from = hasFrom ? normalizeDateInput(fromRaw) : void 0;
	const to = hasTo ? normalizeDateInput(toRaw) : void 0;
	if (hasFrom && from === void 0) return { error: `from 不是合法日期(要 YYYY-MM-DD): ${String(fromRaw)}` };
	if (hasTo && to === void 0) return { error: `to 不是合法日期(要 YYYY-MM-DD): ${String(toRaw)}` };
	if (from !== void 0 && to !== void 0) {
		if (from > to) return { error: `from(${from}) 晚于 to(${to})` };
		return { range: {
			from,
			to
		} };
	}
	if (from !== void 0) return { range: {
		from,
		to: from <= today ? today : from
	} };
	if (to !== void 0) return { range: {
		from: to,
		to
	} };
	return { range: {
		from: shiftDate(today, -1),
		to: today
	} };
}
/** content(初摘要)上限 —— 只报错不静默截断,让模型自己压。 */
const MEMORY_CONTENT_MAX = 2e3;
/**
* owner 收窄:小写字母数字开头,可带 . _ -,≤32 字。
* 拒绝中文/空格/大写 —— 桶名会被当成过滤键,污串一进库就再难收拾。
* 工具侧不再收 owner 入参,这里只服务于 preset config。
*/
function normalizeOwner(raw) {
	if (typeof raw !== "string") return void 0;
	const value = raw.trim().toLowerCase();
	if (value.length === 0 || value.length > 32) return void 0;
	if (!/^[a-z0-9][a-z0-9._-]*$/.test(value)) return void 0;
	return value;
}
/** 必填文本收窄:trim 后非空、不超长。 */
function requiredText(raw, label, max) {
	if (typeof raw !== "string" || raw.trim().length === 0) return { error: `${label} 为空` };
	const value = raw.trim();
	if (value.length > max) return { error: `${label} 超长(${value.length}>${max} 字),先自己压一遍再来` };
	return { value };
}
/** add 入参收窄:owner/content/summary 必填,source 可省;kind 固定留空(导入脚本自己填)。 */
function normalizeAdd(raw) {
	const owner = normalizeOwner(raw.owner);
	if (owner === void 0) return { error: `owner 非法或缺失(只收小写字母数字与 . _ -,≤32 字)` };
	const content = requiredText(raw.content, "content", MEMORY_CONTENT_MAX);
	if ("error" in content) return { error: content.error };
	const summary = requiredText(raw.summary, "summary", 300);
	if ("error" in summary) return { error: summary.error };
	const source = typeof raw.source === "string" ? raw.source.trim().slice(0, 200) : "";
	return { input: {
		owner,
		content: content.value,
		summary: summary.value,
		kind: "",
		source
	} };
}
/**
* reflect 入参收窄:id 必需、content 必需(**整条覆盖,不是追加**)、summary 可省。
* 覆盖是设计稿定的(§五 5.3)——省掉历史版本,换表不膨胀;要留旧理解就别覆盖,
* 用 op=add 另记一条(「保留矛盾」铁律)。
*/
function normalizeReflect(raw) {
	const id = normalizeId(raw.id);
	if (id === void 0) return { error: "id 非法或缺失(要正整数;id 从检索或按日期回查的结果里拿)" };
	const content = requiredText(raw.content, "content", MEMORY_CONTENT_MAX);
	if ("error" in content) return { error: content.error };
	const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
	if (summary.length > 300) return { error: `summary 超长(${summary.length}>300 字),先自己压一遍再来` };
	return { input: {
		id,
		content: content.value,
		summary
	} };
}
/** 表格单元格:竖线会打断 markdown 表,换成斜杠。 */
function cell(text) {
	return String(text ?? "").replaceAll("|", "/").replaceAll("\n", " ");
}
/** 时间列截成 'MM-DD HH:mm'。 */
function shortStamp(stamp) {
	const text = String(stamp ?? "");
	return text.length >= 16 ? text.slice(5, 16) : text;
}
/** 写入回执:'已记 #id · 时间 · owner'。 */
function renderAddResult(input, id, createdAt) {
	const lines = [`已记 #${id} · ${createdAt} CST · owner=${input.owner}`];
	if (input.source.length > 0) lines.push(`source: ${input.source}`);
	lines.push(`summary: ${input.summary}`);
	return lines.join("\n");
}
/** 反思回执:'已反思 #id · 时间 · 字数 旧→新' —— 一眼看出是**改写**不是新增。 */
function renderReflectResult(input) {
	return [`已反思 #${input.id} · ${input.reflectedAt} CST · 字数 ${input.beforeChars} → ${input.afterChars}`, `summary: ${input.summary}${input.summaryKept ? "(未改)" : ""}`].join("\n");
}
/**
* 渲染按日期回查结果。**空区间要明说"没有记忆"** —— 别让模型对着空表脑补。
* 标记列只标「未反思」(reflected_at 为空),它就是将来的反思作业队列。
*/
function renderDate(input) {
	const { rows, range, owner } = input;
	const head = `## 记忆 · ${range.from} ~ ${range.to} · owner=${owner}`;
	if (rows.length === 0) return `${head}\n该区间没有记忆。换个区间,或先 \`roroko_mem_edit\` op=add 落一条。`;
	const unreflected = rows.filter((row) => row.reflected_at === null || row.reflected_at === "").length;
	const lines = [
		head,
		`条数 ${rows.length} · 未反思 ${unreflected}`,
		"",
		"| id | 时间 | 类别 | 摘要 | 标记 |",
		"|---|---|---|---|---|"
	];
	for (const row of rows) {
		const flags = row.reflected_at === null || row.reflected_at === "" ? "未反思" : "";
		lines.push(`| ${row.id} | ${shortStamp(row.created_at)} | ${cell(row.kind)} | ${cell(row.summary)} | ${flags} |`);
	}
	return lines.join("\n");
}
/** 关键词分隔符:空白与中英文逗号顿号分号斜杠竖线。 */
const KEYWORD_SEP = /[\s,，、;；/|]+/;
/**
* 切关键词:按分隔符切、转小写、去重、保序,超上限截断。
* 词原样拿去 SQL 做包含匹配 —— 不做分词、不做相似度。
*/
function splitKeywords(raw) {
	if (typeof raw !== "string") return [];
	const seen = /* @__PURE__ */ new Set();
	const words = [];
	for (const part of raw.split(KEYWORD_SEP)) {
		const word = part.trim().toLowerCase();
		if (word.length === 0 || seen.has(word)) continue;
		seen.add(word);
		words.push(word);
		if (words.length >= 8) break;
	}
	return words;
}
/**
* 转义 LIKE 的通配符 —— 关键词里的 % _ \ 必须当普通字符,否则
* `100%` 会变成"以 100 开头的一切"。
*/
function escapeLike(word) {
	return word.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
/** limit 收窄:非数字或 ≤0 → 默认;超上限 → 上限;小数取整。 */
function normalizeLimit(raw) {
	const value = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
	if (!Number.isFinite(value) || value <= 0) return 5;
	return Math.min(Math.floor(value), 20);
}
/** id 收窄:正整数(兼容模型传字符串数字);不合法返回 undefined。 */
function normalizeId(raw) {
	const value = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
	if (!Number.isInteger(value) || value <= 0) return void 0;
	return value;
}
/** 渲染检索结果。**查不到要明说**,别留给模型"好像有"的余地。 */
function renderRough(input) {
	const { rows, keywords, owner, candidates } = input;
	const head = `## 记忆检索 · "${keywords.join(" ")}" · owner=${owner}`;
	if (candidates === 0) return `${head}\n该桶还没有记忆。先用 \`roroko_mem_edit\` op=add 落一条。`;
	if (rows.length === 0) return `${head}\n没有匹配上的记忆(桶内 ${candidates} 条)—— 关键词是全都要命中的,少给一个词再试。\n也可以改用 \`roroko_mem_date\` 按日期回查。**别据此编造记忆。**`;
	const lines = [
		head,
		`命中 ${rows.length} 条 · 桶内 ${candidates} 条`,
		"",
		"| id | 时间 | 类别 | 摘要 |",
		"|---|---|---|---|"
	];
	for (const row of rows) lines.push(`| ${row.id} | ${shortStamp(row.created_at)} | ${cell(row.kind)} | ${cell(row.summary)} |`);
	lines.push("", "要看完整内容用 `roroko_mem_id`;摘要够判断就别多取一次。");
	return lines.join("\n");
}
/** 渲染单条记忆全文(含 provenance,方便回会话原文)。 */
function renderId(input) {
	const { row } = input;
	const flags = row.reflected_at === null || row.reflected_at === "" || row.reflected_at === void 0 ? "未反思" : `已反思 ${row.reflected_at}`;
	const lines = [`## 记忆 #${row.id} · owner=${row.owner} · ${row.created_at} CST · ${flags}`];
	if (typeof row.source === "string" && row.source.length > 0) lines.push(`source: ${row.source}`);
	lines.push("", row.content ?? "", "", `summary: ${row.summary}`);
	return lines.join("\n");
}
/**
* 建表语句(设计稿 §四原文;幂等,每次开库都跑一遍)。
* ⚠️ `recalled` 列仍然保留:2026-09-21 删掉了召回计数逻辑,但**不动表结构** ——
* 老库不需要迁移,新库多一个没人读的列,代价为零。
*/
const MEMORY_DDL = [
	`CREATE TABLE IF NOT EXISTS memory (
  id            INTEGER PRIMARY KEY,
  owner         TEXT    NOT NULL,
  content       TEXT    NOT NULL,
  summary       TEXT    NOT NULL,
  created_at    TEXT    NOT NULL,
  reflected_at  TEXT,
  recalled      INTEGER NOT NULL DEFAULT 0,
  source        TEXT,
  kind          TEXT
)`,
	"CREATE INDEX IF NOT EXISTS idx_memory_owner_date ON memory(owner, created_at)",
	"CREATE INDEX IF NOT EXISTS idx_memory_reflected ON memory(reflected_at)"
];
/** 开库即生效的连接级 pragma:WAL 抗并发、busy_timeout 别一撞就抛。 */
const MEMORY_PRAGMAS = ["PRAGMA journal_mode = WAL", "PRAGMA busy_timeout = 3000"];
//#endregion
//#region src/memory/store.ts
/**
* roroko 记忆库访问层:开库建表 / 写入 / 按日期回查 / 关键词检索。
*
* 只依赖 `node:sqlite` 与 memory-form.ts(纯逻辑),**不 import DSH 运行时包** ——
* 测试可以直接 import 本产物真跑临时库,不需要替身钩子。
*
* 连接策略:每次 execute 独立开关一条连接(与 roroko_datas_* 同款);开库即建表,
* 幂等。sqlite 不会自己建目录,所以先补父目录。
*
* 减法(2026-09-21):检索从"全表取回 + bigram 打分"改成**一条 SQL**(每个关键词都要
* 命中,LIKE 包含匹配);删掉召回计数与 owner 分桶开关。桶由调用方固定传进来。
*/
/**
* 开库 + 建表(幂等)。父目录不存在则补建 —— sqlite 遇缺目录直接报错。
* 建表失败会让插件 apply 抛错 → 调用方自己 try/catch,别拖垮 preset 挂载。
*/
function openMemoryDb(dbPath) {
	mkdirSync(dirname(dbPath), { recursive: true });
	const db = new DatabaseSync(dbPath);
	for (const sql of MEMORY_PRAGMAS) db.exec(sql);
	for (const sql of MEMORY_DDL) db.exec(sql);
	return db;
}
/** 写一条记忆:created_at 由服务端按 CST 生成,reflected_at 留 NULL(待反思)。 */
function runAdd(db, input, now) {
	const createdAt = fmtCst(now);
	const inserted = db.prepare("INSERT INTO memory (owner, content, summary, created_at, source, kind) VALUES (?, ?, ?, ?, ?, ?)").run(input.owner, input.content, input.summary, createdAt, input.source.length > 0 ? input.source : null, input.kind.length > 0 ? input.kind : null);
	const id = Number(inserted.lastInsertRowid);
	return {
		id,
		createdAt,
		text: renderAddResult(input, id, createdAt)
	};
}
/**
* 反思一条记忆:直接覆盖 content(设计稿 §五 5.3,防膨胀)、刷 reflected_at,
* summary 传了才一起换。owner/kind/source 一概不动。
* 查不到 id 返回人话,不抛。
*/
function runReflect(db, input, now) {
	const row = db.prepare(`SELECT ${MEMORY_COLUMNS} FROM memory WHERE id = ?`).get(input.id);
	if (row === void 0) return `没有 #${input.id} 这条记忆。reflect 只能改已有的;要记新的用 op=add。`;
	const reflectedAt = fmtCst(now);
	const summaryKept = input.summary.length === 0;
	const summary = summaryKept ? row.summary : input.summary;
	db.prepare("UPDATE memory SET content = ?, summary = ?, reflected_at = ? WHERE id = ?").run(input.content, summary, reflectedAt, input.id);
	return renderReflectResult({
		id: input.id,
		reflectedAt,
		beforeChars: (row.content ?? "").length,
		afterChars: input.content.length,
		summaryKept,
		summary
	});
}
/**
* 按日期回查:拿 created_at 前 10 位(纯日期)做字符串比较,避开时间部分。
* 区间非法时返回人话错误,不抛 —— 工具执行失败会污染整轮。
*/
function runDate(db, query, owner, now) {
	const resolved = resolveRange(query.from, query.to, now);
	if (resolved.range === void 0) return `区间非法: ${resolved.error}`;
	const range = resolved.range;
	return renderDate({
		rows: db.prepare(`SELECT id, owner, summary, created_at, reflected_at, kind FROM memory
       WHERE owner = ? AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?
       ORDER BY created_at ASC, id ASC`).all(owner, range.from, range.to),
		range,
		owner
	});
}
/** 检索 / 取全文 / dream 共用的列(改动这里要顺手看一眼各处渲染)。 */
const MEMORY_COLUMNS = "id, owner, content, summary, created_at, reflected_at, source, kind";
/** 桶内条数(区分"桶里没记忆"和"没匹配上")。 */
function countOwner$1(db, owner) {
	const row = db.prepare("SELECT count(*) AS n FROM memory WHERE owner = ?").get(owner);
	return Number(row?.n ?? 0) || 0;
}
/**
* 关键词检索:**一条 SQL**,每个关键词都要在 content 或 summary 里出现(LIKE 包含匹配,
* 通配符已转义)。命中按时间倒序取 limit 条 —— 没有打分、没有相似度、没有召回计数。
* 关键词切不出东西时返回人话,不抛(工具抛错会污染整轮)。
*/
function runRough(db, query, owner) {
	const keywords = splitKeywords(query.keywords);
	if (keywords.length === 0) return "关键词为空:给一句要检索的话或几个词(空格分隔)。";
	const candidates = countOwner$1(db, owner);
	if (candidates === 0) return renderRough({
		rows: [],
		keywords,
		owner,
		candidates
	});
	const where = [];
	const params = [owner];
	for (const word of keywords) {
		where.push("(content LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')");
		const pattern = `%${escapeLike(word)}%`;
		params.push(pattern, pattern);
	}
	return renderRough({
		rows: db.prepare(`SELECT id, owner, summary, created_at, reflected_at, kind FROM memory
       WHERE owner = ? AND ${where.join(" AND ")}
       ORDER BY created_at DESC, id DESC LIMIT ?`).all(...params, normalizeLimit(query.limit)),
		keywords,
		owner,
		candidates
	});
}
/**
* 按 id 取一条的完整内容(摘要不足以判断时才用)。只在**本桶**里找,查不到返回人话,不抛。
*/
function runId(db, query, owner) {
	const id = normalizeId(query.id);
	if (id === void 0) return `id 非法: ${String(query.id)}(要正整数;id 从检索或按日期回查的结果里拿)`;
	const row = db.prepare(`SELECT ${MEMORY_COLUMNS} FROM memory WHERE id = ? AND owner = ?`).get(id, owner);
	if (row === void 0) return `没有 #${id} 这条记忆(owner=${owner})。`;
	return renderId({ row });
}
//#endregion
//#region src/memory/dream-form.ts
/** 默认间隔:4 小时(照抄 nanobot 的 everyMs=14400000)。 */
const DREAM_DEFAULT_INTERVAL_MS = 144e5;
/** 间隔下限:5 分钟(防手滑配成 0 秒把模型当风扇吹)。 */
const DREAM_MIN_INTERVAL_MS = 3e5;
/** 间隔上限:24 小时。 */
const DREAM_MAX_INTERVAL_MS = 864e5;
/**
* 分段定时器的每段长度:最多 1 小时醒一次,醒来自查墙钟到点没。
* Node 的 timer 上限是 2147483647ms(约 24.8 天),分段是照抄 dsh-schedule 的做法。
*/
const DREAM_TICK_MS = 36e5;
/**
* 不进反思队列的 kind —— 历史日志(`kind=log`)是逐字入库的开发流水,
* 再让模型逐条提炼一遍纯属白烧 token(2026-09-20 阿一拍)。
*/
const DREAM_SKIP_KINDS = ["log"];
/** 审计落盘目录(相对库所在目录)。 */
const DREAM_LOG_DIR = "dream-log";
/**
* 会话每次请求的 token 上限。
* ⚠️ **必须够推理模型用**:`deepseek-v4-flash` 这类带 thinking 的模型会先把
* reasoning 写完再吐正文,2048 会被 thinking 吃满 → 正文一个字都没有
* (2026-09-20 在服务器上实测踩到,提到 8192 立刻通)。
* 会话化之后它仍要传进 `agentOptions.maxTokens`,所以保留为常量。
*/
const DREAM_DEFAULT_MAX_TOKENS = 8192;
/** dream 内置默认(preset 不传就用它)。 */
const DREAM_DEFAULTS = {
	enabled: true,
	intervalMs: DREAM_DEFAULT_INTERVAL_MS,
	batch: 20,
	provider: "",
	model: "",
	preset: "",
	cwd: ""
};
/**
* 整数收窄:非数字/非有限值回落默认,越界夹到区间。
* ⚠️ **空串必须回落默认而不是当 0** —— `Number('')` 是 0 不是 NaN,踩过一次:
* 未提供的 intervalMs 会一路夹到下限,变成"每 5 分钟跑一次"(比设计勤 48 倍)。
*/
function clampInt$1(raw, min, max, fallback) {
	if (typeof raw === "number") {
		if (!Number.isFinite(raw)) return fallback;
		return Math.min(Math.max(Math.floor(raw), min), max);
	}
	const text = typeof raw === "string" ? raw.trim() : "";
	if (text.length === 0) return fallback;
	const value = Number(text);
	if (!Number.isFinite(value)) return fallback;
	return Math.min(Math.max(Math.floor(value), min), max);
}
/** dream 配置归一化:非法字段逐个回落默认,不抛。 */
function normalizeDreamConfig(raw) {
	if (typeof raw !== "object" || raw === null) return { ...DREAM_DEFAULTS };
	const value = raw;
	return {
		enabled: typeof value.enabled === "boolean" ? value.enabled : DREAM_DEFAULTS.enabled,
		intervalMs: clampInt$1(value.intervalMs, DREAM_MIN_INTERVAL_MS, DREAM_MAX_INTERVAL_MS, DREAM_DEFAULTS.intervalMs),
		batch: clampInt$1(value.batch, 1, 50, DREAM_DEFAULTS.batch),
		provider: typeof value.provider === "string" ? value.provider.trim() : "",
		model: typeof value.model === "string" ? value.model.trim() : "",
		preset: typeof value.preset === "string" ? value.preset.trim() : "",
		cwd: typeof value.cwd === "string" ? value.cwd.trim() : ""
	};
}
/**
* 队列口径:`reflected_at` 为空、不在跳过 kind 里,按 created_at 升序取前 limit 条。
* 库里取回来时已按时间排好,这里只做过滤与截断 —— 纯函数,好测。
*/
function pickQueue(rows, limit) {
	const fresh = rows.filter((row) => {
		const reflected = row.reflected_at;
		return reflected === null || reflected === void 0 || reflected === "";
	});
	const entries = fresh.filter((row) => !DREAM_SKIP_KINDS.includes(String(row.kind ?? "").toLowerCase()));
	const skippedLogs = fresh.length - entries.length;
	return {
		entries: entries.slice(0, Math.max(1, limit)),
		skippedLogs
	};
}
/**
* 组装任务书。**只给清单**(id / 时间 / 摘要预览),正文让模型自己用
* `roroko_mem_id` 取、改完用 `roroko_mem_edit(op=reflect)` 覆盖回去。
* 第一段是"记忆整理模式"声明 —— 这是阿一定的那句:让它知道现在不是对话/开发情景。
*/
function buildDreamTask(entries) {
	const head = [
		"现在进入**记忆整理模式**。",
		"- 这不是对话,也不是开发:不要回应任何人的话,不要动工作区文件,不要开 shell,不要上网。",
		"- 只做一件事:看下面这份待整理清单(它来自你自己的记忆库),判断哪几条记得太啰嗦、",
		"  措辞不准、或该收敛结论。",
		"- 对要改的:先用 `roroko_mem_id` 取全文,再用 `roroko_mem_edit`(op=reflect)把改写后的",
		"  **完整正文**覆盖回去(summary 一起给就一起换)。",
		"- 不值得改的就跳过 —— **一条都不改也是正常结果**。改完给一行结论就停。",
		"- **观点变了或出现矛盾时不要抹平**:用 op=add 另记一条,保留矛盾。",
		"",
		`## 待整理清单(共 ${entries.length} 条,按时间升序)`
	];
	const lines = entries.map((row) => {
		const summary = String(row.summary ?? "").replaceAll("\n", " ");
		const preview = summary.length > 120 ? `${summary.slice(0, 120)}…` : summary;
		const kind = row.kind === null || row.kind === void 0 || String(row.kind).length === 0 ? "" : ` · ${String(row.kind)}`;
		return `- #${row.id} · ${row.created_at}${kind} · ${preview}`;
	});
	return [...head, ...lines].join("\n");
}
/**
* 门禁:比对写回前后的 `reflected_at`,只认真落下去的那些(照抄 nanobot 的
* "审计只认 diff,不认模型自述")。返回真变了的 id。
*/
function diffReflected(before, after) {
	const wasUnreflected = /* @__PURE__ */ new Map();
	for (const row of before) wasUnreflected.set(Number(row.id), row.reflected_at === null || row.reflected_at === void 0 || row.reflected_at === "");
	const changed = [];
	for (const row of after) {
		const id = Number(row.id);
		if (wasUnreflected.get(id) !== true) continue;
		const reflected = row.reflected_at;
		if (reflected !== null && reflected !== void 0 && reflected !== "") changed.push(id);
	}
	return changed;
}
/**
* 审计正文 —— **只记事实 diff,不记模型自述**(照抄 nanobot D12:
* "the audit record reflects the filesystem's truth, not the model's self-report")。
*/
function renderDreamAudit(input) {
	const beforeChars = /* @__PURE__ */ new Map();
	for (const row of input.before) beforeChars.set(Number(row.id), String(row.content ?? "").length);
	const lines = [
		`# dream ${input.at} CST`,
		"",
		`provider/model: ${input.provider} / ${input.model}`,
		input.sessionId.length > 0 ? `会话: ${input.sessionId}${input.preset.length > 0 ? ` · preset=${input.preset}` : " · 未挂 preset"}` : "会话: (未起)",
		`队列 ${input.queued} 条(跳过日志 ${input.skippedLogs} 条)· 真反思 ${input.changed.length} 条 · 自记 ${input.added} 条`
	];
	if (input.error !== void 0) lines.push("", `error: ${input.error}`);
	if (input.changed.length > 0) {
		lines.push("", "| id | 字数 旧 → 新 |", "|---|---|");
		for (const row of input.after) {
			const id = Number(row.id);
			if (!input.changed.includes(id)) continue;
			lines.push(`| ${id} | ${beforeChars.get(id) ?? "?"} → ${String(row.content ?? "").length} |`);
		}
	}
	return lines.join("\n");
}
//#endregion
//#region src/memory/dream.ts
/**
* memory/dream.ts — dream 机制：一次执行序 + 分段定时器。
*
* 靶子是 sqlite 记忆表（不是文件），照 `roroko-datas-dream-slice7-plan.md`
* 的九步执行序，载体是一次性会话。执行序：
*
*   1 取队列（无条目 → 直接结束，**不起会话、不烧 token**）
*   2 组任务书（清单：id / 时间 / 摘要预览）
*   3 起一次性会话（挂 preset → 投任务书 → 等收敛 → 等落盘 → 收掉）
*     —— 人设由 preset 的 preinject 系统段供，工具由 preset 声明的插件行供，
*        模型自己 `roroko_mem_id` 取全文、自己 `roroko_mem_edit` 改回去
*   4 门禁：回读看 `reflected_at` **真落下去没** —— 只认库里的事实，不认模型自述
*   5 顺带统计桶内条数差 = 它自己 add 了几条（保留矛盾那条通道）
*   6 审计落盘（只记事实）
*   7 异常全吞（调用方也会收），定时器绝不能被 dream 打崩
*
* 本文件**不 import DSH 运行时值**（只吃 node 内置与纯逻辑） → 测试零替身。
*
* ── 0.2.1 适配 ──────────────────────────────────────────────────────────
*   `dreamRuntime` 从模块级单例改成 {@link createDreamRuntime} 造的实例，由
*   `mount()` 闭包持有：两个 preset 的 composition 共享同一份模块，模块级状态
*   会互相串（datas 那轮踩过）。`startedDbs` 反过来**故意留在模块级** —— 它是
*   进程级去重，同库只该跑一份定时器，串的正是我们想要的。
*/
/** 造一份运行面（每个 mount 各一份，互不串味）。 */
function createDreamRuntime() {
	return { running: false };
}
/**
* 已启动过定时器的库（**进程级**去重）。
*
* ⚠️ 插件是按 preset / 会话装配的 —— 同一次宿主生命周期里 mount 可能被调用多次。
* 不加这道闸，每个 preset 都会起一份定时器，4 小时后一起醒：重复烧 token、并发写
* 同一个库。同一个库只认第一个实例（后续调用只刷新共享面上的配置）。
*/
const startedDbs = /* @__PURE__ */ new Set();
/** 认领一个库的 dream 启动权；已被认领过则返回 false。 */
function claimDreamStart(dbPath) {
	if (startedDbs.has(dbPath)) return false;
	startedDbs.add(dbPath);
	return true;
}
/** 归还启动权（总开关关掉时调用），让下一次打开还能再起定时器。 */
function releaseDreamStart(dbPath) {
	startedDbs.delete(dbPath);
}
/** 取本桶所有候选行（时间升序，让"最久没反思的"自然排在前面）。 */
function loadRows(dbPath, owner) {
	const db = openMemoryDb(dbPath);
	try {
		return db.prepare(`SELECT ${MEMORY_COLUMNS} FROM memory WHERE owner = ? ORDER BY created_at ASC, id ASC`).all(owner);
	} finally {
		db.close();
	}
}
/** 桶内条数（会话前后各取一次，差值 = 它自己 add 了几条）。 */
function countOwner(dbPath, owner) {
	const db = openMemoryDb(dbPath);
	try {
		const row = db.prepare("SELECT count(*) AS n FROM memory WHERE owner = ?").get(owner);
		return Number(row?.n ?? 0) || 0;
	} finally {
		db.close();
	}
}
/** 回读指定 id 的行（门禁判定用）。 */
function reload(dbPath, ids) {
	if (ids.length === 0) return [];
	const db = openMemoryDb(dbPath);
	try {
		const placeholders = ids.map(() => "?").join(", ");
		return db.prepare(`SELECT ${MEMORY_COLUMNS} FROM memory WHERE id IN (${placeholders}) ORDER BY id`).all(...ids);
	} finally {
		db.close();
	}
}
/** 把一次执行的产物落成审计文件；失败吞掉（审计不该拖垮 dream）。 */
function writeAudit(deps, body, at) {
	if (deps.logDir.length === 0) return void 0;
	try {
		mkdirSync(deps.logDir, { recursive: true });
		const stamp = at.replace(/[: ]/g, "-");
		const path = join(deps.logDir, `${stamp}.md`);
		writeFileSync(path, body, "utf8");
		return path;
	} catch {
		return;
	}
}
/**
* 跑一次 dream。**任何异常都在这里收住**并当成结果返回 —— 调用方（定时器）
* 不该因为一次整理失败而死掉。
*/
async function runDreamOnce(deps) {
	const atCst = fmtCst(deps.now());
	const empty = (note, queued = 0, skippedLogs = 0, sessionId = "", preset = "") => ({
		queued,
		skippedLogs,
		sessionId,
		preset,
		added: 0,
		changed: [],
		note
	});
	if (deps.provider.length === 0 || deps.model.length === 0) return empty("未配置模型(provider/model),跳过");
	let rows;
	try {
		rows = loadRows(deps.dbPath, deps.owner);
	} catch (error) {
		return empty(`读库失败: ${String(error)}`);
	}
	const { entries, skippedLogs } = pickQueue(rows, deps.batch);
	if (entries.length === 0) return empty(skippedLogs > 0 ? "没有可整理的内容(队列里只剩日志)" : "没有可整理的内容", 0, skippedLogs);
	const prompt = buildDreamTask(entries);
	const beforeCount = countOwner(deps.dbPath, deps.owner);
	let session;
	try {
		session = await deps.runSession(prompt, atCst);
	} catch (error) {
		const note = `会话执行失败: ${String(error)}`;
		writeAudit(deps, renderDreamAudit({
			at: atCst,
			provider: deps.provider,
			model: deps.model,
			sessionId: "",
			preset: "",
			queued: entries.length,
			skippedLogs,
			added: 0,
			changed: [],
			before: entries,
			after: [],
			error: note
		}), atCst);
		return {
			queued: entries.length,
			skippedLogs,
			sessionId: "",
			preset: "",
			added: 0,
			changed: [],
			note,
			error: note
		};
	}
	const touched = entries.map((row) => Number(row.id));
	const after = reload(deps.dbPath, touched);
	const changed = diffReflected(entries, after);
	let added = 0;
	try {
		added = Math.max(0, countOwner(deps.dbPath, deps.owner) - beforeCount);
	} catch {
		added = 0;
	}
	const outcome = {
		queued: entries.length,
		skippedLogs,
		sessionId: session.sessionId,
		preset: session.preset,
		added,
		changed,
		note: changed.length > 0 ? `完成,反思 ${changed.length} 条` : "完成;**没有记忆变更**(它没改任何一条)"
	};
	const auditPath = writeAudit(deps, renderDreamAudit({
		at: atCst,
		provider: deps.provider,
		model: deps.model,
		sessionId: session.sessionId,
		preset: session.preset,
		queued: entries.length,
		skippedLogs,
		added,
		changed,
		before: entries,
		after
	}), atCst);
	return {
		...outcome,
		auditPath
	};
}
/**
* 分段定时器：每 `DREAM_TICK_MS` 醒一次，自查墙钟到点没 —— 到期即跑，跑完重新计时。
* **异常一律吞进 onError**，定时器绝不能被一次失败的整理打崩。
*/
function startDreamTimer(options) {
	const setIntervalFn = options.setIntervalFn ?? ((fn, ms) => setInterval(fn, ms));
	const clearIntervalFn = options.clearIntervalFn ?? ((handle) => clearInterval(handle));
	const startupDelay = options.startupDelayMs ?? 3e5;
	const intervalOf = () => typeof options.intervalMs === "function" ? options.intervalMs() : options.intervalMs;
	let anchor = options.now().getTime() + startupDelay;
	let lastRun;
	let running = false;
	const handle = setIntervalFn(() => {
		if (running) return;
		if (options.now().getTime() < anchor) return;
		running = true;
		options.run().then(() => {
			lastRun = options.now().toISOString();
		}).catch((error) => {
			options.onError(error);
		}).finally(() => {
			running = false;
			anchor = options.now().getTime() + intervalOf();
		});
	}, Math.min(intervalOf(), DREAM_TICK_MS));
	handle.unref?.();
	return {
		dispose: () => clearIntervalFn(handle),
		lastRunAt: () => lastRun
	};
}
/** 审计目录：默认落在库旁边的 `dream-log/`（不需要 cwd，零配置可用）。 */
function defaultDreamLogDir(dbPath) {
	const cut = Math.max(dbPath.lastIndexOf("/"), dbPath.lastIndexOf("\\"));
	const dir = cut > 0 ? dbPath.slice(0, cut) : ".";
	return join(dir, DREAM_LOG_DIR);
}
//#endregion
//#region src/memory/dream-session.ts
/** 任务书消息的来源签名。 */
const moduleName = "roroko-memory-dream";
/** 会话 id 前缀:会话列表里一眼能认出这是 dream 的会话。 */
const SESSION_PREFIX = "dream";
/**
* 跑一个一次性会话:挂 preset → 投任务书 → 等收敛 → 等落盘 → 收掉。
* 任何一步失败都抛给调用方(它会收成结果里的 error,不往上冒)。
* @param runtime - 真实的 agents / sessions / presets 与本次的 cwd、preset
* @param prompt - 任务书正文(由执行序层组装,这里只负责投递)
* @param bookmark - CST 时间戳,用来拼会话 id(便于在会话列表里认出来)
*/
async function runDreamSession(runtime, prompt, bookmark) {
	const presetId = runtime.presetId.trim();
	const preset = runtime.presets === void 0 ? void 0 : await runtime.presets.resolve(presetId.length > 0 ? presetId : void 0);
	if (preset !== void 0) await runtime.presets?.standingKeyFor?.(preset.id);
	const stamp = bookmark.replace(/[^0-9]/g, "").slice(0, 14);
	const sessionId = `${SESSION_PREFIX}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
	const handle = await runtime.agents.create({
		sessionId,
		meta: {
			cwd: runtime.cwd.trim().length > 0 ? runtime.cwd.trim() : process.cwd(),
			...preset === void 0 ? {} : { agentPreset: preset.id }
		},
		agentOptions: runtime.agentOptions,
		setup: async (agentCtx) => {
			if (preset === void 0) return;
			await runtime.presets?.mount(agentCtx, preset.id);
		}
	});
	try {
		handle.agent.followup(createUserMessage({
			content: [{
				type: "text",
				text: prompt
			}],
			source: { kind: moduleName }
		}));
		await handle.agent.whenIdle();
		await runtime.sessions.flush(handle.agent.session);
		return {
			sessionId: String(sessionId),
			preset: preset?.id ?? ""
		};
	} finally {
		await handle.dispose?.();
	}
}
//#endregion
//#region src/memory/presets.ts
/**
* memory/presets.ts — 记忆子模块参数的持久化：按 agent preset 分桶的覆盖层。
*
* 存储：`<root>/state/memory.json`，与 preinject.json / datas.json 同形但分文件：
*
*   { "presets": { "common": { "enabled": true, "dbPath": "…", "owner": "roroko",
*                             "dream": { "provider": "…", "model": "…" } }, "roroko": { … } } }
*
* 分文件的理由跟 datas 一样：preinject 管「注入什么文件」，datas 管「连哪个库」，
* memory 管「记什么、多久反思一次」——三套键混一个文件下个月没人看得懂。
*
* 合成链（逐字段回落，缺字段才算未覆盖）：
*
*   内置默认 ← preset 接线 config ← 公共桶 common ← 分 preset 桶
*
* 读写模式照抄 preinject / datas：读同步（pre-step 里要用）、写原子（临时文件 +
* rename）、坏文件当没有。
*/
/** 公共默认桶名。 */
const COMMON$1 = "common";
/** 服务器默认库路径（与 soul.db 同目录，备份一起走）。 */
const DEFAULT_MEMORY_DB_PATH = "/var/www/api/database/roroko_memory.db";
/** 默认 owner 桶。 */
const DEFAULT_OWNER = "dev";
/** 桶里认的键。 */
const BUCKET_KEYS = [
	"enabled",
	"dbPath",
	"owner",
	"dream"
];
/** 覆盖层文件。 */
function memoryStateFile(root) {
	return join(root, "state", "memory.json");
}
/** 整数收窄：有限数取整，钳到 [min, max]，非法回落 fallback。 */
function clampInt(value, fallback, min, max) {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n)) return fallback;
	const int = Math.trunc(n);
	if (int < min) return min;
	if (int > max) return max;
	return int;
}
/** 布尔 / 字符串字段的白名单收窄（没给就丢，不填默认）。 */
function cleanDream(value) {
	if (value === null || typeof value !== "object") return void 0;
	const raw = value;
	const out = {};
	if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
	if (raw.intervalMs !== void 0) out.intervalMs = clampInt(raw.intervalMs, DREAM_DEFAULTS.intervalMs, 3e5, 864e5);
	if (raw.batch !== void 0) out.batch = clampInt(raw.batch, DREAM_DEFAULTS.batch, 1, 50);
	for (const key of [
		"provider",
		"model",
		"preset",
		"cwd"
	]) {
		const v = raw[key];
		if (typeof v === "string") out[key] = v.trim();
	}
	return Object.keys(out).length > 0 ? out : void 0;
}
/** 桶清洗：只留合法字段，一个都不剩就当没这个桶。 */
function cleanBucket(value) {
	if (value === null || typeof value !== "object") return void 0;
	const raw = value;
	const out = {};
	if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
	if (typeof raw.dbPath === "string" && raw.dbPath.trim().length > 0) out.dbPath = raw.dbPath.trim();
	const owner = normalizeOwner(raw.owner);
	if (owner !== void 0) out.owner = owner;
	const dream = cleanDream(raw.dream);
	if (dream !== void 0) out.dream = dream;
	return Object.keys(out).length > 0 ? out : void 0;
}
/** 读整份覆盖层（同步：pre-step 判定要用）。 */
function readMemoryState(root) {
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(memoryStateFile(root), "utf8"));
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
/** 原子写整份覆盖层。 */
async function saveMemoryState(root, state) {
	const file = memoryStateFile(root);
	await mkdir(dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	await rename(tmp, file);
}
/**
* 部分覆盖某个桶：body 里给了的字段盖上去，没给的保留。
* 传 `null` 表示删掉该键；合并后空桶直接删掉（回到跟随下层）。
*/
async function setMemoryBucket(root, scope, patch) {
	const current = readMemoryState(root);
	const merged = { ...current.presets[scope] };
	for (const key of BUCKET_KEYS) {
		if (!(key in patch)) continue;
		if (patch[key] === null) delete merged[key];
		else merged[key] = patch[key];
	}
	const cleaned = cleanBucket(merged);
	const presets = { ...current.presets };
	if (cleaned === void 0) delete presets[scope];
	else presets[scope] = cleaned;
	const next = { presets };
	await saveMemoryState(root, next);
	return next;
}
/** 删掉某个桶（该 preset 回到公共默认 / 接线 config）。 */
async function clearMemoryBucket(root, scope) {
	const current = readMemoryState(root);
	if (!(scope in current.presets)) return current;
	const presets = { ...current.presets };
	delete presets[scope];
	const next = { presets };
	await saveMemoryState(root, next);
	return next;
}
/** 接线层原样（没写的字段就是没写）。 */
function memoryWiring(config) {
	const out = {};
	if (config.enabled !== void 0) out.enabled = config.enabled;
	if (config.dbPath !== void 0) out.dbPath = config.dbPath;
	if (config.owner !== void 0) out.owner = config.owner;
	if (config.dream !== void 0) out.dream = config.dream;
	return out;
}
/**
* 四层合成：默认 ← 接线 config ← 公共桶 ← 分 preset 桶。
* @param config - preset 接线层。
* @param state - 覆盖层状态。
* @param presetId - 会话的 preset id；空 = 只吃公共桶。
*/
function resolveMemory(config, state, presetId) {
	const commonBucket = state.presets[COMMON$1];
	const specific = presetId === void 0 || presetId === "common" ? void 0 : state.presets[presetId];
	const merged = {
		...commonBucket,
		...specific
	};
	const dreamFields = {
		...commonBucket?.dream,
		...specific?.dream
	};
	const wiringPath = config.dbPath !== void 0 && config.dbPath.trim().length > 0 ? config.dbPath.trim() : void 0;
	return {
		enabled: merged.enabled ?? config.enabled ?? false,
		dbPath: merged.dbPath ?? wiringPath ?? "/var/www/api/database/roroko_memory.db",
		owner: normalizeOwner(merged.owner) ?? normalizeOwner(config.owner) ?? "dev",
		dream: normalizeDreamConfig({
			...config.dream,
			...dreamFields
		})
	};
}
//#endregion
//#region src/memory/index.ts
const dshHome = () => process.env.DSH_HOME ?? join(homedir(), ".dsh");
/** 默认身份根（与 preinject / datas 同一个）。 */
function defaultRoot() {
	return join(dshHome(), "roroko");
}
/** 工具输出统一渲染：text content block。 */
function textRender(_args, value) {
	return [{
		type: "text",
		text: value
	}];
}
/** 工具入口：每次执行独立开关一条连接（与 roroko_datas_* 同款）。 */
function withDb(dbPath, fn) {
	const db = openMemoryDb(dbPath);
	try {
		return fn(db);
	} finally {
		db.close();
	}
}
/**
* 挂载本子模块。由 host 在自己的 ctx 上调用，不单独占一行插件。
* @param ctx - 宿主上下文（通常是 preset scope 里的子 fiber）。
* @param rawConfig - 子模块配置（preset 的 config.memory）。
* @param hostServices - 可选的跨 scope 服务句柄（dream 要的 agents / sessions /
*   presets 在 preset scope 里不一定看得见，host 层先握着再交进来）。
*/
function mount(ctx, rawConfig = {}, hostServices) {
	const surface = ctx;
	const config = { ...rawConfig };
	const root = rawConfig.root !== void 0 && rawConfig.root.trim().length > 0 ? rawConfig.root.trim() : defaultRoot();
	/** 本实例最近一次在 pre-step 里见到的 preset id。 */
	let activePreset;
	/** 服务缺席的告警只打一次（sync 每轮都跑，别刷屏）。 */
	let warnedNoService = false;
	/** dream 的运行面：每个 mount 一份（模块级会跨 preset 串味）。 */
	const runtime = createDreamRuntime();
	/**
	* 总开关。默认关：设置页勾了才注册四把工具、才起 dream。
	*
	* 为什么能做到"点一下就开"：`ctx.tools.register()` 返回注销函数，工具是 scope
	* 里的活注册表 —— 加了下一轮请求头就带上、撤了下一轮就消失。所以这里不靠重挂载，
	* 靠每次 pre-step / agent/created 现读覆盖层后 start / stop。
	*/
	let started = false;
	let disposers = [];
	/** dream 的服务面（agents / sessions 到齐才有值）。 */
	let dreamCtx;
	let timer;
	surface.effect(() => registerMemoryMount({
		root,
		config,
		runtime
	}), "memory.status()");
	surface.on("agent/pre-step", (payload, next) => {
		const presetId = payload.agent?.session?.header?.agentPreset;
		if (presetId !== void 0) activePreset = presetId;
		sync();
		return next();
	});
	surface.on("agent/created", (payload) => {
		const presetId = payload.agent?.session?.header?.agentPreset;
		if (presetId !== void 0) activePreset = presetId;
		sync();
	});
	/** 每次现读：preset 覆盖层可能刚被设置页改过。 */
	const resolved = () => resolveMemory(config, readMemoryState(root), activePreset);
	const dbPath = () => resolved().dbPath;
	const owner = () => resolved().owner;
	const dream = () => resolved().dream;
	/** 服务查找：host 层握着的优先，其次看 scope 里到没到。 */
	const scopeBag = () => dreamCtx ?? {};
	const lookupAgents = () => hostServices?.().agents ?? scopeBag().agents;
	const lookupSessions = () => hostServices?.().sessions ?? scopeBag().sessions;
	const lookupPresets = () => hostServices?.().presets ?? scopeBag().agentPresets;
	const editTool = defineTool({
		name: "roroko_mem_edit",
		description: "洛洛可记忆的写入与反思。op=add 记一条新记忆:content 是初摘要,summary 是粗筛/回查时看到的那句。**写入前先过三问**:①人设或画像层已经有了?→ 不记 ②永久有效且每轮都该生效?→ 去改人设文件,不进这张表 ③它能改变我未来某个场景的行为?→ 记,并写成「触发条件 → 应做」。必记四类:边界与安全词的演变 / 有效或无效的挑逗 / 未完成的钩子 / 我自己的失手记录。不记素材与此刻状态(那是 roroko_datas_* 的地盘);不记人设里已有的偏好。op=reflect 反思已有那条(id):**整条覆盖 content**、刷新反思时间,summary 不传就保留原样;适用 = 记错了 / 记得太啰嗦 / 有了更准的结论。**观点变了或出现矛盾时别覆盖,用 op=add 另记一条**(保留矛盾,不消解)。写进哪个桶由插件配置决定,工具不带桶参数。",
		parameters: {
			op: {
				type: "string",
				required: true,
				enum: ["add", "reflect"],
				description: "add=写一条新记忆;reflect=反思并覆盖已有的那条。"
			},
			id: {
				type: "number",
				description: "op=reflect 必需:要反思的记忆 id(来自 roroko_mem_rough / roroko_mem_date 的结果)。"
			},
			content: {
				type: "string",
				required: true,
				description: "add=初摘要(发生了什么 + 结论);reflect=新的 content 正文,整条覆盖而非追加。"
			},
			summary: {
				type: "string",
				description: "add 必需;reflect 不传则保留原 summary。二次摘要:粗筛与按日期回查时看到的就是它(≤300 字)。"
			},
			source: {
				type: "string",
				description: "可选出处:会话 id 或 会话 id#事件序号(回原文的唯一凭据;add 才用)。"
			}
		},
		output: {
			schema: { type: "string" },
			render: textRender
		},
		async execute(args) {
			const at = /* @__PURE__ */ new Date();
			if (args.op === "reflect") {
				const reflected = normalizeReflect({
					id: args.id,
					content: args.content,
					summary: args.summary
				});
				if (reflected.input === void 0) return `反思失败: ${reflected.error}`;
				return withDb(dbPath(), (db) => runReflect(db, reflected.input, at));
			}
			const normalized = normalizeAdd({
				owner: owner(),
				content: args.content,
				summary: args.summary,
				source: args.source
			});
			if (normalized.input === void 0) return `写入失败: ${normalized.error}`;
			return withDb(dbPath(), (db) => runAdd(db, normalized.input, at).text);
		},
		presentCall(args) {
			if (args.op === "reflect") return {
				card: "generic",
				title: `反思 #${args.id}`,
				kind: "other",
				rawInput: String(args.content ?? "").slice(0, 40)
			};
			return {
				card: "generic",
				title: "记一条记忆",
				kind: "other",
				rawInput: String(args.summary ?? args.content ?? "").slice(0, 40)
			};
		}
	});
	const dateTool = defineTool({
		name: "roroko_mem_date",
		description: "洛洛可记忆按日期回查:返回 id / 时间 / 类别 / 摘要 / 未反思标记。默认区间 = 今天 + 昨天 —— **会话开始时先调它**;他问\"某天干了什么\"时也用它。要看某条的完整内容用 roroko_mem_id;想不起某事的细节用 roroko_mem_rough。",
		parameters: {
			from: {
				type: "string",
				description: "起始日期 YYYY-MM-DD;不给 = 昨天(配 to 不给即今天+昨天)。"
			},
			to: {
				type: "string",
				description: "结束日期 YYYY-MM-DD;只给 to = 查那一天。"
			}
		},
		output: {
			schema: { type: "string" },
			render: textRender
		},
		async execute(args) {
			const at = /* @__PURE__ */ new Date();
			return withDb(dbPath(), (db) => runDate(db, {
				from: args.from,
				to: args.to
			}, owner(), at));
		},
		presentCall(args) {
			const span = args.from !== void 0 && args.from.length > 0 ? args.from : "今天+昨天";
			return {
				card: "generic",
				title: `回查记忆 · ${span}`,
				kind: "read",
				rawInput: span
			};
		}
	});
	const roughTool = defineTool({
		name: "roroko_mem_rough",
		description: "洛洛可记忆关键词检索:返回命中的 id / 时间 / 类别 / 摘要。**想不起某事时先调它**,别硬编。keywords 用空格或逗号分隔(≤8 个词,**每个词都要出现**才命中)。查不到会明说\"没有匹配上\" —— 那是关键词没对上,**不许据此编造记忆**;少给一个词再试。摘要不够判断时再用 roroko_mem_id 取全文。",
		parameters: {
			keywords: {
				type: "string",
				required: true,
				description: "检索词,空格/逗号分隔,如 \"记忆 检索 落地\"(每个词都要出现)。"
			},
			limit: {
				type: "number",
				description: `返回条数,缺省 5,上限 20。`
			}
		},
		output: {
			schema: { type: "string" },
			render: textRender
		},
		async execute(args) {
			return withDb(dbPath(), (db) => runRough(db, {
				keywords: args.keywords,
				limit: args.limit
			}, owner()));
		},
		presentCall(args) {
			const words = String(args.keywords ?? "").slice(0, 40);
			return {
				card: "generic",
				title: `检索记忆 · ${words}`,
				kind: "read",
				rawInput: words
			};
		}
	});
	const idTool = defineTool({
		name: "roroko_mem_id",
		description: "洛洛可记忆按 id 取完整内容(初摘要 content + 出处 source)。id 从 roroko_mem_rough / roroko_mem_date 的结果里拿 —— **只在摘要不足以判断时才取,别一次捞一堆**。只在本桶里找。",
		parameters: { id: {
			type: "number",
			required: true,
			description: "记忆 id(正整数,来自检索或按日期回查的结果)。"
		} },
		output: {
			schema: { type: "string" },
			render: textRender
		},
		async execute(args) {
			return withDb(dbPath(), (db) => runId(db, { id: args.id }, owner()));
		},
		presentCall(args) {
			return {
				card: "generic",
				title: `读记忆 #${args.id}`,
				kind: "read",
				rawInput: String(args.id)
			};
		}
	});
	/** 按当前配置造一次执行的依赖（现算，所以配置是活的）。 */
	const makeDeps = (cfg, services) => ({
		dbPath: dbPath(),
		owner: owner(),
		provider: cfg.provider,
		model: cfg.model,
		batch: cfg.batch,
		logDir: defaultDreamLogDir(dbPath()),
		now: () => /* @__PURE__ */ new Date(),
		runSession: (prompt, bookmark) => runDreamSession({
			agents: services.agents,
			sessions: services.sessions,
			presets: services.presets,
			cwd: cfg.cwd,
			presetId: cfg.preset,
			agentOptions: {
				provider: cfg.provider,
				model: cfg.model,
				maxTokens: DREAM_DEFAULT_MAX_TOKENS
			}
		}, prompt, bookmark)
	});
	/** 起 dream：确认服务可用 → 认领本库的启动权 → 装运行面 → 起分段定时器。 */
	const startDream = () => {
		if (runtime.run !== void 0) return;
		const cfg = dream();
		if (!cfg.enabled) return;
		const agents = lookupAgents();
		const sessions = lookupSessions();
		if (agents === void 0 || sessions === void 0) {
			if (!warnedNoService) {
				warnedNoService = true;
				console.log("[roroko-memory] dream 未启动：agents/sessions 服务还没接上（四把工具照常）");
			}
			return;
		}
		const path = dbPath();
		if (!claimDreamStart(path)) {
			console.log(`[roroko-memory] dream 已在管 ${path}，本实例不重复起定时器`);
			return;
		}
		const presets = lookupPresets();
		if (presets === void 0) console.log("[roroko-memory] dream 起会话时没有 preset 名册：会话里不会有人设与工具行");
		if (cfg.provider.length === 0) console.log("[roroko-memory] dream 已启用但未配 provider/model，每次都会跳过");
		const services = {
			agents,
			sessions,
			presets
		};
		/** 跑一次并把结果贴到共享面 —— 定时器与手动触发共用，顺便防并发。 */
		const runOnce = async () => {
			const now = dream();
			const skip = (note) => ({
				queued: 0,
				skippedLogs: 0,
				sessionId: "",
				preset: "",
				added: 0,
				changed: [],
				note
			});
			if (!now.enabled) return skip("已在面板关闭,跳过");
			if (now.provider.length === 0 || now.model.length === 0) return skip("未配置模型(provider/model),跳过");
			if (runtime.running) return skip("上一次还在跑,本次跳过");
			runtime.running = true;
			try {
				const result = await runDreamOnce(makeDeps(now, services));
				runtime.last = {
					...result,
					at: fmtCst(/* @__PURE__ */ new Date())
				};
				return result;
			} finally {
				runtime.running = false;
			}
		};
		runtime.config = cfg;
		runtime.resolve = dream;
		runtime.run = runOnce;
		timer = startDreamTimer({
			intervalMs: () => dream().intervalMs,
			run: async () => {
				const result = await runOnce();
				const line = `[roroko-memory] dream: ${result.note}`;
				if (result.error !== void 0) ctx.logger?.warn?.(line);
				else ctx.logger?.info?.(line);
			},
			now: () => /* @__PURE__ */ new Date(),
			onError: (error) => ctx.logger?.warn?.(`[roroko-memory] dream 定时器异常: ${String(error)}`)
		});
		disposers.push(() => {
			timer?.dispose();
			timer = void 0;
			releaseDreamStart(path);
			runtime.run = void 0;
			runtime.resolve = void 0;
			console.log("[roroko-memory] dream 定时器已收起");
		});
		console.log("[roroko-memory] dream 已启动");
	};
	/** 打开：注册四把工具 + 起 dream。 */
	const start = () => {
		if (started) return;
		started = true;
		try {
			openMemoryDb(dbPath()).close();
		} catch {}
		disposers.push(surface.tools.register(editTool));
		disposers.push(surface.tools.register(dateTool));
		disposers.push(surface.tools.register(roughTool));
		disposers.push(surface.tools.register(idTool));
		startDream();
		console.log("[roroko-memory] enabled → 四把工具已注册");
	};
	/** 关掉：撤工具、收 dream 定时器。 */
	const stop = () => {
		if (!started) return;
		started = false;
		for (const dispose of disposers.splice(0).reverse()) try {
			dispose();
		} catch (error) {
			console.log("[roroko-memory] stop:", error instanceof Error ? error.message : String(error));
		}
		console.log("[roroko-memory] disabled → 工具已撤下");
	};
	/** 按总开关对齐一次（幂等，开关没变就什么都不做）。 */
	const sync = () => {
		try {
			if (resolved().enabled) start();
			else stop();
		} catch (error) {
			console.log("[roroko-memory] sync skipped:", error instanceof Error ? error.message : String(error));
		}
	};
	surface.inject(["agents", "sessions"], (scope) => {
		dreamCtx = scope;
		sync();
		scope.effect(() => () => {
			dreamCtx = void 0;
		}, "roroko-memory: dream services");
	});
	sync();
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
	if (config.suppressSections !== void 0) out.suppressSections = config.suppressSections;
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
			const datasMount = firstDatasMount();
			const memoryMount = firstMemoryMount();
			if (mount === void 0 && datasMount === void 0 && memoryMount === void 0) {
				json(res, 200, {
					version,
					mounted: false
				});
				return;
			}
			const root = mount?.root ?? datasMount?.root ?? memoryMount?.root ?? "";
			const state = mount === void 0 ? { presets: {} } : readState(mount.root);
			const rows = await roster();
			const datasState = readDatasState(root);
			const memoryState = readMemoryState(root);
			const scopes = [COMMON];
			for (const row of rows) if (!scopes.includes(row.id)) scopes.push(row.id);
			for (const key of Object.keys(state.presets)) if (!scopes.includes(key)) scopes.push(key);
			for (const key of Object.keys(datasState.presets)) if (!scopes.includes(key)) scopes.push(key);
			for (const key of Object.keys(memoryState.presets)) if (!scopes.includes(key)) scopes.push(key);
			const views = mount === void 0 ? {
				effective: {},
				files: {}
			} : await scopeViews(mount.config, state, mount.root, scopes);
			/** datas 侧：各 scope 的生效参数（没有接线层就按默认算）。 */
			const datasEffective = {};
			const memoryEffective = {};
			for (const scope of scopes) {
				datasEffective[scope] = resolveDatas(datasMount?.config ?? {}, datasState, scope === "common" ? void 0 : scope);
				memoryEffective[scope] = resolveMemory(memoryMount?.config ?? {}, memoryState, scope === "common" ? void 0 : scope);
			}
			/** dream 的运行时面（手动触发与最近一次结果）。 */
			const dreamRuntime = memoryMount?.runtime;
			json(res, 200, {
				version,
				mounted: mount !== void 0,
				root,
				stateFile: mount === void 0 ? void 0 : stateFile(mount.root),
				presets: state.presets,
				defaults: DEFAULTS,
				wiring: mount === void 0 ? {} : wiring(mount.config),
				roster: rows,
				scopes,
				effective: views.effective,
				files: views.files,
				datas: {
					mounted: datasMount !== void 0,
					stateFile: datasStateFile(root),
					defaults: {
						enabled: false,
						dbPath: DEFAULT_DB_PATH,
						autoinject: AUTOINJECT_DEFAULTS
					},
					wiring: datasMount === void 0 ? {} : datasWiring(datasMount.config),
					presets: datasState.presets,
					effective: datasEffective
				},
				memory: {
					mounted: memoryMount !== void 0,
					stateFile: memoryStateFile(root),
					defaults: resolveMemory({}, { presets: {} }, void 0),
					wiring: memoryMount === void 0 ? {} : memoryWiring(memoryMount.config),
					presets: memoryState.presets,
					effective: memoryEffective,
					dream: {
						running: dreamRuntime?.running === true,
						started: dreamRuntime?.run !== void 0,
						config: dreamRuntime?.config ?? null,
						last: dreamRuntime?.last ?? null
					}
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
			const section = typeof patch.section === "string" ? patch.section : "preinject";
			if (section === "datas") {
				const datasMount = firstDatasMount();
				if (datasMount === void 0) {
					json(res, 200, {
						ok: false,
						reason: "未挂载 datas，没有可写的桶"
					});
					return;
				}
				json(res, 200, {
					ok: true,
					state: patch.reset === true ? await clearDatasBucket(datasMount.root, scope) : await setDatasBucket(datasMount.root, scope, patch)
				});
				return;
			}
			if (section === "memory") {
				const memoryMount = firstMemoryMount();
				if (memoryMount === void 0) {
					json(res, 200, {
						ok: false,
						reason: "未挂载 memory，没有可写的桶"
					});
					return;
				}
				json(res, 200, {
					ok: true,
					state: patch.reset === true ? await clearMemoryBucket(memoryMount.root, scope) : await setMemoryBucket(memoryMount.root, scope, patch)
				});
				return;
			}
			if (section !== "preinject") {
				json(res, 400, {
					ok: false,
					reason: `未知 section：${section}`
				});
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
			json(res, 200, {
				ok: true,
				state: patch.reset === true ? await clearBucket(mount.root, scope) : await setBucket(mount.root, scope, patch)
			});
		}
	});
	const offDream = server.register({
		kind: "exact",
		path: `${PREFIX}/dream`,
		handler: async (req, res) => {
			const runtime = firstMemoryMount()?.runtime;
			if (req.method === "GET" || req.method === "HEAD") {
				json(res, 200, {
					ok: true,
					started: runtime?.run !== void 0,
					running: runtime?.running === true,
					config: runtime?.config ?? null,
					last: runtime?.last ?? null,
					reason: runtime?.run === void 0 ? "定时器未启动：总开关没开、或宿主重启后还没有任何会话装配过 memory" : void 0
				});
				return;
			}
			if (req.method !== "POST") {
				json(res, 405, { error: "GET or POST only" });
				return;
			}
			if (runtime?.run === void 0) {
				json(res, 400, {
					ok: false,
					reason: "dream 未启用（总开关没开 / 未配模型 / 服务缺席）"
				});
				return;
			}
			try {
				const result = await runtime.run();
				json(res, 200, {
					ok: result.error === void 0,
					result: runtime.last ?? result
				});
			} catch (cause) {
				json(res, 200, {
					ok: false,
					reason: cause instanceof Error ? cause.message : String(cause)
				});
			}
		}
	});
	return () => {
		offState();
		offConfig();
		offDream();
	};
}
//#endregion
//#region src/index.ts
const name = "roroko-tool";
/** 子模块配置：schema 化之后，Plugins 页才有本插件自己的页面与表单。 */
const Config = z.object({
	preinject: z.union([z.boolean(), z.object({
		root: z.string().description("文件基准目录（默认 $DSH_HOME/roroko）"),
		systemFiles: z.array(z.string()).description("接线层：系统层清单"),
		userFiles: z.array(z.string()).description("接线层：用户层清单"),
		suppressSections: z.array(z.string()).description("要抹掉的系统段名（默认抹掉 @文件引用说明）"),
		suppressHarnessIdentity: z.boolean().description("顶掉官方开场白段")
	})]).description("上下文注入子模块（覆盖层在设置页里按 preset 分桶）"),
	datas: z.union([z.boolean(), z.object({
		root: z.string().description("覆盖层基准目录（默认 $DSH_HOME/roroko）"),
		dbPath: z.string().description("soul.db 路径（默认 /var/www/api/database/soul.db）"),
		autoinject: z.object({
			rounds: z.boolean().description("轮数触发"),
			every: z.number().description("每 N 轮注一次"),
			afterTool: z.boolean().description("取过料后注入"),
			minGap: z.number().description("两次注入之间至少隔 N 轮")
		}).description("state 短条自动注入")
	})]).description("素材库子模块：roroko_datas_* 四把工具 + state 自动注入"),
	memory: z.union([z.boolean(), z.object({
		root: z.string().description("覆盖层基准目录（默认 $DSH_HOME/roroko）"),
		dbPath: z.string().description("记忆库路径（默认 /var/www/api/database/roroko_memory.db）"),
		owner: z.string().description("owner 桶（默认 dev；小写字母数字与 . _ -）"),
		dream: z.object({
			enabled: z.boolean().description("定时反思总开关"),
			intervalMs: z.number().description("间隔毫秒（默认 4 小时）"),
			batch: z.number().description("一次整理几条（默认 20）"),
			provider: z.string().description("起会话用的 provider（空 = 每次跳过）"),
			model: z.string().description("起会话用的模型（空 = 每次跳过）"),
			preset: z.string().description("用哪个 preset 起会话（空 = 该部署的默认）"),
			cwd: z.string().description("会话工作目录（空 = 进程 cwd）")
		}).description("定时反思（dream）")
	})]).description("记忆子模块：roroko_mem_* 四把工具 + dream 定时反思")
});
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
	/** dream 要的服务句柄（见 {@link AgentServices}）。 */
	const services = {};
	surface.inject(["agentPresets"], (scope) => {
		const service = scope.agentPresets;
		scope.effect(() => {
			registry = service;
			services.presets = service;
			return () => {
				registry = void 0;
				services.presets = void 0;
			};
		}, "roroko-tool: preset 注册表");
	});
	surface.inject(["agents", "sessions"], (scope) => {
		const bag = scope;
		scope.effect(() => {
			services.agents = bag.agents;
			services.sessions = bag.sessions;
			return () => {
				services.agents = void 0;
				services.sessions = void 0;
			};
		}, "roroko-tool: agent 服务");
	});
	surface.inject(["webServer"], (scope) => {
		const server = scope.webServer;
		scope.effect(() => registerStateRoutes(server, version, () => registry), "roroko-tool: 设置页路由");
	});
	const preinject = config.preinject;
	if (preinject !== void 0 && preinject !== false && (preinject === true || preinject.enabled !== false)) surface.inject(["systemPrompt"], (scope) => {
		mount$2(scope, preinject === true ? {} : preinject);
	});
	const datas = config.datas;
	if (datas !== void 0 && datas !== false && (datas === true || datas.enabled !== false)) surface.inject(["tools"], (scope) => {
		mount$1(scope, datas === true ? {} : datas);
	});
	const memory = config.memory;
	if (memory !== void 0 && memory !== false && (memory === true || memory.enabled !== false)) surface.inject(["tools"], (scope) => {
		mount(scope, memory === true ? {} : memory, () => services);
	});
}
//#endregion
export { AUTOINJECT_DEFAULTS, COMMON, Config, DEFAULTS, DEFAULT_DB_PATH, DEFAULT_MEMORY_DB_PATH, DEFAULT_OWNER, DREAM_DEFAULTS, DREAM_SKIP_KINDS, COMMON$1 as MEMORY_COMMON, TABLES, apply, buildDreamTask, cleanAutoinject, clearBucket, clearDatasBucket, clearMemoryBucket, datasStateFile, datasWiring, diffReflected, escapeLike, fmtCst, matchesSuppress, memoryStateFile, memoryWiring, name, normalizeAdd, normalizeDreamConfig, normalizeReflect, pickCandidates, pickQueue, readDatasState, readMemoryState, readState, renderQuery, resolveBucket, resolveDatas, resolveEffective, resolveMemory, resolveRange, scoreRow, setBucket, setDatasBucket, setMemoryBucket, splitKeywords, splitKws, version };
