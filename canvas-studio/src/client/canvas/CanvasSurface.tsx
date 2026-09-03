import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { StudioCanvasNode, StudioCanvasView } from '../../contracts/canvas.js'
import { MAX_VIEW_SCALE, MIN_VIEW_SCALE } from '../../canvas-view.js'
import { buildEdgePath, sourceAnchor } from '../../canvas-geometry.js'
import { computeNudge } from '../../canvas-actions.js'
import { calculateSnap, clamp, contentBounds, screenToWorld } from './canvas-math.js'
import { CanvasEdges } from './CanvasEdges.js'
import { CanvasNode, type ResizeCorner } from './CanvasNode.js'
import { Minimap } from './Minimap.js'
import { compareNodes } from '../project-store.js'

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
  mode: 'none' | 'pan' | 'node' | 'resize' | 'link' | 'marquee'
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
  /** CV-008：marquee 起点世界坐标；additive = 叠加现有选区（Ctrl/Cmd）。 */
  startWorldX?: number
  startWorldY?: number
  additive?: boolean
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
}

/** Imperative zoom controls exposed to the frame toolbar. */
export interface CanvasSurfaceHandle {
  zoomBy(factor: number): void
  fitToContent(): void
  /** CV-019：缩放到选中节点（无选中时等价 fitToContent）。 */
  zoomToSelection(): void
  resetZoom(): void
}

