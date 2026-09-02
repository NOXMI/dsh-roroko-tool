/**
 * roroko-mark 呻吟标记展开引擎(纯函数,host / client 共享源)。
 *
 * 蓝本:harness 源码树 `packages/client/ui-primitives/src/roroko-mark.ts`
 * (commit e0f4098f56「移植 Roroko 补丁至 0.1.2-alpha.3」)。该版本把引擎与
 * localStorage toggle 耦合在 ui-primitives;roroko-tool 收编时剥离 react 依赖,
 * 只留纯展开函数——toggle 改走服务器 state `mark.enabled`(roroko-tool-state.json),
 * 由设置页统一开关。
 *
 * 职责:把 `-呻吟_X-` 字面标记展开成可读的呻吟文本。
 * 特性:主导音轮换 / 呃闷响 / 哦失控 9 连 / ♥ 链 / 代码块保护 / 未知标记保留 /
 * 幂等(展开产物不含 `-xx-` 模式)。纯函数同步,node 与浏览器两端共用。
 *
 * 标记清单(13):呻吟_弱/普通/强/极端/余韵/浪叫/哀求/愉悦/羞耻/抗拒/失神/口交。
 */
/**
 * Expand one text string: code fences pass through untouched, inline
 * `-呻吟_X-` markers become voiced text, unknown markers stay as-is.
 * @param text - raw text possibly carrying `-呻吟_X-` markers.
 * @returns the expanded display text.
 */
export declare function expandMarkers(text: string): string;
