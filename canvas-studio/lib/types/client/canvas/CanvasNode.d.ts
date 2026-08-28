import type { StudioCanvasNode, StudioCanvasOperationType } from '../../contracts/canvas.js';
/** Human-readable operation labels (edge chip + detail panel). */
export declare const OPERATION_LABELS: Readonly<Partial<Record<StudioCanvasOperationType, string>>>;
/** Resize corners (grid of 9, center omitted). */
declare const RESIZE_CORNERS: readonly ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
export type ResizeCorner = typeof RESIZE_CORNERS[number];
/** Props for a single canvas node box. */
export interface CanvasNodeProps {
    node: StudioCanvasNode;
    selected: boolean;
    /** Begin a drag (also selects; multi-select via ctrl/cmd). */
    onNodePointerDown(event: React.PointerEvent, node: StudioCanvasNode): void;
    /** Begin a resize gesture. */
    onResizePointerDown(event: React.PointerEvent, node: StudioCanvasNode, corner: ResizeCorner): void;
    /** Begin a manual connection drag (S6). */
    onLinkPointerDown(event: React.PointerEvent, node: StudioCanvasNode): void;
    /** Commit an inline rename. */
    onRenameSubmit(id: string, title: string): void;
    /** 双击节点：打开详情 / 编辑面板（验收反馈的「重新编辑窗口」入口）。 */
    onOpenDetail(node: StudioCanvasNode): void;
    /** Request the context menu at screen coordinates. */
    onContextMenu(node: StudioCanvasNode, clientX: number, clientY: number): void;
    /**
     * CV-013/029：媒体加载后上报真实宽高（总是上报；分辨率回填与框比例校正
     * 的决策在 frame 侧统一处理）。加载失败（无真实尺寸）不上报。
     */
    onMediaNatural?(id: string, naturalWidth: number, naturalHeight: number): void;
}
/**
 * One canvas node: media box or text annotation, placed at its canvas-space
 * coordinates. The surface owns pan/zoom/drag/resize gestures; this component
 * is presentational and reports pointer-downs with the intended gesture.
 * Visual state follows the reference LayerData semantics: locked (no drag),
 * loading overlay, error badge, opacity, flipX/flipY (media only), hidden
 * nodes are filtered by the surface.
 */
export declare function CanvasNode(props: CanvasNodeProps): import("react").JSX.Element;
export {};
