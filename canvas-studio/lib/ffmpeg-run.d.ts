/** 单段 ffmpeg 调用的默认超时（毫秒）。合成整体另有 120s 上限。 */
export declare const FFMPEG_TIMEOUT_MS = 60000;
/** 随包 ffmpeg 的目录键（与打包脚本 `build/ffmpeg/<key>/` 同名）。 */
export declare function bundledFfmpegKey(platform: string, arch: string): string;
/** 随包 ffmpeg 的定位输入（纯数据，便于单测注入）。 */
export interface BundledFfmpegLocator {
    /** 运行平台，如 `darwin` / `win32`。 */
    readonly platform: string;
    /** 运行架构，如 `arm64` / `x64`（Rosetta 下为 x64，与随包目录一致）。 */
    readonly arch: string;
    /** Electron 主进程的 `process.resourcesPath`；纯 Node 下不存在。 */
    readonly resourcesPath?: string | undefined;
    /** 显式覆盖目录（`DSH_FFMPEG_DIR`）：其下同样按 `ffmpeg/<platform>-<arch>/` 布局。 */
    readonly overrideDir?: string | undefined;
    /** 当前模块所在目录，用于向上寻找随包资源根。 */
    readonly moduleDir?: string | undefined;
}
/**
 * 随包 ffmpeg 的候选路径（按优先级、去重）。纯函数：不读盘、不看全局状态。
 *
 * 候选根依次：显式覆盖目录 → Electron `resourcesPath` → 模块祖先目录。最后一档
 * 覆盖「代码不在 Electron 主进程、拿不到 `resourcesPath`」的场景——打包后模块位于
 * `<Resources>/app.asar.unpacked/node_modules/canvas-studio/lib/`，向上第三级正是
 * `<Resources>`，于是 `<Resources>/ffmpeg/<key>/ffmpeg` 仍能被命中。
 */
export declare function bundledFfmpegCandidates(locator: BundledFfmpegLocator): string[];
/**
 * 解析本机可用的 ffmpeg 可执行路径：显式参数 → FFMPEG_PATH → 随包二进制 →
 * ffmpeg-static（仅当二进制真实存在）→ PATH。全部落空抛面向用户的错误。
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
 * CV-188：一次 `ffmpeg -i` 的探测结果 —— 时长 + 视频流分辨率。
 *
 * `duration` 为 0 / 尺寸字段缺失 = 未探到（调用方回退声明值），不区分失败原因。
 */
export interface MediaInfo {
    /** 时长（秒）；未探到为 `0`。 */
    duration: number;
    /** 视频流宽度（px）；未探到为 `undefined`。 */
    width?: number;
    height?: number;
}
/**
 * 探测一个**本地媒体文件**的真实时长与分辨率，尽力而为。
 *
 * 时长（CV-140）：生成产物落盘后把「请求时长」换成真值。实测 H3 按时长与帧率
 * 量化输出（请求 5s → 5.167s = 124 帧 @24fps），请求值当真值会让下游的时长校验
 * 与音画对齐全部偏一帧量级。
 *
 * 分辨率（CV-188）：**同一个 stderr 里就有**（`parseFfmpegStreams` 早已在解析
 * 它，只是此前只给末帧抽取用）。视频侧的真实产物像素由**供应商**决定——Drama
 * 固定 0.4MP、fal 按档——所以「上游声明的像素」是一句会随后端行为静默失真的
 * 二手话。实测句号：`ffmpeg -i` 说多少就是多少，后端哪天变了也自动跟上。
 *
 * **绝不抛错**：ffmpeg 不可用（未安装 / 未设 FFMPEG_PATH）、文件不存在、格式
 * 不识别、探测超时——一律返回 `{ duration: 0 }`，由调用方按「未知」回退。
 * 生成主路径不能因为一个「顺带的探测」而失败。
 */
export declare function probeMediaInfo(path: string, ffmpegPath?: string, signal?: AbortSignal): Promise<MediaInfo>;
/** 只要时长时的薄封装（CV-140 既有调用点与测试共用同一实现，不另写一份探测）。 */
export declare function probeMediaDuration(path: string, ffmpegPath?: string, signal?: AbortSignal): Promise<number>;
