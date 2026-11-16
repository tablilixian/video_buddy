/**
 * REQ-040 B：版本堆栈浮层 —— 「vN · k 历史」角标的展开面。
 *
 * 数据 = `computeWaterfallLayout` 的 `stacks`（链尾 id 名下的被折叠历史，新→旧），
 * 节点本体从画布全量节点表回查（被折叠节点不渲染但数据俱在 —— 视图折叠不是
 * 数据删除）。每行：缩略图 + 标题 + 版本号 + 落盘时间 + 状态；「回滚为此版」
 * 走 `onRestoreVersion` = `shot-versions.toggleRetire` 同一写口（恢复旧版 +
 * 接管者自动作废，保证同一镜位只有一份有效 —— 与右键「作废/恢复」同语义，
 * 不新增第二套取代关系写法）。
 *
 * 屏幕空间浮层（挂在 `.csCanvasLayer` 外，不随画布缩放）；backdrop 点击关闭。
 * 零状态：显隐由 CanvasSurface 的 stackNodeId 受控。
 */
import type { ReactElement } from 'react'
import type { StudioCanvasNode } from '../../contracts/canvas.js'
import { KIND_LABEL } from './labels.js'

export interface VersionStackPopoverProps {
  /** 链尾节点（当前生效版本，浮层标题锚点）。 */
  anchor: StudioCanvasNode
  /** 历史版本（新→旧，布局 stacks 产出序）。 */
  versions: readonly StudioCanvasNode[]
  onClose(): void
  /** 回滚为此版（语义 = toggleRetire；缺省则不出回滚按钮）。 */
  onRestore?(id: string): void
}

/** 行内时间格式（落盘时刻，本地时区短格式）。 */
function timeOf(createdAt: number): string {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** 缩略图：图片用本体；视频/音频/文本退化为类型徽标块（历史浮层不追求回放）。 */
function ThumbOf(node: StudioCanvasNode): ReactElement {
  if (node.kind === 'image' && node.url !== undefined) {
    return <img className="csStackThumb" src={node.url} alt="" loading="lazy" />
  }
  return <span className="csStackThumb csStackThumbKind">{KIND_LABEL[node.kind] ?? node.kind}</span>
}

export function VersionStackPopover(props: VersionStackPopoverProps): ReactElement {
  const { anchor, versions, onClose, onRestore } = props
  const anchorVersion = anchor.shotVersion
  return (
    <div className="csStackOverlay" onClick={onClose}>
      <div
        className="csStackPanel"
        role="dialog"
        aria-label={`版本历史 · ${anchor.title ?? anchor.id}`}
        onClick={event => { event.stopPropagation() }}
      >
        <div className="csStackHead">
          <span className="csStackTitle">
            版本历史 · {anchor.title ?? anchor.id}
            {anchorVersion !== undefined ? ` · 当前 v${anchorVersion}` : ''}
          </span>
          <button type="button" className="csStackClose" aria-label="关闭版本历史" onClick={onClose}>✕</button>
        </div>
        <div className="csStackList">
          {versions.map(version => {
            const retired = version.retired === true
            return (
              <div key={version.id} className="csStackRow">
                {ThumbOf(version)}
                <div className="csStackMeta">
                  <span className="csStackMetaTitle">
                    {version.title ?? KIND_LABEL[version.kind] ?? version.kind}
                    {version.shotVersion !== undefined ? ` · v${version.shotVersion}` : ''}
                  </span>
                  <span className="csStackMetaSub">
                    {timeOf(version.createdAt)} · {retired ? '已作废' : '已被新版取代'}
                  </span>
                </div>
                {onRestore !== undefined && (
                  <button
                    type="button"
                    className="csStackRestore"
                    title="回滚为此版：本版恢复生效，当前版本自动作废（同一镜位只有一份有效）"
                    onClick={() => { onRestore(version.id); onClose() }}
                  >
                    回滚为此版
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
