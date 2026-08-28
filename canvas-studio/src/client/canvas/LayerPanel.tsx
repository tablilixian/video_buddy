import { useState } from 'react'
import type { StudioCanvasNode } from '../../contracts/canvas.js'
import { KIND_LABEL as KIND_LABELS } from './labels.js'

/** Props for the layer list panel. */
export interface LayerPanelProps {
  nodes: readonly StudioCanvasNode[]
  selectedNodeIds: readonly string[]
  onSelect(id: string, multi: boolean): void
  onDelete(ids: string[]): void
  onToggleLock(id: string): void
  onToggleVisibility(id: string): void
  onReorder(id: string, direction: 'front' | 'back' | 'forward' | 'backward'): void
}

/**
 * The layer list: every node as a row with thumbnail/kind, lock and visibility
 * toggles, z-order buttons, and delete. Click selects (ctrl/cmd multi-select);
 * group members indent under their group row. Reference LayerPanel semantics,
 * rendered with the DSH theme tokens.
 */
export function LayerPanel(props: LayerPanelProps) {
  const { nodes, selectedNodeIds, onSelect, onDelete, onToggleLock, onToggleVisibility, onReorder } = props
  const [query, setQuery] = useState('')
  const selected = new Set(selectedNodeIds)

  const ordered = [...nodes].sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0))
  const filtered = query.trim().length > 0
    ? ordered.filter(node => (node.title ?? '').toLowerCase().includes(query.trim().toLowerCase()))
    : ordered
  const grouped = filtered.filter(node => node.parentId === undefined)
  const membersByGroup = new Map<string, StudioCanvasNode[]>()
  for (const node of filtered) {
    if (node.parentId === undefined) continue
    const list = membersByGroup.get(node.parentId) ?? []
    list.push(node)
    membersByGroup.set(node.parentId, list)
  }

  const renderRow = (node: StudioCanvasNode, depth: number): React.ReactNode => {
    const isSelected = selected.has(node.id)
    return (
      <div key={node.id}>
        <div
          className={`csLayerRow${isSelected ? ' csLayerRowActive' : ''}`}
          style={{ paddingLeft: `${depth * 14 + 6}px` }}
          onClick={event => { onSelect(node.id, event.ctrlKey || event.metaKey) }}
        >
          <span className="csLayerThumb">
            {node.kind === 'image' && node.url !== undefined
              ? <img src={node.url} alt="" draggable={false} />
              : node.kind === 'video' && node.url !== undefined
                ? <video src={node.url} muted preload="metadata" />
                : <span className="csLayerThumbKind">{KIND_LABELS[node.kind]}</span>}
          </span>
          <span className="csLayerTitle">{node.title ?? KIND_LABELS[node.kind]}</span>
          <span className="csLayerActions">
            <button
              type="button"
              className={node.locked ? 'csLayerAction csLayerActionActive' : 'csLayerAction'}
              title={node.locked ? '解锁' : '锁定'}
              onClick={event => { event.stopPropagation(); onToggleLock(node.id) }}
            >
              {node.locked ? '🔒' : '🔓'}
            </button>
            <button
              type="button"
              className={node.visible === false ? 'csLayerAction' : 'csLayerAction csLayerActionActive'}
              title={node.visible === false ? '显示' : '隐藏'}
              onClick={event => { event.stopPropagation(); onToggleVisibility(node.id) }}
            >
              {node.visible === false ? '👁️‍🗨️' : '👁️'}
            </button>
            <button type="button" className="csLayerAction" title="置顶" onClick={event => { event.stopPropagation(); onReorder(node.id, 'front') }}>↑↑</button>
            <button type="button" className="csLayerAction" title="置底" onClick={event => { event.stopPropagation(); onReorder(node.id, 'back') }}>↓↓</button>
            <button
              type="button"
              className="csLayerAction csLayerActionDanger"
              title="删除"
              onClick={event => { event.stopPropagation(); onDelete([node.id]) }}
            >
              ×
            </button>
          </span>
        </div>
        {(membersByGroup.get(node.id) ?? []).map(member => renderRow(member, depth + 1))}
      </div>
    )
  }

  return (
    <aside className="csLayerPanel">
      <header className="csLayerPanelHeader">
        <span>图层</span>
        <input
          className="csLayerSearch"
          placeholder="搜索图层…"
          value={query}
          onChange={event => { setQuery(event.target.value) }}
        />
      </header>
      <div className="csLayerList">
        {grouped.length === 0 ? <div className="csLayerEmpty">暂无图层</div> : grouped.map(node => renderRow(node, 0))}
      </div>
    </aside>
  )
}