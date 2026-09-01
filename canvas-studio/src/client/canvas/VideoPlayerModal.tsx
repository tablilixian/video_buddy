import { useEffect, useRef, useState } from 'react'

/**
 * CV-044：视频固定尺寸播放浮层（双击视频节点打开）。
 *
 * 背景：画布上的 <video> 用 Chromium 原生控件时，「双击=元素全屏」是 shadow
 * DOM 内部 C++ 路径触发，既不经过 JS 的 requestFullscreen，也非可取消默认动作，
 * 无法用 preventDefault / 覆盖 requestFullscreen 拦截（实测均无效）。唯一可靠
 * 手段是去掉原生 controls。这里浮层播放器同样不挂 controls。
 *
 * CV-057：补自绘迷你控制条 —— 可拖进度 + 时间 + 播放/暂停 + 音量（含静音）。
 * 仍不触碰任何原生全屏路径；点击画面区域保留「切换播放/暂停」。
 */
export interface VideoPlayerModalProps {
  title: string
  url: string
  onClose(): void
}

/** 秒 → mm:ss（超一小时罕见，兜底 h:mm:ss）。 */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function VideoPlayerModal(props: VideoPlayerModalProps) {
  const { title, url, onClose } = props
  const [paused, setPaused] = useState(false)
  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const progressRef = useRef<HTMLDivElement | null>(null)
  // 拖动进度期间不让 timeupdate 覆盖手势位置（seek 语义）。
  const seekingRef = useRef(false)

  // Escape 关闭（capture + stopPropagation：先于画布的 Escape 清选中执行）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [onClose])

  // 点击画面切换播放/暂停。
  const handleTogglePlay = (): void => {
    const el = videoRef.current
    if (el === null) return
    if (el.paused) {
      void el.play()
      setPaused(false)
    } else {
      el.pause()
      setPaused(true)
    }
  }

  // CV-057：按指针横坐标 seek（进度条 pointer capture，拖出条外仍跟踪）。
  const seekToClientX = (clientX: number): void => {
    const el = videoRef.current
    const bar = progressRef.current
    if (el === null || bar === null || duration <= 0) return
    const rect = bar.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    el.currentTime = ratio * duration
    setCurrent(el.currentTime)
  }

  const handleVolumeChange = (next: number): void => {
    const el = videoRef.current
    if (el === null) return
    el.volume = next
    setVolume(next)
    if (next > 0 && el.muted) {
      el.muted = false
      setMuted(false)
    }
  }

  const handleToggleMute = (): void => {
    const el = videoRef.current
    if (el === null) return
    el.muted = !el.muted
    setMuted(el.muted)
  }

  const progressRatio = duration > 0 ? Math.min(1, Math.max(0, current / duration)) : 0

  return (
    <div className="csModalBackdrop" role="presentation" onClick={onClose}>
      <div
        className="csModal csVideoModalCard"
        role="dialog"
        aria-modal="true"
        aria-label={`播放 ${title}`}
        onClick={event => { event.stopPropagation() }}
      >
        <header className="csModalHeader">
          <h2>{title}</h2>
          <button type="button" className="csModalClose" aria-label="关闭" onClick={onClose}>×</button>
        </header>
        <div className="csVideoStage" onClick={handleTogglePlay}>
          {/* 尺寸规则：视频按真实分辨率渲染，max-width/max-height CSS 钳制
              （960px / 80vh 减去标题栏），宽高比由浏览器按内在尺寸保持。 */}
          <video
            ref={videoRef}
            className="csVideoModalVideo"
            src={url}
            autoPlay
            onPlay={() => { setPaused(false) }}
            onPause={() => { setPaused(true) }}
            onLoadedMetadata={() => {
              const el = videoRef.current
              if (el !== null) setDuration(el.duration)
            }}
            onTimeUpdate={() => {
              const el = videoRef.current
              if (el !== null && !seekingRef.current) setCurrent(el.currentTime)
            }}
          />
          {paused && <span className="csVideoPlayIcon" aria-hidden="true">▶</span>}
        </div>
        {/* CV-057：自绘控制条（无原生控件，规避 CV-044 双击全屏路径）。 */}
        <div className="csVideoControls">
          <button
            type="button"
            className="csVideoControlButton"
            aria-label={paused ? '播放' : '暂停'}
            title={paused ? '播放' : '暂停'}
            onClick={handleTogglePlay}
          >
            {paused
              ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
                    <polygon points="6 3 21 12 6 21 6 3" />
                  </svg>
                )
              : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
                    <rect x="5" y="3" width="5" height="18" rx="1" />
                    <rect x="14" y="3" width="5" height="18" rx="1" />
                  </svg>
                )}
          </button>
          <span className="csVideoTime">{formatTime(current)}</span>
          <div
            ref={progressRef}
            className="csVideoProgress"
            role="slider"
            aria-label="播放进度"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(current)}
            onPointerDown={event => {
              seekingRef.current = true
              event.currentTarget.setPointerCapture(event.pointerId)
              seekToClientX(event.clientX)
            }}
            onPointerMove={event => {
              if (seekingRef.current) seekToClientX(event.clientX)
            }}
            onPointerUp={event => {
              seekingRef.current = false
              event.currentTarget.releasePointerCapture(event.pointerId)
            }}
          >
            <div className="csVideoProgressFill" style={{ width: `${progressRatio * 100}%` }} />
          </div>
          <span className="csVideoTime">{formatTime(duration)}</span>
          <button
            type="button"
            className="csVideoControlButton"
            aria-label={muted ? '取消静音' : '静音'}
            title={muted ? '取消静音' : '静音'}
            onClick={handleToggleMute}
          >
            {muted || volume === 0
              ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                )
              : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </svg>
                )}
          </button>
          <input
            className="csVideoVolume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            aria-label="音量"
            onChange={event => { handleVolumeChange(Number(event.target.value)) }}
          />
        </div>
      </div>
    </div>
  )
}
