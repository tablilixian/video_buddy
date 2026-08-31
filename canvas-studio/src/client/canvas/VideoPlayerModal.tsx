import { useEffect, useRef, useState } from 'react'

/**
 * CV-044：视频固定尺寸播放浮层（双击视频节点打开）。
 *
 * 背景：画布上的 <video> 用 Chromium 原生控件时，「双击=元素全屏」是 shadow
 * DOM 内部 C++ 路径触发，既不经过 JS 的 requestFullscreen，也非可取消默认动作，
 * 无法用 preventDefault / 覆盖 requestFullscreen 拦截（实测均无效）。唯一可靠
 * 手段是去掉原生 controls。这里浮层播放器同样不挂 controls，改为「点击画面
 * 切换播放/暂停」+ 居中状态图标，彻底避免任何全屏发生。
 */
export interface VideoPlayerModalProps {
  title: string
  url: string
  onClose(): void
}

export function VideoPlayerModal(props: VideoPlayerModalProps) {
  const { title, url, onClose } = props
  const [paused, setPaused] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)

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

  // 点击画面切换播放/暂停（无原生控件，这是唯一播放控制）。
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
          />
          {paused && <span className="csVideoPlayIcon" aria-hidden="true">▶</span>}
        </div>
      </div>
    </div>
  )
}
