import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { StudioCanvasNode, StudioCanvasView } from '../../contracts/canvas.js'
import { computeFitView, MAX_VIEW_SCALE, MIN_VIEW_SCALE, revealOffsetOf, singleMemberGroupOf, type FitResult } from '../../canvas-view.js'
import { buildEdgePath, sourceAnchor } from '../../canvas-geometry.js'
import { computeNudge } from '../../canvas-actions.js'
import { calculateSnap, clamp, contentBounds, screenToWorld } from './canvas-math.js'
import { CanvasEdges } from './CanvasEdges.js'
import { CanvasNode, type ResizeCorner } from './CanvasNode.js'
import { Minimap } from './Minimap.js'
import { compareNodes } from '../project-store.js'
import { canvasSpotlight, type CanvasSpotlight, type CanvasSpotlightTier } from '../../canvas-lineage.js'

const ZOOM_STEP = 1.2
const MIN_NODE_SIZE = 50

/** CV-071：拖拽启动阈值（屏幕像素）。未越过即视为点击，不移动/不捕获/不入 undo。 */
const DRAG_THRESHOLD = 3

/** CV-017：方向键 → 画布坐标增量（×步长 1 或 10）。 */
const NUDGE_DELTAS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
}

/** A drag/resize/link gesture in progress (`none` = no button held). */
interface Gesture {
  mode: 'none' | 'pan' | 'node' | 'resize' | 'link'
  startX: number
  startY: number
  nodeId?: string
  originX?: number
  originY?: number
  originWidth?: number
  originHeight?: number
  corner?: ResizeCorner
  sourceId?: string
  fromWorldX?: number
  fromWorldY?: number
  /** CV-008：多选拖拽的各节点起始位置（含被拖节点；已过滤组内成员防双重位移）。 */
  origins?: ReadonlyArray<{ id: string; x: number; y: number }>
  /**
   * CV-177：单成员托盘的代理拖动。托盘里只有一张时，它四周的可抓环在缩放后
   * 只剩几像素，用户实际只能按住成员图片 —— 而 store.moveNode 的跟随规则只有
   * 一条（parentId === id），拖成员只动成员自己。记下托盘 id 与起始坐标，
   * 拖成员时改移动托盘本体，成员随之跟随：两者位移完全等价。
   * 多成员托盘不走代理（成员可单独拖走，靠「整理托盘」收回）。
   */
  moveProxyId?: string
  proxyOriginX?: number
  proxyOriginY?: number
  /** 点中多选区成员（无修饰键）时的「点击塌缩」待办：松手时若没真正拖动，
   * 选区塌缩为单选该节点（Figma 语义）。拖动了 = 保持整队选中，随动节点
   * 全程发光，多选拖拽在画面上有解释。 */
  collapseOnClick?: boolean
  /** CR-060：本次手势捕获的 pointerId（Pointer Capture，保证拖出容器仍收到 move/up）。 */
  pointerId?: number
  /** CV-071：是否已真正 setPointerCapture（延迟捕获，见 armPointer/ensureCaptured）。 */
  captured?: boolean
  /** CR-061：节点/缩放手势是否已真正产生位移（首帧 move 时置位）。单击（无位移）
   * 不推 undo 历史也不持久化，避免「点一下就是一条空快照 + 一次写盘」。 */
  editBegun?: boolean
}

/** Props for the pannable / zoomable canvas surface. */
export interface CanvasSurfaceProps {
  nodes: readonly StudioCanvasNode[]
  /**
   * C2：镜号表（节点 id → 成片第几段，1 起），由 StudioFrame 按 `isShotClip` +
   * `deriveTimelineOrder` 派生后注入 —— 与底部时间轴同源。缺省 = 不显示镜号
   * chip（宿主测试与既有调用方无需提供）。
   */
  shotIndexOf?: ReadonlyMap<string, number>
  /** Controlled viewport + panel state (persisted per project in the store). */
  view: StudioCanvasView
  /** Merge a viewport patch into the store (the caller owns persistence). */
  onViewChange(patch: Partial<StudioCanvasView>): void
  selectedNodeId: string | null
  selectedNodeIds: readonly string[]
  /** Select a node (or null to clear); `multi` toggles in the multi-select roster. */
  onSelectNode(id: string | null, multi?: boolean): void
  /** Select all nodes of the project. */
  onSelectAllNodes(): void
  /** Live node move during drag (canvas-space coordinates). */
  onMoveNode(id: string, x: number, y: number): void
  /** Live node field update (resize). */
  onUpdateNode(id: string, updates: Partial<StudioCanvasNode>): void
  /** Snapshot history before a mutation gesture (drag/resize start). */
  onBeginEdit(): void
  /** Persist after a drag / resize / link / rename ends. */
  onPersist(): void
  /** Remove nodes (keyboard / context menu). */
  onRemoveNodes(ids: string[]): void
  onCopy(): void
  onPaste(): void
  onUndo(): void
  onRedo(): void
  /** Manual bloodline: target node gains the source ids. */
  onLinkLayers(sourceIds: string[], targetId: string): void
  /** Inline rename commit. */
  onRename(id: string, title: string): void
  /** CV-001：文本类节点内联正文编辑提交。 */
  onNodeTextSubmit(id: string, text: string): void
  /** 双击节点：打开详情 / 编辑面板。 */
  onNodeOpenDetail(node: StudioCanvasNode): void
  /** CV-044：双击视频节点 —— 打开固定尺寸播放浮层（透传给 CanvasNode）。 */
  onNodeOpenPlayback?(node: StudioCanvasNode): void
  /** CV-044 扩展：双击图片节点 —— 打开大图预览浮层（透传给 CanvasNode）。 */
  onNodeOpenPreview?(node: StudioCanvasNode): void
  /** Context menu request (rendered by the frame). */
  onContextMenu(node: StudioCanvasNode, clientX: number, clientY: number): void
  /** CV-016：右键画布空白处（节点自身会拦截冒泡，这里只收空白）。 */
  onBlankContextMenu(clientX: number, clientY: number, worldX: number, worldY: number): void
  /** CV-018：失败节点就地重试（错误徽章兼作按钮，透传给 CanvasNode）。 */
  onRetry(id: string): void
  /** CV-013/029：媒体加载后上报真实宽高（透传给 CanvasNode）。 */
  onMediaNatural?(id: string, naturalWidth: number, naturalHeight: number): void
  /** When set, center this node in the viewport (timeline / review jump). */
  focusNodeId?: string | null
  /** Whether the minimap overlay is shown (toggle lives in the toolbar). */
  minimapVisible?: boolean
  /**
   * CV-185：适配视野被可读下限挡住时回调（内容多于视口能容纳的量）。
   * 由 frame 决定怎么提示 —— 画布这一层不认识 toast。
   */
  onFitClamped?(result: FitResult): void
}

