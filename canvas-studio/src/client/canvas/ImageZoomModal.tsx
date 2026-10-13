import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * CV-311：应用内图片缩放浮层（故事板 §02「点开看原图」）。
 *
 * 与 `ImagePreviewModal`（contain 适配、不可缩放）的区别：stage 支撑真正的
 * transform 缩放 / 平移 —— 滚轮以光标为锚缩放、按住拖拽平移、双击在「适配 ↔
 * 100%」之间切换，另有 − / % / + 工具条与键盘 `+` `−` `0`。关闭三出口
 * （Escape / 点遮罩 / ✕）与同族浮层一致。
 *
 * 起因：CV-307 的「点开看原图」走 `<a target="_blank">` → Electron
 * `openExternal` 跳出系统浏览器，而资产路由的 loopback authority 会 403
 * （同 CV-246a 的真机结论）。故事板文档本身刻意零 JS，交互只能由父层
 * `StudioFrame` 在同源 iframe 的 document 上捕获拦截后开这个浮层。
 *
 * 几何：图片以舞台中心为原点定位，`transform: translate(-50%,-50%)
 * translate(ox,oy) scale(s)`；`fit` 模式 s = 适配比例、偏移归零；`custom`
 * 模式 s 为用户缩放（1 = 原始像素），偏移随拖拽/光标锚定缩放更新。
 */
export interface ImageZoomModalProps {
  title: string
  url: string
  onClose(): void
}

/** 绝对缩放钳制（相对自然像素：1 = 100%）。 */
const ZOOM_MIN = 0.05
const ZOOM_MAX = 16
/** 适配时四边留白。 */
const STAGE_PAD = 32

