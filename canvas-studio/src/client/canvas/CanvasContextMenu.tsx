import { forwardRef } from 'react'
import type { StudioCanvasNode } from '../../contracts/canvas.js'
import { canDownloadNode } from '../../canvas-actions.js'

/** 右键菜单入口开关：只隐藏入口，处理函数与 props 接线全部保留（同 CanvasToolbar.TOOLBAR_VISIBILITY 模式）。 */
const MENU_VISIBILITY = {
  /** 锁定 / 解锁（图层面板提供同名操作）。 */
  lock: false,
  /** 显示 / 隐藏（图层面板提供同名操作）。 */
  visibility: false,
  /** 置顶 / 置底 / 上移一层 / 下移一层（层级调整走图层面板）。 */
  zOrder: false,
} as const

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
  /** CV-020：把节点的图片/视频产物另存到本地（仅 image/video 且带 url）。 */
  onDownload(id: string): void
  /** CV-044 扩展：打开详情 / 编辑面板（媒体类节点双击已改为预览，详情查看走此入口）。 */
  onOpenDetail(id: string): void
}

/**
 * The node context menu: edit/order/state actions plus generation actions.
 * Positioned at the cursor; closes on any action or when a press lands
 * outside the menu (CV-037). The forwarded ref points at the menu root so the
 * owner can tell inside from outside presses.
 */
export const CanvasContextMenu = forwardRef<HTMLDivElement, CanvasContextMenuProps>(function CanvasContextMenu(props, ref) {
  const { node, x, y, onClose, onRename, onCopy, onDelete, onReorder, onToggleLock, onToggleVisibility, onRetry, onSteer, onCancel, onUngroup, onReferenceToChat, onDownload, onOpenDetail } = props
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
      {item('查看详情', () => { onOpenDetail(node.id) })}
      {item('引用到对话', () => { onReferenceToChat(node.id) })}
      {canDownloadNode(node) && item('下载资产', () => { onDownload(node.id) })}
      {MENU_VISIBILITY.lock && item(node.locked ? '解锁' : '锁定', () => { onToggleLock(node.id) })}
      {MENU_VISIBILITY.visibility && item(node.visible === false ? '显示' : '隐藏', () => { onToggleVisibility(node.id) })}
      {MENU_VISIBILITY.zOrder && item('置顶', () => { onReorder(node.id, 'front') })}
      {MENU_VISIBILITY.zOrder && item('置底', () => { onReorder(node.id, 'back') })}
      {MENU_VISIBILITY.zOrder && item('上移一层', () => { onReorder(node.id, 'forward') })}
      {MENU_VISIBILITY.zOrder && item('下移一层', () => { onReorder(node.id, 'backward') })}
      {node.kind === 'group' && item('解组', () => { onUngroup(node.id) })}
      {node.isLoading && item('打断', () => { onCancel(node.id) })}
      {isAgent && hasPrompt && !node.isLoading && item('重试（同参数重新生成）', () => { onRetry(node.id) })}
      {isAgent && !node.isLoading && item('修改提示词', () => { onSteer(node.id) })}
      {item('删除', () => { onDelete(node.id) }, true)}
    </div>
  )
})