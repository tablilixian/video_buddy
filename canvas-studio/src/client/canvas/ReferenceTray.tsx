import { useState } from 'react'
import type { StudioCanvasNode } from '../../contracts/canvas.js'
import { kindAccentOf } from './labels.js'

/** 参考角色 → 中文标签（与 Runway 式参考分类对齐）。 */
const ROLE_LABELS: Record<string, string> = {
  image: '构图/通用',
  character: '角色',
  style: '风格',
  frame: '首末帧',
}

/** Props for the reference tray. */
export interface ReferenceTrayProps {
  /** 当前项目标记为参考图的图片节点。 */
  nodes: readonly StudioCanvasNode[]
  /** 更新某参考节点的字段（角色/强度/标记）。 */
  onUpdateNode(id: string, updates: Partial<StudioCanvasNode>): void
  /** 把该节点作为 @ref 引用标记复制到聊天输入框。 */
  onReferenceToChat(node: StudioCanvasNode): void
}

/**
 * 参考托盘（左侧栏，复用画布作为素材库）：列出所有标记为参考图的图片节点，
 * 每项带缩略图、角色 chip、强度滑块、「引用到对话」与「移除」操作。对应
 * Runway 的参考区 + Midjourney 的钉住参考；节点即画布节点，不另开素材库。
 */
export function ReferenceTray(props: ReferenceTrayProps) {
  const { nodes, onUpdateNode, onReferenceToChat } = props
  const [open, setOpen] = useState(true)
  if (nodes.length === 0) return null
  return (
    <section className="csReferenceTray">
      <header className="csReferenceHeader" onClick={() => { setOpen(prev => !prev) }}>
        <span>参考图（{nodes.length}）</span>
        <span className="csReferenceToggle">{open ? '−' : '+'}</span>
      </header>
      {open && (
        <div className="csReferenceList">
          {nodes.map((node) => {
            const role = node.referenceRole ?? 'image'
            return (
              // CV-197：托盘项的左缘 3px 类型色条（图 / 视频 / 音频）。
              <div
                key={node.id}
                className={['csReferenceItem', kindAccentOf(node.kind)].filter(Boolean).join(' ')}
              >
                {node.url !== undefined && (
                  <img className="csReferenceThumb" src={node.url} alt={node.title ?? ''} />
                )}
                <div className="csReferenceMeta">
                  <div className="csReferenceTitleRow">
                    <span className="csReferenceTitle" title={node.title ?? ''}>{node.title ?? '未命名'}</span>
                    <span className="csReferenceChip">{ROLE_LABELS[role] ?? '构图/通用'}</span>
                  </div>
                  <input
                    className="csReferenceRange"
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round((node.referenceStrength ?? 1) * 100)}
                    onChange={event => { onUpdateNode(node.id, { referenceStrength: Number(event.target.value) / 100 }) }}
                  />
                  <div className="csReferenceActions">
                    <button type="button" className="csReferenceButton" onClick={() => { onReferenceToChat(node) }}>
                      引用到对话
                    </button>
                    <button type="button" className="csReferenceButton" onClick={() => { onUpdateNode(node.id, { isReference: false }) }}>
                      移除
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