export function ImageZoomModal(props: ImageZoomModalProps) {
  const { title, url, onClose } = props
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const [fit, setFit] = useState(1)
  const [mode, setMode] = useState<'fit' | 'custom'>('fit')
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ pointerId: number; x: number; y: number; ox: number; oy: number } | null>(null)

  const scale = mode === 'fit' ? fit : zoom

  const fitScaleOf = useCallback((stageWidth: number, stageHeight: number, width: number, height: number): number => {
    const w = Math.max(stageWidth - STAGE_PAD, 1) / Math.max(width, 1)
    const h = Math.max(stageHeight - STAGE_PAD, 1) / Math.max(height, 1)
    return Math.min(w, h, 1)
  }, [])

  // 加载完成后立刻按舞台实测算 fit（与 setNatural 同拍提交，避免「先按 100% 闪一帧」）。
  const onLoad = (event: { currentTarget: HTMLImageElement }): void => {
    const img = event.currentTarget
    if (natural !== null || img.naturalWidth <= 0 || img.naturalHeight <= 0) return
    const stage = stageRef.current
    if (stage !== null) setFit(fitScaleOf(stage.clientWidth, stage.clientHeight, img.naturalWidth, img.naturalHeight))
    setNatural({ width: img.naturalWidth, height: img.naturalHeight })
  }

  // 窗口尺寸变化 → 重算适配比例（仅 fit 模式立即生效；custom 模式保留用户缩放）。
  useEffect(() => {
    if (natural === null) return
    const onResize = (): void => {
      const stage = stageRef.current
      if (stage === null) return
      setFit(fitScaleOf(stage.clientWidth, stage.clientHeight, natural.width, natural.height))
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [fitScaleOf, natural])

  /**
   * 缩放到指定比例；给了锚点（光标屏幕坐标）则以该点下的图像内容为不动点
   * 重算偏移 —— 这是「滚轮以光标为中心缩放」的标准做法。
   */
  const applyZoom = useCallback((nextRaw: number, anchor?: { x: number; y: number }): void => {
    const stage = stageRef.current
    if (stage === null) return
    const base = mode === 'fit' ? fit : zoom
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nextRaw))
    setMode('custom')
    setZoom(next)
    if (anchor === undefined) return
    const rect = stage.getBoundingClientRect()
    const cx = anchor.x - rect.left - rect.width / 2
    const cy = anchor.y - rect.top - rect.height / 2
    const px = (cx - offset.x) / base
    const py = (cy - offset.y) / base
    setOffset({ x: cx - px * next, y: cy - py * next })
  }, [fit, mode, offset, zoom])

  // 滚轮缩放：React 的 onWheel 在根上是 passive，preventDefault 不生效，
  // 必须在 stage 上原生挂 non-passive 监听。
  useEffect(() => {
    const stage = stageRef.current
    if (stage === null) return
    const onWheel = (event: WheelEvent): void => {
      if (natural === null || failed) return
      event.preventDefault()
      const base = mode === 'fit' ? fit : zoom
      applyZoom(base * Math.exp(-event.deltaY * 0.0022), { x: event.clientX, y: event.clientY })
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => { stage.removeEventListener('wheel', onWheel) }
  }, [applyZoom, failed, fit, mode, natural, zoom])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (natural === null || failed) return
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        applyZoom((mode === 'fit' ? fit : zoom) * 1.25)
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        applyZoom((mode === 'fit' ? fit : zoom) / 1.25)
      } else if (event.key === '0') {
        setMode('fit')
        setOffset({ x: 0, y: 0 })
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [applyZoom, failed, fit, mode, natural, onClose, zoom])

  return (
    <div className="csModalBackdrop csMediaPreviewBackdrop" role="presentation" onClick={onClose}>
      <div
        className="csModal csVideoModalCard"
        role="dialog"
        aria-modal="true"
        aria-label={`预览 ${title}`}
        onClick={event => { event.stopPropagation() }}
      >
        <header className="csModalHeader">
          <div className="csModalHeaderText">
            <h2>{title}</h2>
            <p className="csModalHeaderMeta">
              <span>
                {failed ? '取不到图' : natural !== null ? `${String(natural.width)} × ${String(natural.height)}` : '— × —'}
              </span>
              {natural !== null && !failed && (
                <>
                  <span className="csModalHeaderMetaSep">·</span>
                  <span>{`${String(Math.round(scale * 100))}%`}</span>
                </>
              )}
            </p>
          </div>
          <button type="button" className="csModalClose" aria-label="关闭" onClick={onClose}>×</button>
        </header>
        <div
          ref={stageRef}
          className={`csImageZoomStage${natural === null || failed ? ' is-idle' : ''}`}
          onPointerDown={event => {
            if (natural === null || failed || event.button !== 0) return
            event.currentTarget.setPointerCapture(event.pointerId)
            if (mode === 'fit') {
              setMode('custom')
              setZoom(fit)
            }
            dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }
          }}
          onPointerMove={event => {
            const drag = dragRef.current
            if (drag === null || drag.pointerId !== event.pointerId) return
            setOffset({ x: drag.ox + (event.clientX - drag.x), y: drag.oy + (event.clientY - drag.y) })
          }}
          onPointerUp={event => {
            const drag = dragRef.current
            if (drag === null || drag.pointerId !== event.pointerId) return
            dragRef.current = null
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
          }}
          onPointerCancel={() => { dragRef.current = null }}
          onDoubleClick={event => {
            event.stopPropagation()
            if (natural === null || failed) return
            if (mode === 'custom') {
              setMode('fit')
              setOffset({ x: 0, y: 0 })
            } else {
              setMode('custom')
              setZoom(1)
              setOffset({ x: 0, y: 0 })
            }
          }}
          onClick={event => { event.stopPropagation() }}
        >
          {failed
            ? (
              <p className="csImageZoomFailed">
                取不到图 —— 产物可能已被删除或路径失效。
                <br />
                <span className="csImageZoomFailedUrl">{url}</span>
              </p>
              )
            : (
              <img
                className={natural === null ? 'csImageZoomImgFit' : 'csImageZoomImg'}
                src={url}
                alt={title}
                draggable={false}
                {...(natural === null
                  ? {}
                  : { style: { transform: `translate(-50%, -50%) translate(${String(offset.x)}px, ${String(offset.y)}px) scale(${String(scale)})` } })}
                onLoad={onLoad}
                onError={() => { setFailed(true) }}
              />
              )}
          {!failed && (
            <div className="csImageZoomBar" onClick={event => { event.stopPropagation() }}>
              <button
                type="button"
                className="csImageZoomBtn"
                aria-label="缩小"
                onClick={() => { applyZoom((mode === 'fit' ? fit : zoom) / 1.25) }}
              >
                −
              </button>
              <span className="csImageZoomScale">{natural !== null ? `${String(Math.round(scale * 100))}%` : '—'}</span>
              <button
                type="button"
                className="csImageZoomBtn"
                aria-label="放大"
                onClick={() => { applyZoom((mode === 'fit' ? fit : zoom) * 1.25) }}
              >
                +
              </button>
              <button
                type="button"
                className="csImageZoomBtn"
                disabled={mode === 'fit'}
                onClick={() => { setMode('fit'); setOffset({ x: 0, y: 0 }) }}
              >
                适配
              </button>
              <button
                type="button"
                className="csImageZoomBtn"
                disabled={mode === 'custom' && zoom === 1 && offset.x === 0 && offset.y === 0}
                onClick={() => { setMode('custom'); setZoom(1); setOffset({ x: 0, y: 0 }) }}
              >
                100%
              </button>
              <span className="csImageZoomHint">滚轮缩放 · 拖拽平移 · 双击适配/原尺寸</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
