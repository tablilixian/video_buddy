import { useState } from 'react'
import type { StudioCanvasNode } from '../../contracts/canvas.js'
import { isValidBgmNode } from '../../compose-selection.js'
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
  /** P9.3：调合成路由导出成片（≥1 个有效片段即可：1 个 = 一镜整出，CV-141 解禁）。 */
  onCompose(): void
  /** P9.3：合成进行中（禁用按钮 + 文案）。 */
  composeBusy: boolean
  /** CV-006：实际将参与合成的有效片段数（排除勾选与作废片段已剔除）。 */
  composeClipCount: number
  /** CV-007：预计成片时长（Σ 有效纳入片段真值 duration，秒）。 */
  composeEstSeconds: number
  /** CV-006：BGM 短于预计成片的软提示（不拦，服务端守卫兜底）。 */
  composeWarnings: readonly string[]
  /** CV-006：用户显式排除的片段 id（view.composeExcluded）。 */
  composeExcluded: readonly string[]
  /** CV-006：解析后仍有效的 BGM 节点 id（失效引用已由父级回退 undefined）。 */
  composeBgmNodeId?: string | undefined
  /** CV-006：切换片段纳入/排除态。 */
  onToggleComposeExcluded(id: string): void
  /** CV-006：选定/取消 BGM（undefined = 不使用）。 */
  onComposeBgmChange(nodeId: string | undefined): void
}

/** Short HH:MM:SS label for a node timestamp. */
function timeLabel(createdAt: number): string {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleTimeString()
}

/** CV-007：真值时长角标（ffprobe 实测；无探测值回落创建时间，不造假数据）。 */
function durationOrTime(node: StudioCanvasNode): string {
  const time = timeLabel(node.createdAt)
  return typeof node.duration === 'number' ? `${node.duration.toFixed(2)}s · ${time}` : time
}

/**
 * The review strip: every node of the project as a thumbnail chip. Clicking a
 * chip selects the node and (via the parent) centers it on the surface — this
 * is the "回看" entry point. P9.1: chips are drag-reorderable; the resulting
 * order persists via view.timeline and later feeds compose 的 clipIds。
 *
 * CV-006/007：默认只显媒体（image/video/audio，可切「显示全部」回看便签等）；
 * video chip 带纳入/排除勾选区（作废片段禁用），工具栏提供 BGM 下拉（仅存活
 * 音频节点）与预计成片总时长。
 */
