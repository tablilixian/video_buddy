import { useState } from 'react'
import type { StudioCanvasNode, StudioCanvasNodeKind } from '../../contracts/canvas.js'
import { OPERATION_LABELS } from './CanvasNode.js'

/** Human-readable kind labels for the detail panel. */
const KIND_LABELS: Readonly<Record<StudioCanvasNodeKind, string>> = {
  image: '图片',
  video: '视频',
  sticky: '便签',
  text: '文本',
  prompt: '提示',
  group: '分组',
}

/** 解析后的生成参数（generationPrompt 的 JSON 形态，字段宽松收窄）。 */
interface ParsedGenerationParams {
  prompt?: string
  filename?: string
  filenames?: string[]
  styleFilename?: string
  aspectRatio?: string
  duration?: number
  negativePrompt?: string
}

/**
 * 宽松解析 generationPrompt（节点级重试的回放锚点）。仅用于展示：解析失败
 * （旧数据 / 手改）时返回 null，详情面板回退原始 JSON 展示，不影响重试。
 */
function parseGenerationParams(raw: string | undefined): ParsedGenerationParams | null {
  if (raw === undefined || raw.length === 0) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return {
      ...(typeof parsed.prompt === 'string' && parsed.prompt.length > 0 ? { prompt: parsed.prompt } : {}),
      ...(typeof parsed.filename === 'string' ? { filename: parsed.filename } : {}),
      ...(Array.isArray(parsed.filenames) ? { filenames: parsed.filenames.map(String) } : {}),
      ...(typeof parsed.styleFilename === 'string' ? { styleFilename: parsed.styleFilename } : {}),
      ...(typeof parsed.aspectRatio === 'string' ? { aspectRatio: parsed.aspectRatio } : {}),
      ...(typeof parsed.duration === 'number' ? { duration: parsed.duration } : {}),
      ...(typeof parsed.negativePrompt === 'string' && parsed.negativePrompt.length > 0
        ? { negativePrompt: parsed.negativePrompt }
        : {}),
    }
  } catch {
    return null
  }
}

/** Props for the layer detail panel. */
export interface LayerDetailPanelProps {
  node: StudioCanvasNode
  /** 当前项目全部节点：按 Drama filename 反查参考图缩略图。 */
  allNodes: readonly StudioCanvasNode[]
  onClose(): void
  onRename(id: string, title: string): void
  onSetOpacity(id: string, opacity: number): void
  onToggleFlip(id: string, axis: 'flipX' | 'flipY'): void
  onToggleLock(id: string): void
  onToggleVisibility(id: string, visible: boolean): void
  onReorder(id: string, direction: 'front' | 'back'): void
  onDelete(id: string): void
  /** Node-level retry (agent nodes with generationPrompt). */
  onRetry(id: string): void
  /** Steer the agent with a new prompt (agent nodes). */
  onSteer(id: string, prompt: string): void
  /** Cancel the running turn (loading nodes). */
  onCancel(id: string): void
  /** 更新节点字段（参考图角色/强度/标记）。 */
  onUpdateNode(id: string, updates: Partial<StudioCanvasNode>): void
  /** 把该节点作为 @ref 引用标记复制到聊天输入框。 */
  onReferenceToChat(node: StudioCanvasNode): void
}

/**
 * The layer detail panel: edit the selected node's title, opacity, flip,
 * lock/visibility, z-order, and run node-level generation actions (retry /
 * steer / cancel). Reference LayerDetailPanel semantics, DSH tokens.
 */
