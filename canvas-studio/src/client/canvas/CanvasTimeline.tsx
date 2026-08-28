import { useState } from 'react'
import type { StudioCanvasNode } from '../../contracts/canvas.js'
import { KIND_LABEL } from './labels.js'

/** Props for the bottom review/timeline strip. */
export interface CanvasTimelineProps {
  /** 已按有效顺序排好的条目（调用方经 deriveTimelineOrder 派生）。 */
  ordered: readonly StudioCanvasNode[]
  selectedNodeId: string | null
  /** Select a node from the strip (also used to jump/center it on the surface). */
  onSelect(id: string): void
  /** P9.1：拖拽重排完成，回调整条的完整 id 顺序（由父级写入 view.timeline）。 */
  onReorder(ids: string[]): void
  /** P9.3：调合成路由导出成片（需 ≥2 个视频片段）。 */
  onCompose(): void
  /** P9.3：合成进行中（禁用按钮 + 文案）。 */
  composeBusy: boolean
}

/** Short HH:MM:SS label for a node timestamp. */
function timeLabel(createdAt: number): string {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleTimeString()
}

/**
 * The review strip: every node of the project as a thumbnail chip. Clicking a
 * chip selects the node and (via the parent) centers it on the surface — this
 * is the "回看" entry point. P9.1: chips are drag-reorderable; the resulting
 * order persists via view.timeline and later feeds compose 的 clipIds。
 */
export function CanvasTimeline(props: CanvasTimelineProps) {
  const { ordered, selectedNodeId, onSelect, onReorder, onCompose, composeBusy } = props
  // HTML5 DnD 的拖起/悬停下标（组件内瞬态；落点即目标插入位）。
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  // P9.3：可参与合成的视频片段数（时间轴里 kind=video 的节点）。
  const clipCount = ordered.filter(node => node.kind === 'video').length

  const handleDrop = (targetIndex: number): void => {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null)
      setHoverIndex(null)
      return
    }
    const ids = ordered.map(node => node.id)
    const [moved] = ids.splice(dragIndex, 1)
    if (moved !== undefined) ids.splice(targetIndex, 0, moved)
    onReorder(ids)
    setDragIndex(null)
    setHoverIndex(null)
  }

  if (ordered.length === 0) {
    return <div className="csTimeline csTimelineEmpty">尚无产物 —— 在右侧对话让 agent 生成后，按时间线回看</div>
  }

  return (
    <div className="csTimeline">
      <div className="csTimelineToolbar">
        <span className="csTimelineCount">视频片段 {clipCount}</span>
        <button
          type="button"
          className="csPrimary"
          disabled={clipCount < 2 || composeBusy}
          title={clipCount < 2 ? '至少排列 2 个视频片段才能导出成片' : '选中的视频片段将按顺序拼接成片'}
          onClick={() => { void onCompose() }}
        >
          {composeBusy ? '合成中…' : '合成导出成片'}
        </button>
      </div>
      <div className="csTimelineStrip">
        {ordered.map((node, index) => {
        const className = [
          'csTimelineItem',
          node.id === selectedNodeId ? 'csTimelineItemActive' : '',
          index === hoverIndex && dragIndex !== null && dragIndex !== index ? 'csTimelineItemTarget' : '',
        ].filter(Boolean).join(' ')
        return (
          <button
            type="button"
            key={node.id}
            className={className}
            draggable
            onDragStart={() => { setDragIndex(index) }}
            onDragOver={event => {
              if (dragIndex === null) return
              event.preventDefault()
              setHoverIndex(index)
            }}
            onDrop={event => {
              event.preventDefault()
              handleDrop(index)
            }}
            onDragEnd={() => { setDragIndex(null); setHoverIndex(null) }}
            onClick={() => { onSelect(node.id) }}
            title={`${node.title ?? KIND_LABEL[node.kind]} · 拖拽排序`}
          >
            <span className="csTimelineThumb">
              {node.kind === 'image' && node.url
                ? <img src={node.url} alt={node.title ?? 'image'} draggable={false} />
                : null}
              {node.kind === 'video' && node.url
                ? <video src={node.url} muted preload="metadata" />
                : null}
              {node.kind !== 'image' && node.kind !== 'video'
                ? <span className="csTimelineKind">{KIND_LABEL[node.kind]}</span>
                : null}
            </span>
            <span className="csTimelineTime">{timeLabel(node.createdAt)}</span>
          </button>
        )
      })}
      </div>
    </div>
  )
}
