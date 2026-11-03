import { useState } from 'react'
import type { StudioCanvasNode } from '../../contracts/canvas.js'
import { kindAccentOf } from './labels.js'

/** 参考角色 → 中文标签（与 Runway 式参考分类对齐；`source` = 用户提供的源参考，REQ-037/CV-405）。 */
const ROLE_LABELS: Record<string, string> = {
  image: '构图/通用',
  character: '角色',
  style: '风格',
  frame: '首末帧',
  source: '源参考',
}

/** 素材四分区（REQ-037/CV-406）：固定顺序，空分区不渲染。 */
const KIND_SECTIONS: ReadonlyArray<{ kind: StudioCanvasNode['kind']; label: string }> = [
  { kind: 'image', label: '图片' },
  { kind: 'video', label: '视频' },
  { kind: 'audio', label: '音频' },
  { kind: 'text', label: '文本' },
]

/** Props for the reference tray. */
export interface ReferenceTrayProps {
  /** 当前项目标记为参考素材的节点（REQ-037/CV-406 起四类全收，不限图片）。 */
  nodes: readonly StudioCanvasNode[]
  /** 更新某参考节点的字段（角色/强度/标记）。 */
  onUpdateNode(id: string, updates: Partial<StudioCanvasNode>): void
  /** 把该节点作为 @ref 引用标记复制到聊天输入框。 */
  onReferenceToChat(node: StudioCanvasNode): void
  /** 查看：视频/音频进播放浮层、图片进预览浮层；文本在托盘内展开，不走此回调。 */
  onOpenNode(node: StudioCanvasNode): void
}

/**
 * 参考素材托盘（左侧栏，复用画布作为素材库）：列出所有标记为参考的节点，
 * 按 图片/视频/音频/文本 四分区展示（REQ-037/CV-406，原「参考图托盘」升级）。
 * 每项带预览（图缩略 / 音视频播放 / 文本展开）、角色 chip、强度滑块、
 * 「引用到对话」与「移除」操作；节点即画布节点，不另开素材库。
 */
export function ReferenceTray(props: ReferenceTrayProps) {
  const { nodes, onUpdateNode, onReferenceToChat, onOpenNode } = props
  const [open, setOpen] = useState(true)
  // 文本项的在托盘内展开态（一次一条；文本不跳浮层，展开即查看）。
  const [expandedTextId, setExpandedTextId] = useState<string | null>(null)
  if (nodes.length === 0) return null
  return (
    <section className="csReferenceTray">
      <header className="csReferenceHeader" onClick={() => { setOpen(prev => !prev) }}>
        <span>参考素材（{nodes.length}）</span>
        <span className="csReferenceToggle">{open ? '−' : '+'}</span>
      </header>
      {open && KIND_SECTIONS.map(({ kind, label }) => {
        const items = nodes.filter(node => node.kind === kind)
        if (items.length === 0) return null
        return (
          <div key={kind} className="csReferenceGroup">
            <div className="csReferenceGroupLabel">{label}（{items.length}）</div>
            <div className="csReferenceList">
              {items.map((node) => {
                const role = node.referenceRole ?? 'image'
                return (
                  // CV-197：托盘项的左缘 3px 类型色条（图 / 视频 / 音频）。
                  <div
                    key={node.id}
                    className={['csReferenceItem', kindAccentOf(node.kind)].filter(Boolean).join(' ')}
                  >
                    {node.kind === 'image' && node.url !== undefined && (
                      <img className="csReferenceThumb" src={node.url} alt={node.title ?? ''} />
                    )}
                    <div className="csReferenceMeta">
                      <div className="csReferenceTitleRow">
                        <span className="csReferenceTitle" title={node.title ?? ''}>{node.title ?? '未命名'}</span>
                        <span className="csReferenceChip">{ROLE_LABELS[role] ?? '构图/通用'}</span>
                      </div>
                      {node.kind === 'text' && typeof node.text === 'string' && node.text !== '' && (
                        <p
                          className={expandedTextId === node.id ? 'csReferenceTextBody is-open' : 'csReferenceTextBody'}
                          onClick={() => { setExpandedTextId(prev => (prev === node.id ? null : node.id)) }}
                          title={expandedTextId === node.id ? '收起' : '展开全文'}
                        >
                          {expandedTextId === node.id ? node.text : node.text.length > 60 ? `${node.text.slice(0, 60)}…` : node.text}
                        </p>
                      )}
                      <input
                        className="csReferenceRange"
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round((node.referenceStrength ?? 1) * 100)}
                        onChange={event => { onUpdateNode(node.id, { referenceStrength: Number(event.target.value) / 100 }) }}
                      />
                      <div className="csReferenceActions">
                        {node.kind !== 'text' && (
                          <button type="button" className="csReferenceButton" onClick={() => { onOpenNode(node) }}>
                            {node.kind === 'video' || node.kind === 'audio' ? '播放' : '查看'}
                          </button>
                        )}
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
          </div>
        )
      })}
    </section>
  )
}
