import { useEffect, useState } from 'react'

/**
 * CV-044 扩展：图片固定尺寸大图预览浮层（双击图片节点打开）。
 *
 * 与视频播放浮层对称：图片按真实分辨率渲染，上限 960px 宽 / 80% 视口高
 * （CSS 钳制，保持原始宽高比）；点关闭按钮、点浮层外背景、按 Escape 三种
 * 方式关闭。复用 csModalBackdrop/csModal 弹窗样式与 csVideoModalCard 的
 * 尺寸规则。
 *
 * CV-089：标题栏下挂一行元信息条（`${width}×${height} · mime`），让用户
 * 在预览时直接看到原图分辨率。宽高来自 `<img>.naturalWidth/Height`，加载
 * 前为空。
 */
export interface ImagePreviewModalProps {
  title: string
  url: string
  onClose(): void
}

export function ImagePreviewModal(props: ImagePreviewModalProps) {
  const { title, url, onClose } = props
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null)
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
            {/* CV-089：始终渲染 —— 加载前显示「— × —」占位，避免「onLoad 未触
                发 = 这一行压根没渲染」的歧义（源 404 / CORS / metadata 缺失
                都会让 naturalWidth=0；用户看到的应是「加载中」而非「无」）。 */}
            <p className="csModalHeaderMeta">
              <span>{dims !== null ? `${dims.width} × ${dims.height}` : '— × —'}</span>
            </p>
          </div>
          <button type="button" className="csModalClose" aria-label="关闭" onClick={onClose}>×</button>
        </header>
        <div className="csImagePreviewStage">
          <img
            className="csImagePreviewImg"
            src={url}
            alt={title}
            onLoad={event => {
              const img = event.currentTarget
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                setDims({ width: img.naturalWidth, height: img.naturalHeight })
              }
            }}
          />
        </div>
      </div>
    </div>
  )
}
