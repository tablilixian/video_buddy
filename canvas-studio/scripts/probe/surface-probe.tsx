import { createElement, useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { StudioCanvasNode } from '../../src/contracts/canvas.js'
import { CanvasSurface } from '../../src/client/canvas/CanvasSurface.js'

/**
 * CanvasSurface 手势探针（CV-167 回归验证工具，不在产品构建内）。
 *
 * 用**真的 CanvasSurface 组件** + 语义与 project-store 逐字一致的迷你 store，
 * 在真实 DOM 上派发合成 PointerEvent，跑「选中 → 拖动 → 点空白 → 再选」的
 * 用户流程，把每步的选中集写进 #result。headless Chrome --dump-dom 采集。
 */

type ProbeNode = StudioCanvasNode

const mkNode = (id: string, x: number, y: number): ProbeNode => ({
  id,
  kind: 'image',
  title: id,
  x,
  y,
  width: 220,
  height: 160,
  sourceIds: [],
  url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
} as ProbeNode)

const initialNodes: ProbeNode[] = [mkNode('A', 100, 100), mkNode('B', 600, 100), mkNode('C', 1100, 100)]

function App(): ReturnType<typeof createElement> {
  const [nodes, setNodes] = useState<ProbeNode[]>(initialNodes)
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 })

  // —— 以下语义逐字对齐 project-store（selectNode / selectNodes / moveNode）——
  const selectNode = useCallback((id: string | null, multi?: boolean): void => {
    setSelectedNodeIds(prev => {
      if (multi === true && id !== null) {
        const roster = new Set(prev)
        if (roster.has(id)) roster.delete(id)
        else roster.add(id)
        return [...roster]
      }
      return id === null ? [] : [id]
    })
  }, [])
  const selectNodes = useCallback((ids: readonly string[]): void => {
    setSelectedNodeIds(prev => {
      const alive = new Set(prev.length >= 0 ? nodes.map(n => n.id) : [])
      return ids.filter(id => alive.has(id))
    })
  }, [nodes])
  const moveNode = useCallback((id: string, x: number, y: number): void => {
    setNodes(prev => prev.map(n => (n.id === id ? { ...n, x, y } : n)))
  }, [])

  const log = useCallback((step: string, detail: unknown): void => {
    const el = document.getElementById('result')
    if (el !== null) el.textContent += `${step}: ${JSON.stringify(detail)}\n`
  }, [])
  window.__probe = { log, setSelectedNodeIds, selectNodes, getState: () => ({ selectedNodeIds, nodes }) }

  return createElement(
    'div',
    { style: { position: 'relative', width: '1400px', height: '900px', overflow: 'hidden' } },
    createElement(CanvasSurface, {
      nodes,
      view,
      onViewChange: (patch: Partial<typeof view>) => { setView(prev => ({ ...prev, ...patch })) },
      selectedNodeId: selectedNodeIds.length === 1 ? selectedNodeIds[0]! : null,
      selectedNodeIds,
      onSelectNode: selectNode,
      onSelectAllNodes: () => { setSelectedNodeIds(nodes.map(n => n.id)) },
      onMoveNode: moveNode,
      onUpdateNode: (id: string, updates: Partial<StudioCanvasNode>) => {
        setNodes(prev => prev.map(n => (n.id === id ? { ...n, ...updates } : n)))
      },
      onBeginEdit: () => {},
      onPersist: () => {},
      onRemoveNodes: () => {},
      onCopy: () => {},
      onPaste: () => {},
      onUndo: () => {},
      onRedo: () => {},
      onLinkLayers: () => {},
      onRename: () => {},
      onNodeTextSubmit: () => {},
      onNodeOpenDetail: () => {},
      onContextMenu: () => {},
      onBlankContextMenu: () => {},
      onRetry: () => {},
      minimapVisible: false,
    }),
  )
}

declare global {
  interface Window {
    __probe?: {
      log(step: string, detail: unknown): void
      setSelectedNodeIds(ids: string[]): void
      selectNodes(ids: readonly string[]): void
      getState(): { selectedNodeIds: string[]; nodes: ProbeNode[] }
    }
  }
}

const container = document.getElementById('root')!
createRoot(container).render(createElement(App))
