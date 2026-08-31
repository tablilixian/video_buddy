/**
 * Studio 三态组件 + 首启欢迎屏（brand-identity-proposal.md §6）。
 *
 * - StudioEmptyState：首启欢迎屏（无任何项目时画布区）—— 品牌 logo + 定位句 +
 *   双 CTA（新建项目 / 创建示例项目）；
 * - CanvasEmptyHint：有项目但画布无节点 —— 画布中心引导卡；
 * - StudioLoadingState：通用品牌加载卡（列表 / 画布载入）;
 * - StudioErrorState：错误三级处置（可重试 / 配置缺失 → 打开设置 / 服务不可达），
 *   分类逻辑在 src/error-kind.ts（纯函数，可单测）。
 */
import type { ReactElement } from 'react';
export interface StudioEmptyStateProps {
    /** 新建项目（打开左侧新建表单的上级回调）。 */
    onCreate: () => void;
    /** 创建示例项目（apply 世界：建项目 + 预置画布节点）。 */
    onCreateSample: () => void;
    /** 示例项目创建中。 */
    creating: boolean;
}
/** 首启欢迎屏（画布区）。 */
export declare function StudioEmptyState(props: StudioEmptyStateProps): ReactElement;
/** 有项目但画布无节点：画布中心引导卡（pointer-events none，不挡画布交互）。 */
export declare function CanvasEmptyHint(): ReactElement;
export interface StudioLoadingStateProps {
    /** 加载文案（默认「正在加载项目…」）。 */
    label?: string;
}
/** 通用品牌加载卡（骨架感：logo 微光 + 文案）。 */
export declare function StudioLoadingState(props: StudioLoadingStateProps): ReactElement;
export interface StudioErrorStateProps {
    /** 原始错误消息（用于启发式分级）。 */
    message: string;
    /** 重试回调。 */
    onRetry: () => void;
    /** 打开设置回调（配置缺失时显示；不传则隐藏该按钮）。 */
    onOpenSettings?: () => void;
}
/** 错误三级处置卡。 */
export declare function StudioErrorState(props: StudioErrorStateProps): ReactElement;
