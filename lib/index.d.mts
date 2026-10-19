import z from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
//#region src/presets.d.ts
/** 公共默认桶名。 */
declare const COMMON = "common";
/** 一个桶里能覆盖的字段。 */
interface PreinjectBucket {
  systemFiles?: string[];
  userFiles?: string[];
}
/** 整份状态。 */
interface PreinjectState {
  presets: Record<string, PreinjectBucket>;
}
/** 读整份状态（同步：系统段 provider 不能 await）。 */
declare function readState(root: string): PreinjectState;
/**
 * 部分覆盖某个桶：body 里给了的字段盖上去，没给的保留。
 * 合并后空桶直接删掉（回到跟随公共默认 / 接线 config），不留空桶压住下层。
 * @param root - 身份根。
 * @param scope - 桶名（common 或 preset id）。
 * @param patch - 待写入字段。
 * @returns 落盘后的整份状态。
 */
declare function setBucket(root: string, scope: string, patch: Record<string, unknown>): Promise<PreinjectState>;
/**
 * 删掉某个桶（该 preset 回到公共默认 / 接线 config）。
 * @param root - 身份根。
 * @param scope - 桶名。
 * @returns 落盘后的整份状态。
 */
declare function clearBucket(root: string, scope: string): Promise<PreinjectState>;
/**
 * 解析某个 preset 的覆盖层：具体桶叠在公共桶之上，只叠存在的字段。
 * @param state - 整份状态。
 * @param presetId - 会话的 preset id；空 = 只看公共桶。
 * @returns 合成后的覆盖层。
 */
declare function resolveBucket(state: PreinjectState, presetId: string | undefined): PreinjectBucket;
//#endregion
//#region src/preinject.d.ts
/** 接线参数（preset 的 config.preinject）：一层可选基线，不写就走默认。 */
interface PreinjectConfig {
  /** false 时不挂载本模块。 */
  enabled?: boolean;
  /** 文件基准目录，默认 $DSH_HOME/roroko。 */
  root?: string;
  /** 接线层的系统层清单。 */
  systemFiles?: string[];
  /** 接线层的用户层清单。 */
  userFiles?: string[];
  /** 顶掉 "You are an AI agent powered by DeepSeek Harness." 这个开场白。 */
  suppressHarnessIdentity?: boolean;
}
/** 内置默认（最底层）。 */
declare const DEFAULTS: Required<Omit<PreinjectConfig, 'enabled' | 'root' | 'suppressHarnessIdentity'>>;
/** 四层合成后的有效参数。 */
interface EffectiveConfig {
  systemFiles: string[];
  userFiles: string[];
}
/**
 * 四层合成：默认 ← 接线 config ← 公共桶 ← 分 preset 桶。
 * @param config - preset 接线层。
 * @param state - 覆盖层状态。
 * @param presetId - 会话的 preset id；空 = 只吃公共桶。
 * @returns 该 preset 生效的参数。
 */
declare function resolveEffective(config: PreinjectConfig, state: PreinjectState, presetId: string | undefined): EffectiveConfig;
//#endregion
//#region src/index.d.ts
declare const name = "roroko-tool";
/** 子模块配置：schema 化之后，Plugins 页才有本插件自己的页面与表单。 */
declare const Config: z<RorokoToolConfig>;
/** 本包版本（设置页显示用）。 */
declare const version = "0.1.0";
/** 插件配置：一层桶对应一个子模块；桶设成 false 即不挂载。 */
interface RorokoToolConfig {
  preinject?: PreinjectConfig | boolean;
}
/**
 * 插件入口。
 * @param ctx - 本行插件所在的上下文（profile 层或 preset scope）。
 * @param config - 见 {@link RorokoToolConfig}。
 */
declare function apply(ctx: Context, config?: RorokoToolConfig): void;
//#endregion
export { COMMON, Config, DEFAULTS, RorokoToolConfig, apply, clearBucket, name, readState, resolveBucket, resolveEffective, setBucket, version };