import type { AssetHandle } from '../reference-handle.js';
import type { SkillCatalogEntry } from '../skill-catalog.js';
export interface AssetChipPreviewProps {
    /** 当前项目的可引用素材（句柄 → 素材）。 */
    assets: readonly AssetHandle[];
    /** 可用技能目录（技能 chip hover 出说明卡，CV-124）。 */
    skills: readonly SkillCatalogEntry[];
    /** 点击卡片：打开对应的预览/播放浮层。 */
    onOpen(nodeId: string): void;
}
/**
 * 渲染（或不渲染）hover 缩略图卡片。常驻挂载、只在命中时出卡，
 * 不做条件渲染换容器（避免 composer 重挂载）。
 */
export declare function AssetChipPreview({ assets, skills, onOpen }: AssetChipPreviewProps): import("react").JSX.Element | null;
