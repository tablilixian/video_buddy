import type { ProjectRegistry } from './projects.js';
import type { StudioCanvasNode } from './contracts/canvas.js';
/** 成片合成结果（返回给客户端落画布节点）。 */
export interface ComposeResult {
    /** 同源资产 URL（webServer 托管）。 */
    url: string;
    /** 合成后成片时长（秒；探测失败为 0）。 */
    duration: number;
    /** 合成后成片分辨率宽（像素；探测失败为 undefined）。 */
    width?: number;
    /** 合成后成片分辨率高（像素；探测失败为 undefined）。 */
    height?: number;
}
/** 合成可选覆盖项（测试注入 / 高级用法）。 */
export interface ComposeOptions {
    /** 显式指定 ffmpeg 可执行文件路径。 */
    ffmpegPath?: string;
    /** 统一转码目标帧率（默认 25）。 */
    fps?: number;
    /** 覆盖输出文件名（默认 export-<uuid>.mp4）。 */
    outputName?: string;
}
/** 单个分镜片段的输入描述（用于转码阶段）。 */
export interface ComposeClip {
    id: string;
    /** 同源资产 URL（/canvas-studio/assets/<projectId>/<file>）。 */
    url: string;
    /** 本地绝对文件路径。 */
    inputPath: string;
    /** 该片段是否含音轨（决定转码编码参数）。 */
    hasAudio: boolean;
}
/**
 * 将画布节点同源 URL 反查为本地资产文件绝对路径。
 * URL 形如 `/canvas-studio/assets/<projectId>/<file>`，资产目录由 registry
 * 提供；返回 `join(assetsDir, file)`。
 */
export declare function urlToAssetPath(assetsDir: string, url: string): string;
/**
 * 从画布节点收集合成所需的视频 clip（纯函数）。
 * - 仅接受 kind=video 的节点；
 * - clipIds 中缺失/非视频/重复 id 一律跳过；
 * - 返回命中的节点与缺失的 id 列表（缺失由调用方面向用户报「片段文件不存在」）。
 */
export declare function collectClips(nodes: readonly StudioCanvasNode[], clipIds: readonly string[]): {
    clips: StudioCanvasNode[];
    missingIds: string[];
};
/** 构造 concat demuxer 清单内容（纯函数）：每行 `file '<绝对路径>'`。 */
export declare function buildConcatList(paths: readonly string[]): string;
/** 统一转码参数（纯函数）。无音轨加 `-an`，有音轨重新编码为 aac。 */
export declare function buildTranscodeArgs(input: string, output: string, width: number, height: number, fps: number, hasAudio: boolean): string[];
/** concat 拼接参数（纯函数）。 */
export declare function buildConcatArgs(concatListPath: string, output: string): string[];
/**
 * BGM 混音参数（纯函数）。concat 产物有音轨时与 BGM 做 `amix=duration=first`
 * （钳制 BGM 音量）；无音轨时直接把 BGM 作为成片音轨。
 */
export declare function buildAmixArgs(concatOutput: string, bgmInput: string, output: string, hasConcatAudio: boolean): string[];
/**
 * 执行成片合成全流程（Host 侧）：
 * 1) 读取画布节点，收集 clip 并反查本地文件，缺失报「片段文件不存在」；
 * 2) 探测首个 clip 的分辨率（后续片段统一到此尺寸），无分辨率则报错；
 * 3) 逐段统一转码（25fps / yuv420p / 有音轨转 aac 否则 -an）；
 * 4) concat demuxer 拼接；
 * 5) 可选 BGM amix 混音；
 * 6) 落 `export-<uuid>.mp4` 于 assets 根目录，返回同源 URL + 成片时长。
 *
 * 整体受 120s 超时与调用方 `signal` 双重约束，超时/中断即抛中文错误。
 */
export declare function composeStudioVideo(registry: ProjectRegistry, projectId: string, clipIds: readonly string[], bgmNodeId?: string, options?: ComposeOptions, signal?: AbortSignal): Promise<ComposeResult>;
/** Host 侧把成片结果落为画布 video-composite 节点（供模型工具 compose_video 直接回写）。 */
export interface ComposedNodeInput {
    url: string;
    duration?: number;
    width?: number;
    height?: number;
    /** 源片段节点 id（血缘边指向它们）。 */
    sourceIds: string[];
    /** 成片文案（广告词/对白/字幕等），来自 write_script 节点。 */
    script?: string;
}
/**
 * 把合成结果写为画布节点（video-composite，origin=agent，血缘指向源片段），
 * 返回新建节点。位置沿用 4 列网格；真实分辨率写入 mediaWidth/mediaHeight，
 * 文案写入 `script`，使详情面板可展示。客户端工具/结果重载后即出现在画布。
 * 节点框按真实分辨率等比换算（竖屏成片不再被 260×180 横屏占位框 cover 裁切）。
 */
export declare function appendComposedVideoNode(registry: ProjectRegistry, projectId: string, input: ComposedNodeInput): Promise<StudioCanvasNode>;
