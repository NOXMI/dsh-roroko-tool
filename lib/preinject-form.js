/**
 * preinject 参数表单的纯逻辑:界面值 ↔ 落盘 payload ↔ 继承基线。
 *
 * host 与 client 共用(与 expander.ts 同一套做法),所以**不得 import 任何 node
 * 内置模块或 DSH 运行时包** —— 本文件会进浏览器 bundle。
 *
 * 设置页靠它算「有没有未保存改动」并构造 POST 体;node 侧的测试直读编译产物,
 * 不用点界面就能验(从前这类逻辑埋在组件里,只能靠手点,踩过"改了没保存"的坑)。
 */
/** 列表字段兜底:非数组当空单(host 首启或旧版 state 可能缺字段)。 */
export function toList(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}
/** 字符串字段兜底:非字符串当空串。 */
export function toStr(value) {
    return typeof value === 'string' ? value : '';
}
/** 数值字段兜底:非有限数当兜底值。 */
export function toNum(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
/** 落盘前清洗:去首尾空白、去空行、去重。非数组一律当空单,不抛。 */
export function cleanList(list) {
    if (!Array.isArray(list))
        return [];
    return list
        .filter((item) => typeof item === 'string')
        .map(item => item.trim())
        .filter(item => item.length > 0)
        .filter((item, index, self) => self.indexOf(item) === index);
}
/** 覆盖层有没有系统段的显式设定(任取到字段即算已覆盖)。 */
export function hasSystemOverride(override) {
    return override.systemFiles !== undefined
        || override.systemOrder !== undefined
        || override.systemHeader !== undefined
        || override.systemFooter !== undefined;
}
/** 覆盖层有没有消息段的显式设定。 */
export function hasMessageOverride(override) {
    return override.files !== undefined
        || override.header !== undefined
        || override.footer !== undefined
        || override.wrapInSystemReminder !== undefined
        || override.filesPlacement !== undefined
        || override.splitFiles !== undefined;
}
/**
 * 由「覆盖层 + 继承基线」推出界面表单快照(设置页首次渲染/保存后同步都用它)。
 *
 * 语义与旧组件内联写法逐字一致:override 缺字段才回落 baseline;布尔严格
 * `=== true`(旧 state 里可能是 undefined);数组经 toList 兜底。
 */
export function formFromState(override, baseline) {
    const layer = override ?? {};
    return {
        coverSystem: hasSystemOverride(layer),
        systemFiles: toList(layer.systemFiles ?? baseline.systemFiles),
        systemOrder: toNum(layer.systemOrder, baseline.systemOrder),
        systemHeader: toStr(layer.systemHeader ?? baseline.systemHeader),
        systemFooter: toStr(layer.systemFooter ?? baseline.systemFooter),
        coverMessage: hasMessageOverride(layer),
        files: toList(layer.files ?? baseline.files),
        header: toStr(layer.header ?? baseline.header),
        footer: toStr(layer.footer ?? baseline.footer),
        wrap: (layer.wrapInSystemReminder ?? baseline.wrapInSystemReminder) === true,
        placement: layer.filesPlacement ?? baseline.filesPlacement,
        split: (layer.splitFiles ?? baseline.splitFiles) === true,
    };
}
/**
 * 由表单快照构造 POST 体。
 *
 * 不勾「覆盖」的那一组**一个字段都不发** —— 发空值会把 preset config 压住,
 * 语义从"跟随继承"变成"显式清空"。两组都不勾 = 空 payload,调用方按"清桶"
 * 处理(与「重置为继承」同义)。
 */
export function payloadFromForm(form) {
    const payload = {};
    if (form.coverSystem) {
        payload.systemFiles = cleanList(form.systemFiles);
        payload.systemOrder = form.systemOrder;
        payload.systemHeader = form.systemHeader.trim();
        payload.systemFooter = form.systemFooter.trim();
    }
    if (form.coverMessage) {
        payload.files = cleanList(form.files);
        payload.header = form.header.trim();
        payload.footer = form.footer.trim();
        payload.wrapInSystemReminder = form.wrap;
        payload.filesPlacement = form.placement;
        payload.splitFiles = form.split;
    }
    return payload;
}
/** 两份表单快照是否等价(数组按内容逐个比,不看引用)。 */
export function formEquals(a, b) {
    return a.coverSystem === b.coverSystem
        && a.coverMessage === b.coverMessage
        && a.systemOrder === b.systemOrder
        && a.wrap === b.wrap
        && a.placement === b.placement
        && a.split === b.split
        && listEquals(a.systemFiles, b.systemFiles)
        && listEquals(a.files, b.files)
        && a.systemHeader === b.systemHeader
        && a.systemFooter === b.systemFooter
        && a.header === b.header
        && a.footer === b.footer;
}
/** 两个字符串清单逐项相等。 */
function listEquals(a, b) {
    return a.length === b.length && a.every((item, index) => item === b[index]);
}
/**
 * 行身份牌对齐:长度对不上(外部整体替换,如切 preset / 重置)就整批换新,
 * 否则原样返回。
 *
 * 为什么需要:React 用 key 认行,旧代码拿**数组下标**当 key —— 删掉中间一行
 * 时后面每行的身份都被"顶替",输入框会被错误复用,症状是字跳行/被吃掉。
 * 自己触发的增删在事件里先行同步(见设置页),所以这里只管外部替换。
 */
export function ensureRowIds(ids, count, mint) {
    if (ids.length === count)
        return ids;
    return Array.from({ length: count }, () => mint());
}
