import { useState } from 'react'
import type { StudioCanvasNode } from '../../contracts/canvas.js'
import { KIND_LABEL as KIND_LABELS } from './labels.js'

/** 按类型选择的档位定义（框选退役后的替代品，2026-09-12 拍板）。 */
interface TypeFilter {
  value: string
  label: string
  match(node: StudioCanvasNode): boolean
}

const TYPE_FILTERS: readonly TypeFilter[] = [
  // 参考图优先于图片档：isReference 的图片归「参考图」，不重复计入「图片」。
  { value: 'reference', label: '参考图', match: node => node.isReference === true },
  { value: 'image', label: '图片', match: node => node.kind === 'image' && node.isReference !== true },
  { value: 'video', label: '视频', match: node => node.kind === 'video' },
  { value: 'text', label: '文本 / 便签', match: node => node.kind === 'sticky' || node.kind === 'prompt' },
  { value: 'audio', label: '音频', match: node => node.kind === 'audio' },
]

/** Props for the layer list panel. */
export interface LayerPanelProps {
  nodes: readonly StudioCanvasNode[]
  selectedNodeIds: readonly string[]
  onSelect(id: string, multi: boolean): void
  /** 按类型 / 反选 / 清除：传入的 id 集合**整体替换**当前选区（走 store.selectNodes）。 */
  onSelectIds(ids: readonly string[]): void
  onDelete(ids: string[]): void
  onToggleLock(id: string): void
  onToggleVisibility(id: string): void
  onReorder(id: string, direction: 'front' | 'back' | 'forward' | 'backward'): void
}

/**
 * The layer list: every node as a row with thumbnail/kind, lock and visibility
 * toggles, z-order buttons, and delete. Click selects (ctrl/cmd multi-select);
 * group members indent under their group row. The header carries type-based
 * selection (marquee box-select was retired) plus invert/clear. Rendered with
 * the DSH theme tokens.
 */
export function LayerPanel(props: LayerPanelProps) {
  const { nodes, selectedNodeIds, onSelect, onSelectIds, onDelete, onToggleLock, onToggleVisibility, onReorder } = props
  const [query, setQuery] = useState('')
  const [typeValue, setTypeValue] = useState('')
  const selected = new Set(selectedNodeIds)

  const ordered = [...nodes].sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0))
  // 批量选择只在可见节点上进行 —— 隐藏图层被「全选」悄悄圈进来再被批量删除
  // 是用户感知不到的事故源。
  const selectable = ordered.filter(node => node.visible !== false)
  const selectType = (value: string): void => {
    setTypeValue('')
    if (value === 'all') {
      onSelectIds(selectable.map(node => node.id))
      return
    }
    const filter = TYPE_FILTERS.find(candidate => candidate.value === value)
    if (filter === undefined) return
    onSelectIds(selectable.filter(node => filter.match(node)).map(node => node.id))
  }
  const invertSelection = (): void => {
    onSelectIds(selectable.filter(node => !selected.has(node.id)).map(node => node.id))
  }
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
                : node.kind === 'audio' && node.url !== undefined
                  ? <span className="csLayerThumbKind csLayerThumbAudio">♪</span>
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
      <div className="csLayerQuickSelect">
        <select
          className="csLayerTypeSelect"
          value={typeValue}
          onChange={event => { selectType(event.target.value) }}
          title="按类型批量选中画布节点"
        >
          <option value="" disabled>按类型选择…</option>
          <option value="all">全部节点</option>
          {TYPE_FILTERS.map(filter => (
            <option key={filter.value} value={filter.value}>{filter.label}</option>
          ))}
        </select>
        <button type="button" className="csLayerAction" title="反选（可见图层内）" onClick={invertSelection}>反选</button>
        <button type="button" className="csLayerAction" title="清除选择" onClick={() => { onSelectIds([]) }}>清除</button>
      </div>
      <div className="csLayerList">
        {grouped.length === 0 ? <div className="csLayerEmpty">暂无图层</div> : grouped.map(node => renderRow(node, 0))}
      </div>
    </aside>
  )
}