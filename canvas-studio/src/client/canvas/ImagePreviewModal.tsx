import { useEffect } from 'react'

/**
 * CV-044 扩展：图片固定尺寸大图预览浮层（双击图片节点打开）。
 *
 * 与视频播放浮层对称：图片按真实分辨率渲染，上限 960px 宽 / 80% 视口高
 * （CSS 钳制，保持原始宽高比）；点关闭按钮、点浮层外背景、按 Escape 三种
 * 方式关闭。复用 csModalBackdrop/csModal 弹窗样式与 csVideoModalCard 的
 * 尺寸规则。
 */
export interface ImagePreviewModalProps {
  title: string
  url: string
  onClose(): void
}

export function ImagePreviewModal(props: ImagePreviewModalProps) {
  const { title, url, onClose } = props
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

  return (
    <div className="csModalBackdrop" role="presentation" onClick={onClose}>
      <div
        className="csModal csVideoModalCard"
        role="dialog"
        aria-modal="true"
        aria-label={`预览 ${title}`}
        onClick={event => { event.stopPropagation() }}
      >
        <header className="csModalHeader">
          <h2>{title}</h2>
          <button type="button" className="csModalClose" aria-label="关闭" onClick={onClose}>×</button>
        </header>
        <div className="csImagePreviewStage">
          <img className="csImagePreviewImg" src={url} alt={title} />
        </div>
      </div>
    </div>
  )
}
