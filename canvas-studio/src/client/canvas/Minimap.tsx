import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StudioCanvasNode, StudioCanvasNodeKind } from '../../contracts/canvas.js'

/** Minimap size in screen pixels. */
const MINIMAP_WIDTH = 200
const MINIMAP_HEIGHT = 150
const PADDING = 20
/**
 * CV-286：与画布容器同口径的「单击」位移阈值（|dx|+|dy|，屏幕 px）——
 * 松开且没超过它才算点击、才触发代清选；按住拖小地图 = 拖拽，不清选。
 */
const CLICK_SLOP = 5

/** Node color per kind (reference Minimap palette). */
const NODE_COLORS: Readonly<Record<StudioCanvasNodeKind, string>> = {
  image: '#f59e0b',
  video: '#8b5cf6',
  // CV-128：音频（与画布边 rose 同色系）。
  audio: '#f43f5e',
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
  /**
   * 画布表面「单击」通知 —— 用于把 minimap 这块被 stopPropagation 截断的
   * 区域也纳入「单击空白清选」语义（CV-286 与画布容器同款：按下先记位，
   * 松开且位移 ≤ CLICK_SLOP 才清，按住拖小地图不清 —— 改前是按下即清，
   * 拖小地图会顺手清掉选区）。回调在 mouseup 里、stopPropagation 之后的
   * 独立时机执行。
   */
  onSurfaceClick?(): void
}

/**
 * Content-fit minimap: every node as a colored rect, the current viewport as
 * a draggable frame. Click/drag jumps the canvas so the viewport centers on
 * the minimap position (reference Minimap behavior).
 */
export function Minimap(props: MinimapProps) {
  const { nodes, offset, scale, onSetOffset, viewportWidth, viewportHeight, onSurfaceClick } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  // CV-286：按下起点 + 是否已拖过阈值（单击清选判定，与画布容器同款）。
  const pressRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)

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
  // CR-071：jumpTo 恒取「最新实测尺寸」——用 ref 旁路渲染闭包，避免首帧过渡期
  // （window 回退 → 实测就绪）jumpTo 与视口框各用不同尺寸导致点击跳转偏移。
  const sizeRef = useRef({ vw, vh })
  sizeRef.current = { vw, vh }

  const jumpTo = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect === undefined || rect === null) return
    const minimapX = clientX - rect.left
    const minimapY = clientY - rect.top
    const worldX = minimapX / fitScale + contentBounds.x
    const worldY = minimapY / fitScale + contentBounds.y
    const { vw, vh } = sizeRef.current
    onSetOffset({
      x: vw / 2 - worldX * scale,
      y: vh / 2 - worldY * scale,
    })
  }, [fitScale, contentBounds, scale, onSetOffset])

  useEffect(() => {
    if (!isDragging) return
    const handleMove = (event: MouseEvent) => {
      // CV-286：拖动中累计判定 —— 只要移动超过阈值，本次手势就不是「单击」。
      const press = pressRef.current
      if (press !== null && !press.moved
        && (Math.abs(event.clientX - press.x) + Math.abs(event.clientY - press.y)) > CLICK_SLOP) {
        press.moved = true
      }
      jumpTo(event.clientX, event.clientY)
    }
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
      // 指针隔离：minimap 悬浮在画布表面容器内，pointerdown 冒泡到容器会
      // 直接起手平移（空白左键 = pan）——按住小地图拖视口会连画布一起拖。
      // stopPropagation 把两个手势切开（旧框选时代这里是同根冲突源）。
      // ⚠️ 「单击清选」不能丢（CV-286）：按下只记起点，mouseup 且没拖过
      // CLICK_SLOP 才代清选 —— 按住拖小地图不再顺手清掉选区（与画布同款）。
      onPointerDown={event => {
        pressRef.current = event.button === 0 ? { x: event.clientX, y: event.clientY, moved: false } : null
        event.stopPropagation()
      }}
      onMouseDown={() => { setIsDragging(true) }}
      onMouseUp={event => {
        const press = pressRef.current
        if (event.button === 0 && press !== null && !press.moved) onSurfaceClick?.()
        pressRef.current = null
        setIsDragging(false)
      }}
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