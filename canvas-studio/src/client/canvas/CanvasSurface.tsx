import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
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
    onContextMenu,
    onBlankContextMenu,
    onRetry,
    onMediaNatural,
    focusNodeId,
    minimapVisible = true,
  } = props
  const [guides, setGuides] = useState<{ vertical: number[]; horizontal: number[] }>({ vertical: [], horizontal: [] })
  const [linkLine, setLinkLine] = useState<{ fromX: number; fromY: number; toX: number; toY: number } | null>(null)
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
  const nodesRef = useRef(nodes)
  // CV-017：方向键微调的连发窗口 —— 800ms 内的连续按键算同一次编辑（只入一条 undo 快照）。
  const lastNudgeAtRef = useRef(0)
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
        onPersist()
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
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
      event.preventDefault()
      return
    }
    if (event.button !== 0) return
    gesture.current = { mode: 'pan', startX: event.clientX, startY: event.clientY }
    if (!event.shiftKey) onSelectNode(null)
  }

  const onNodePointerDown = (event: React.PointerEvent, node: StudioCanvasNode): void => {
    onSelectNode(node.id, event.ctrlKey || event.metaKey)
    if (node.locked) return
    onBeginEdit()
    gesture.current = {
      mode: 'node',
      startX: event.clientX,
      startY: event.clientY,
      nodeId: node.id,
      originX: node.x,
      originY: node.y,
    }
  }

  const onResizePointerDown = (event: React.PointerEvent, node: StudioCanvasNode, corner: ResizeCorner): void => {
    onSelectNode(node.id)
    onBeginEdit()
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
      panBy(event.clientX - current.startX, event.clientY - current.startY)
      current.startX = event.clientX
      current.startY = event.clientY
      return
    }
    if (current.mode === 'node' && current.nodeId !== undefined && current.originX !== undefined && current.originY !== undefined) {
      const dx = (event.clientX - current.startX) / viewRef.current.scale
      const dy = (event.clientY - current.startY) / viewRef.current.scale
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
      const world = screenToWorld(event.clientX, event.clientY, viewRef.current.x, viewRef.current.y, viewRef.current.scale)
      setLinkLine({ fromX: current.fromWorldX, fromY: current.fromWorldY, toX: world.x, toY: world.y })
    }
  }

  const onPointerUp = (event: React.PointerEvent): void => {
    const current = gesture.current
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
    if (current.mode === 'node' || current.mode === 'resize') onPersist()
    setGuides({ vertical: [], horizontal: [] })
    gesture.current = { mode: 'none', startX: 0, startY: 0 }
  }

  const visibleNodes = nodes.filter(node => node.visible !== false)
  const ordered = [...visibleNodes].sort(compareNodes)

  // Expose zoom actions (incl. keyboard-driven zoomBy/fit/reset) to the frame.
  useImperativeHandle(ref, () => ({ zoomBy, fitToContent, zoomToSelection, resetZoom }), [zoomBy, fitToContent, zoomToSelection, resetZoom])

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
      onPointerLeave={() => {
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
            onNodePointerDown={onNodePointerDown}
            onResizePointerDown={onResizePointerDown}
            onLinkPointerDown={onLinkPointerDown}
            onRenameSubmit={onRename}
            onTextSubmit={onNodeTextSubmit}
            onOpenDetail={onNodeOpenDetail}
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
