import type { VideoResolution } from './providers/types.js';
/**
 * 生成接口端点（与 WL 适配器对齐）。
 * 注：Drama Backend 的基址 / 密钥已外置到 DSH 设置系统（见 host-config.ts），
 * 不再在此写死明文常量。
 */
export declare const DRAMA_ENDPOINTS: {
    readonly health: "/api/v1/health";
    readonly txt2image: "/api/v1/generate/txt2image";
    readonly txt2imageanime: "/api/v1/generate/txt2imageanime";
    readonly image2image: "/api/v1/generate/image2image";
    /**
     * 统一文件上传（图片 / 视频 / 音频）——**唯一**的上传端点（CV-137，2026-09-10 实测）。
     *
     * 旧的 `/api/v1/generate/uploadimage` 已从后端路由表移除：对任何文件均返回
     * `404 {"detail":"Not Found"}`（openapi.json 里也不再出现该路径）。不要再改回去。
     * 响应为 ComfyUI 原生结构 `{name, subfolder, type}`，`name` 即下游工具所需的文件名。
     */
    readonly upload: "/api/v1/generate/upload";
    readonly promptEnhance: "/api/v1/generate/image2promptenhance";
    readonly image2vl: "/api/v1/generate/image2vl";
    readonly character: "/api/v1/generate/image2character";
    readonly videoFl2va: "/api/v1/generate/image2videofl2va";
    readonly videoRef2va: "/api/v1/generate/image2videoref2va";
    readonly txt2audio: "/api/v1/generate/txt2audio";
};
/**
 * 分辨率档位 → 输出像素（16:9 基准，宽高**均为 32 的倍数**）。**唯一事实来源**。
 *
 * 数值 = H3 推荐分辨率表的 0.4 / 1.0 / 2.0 三行，**不是自由取值**：
 * 视频端点（`image2videofl2va` / `image2videoref2va`）只收 `megapixels`，
 * 不收 width/height，像素只能由这张表反推。
 *
 * 为什么必须与真实产物同值：节点落盘写 `mediaWidth/mediaHeight`，而客户端只在
 * `mediaWidth === undefined` 时用自然尺寸回填（StudioFrame.tsx）——**已写入的值永不
 * 被纠正**。填表外的值（如旧的 1280×720）会让「声明的分辨率 ≠ 真实产物」永久留在
 * 画布上（详情面板给每个视频显示错误的数字）。
 */
export declare const OUTPUT_SIZE: Record<VideoResolution, {
    width: number;
    height: number;
}>;
/** 默认档位（设置项 `defaultResolution` 的默认值，两处必须一致）。 */
export declare const DEFAULT_RESOLUTION: VideoResolution;
/** 合法档位判定 —— 工具入参 / 设置项 / 历史值归一三处共用（避免校验散落）。 */
export declare function isVideoResolution(value: unknown): value is VideoResolution;
/**
 * 宽高比 + 档位 → 像素尺寸（图片与视频**共用同一个档位**，故只用这一份实现）。
 *
 * 9:16 反宽高；1:1 恒 1024×1024（方形不是 H3 输出规格，三档共用，无档位意义）。
 * 第 2 参带默认值 ⇒ 既有调用点（`generate.ts`）与既有测试零改动即可编译。
 */
export declare function sizeForAspectRatio(aspectRatio: string | undefined, resolution?: VideoResolution): {
    width: number;
    height: number;
};
/** 生成一个资产文件名用的 UUID。 */
export declare function newAssetId(): string;
