import type { StudioCanvasNodeKind, StudioCanvasOperationType } from '../../contracts/canvas.js';
/**
 * 画布标签唯一来源（CV-004）：节点类型与操作类型的中文名此前分散在
 * CanvasNode / CanvasEdges / LayerPanel / LayerDetailPanel / CanvasTimeline
 * 五处且已漂移（storyboard-split 缺失导致详情面板显示原始英文 key），统一
 * 收敛到本模块共用，新增类型只改这里。
 */
/** 节点类型中文标签（节点角标 / 图层行 / 详情面板 / 时间轴 chip 共用）。 */
export declare const KIND_LABEL: Readonly<Record<StudioCanvasNodeKind, string>>;
/** 操作类型中文标签（边 chip + 详情面板共用）。 */
export declare const OPERATION_LABELS: Readonly<Record<StudioCanvasOperationType, string>>;
