import { forwardRef } from 'react'
import type { StudioCanvasNode } from '../../contracts/canvas.js'
import { canDownloadNode } from '../../canvas-actions.js'
import { clipboardPlanOf } from '../../clipboard-copy.js'
import { isReplayable, promptFieldsOf } from '../../node-params.js'

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
  /**
   * 画布内的「复制」＝就地克隆节点（Ctrl+C 同一动作，走 pasteNodes）。
   *
   * ⚠️ 与 `onCopyToClipboard`（写**系统**剪贴板，粘到微信/文档）是两件事，
   * 不要合并 —— 合并后必有一天用户想「复制一份继续改」时发现微信里多了张图。
   */
  onCopy(id: string): void
  /** CV-198：把节点内容写进**系统**剪贴板（图片节点送 PNG，文字节点送正文）。 */
  onCopyToClipboard(id: string): void
  onDelete(id: string): void
  onReorder(id: string, direction: 'front' | 'back' | 'forward' | 'backward'): void
  onToggleLock(id: string): void
  onToggleVisibility(id: string): void
  onRetry(id: string): void
  /** 打开详情抽屉并编辑提示词（原先的「修改提示词」一次性覆盖已下线）。 */
  onEditPrompt(id: string): void
  onCancel(id: string): void
  onUngroup(id: string): void
  /**
   * CV-177：「整理托盘」——把托盘里的关键帧按阅读顺序重排成网格并让托盘重新
   * 贴合。也是被单独拖出托盘的成员**收回**的唯一入口。
   */
  onTidyGroup(id: string): void
  /** 把该节点作为 @ref 引用标记插入对话输入框光标处（失败回退复制）。 */
  onReferenceToChat(id: string): void
  /** CV-020：把节点的图片/视频产物另存到本地（仅 image/video 且带 url）。 */
  onDownload(id: string): void
  /** CV-044 扩展：打开详情 / 编辑面板（媒体类节点双击已改为预览，详情查看走此入口）。 */
  onOpenDetail(id: string): void
  /** CV-108：作废 / 恢复视频片段——失效片段不参与默认合成（恢复时接管者自动作废）。 */
  onToggleRetire(id: string): void
}

/**
 * The node context menu: edit/order/state actions plus generation actions.
 * Positioned at the cursor; closes on any action or when a press lands
 * outside the menu (CV-037). The forwarded ref points at the menu root so the
 * owner can tell inside from outside presses.
 */
export const CanvasContextMenu = forwardRef<HTMLDivElement, CanvasContextMenuProps>(function CanvasContextMenu(props, ref) {
  const { node, x, y, onClose, onRename, onCopy, onCopyToClipboard, onDelete, onReorder, onToggleLock, onToggleVisibility, onRetry, onEditPrompt, onCancel, onUngroup, onTidyGroup, onReferenceToChat, onDownload, onOpenDetail, onToggleRetire } = props
  // CV-108：失效 = 被新版取代 或 手动作废。
  const retired = node.supersededBy !== undefined || node.retired === true
  const isShot = node.kind === 'video' && node.toolName !== 'compose'
  // CV-159：参考图片也可作废 / 恢复（样张重出后旧图退出参考池）。
  const isRefImage = node.kind === 'image' && node.isReference === true
  // CV-198：能不能复制到**系统**剪贴板由计划决定 —— 视频 / 音频 / 托盘没有可送
  // 剪贴板的载荷，菜单项**不出现**（而不是「点了报错」）。文案也取自计划，
  // 免得菜单与 toast 两边各写一份措辞。
  const clipboardPlan = clipboardPlanOf(node)

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
      {/* CV-198：紧挨着就地克隆的「复制」——标签自带「到剪贴板」说清区别。
          视频 / 音频走「下载资产」（剪贴板塞 mp4 不可预测），所以这里没有它们。 */}
      {clipboardPlan !== null && item(clipboardPlan.label, () => { onCopyToClipboard(node.id) })}
      {item('查看详情', () => { onOpenDetail(node.id) })}
      {item('引用到对话', () => { onReferenceToChat(node.id) })}
      {canDownloadNode(node) && item('下载资产', () => { onDownload(node.id) })}
      {MENU_VISIBILITY.lock && item(node.locked ? '解锁' : '锁定', () => { onToggleLock(node.id) })}
      {MENU_VISIBILITY.visibility && item(node.visible === false ? '显示' : '隐藏', () => { onToggleVisibility(node.id) })}
      {MENU_VISIBILITY.zOrder && item('置顶', () => { onReorder(node.id, 'front') })}
      {MENU_VISIBILITY.zOrder && item('置底', () => { onReorder(node.id, 'back') })}
      {MENU_VISIBILITY.zOrder && item('上移一层', () => { onReorder(node.id, 'forward') })}
      {MENU_VISIBILITY.zOrder && item('下移一层', () => { onReorder(node.id, 'backward') })}
      {/* CV-177：托盘的专属命令。「整理」放在「解组」前面 —— 前者是常用动作
          （抹平手工摆放），后者是拆容器，破坏性更强的一律靠后。 */}
      {node.kind === 'group' && item('整理托盘', () => { onTidyGroup(node.id) })}
      {node.kind === 'group' && item('解组', () => { onUngroup(node.id) })}
      {node.isLoading && item('打断', () => { onCancel(node.id) })}
      {(isShot || isRefImage) && item(
        retired
          ? (isRefImage ? '恢复为参考（新版自动作废）' : '恢复使用（作废取代它的版本）')
          : (isRefImage ? '作废（不再作为参考）' : '作废（不参与成片合成）'),
        () => { onToggleRetire(node.id) },
      )}
      {/* 判据与就近工具条同源（node-params）：**能不能重放**，而不是「有没有
          generationPrompt」。音频 / 四视图 / 抽帧那 8 个节点从前都显示这两个入口，
          点下去落进图片分支 —— 要么报错，要么静默出一张无提示词的图覆盖原节点。 */}
      {isReplayable(node) && !node.isLoading && item('重试（同参数重新生成）', () => { onRetry(node.id) })}
      {promptFieldsOf(node).length > 0 && !node.isLoading && item('修改提示词', () => { onEditPrompt(node.id) })}
      {item('删除', () => { onDelete(node.id) }, true)}
    </div>
  )
})