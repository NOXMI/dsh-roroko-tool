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
  /** 系统段是否拼入工作区文件。 */
  includeWorkspace?: boolean;
  /** 消息段是否包 <system-reminder>。 */
  wrap?: boolean;
  /** 顶掉 "You are an AI agent powered by DeepSeek Harness." 这个开场白。 */
  suppressHarnessIdentity?: boolean;
}
//#endregion
//#region src/index.d.ts
declare const name = "roroko-tool";
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
export { RorokoToolConfig, apply, name };