/**
 * CV-186：把聚光结果翻成单个节点的档位（亮档 = undefined，不挂类）。
 *
 * 只是**投影**，不含判定 —— 距离、档位边界、两道安全阀全在
 * `src/canvas-lineage.ts`（唯一实现），这里绝不能出现第二份 distance 计算。
 */
function spotlightTierOf(spotlight: CanvasSpotlight, nodeId: string): CanvasSpotlightTier | undefined {
  if (!spotlight.active) return undefined
  if (spotlight.dim.has(nodeId)) return 'dim'
  if (spotlight.near.has(nodeId)) return 'near'
  return undefined
}

/** Imperative zoom controls exposed to the frame toolbar. */
export interface CanvasSurfaceHandle {
  zoomBy(factor: number): void
  /**
   * CV-185：适配视野。返回 `null` = 画布上没有内容；返回 `clamped: true` =
   * 内容太多、比例已被可读下限（FIT_MIN_SCALE）挡住，视野外还有东西。
   */
  fitToContent(): FitResult | null
  /** CV-019：缩放到选中节点（无选中时等价 fitToContent）。 */
  zoomToSelection(): void
  resetZoom(): void
  /** CV-184：把指定节点带进视野（只平移不改缩放；手势进行中不抢镜头）。 */
  revealNodes(ids: readonly string[]): void
  /** CV-185：画布可视区尺寸 —— 整理布局用它决定「排成什么形状」。 */
  viewportSize(): { width: number; height: number } | null
}

/**
 * The infinite canvas: a grid background that pans/zooms with content, node
 * boxes placed at their canvas-space coordinates, the bloodline edge overlay,
 * snap alignment guides, a minimap, and corner zoom controls.
 *
 * The viewport (`offset`/`scale`) is controlled: it lives in the project store
 * so it survives restarts (canvas.json v3) and project switches. Interactions:
 * a blank press clears the selection immediately (Ctrl/Cmd excepted) and
 * left-drag (or middle button) pans, wheel without modifiers pans, Ctrl/Cmd+wheel
 * zooms around the cursor, node pointer-down begins a node drag (snap
 * alignment + guides), Ctrl/Cmd+pointer-down on a node toggles its membership in
 * the multi-select roster (no drag), the node's resize handles begin a resize,
 * and the link handle begins a manual connection drag. Keyboard: Delete removes
 * the selection, Ctrl/Cmd+C/V copy/paste, Ctrl/Cmd+Z / Ctrl+Shift+Z / Ctrl+Y
 * undo/redo, Ctrl/Cmd+A selects all, Escape clears the selection. Marquee
 * box-selection has been removed — type-based selection lives in the layer
 * panel header.
 */
