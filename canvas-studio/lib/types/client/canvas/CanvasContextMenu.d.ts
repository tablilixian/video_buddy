import type { StudioCanvasNode } from '../../contracts/canvas.js';
/** Props for the node context menu. */
export interface CanvasContextMenuProps {
    node: StudioCanvasNode;
    x: number;
    y: number;
    onClose(): void;
    onRename(id: string): void;
    onCopy(id: string): void;
    onDelete(id: string): void;
    onReorder(id: string, direction: 'front' | 'back' | 'forward' | 'backward'): void;
    onToggleLock(id: string): void;
    onToggleVisibility(id: string): void;
    onRetry(id: string): void;
    onSteer(id: string): void;
    onCancel(id: string): void;
    onUngroup(id: string): void;
    /** 把该节点作为 @ref 引用标记插入对话输入框光标处（失败回退复制）。 */
    onReferenceToChat(id: string): void;
}
/**
 * The node context menu: edit/order/state actions plus generation actions.
 * Positioned at the cursor; closes on any action or when a press lands
 * outside the menu (CV-037). The forwarded ref points at the menu root so the
 * owner can tell inside from outside presses.
 */
export declare const CanvasContextMenu: import("react").ForwardRefExoticComponent<CanvasContextMenuProps & import("react").RefAttributes<HTMLDivElement>>;
