import type { StudioCanvasNode, StudioCanvasView } from '../../contracts/canvas.js';
import { type FitResult } from '../../canvas-view.js';
/** Props for the pannable / zoomable canvas surface. */
export interface CanvasSurfaceProps {
    nodes: readonly StudioCanvasNode[];
    /**
     * C2：镜号表（节点 id → 成片第几段，1 起），由 StudioFrame 按 `isShotClip` +
     * `deriveTimelineOrder` 派生后注入 —— 与底部时间轴同源。缺省 = 不显示镜号
     * chip（宿主测试与既有调用方无需提供）。
     */
    shotIndexOf?: ReadonlyMap<string, number>;
    /** Controlled viewport + panel state (persisted per project in the store). */
    view: StudioCanvasView;
    /** Merge a viewport patch into the store (the caller owns persistence). */
    onViewChange(patch: Partial<StudioCanvasView>): void;
    selectedNodeId: string | null;
    selectedNodeIds: readonly string[];
    /** Select a node (or null to clear); `multi` toggles in the multi-select roster. */
    onSelectNode(id: string | null, multi?: boolean): void;
    /** Select all nodes of the project. */
    onSelectAllNodes(): void;
    /** Live node move during drag (canvas-space coordinates). */
    onMoveNode(id: string, x: number, y: number): void;
    /** Live node field update (resize). */
    onUpdateNode(id: string, updates: Partial<StudioCanvasNode>): void;
    /** Snapshot history before a mutation gesture (drag/resize start). */
    onBeginEdit(): void;
    /** Persist after a drag / resize / link / rename ends. */
    onPersist(): void;
    /** Remove nodes (keyboard / context menu). */
    onRemoveNodes(ids: string[]): void;
    onCopy(): void;
    onPaste(): void;
    onUndo(): void;
    onRedo(): void;
    /** Manual bloodline: target node gains the source ids. */
    onLinkLayers(sourceIds: string[], targetId: string): void;
    /** Inline rename commit. */
    onRename(id: string, title: string): void;
    /** CV-001：文本类节点内联正文编辑提交。 */
    onNodeTextSubmit(id: string, text: string): void;
    /** 双击节点：打开详情 / 编辑面板。 */
    onNodeOpenDetail(node: StudioCanvasNode): void;
    /** CV-044：双击视频节点 —— 打开固定尺寸播放浮层（透传给 CanvasNode）。 */
    onNodeOpenPlayback?(node: StudioCanvasNode): void;
    /** CV-044 扩展：双击图片节点 —— 打开大图预览浮层（透传给 CanvasNode）。 */
    onNodeOpenPreview?(node: StudioCanvasNode): void;
    /** Context menu request (rendered by the frame). */
    onContextMenu(node: StudioCanvasNode, clientX: number, clientY: number): void;
    /** CV-016：右键画布空白处（节点自身会拦截冒泡，这里只收空白）。 */
    onBlankContextMenu(clientX: number, clientY: number, worldX: number, worldY: number): void;
    /** CV-018：失败节点就地重试（错误徽章兼作按钮，透传给 CanvasNode + 就近工具条）。 */
    onRetry(id: string): void;
    /**
     * 就近工具条：打开详情抽屉并编辑提示词。缺省则不渲染该按钮 ——
     * 宿主测试与既有调用方无需提供（同 `onNodeOpenPlayback` 的约定）。
     */
    onEditPrompt?(node: StudioCanvasNode): void;
    /** 就近工具条：把节点作为引用标记插入聊天输入框。 */
    onNodeReferenceToChat?(node: StudioCanvasNode): void;
    /**
     * 底部详情抽屉当前占掉的高度（屏幕 px，抽屉关着时为 0）。
     * 就近工具条不得落进抽屉里 —— 抽屉是后画的浮层，压在工具条上就等于点了没反应。
     */
    detailInset?: number;
    /** CV-013/029：媒体加载后上报真实宽高（透传给 CanvasNode）。 */
    onMediaNatural?(id: string, naturalWidth: number, naturalHeight: number): void;
    /** When set, center this node in the viewport (timeline / review jump). */
    focusNodeId?: string | null;
    /** Whether the minimap overlay is shown (toggle lives in the toolbar). */
    minimapVisible?: boolean;
    /**
     * CV-185：适配视野被可读下限挡住时回调（内容多于视口能容纳的量）。
     * 由 frame 决定怎么提示 —— 画布这一层不认识 toast。
     */
    onFitClamped?(result: FitResult): void;
}
/** Imperative zoom controls exposed to the frame toolbar. */
export interface CanvasSurfaceHandle {
    zoomBy(factor: number): void;
    /**
     * CV-185：适配视野。返回 `null` = 画布上没有内容；返回 `clamped: true` =
     * 内容太多、比例已被可读下限（FIT_MIN_SCALE）挡住，视野外还有东西。
     */
    fitToContent(): FitResult | null;
    /** CV-019：缩放到选中节点（无选中时等价 fitToContent）。 */
    zoomToSelection(): void;
    resetZoom(): void;
    /** CV-184：把指定节点带进视野（只平移不改缩放；手势进行中不抢镜头）。 */
    revealNodes(ids: readonly string[]): void;
    /** CV-185：画布可视区尺寸 —— 整理布局用它决定「排成什么形状」。 */
    viewportSize(): {
        width: number;
        height: number;
    } | null;
}
/**
 * The infinite canvas: a grid background that pans/zooms with content, node
 * boxes placed at their canvas-space coordinates, the bloodline edge overlay,
 * snap alignment guides, a minimap, and corner zoom controls.
 *
 * The viewport (`offset`/`scale`) is controlled: it lives in the project store
 * so it survives restarts (canvas.json v3) and project switches. Interactions:
 * a blank press clears the selection immediately (Ctrl/Cmd excepted) and
 * left-drag (or middle button) pans, wheel without modifiers pans, Ctrl/Cmd+wheel
 * zooms around the cursor, node pointer-down begins a node drag (snap
 * alignment + guides), Ctrl/Cmd+pointer-down on a node toggles its membership in
 * the multi-select roster (no drag), the node's resize handles begin a resize,
 * and the link handle begins a manual connection drag. Keyboard: Delete removes
 * the selection, Ctrl/Cmd+C/V copy/paste, Ctrl/Cmd+Z / Ctrl+Shift+Z / Ctrl+Y
 * undo/redo, Ctrl/Cmd+A selects all, Escape clears the selection. Marquee
 * box-selection has been removed — type-based selection lives in the layer
 * panel header.
 */
export declare const CanvasSurface: import("react").ForwardRefExoticComponent<CanvasSurfaceProps & import("react").RefAttributes<CanvasSurfaceHandle>>;
