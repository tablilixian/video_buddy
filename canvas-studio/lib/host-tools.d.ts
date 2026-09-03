import type { ProjectRegistry } from './projects.js';
import type { StudioCanvasNode } from './contracts/canvas.js';
/**
 * CR-001：compose_video 缺省选片——只取「逐镜视频片段」并按生成顺序排序，
 * 排除成片节点（toolName='compose'）。否则二次合成会把上一版成片当片段再拼
 * 一次，递归叠加。纯函数便于单测；显式传 clipIds 时不经过此逻辑。
 */
export declare function defaultComposeClips(nodes: readonly StudioCanvasNode[]): string[];
/**
 * 解析分镜表 markdown 表格为逐镜单元格行。容错策略：
 * - 只认含 `|` 的行；行首尾 `|` 可省略；
 * - 丢弃分隔行（`---`）与表头行（首列为「镜号」）；少于 3 列的行丢弃；
 * - 解析不出任何数据行时返回空数组（调用方回退整表单节点落盘）。
 */
export declare function parseStoryboardShots(storyboard: string): string[][];
/** 把一行分镜单元格格式化为逐镜卡片正文（缺失列自动跳过）。 */
export declare function formatStoryboardShot(cells: string[]): {
    title: string;
    text: string;
};
/**
 * 创建 P3 媒体生成工具集（供 Host 的 `ctx.tools.register` 逐条注册）。
 * @param registry - 项目注册表。
 * @returns 画布视频创作所需的 `defineTool` 定义：image_generate（写实/卡通 style）, character_generate（角色立绘三视图）, inpaint（图像修复/编辑）, upload_image, video_generate, video_composite, prompt_enhance, image2vl, style_transfer, storyboard_generate, P7 的 submit_storyboard_for_approval（分镜表审批门禁）与 ask_user_choice（点选式提问）。
 */
/** 运行时配置：Host 把 settings 解析后的 Drama 基址 / 时长 / 密钥解析器透传给生成闭包。 */
export interface StudioRuntimeConfig {
    /** 返回当前 Drama Backend API 基址。 */
    dramaApiBase: () => string;
    /** 返回当前单段视频时长上限（秒）。 */
    maxVideoSeconds: () => number;
    /** 解析 dramaApiKey 凭据引用为真实密钥（未配置时抛错）。 */
    resolveDramaApiKey: () => Promise<string>;
    /** 返回默认画幅比例（agent 未指定 aspectRatio 时兜底）。 */
    defaultAspectRatio: () => '16:9' | '9:16' | '1:1';
    /** 返回默认执行模式（confirm/auto）。 */
    workflowMode: () => 'confirm' | 'auto';
    /** 分镜 HITL 门禁开关。 */
    hitlStoryboard: () => boolean;
    /** 关键帧 HITL 门禁开关。 */
    hitlKeyframe: () => boolean;
    /** 生成失败自动重试开关。 */
    autoRetry: () => boolean;
    /** 最大并行生成数。 */
    maxParallel: () => number;
    /** 资产库位置（留空 = 项目默认）。 */
    assetDir: () => string;
    /** 画布自动保存开关。 */
    autoSave: () => boolean;
    /** 自动保存间隔（秒）。 */
    autoSaveInterval: () => number;
}
export declare function createStudioTools(registry: ProjectRegistry, port: number, cfg?: StudioRuntimeConfig): import("@deepseek-ai/dsh-tools").ToolDefinition[];
