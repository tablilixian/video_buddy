import type { StudioCanvasNode, StudioCanvasView } from '../../contracts/canvas.js';
/** Props for the pannable / zoomable canvas surface. */
export interface CanvasSurfaceProps {
    nodes: readonly StudioCanvasNode[];
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
    /** Context menu request (rendered by the frame). */
    onContextMenu(node: StudioCanvasNode, clientX: number, clientY: number): void;
    /** CV-018：失败节点就地重试（错误徽章兼作按钮，透传给 CanvasNode）。 */
    onRetry(id: string): void;
    /** CV-013/029：媒体加载后上报真实宽高（透传给 CanvasNode）。 */
    onMediaNatural?(id: string, naturalWidth: number, naturalHeight: number): void;
    /** When set, center this node in the viewport (timeline / review jump). */
    focusNodeId?: string | null;
    /** Whether the minimap overlay is shown (toggle lives in the toolbar). */
    minimapVisible?: boolean;
}
/** Imperative zoom controls exposed to the frame toolbar. */
export interface CanvasSurfaceHandle {
    zoomBy(factor: number): void;
    fitToContent(): void;
    resetZoom(): void;
}
/**
 * The infinite canvas: a grid background that pans/zooms with content, node
 * boxes placed at their canvas-space coordinates, the bloodline edge overlay,
 * snap alignment guides, a minimap, and corner zoom controls.
 *
 * The viewport (`offset`/`scale`) is controlled: it lives in the project store
 * so it survives restarts (canvas.json v3) and project switches. Interactions
 * follow the reference canvas controls: background pointer-down pans (middle
 * button or Shift+left also pan), wheel without modifiers pans, Ctrl/Cmd+wheel
 * zooms around the cursor, node pointer-down begins a node drag (snap
 * alignment + guides), the node's resize handles begin a resize, and the link
 * handle begins a manual connection drag. Keyboard: Delete removes the
 * selection, Ctrl/Cmd+C/V copy/paste, Ctrl/Cmd+Z / Ctrl+Shift+Z / Ctrl+Y
 * undo/redo, Ctrl/Cmd+A selects all, Escape clears the selection.
 */
export declare const CanvasSurface: import("react").ForwardRefExoticComponent<CanvasSurfaceProps & import("react").RefAttributes<CanvasSurfaceHandle>>;
