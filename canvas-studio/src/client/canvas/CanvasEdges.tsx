import type { StudioCanvasNode, StudioCanvasOperationType } from '../../contracts/canvas.js'
import { OPERATION_LABELS } from './labels.js'

/** Props for the bloodline edge overlay. */
export interface CanvasEdgesProps {
  nodes: readonly StudioCanvasNode[]
  /** Selected node ids (edge highlight when either endpoint is selected). */
  selectedNodeIds: readonly string[]
}

/** Edge color per operation type (reference ConnectionLines palette subset). */
const OPERATION_COLORS: Readonly<Record<StudioCanvasOperationType, string>> = {
  'text-to-image': '#22c55e',
  'image-to-image': '#3b82f6',
  'text-to-video': '#06b6d4',
  'image-to-video': '#8b5cf6',
  'mkr-video': '#a855f7',
  'style-transfer': '#f59e0b',
  'background-replace': '#f97316',
  expand: '#ec4899',
  'background-remove': '#14b8a6',
  variant: '#84cc16',
  import: '#6b7280',
  drawing: '#eab308',
  storyboard: '#f59e0b',
  'storyboard-split': '#f97316',
  'character-sheet': '#3b82f6',
  'scene-concept': '#10b981',
  'video-clip': '#06b6d4',
  'video-composite': '#a855f7',
}

/** Source-role labels for multi-source operations (index-aligned). */
const SOURCE_ROLE_LABELS: Readonly<Partial<Record<StudioCanvasOperationType, readonly string[]>>> = {
  'mkr-video': ['首帧', '中间帧', '尾帧'],
}

/** Marker id suffix must stay URL-safe; operation types are already safe. */
function markerId(operation: StudioCanvasOperationType): string {
  return `cs-arrow-${operation}`
}

/**
 * Bloodline edges: every node draws a bezier from each of its `sourceIds`
 * sources to its own left edge, colored by the target node's operationType
 * with an arrow marker and a Chinese operation chip at the midpoint (the
 * reference ConnectionLines rendering, adapted to canvas-space coordinates —
 * this SVG sits inside the transformed layer, so no manual offset/scale).
 * There is no separate edge table — edges are derived from the node graph at
 * render time (plan §7.3).
 */
export function CanvasEdges(props: CanvasEdgesProps) {
  const { nodes, selectedNodeIds } = props
  const byId = new Map(nodes.map(node => [node.id, node]))
  const selected = new Set(selectedNodeIds)
  const operationTypes = new Set(nodes.map(node => node.operationType).filter(Boolean) as StudioCanvasOperationType[])
  const paths: React.ReactNode[] = []

  for (const node of nodes) {
    if (node.sourceIds.length === 0) continue
    const operation = node.operationType ?? 'import'
    const color = OPERATION_COLORS[operation] ?? '#6b7280'
    const label = OPERATION_LABELS[operation] ?? '操作'
    const roles = SOURCE_ROLE_LABELS[operation]
    const toX = node.x
    const toY = node.y + node.height / 2

    node.sourceIds.forEach((sourceId, index) => {
      const source = byId.get(sourceId)
      if (source === undefined) return
      const fromX = source.x + source.width
      const fromY = source.y + source.height / 2
      const control = Math.abs(toX - fromX) * 0.5
      const d = `M ${fromX} ${fromY} C ${fromX + control} ${fromY}, ${toX - control} ${toY}, ${toX} ${toY}`
      const highlighted = selected.has(node.id) || selected.has(source.id)
      const midX = (fromX + toX) / 2
      const midY = (fromY + toY) / 2
      const chipLabel = roles?.[index] ?? label
      const chipWidth = Math.max(chipLabel.length * 8 + 16, 50)
      paths.push(
        <g key={`${sourceId}->${node.id}`}>
          <path
            className="csEdge"
            d={d}
            stroke={color}
            strokeWidth={highlighted ? 5 : 3.5}
            opacity={highlighted ? 1 : 0.5}
            markerEnd={`url(#${markerId(operation)})`}
          />
          <g>
            <rect
              x={midX - chipWidth / 2}
              y={midY - 10}
              width={chipWidth}
              height={20}
              rx={4}
              fill="#1f2937"
              stroke={color}
              strokeWidth={1}
              opacity={0.9}
            />
            <text
              x={midX}
              y={midY + 4}
              fill={color}
              fontSize={10}
              textAnchor="middle"
              className="csEdgeChipText"
            >
              {chipLabel}
            </text>
          </g>
        </g>,
      )
    })
  }

  return (
    <svg className="csEdges" width={1} height={1}>
      <defs>
        {[...operationTypes].map(operation => (
          <marker
            key={markerId(operation)}
            id={markerId(operation)}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="9"
            markerHeight="9"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={OPERATION_COLORS[operation] ?? '#6b7280'} />
          </marker>
        ))}
        <marker
          id="cs-arrow-import"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="9"
          markerHeight="9"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#6b7280" />
        </marker>
      </defs>
      {paths}
    </svg>
  )
}