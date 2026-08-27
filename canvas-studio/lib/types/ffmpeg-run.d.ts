/** 单段 ffmpeg 调用的默认超时（毫秒）。合成整体另有 120s 上限。 */
export declare const FFMPEG_TIMEOUT_MS = 60000;
/**
 * 解析本机可用的 ffmpeg 可执行路径：显式参数 → FFMPEG_PATH → ffmpeg-static
 * （仅当二进制真实存在）→ PATH。全部落空抛中文可操作错误。
 */
export declare function resolveFfmpegPath(explicit?: string): string;
/** 一次 ffmpeg 调用的结果。 */
export interface FfmpegRunResult {
    code: number;
    stdout: string;
    stderr: string;
}
/**
 * 运行一次 ffmpeg，收集 stdout/stderr；超时强杀并报错；`signal` 中断时以
 * `signal.reason` 拒绝（与上游 DOMException 语义一致）。
 */
export declare function runFfmpeg(ffmpegPath: string, args: readonly string[], timeoutMs: number, signal?: AbortSignal): Promise<FfmpegRunResult>;
/**
 * 从 `ffmpeg -i` 的 stderr 解析视频流分辨率与音频存在性。返回的尺寸为
 * `undefined` 表示未探测到视频流（调用方按错误/兜底处理）；`hasAudio` 反映
 * 是否出现 `Audio:` 流描述。
 */
export interface FfmpegStreamInfo {
    width?: number;
    height?: number;
    hasAudio: boolean;
}
export declare function parseFfmpegStreams(stderr: string): FfmpegStreamInfo;
/**
 * 从 `ffmpeg -i` 的 stderr 里解析 `Duration: HH:MM:SS.frac` 为秒。
 * 解析失败返回 0（调用方按「未知时长」处理）。
 */
export declare function parseFfmpegDuration(stderr: string): number;
