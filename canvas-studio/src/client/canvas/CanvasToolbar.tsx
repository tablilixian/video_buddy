import { useRef } from 'react'
import type { StudioCanvasNodeKind } from '../../contracts/canvas.js'

/** Manually addable node kinds (media comes from agent generation). */
type ManualNodeKind = Extract<StudioCanvasNodeKind, 'sticky' | 'text' | 'prompt'>

/** Props for the floating canvas toolbar. */
export interface CanvasToolbarProps {
  canUndo: boolean
  canRedo: boolean
  selectedCount: number
  hasSelection: boolean
  onUndo(): void
  onRedo(): void
  onDelete(): void
  onGroup(): void
  onUngroup(): void
  /** One-click overlap-free arrange (the only layout action by design). */
  onAutoArrange(): void
  onAddNode(kind: ManualNodeKind): void
  /** P8.1：打开本地文件选择器上传图片到当前项目（落画布素材节点）。 */
  onUploadImage(file: File): void
  /** P8.4：打开本地文件选择器上传参考视频（Host 抽帧提风格后落画布）。 */
  onUploadVideo(file: File): void
  /** Toggle the layer list overlay inside the canvas. */
  layersOpen: boolean
  onToggleLayers(): void
  /** Current zoom level (percent) shown next to the zoom buttons. */
  scale: number
  onZoomOut(): void
  onZoomIn(): void
  onFitContent(): void
  onResetZoom(): void
  /** Show / hide the minimap overlay. */
  minimapVisible: boolean
  onToggleMinimap(): void
  /** 打开 Canvas Studio 设置弹窗（配置 Drama 基址 / 时长 / Key）。 */
  onOpenSettings(): void
}

/**
 * The canvas toolbar: undo/redo, selection editing (delete/group/ungroup),
 * the one-click arrange, and manual node creation (sticky/text/prompt).
 * Everything is props-driven — the frame wires the store actions.
 */
export function CanvasToolbar(props: CanvasToolbarProps) {
  const { canUndo, canRedo, selectedCount, hasSelection, onUndo, onRedo, onDelete, onGroup, onUngroup, onAutoArrange, onAddNode, onUploadImage, onUploadVideo, layersOpen, onToggleLayers, scale, onZoomOut, onZoomIn, onFitContent, onResetZoom, minimapVisible, onToggleMinimap, onOpenSettings } = props
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const uploadVideoInputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="csToolbar">
      <div className="csToolbarGroup">
        <button type="button" className="csToolbarButton" disabled={!canUndo} title="撤销 (Ctrl+Z)" onClick={onUndo}>↩ 撤销</button>
        <button type="button" className="csToolbarButton" disabled={!canRedo} title="重做 (Ctrl+Shift+Z)" onClick={onRedo}>↪ 重做</button>
      </div>
      <div className="csToolbarGroup">
        <button type="button" className="csToolbarButton" disabled={!hasSelection} onClick={onDelete}>删除</button>
        <button type="button" className="csToolbarButton" disabled={selectedCount < 2} onClick={onGroup}>编组</button>
        <button type="button" className="csToolbarButton" disabled={selectedCount !== 1} onClick={onUngroup}>解组</button>
      </div>
      <div className="csToolbarGroup">
        <button type="button" className="csToolbarButton" title="整理布局：消除重叠并适配视野" onClick={onAutoArrange}>整理布局</button>
      </div>
      <div className="csToolbarGroup">
        <button type="button" className="csToolbarButton" onClick={() => { onAddNode('sticky') }}>+ 便签</button>
        <button type="button" className="csToolbarButton" onClick={() => { onAddNode('text') }}>+ 文本</button>
        <button type="button" className="csToolbarButton" onClick={() => { onAddNode('prompt') }}>+ 提示</button>
        <button type="button" className="csToolbarButton" onClick={() => { uploadInputRef.current?.click() }}>上传图片</button>
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file !== undefined) onUploadImage(file)
            event.target.value = ''
          }}
        />
        <button
          type="button"
          className="csToolbarButton"
          title="上传参考视频：抽帧并归纳风格要素，帧图成为可用参考"
          onClick={() => { uploadVideoInputRef.current?.click() }}
        >
          上传视频
        </button>
        <input
          ref={uploadVideoInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,video/x-matroska,.mp4,.mov,.m4v,.webm,.mkv"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file !== undefined) onUploadVideo(file)
            event.target.value = ''
          }}
        />
      </div>
      <div className="csToolbarGroup">
        <button type="button" className="csToolbarButton" onClick={onToggleLayers}>
          {layersOpen ? '隐藏图层' : '显示图层'}
        </button>
      </div>
      <div className="csToolbarGroup">
        <span className="csToolbarZoomValue">{Math.round(scale * 100)}%</span>
        <button type="button" className="csToolbarButton" title="缩小" onClick={onZoomOut}>−</button>
        <button type="button" className="csToolbarButton" title="放大" onClick={onZoomIn}>+</button>
        <button type="button" className="csToolbarButton" title="适配内容" onClick={onFitContent}>⤢</button>
        <button type="button" className="csToolbarButton" title="重置缩放" onClick={onResetZoom}>1:1</button>
      </div>
      <div className="csToolbarGroup">
        <button type="button" className="csToolbarButton" onClick={onToggleMinimap}>
          {minimapVisible ? '隐藏小地图' : '显示小地图'}
        </button>
      </div>
      <div className="csToolbarGroup csToolbarGroupEnd">
        <button
          type="button"
          className="csToolbarButton csToolbarSettings"
          title="Canvas Studio 设置"
          aria-label="设置"
          onClick={onOpenSettings}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </div>
  )
}