import z from "@deepseek-ai/schemastery";
import { readFileSync } from "node:fs";
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
const BUCKET_KEYS$1 = ["systemFiles", "userFiles"];
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
function cleanBucket$1(value) {
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
		const cleaned = cleanBucket$1(bucket);
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
	for (const key of BUCKET_KEYS$1) {
		if (!(key in patch)) continue;
		const cleaned = cleanList(patch[key]);
		if (cleaned === void 0) delete merged[key];
		else merged[key] = cleaned;
	}
	const cleaned = cleanBucket$1(merged);
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
const moduleName$1 = "roroko-preinject";
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
const dshHome$1 = () => process.env.DSH_HOME ?? join(homedir(), ".dsh");
/** 默认身份根。 */
function defaultRoot$1() {
	return join(dshHome$1(), "roroko");
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
function mount$1(ctx, rawConfig = {}) {
	const surface = ctx;
	const config = { ...rawConfig };
	const root = rawConfig.root !== void 0 && rawConfig.root.length > 0 ? rawConfig.root : defaultRoot$1();
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
			source: { kind: moduleName$1 }
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
function textRender$1(_args, value) {
	return [{
		type: "text",
		text: value
	}];
}
/** 注册 roroko_datas_query；preset 声明了 config.datas 桶即生效。 */
function applyQuery(ctx, dbPath) {
	ctx.tools.register(defineTool({
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
			render: textRender$1
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
const COMMON$1 = "common";
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
const BUCKET_KEYS = ["dbPath", "autoinject"];
/** 覆盖层文件。 */
function datasStateFile(root) {
	return join(root, "state", "datas.json");
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
/** autoinject 清洗：只留给了的字段，一个都没给就丢（返回 undefined = 这一组没覆盖）。 */
function cleanAutoinject(value) {
	if (value === null || typeof value !== "object") return void 0;
	const raw = value;
	const out = {};
	if (typeof raw.rounds === "boolean") out.rounds = raw.rounds;
	if (typeof raw.afterTool === "boolean") out.afterTool = raw.afterTool;
	if (raw.every !== void 0) out.every = clampInt(raw.every, AUTOINJECT_DEFAULTS.every, 1, 200);
	if (raw.minGap !== void 0) out.minGap = clampInt(raw.minGap, AUTOINJECT_DEFAULTS.minGap, 0, 200);
	return Object.keys(out).length > 0 ? out : void 0;
}
/** 桶清洗：只留合法字段，一个都不剩就当没这个桶。 */
function cleanBucket(value) {
	if (value === null || typeof value !== "object") return void 0;
	const raw = value;
	const out = {};
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
		const cleaned = cleanBucket(bucket);
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
		...state.presets[COMMON$1],
		...specific
	};
	const wiringPath = config.dbPath !== void 0 && config.dbPath.trim().length > 0 ? config.dbPath.trim() : void 0;
	return {
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
const moduleName = "roroko-datas-autoinject";
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
*/
function applyStateAutoinject(ctx, root, config, presetId) {
	const surface = ctx;
	const counters = /* @__PURE__ */ new WeakMap();
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
	surface.on("tools/result", (exec) => {
		try {
			if (exec === void 0 || !isRorokoDatasTool(exec.name)) return;
			const session = exec.agent?.session;
			if (session === void 0) return;
			counterOf(session).pending = true;
		} catch {}
	});
	surface.on("session/event", (session, event) => {
		try {
			const type = String(event?.type ?? "");
			if (!type.startsWith("compaction/")) return;
			const counter = counters.get(session);
			if (counter === void 0) return;
			counter.forced = true;
			console.log("[roroko-datas-autoinject] compaction → forced re-inject", type);
		} catch {}
	});
	surface.on("agent/pre-step", async (payload, next) => {
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
				source: { kind: moduleName }
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
	});
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
const dshHome = () => process.env.DSH_HOME ?? join(homedir(), ".dsh");
/** 默认身份根（与 preinject 同一个）。 */
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
/** 工具入口：按白名单操作 sqlite（表名列名全来自常量）。 */
function withDb(dbPath, fn) {
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
function mount(ctx, rawConfig = {}) {
	const surface = ctx;
	const config = { ...rawConfig };
	const root = rawConfig.root !== void 0 && rawConfig.root.trim().length > 0 ? rawConfig.root.trim() : defaultRoot();
	/** 本实例最近一次在 pre-step 里见到的 preset id。 */
	let activePreset;
	surface.effect(() => registerDatasMount({
		root,
		config
	}), "datas.status()");
	surface.on("agent/pre-step", (payload, next) => {
		const presetId = payload.agent?.session?.header?.agentPreset;
		if (presetId !== void 0) activePreset = presetId;
		return next();
	});
	/** 每次执行现读：preset 覆盖层可能刚被设置页改过。 */
	const dbPath = () => resolveDatas(config, readDatasState(root), activePreset).dbPath;
	applyQuery(ctx, dbPath);
	applyStateAutoinject(ctx, root, config, () => activePreset);
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
			render: textRender
		},
		async execute(args) {
			return withDb(dbPath(), (db) => runLookup(db, args.name));
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
			render: textRender
		},
		async execute(args) {
			return withDb(dbPath(), (db) => runRegister(db, args.type, args.name, args.desc ?? ""));
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
			render: textRender
		},
		async execute(args) {
			const now = /* @__PURE__ */ new Date();
			return withDb(dbPath(), (db) => {
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
	surface.tools.register(lookupTool);
	surface.tools.register(registerTool);
	surface.tools.register(stateTool);
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
			const datasMount = firstDatasMount();
			if (mount === void 0 && datasMount === void 0) {
				json(res, 200, {
					version,
					mounted: false
				});
				return;
			}
			const root = mount?.root ?? datasMount?.root ?? "";
			const state = mount === void 0 ? { presets: {} } : readState(mount.root);
			const rows = await roster();
			const datasState = readDatasState(root);
			const scopes = [COMMON];
			for (const row of rows) if (!scopes.includes(row.id)) scopes.push(row.id);
			for (const key of Object.keys(state.presets)) if (!scopes.includes(key)) scopes.push(key);
			for (const key of Object.keys(datasState.presets)) if (!scopes.includes(key)) scopes.push(key);
			const views = mount === void 0 ? {
				effective: {},
				files: {}
			} : await scopeViews(mount.config, state, mount.root, scopes);
			/** datas 侧：各 scope 的生效参数（没有接线层就按默认算）。 */
			const datasEffective = {};
			for (const scope of scopes) datasEffective[scope] = resolveDatas(datasMount?.config ?? {}, datasState, scope === "common" ? void 0 : scope);
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
						dbPath: DEFAULT_DB_PATH,
						autoinject: AUTOINJECT_DEFAULTS
					},
					wiring: datasMount === void 0 ? {} : datasWiring(datasMount.config),
					presets: datasState.presets,
					effective: datasEffective
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
	return () => {
		offState();
		offConfig();
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
	})]).description("素材库子模块：roroko_datas_* 四把工具 + state 自动注入")
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
	if (preinject !== void 0 && preinject !== false && (preinject === true || preinject.enabled !== false)) surface.inject(["systemPrompt"], (scope) => {
		mount$1(scope, preinject === true ? {} : preinject);
	});
	const datas = config.datas;
	if (datas !== void 0 && datas !== false && (datas === true || datas.enabled !== false)) surface.inject(["tools"], (scope) => {
		mount(scope, datas === true ? {} : datas);
	});
}
//#endregion
export { AUTOINJECT_DEFAULTS, COMMON, Config, DEFAULTS, DEFAULT_DB_PATH, TABLES, apply, cleanAutoinject, clearBucket, clearDatasBucket, datasStateFile, datasWiring, name, pickCandidates, readDatasState, readState, renderQuery, resolveBucket, resolveDatas, resolveEffective, scoreRow, setBucket, setDatasBucket, splitKws, version };
