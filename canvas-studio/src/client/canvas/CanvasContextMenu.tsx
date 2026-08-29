import { forwardRef } from 'react'
import type { StudioCanvasNode } from '../../contracts/canvas.js'

/** Props for the node context menu. */
export interface CanvasContextMenuProps {
  node: StudioCanvasNode
  x: number
  y: number
  onClose(): void
  onRename(id: string): void
  onCopy(id: string): void
  onDelete(id: string): void
  onReorder(id: string, direction: 'front' | 'back' | 'forward' | 'backward'): void
  onToggleLock(id: string): void
  onToggleVisibility(id: string): void
  onRetry(id: string): void
  onSteer(id: string): void
  onCancel(id: string): void
  onUngroup(id: string): void
  /** 把该节点作为 @ref 引用标记插入对话输入框光标处（失败回退复制）。 */
  onReferenceToChat(id: string): void
}

/**
 * The node context menu: edit/order/state actions plus generation actions.
 * Positioned at the cursor; closes on any action or when a press lands
 * outside the menu (CV-037). The forwarded ref points at the menu root so the
 * owner can tell inside from outside presses.
 */
export const CanvasContextMenu = forwardRef<HTMLDivElement, CanvasContextMenuProps>(function CanvasContextMenu(props, ref) {
  const { node, x, y, onClose, onRename, onCopy, onDelete, onReorder, onToggleLock, onToggleVisibility, onRetry, onSteer, onCancel, onUngroup, onReferenceToChat } = props
  const isAgent = node.origin === 'agent' && node.toolName !== undefined
  const hasPrompt = node.generationPrompt !== undefined

  const item = (label: string, action: (() => void) | null, danger = false): React.ReactNode => (
    <button
      key={label}
      type="button"
      className={`csMenuAction${danger ? ' csMenuActionDanger' : ''}`}
      disabled={action === null}
      onClick={() => {
        onClose()
        if (action !== null) action()
      }}
    >
      {label}
    </button>
  )

  return (
    <div ref={ref} className="csContextMenu" style={{ left: x, top: y }} onContextMenu={event => { event.preventDefault(); event.stopPropagation() }}>
      {item('重命名', () => { onRename(node.id) })}
      {item('复制', () => { onCopy(node.id) })}
      {item('引用到对话', () => { onReferenceToChat(node.id) })}
      {item(node.locked ? '解锁' : '锁定', () => { onToggleLock(node.id) })}
      {item(node.visible === false ? '显示' : '隐藏', () => { onToggleVisibility(node.id) })}
      {item('置顶', () => { onReorder(node.id, 'front') })}
      {item('置底', () => { onReorder(node.id, 'back') })}
      {item('上移一层', () => { onReorder(node.id, 'forward') })}
      {item('下移一层', () => { onReorder(node.id, 'backward') })}
      {node.kind === 'group' && item('解组', () => { onUngroup(node.id) })}
      {node.isLoading && item('打断', () => { onCancel(node.id) })}
      {isAgent && hasPrompt && !node.isLoading && item('重试（同参数重新生成）', () => { onRetry(node.id) })}
      {isAgent && !node.isLoading && item('修改提示词', () => { onSteer(node.id) })}
      {item('删除', () => { onDelete(node.id) }, true)}
    </div>
  )
})