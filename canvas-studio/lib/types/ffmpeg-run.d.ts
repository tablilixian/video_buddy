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
/**
 * CV-140：探测一个**本地媒体文件**的真实时长（秒），尽力而为。
 *
 * 用途：生成产物落盘后把「请求时长」换成真值。实测 H3 按时长与帧率量化输出
 * （请求 5s → 5.167s = 124 帧 @24fps），请求值当作真值会让下游的时长校验与
 * 音画对齐全部偏一帧量级。
 *
 * **绝不抛错**：ffmpeg 不可用（未安装 / 未设 FFMPEG_PATH）、文件不存在、格式
 * 不识别、探测超时——一律返回 `0`，由调用方按「未知时长」回退。生成主路径不
 * 能因为一个「顺带的探测」而失败。
 */
export declare function probeMediaDuration(path: string, ffmpegPath?: string, signal?: AbortSignal): Promise<number>;
