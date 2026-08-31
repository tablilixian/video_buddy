import type { ProjectRegistry } from './projects.js';
import type { StudioCanvasNode, StudioCanvasOperationType } from './contracts/canvas.js';
import type { StudioRuntimeConfig } from './host-tools.js';
export declare function setRuntimeConfig(cfg: StudioRuntimeConfig): void;
/** 一次生成的请求参数（来自客户端工具）。 */
export interface GenerateParams {
    prompt: string;
    aspectRatio?: string;
    /** 已上传到 Drama Backend 的服务器文件名（image_generate 图生图 / video_generate / style_transfer / image2vl / storyboard_generate 用）。 */
    filename?: string;
    /** 已上传的 Drama Backend 文件名数组（video_composite 用）。 */
    filenames?: string[];
    /** 风格迁移的参考风格图文件名（style_transfer 用，已上传到 Drama Backend）。 */
    styleFilename?: string;
    negativePrompt?: string;
    /** 画风模式：realistic（默认，写实）= txt2image/image2image；anime（卡通/日式动漫）= txt2imageanime（仅纯文生图，传参考图则回退写实图生图）。 */
    style?: 'realistic' | 'anime';
    /** 【占坑·待接入】视频模型选择：h3（默认，当前后端统一走 FL2VA 即 H3 技术路线）/ seedance2（未接入，传入会被忽略并返回提示）。 */
    model?: 'h3' | 'seedance2';
    /** 【占坑·待接入】分辨率指定（768p/1080p/720p/2k）：后端暂不支持，传入会被忽略（以 aspectRatio + 后端默认分辨率输出）。 */
    resolution?: '768p' | '1080p' | '720p' | '2k';
    /** 【占坑·待接入】是否生成原生音频轨（对应上游 skill 的 generate_audio=true）：当前后端版本未启用原生音频，传 true 会被忽略并返回提示。 */
    generateAudio?: boolean;
    duration?: number;
    /** 分镜格子数量（storyboard_generate 用，默认 4）。 */
    gridnum?: number;
    /** 是否增强风格迁移效果（style_transfer 用）。 */
    enhance?: boolean;
    /**
     * 节点级重试锚点：设置时把结果写回该已有节点（保留 id/位置/血缘），
     * 而不是追加新节点 —— 重试不产生新边（plan §7.8 标准 2）。
     */
    retryOf?: string;
    /**
     * 输入参考图对应的画布产物 URL（工具结果里的 url 字段）。落盘时按 URL
     * 反查画布节点并写入 sourceIds —— 血缘边（流程箭头）的唯一来源；缺省
     * 时新节点没有边（历史行为）。
     */
    sourceUrls?: string[];
    /**
     * CV-027：已解析的分镜卡节点 id（工具层由 shotRefs 解析而来），并入血缘
     * 与落位锚点——关键帧/视频排在其所属分镜卡的右侧。
     */
    shotNodeIds?: string[];
}
/** 一次生成的产物描述（返回给模型）。 */
export interface GenerateResult {
    url: string;
    width: number;
    height: number;
    duration?: number;
    /** Drama Backend 服务器文件名（storyboard_generate 透出，供 storyboard_split 链式调用）。 */
    filename?: string;
    /** 占坑参数提示（如 model=seedance2 / resolution / generateAudio 暂未接入时给出），渲染时追加到返回文本。 */
    warnings?: string[];
}
/** 钳制视频时长：1–maxVideoSeconds() 取整；未提供时用各工具的默认值。maxVideoSeconds 来自设置。 */
export declare function clampDuration(value: number | undefined, fallback: number): number;
/** 清空探针缓存（测试钩子；生产代码不需要主动失效）。 */
export declare function resetDramaProbeCache(): void;
/**
 * 确认 Drama Backend 可达：GET /api/v1/health（5s 超时），成功与失败都缓存
 * 30s —— 缓存窗口内的后续请求零开销快速通过/快速失败。
 */
export declare function ensureDramaReachable(signal?: AbortSignal): Promise<void>;
/**
 * 将相对 URL 解析为 loopback 绝对 URL（Host 端 fetch 用）。
 * 浏览器端 <img src> 能自动解析同源相对路径，但 Node 原生 fetch 不支持，
 * 而 image_generate 返回的产物 URL 是相对路径（/canvas-studio/assets/...），
 * 后续 video_generate / video_composite 作为参考图传入时必须先补全。
 */
declare function resolveImageUrl(url: string, port: number): string;
/** 上传一张图（本地路径 / canvas 资产 URL / 托管 URL）到 Drama Backend，返回服务器 filename。 */
declare function uploadImage(sourceUrl: string, signal?: AbortSignal, port?: number, registry?: ProjectRegistry): Promise<string>;
/**
 * 把图片字节上传到 Drama Backend（`uploadimage`），返回服务器 filename。
 * P8.1 本地图片与 P8.4 视频抽帧共用；表单文件名沿用唯一安全名约定
 * （只含 [A-Za-z0-9._-]），避免触发后端去重后缀破坏下游。
 */