/**
 * The infinite canvas: a grid background that pans/zooms with content, node
 * boxes placed at their canvas-space coordinates, the bloodline edge overlay,
 * snap alignment guides, a minimap, and corner zoom controls.
 *
 * The viewport (`offset`/`scale`) is controlled: it lives in the project store
 * so it survives restarts (canvas.json v3) and project switches. Interactions
 * follow the reference canvas controls: background pointer-down pans (middle
 * button or Shift+left also pan), wheel without modifiers pans, Ctrl/Cmd+wheel
 * zooms around the cursor, node pointer-down begins a node drag (snap
 * alignment + guides), the node's resize handles begin a resize, and the link
 * handle begins a manual connection drag. Keyboard: Delete removes the
 * selection, Ctrl/Cmd+C/V copy/paste, Ctrl/Cmd+Z / Ctrl+Shift+Z / Ctrl+Y
 * undo/redo, Ctrl/Cmd+A selects all, Escape clears the selection.
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
  } = props
  const [guides, setGuides] = useState<{ vertical: number[]; horizontal: number[] }>({ vertical: [], horizontal: [] })
  const [linkLine, setLinkLine] = useState<{ fromX: number; fromY: number; toX: number; toY: number } | null>(null)
  // CV-008：marquee 框选矩形（容器相对屏幕坐标）。
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  // CV-089：用户「按下并拖动」的那个节点 id（多选拖拽时的「主」节点）。
  // 走 state 而不是读 gesture.current —— ref 变更不触发 re-render，渲染期
  // 读它拿到的永远是上一次渲染的值，csNodePrimary 就不会按时亮起。
  const [primaryDragId, setPrimaryDragId] = useState<string | null>(null)
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

  const fitToBounds = useCallback((bounds: { x: number; y: number; width: number; height: number }): void => {
    const el = containerRef.current
    if (el === null) return
    const vw = el.clientWidth
    const vh = el.clientHeight
    const padding = 60
    const scaleX = (vw - padding * 2) / bounds.width
    const scaleY = (vh - padding * 2) / bounds.height
    const newScale = clamp(Math.min(scaleX, scaleY), MIN_VIEW_SCALE, MAX_VIEW_SCALE)
    const centerX = bounds.x + bounds.width / 2
    const centerY = bounds.y + bounds.height / 2
    onViewChangeRef.current({
      x: vw / 2 - centerX * newScale,
      y: vh / 2 - centerY * newScale,
      scale: newScale,
    })
  }, [])

  const fitToContent = useCallback(() => {
    const bounds = contentBounds(nodesRef.current)
    if (bounds === null) {
      onViewChangeRef.current({ x: 0, y: 0, scale: 1 })
      return
    }
    fitToBounds(bounds)
  }, [fitToBounds])

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
    if (event.button === 1 || (event.button === 0 && event.shiftKey)) {
      gesture.current = { mode: 'pan', startX: event.clientX, startY: event.clientY }
      armPointer(event)
      event.preventDefault()
      return
    }
    if (event.button !== 0) return
    // CV-008：空白左键拖拽 = marquee 框选（平移交给 Shift+左键 / 中键 / 滚轮）。
    // Ctrl/Cmd = 叠加现有选区。注：marquee **不加** pointer capture——CV-008 约定
    // 拖出容器即取消框选（避免误选），与节点拖拽的「跟手出界」语义不同。
    const additive = event.ctrlKey || event.metaKey
    if (!additive) onSelectNode(null)
    const startWorld = screenToWorld(event.clientX, event.clientY, viewRef.current.x, viewRef.current.y, viewRef.current.scale)
    gesture.current = {
      mode: 'marquee',
      startX: event.clientX,
      startY: event.clientY,
      startWorldX: startWorld.x,
      startWorldY: startWorld.y,
      additive,
    }
    const el = containerRef.current
    if (el !== null) {
      const rect = el.getBoundingClientRect()
      setMarquee({
        x1: event.clientX - rect.left, y1: event.clientY - rect.top,
        x2: event.clientX - rect.left, y2: event.clientY - rect.top,
      })
    }
  }

  const onNodePointerDown = (event: React.PointerEvent, node: StudioCanvasNode): void => {
    // CV-008：先算本次拖拽要带的成员（多选整体移动；组内成员若其组也在
    // 选区里则跳过——store 的 moveNode 已按组带动 children，避免双重位移）。
    const inRoster = selectedNodeIds.includes(node.id)
    const roster: readonly string[] = event.ctrlKey || event.metaKey
      ? (inRoster ? selectedNodeIds.filter(id => id !== node.id) : [...selectedNodeIds, node.id])
      : (inRoster ? selectedNodeIds : [node.id])
    onSelectNode(node.id, event.ctrlKey || event.metaKey)
    if (node.locked) return
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
    gesture.current = {
      mode: 'node',
      startX: event.clientX,
      startY: event.clientY,
      nodeId: node.id,
      originX: node.x,
      originY: node.y,
      origins,
    }
    armPointer(event)
    // CV-089：标记主拖节点（抬 z-index + 加粗描边，不动其他节点的不透明度）。
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
    if (current.mode === 'marquee') {
      // CV-008：框选矩形跟随指针（容器相对坐标）。
      const el = containerRef.current
      if (el !== null) {
        const rect = el.getBoundingClientRect()
        setMarquee(prev => (prev === null ? prev : {
          ...prev,
          x2: event.clientX - rect.left,
          y2: event.clientY - rect.top,
        }))
      }
      return
    }
    if (current.mode === 'node' && current.nodeId !== undefined && current.originX !== undefined && current.originY !== undefined) {
      // CV-071：3px 拖拽阈值 —— 手抖未过阈值时不移动、不捕获、不入 undo。
      // 既避免双击的微小抖动产生一条空快照 + 一次写盘，也保证纯点击全程
      // 无 pointer capture（dblclick 才能落到节点上）。
      if (!current.editBegun && !exceededThreshold(event, current)) return
      ensureCaptured()
      // CR-061：首帧 move 前 push undo 快照（后续帧不再重复）。
      beginEditOnce(current)
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
      const targetX = current.originX + dx
      const targetY = current.originY + dy
      const dragged = nodesRef.current.find(candidate => candidate.id === current.nodeId)
      if (dragged === undefined) return
      const snapped = calculateSnap(nodesRef.current, dragged, targetX, targetY)
      onMoveNode(current.nodeId, snapped.x, snapped.y)
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
    if (current.mode === 'marquee' && current.startWorldX !== undefined && current.startWorldY !== undefined && current.additive !== undefined) {
      // CV-008：落选 = 世界坐标矩形与节点框相交的所有可见节点。
      const world = screenToWorld(event.clientX, event.clientY, viewRef.current.x, viewRef.current.y, viewRef.current.scale)
      const minX = Math.min(current.startWorldX, world.x)
      const maxX = Math.max(current.startWorldX, world.x)
      const minY = Math.min(current.startWorldY, world.y)
      const maxY = Math.max(current.startWorldY, world.y)
      // 单击（几乎没拖动）= 清选，不误选光标下的节点。
      const hits = (maxX - minX < 2 && maxY - minY < 2)
        ? []
        : nodesRef.current
          .filter(candidate => candidate.visible !== false
            && candidate.x < maxX && candidate.x + candidate.width > minX
            && candidate.y < maxY && candidate.y + candidate.height > minY)
          .map(candidate => candidate.id)
      const roster = current.additive ? Array.from(new Set([...selectedNodeIds, ...hits])) : hits
      // selectNode(multi) 是「翻转」语义：先清空再逐个加入，additive 叠加
      // 才不会把已在选区里的节点翻转掉。
      onSelectNode(null)
      for (const id of roster) onSelectNode(id, true)
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
    setMarquee(null)
    // CV-089：拖动结束 —— 清掉主拖标记。
    setPrimaryDragId(null)
    releasePointer()
    gesture.current = { mode: 'none', startX: 0, startY: 0 }
  }

  // CR-063：派生数组用 useMemo——nodes 引用稳定时（非拖拽的无关重渲染）不再
  // 每渲染重建，配合 CanvasEdges/CanvasNode 的 React.memo 减少不必要的重渲染。
  const visibleNodes = useMemo(() => nodes.filter(node => node.visible !== false), [nodes])
  const ordered = useMemo(() => [...visibleNodes].sort(compareNodes), [visibleNodes])

  // Expose zoom actions (incl. keyboard-driven zoomBy/fit/reset) to the frame.
  useImperativeHandle(ref, () => ({ zoomBy, fitToContent, zoomToSelection, resetZoom }), [zoomBy, fitToContent, zoomToSelection, resetZoom])

  return (
    <div
      className="csCanvasSurface"
      ref={containerRef}
      // CV-089：marquee 框选期间切换光标为 crosshair，给出「正在框选」的反馈。
      data-mode={marquee !== null ? 'marquee' : undefined}
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
      onPointerLeave={() => {
        if (gesture.current.mode === 'marquee') {
          // CV-008：指针拖出容器时取消框选（不落选——fake pointerup 的
          // (0,0) 坐标会算出错误的矩形）。
          setMarquee(null)
          gesture.current = { mode: 'none', startX: 0, startY: 0 }
          return
        }
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
        {ordered.map(node => (
          <CanvasNode
            key={node.id}
            node={node}
            selected={selectedNodeIds.includes(node.id)}
            // CV-089：主被拖节点标记 —— 多选拖拽时区分「按下那个」与「随从」，
            // 主节点拿到 csNodePrimary（更粗描边 + z-index 上抬）。
            primary={node.id === primaryDragId}
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
        ))}
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
      {/* CV-008：marquee 框选矩形（屏幕坐标层）。 */}
      {marquee !== null && (
        <div
          className="csMarquee"
          style={{
            left: Math.min(marquee.x1, marquee.x2),
            top: Math.min(marquee.y1, marquee.y2),
            width: Math.abs(marquee.x2 - marquee.x1),
            height: Math.abs(marquee.y2 - marquee.y1),
          }}
        />
      )}
      {minimapVisible && (
        <Minimap
          nodes={visibleNodes}
          offset={{ x: view.x, y: view.y }}
          scale={view.scale}
          onSetOffset={next => { onViewChangeRef.current({ x: next.x, y: next.y }) }}
          viewportWidth={surfaceSize.width}
          viewportHeight={surfaceSize.height}
        />
      )}
    </div>
  )
})
