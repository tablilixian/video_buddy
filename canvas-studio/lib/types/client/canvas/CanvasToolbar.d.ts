import type { StudioCanvasNodeKind } from '../../contracts/canvas.js';
/** Manually addable node kinds (media comes from agent generation). */
type ManualNodeKind = Extract<StudioCanvasNodeKind, 'sticky' | 'text' | 'prompt'>;
/** Props for the floating canvas toolbar. */
export interface CanvasToolbarProps {
    canUndo: boolean;
    canRedo: boolean;
    selectedCount: number;
    hasSelection: boolean;
    onUndo(): void;
    onRedo(): void;
    onDelete(): void;
    onGroup(): void;
    onUngroup(): void;
    /** One-click overlap-free arrange (the only layout action by design). */
    onAutoArrange(): void;
    onAddNode(kind: ManualNodeKind): void;
    /** P8.1：打开本地文件选择器上传图片到当前项目（落画布素材节点）。 */
    onUploadImage(file: File): void;
    /** P8.4：打开本地文件选择器上传参考视频（Host 抽帧提风格后落画布）。 */
    onUploadVideo(file: File): void;
    /** Toggle the layer list overlay inside the canvas. */
    layersOpen: boolean;
    onToggleLayers(): void;
    /** Current zoom level (percent) shown next to the zoom buttons. */
    scale: number;
    onZoomOut(): void;
    onZoomIn(): void;
    onFitContent(): void;
    onResetZoom(): void;
    /** Show / hide the minimap overlay. */
    minimapVisible: boolean;
    onToggleMinimap(): void;
    /** 打开 Canvas Studio 设置弹窗（配置 Drama 基址 / 时长 / Key）。 */
    onOpenSettings(): void;
}
/**
 * The canvas toolbar: undo/redo, selection editing (delete/group/ungroup),
 * the one-click arrange, and manual node creation (sticky/text/prompt).
 * Everything is props-driven — the frame wires the store actions.
 * Group visibility is driven by {@link TOOLBAR_VISIBILITY}.
 */
export declare function CanvasToolbar(props: CanvasToolbarProps): import("react").JSX.Element;
export {};
