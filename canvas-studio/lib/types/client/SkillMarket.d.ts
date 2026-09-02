import type { ReactElement } from 'react';
import type { SkillCatalogEntry } from '../skill-catalog.js';
export interface SkillMarketProps {
    onClose: () => void;
    onActivate: (entry: SkillCatalogEntry) => void;
}
/** 全屏技能广场：左分类侧栏 + 右卡片网格。 */
export declare function SkillMarket(props: SkillMarketProps): ReactElement;
