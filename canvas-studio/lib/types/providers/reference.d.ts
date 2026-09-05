import type { ProjectRegistry } from '../projects.js';
/** 读取项目资产目录下的一个文件，返回字节与扩展名（去点、小写，缺省 png）。 */
export declare function readLocalAssetBytes(registry: ProjectRegistry, projectId: string, file: string): Promise<{
    bytes: Uint8Array;
    ext: string;
}>;
/**
 * 单张参考图编码后的上限（字节）。超限直接抛错——让 fal 甩一个 413 回来远不如
 * 本地说清楚原因（方案 §5.5 逃生阀）。
 */
export declare const FAL_MAX_SINGLE_REFERENCE_BYTES: number;
/** 全部参考图编码后的合计上限（字节）。 */
export declare const FAL_MAX_TOTAL_REFERENCE_BYTES: number;
/** 编码选项：显式 ffmpeg 路径（测试替身）与取消信号。 */
export interface FalDataUriOptions {
    readonly ffmpegPath?: string;
    readonly signal?: AbortSignal;
}
/**
 * 把参考图编码为 fal 可接受的 base64 data URI（阶段 5：含 ffmpeg 降采样）。
 *
 * fal 不认 Drama 的服务器 filename 句柄，图片参考必须是公网 URL 或 data URI；
 * 本地画布产物没有公网 URL，故统一内联。默认先经 ffmpeg 压成 JPEG（长边 ≤1024），
 * 失败则回退原字节——宁可多传一点，也不要因为本机没装 ffmpeg 而阻断生成。
 */
export declare function toFalDataUri(asset: {
    bytes: Uint8Array;
    ext: string;
}, options?: FalDataUriOptions): Promise<string>;
/**
 * 逃生阀：编码后的参考图超过单张 / 合计上限时抛中文错误，而不是等着 fal 回 413。
 */
export declare function assertFalReferenceSizes(dataUris: readonly string[]): void;
