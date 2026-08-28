import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StudioCanvasNode, StudioCanvasNodeKind } from '../../contracts/canvas.js'

/** Minimap size in screen pixels. */
const MINIMAP_WIDTH = 200
const MINIMAP_HEIGHT = 150
const PADDING = 20

/** Node color per kind (reference Minimap palette). */
const NODE_COLORS: Readonly<Record<StudioCanvasNodeKind, string>> = {
  image: '#f59e0b',
  video: '#8b5cf6',
  sticky: '#fbbf24',
  text: '#fafaf9',
  prompt: '#3b82f6',
  group: 'rgba(99, 102, 241, 0.5)',
}

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** Props for the minimap overlay (drawn inside the surface, screen-space). */
export interface MinimapProps {
  nodes: readonly StudioCanvasNode[]
  offset: { x: number; y: number }
  scale: number
  onSetOffset(offset: { x: number; y: number }): void
  /** 画布表面容器实测尺寸（CV-003：三栏布局下不能用 window 尺寸居中）。 */
  viewportWidth: number
  viewportHeight: number
}

/**
 * Content-fit minimap: every node as a colored rect, the current viewport as
 * a draggable frame. Click/drag jumps the canvas so the viewport centers on
 * the minimap position (reference Minimap behavior).
 */
export function Minimap(props: MinimapProps) {
  const { nodes, offset, scale, onSetOffset, viewportWidth, viewportHeight } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const contentBounds = useMemo((): Bounds => {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const node of nodes) {
      minX = Math.min(minX, node.x)
      minY = Math.min(minY, node.y)
      maxX = Math.max(maxX, node.x + node.width)
      maxY = Math.max(maxY, node.y + node.height)
    }
    if (minX === Infinity) return { x: 0, y: 0, width: 1000, height: 1000 }
    return {
      x: minX - PADDING,
      y: minY - PADDING,
      width: Math.max(maxX - minX + PADDING * 2, 1000),
      height: Math.max(maxY - minY + PADDING * 2, 1000),
    }
  }, [nodes])

  const fitScale = useMemo(() => {
    return Math.min(MINIMAP_WIDTH / contentBounds.width, MINIMAP_HEIGHT / contentBounds.height)
  }, [contentBounds])

  // CV-003：首帧测量值未就绪时回退 window 尺寸，避免视口框闪缩为 0。
  const vw = viewportWidth > 0 ? viewportWidth : window.innerWidth
  const vh = viewportHeight > 0 ? viewportHeight : window.innerHeight

  const jumpTo = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect === undefined || rect === null) return
    const minimapX = clientX - rect.left
    const minimapY = clientY - rect.top
    const worldX = minimapX / fitScale + contentBounds.x
    const worldY = minimapY / fitScale + contentBounds.y
    onSetOffset({
      x: vw / 2 - worldX * scale,
      y: vh / 2 - worldY * scale,
    })
  }, [fitScale, contentBounds, scale, onSetOffset, vw, vh])

  useEffect(() => {
    if (!isDragging) return
    const handleMove = (event: MouseEvent) => jumpTo(event.clientX, event.clientY)
    const handleUp = () => setIsDragging(false)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [isDragging, jumpTo])

  const viewport = {
    x: -offset.x / scale,
    y: -offset.y / scale,
    width: vw / scale,
    height: vh / scale,
  }

  return (
    <div
      ref={containerRef}
      className="csMinimap"
      onMouseDown={() => { setIsDragging(true) }}
      onMouseUp={() => { setIsDragging(false) }}
      onMouseLeave={() => { setIsDragging(false) }}
    >
      <svg width={MINIMAP_WIDTH} height={MINIMAP_HEIGHT}>
        {nodes.map(node => {
          const x = (node.x - contentBounds.x) * fitScale
          const y = (node.y - contentBounds.y) * fitScale
          const width = Math.max(node.width * fitScale, 2)
          const height = Math.max(node.height * fitScale, 2)
          return (
            <rect key={node.id} x={x} y={y} width={width} height={height} fill={NODE_COLORS[node.kind]} opacity={0.8} />
          )
        })}
        <rect
          x={(viewport.x - contentBounds.x) * fitScale}
          y={(viewport.y - contentBounds.y) * fitScale}
          width={viewport.width * fitScale}
          height={viewport.height * fitScale}
          fill="transparent"
          stroke="rgba(255, 255, 255, 0.6)"
          strokeWidth={1}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        />
      </svg>
    </div>
  )
}