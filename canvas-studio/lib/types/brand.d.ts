/**
 * Canvas Studio 品牌令牌（可切换配色预设）。
 *
 * 纯数据 + 纯函数，无 DOM 依赖：Host/Client 双半均可编译，`node --test` 可直连
 * （tests/brand.test.mjs 直连 lib/brand.js）。DOM 注入逻辑在
 * `src/client/brand-inject.ts`，UI 组件在 `src/client/brand/`。
 *
 * 设计约束（brand-identity-proposal.md §3）：
 * - 令牌命名空间 `--cs-*`，叠加在 dsh `--dsw-alias-*` 语义令牌之上，不推翻宿主；
 * - 配色做成多预设可切换（Q3 拍板 2026-08-31）：切换只动 accent 族，gold/teal
 *   固定功能色与宿主语义色不变；
 * - 明暗双轨：浅色默认取 accentDeep，深色经 `body[data-ds-dark-theme]` 覆盖取 accent。
 */
export declare const BRAND_PRESET_IDS: readonly ["cinema-violet", "ocean-blue", "ember-violet", "amber-creative"];
export type BrandPresetId = (typeof BRAND_PRESET_IDS)[number];
/** 一套品牌配色的 accent 族 + 画布底色。 */
export interface BrandPreset {
    readonly id: BrandPresetId;
    /** 设置页展示名。 */
    readonly label: string;
    /** 一句话方向说明。 */
    readonly description: string;
    /** 主品牌色（暗色）。 */
    readonly accent: string;
    /** hover / 高亮。 */
    readonly accentStrong: string;
    /** pressed / 明色主色。 */
    readonly accentDeep: string;
    /** 选中背景（暗色 alpha）。 */
    readonly accentSoft: string;
    /** 选中背景（明色 alpha）。 */
    readonly accentSoftLight: string;
    /** 画布区底色（比宿主深一档）。 */
    readonly canvasBg: string;
    /** 画布区一级底色。 */
    readonly canvasBgL1: string;
    /** 画布网格线。 */
    readonly canvasGrid: string;
    /** 画布主网格线。 */
    readonly canvasGridMajor: string;
}
export declare const DEFAULT_BRAND_PRESET: BrandPresetId;
/** 四套品牌配色预设（默认 + 3 备选，用户可在设置页「外观」区切换）。 */
export declare const BRAND_PRESETS: Record<BrandPresetId, BrandPreset>;
/** 固定功能色（不随预设切换）：gold = HITL 审批，teal = 播放 / 预览。 */
export declare const BRAND_FIXED: {
    readonly gold: "#E8B45A";
    readonly teal: "#35C2A6";
};
/** 未知 / 空 id 一律回退默认预设（设置文档损坏或旧版本无该字段时兜底）。 */
export declare function resolveBrandPreset(id: string | null | undefined): BrandPreset;
/**
 * 生成某预设的完整 `--cs-*` 令牌 CSS 文本。
 *
 * 结构：`[data-cs-brand="<id>"]`（浅色默认：accent 取 deep、画布底浅色）
 * + `body[data-ds-dark-theme] [data-cs-brand="<id>"]`（深色：accent 取主色）。
 * 固定功能色与非配色令牌在两块都注入。切换 = 更新元素 textContent 与
 * `data-cs-brand` 属性（见 src/client/brand-inject.ts）。
 */
export declare function brandCssText(presetId: string | null | undefined): string;
/** 品牌 favicon（单色场记板简化形，data: URL，零外部请求）。 */
export declare const FAVICON_DATA_URL: string;
