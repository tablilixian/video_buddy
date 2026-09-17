import type { StudioCanvasNode } from '../../contracts/canvas.js';
/** Props for the node context menu. */
export interface CanvasContextMenuProps {
    node: StudioCanvasNode;
    x: number;
    y: number;
    onClose(): void;
    onRename(id: string): void;
    /**
     * 画布内的「复制」＝就地克隆节点（Ctrl+C 同一动作，走 pasteNodes）。
     *
     * ⚠️ 与 `onCopyToClipboard`（写**系统**剪贴板，粘到微信/文档）是两件事，
     * 不要合并 —— 合并后必有一天用户想「复制一份继续改」时发现微信里多了张图。
     */
    onCopy(id: string): void;
    /** CV-198：把节点内容写进**系统**剪贴板（图片节点送 PNG，文字节点送正文）。 */
    onCopyToClipboard(id: string): void;
    onDelete(id: string): void;
    onReorder(id: string, direction: 'front' | 'back' | 'forward' | 'backward'): void;
    onToggleLock(id: string): void;
    onToggleVisibility(id: string): void;
    onRetry(id: string): void;
    /** 打开详情抽屉并编辑提示词（原先的「修改提示词」一次性覆盖已下线）。 */
    onEditPrompt(id: string): void;
    onCancel(id: string): void;
    onUngroup(id: string): void;
    /**
     * CV-177：「整理托盘」——把托盘里的关键帧按阅读顺序重排成网格并让托盘重新
     * 贴合。也是被单独拖出托盘的成员**收回**的唯一入口。
     */
    onTidyGroup(id: string): void;
    /** 把该节点作为 @ref 引用标记插入对话输入框光标处（失败回退复制）。 */
    onReferenceToChat(id: string): void;
    /** CV-020：把节点的图片/视频产物另存到本地（仅 image/video 且带 url）。 */
    onDownload(id: string): void;
    /** CV-044 扩展：打开详情 / 编辑面板（媒体类节点双击已改为预览，详情查看走此入口）。 */
    onOpenDetail(id: string): void;
    /** CV-108：作废 / 恢复视频片段——失效片段不参与默认合成（恢复时接管者自动作废）。 */
    onToggleRetire(id: string): void;
}
/**
 * The node context menu: edit/order/state actions plus generation actions.
 * Positioned at the cursor; closes on any action or when a press lands
 * outside the menu (CV-037). The forwarded ref points at the menu root so the
 * owner can tell inside from outside presses.
 */
export declare const CanvasContextMenu: import("react").ForwardRefExoticComponent<CanvasContextMenuProps & import("react").RefAttributes<HTMLDivElement>>;
