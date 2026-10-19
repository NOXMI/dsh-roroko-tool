import z from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
//#region src/preinject.d.ts
interface PreinjectConfig {
  /** false 时不挂载本模块。 */
  enabled?: boolean;
  /** 身份文件根目录，默认 $DSH_HOME/roroko。 */
  root?: string;
  /** 身份文件（相对 root）。 */
  identityFiles?: string[];
  /** 工作区指令文件（相对会话 cwd）。 */
  workspaceFiles?: string[];
  /** 系统段是否拼入工作区文件（默认 false：AGENTS 交给消息段，避免同一份内容进两次）。 */
  includeWorkspace?: boolean;
  /** 工作区找不到文件时，回落到 root 下的同名文件。 */
  workspaceFallbackToRoot?: boolean;
  /** 消息段是否包 <system-reminder>。 */
  wrap?: boolean;
  /** 顶掉 "You are an AI agent powered by DeepSeek Harness." 这个开场白。 */
  suppressHarnessIdentity?: boolean;
}
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
export { Config, RorokoToolConfig, apply, name, version };