export function LayerDetailPanel(props: LayerDetailPanelProps) {
  const { node, allNodes, onClose, onRename, onSetOpacity, onToggleFlip, onToggleLock, onToggleVisibility, onReorder, onDelete, onRetry, onSteer, onCancel, onUpdateNode, onReferenceToChat } = props
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState(node.title ?? '')
  const [steering, setSteering] = useState(false)
  const [steerInput, setSteerInput] = useState('')
  const [copiedPrompt, setCopiedPrompt] = useState(false)

  const isAgent = node.origin === 'agent' && node.toolName !== undefined
  const operation = node.operationType !== undefined ? (OPERATION_LABELS[node.operationType] ?? node.operationType) : null
  const generationPrompt: string | null = node.generationPrompt !== undefined ? node.generationPrompt : null
  const parsedParams = parseGenerationParams(node.generationPrompt)
  // 按 Drama filename 反查参考图节点：把存储里的文件名还原成可视缩略图，
  // 用户不用对着 ref-a1b2.png 这样的句柄猜用的是哪张图。
  const referenceNodes = parsedParams === null
    ? []
    : [...new Set([
        parsedParams.filename,
        parsedParams.styleFilename,
        ...(parsedParams.filenames ?? []),
      ].filter((name): name is string => name !== undefined && name.length > 0))]
      .map((name) => allNodes.find((candidate) => candidate.filename === name))
      .filter((candidate): candidate is StudioCanvasNode => candidate !== undefined)

  const copyPrompt = (): void => {
    if (parsedParams?.prompt === undefined) return
    void navigator.clipboard?.writeText(parsedParams.prompt).then(() => {
      setCopiedPrompt(true)
      setTimeout(() => { setCopiedPrompt(false) }, 1500)
    })
  }

  /** 媒体原始分辨率文本（mediaWidth/Height 为真实产物分辨率；缺失显示未知）。 */
  const resolutionText = (): string => {
    const w = node.mediaWidth
    const h = node.mediaHeight
    return w !== undefined && h !== undefined ? `${w}×${h}` : '未知'
  }

  const submitTitle = (): void => {
    setEditingTitle(false)
    if (titleInput.trim().length > 0) onRename(node.id, titleInput.trim())
  }

  const submitSteer = (): void => {
    setSteering(false)
    if (steerInput.trim().length > 0) onSteer(node.id, steerInput.trim())
  }

  const formatTime = (value: number): string => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString()
  }

  return (
    <aside className="csDetailPanel" onClick={event => { event.stopPropagation() }}>
      <header className="csDetailPanelHeader">
        <span>节点属性</span>
        <button type="button" className="csDetailPanelClose" onClick={onClose}>×</button>
      </header>
      <div className="csDetailPanelBody">
        <div className="csDetailRow">
          <span className="csDetailLabel">标题</span>
          {editingTitle
            ? (
              <input
                className="csDetailInput"
                value={titleInput}
                autoFocus
                onChange={event => { setTitleInput(event.target.value) }}
                onBlur={submitTitle}
                onKeyDown={event => {
                  if (event.key === 'Enter') submitTitle()
                  if (event.key === 'Escape') setEditingTitle(false)
                }}
              />
            )
            : (
              <span className="csDetailValue csDetailValueClickable" onClick={() => { setTitleInput(node.title ?? ''); setEditingTitle(true) }}>
                {node.title ?? KIND_LABELS[node.kind]}
              </span>
            )}
        </div>
        <div className="csDetailRow">
          <span className="csDetailLabel">类型</span>
          <span className="csDetailValue">{KIND_LABELS[node.kind]}{operation !== null ? ` · ${operation}` : ''}</span>
        </div>
        {node.toolName !== undefined && (
          <div className="csDetailRow">
            <span className="csDetailLabel">工具</span>
            <span className="csDetailValue">{node.toolName}</span>
          </div>
        )}
        {node.duration !== undefined && (
          <div className="csDetailRow">
            <span className="csDetailLabel">时长</span>
            <span className="csDetailValue">{node.duration}s</span>
          </div>
        )}
        {(node.kind === 'image' || node.kind === 'video') && (
          <div className="csDetailRow">
            <span className="csDetailLabel">分辨率</span>
            <span className="csDetailValue">{resolutionText()}</span>
          </div>
        )}
        {node.script !== undefined && node.script.length > 0 && (
          <div className="csDetailRow">
            <span className="csDetailLabel">文案</span>
            <pre className="csDetailPrompt">{node.script}</pre>
          </div>
        )}
        <div className="csDetailRow">
          <span className="csDetailLabel">创建时间</span>
          <span className="csDetailValue">{formatTime(node.createdAt)}</span>
        </div>
        <div className="csDetailRow">
          <span className="csDetailLabel">透明度</span>
          <input
            className="csDetailRange"
            type="range"
            min={0}
            max={100}
            value={Math.round((node.opacity ?? 1) * 100)}
            onChange={event => { onSetOpacity(node.id, Number(event.target.value) / 100) }}
          />
          <span className="csDetailValue">{Math.round((node.opacity ?? 1) * 100)}%</span>
        </div>
        <div className="csDetailRow">
          <span className="csDetailLabel">镜像</span>
          <button
            type="button"
            className={node.flipX ? 'csDetailButton csDetailButtonActive' : 'csDetailButton'}
            onClick={() => { onToggleFlip(node.id, 'flipX') }}
          >
            水平
          </button>
          <button
            type="button"
            className={node.flipY ? 'csDetailButton csDetailButtonActive' : 'csDetailButton'}
            onClick={() => { onToggleFlip(node.id, 'flipY') }}
          >
            垂直
          </button>
        </div>
        <div className="csDetailRow">
          <span className="csDetailLabel">锁定 / 可见</span>
          <button
            type="button"
            className={node.locked ? 'csDetailButton csDetailButtonActive' : 'csDetailButton'}
            onClick={() => { onToggleLock(node.id) }}
          >
            {node.locked ? '已锁定' : '锁定'}
          </button>
          <button
            type="button"
            className={node.visible === false ? 'csDetailButton' : 'csDetailButton csDetailButtonActive'}
            onClick={() => { onToggleVisibility(node.id, node.visible === false) }}
          >
            {node.visible === false ? '已隐藏' : '可见'}
          </button>
        </div>
        <div className="csDetailRow">
          <span className="csDetailLabel">层级</span>
          <button type="button" className="csDetailButton" onClick={() => { onReorder(node.id, 'front') }}>置顶</button>
          <button type="button" className="csDetailButton" onClick={() => { onReorder(node.id, 'back') }}>置底</button>
        </div>
        {node.kind === 'image' && (
          <div className="csDetailSection">
            <div className="csDetailRow">
              <span className="csDetailLabel">参考图</span>
              <button
                type="button"
                className={node.isReference ? 'csDetailButton csDetailButtonActive' : 'csDetailButton'}
                onClick={() => { onUpdateNode(node.id, { isReference: !node.isReference }) }}
              >
                {node.isReference ? '已标记' : '标记为参考'}
              </button>
              <button type="button" className="csDetailButton" onClick={() => { onReferenceToChat(node) }}>
                引用到对话
              </button>
            </div>
            {node.isReference && (
              <>
                <div className="csDetailRow">
                  <span className="csDetailLabel">角色</span>
                  <select
                    className="csDetailSelect"
                    value={node.referenceRole ?? 'image'}
                    onChange={event => { onUpdateNode(node.id, { referenceRole: event.target.value as 'image' | 'character' | 'style' | 'frame' }) }}
                  >
                    <option value="image">构图/通用</option>
                    <option value="character">角色</option>
                    <option value="style">风格</option>
                    <option value="frame">首末帧</option>
                  </select>
                </div>
                <div className="csDetailRow">
                  <span className="csDetailLabel">强度</span>
                  <input
                    className="csDetailRange"
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round((node.referenceStrength ?? 1) * 100)}
                    onChange={event => { onUpdateNode(node.id, { referenceStrength: Number(event.target.value) / 100 }) }}
                  />
                  <span className="csDetailValue">{Math.round((node.referenceStrength ?? 1) * 100)}%</span>
                </div>
              </>
            )}
          </div>
        )}
        {generationPrompt !== null && (
          <div className="csDetailSection">
            {parsedParams?.prompt !== undefined && (
              <div className="csDetailRow">
                <span className="csDetailLabel">提示词</span>
                <pre className="csDetailPrompt">{parsedParams.prompt}</pre>
                <button type="button" className="csDetailButton" onClick={copyPrompt}>{copiedPrompt ? '已复制' : '复制'}</button>
              </div>
            )}
            {referenceNodes.length > 0 && (
              <div className="csDetailRow">
                <span className="csDetailLabel">参考图</span>
                <span className="csDetailRefThumbs">
                  {referenceNodes.map((ref) => (
                    <img
                      key={ref.id}
                      className="csDetailRefThumb"
                      src={ref.url ?? ''}
                      alt={ref.title ?? ref.filename ?? ''}
                      title={ref.title ?? ref.filename ?? ''}
                    />
                  ))}
                </span>
              </div>
            )}
            {(parsedParams?.aspectRatio !== undefined || parsedParams?.duration !== undefined || parsedParams?.negativePrompt !== undefined) && (
              <div className="csDetailRow">
                <span className="csDetailLabel">参数</span>
                <span className="csDetailValue">
                  {[
                    parsedParams?.aspectRatio,
                    parsedParams?.duration !== undefined ? `${parsedParams.duration}s` : undefined,
                    parsedParams?.negativePrompt !== undefined ? `负向：${parsedParams.negativePrompt}` : undefined,
                  ].filter(Boolean).join(' · ')}
                </span>
              </div>
            )}
            <div className="csDetailRow">
              <span className="csDetailLabel">生成参数</span>
              <details className="csDetailRaw">
                <summary>原始 JSON</summary>
                <pre className="csDetailPrompt">{generationPrompt}</pre>
              </details>
            </div>
          </div>
        )}
        {node.error !== undefined && (
          <div className="csDetailRow">
            <span className="csDetailLabel">错误</span>
            <span className="csDetailError">{node.error}</span>
          </div>
        )}
        <div className="csDetailRow">
          <span className="csDetailLabel">操作</span>
          <div className="csDetailActions">
            {node.isLoading
              ? <button type="button" className="csDetailButton" onClick={() => { onCancel(node.id) }}>打断</button>
              : null}
            {isAgent && generationPrompt !== null && !node.isLoading
              ? (
                <>
                  <button type="button" className="csDetailButton" onClick={() => { onRetry(node.id) }}>重试</button>
                  <button type="button" className="csDetailButton" onClick={() => { setSteerInput(parsedParams?.prompt ?? ''); setSteering(true) }}>修改提示词</button>
                </>
              )
              : null}
            <button type="button" className="csDetailButton csDetailButtonDanger" onClick={() => { onDelete(node.id) }}>删除</button>
          </div>
        </div>
      </div>
      {steering && (
        <div className="csDetailSteer">
          <input
            className="csDetailInput"
            placeholder="新的提示词…（沿用原参考图重新生成）"
            value={steerInput}
            autoFocus
            onChange={event => { setSteerInput(event.target.value) }}
            onKeyDown={event => {
              if (event.key === 'Enter') submitSteer()
              if (event.key === 'Escape') setSteering(false)
            }}
          />
          <div className="csDetailActions">
            <button type="button" className="csDetailButton" onClick={submitSteer}>提交</button>
            <button type="button" className="csDetailButton" onClick={() => { setSteering(false) }}>取消</button>
          </div>
        </div>
      )}
    </aside>
  )
}