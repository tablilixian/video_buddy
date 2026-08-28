import { useEffect, useState } from 'react'
import type { StudioCanvasNode } from '../../contracts/canvas.js'
import { KIND_LABEL } from './labels.js'

/** Tool names for the transient (loading) node titles. */
const TOOL_TITLES: Readonly<Record<string, string>> = {
  image_generate: '生成图片中…',
  video_generate: '生成视频中…',
  video_composite: '合成视频中…',
}

/** CV-010：超过该秒数认为「可能卡住」，overlay 追加可打断提示。 */
const LOADING_SLOW_THRESHOLD = 180

/** Resize corners (grid of 9, center omitted). */
const RESIZE_CORNERS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type ResizeCorner = typeof RESIZE_CORNERS[number]

/** Props for a single canvas node box. */
export interface CanvasNodeProps {
  node: StudioCanvasNode
  selected: boolean
  /** Begin a drag (also selects; multi-select via ctrl/cmd). */
  onNodePointerDown(event: React.PointerEvent, node: StudioCanvasNode): void
  /** Begin a resize gesture. */
  onResizePointerDown(event: React.PointerEvent, node: StudioCanvasNode, corner: ResizeCorner): void
  /** Begin a manual connection drag (S6). */
  onLinkPointerDown(event: React.PointerEvent, node: StudioCanvasNode): void
  /** Commit an inline rename. */
  onRenameSubmit(id: string, title: string): void
  /** CV-001：提交文本类节点（sticky/text/prompt）的内联正文编辑。 */
  onTextSubmit(id: string, text: string): void
  /** 双击媒体类节点：打开详情 / 编辑面板（D1 方案 A：文本类双击=内联编辑）。 */
  onOpenDetail(node: StudioCanvasNode): void
  /** Request the context menu at screen coordinates. */
  onContextMenu(node: StudioCanvasNode, clientX: number, clientY: number): void
  /**
   * CV-013/029：媒体加载后上报真实宽高（总是上报；分辨率回填与框比例校正
   * 的决策在 frame 侧统一处理）。加载失败（无真实尺寸）不上报。
   */
  onMediaNatural?(id: string, naturalWidth: number, naturalHeight: number): void
}

/** True when a pointer-down target is an interactive element (no drag). */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.closest('textarea, input, button, select, a, [contenteditable="true"]') !== null
}

/**
 * One canvas node: media box or text annotation, placed at its canvas-space
 * coordinates. The surface owns pan/zoom/drag/resize gestures; this component
 * is presentational and reports pointer-downs with the intended gesture.
 * Visual state follows the reference LayerData semantics: locked (no drag),
 * loading overlay, error badge, opacity, flipX/flipY (media only), hidden
 * nodes are filtered by the surface.
 */
