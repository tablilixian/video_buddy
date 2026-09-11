import type { ProjectRegistry } from './projects.js';
import { resolveFfmpegPath, parseFfmpegDuration } from './ffmpeg-run.js';
/** ffmpeg 解析顺序与运行基础设施已抽到 ffmpeg-run（P9 复用）；API 保持不变。 */
export { resolveFfmpegPath, parseFfmpegDuration };
/**
 * 归纳提示词已抽到 `style-tokens.ts`（单一权威）：5 个字段名与格式在那里定义，
 * Agent 侧 `references/look.md` 的提示词原文由测试断言与其逐字节一致。
 */
/** 单帧产物：同源 URL + Drama 文件名 + 采样时间点（秒）。 */
export interface VideoFrameImport {
    url: string;
    filename: string;
    time: number;
}
/** 参考视频抽帧提风格的完整结果（返回给客户端落画布）。 */
export interface VideoStyleResult {
    /** 视频本体落盘后的同源 URL（留档；画布暂不建视频节点，见 plan §4.4）。 */
    videoUrl: string;
    /** 探测到的视频时长（秒；探测失败为 0）。 */
    duration: number;
    frames: VideoFrameImport[];
    /** 风格归纳文本（风格归纳 sticky 节点的正文）：头部 + 逐帧观察 + 末尾「5 项风格 tokens」段。 */
    summary: string;
    /**
     * 归并后的 5 项 tokens（色彩 / 光线 / 材质 / 镜头语汇 / 节奏，每行一个字段）。
     * 供 Look 采集直接复用（`docs/look-asset-plan.md` §3.2）；`''` 表示 VLM 未按格式输出、
     * 归并失败 → 应走降级（改用参考图归纳或从用户原话反推），不要把空串当结论。
     */
    tokens: string;
}
/** 可选覆盖项（测试注入 / 高级用法）。 */
export interface VideoStyleOptions {
    /** 显式指定 ffmpeg 可执行文件路径（优先于 env 与自动探测）。 */
    ffmpegPath?: string;
    everySeconds?: number;
    maxFrames?: number;
    styleSamples?: number;
}
/**
 * 规划抽帧时间点（纯函数）：
 * - 时长未知/非法：只取第 0 帧；
 * - 短片（≤ every×max）：从 0 开始每 every 秒一帧；
 * - 长片（> every×max）：改为全片均匀取 max 帧（风格采样覆盖全片，仍 ≤ max）。
 * 返回保留两位小数的秒值，均严格小于时长。
 */
export declare function planFrameTimes(durationSec: number, options?: {
    everySeconds?: number;
    maxFrames?: number;
}): number[];
/**
 * 执行「上传参考视频 → 抽帧 → 上传 Drama → 风格归纳」全流程。
 * 视频与帧都写入项目 assets 目录（同源 URL 由 webServer 托管）；任何一步失败
 * 都整体抛错（客户端提示，不落半成品节点）。
 */
export declare function extractVideoStyle(registry: ProjectRegistry, projectId: string, name: string, bytes: Buffer, options?: VideoStyleOptions, signal?: AbortSignal): Promise<VideoStyleResult>;
