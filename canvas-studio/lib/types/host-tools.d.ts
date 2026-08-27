import type { ProjectRegistry } from './projects.js';
/**
 * 创建 P3 媒体生成工具集（供 Host 的 `ctx.tools.register` 逐条注册）。
 * @param registry - 项目注册表。
 * @returns 画布视频创作所需的 `defineTool` 定义：image_generate, upload_image, video_generate,
 *   video_composite, prompt_enhance, image2vl, style_transfer, storyboard_generate,
 *   P7 的 submit_storyboard_for_approval（分镜表审批门禁）与 ask_user_choice（点选式提问）。
 */
/** 运行时配置：Host 把 settings 解析后的 Drama 基址 / 时长 / 密钥解析器透传给生成闭包。 */
export interface StudioRuntimeConfig {
    /** 返回当前 Drama Backend API 基址。 */
    dramaApiBase: () => string;
    /** 返回当前单段视频时长上限（秒）。 */
    maxVideoSeconds: () => number;
    /** 解析 dramaApiKey 凭据引用为真实密钥（未配置时抛错）。 */
    resolveDramaApiKey: () => Promise<string>;
}
export declare function createStudioTools(registry: ProjectRegistry, port: number, cfg: StudioRuntimeConfig): import("@deepseek-ai/dsh-tools").ToolDefinition[];
