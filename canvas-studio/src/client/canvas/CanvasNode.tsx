import { memo, useEffect, useRef, useState } from 'react'
import type { StudioCanvasNode } from '../../contracts/canvas.js'
import { canRetryNode } from '../../canvas-actions.js'
import { formatMediaDuration } from '../../canvas-aspect.js'
import { KIND_LABEL, REFERENCE_ROLE_SHORT } from './labels.js'

/** Tool names for the transient (loading) node titles. */
const TOOL_TITLES: Readonly<Record<string, string>> = {
  image_generate: '生成图片中…',
  character_generate: '生成角色立绘中…',
  inpaint: '图像修复中…',
  video_generate: '生成视频中…',
  video_composite: '合成视频中…',
}

/** CV-010：超过该秒数认为「可能卡住」，overlay 追加可打断提示。 */
const LOADING_SLOW_THRESHOLD = 180

/** CV-082：hover 预览启动延迟（ms）——快速扫过多个视频时不 play/pause 抖动。 */
const HOVER_PREVIEW_DELAY = 150

/** CR-067：系统减少动效偏好，模块加载时计算一次（会话中极少变化；此前每渲染查 matchMedia）。 */
const prefersReducedMotion = typeof window !== 'undefined'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** CV-082：全画布同一时刻只允许一个 hover 播放的 video 元素（模块级登记）。 */
let activeHoverVideo: HTMLVideoElement | null = null

/**
 * CR-066：全局共享的 1s ticker——所有 loading 节点订阅同一个定时器，避免每个
 * loading 节点各起一个 setInterval + 每秒各重渲染一次（批量生成时 N 个定时器）。
 * 监听器归零时自动停表。
 */
