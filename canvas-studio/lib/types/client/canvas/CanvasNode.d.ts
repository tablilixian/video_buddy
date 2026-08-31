import type { StudioCanvasNode } from '../../contracts/canvas.js';
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
    /** CV-001：提交文本类节点（sticky/text/prompt）的内联正文编辑。 */
    onTextSubmit(id: string, text: string): void;
    /** 双击媒体类节点：打开详情 / 编辑面板（D1 方案 A：文本类双击=内联编辑）。 */
    onOpenDetail(node: StudioCanvasNode): void;
    /** CV-044：双击视频节点 —— 打开固定尺寸播放浮层（替代原生双击全屏）。 */
    onOpenPlayback?(node: StudioCanvasNode): void;
    /** CV-044 扩展：双击图片节点 —— 打开大图预览浮层（替代打开详情面板）。 */
    onOpenPreview?(node: StudioCanvasNode): void;
    /** Request the context menu at screen coordinates. */
    onContextMenu(node: StudioCanvasNode, clientX: number, clientY: number): void;
    /** CV-018：失败节点就地重试（重放同参数生成）。 */
    onRetry(id: string): void;
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
