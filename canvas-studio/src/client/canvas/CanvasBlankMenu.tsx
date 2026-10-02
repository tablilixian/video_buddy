import { forwardRef } from 'react'
import type { ReactNode } from 'react'

/**
 * CV-016：右键画布空白处的菜单 —— 在光标处新建便签/文本/提示、粘贴、适配视野。
 *
 * 与节点右键菜单同构：forwardRef 根元素挂 ref，配合 StudioFrame 的全局
 * mousedown 监听（命中菜单内部放行，见 `shouldKeepMenuOpen`）。
 */
export interface CanvasBlankMenuProps {
  /** 屏幕坐标（定位菜单）。 */
  x: number
  y: number
  /** 光标处的画布世界坐标（新建节点的落点）。 */
  worldX: number
  worldY: number
  onClose(): void
  /** 在光标处新建节点。 */
  onCreateNode(kind: 'sticky' | 'text' | 'prompt'): void
  /** 粘贴剪贴板节点。 */
  onPaste(): void
  /** 适配视野（fitToContent）。 */
  onFit(): void
}

export const CanvasBlankMenu = forwardRef<HTMLDivElement, CanvasBlankMenuProps>(function CanvasBlankMenu(
  props,
  ref,
) {
  const { x, y, onClose, onCreateNode, onPaste, onFit } = props
  const run = (action: () => void): void => {
    onClose()
    action()
  }
  const item = (label: string, action: () => void): ReactNode => (
    <button type="button" className="csMenuAction" onClick={() => { run(action) }}>
      {label}
    </button>
  )
  return (
    <div
      ref={ref}
      className="csContextMenu csBlankMenu"
      style={{ left: x, top: y }}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation() }}
    >
      {item('在此新建便签', () => { onCreateNode('sticky') })}
      {item('在此新建文本', () => { onCreateNode('text') })}
      {item('在此新建提示', () => { onCreateNode('prompt') })}
      {item('粘贴', () => { onPaste() })}
      {item('适配视野', () => { onFit() })}
    </div>
  )
})

/**
 * R-P0-12：拖线落到空白处的「新建节点并连线」菜单——与 CanvasBlankMenu 同构
 * （forwardRef + shouldKeepMenuOpen 全局 mousedown 协议），新建的节点自动
 * 连到拖线起点（store addNode 的 sourceIds）。
 */
export interface CanvasEdgeCreateMenuProps {
  x: number
  y: number
  onClose(): void
  /** 在落点新建指定类型节点，并连到拖线起点。 */
  onCreateNode(kind: 'sticky' | 'text' | 'prompt'): void
}

export const CanvasEdgeCreateMenu = forwardRef<HTMLDivElement, CanvasEdgeCreateMenuProps>(function CanvasEdgeCreateMenu(
  props,
  ref,
) {
  const { x, y, onClose, onCreateNode } = props
  const run = (action: () => void): void => {
    onClose()
    action()
  }
  const item = (label: string, action: () => void): ReactNode => (
    <button type="button" className="csMenuAction" onClick={() => { run(action) }}>
      {label}
    </button>
  )
  return (
    <div
      ref={ref}
      className="csContextMenu csBlankMenu"
      style={{ left: x, top: y }}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation() }}
    >
      <div className="csMenuAction" style={{ cursor: 'default', opacity: 0.6 }}>新建节点并连到起点：</div>
      {item('文本卡', () => { onCreateNode('text') })}
      {item('提示卡', () => { onCreateNode('prompt') })}
      {item('便签', () => { onCreateNode('sticky') })}
    </div>
  )
})