export function CanvasNode(props: CanvasNodeProps) {
  const { node, selected, onNodePointerDown, onResizePointerDown, onLinkPointerDown, onRenameSubmit, onTextSubmit, onOpenDetail, onContextMenu, onMediaNatural } = props
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  // CV-001：文本类节点双击进入内联正文编辑（失焦/Enter 提交，Escape 取消）。
  const [editingBody, setEditingBody] = useState(false)
  const [bodyInput, setBodyInput] = useState('')
  // 媒体加载失败兜底（验收反馈的「黑图」：URL 失效/产物损坏时不再静默黑块）。
  const [mediaFailed, setMediaFailed] = useState(false)
  // CV-010：loading 节点已耗时计时（以节点创建时刻为起点，每秒跳动）。
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (node.isLoading !== true) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [node.isLoading])

  const isMedia = node.kind === 'image' || node.kind === 'video'
  const isGroup = node.kind === 'group'
  const opacity = node.opacity ?? 1
  // CV-010：已耗时 MM:SS（以 createdAt 为起点；间隔 1s 的 now 驱动重渲染）。
  const loadingSeconds = node.isLoading === true ? Math.max(0, Math.floor((now - node.createdAt) / 1000)) : 0
  const loadingLabel = `${String(Math.floor(loadingSeconds / 60)).padStart(2, '0')}:${String(loadingSeconds % 60).padStart(2, '0')}`
  const flipTransform = (node.flipX ? 'scaleX(-1) ' : '') + (node.flipY ? 'scaleY(-1)' : '')

  const handleNodePointerDown = (event: React.PointerEvent): void => {
    if (event.button !== 0 || event.shiftKey) return
    event.stopPropagation()
    if (isInteractiveTarget(event.target)) return
    onNodePointerDown(event, node)
  }

  const handleResizePointerDown = (event: React.PointerEvent, corner: ResizeCorner): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    if (node.locked) return
    onResizePointerDown(event, node, corner)
  }

  const handleLinkPointerDown = (event: React.PointerEvent): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    onLinkPointerDown(event, node)
  }

  const handleDoubleClick = (event: React.MouseEvent): void => {
    event.stopPropagation()
    if (node.locked || editingBody) return
    // D1 方案 A：文本类节点双击=节点内联编辑，媒体/其它节点双击=详情面板。
    if (node.kind === 'sticky' || node.kind === 'text' || node.kind === 'prompt') {
      setBodyInput(node.text ?? node.title ?? '')
      setEditingBody(true)
      return
    }
    onOpenDetail(node)
  }

  const handleRenameSubmit = (): void => {
    setEditingTitle(false)
    if (titleInput.trim().length > 0) onRenameSubmit(node.id, titleInput.trim())
  }

  const handleBodySubmit = (): void => {
    setEditingBody(false)
    if (bodyInput !== (node.text ?? node.title ?? '')) onTextSubmit(node.id, bodyInput)
  }

  const handleBodyKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      // Enter 提交；Shift+Enter 换行（便签多行内容）。
      event.preventDefault()
      handleBodySubmit()
      return
    }
    if (event.key === 'Escape') {
      event.stopPropagation()
      setEditingBody(false)
    }
  }

  const handleContextMenu = (event: React.MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    onContextMenu(node, event.clientX, event.clientY)
  }

  // CV-013/029：媒体真实宽高就绪后上报 frame（总是上报，无论框比例是否
  // 偏差——分辨率回填不依赖裁切问题存在）。
  const handleMediaLoad = (event: React.SyntheticEvent<HTMLImageElement | HTMLVideoElement>): void => {
    if (onMediaNatural === undefined) return
    const element = event.currentTarget
    const naturalWidth = element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth
    const naturalHeight = element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight
    if (naturalWidth > 0 && naturalHeight > 0) onMediaNatural(node.id, naturalWidth, naturalHeight)
  }

  const className = [
    'csNode',
    selected ? 'csNodeSelected' : '',
    node.locked ? 'csNodeLocked' : '',
    node.error !== undefined ? 'csNodeError' : '',
    node.isLoading ? 'csNodeLoading' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={className}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height, opacity }}
      onPointerDown={handleNodePointerDown}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      data-node-id={node.id}
    >
      {isGroup
        ? (
          <div className="csNodeGroup">
            <span className="csNodeKind">{node.title ?? '分组'}</span>
          </div>
        )
        : null}
      {isMedia && node.url !== undefined && !mediaFailed
        ? (
          <div className="csNodeMediaBox" style={flipTransform ? { transform: flipTransform } : undefined}>
            {node.kind === 'image'
              ? (
                <img
                  className="csNodeMedia"
                  src={node.url}
                  alt={node.title ?? 'image'}
                  draggable={false}
                  onLoad={handleMediaLoad}
                  onError={() => { setMediaFailed(true) }}
                />
              )
              : (
                <video
                  className="csNodeMedia"
                  src={node.url}
                  controls
                  preload="metadata"
                  onLoadedMetadata={handleMediaLoad}
                  onError={() => { setMediaFailed(true) }}
                />
              )}
          </div>
        )
        : null}
      {isMedia && mediaFailed && node.isLoading !== true && (
        <div className="csNodeText">
          <span className="csNodeBadge csNodeBadgeError">媒体加载失败：{node.title ?? node.kind}</span>
        </div>
      )}
      {node.kind === 'sticky' || node.kind === 'text' || node.kind === 'prompt'
        ? (
          <div className="csNodeText">
            <span className="csNodeKind">{KIND_LABEL[node.kind]}</span>
            {editingBody
              ? (
                <textarea
                  className="csNodeBodyEdit"
                  value={bodyInput}
                  autoFocus
                  onChange={event => { setBodyInput(event.target.value) }}
                  onBlur={handleBodySubmit}
                  onKeyDown={handleBodyKeyDown}
                />
              )
              : <p className="csNodeBody">{node.text ?? node.title ?? ''}</p>}
          </div>
        )
        : null}
      {selected && <div className="csNodeRing" />}
      {node.isLoading && (
        <div className="csNodeOverlay">
          <span className="csNodeOverlayLabel">
            {TOOL_TITLES[node.toolName ?? ''] ?? '生成中…'} · {loadingLabel}
          </span>
          <span className="csNodeProgress"><span className="csNodeProgressBar" /></span>
          {loadingSeconds >= LOADING_SLOW_THRESHOLD && (
            <span className="csNodeOverlayHint">耗时较久，可在详情面板或右键菜单打断</span>
          )}
        </div>
      )}
      {node.error !== undefined && (
        <span className="csNodeBadge csNodeBadgeError" title={node.error}>生成失败：{node.error}</span>
      )}
      {node.locked && <span className="csNodeBadge csNodeBadgeLock">🔒</span>}
      {editingTitle && (
        <input
          className="csNodeRename"
          value={titleInput}
          autoFocus
          onChange={event => { setTitleInput(event.target.value) }}
          onBlur={handleRenameSubmit}
          onKeyDown={event => {
            if (event.key === 'Enter') handleRenameSubmit()
            if (event.key === 'Escape') setEditingTitle(false)
          }}
        />
      )}
      {!node.locked && isMedia && (
        <>
          {RESIZE_CORNERS.map(corner => (
            <div
              key={corner}
              className={`csNodeResize csNodeResize${corner.toUpperCase()}`}
              onPointerDown={event => { handleResizePointerDown(event, corner) }}
            />
          ))}
          <div
            className="csNodeLinkHandle"
            title="拖到其它节点建立血缘连线"
            onPointerDown={handleLinkPointerDown}
          />
        </>
      )}
    </div>
  )
}