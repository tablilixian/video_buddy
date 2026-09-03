import type { StudioCanvasNode } from '../../contracts/canvas.js';
/** Props for the bloodline edge overlay. */
export interface CanvasEdgesProps {
    nodes: readonly StudioCanvasNode[];
    /** Selected node ids (edge highlight when either endpoint is selected). */
    selectedNodeIds: readonly string[];
    /** 当前视口缩放（CV-032：线宽与 chip 反向缩放，屏幕尺寸恒定）。 */
    scale: number;
}
/**
 * Bloodline edges: every node draws a bezier from each of its `sourceIds`
 * sources to its own left edge, colored by the target node's operationType
 * with an arrow marker and a Chinese operation chip at the midpoint (the
 * reference ConnectionLines rendering, adapted to canvas-space coordinates —
 * this SVG sits inside the transformed layer, so no manual offset/scale).
 * CV-032：线宽 / 箭头 / chip 均按 1/scale 反向补偿，小缩放下保持屏幕尺寸
 * 恒定（此前 3.5 用户单位宽度在 0.3x 缩放下不足 1px，几乎不可见）；箭头
 * marker 默认随 strokeWidth 缩放，无需单独补偿。CV-014：chip 低缩放隐藏
 * （scale < 0.6）只留线，选中节点相关边的 chip 始终保留。
 * There is no separate edge table — edges are derived from the node graph at
 * render time (plan §7.3).
 */
export declare function CanvasEdgesInner(props: CanvasEdgesProps): import("react").JSX.Element;
export declare const CanvasEdges: import("react").MemoExoticComponent<typeof CanvasEdgesInner>;
