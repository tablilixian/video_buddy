/**
 * Pure canvas math + snap alignment helpers.
 *
 * Ported as concepts from the reference canvas module
 * (`reference/canvas/utils/canvasMath.ts`, `hooks/useSnapAlignment.ts`,
 * design doc §9.5): 5px threshold, six guide kinds (vertical: left/right/
 * center; horizontal: top/bottom/center), optional grid snapping (default
 * 50px). All functions are dependency-free so the surface can call them
 * per pointer-move frame without store round-trips.
 */
import type { StudioCanvasNode } from '../../contracts/canvas.js'

/** Clamp a value into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** A snap guide line to render while dragging. */
export interface SnapGuide {
  type: 'vertical' | 'horizontal'
  position: number
}

/** The snapped position plus the guides that fired. */
export interface SnapResult {
  x: number
  y: number
  guides: SnapGuide[]
}

/** Snap threshold in canvas-space pixels. */
const SNAP_THRESHOLD = 5

/**
 * Snap a dragged node's target position against every other node: left/right/
 * center edges on both axes, with optional grid snapping first.
 */
export function calculateSnap(
  nodes: readonly StudioCanvasNode[],
  dragged: StudioCanvasNode,
  targetX: number,
  targetY: number,
  options: { gridSnap?: boolean; gridSize?: number } = {},
): SnapResult {
  const { gridSnap = false, gridSize = 50 } = options
  const guides: SnapGuide[] = []
  if (gridSnap) {
    return {
      x: Math.round(targetX / gridSize) * gridSize,
      y: Math.round(targetY / gridSize) * gridSize,
      guides,
    }
  }

  let snapX = targetX
  let snapY = targetY
  const draggedRight = targetX + dragged.width
  const draggedBottom = targetY + dragged.height
  const draggedCenterX = targetX + dragged.width / 2
  const draggedCenterY = targetY + dragged.height / 2

  for (const node of nodes) {
    if (node.id === dragged.id) continue
    if (node.visible === false) continue
    const right = node.x + node.width
    const bottom = node.y + node.height
    const centerX = node.x + node.width / 2
    const centerY = node.y + node.height / 2

    if (Math.abs(targetX - node.x) < SNAP_THRESHOLD) {
      snapX = node.x
      guides.push({ type: 'vertical', position: node.x })
    }
    if (Math.abs(draggedRight - right) < SNAP_THRESHOLD) {
      snapX = right - dragged.width
      guides.push({ type: 'vertical', position: right })
    }
    if (Math.abs(draggedCenterX - centerX) < SNAP_THRESHOLD) {
      snapX = centerX - dragged.width / 2
      guides.push({ type: 'vertical', position: centerX })
    }
    if (Math.abs(targetY - node.y) < SNAP_THRESHOLD) {
      snapY = node.y
      guides.push({ type: 'horizontal', position: node.y })
    }
    if (Math.abs(draggedBottom - bottom) < SNAP_THRESHOLD) {
      snapY = bottom - dragged.height
      guides.push({ type: 'horizontal', position: bottom })
    }
    if (Math.abs(draggedCenterY - centerY) < SNAP_THRESHOLD) {
      snapY = centerY - dragged.height / 2
      guides.push({ type: 'horizontal', position: centerY })
    }
  }

  // CR-076：guides 按 (type, position) 去重——多个节点命中同轴同值（如两个节点
  // 右缘相同）会重复 push，渲染层用 position 作 React key 会产生重复 key。
  const seenGuides = new Set<string>()
  const uniqueGuides = guides.filter((guide) => {
    const key = `${guide.type}:${guide.position}`
    if (seenGuides.has(key)) return false
    seenGuides.add(key)
    return true
  })

  return { x: snapX, y: snapY, guides: uniqueGuides }
}

/** Union bounds of nodes (null when empty). */
export function contentBounds(
  nodes: readonly StudioCanvasNode[],
): { x: number; y: number; width: number; height: number } | null {
  if (nodes.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    if (node.visible === false) continue
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x + node.width)
    maxY = Math.max(maxY, node.y + node.height)
  }
  if (minX === Infinity) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** Screen → canvas-space coordinate (inverse of the surface transform). */
export function screenToWorld(
  screenX: number,
  screenY: number,
  offsetX: number,
  offsetY: number,
  scale: number,
): { x: number; y: number } {
  return {
    x: (screenX - offsetX) / scale,
    y: (screenY - offsetY) / scale,
  }
}

/** Canvas-space → screen coordinate. */
export function worldToScreen(
  worldX: number,
  worldY: number,
  offsetX: number,
  offsetY: number,
  scale: number,
): { x: number; y: number } {
  return {
    x: worldX * scale + offsetX,
    y: worldY * scale + offsetY,
  }
}