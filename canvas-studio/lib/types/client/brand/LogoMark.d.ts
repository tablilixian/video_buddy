/**
 * 场记板 logo（inline SVG，颜色走 --cs-* 令牌，随品牌预设与明暗主题联动）。
 *
 * 概念（brand-identity-proposal.md §5）：上半白板嵌画布点阵（连接品牌名与
 * 产品形态），下半斜条纹用品牌 accent —— "agent 是导演，用户喊 Action"。
 */
import type { ReactElement } from 'react';
export interface LogoMarkProps {
    /** 渲染宽度（px）；高度按 viewBox 比例 118:96 计算。 */
    size?: number;
    /** 额外 className（默认取 csLogoMark）。 */
    className?: string;
}
export declare function LogoMark(props: LogoMarkProps): ReactElement;
