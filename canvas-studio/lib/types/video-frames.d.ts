import type { ProjectRegistry } from './projects.js';
/** 帧图节点缺分辨率时的回退**节点框**尺寸（与成片回退一致，见 canvas-aspect
 *  的 DEFAULT_NODE_SIZE = 画面 260×180 + 镜头条 chrome）。
 *  C10：改取统一出口 —— 直接内联使用，此处不再另存一份副本。 */
/**
 * 规划末帧抽帧时间点（纯函数）：时长未知 / 非正时取 0；否则取
 * `时长 - ε`（两位小数，不低于 0）。
 */
export declare function planLastFrameSeek(durationSec: number): number;
/** 末帧抽取结果。 */
export interface LastFrameResult {
    /** 末帧图的同源 URL（画布节点已落盘）。 */
    url: string;
    /** 末帧图的 Drama Backend 文件名（可直接作下游工具输入）。 */
    filename: string;
    /** 探测到的源视频时长（秒；探测失败为 0）。 */
    duration: number;
    /** 帧图宽度（像素；探测失败为 undefined）。 */
    width?: number;
    /** 帧图高度（像素；探测失败为 undefined）。 */
    height?: number;
    /** 落盘节点 id（便于后续按节点引用）。 */
    nodeId: string;
}
/** 可选覆盖项（测试注入 / 高级用法）。 */
export interface LastFrameOptions {
    /** 显式指定 ffmpeg 可执行文件路径。 */
    ffmpegPath?: string;
    /** 上传帧图取 filename 的实现；缺���用 `uploadBytesToDrama`（Drama uploadimage）。 */
    upload?: (bytes: Uint8Array, signal?: AbortSignal) => Promise<string>;
}
/**
 * 抽取某视频节点的真实末帧并落画布。
 *
 * @param registry - project registry（读画布、落节点、定位 assets 目录）。
 * @param projectId - target project id.
 * @param videoUrl - 视频节点的同源 URL（video_generate / video_composite 返回的 url）。
 * @param options - ffmpeg 路径与上传实现覆盖。
 * @param signal - 取消信号（用户中断 / 请求断开）。
 * @throws 视频文件不存在、ffmpeg 不可用、抽帧失败时抛中文错误。
 */
export declare function extractLastFrame(registry: ProjectRegistry, projectId: string, videoUrl: string, options?: LastFrameOptions, signal?: AbortSignal): Promise<LastFrameResult>;
