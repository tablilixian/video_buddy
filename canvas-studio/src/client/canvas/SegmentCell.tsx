/**
 * REQ-041 · 历程视图的**段产物格**（一行一镜里的「视频」位）。
 *
 * ## 为什么是独立格，而不是分镜卡里的画面
 *
 * 用户口径（2026-11-25 真机纠正）：一行一镜的格序是
 * **文字卡 → 关键帧 → 视频 → 音频（→ 末帧）**。段产物（Remotion 渲出的这一屏）
 * 属于「视频」这一类。上一版把它塞进分镜卡体区，卡片是 380×214、段画面是
 * 960×540，正文一展开就把画面压成一条亮带、文字骑在画面上 —— 这不是样式
 * 能补的，是放错了格子。
 *
 * ## 它不是节点
 *
 * 段产物由清单按 `segmentRef` 派生（§9.7：不写画布、不加持久字段）。所以这里
 * 没有 `StudioCanvasNode`：没有 id 可选中、可拖拽、可右键，也不进 `positions`。
 * 交互只有两条，都与视频卡同语义：
 *   - 悬停 → 静音循环播放（浏览器禁止 hover 触发带声自动播放）；
 *   - 双击 → 播放浮层（清单里那一版，带旁白副本优先）。
 *
 * 结构复用 `.csNode` 的三段式（头 / 媒体 / 脚），所以它与旁边的镜视频卡在同一行
 * 里看着是一类东西，而不是「一个异形块」。
 */
import { memo, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { WaterfallBox } from '../../canvas-waterfall.js'
import { formatMediaDuration } from '../../canvas-aspect.js'
import { HOVER_PREVIEW_DELAY, claimHoverVideo, releaseHoverVideo, prefersReducedMotion } from './hover-video.js'

export interface SegmentCellProps {
  /** 画布空间的格位（布局函数给出，与同行其它格同宽同高口径）。 */
  box: WaterfallBox
  shot: number
  /** 段视频 URL（已带 `?v=`；带旁白副本优先，由清单决定）。 */
  url: string
  /** 双击：打开播放浮层（与视频卡双击同语义）。 */
  onOpen(): void
}

function SegmentCellInner({ box, shot, url, onOpen }: SegmentCellProps): React.ReactElement {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const hoverTimer = useRef<number | null>(null)
  const [durationLabel, setDurationLabel] = useState<string | null>(null)
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null)
  // 失败兜底：段副本可能被清理/覆盖写坏 —— 静默退回一格的提示，不出现破图。
  const [failed, setFailed] = useState(false)

  // URL 变了（重渲换版本）必须重试一次，否则一次 404 会让这一格永远空着。
  useEffect(() => { setFailed(false) }, [url])

  const stop = (): void => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
    const el = videoRef.current
    if (el !== null) {
      if (!el.paused) {
        el.pause()
        el.currentTime = 0
      }
      releaseHoverVideo(el)
    }
  }

  const handleEnter = (): void => {
    if (failed || prefersReducedMotion) return
    if (hoverTimer.current !== null) return
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null
      const el = videoRef.current
      if (el === null) return
      claimHoverVideo(el)
    }, HOVER_PREVIEW_DELAY)
  }

  useEffect(() => () => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current)
    const el = videoRef.current
    if (el !== null) {
      if (!el.paused) el.pause()
      releaseHoverVideo(el)
    }
  }, [])

  // 与 CanvasNode 同口径：`.csNode` 在性能样式里是 content-visibility:auto（视口外
  // 跳过渲染），占位尺寸必须内联写死，否则离屏时框塌成 0。
  const style: CSSProperties = {
    left: box.x,
    top: box.y,
    width: box.width,
    height: box.height,
    containIntrinsicSize: `${box.width}px ${box.height}px`,
  }
  const badge = durationLabel === null ? '分镜段' : `分镜段 · ${durationLabel}`

  return (
    <div
      className="csNode csSegmentCell"
      style={style}
      // 只读格：不参与画布手势（框选 / 平移从它身上起手会打断「看这一屏」）。
      onPointerDown={event => { event.stopPropagation() }}
      onPointerEnter={handleEnter}
      onPointerLeave={stop}
      onDoubleClick={onOpen}
      title="这一屏渲出来的样子（双击播放，带旁白）"
      data-segment-shot={shot}
      data-segment-url={url}
    >
      <div className="csNodeHead">
        <span className="csNodeHeadKind">
          <span className="csNodeHeadKindMark" aria-hidden>▶</span>
          片段
        </span>
        <span className="csNodeHeadTitle">镜 {shot} · 这一屏</span>
      </div>
      <div className="csNodeMediaBox">
        {failed
          ? <span className="csNodeVideoEmptyText">片段不可播（产物缺失或被清理）</span>
          : (
            <video
              ref={videoRef}
              className="csNodeMedia"
              src={url}
              muted
              loop
              playsInline
              preload="metadata"
              onLoadedMetadata={event => {
                const el = event.currentTarget
                setDurationLabel(Number.isFinite(el.duration) && el.duration > 0
                  ? formatMediaDuration(el.duration)
                  : null)
                if (el.videoWidth > 0 && el.videoHeight > 0) {
                  setDims({ width: el.videoWidth, height: el.videoHeight })
                }
              }}
              onError={() => { setFailed(true) }}
            />
          )}
      </div>
      <span className="csNodeVideoBadge">{badge}</span>
      <div className="csNodeFoot">
        <span className="csNodeFootReadings">
          {dims === null ? null : <span className="csNodeMediaDims">{dims.width} × {dims.height}</span>}
        </span>
      </div>
    </div>
  )
}

/** memo：布局重算（同镜其它格变化/清单刷新）不该重挂视频元素（会掉帧、重下字节）。 */
export const SegmentCell = memo(SegmentCellInner)
