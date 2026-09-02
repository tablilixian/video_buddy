import type { ReactElement } from 'react';
import type { SkillCatalogEntry } from '../skill-catalog.js';
export interface SkillCarouselProps {
    entries: readonly SkillCatalogEntry[];
    onActivate: (entry: SkillCatalogEntry) => void;
    /** 打开全屏技能广场。 */
    onOpenAll: () => void;
}
/** 推荐技能横滚条。 */
export declare function SkillCarousel(props: SkillCarouselProps): ReactElement;