export const CanvasSurface = forwardRef<CanvasSurfaceHandle, CanvasSurfaceProps>(function CanvasSurface(props, ref) {
  const {
    nodes,
    view,
    onViewChange,
    selectedNodeIds,
    onSelectNode,
    onSelectAllNodes,
    onMoveNode,
    onUpdateNode,
    onBeginEdit,
    onPersist,
    onRemoveNodes,
    onCopy,
    onPaste,
    onUndo,
    onRedo,
    onLinkLayers,
    onRename,
    onNodeTextSubmit,
    onNodeOpenDetail,
    onNodeOpenPlayback,
    onNodeOpenPreview,
    onContextMenu,
    onBlankContextMenu,
    onRetry,
    onMediaNatural,
    focusNodeId,
    minimapVisible = true,
    shotIndexOf,
    onFitClamped,
  } = props
  const [guides, setGuides] = useState<{ vertical: number[]; horizontal: number[] }>({ vertical: [], horizontal: [] })
  const [linkLine, setLinkLine] = useState<{ fromX: number; fromY: number; toX: number; toY: number } | null>(null)
  // CV-089：用户「按下并拖动」的那个节点 id（多选拖拽时的「主」节点）。
  // 走 state 而不是读 gesture.current —— ref 变更不触发 re-render，渲染期
  // 读它拿到的永远是上一次渲染的值，csNodePrimary 就不会按时亮起。
  const [primaryDragId, setPrimaryDragId] = useState<string | null>(null)
  // CV-186：血缘聚光的「正在拖」集合 —— 按下不动时是 null（**单击不压暗**）。
  // 只有位移越过拖拽阈值（editBegun 置位那一刻）才填，松手/取消立刻清空。
  //
  // 为什么走 state 而不是复用 gesture.current.editBegun：它是 ref，变更不触发
  // re-render，档位永远不会按时点亮。为什么绑手势而不是绑选区：手势只有
  // pointerup / pointercancel 两条出口，选区有十几处写入点 —— 绑选区的版本
  // 出现过「松手后压暗不恢复」（CV-171 退场的直接起因）。
  const [spotDragIds, setSpotDragIds] = useState<readonly string[] | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // CV-003：画布表面容器实测尺寸（三栏布局的中间列，≠ window 尺寸），
  // 供 minimap 视口框与跳转居中计算使用；ResizeObserver 跟随窗口/面板变化。
  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = containerRef.current
    if (el === null) return
    const update = (): void => { setSurfaceSize({ width: el.clientWidth, height: el.clientHeight }) }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [])
  // Latest view/callback mirrors so handlers and one-shot effects read current
  // values without re-subscribing (the store owns the authoritative state).
  const viewRef = useRef(view)
  viewRef.current = view
  const onViewChangeRef = useRef(onViewChange)
  onViewChangeRef.current = onViewChange
  // CV-185：同一份 ref 约定 —— 适配是 useCallback([]) 里的稳定函数，不能因为
  // 上层每次渲染换一个回调就重建（重建会连带 useImperativeHandle 一起抖动）。
  const onFitClampedRef = useRef(onFitClamped)
  onFitClampedRef.current = onFitClamped
  const gesture = useRef<Gesture>({ mode: 'none', startX: 0, startY: 0 })

  // CR-060 / CV-071：手势期间把 pointer 捕获到容器，指针拖出画布边界仍能收到
  // pointermove/pointerup，落定/框选才不提前中断。释放用 try/catch 兜底
  // （setPointerCapture/releasePointerCapture 对已释放/无效 id 会抛 DOMException）。
  //
  // CV-071：捕获**必须延迟到首次真正移动**，不能在 pointerdown 就 capture。
  // 按 Pointer Events 规范，捕获生效期间派发的 mousedown/mouseup 会被
  // retarget 到捕获元素，而 click/dblclick 的 target 由这两者决定 —— 于是
  // 双击节点时 dblclick 的 target 变成画布容器而不是节点 div，节点上挂的
  // React onDoubleClick 收到不到事件（冒泡路径不经过节点）。这正是
  // 「双击视频/图片不弹浮层」的根因：容器自己的 onDoubleClick（双击空白
  // 适配视野）一直正常，只有节点级的双击全挂。
  const armPointer = (event: React.PointerEvent): void => {
    gesture.current = { ...gesture.current, pointerId: event.pointerId, captured: false }
  }
  /** CV-071：首次实际移动时才真正捕获（纯点击/双击全程不捕获，dblclick 正常）。 */
  const ensureCaptured = (): void => {
    const current = gesture.current
    if (current.pointerId === undefined || current.captured === true) return
    try { containerRef.current?.setPointerCapture(current.pointerId) } catch { /* 指针已释放或容器未挂载 */ }
    current.captured = true
  }
  const releasePointer = (): void => {
    const id = gesture.current.pointerId
    if (id === undefined) return
    try { containerRef.current?.releasePointerCapture(id) } catch { /* 未捕获到该指针，忽略 */ }
    delete gesture.current.pointerId
    delete gesture.current.captured
  }
  /** CV-071：屏幕位移是否已越过拖拽阈值。 */
  const exceededThreshold = (event: React.PointerEvent, current: Gesture): boolean =>
    Math.abs(event.clientX - current.startX) > DRAG_THRESHOLD
    || Math.abs(event.clientY - current.startY) > DRAG_THRESHOLD
  // CR-061：节点/缩放手势在「首帧真正 move」时才 push undo 快照（onBeginEdit）。
  // 单击（无位移）不会触发——历史里不再出现空快照。
  const beginEditOnce = (current: Gesture): void => {
    if (current.editBegun === true) return
    current.editBegun = true
    onBeginEdit()
  }
  const nodesRef = useRef(nodes)
  // CV-017：方向键微调的连发窗口 —— 800ms 内的连续按键算同一次编辑（只入一条 undo 快照）。
  const lastNudgeAtRef = useRef(0)
  // CR-062：方向键连发持久化去抖 —— 一次连发只写一次盘（此前每按一键全量写一次）。
  const nudgePersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  nodesRef.current = nodes

  // Center on a focused node (timeline/review jump) exactly once per focus
  // change. Depending on `nodes` here re-centered on every mutation (drag
  // frames, generation reloads) and yanked the viewport elsewhere — the
  // "canvas suddenly jumps" bug; nodes are read through the ref instead.
  const lastFocusedRef = useRef<string | null>(null)
  useEffect(() => {
    if (focusNodeId === undefined || focusNodeId === null) {
      lastFocusedRef.current = null
      return
    }
    if (lastFocusedRef.current === focusNodeId) return
    lastFocusedRef.current = focusNodeId
    const node = nodesRef.current.find(candidate => candidate.id === focusNodeId)
    const el = containerRef.current
    if (node === undefined || el === null) return
    const cx = node.x + node.width / 2
    const cy = node.y + node.height / 2
    onViewChangeRef.current({
      x: el.clientWidth / 2 - cx * viewRef.current.scale,
      y: el.clientHeight / 2 - cy * viewRef.current.scale,
    })
  }, [focusNodeId])

  const panBy = useCallback((deltaX: number, deltaY: number) => {
    onViewChangeRef.current({ x: viewRef.current.x + deltaX, y: viewRef.current.y + deltaY })
  }, [])

  const zoomAround = useCallback((pointX: number, pointY: number, factor: number) => {
    const el = containerRef.current
    if (el === null) return
    const rect = el.getBoundingClientRect()
    const px = pointX - rect.left
    const py = pointY - rect.top
    const newScale = clamp(viewRef.current.scale * factor, MIN_VIEW_SCALE, MAX_VIEW_SCALE)
    const wx = (px - viewRef.current.x) / viewRef.current.scale
    const wy = (py - viewRef.current.y) / viewRef.current.scale
    onViewChangeRef.current({ x: px - wx * newScale, y: py - wy * newScale, scale: newScale })
  }, [])

  // Native non-passive wheel listener so preventDefault works (React roots
  // attach wheel as passive). Ctrl/Cmd+wheel zooms around the cursor; a plain
  // wheel pans (reference behavior).
  useEffect(() => {
    const el = containerRef.current
    if (el === null) return
    const onWheel = (event: WheelEvent): void => {
      // CV-081：文本节点选中态正文可滚动 —— 滚轮落在「可滚动的选中正文 /
      // 编辑 textarea」内时不劫持（不 preventDefault、不平移缩放），交给
      // 浏览器原生滚动；内容未溢出（不可滚）时维持画布行为不变。
      const target = event.target instanceof HTMLElement ? event.target : null
      const scrollable = target?.closest<HTMLElement>('.csNodeSelected .csNodeBody, textarea')
      if (scrollable != null && scrollable.scrollHeight > scrollable.clientHeight) return
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        zoomAround(event.clientX, event.clientY, event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)
      } else {
        panBy(-event.deltaX, -event.deltaY)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => { el.removeEventListener('wheel', onWheel) }
  }, [zoomAround, panBy])

  // Keyboard shortcuts (window-level; skip while typing in a field).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target !== null && target.closest('input, textarea, select, [contenteditable="true"]') !== null) return
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) onRedo()
        else onUndo()
        return
      }
      if (modifier && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        onRedo()
        return
      }
      if (modifier && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        onCopy()
        return
      }
      if (modifier && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        onPaste()
        return
      }
      if (modifier && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        onSelectAllNodes()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedNodeIds.length > 0) onRemoveNodes([...selectedNodeIds])
        return
      }
      if (event.key === 'Escape') {
        onSelectNode(null)
        return
      }
      // CV-017：方向键微调选中节点（1px，Shift 10px）。连发算一次编辑。
      const nudgeDelta = NUDGE_DELTAS[event.key]
      if (nudgeDelta !== undefined && selectedNodeIds.length > 0) {
        event.preventDefault()
        const step = event.shiftKey ? 10 : 1
        const now = Date.now()
        if (now - lastNudgeAtRef.current > 800) onBeginEdit()
        lastNudgeAtRef.current = now
        for (const move of computeNudge(nodesRef.current, selectedNodeIds, nudgeDelta[0] * step, nudgeDelta[1] * step)) {
          onMoveNode(move.id, move.x, move.y)
        }
        // CR-062：连发期间只做一次持久化（300ms 去抖窗口），最后一次按键落定后写盘。
        if (nudgePersistTimerRef.current !== null) clearTimeout(nudgePersistTimerRef.current)
        nudgePersistTimerRef.current = setTimeout(() => {
          nudgePersistTimerRef.current = null
          onPersist()
        }, 300)
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      // CR-062：卸载时清掉未落定的 nudge 去抖定时器，避免对已卸载 store 写盘。
      if (nudgePersistTimerRef.current !== null) {
        clearTimeout(nudgePersistTimerRef.current)
        nudgePersistTimerRef.current = null
      }
    }
  }, [selectedNodeIds, onSelectNode, onSelectAllNodes, onRemoveNodes, onCopy, onPaste, onUndo, onRedo, onMoveNode, onBeginEdit, onPersist])

  // CV-185：适配数学收口到 canvas-view.ts 的 computeFitView（纯函数、Host 侧可单测）。
  // 这里只把结果落到视图上，并把 FitResult 交给调用方 —— 它知道「这次适配被可读下限
  // 挡住了」，才提示得了用户「还有内容在视野外」。
  const fitToBounds = useCallback((bounds: { x: number; y: number; width: number; height: number }): FitResult | null => {
    const el = containerRef.current
    if (el === null) return null
    const result = computeFitView(bounds, { width: el.clientWidth, height: el.clientHeight })
    onViewChangeRef.current({ x: result.x, y: result.y, scale: result.scale })
    if (result.clamped) onFitClampedRef.current?.(result)
    return result
  }, [])

  const fitToContent = useCallback((): FitResult | null => {
    const bounds = contentBounds(nodesRef.current)
    if (bounds === null) {
      onViewChangeRef.current({ x: 0, y: 0, scale: 1 })
      return null
    }
    return fitToBounds(bounds)
  }, [fitToBounds])

  /** CV-185：整理布局要按「视口形状」排，才谈得上「整张图铺满一屏」。 */
  const viewportSize = useCallback((): { width: number; height: number } | null => {
    const el = containerRef.current
    if (el === null) return null
    return { width: el.clientWidth, height: el.clientHeight }
  }, [])

  // CV-019：缩放到选中节点；无选中时退化为适配全部内容。
  const zoomToSelection = useCallback(() => {
    if (selectedNodeIds.length === 0) {
      fitToContent()
      return
    }
    const selected = nodesRef.current.filter(node => selectedNodeIds.includes(node.id))
    const bounds = contentBounds(selected)
    if (bounds === null) {
      fitToContent()
      return
    }
    fitToBounds(bounds)
  }, [selectedNodeIds, fitToContent, fitToBounds])

  const zoomBy = useCallback((factor: number) => {
    const el = containerRef.current
    if (el === null) return
    zoomAround(el.clientWidth / 2, el.clientHeight / 2, factor)
  }, [zoomAround])

  const resetZoom = useCallback(() => {
    onViewChangeRef.current({ x: 0, y: 0, scale: 1 })
  }, [])

  const onSurfacePointerDown = (event: React.PointerEvent): void => {
    // 空白左键拖拽 = 平移（框选已退场，平移不再是「中键 / Shift+左键」的专属
    // 手势）。**按下即清选**（Ctrl/Cmd 例外，与节点 Ctrl 点选同一约定）——
    // 2026-09-13 真机验收教训：清选判定放在 pointerup + 位移阈值上，稍微
    // 带拖动的点击清不掉选区，多选残留态退不出去，用户怎么点都「显示不对」。
    // 按下即清之后拖拽 = 纯平移，语义干净无歧义。
    if (event.button === 1 || event.button === 0) {
      // CV-174：主动清掉浏览器原生选区 —— 本分支会 preventDefault，浏览器
      // 自带的「按下即清除选区」被拦，画布外残留的文字选区高亮清不掉。
      window.getSelection()?.removeAllRanges()
      if (event.button === 0 && !(event.ctrlKey || event.metaKey)) onSelectNode(null)
      gesture.current = { mode: 'pan', startX: event.clientX, startY: event.clientY }
      armPointer(event)
      event.preventDefault()
      return
    }
  }

  const onNodePointerDown = (event: React.PointerEvent, node: StudioCanvasNode): void => {
    // Ctrl/Cmd 点击 = **纯选区修饰**：只切换该节点在多选 roster 里的成员资格，
    // 不起拖拽手势。为什么不起手势：加选场景下「拖谁、谁亮」必须只有一个答案，
    // 而带修饰键的拖拽语义（Figma 是移动整队）与本画布已有的「无修饰键拖成员
    // 就整队随动」重复，留着只会制造两套解释。
    //
    // ⚠️ 2026-09-13 验收回归（CV-169）：CV-166 重写本函数时把 multi 参数丢掉了
    // （改前是 `onSelectNode(node.id, event.ctrlKey || event.metaKey)`），于是
    // Ctrl+点已选节点从「减选」变成「单选它」（越点越只剩一个），Ctrl+点未选
    // 节点也加不进选区；而下面算拖拽成员的 roster 仍按「加选」算 —— 结果就是
    // **动的是 3 张、亮的只有 1 张**，用户看到「选中状态全乱了」。
    if (event.ctrlKey || event.metaKey) {
      onSelectNode(node.id, true)
      return
    }
    // CV-008：本次拖拽要带的成员（多选整体移动；组内成员若其组也在选区里
    // 则跳过——store 的 moveNode 已按组带动 children，避免双重位移）。
    const inRoster = selectedNodeIds.includes(node.id)
    const roster: readonly string[] = inRoster ? selectedNodeIds : [node.id]
    // Figma 语义（2026-09-13 真机验收教训）：点中多选区成员（无修饰键）时
    // **不立即塌缩选区** —— 立即塌缩会让连带拖拽变成「随动节点在动却不亮，
    // 松手后画面上没有任何解释」，用户看到的就是「我拖了一张卡，别的卡
    // 自己动了」。现在：拖动 = 整队保持选中（全程发光）；原地点击 = 松手
    // 才塌缩为单选（pointerup 的 collapseOnClick 分支）。
    const memberClick = inRoster && selectedNodeIds.length > 1
    if (!memberClick) onSelectNode(node.id)
    if (node.locked) {
      // 锁定节点不进手势，「点击塌缩」没有 pointerup 可依赖，就地执行。
      if (memberClick) onSelectNode(node.id)
      return
    }
    // CR-061：不再在此 push undo 快照——单击不产生位移；首帧实际 move 时
    // onBeginEdit 才触发（见 onPointerMove），避免空快照污染 undo 历史。
    const origins = roster
      .filter(id => {
        const member = nodesRef.current.find(candidate => candidate.id === id)
        return member !== undefined && !member.locked
          && !(member.parentId !== undefined && roster.includes(member.parentId))
      })
      .map(id => {
        const member = nodesRef.current.find(candidate => candidate.id === id)!
        return { id, x: member.x, y: member.y }
      })
    // CV-177：单成员托盘的代理（判定在 canvas-view，与组几何同一份实现）。
    const proxy = singleMemberGroupOf(nodesRef.current, node)
    gesture.current = {
      mode: 'node',
      startX: event.clientX,
      startY: event.clientY,
      nodeId: node.id,
      originX: node.x,
      originY: node.y,
      origins,
      collapseOnClick: memberClick,
      // CV-177：单成员托盘 —— 拖成员 = 拖托盘。只在 roster 就是它自己时归一化
      // （多选整队拖动有自己的 origins 通道，不在这里改语义）。
      ...(roster.length === 1 && proxy !== undefined
        ? { moveProxyId: proxy.id, proxyOriginX: proxy.x, proxyOriginY: proxy.y }
        : {}),
    }
    armPointer(event)
    // CV-089：标记主拖节点（抬 z-index + 加粗描边，不动其他节点的不透明度）。
    // CV-183：托盘只拿描边 —— 它的 z-index 被 styles.ts 的 .csNodeTray 规则
    // 豁免。托盘是容器，被置顶会盖住自己的成员（真机现象：拖托盘时图片消失）。
    setPrimaryDragId(node.id)
  }

  const onResizePointerDown = (event: React.PointerEvent, node: StudioCanvasNode, corner: ResizeCorner): void => {
    onSelectNode(node.id)
    // CR-061：同 node 手势，首帧实际 resize 时 onBeginEdit（见 onPointerMove）。
    gesture.current = {
      mode: 'resize',
      startX: event.clientX,
      startY: event.clientY,
      nodeId: node.id,
      originX: node.x,
      originY: node.y,
      originWidth: node.width,
      originHeight: node.height,
      corner,
    }
    armPointer(event)
  }

  const onLinkPointerDown = (event: React.PointerEvent, node: StudioCanvasNode): void => {
    // CV-038：起点锚在来源节点**右缘中点**（与落定后的正式边同锚点），
    // 而不是指针按下的位置 —— 否则起草线落定瞬间起点会跳一下。
    const anchor = sourceAnchor(node)
    const world = screenToWorld(event.clientX, event.clientY, viewRef.current.x, viewRef.current.y, viewRef.current.scale)
    gesture.current = {
      mode: 'link',
      startX: event.clientX,
      startY: event.clientY,
      sourceId: node.id,
      fromWorldX: anchor.x,
      fromWorldY: anchor.y,
    }
    armPointer(event)
    setLinkLine({ fromX: anchor.x, fromY: anchor.y, toX: world.x, toY: world.y })
  }

  const onPointerMove = (event: React.PointerEvent): void => {
    const current = gesture.current
    if (current.mode === 'none') return
    // The mouse button was released outside the surface (its pointerup never
    // reached us): end the gesture so plain hover moves never pan/drag.
    if (event.pointerType === 'mouse' && event.buttons === 0) {
      onPointerUp(event)
      return
    }
    const el = containerRef.current
    if (el === null) return
    if (current.mode === 'pan') {
      ensureCaptured()
      panBy(event.clientX - current.startX, event.clientY - current.startY)
      current.startX = event.clientX
      current.startY = event.clientY
      return
    }
    if (current.mode === 'node' && current.nodeId !== undefined && current.originX !== undefined && current.originY !== undefined) {
      // CV-071：3px 拖拽阈值 —— 手抖未过阈值时不移动、不捕获、不入 undo。
      // 既避免双击的微小抖动产生一条空快照 + 一次写盘，也保证纯点击全程
      // 无 pointer capture（dblclick 才能落到节点上）。
      if (!current.editBegun && !exceededThreshold(event, current)) return
      ensureCaptured()
      // CR-061：首帧 move 前 push undo 快照（后续帧不再重复）。
      const firstMove = current.editBegun !== true
      beginEditOnce(current)
      // CV-186：**首帧真正移动**才开血缘聚光（原地点击、双击全程不压暗）。
      // 只在首帧置一次 state —— 后续帧沿用同一批 id，不必每帧造新数组。
      // 多选时整队都是「被拖节点」；单成员托盘走代理，把托盘本体一并算进来。
      if (firstMove) {
        setSpotDragIds([
          ...(current.origins !== undefined ? current.origins.map(origin => origin.id) : [current.nodeId]),
          ...(current.moveProxyId !== undefined ? [current.moveProxyId] : []),
        ])
      }
      const dx = (event.clientX - current.startX) / viewRef.current.scale
      const dy = (event.clientY - current.startY) / viewRef.current.scale
      // CV-008：多选整体移动 —— 以被按下的节点为主，snap 校正量均摊到全体。
      if (current.origins !== undefined && current.origins.length > 1) {
        const dragged = nodesRef.current.find(candidate => candidate.id === current.nodeId)
        const primary = current.origins.find(origin => origin.id === current.nodeId)
        if (dragged === undefined || primary === undefined) return
        const snapped = calculateSnap(nodesRef.current, dragged, primary.x + dx, primary.y + dy)
        const correctX = snapped.x - (primary.x + dx)
        const correctY = snapped.y - (primary.y + dy)
        for (const origin of current.origins) {
          onMoveNode(origin.id, origin.x + dx + correctX, origin.y + dy + correctY)
        }
        setGuides({
          vertical: snapped.guides.filter(guide => guide.type === 'vertical').map(guide => guide.position),
          horizontal: snapped.guides.filter(guide => guide.type === 'horizontal').map(guide => guide.position),
        })
        return
      }
      // CV-177：有代理时移动的是托盘本体（成员随 parentId 跟随），位移与
      // 直接拖成员完全等价 —— 这就是「单张时两者效果一样」的实现。
      const moveId = current.moveProxyId ?? current.nodeId
      const baseX = current.moveProxyId !== undefined ? (current.proxyOriginX ?? current.originX) : current.originX
      const baseY = current.moveProxyId !== undefined ? (current.proxyOriginY ?? current.originY) : current.originY
      const targetX = baseX + dx
      const targetY = baseY + dy
      const dragged = nodesRef.current.find(candidate => candidate.id === moveId)
      if (dragged === undefined) return
      const snapped = calculateSnap(nodesRef.current, dragged, targetX, targetY)
      onMoveNode(moveId, snapped.x, snapped.y)
      setGuides({
        vertical: snapped.guides.filter(guide => guide.type === 'vertical').map(guide => guide.position),
        horizontal: snapped.guides.filter(guide => guide.type === 'horizontal').map(guide => guide.position),
      })
      return
    }
    if (current.mode === 'resize' && current.nodeId !== undefined && current.originX !== undefined
      && current.originY !== undefined && current.originWidth !== undefined && current.originHeight !== undefined
      && current.corner !== undefined) {
      // CV-071：同 node 手势，未过阈值不动、不捕获、不入 undo。
      if (!current.editBegun && !exceededThreshold(event, current)) return
      ensureCaptured()
      // CR-061：首帧 resize 前 push undo 快照。
      beginEditOnce(current)
      const dx = (event.clientX - current.startX) / viewRef.current.scale
      const dy = (event.clientY - current.startY) / viewRef.current.scale
      const corner = current.corner
      let x = current.originX
      let y = current.originY
      let width = current.originWidth
      let height = current.originHeight
      if (corner.includes('e')) width = Math.max(MIN_NODE_SIZE, current.originWidth + dx)
      if (corner.includes('s')) height = Math.max(MIN_NODE_SIZE, current.originHeight + dy)
      if (corner.includes('w')) {
        width = Math.max(MIN_NODE_SIZE, current.originWidth - dx)
        x = current.originX + current.originWidth - width
      }
      if (corner.includes('n')) {
        height = Math.max(MIN_NODE_SIZE, current.originHeight - dy)
        y = current.originY + current.originHeight - height
      }
      onUpdateNode(current.nodeId, { x, y, width, height })
      return
    }
    if (current.mode === 'link' && current.fromWorldX !== undefined && current.fromWorldY !== undefined) {
      ensureCaptured()
      const world = screenToWorld(event.clientX, event.clientY, viewRef.current.x, viewRef.current.y, viewRef.current.scale)
      setLinkLine({ fromX: current.fromWorldX, fromY: current.fromWorldY, toX: world.x, toY: world.y })
    }
  }

  const onPointerUp = (event: React.PointerEvent): void => {
    const current = gesture.current
    // 点中多选区成员松手 = 塌缩为单选（不再依赖 editBegun）。
    // 改前这里判 `!editBegun` —— 用户只要在节点上按住并移动 > 3px（CR-061
    // 拖拽阈值），塌缩就被跳过，选区保留为多选，于是**多选里的所有节点都
    // 持续显示选中态**。用户描述"压暗"的视觉就是由此而来：原本只想切换单
    // 选一张卡，整队卡片却都挂着红边，按 ESC / 点空白都清不干净。
    // 现在：拖动过程中整队依然一起移动（CV-008 多选整体移动未变），**松手
    // 立刻塌缩为单选**——视觉上「主卡高亮、随动卡回归」是瞬时帧，松手时已
    // 收敛回单选。
    if (current.mode === 'node' && current.collapseOnClick === true
      && current.nodeId !== undefined) {
      onSelectNode(current.nodeId)
    }
    if (current.mode === 'link' && current.sourceId !== undefined) {
      const world = screenToWorld(event.clientX, event.clientY, viewRef.current.x, viewRef.current.y, viewRef.current.scale)
      const target = nodesRef.current.find(candidate =>
        candidate.id !== current.sourceId
        && candidate.visible !== false
        && world.x >= candidate.x && world.x <= candidate.x + candidate.width
        && world.y >= candidate.y && world.y <= candidate.y + candidate.height,
      )
      if (target !== undefined) onLinkLayers([current.sourceId], target.id)
      setLinkLine(null)
      onPersist()
    }
    // CR-061：只有真正位移过的 node/resize 手势才持久化；纯单击（editBegun 未置位）
    // 跳过，避免点一下写一次盘。
    if ((current.mode === 'node' || current.mode === 'resize') && current.editBegun === true) onPersist()
    setGuides({ vertical: [], horizontal: [] })
    // CV-089：拖动结束 —— 清掉主拖标记。CV-186：血缘聚光同步收档。
    setPrimaryDragId(null)
    setSpotDragIds(null)
    releasePointer()
    gesture.current = { mode: 'none', startX: 0, startY: 0 }
  }

  // CR-063：派生数组用 useMemo——nodes 引用稳定时（非拖拽的无关重渲染）不再
  // 每渲染重建，配合 CanvasEdges/CanvasNode 的 React.memo 减少不必要的重渲染。
  const visibleNodes = useMemo(() => nodes.filter(node => node.visible !== false), [nodes])
  const ordered = useMemo(() => [...visibleNodes].sort(compareNodes), [visibleNodes])
  // CV-177：托盘的成员数（头部抓取带上报「几张」）。没有组时这张表是空的，
  // 普通项目零开销。
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>()
    if (!visibleNodes.some(node => node.kind === 'group')) return counts
    for (const node of visibleNodes) {
      if (node.parentId === undefined) continue
      counts.set(node.parentId, (counts.get(node.parentId) ?? 0) + 1)
    }
    return counts
  }, [visibleNodes])

  // CV-186：血缘聚光回归 —— 但**只在拖动中**、且按血缘距离分三档（直接血缘亮 /
  // 隔一层中间档 / 更远与无关压暗）。DD-03 原版是「单击选中就压暗其余全部」，
  // 实测在真画布上平均压暗 68%、53 个拖动目标里 39 个超过 70%，用户读到的是
  // 「一选就暗一片、松手也不恢复」。距离分档与两道安全阀见 canvas-lineage.ts。
  //
  // 依赖只有 visibleNodes 与手势状态：没有拖动时 spotDragIds 为 null，
  // spotlight.active 为 false，全部节点停在亮档（无关重渲染零成本）。
  const spotlight = useMemo(
    () => canvasSpotlight(visibleNodes, spotDragIds ?? []),
    [visibleNodes, spotDragIds],
  )

  /**
   * CV-184：把指定节点带进视野（只平移，不改缩放）。
   *
   * 生成产物落在视野外时，「画布一动不动」会被读成「点了没反应 / 是不是失败了」。
   * 这里只做最小位移（revealOffsetOf 保证），并且**不抢正在进行的拖拽/框选** ——
   * 手势是一次连续操作，中途被平移会直接打乱它。
   */
  const revealNodes = useCallback((ids: readonly string[]): void => {
    const el = containerRef.current
    if (el === null || ids.length === 0) return
    if (gesture.current.mode !== 'none') return
    const targets = nodesRef.current.filter(node => ids.includes(node.id))
    if (targets.length === 0) return
    const bounds = contentBounds(targets)
    if (bounds === null) return
    const current = viewRef.current
    const delta = revealOffsetOf(bounds, current, { width: el.clientWidth, height: el.clientHeight })
    if (delta.dx === 0 && delta.dy === 0) return
    onViewChangeRef.current({
      x: current.x + delta.dx,
      y: current.y + delta.dy,
      scale: current.scale,
    })
  }, [])

  // Expose zoom actions (incl. keyboard-driven zoomBy/fit/reset) to the frame.
  useImperativeHandle(ref, () => ({ zoomBy, fitToContent, zoomToSelection, resetZoom, revealNodes, viewportSize }), [zoomBy, fitToContent, zoomToSelection, resetZoom, revealNodes, viewportSize])

  return (
    <div
      className="csCanvasSurface"
      ref={containerRef}
      onPointerDown={onSurfacePointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      // CV-016：右键空白处弹菜单（节点自身的 contextmenu 会 stopPropagation，
      // 不会走到这里）；edge/minimap 等浮层右键也归入空白处理。
      onContextMenu={event => {
        event.preventDefault()
        const world = screenToWorld(event.clientX, event.clientY, viewRef.current.x, viewRef.current.y, viewRef.current.scale)
        onBlankContextMenu(event.clientX, event.clientY, world.x, world.y)
      }}
      // CV-019：双击空白 = 适配视野（节点双击已被 CanvasNode stopPropagation 拦下）。
      onDoubleClick={() => { fitToContent() }}
      // CV-169：**pointercancel 必须有收口**。指针被系统夺走时（触控手势接管、
      // 拖拽中又按下右键、起手元素被移除等）浏览器只发 pointercancel，**不会再补
      // pointerup** —— 从前这里没有分支，手势就永远停在 'node'/'resize'：
      // primaryDragId 不清（被拖那张卡一直挂着「主选中」加粗环）、光标停在
      // grabbing、后续 pointermove 继续按上个手势改坐标。用户视角正是
      // 「鼠标松开了，画面没有恢复」。drop 与 pointerup 同款，位移过的手势照样落盘。
      onPointerCancel={() => {
        const current = gesture.current
        if (current.mode === 'link') setLinkLine(null)
        if ((current.mode === 'node' || current.mode === 'resize') && current.editBegun === true) onPersist()
        setGuides({ vertical: [], horizontal: [] })
        setPrimaryDragId(null)
        setSpotDragIds(null)
        releasePointer()
        gesture.current = { mode: 'none', startX: 0, startY: 0 }
      }}
      onPointerLeave={() => {
        if (gesture.current.mode === 'link') {
          // CR-064：link 模式拖出画布直接取消起草线——伪造 pointerup 的
          // (0,0) 坐标会算出画布原点附近的错误落点，可能误连到无关节点。
          setLinkLine(null)
          releasePointer()
          gesture.current = { mode: 'none', startX: 0, startY: 0 }
          return
        }
        if (gesture.current.mode !== 'none') {
          onPointerUp(new MouseEvent('pointerup') as unknown as React.PointerEvent)
        }
      }}
      style={{
        backgroundPosition: `${view.x}px ${view.y}px`,
        backgroundSize: `${40 * view.scale}px ${40 * view.scale}px`,
      }}
    >
      <div
        className="csCanvasLayer"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: '0 0' }}
      >
        <CanvasEdges nodes={visibleNodes} selectedNodeIds={selectedNodeIds} scale={view.scale} />
        {guides.vertical.map(position => (
          <div key={`gv-${position}`} className="csGuide csGuideVertical" style={{ left: position }} />
        ))}
        {guides.horizontal.map(position => (
          <div key={`gh-${position}`} className="csGuide csGuideHorizontal" style={{ top: position }} />
        ))}
        {ordered.map(node => {
          const shotIndex = shotIndexOf?.get(node.id)
          const tier = spotlightTierOf(spotlight, node.id)
          return (
            <CanvasNode
              key={node.id}
              node={node}
              selected={selectedNodeIds.includes(node.id)}
              // CV-089：主被拖节点标记 —— 多选拖拽时区分「按下那个」与「随从」，
              // 主节点拿到 csNodePrimary（更粗描边 + z-index 上抬）。
              primary={node.id === primaryDragId}
              // CV-186：拖动中的血缘明度档位（亮档整条不传，props 保持干净）。
              {...(tier !== undefined ? { tier } : {})}
              {...(shotIndex !== undefined ? { shotIndex } : {})}
              // CV-177：只有托盘需要成员数（一张还是多张决定拖动语义的读法）。
              {...(node.kind === 'group' ? { groupCount: groupCounts.get(node.id) ?? 0 } : {})}
              onNodePointerDown={onNodePointerDown}
              onResizePointerDown={onResizePointerDown}
              onLinkPointerDown={onLinkPointerDown}
              onRenameSubmit={onRename}
              onTextSubmit={onNodeTextSubmit}
              onOpenDetail={onNodeOpenDetail}
              {...(onNodeOpenPlayback !== undefined ? { onOpenPlayback: onNodeOpenPlayback } : {})}
              {...(onNodeOpenPreview !== undefined ? { onOpenPreview: onNodeOpenPreview } : {})}
              onContextMenu={onContextMenu}
              onRetry={onRetry}
              {...(onMediaNatural !== undefined ? { onMediaNatural } : {})}
            />
          )
        })}
        {linkLine !== null && (
          <svg className="csEdges" width={1} height={1}>
            {/* CV-038：起草线与正式边共用同一条贝塞尔，落定前后不再跳变。 */}
            <path
              className="csEdge csEdgeDraft"
              d={buildEdgePath({ x: linkLine.fromX, y: linkLine.fromY }, { x: linkLine.toX, y: linkLine.toY })}
            />
          </svg>
        )}
      </div>
      {minimapVisible && (
        <Minimap
          nodes={visibleNodes}
          offset={{ x: view.x, y: view.y }}
          scale={view.scale}
          onSetOffset={next => { onViewChangeRef.current({ x: next.x, y: next.y }) }}
          viewportWidth={surfaceSize.width}
          viewportHeight={surfaceSize.height}
          // 让 minimap 区域也参与「点空白清选」语义 —— minimap 自己的
          // onPointerDown 会 stopPropagation 防止画布平移手势误触发，所以
          // 画布容器的 onSelectNode(null) 走不到这里；走这个回调代为清选。
          onSurfacePointerDown={() => { onSelectNode(null) }}
        />
      )}
    </div>
  )
})
