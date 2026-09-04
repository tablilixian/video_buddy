/**
 * 品牌 mark（inline SVG，颜色走 --cs-* 令牌，随品牌预设与明暗主题联动）。
 *
 * 定稿方向 = V2「Aperture Squircle」（brand-identity-proposal.md §5 已拍板）：
 * 一整块 squircle 板体，用负空间切出左侧铰链缝与画布窗，窗内 3×2 点阵；
 * 顶区两道深紫斜条纹是场记板的识别锚点。几何与 assets/brand/logo.svg（由
 * scripts/build-brand-assets.mjs 生成）同源 —— 64 网格，此处用令牌以便明暗/预设联动。
 */
import type { ReactElement } from 'react';
export interface LogoMarkProps {
    /** 渲染尺寸（px）；mark 为 1:1 方形。 */
    size?: number;
    /** 额外 className（默认取 csLogoMark）。 */
    className?: string;
}
export declare function LogoMark(props: LogoMarkProps): ReactElement;
