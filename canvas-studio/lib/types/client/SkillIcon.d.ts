/**
 * 技能广场图标（CV-065）：inline SVG，按 `SkillIconId` 映射。
 *
 * 不用 emoji —— 跨平台字形差异大，且在明暗主题下颜色不可控。全部走
 * `currentColor` + stroke，跟主题和卡片强调色自动联动。
 */
import type { ReactElement } from 'react';
import type { SkillIconId } from '../skill-catalog.js';
export interface SkillIconProps {
    /** 图标 id（来自 skill-catalog 的 icon 字段）。 */
    id: SkillIconId;
    /** 边长（px），默认 20。 */
    size?: number;
}
/** 按 id 渲染技能图标（id 未收录时落兜底的「方块横线」，不会渲染空白）。 */
export declare function SkillIcon(props: SkillIconProps): ReactElement;
