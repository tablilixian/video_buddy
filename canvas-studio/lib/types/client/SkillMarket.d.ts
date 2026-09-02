import type { ReactElement } from 'react';
import type { SkillCatalogEntry } from '../skill-catalog.js';
export interface SkillMarketProps {
    onClose: () => void;
    onActivate: (entry: SkillCatalogEntry) => void;
    /** CV-073：当前项目已装载的 skill（缺省空 = lobby 态无项目，我的视图隐藏）。 */
    activeSkills?: readonly string[];
    /** CV-073：卸载一个已装载 skill。 */
    onDeactivate?: (name: string) => void;
}
/** 全屏技能广场：左分类侧栏 + 右卡片网格。 */
export declare function SkillMarket(props: SkillMarketProps): ReactElement;
