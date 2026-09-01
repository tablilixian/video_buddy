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
 * 顶部工具栏分组可见性（2026-08-31）：**功能全部保留，仅控制入口显示**。
 *
 * 当前隐藏：撤销/重做、删除/编组/解组、+便签/+文本/+提示（用户 2026-08-31 指定）。
 * 保留：上传图片/上传视频、缩放；整理布局 / 图层 / 小地图移至最右侧图标组
 * （CV-059，2026-09-01 用户指定）。
 * 设置按钮已移除（CV-059 拍板：设置入口 = app 左下角全局入口）。
 * 需要恢复某一组：把对应项改为 `true` 即可（组件与回调一直在，无死代码）。
 */
const TOOLBAR_VISIBILITY = {
  /** 撤销 / 重做（Ctrl+Z / Ctrl+Shift+Z）。 */
  undoRedo: false,
  /** 删除 / 编组 / 解组（节点右键菜单已提供同名命令）。 */
  editing: false,
  /** 整理布局：一键无重叠排列 + 适配视野（图标在最右组）。 */
  arrange: true,
  /** + 便签 / + 文本 / + 提示（手动素材；主链路产物由 agent 生成）。 */
  create: false,
  /** 上传图片 / 上传视频（P8 素材入口）。 */
  upload: true,
  /** 显示 / 隐藏图层面板（图标在最右组）。 */
  layers: true,
  /** 缩放：百分比 / − / + / 适配内容 / 1:1。 */
  zoom: true,
  /** 显示 / 隐藏小地图（图标在最右组）。 */
  minimap: true,
  /** CV-059：画布设置按钮已移除，设置入口 = app 左下角全局入口。 */
  settings: false,
} as const

/**
 * The canvas toolbar: undo/redo, selection editing (delete/group/ungroup),
 * the one-click arrange, and manual node creation (sticky/text/prompt).
 * Everything is props-driven — the frame wires the store actions.
 * Group visibility is driven by {@link TOOLBAR_VISIBILITY}.
 *
 * CV-059：设置按钮移除（入口 = app 左下角全局设置），`onOpenSettings` 保留在
 * props 上仅作接线预留；右侧图标组 = 整理布局 / 图层 / 小地图。
 */
export function CanvasToolbar(props: CanvasToolbarProps) {
  const { canUndo, canRedo, selectedCount, hasSelection, onUndo, onRedo, onDelete, onGroup, onUngroup, onAutoArrange, onAddNode, onUploadImage, onUploadVideo, layersOpen, onToggleLayers, scale, onZoomOut, onZoomIn, onFitContent, onResetZoom, minimapVisible, onToggleMinimap } = props
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const uploadVideoInputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="csToolbar">
      {TOOLBAR_VISIBILITY.undoRedo && (
      <div className="csToolbarGroup">
        <button type="button" className="csToolbarButton" disabled={!canUndo} title="撤销 (Ctrl+Z)" onClick={onUndo}>↩ 撤销</button>
        <button type="button" className="csToolbarButton" disabled={!canRedo} title="重做 (Ctrl+Shift+Z)" onClick={onRedo}>↪ 重做</button>
      </div>
      )}
      {TOOLBAR_VISIBILITY.editing && (
      <div className="csToolbarGroup">
        <button type="button" className="csToolbarButton" disabled={!hasSelection} onClick={onDelete}>删除</button>
        <button type="button" className="csToolbarButton" disabled={selectedCount < 2} onClick={onGroup}>编组</button>
        <button type="button" className="csToolbarButton" disabled={selectedCount !== 1} onClick={onUngroup}>解组</button>
      </div>
      )}
      {TOOLBAR_VISIBILITY.create && (
      <div className="csToolbarGroup">
        <button type="button" className="csToolbarButton" onClick={() => { onAddNode('sticky') }}>+ 便签</button>
        <button type="button" className="csToolbarButton" onClick={() => { onAddNode('text') }}>+ 文本</button>
        <button type="button" className="csToolbarButton" onClick={() => { onAddNode('prompt') }}>+ 提示</button>
      </div>
      )}      {TOOLBAR_VISIBILITY.upload && (
      <div className="csToolbarGroup">
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
      )}
      {TOOLBAR_VISIBILITY.zoom && (
      <div className="csToolbarGroup">
        <span className="csToolbarZoomValue">{Math.round(scale * 100)}%</span>
        <button type="button" className="csToolbarButton" title="缩小" onClick={onZoomOut}>−</button>
        <button type="button" className="csToolbarButton" title="放大" onClick={onZoomIn}>+</button>
        <button type="button" className="csToolbarButton" title="适配内容" onClick={onFitContent}>⤢</button>
        <button type="button" className="csToolbarButton" title="重置缩放" onClick={onResetZoom}>1:1</button>
      </div>
      )}
      {/* CV-059：最右侧图标组 —— 整理布局 / 图层 / 小地图（原文字按钮图标化，
          原设置按钮位；设置入口移至 app 左下角全局入口，按钮已删）。 */}
      {(TOOLBAR_VISIBILITY.arrange || TOOLBAR_VISIBILITY.layers || TOOLBAR_VISIBILITY.minimap) && (
      <div className="csToolbarGroup csToolbarGroupEnd">
        {TOOLBAR_VISIBILITY.arrange && (
          <button type="button" className="csToolbarButton csToolbarIconButton" title="整理布局：消除重叠并适配视野" aria-label="整理布局" onClick={onAutoArrange}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>
        )}
        {TOOLBAR_VISIBILITY.layers && (
          <button
            type="button"
            className={layersOpen ? 'csToolbarButton csToolbarIconButton csToolbarIconActive' : 'csToolbarButton csToolbarIconButton'}
            title={layersOpen ? '隐藏图层' : '显示图层'}
            aria-label={layersOpen ? '隐藏图层' : '显示图层'}
            aria-pressed={layersOpen}
            onClick={onToggleLayers}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
          </button>
        )}
        {TOOLBAR_VISIBILITY.minimap && (
          <button
            type="button"
            className={minimapVisible ? 'csToolbarButton csToolbarIconButton csToolbarIconActive' : 'csToolbarButton csToolbarIconButton'}
            title={minimapVisible ? '隐藏小地图' : '显示小地图'}
            aria-label={minimapVisible ? '隐藏小地图' : '显示小地图'}
            aria-pressed={minimapVisible}
            onClick={onToggleMinimap}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
              <line x1="8" y1="2" x2="8" y2="18" />
              <line x1="16" y1="6" x2="16" y2="22" />
            </svg>
          </button>
        )}
      </div>
      )}
    </div>
  )
}