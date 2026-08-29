import type { StudioCanvasNode } from '../../contracts/canvas.js';
/** Props for the layer detail panel. */
export interface LayerDetailPanelProps {
    node: StudioCanvasNode;
    /** 当前项目全部节点：按 Drama filename 反查参考图缩略图。 */
    allNodes: readonly StudioCanvasNode[];
    onClose(): void;
    onRename(id: string, title: string): void;
    onSetOpacity(id: string, opacity: number): void;
    onToggleFlip(id: string, axis: 'flipX' | 'flipY'): void;
    onToggleLock(id: string): void;
    onToggleVisibility(id: string, visible: boolean): void;
    onReorder(id: string, direction: 'front' | 'back'): void;
    onDelete(id: string): void;
    /** Node-level retry (agent nodes with generationPrompt). */
    onRetry(id: string): void;
    /** Steer the agent with a new prompt (agent nodes). */
    onSteer(id: string, prompt: string): void;
    /** Cancel the running turn (loading nodes). */
    onCancel(id: string): void;
    /** 更新节点字段（参考图角色/强度/标记）。 */
    onUpdateNode(id: string, updates: Partial<StudioCanvasNode>): void;
    /** 把该节点作为 @ref 引用标记复制到聊天输入框。 */
    onReferenceToChat(node: StudioCanvasNode): void;
    /** CV-020：把节点的图片/视频产物另存到本地（仅 image/video 且带 url）。 */
    onDownload(node: StudioCanvasNode): void;
}
/**
 * The layer detail panel: edit the selected node's title, opacity, flip,
 * lock/visibility, z-order, and run node-level generation actions (retry /
 * steer / cancel). Reference LayerDetailPanel semantics, DSH tokens.
 */
export declare function LayerDetailPanel(props: LayerDetailPanelProps): import("react").JSX.Element;