const loadingTicker = (() => {
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setInterval> | null = null
  const stopIfEmpty = (): void => {
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
  return {
    subscribe(fn: () => void): () => void {
      listeners.add(fn)
      if (timer === null) timer = setInterval(() => { for (const l of [...listeners]) l() }, 1000)
      return () => { listeners.delete(fn); stopIfEmpty() }
    },
  }
})()

/** Resize corners (grid of 9, center omitted). */
const RESIZE_CORNERS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type ResizeCorner = typeof RESIZE_CORNERS[number]

/** Props for a single canvas node box. */
export interface CanvasNodeProps {
  node: StudioCanvasNode
  selected: boolean
  /** CV-089：主被拖节点标记 —— 仅在拖动中被按下那个节点为 true；
   * 多选拖拽时区分「主」与「随从」成员，给主节点更明显的视觉。 */
  primary?: boolean
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
  /** CV-044：双击视频节点 —— 打开固定尺寸播放浮层（替代原生双击全屏）。 */
  onOpenPlayback?(node: StudioCanvasNode): void
  /** CV-044 扩展：双击图片节点 —— 打开大图预览浮层（替代打开详情面板）。 */
  onOpenPreview?(node: StudioCanvasNode): void
  /** Request the context menu at screen coordinates. */
  onContextMenu(node: StudioCanvasNode, clientX: number, clientY: number): void
  /** CV-018：失败节点就地重试（重放同参数生成）。 */
  onRetry(id: string): void
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
export function CanvasNodeInner(props: CanvasNodeProps) {
  const { node, selected, primary = false, onNodePointerDown, onResizePointerDown, onLinkPointerDown, onRenameSubmit, onTextSubmit, onOpenDetail, onOpenPlayback, onOpenPreview, onContextMenu, onRetry, onMediaNatural } = props
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  // CV-001：文本类节点双击进入内联正文编辑（失焦/Enter 提交，Escape 取消）。
  const [editingBody, setEditingBody] = useState(false)
  const [bodyInput, setBodyInput] = useState('')
  // 媒体加载失败兜底（验收反馈的「黑图」：URL 失效/产物损坏时不再静默黑块）。
  const [mediaFailed, setMediaFailed] = useState(false)
  // CV-083：视频时长角标（loadedmetadata 现算显示，不落盘——重载后重新
  // 读取 metadata 时长自然恢复，省一条契约字段）。
  const [durationLabel, setDurationLabel] = useState<string | null>(null)
  // CV-089：媒体真实分辨率（视频 = videoWidth/Height，图片 = naturalWidth/Height）。
  // 加载失败（无尺寸）时不显示分辨率角标。
  const [mediaDims, setMediaDims] = useState<{ width: number; height: number } | null>(null)
  // CV-082：hover 自动播放（muted + loop）。videoRef 持有元素；hoverTimer
  // 承载 150ms 启动延迟；卸载/离开时统一 stopHoverPreview 清理。
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const hoverTimer = useRef<number | null>(null)
  // CV-010：loading 节点已耗时计时（以节点创建时刻为起点，每秒跳动）。
  // CR-066：订阅全局共享 ticker，不再每节点各起一个 setInterval。
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (node.isLoading !== true) return
    setNow(Date.now())
    return loadingTicker.subscribe(() => { setNow(Date.now()) })
  }, [node.isLoading])

  // CV-082：可 hover 预览的判定（loading/失败/错误节点不播；系统偏好减少
  // 动效时不自动播——这是展示增强，不是功能必需）。
  const canHoverPreview = node.kind === 'video' && node.url !== undefined && !mediaFailed
    && node.isLoading !== true && node.error === undefined

  const stopHoverPreview = (): void => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
    const el = videoRef.current
    if (el !== null && !el.paused) {
      el.pause()
      el.currentTime = 0
    }
    if (el !== null && activeHoverVideo === el) activeHoverVideo = null
  }

  const handleVideoEnter = (): void => {
    if (!canHoverPreview || prefersReducedMotion) return
    if (hoverTimer.current !== null) return
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null
      const el = videoRef.current
      if (el === null) return
      // 单实例约束：上一个 hover 播放的元素先停。
      if (activeHoverVideo !== null && activeHoverVideo !== el) {
        activeHoverVideo.pause()
        activeHoverVideo.currentTime = 0
      }
      activeHoverVideo = el
      el.muted = true
      el.loop = true
      el.play().catch(() => { /* muted 自动播放被拒绝时静默（保持缩略图） */ })
    }, HOVER_PREVIEW_DELAY)
  }

  // 卸载时清理（节点删除/隐藏时若正在播放必须停掉，否则声音/解码泄漏）。
  useEffect(() => { return () => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current)
    const el = videoRef.current
    if (el !== null && !el.paused) el.pause()
    if (el !== null && activeHoverVideo === el) activeHoverVideo = null
  } }, [])

  // CR-068：canHoverPreview 翻假（媒体加载失败/节点报错/进入 loading）时取消
  // 已排的 hover 播放 timer——否则到点仍会对已失败的媒体意外 play。
  useEffect(() => {
    if (!canHoverPreview) stopHoverPreview()
  }, [canHoverPreview])

  const isMedia = node.kind === 'image' || node.kind === 'video'
  const isGroup = node.kind === 'group'
  const opacity = node.opacity ?? 1
  // CV-010：已耗时 MM:SS（以 createdAt 为起点；间隔 1s 的 now 驱动重渲染）。
  const loadingSeconds = node.isLoading === true ? Math.max(0, Math.floor((now - node.createdAt) / 1000)) : 0
  const loadingLabel = `${String(Math.floor(loadingSeconds / 60)).padStart(2, '0')}:${String(loadingSeconds % 60).padStart(2, '0')}`
  const flipTransform = (node.flipX ? 'scaleX(-1) ' : '') + (node.flipY ? 'scaleY(-1)' : '')

  // CV-044：画布内视频不挂原生 controls（缩略预览，真正的播放走双击浮层），
  // 因此也不存在原生「双击=桌面全屏」的 shadow DOM 内部 handler——双击正常
  // 冒泡到根 div 的 onDoubleClick，由 handleDoubleClick 打开播放浮层。
  // （此前试图在 capture 阶段拦截 / 覆盖 requestFullscreen 均无效：原生控件的
  // 双击全屏走 C++ 内部路径，不经过 JS 的 requestFullscreen，也非可取消默认动作。）

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
    // D1 方案 A：文本类节点双击=节点内联编辑；视频双击=固定尺寸播放浮层
    // （CV-044，替代原生「双击=桌面全屏」）；图片双击=大图预览浮层（CV-044
    // 扩展，详情查看改由右键菜单入口）；其余节点双击=详情面板。
    if (node.kind === 'sticky' || node.kind === 'text' || node.kind === 'prompt') {
      setBodyInput(node.text ?? node.title ?? '')
      setEditingBody(true)
      return
    }
    if (node.kind === 'video' && node.url !== undefined && onOpenPlayback !== undefined) {
      onOpenPlayback(node)
      return
    }
    if (node.kind === 'image' && node.url !== undefined && onOpenPreview !== undefined) {
      onOpenPreview(node)
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
  // 偏差——分辨率回填不依赖裁切问题存在）。CV-089：同时回填本地 mediaDims
  // 用于节点右下角分辨率角标。
  const handleMediaLoad = (event: React.SyntheticEvent<HTMLImageElement | HTMLVideoElement>): void => {
    const element = event.currentTarget
    const naturalWidth = element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth
    const naturalHeight = element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight
    if (naturalWidth <= 0 || naturalHeight <= 0) return
    setMediaDims({ width: naturalWidth, height: naturalHeight })
    if (onMediaNatural !== undefined) onMediaNatural(node.id, naturalWidth, naturalHeight)
  }

  // CV-083：视频 metadata 就绪 → 分辨率上报 + 时长角标现算。
  const handleVideoMetadata = (event: React.SyntheticEvent<HTMLVideoElement>): void => {
    setDurationLabel(formatMediaDuration(event.currentTarget.duration))
    handleMediaLoad(event)
  }

  const className = [
    'csNode',
    selected ? 'csNodeSelected' : '',
    selected && primary ? 'csNodePrimary' : '',
    node.locked ? 'csNodeLocked' : '',
    node.error !== undefined ? 'csNodeError' : '',
    node.isLoading ? 'csNodeLoading' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={className}
      // CR-081：节点位移走 transform（合成层），不用 left/top 逐帧改布局——
      // 拖拽/微调是每帧高频路径，translate3d 让浏览器走合成而不触发布局重绘。
      style={{ left: 0, top: 0, transform: `translate3d(${node.x}px, ${node.y}px, 0)`, width: node.width, height: node.height, opacity }}
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
          <div
            className="csNodeMediaBox"
            style={flipTransform ? { transform: flipTransform } : undefined}
            onPointerEnter={handleVideoEnter}
            onPointerLeave={stopHoverPreview}
          >
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
                  ref={videoRef}
                  className="csNodeMedia"
                  src={node.url}
                  preload="metadata"
                  onLoadedMetadata={handleVideoMetadata}
                  onError={() => { setMediaFailed(true) }}
                />
              )}
            {/* CV-083：时长角标（m:ss，metadata 就绪后显示）。 */}
            {node.kind === 'video' && durationLabel !== null && (
              <span className="csNodeDuration">{durationLabel}</span>
            )}
            {/* CV-089：分辨率角标（图片也用相同角标；视频已有时长在左下，分辨率放右下不撞）。 */}
            {mediaDims !== null && (
              <span className="csNodeMediaDims">{mediaDims.width} × {mediaDims.height}</span>
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
      {/* CV-089：删 csNodeRing 死元素（空样式，不提供任何视觉）。 */}
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
      {/* CV-018：失败徽章兼作就地重试按钮 —— 条件与 client 侧重放前置检查
          一致（canRetryNode），所以可点的必然真能重放，不会出现点了才提示
          「没有可重放参数」。不可重放的失败（如上传失败）仍是不可点徽章。 */}
      {node.error !== undefined && (canRetryNode(node)
        ? (
          <button
            type="button"
            className="csNodeBadge csNodeBadgeError csNodeBadgeRetry"
            title={`${node.error}\n点击重试（同参数重新生成）`}
            onClick={() => { onRetry(node.id) }}
          >
            生成失败 · 点击重试
          </button>
        )
        : <span className="csNodeBadge csNodeBadgeError" title={node.error}>生成失败：{node.error}</span>)}
      {/* CV-011：参考图角色角标（带色点），不用切托盘/详情就能认出参考节点。 */}
      {node.isReference === true && (
        <span className="csNodeRefBadge" data-role={node.referenceRole ?? 'image'} title={`参考图 · ${REFERENCE_ROLE_SHORT[node.referenceRole ?? 'image']}`}>
          <span className="csNodeRefDot" />
          参考 · {REFERENCE_ROLE_SHORT[node.referenceRole ?? 'image']}
        </span>
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

// CR-063：memo 化——store 的 moveNode 只对「被移动节点及其子节点」产生新对象
// 引用（未变节点引用稳定），因此拖拽时未移动的节点不再重渲染。
export const CanvasNode = memo(CanvasNodeInner)