export function CanvasTimeline(props: CanvasTimelineProps) {
  const {
    ordered, selectedNodeId, onSelect, onReorder, onCompose, composeBusy,
    composeClipCount, composeEstSeconds, composeWarnings,
    composeExcluded, composeBgmNodeId, onToggleComposeExcluded, onComposeBgmChange,
  } = props
  // HTML5 DnD 的拖起/悬停下标（组件内瞬态；落点即目标插入位）。
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  // CV-007：媒体过滤开关（默认关 = 只显媒体；打开回看 text/sticky 等非媒体）。
  const [showAll, setShowAll] = useState(false)
  const excludedSet = new Set(composeExcluded)

  // CV-007：时间轴语义——默认只显媒体；显示全部时保持完整顺序不变。
  const displayed = showAll ? ordered : ordered.filter(node =>
    node.kind === 'image' || node.kind === 'video' || node.kind === 'audio')
  // CV-006：BGM 下拉候选 = 存活的音频节点（不列成片节点，少一个歧义源）。
  const bgmCandidates = ordered.filter(isValidBgmNode)

  // CR-069：缩略图加载失败时隐藏自身（URL 失效/产物损坏不显示破碎占位）。
  const hideBrokenMedia = (event: React.SyntheticEvent<HTMLMediaElement | HTMLImageElement>): void => {
    event.currentTarget.style.display = 'none'
  }

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
        <span className="csTimelineCount">视频片段 {composeClipCount}</span>
        {composeEstSeconds > 0
          ? <span className="csTimelineEst" title="Σ 有效纳入片段的真值时长（排除勾选与作废片段已剔除）">预计成片 ≈ {composeEstSeconds.toFixed(2)}s</span>
          : null}
        <label className="csTimelineBgm">
          BGM
          <select
            value={composeBgmNodeId ?? ''}
            onChange={event => { onComposeBgmChange(event.target.value === '' ? undefined : event.target.value) }}
            title="选用画布上的音频节点作为成片 BGM；多镜将只保留 BGM，单镜保留环境声并叠混"
          >
            <option value="">不使用</option>
            {bgmCandidates.map(node => (
              <option key={node.id} value={node.id}>
                {node.title ?? '音频'}{typeof node.duration === 'number' ? ` · ${node.duration.toFixed(2)}s` : ''}
              </option>
            ))}
          </select>
        </label>
        {composeWarnings.map(warning => (
          <span key={warning} className="csTimelineWarn" title="服务端守卫会在合成时给出精确差额">{warning}</span>
        ))}
        <label className="csTimelineToggleAll" title="非媒体节点（便签/文案/提示词等）默认不进时间轴">
          <input type="checkbox" checked={showAll} onChange={event => { setShowAll(event.target.checked) }} />
          显示全部
        </label>
        <button
          type="button"
          className="csPrimary"
          disabled={composeClipCount < 1 || composeBusy}
          title={composeClipCount < 1
            ? '至少 1 个有效片段才能导出成片（排除勾选与作废片段不计入）'
            : '有效片段将按顺序拼接成片；单片段 = 一镜整出（保留环境声），多镜 = 只保留 BGM / 无声'}
          onClick={() => { void onCompose() }}
        >
          {composeBusy ? '合成中…' : '合成导出成片'}
        </button>
      </div>
      <div className="csTimelineStrip">
        {displayed.length === 0
          ? <div className="csTimelineEmpty">时间轴上暂无媒体节点 —— 打开「显示全部」可回看非媒体节点</div>
          : displayed.map((node, index) => {
          const excluded = excludedSet.has(node.id)
          const invalid = node.retired === true || node.supersededBy !== undefined
          const clip = node.kind === 'video'
          const className = [
            'csTimelineItem',
            node.id === selectedNodeId ? 'csTimelineItemActive' : '',
            index === hoverIndex && dragIndex !== null && dragIndex !== index ? 'csTimelineItemTarget' : '',
            excluded ? 'csTimelineItemExcluded' : '',
            invalid ? 'csTimelineItemRetired' : '',
          ].filter(Boolean).join(' ')
          return (
            <div key={node.id} className="csTimelineItemWrap">
              <button
                type="button"
                className={className}
                draggable
                onDragStart={() => { setDragIndex(index) }}
                onDragOver={event => {
                  if (dragIndex === null) return
                  event.preventDefault()
                  // CR-070：dragOver 高频触发——值未变时不重复 setState（避免高亮跳动/多余渲染）。
                  setHoverIndex(prev => (prev === index ? prev : index))
                }}
                onDrop={event => {
                  event.preventDefault()
                  handleDrop(index)
                }}
                onDragEnd={() => { setDragIndex(null); setHoverIndex(null) }}
                onClick={() => { onSelect(node.id) }}
                title={`${node.title ?? KIND_LABEL[node.kind]} · 拖拽排序${invalid ? ' · 已作废，不参与合成' : ''}${excluded ? ' · 已排除出合成' : ''}`}
              >
                <span className="csTimelineThumb">
                  {node.kind === 'image' && node.url
                    // CR-069：缩略图加载失败时隐藏，不显示破碎占位。
                    ? <img src={node.url} alt={node.title ?? 'image'} draggable={false} onError={hideBrokenMedia} />
                    : null}
                  {node.kind === 'video' && node.url
                    ? <video src={node.url} muted preload="metadata" onError={hideBrokenMedia} />
                    : null}
                  {node.kind !== 'image' && node.kind !== 'video'
                    ? <span className="csTimelineKind">{KIND_LABEL[node.kind]}</span>
                    : null}
                </span>
                <span className="csTimelineTime">{durationOrTime(node)}</span>
              </button>
              {clip
                ? (
                  <button
                    type="button"
                    // 勾选区是 chip 的兄弟绝对定位元素（button 嵌 button 非法 DOM），
                    // 点击/按下都不会穿透到选中与拖拽逻辑。
                    className={`csTimelineCheck${excluded ? ' csTimelineCheckOff' : ''}${invalid ? ' csTimelineCheckDisabled' : ''}`}
                    disabled={invalid}
                    title={invalid ? '已作废片段不参与合成（右键画布节点可恢复）' : excluded ? '已排除出合成 —— 点按重新纳入' : '将参与合成 —— 点按排除'}
                    onClick={() => { onToggleComposeExcluded(node.id) }}
                  >
                    {invalid ? '✕' : excluded ? '' : '✓'}
                  </button>
                )
                : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
