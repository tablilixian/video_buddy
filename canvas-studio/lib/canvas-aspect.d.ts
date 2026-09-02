/**
 * 媒体节点画布显示尺寸统一规则（长边 480）。
 *
 * 真实分辨率 → 画布框换算的唯一事实来源。此前三处各自实现、规则漂移：
 * - generate.ts 的 previewSizeOf（1:1 → 420×420 特判）
 * - StudioFrame.tsx 的 longSide480（min60 短边地板）
 * - StudioFrame.tsx onMediaNatural 校正（长边 480）
 *
 * 统一后：1:1 用 420×420 紧凑框（保持 4 列网格视觉平衡，验收用例 I-2）；
 * 其余按长边固定 MEDIA_LONG_SIDE、短边等比缩放，并对极端宽/窄比例夹取
 * MIN_SHORT_SIDE 地板（防超宽银幕图被压成接近 1px 高）。
 */
/** 非 1:1 媒体画布框的长边（像素）。 */
export declare const MEDIA_LONG_SIDE = 480;
/** 1:1 正方形画布框边长（像素）：比长边 480 更紧凑，避免占满整行网格。 */
export declare const SQUARE_SIDE = 420;
/** 极端宽/窄比例下的最小短边（像素）。 */
export declare const MIN_SHORT_SIDE = 60;
export interface MediaDisplaySize {
    width: number;
    height: number;
}
/** 真实分辨率（宽高像素）→ 画布显示框尺寸。 */
export declare function previewSizeOf(media: {
    width: number;
    height: number;
}): MediaDisplaySize;
/**
 * CV-083：媒体秒数 → 「m:ss」显示（时长角标）。非法值（NaN/负数/未定义）
 * 返回 null，调用方据此决定是否渲染角标。纯函数，单测直连。
 */
export declare function formatMediaDuration(seconds: number | undefined): string | null;
