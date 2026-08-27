import type { ProjectRegistry } from './projects.js';
/**
 * 创建 P3 媒体生成工具集（供 Host 的 `ctx.tools.register` 逐条注册）。
 * @param registry - 项目注册表。
 * @returns 画布视频创作所需的 `defineTool` 定义：image_generate, upload_image, video_generate,
 *   video_composite, prompt_enhance, image2vl, style_transfer, storyboard_generate,
 *   P7 的 submit_storyboard_for_approval（分镜表审批门禁）与 ask_user_choice（点选式提问）。
 */
export declare function createStudioTools(registry: ProjectRegistry, port: number): import("@deepseek-ai/dsh-tools").ToolDefinition[];