export declare function uploadBytesToDrama(bytes: Uint8Array, ext: string, signal?: AbortSignal): Promise<string>;
/**
 * P8.1：把本地图片（base64）落地到项目 assets 目录，并返回可直接供生成工具
 * 使用的两个引用：
 * - `url`：同源相对路径（/canvas-studio/assets/<projectId>/<file>），画布素材节点直接用；
 * - `filename`：经 Drama `uploadimage` 拿到的服务器文件名，供 image_generate /
 *   video_generate / video_composite 的 filename(s) 参数使用。
 */
export declare function uploadLocalImage(registry: ProjectRegistry, projectId: string, name: string, dataBase64: string, signal?: AbortSignal): Promise<{
    url: string;
    filename: string;
}>;
/** 生成工具名 → 画布操作类型（边颜色/标签的语义来源）。 */
export declare function operationTypeOf(tool: string, params: GenerateParams): StudioCanvasOperationType;
/** 把生成参数序列化为 generationPrompt（节点重试时原样重放；retryOf 不入档）。 */
export declare function generationPromptOf(params: GenerateParams): string;
/**
 * 按画布产物 URL 反查节点 id（血缘 sourceIds 的来源）。URL 兼容两种形态：
 * 工具结果里的同源相对路径（/canvas-studio/assets/...）与早期版本写死的
 * http://127.0.0.1:<port> 绝对路径 —— 都归一化到相对路径后精确匹配。
 */
export declare function resolveSourceIds(nodes: readonly StudioCanvasNode[], urls: readonly string[] | undefined): string[];
/**
 * 按 Drama filename 反查画布节点 id（血缘自动补全）。生成参数里的
 * filename/filenames/styleFilename 都是素材节点落盘时写入的 Drama 文件名，
 * 据此可以确定性地还原「这次生成参考了哪些节点」——不依赖模型自觉填写
 * sourceUrls。与 URL 反查结果取并集后作为节点血缘。
 */
export declare function resolveSourceIdsByFilename(nodes: readonly StudioCanvasNode[], filenames: readonly (string | undefined)[]): string[];
/** 合并两种血缘来源（URL 反查 + filename 反查），去重保序。 */
export declare function mergeSourceIds(primary: readonly string[], secondary: readonly string[]): string[];
/**
 * CV-031：从已解析的来源节点继承分镜卡血缘。视频经关键帧生成时
 * （video_generate / video_composite），模型常漏传 shotRefs，导致视频只连
 * 关键帧、不连分镜卡。只要关键帧节点已连着所属分镜卡
 * （toolName=submit_storyboard_for_approval），就把该卡并入新节点父集合 ——
 * 「分镜 → 关键帧 → 视频」叙事链不因模型漏参断链。只上溯一层且只认分镜卡，
 * 不扩散到创意等其它上游。
 */
export declare function inheritShotCardIds(nodes: readonly StudioCanvasNode[], sourceIds: readonly string[]): string[];
/**
 * CV-024 落点策略：新节点排在其血缘来源节点的右侧一列（y 取来源最小 y），
 * 形成「创意 → 素材 → 生成物」的左到右流向；与现有节点重叠时逐步右移避让
 * （有界 50 步）。无来源时回退到与客户端一致的网格空位。
 * 必须在写入前用「当前画布节点」调用；splitStoryboard 的多子节点由调用方
 * 在返回值基础上自行做行内偏移。
 */
export declare function deriveNodePlacement(nodes: readonly StudioCanvasNode[], sourceIds: readonly string[], width: number, height: number): {
    x: number;
    y: number;
};
/** 提示词增强：调用 Drama Backend 的 image2promptenhance 接口。 */
export declare function enhancePrompt(prompt: string, signal?: AbortSignal): Promise<string>;
/** 图像分析（VLM）：调用 Drama Backend 的 image2vl 接口，使用已上传的文件名。 */
export declare function analyzeImage(filename: string, prompt: string, systemPrompt: string, signal?: AbortSignal): Promise<string>;
/**
 * 执行一次生成并落盘。
 * @param registry - 项目注册表（提供 assetsDir）。
 * @param tool - 工具名（image_generate / video_generate / video_composite / style_transfer / storyboard_generate）。
 * @param projectId - 目标项目 id。
 * @param params - 生成参数。
 * @param signal - 取消信号。
 */
export declare function generateAsset(registry: ProjectRegistry, tool: string, projectId: string, params: GenerateParams, signal?: AbortSignal): Promise<GenerateResult>;
export { uploadImage, resolveImageUrl };
export interface SplitStoryboardParams {
    /** 分镜网格图在 Drama Backend 的服务器文件名（来自 storyboard_generate 的 filename）。 */
    filename: string;
    /** 格子数量，默认 4；仅支持 4 / 6 / 9。 */
    gridnum?: number;
    /** 分镜网格图的画布产物 URL（用于反查节点、画血缘箭头）。 */
    sourceUrls?: string[];
}
export interface SplitStoryboardResult extends GenerateResult {
    /** 拆分出的单镜数量。 */
    count: number;
}
export declare function splitStoryboard(registry: ProjectRegistry, projectId: string, params: SplitStoryboardParams, signal?: AbortSignal): Promise<SplitStoryboardResult>;
