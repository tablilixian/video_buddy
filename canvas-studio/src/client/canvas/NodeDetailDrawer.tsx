import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { StudioCanvasNode } from '../../contracts/canvas.js'
import { INSTRUMENTAL_LYRICS } from '../../contracts/canvas.js'
import { canDownloadNode } from '../../canvas-actions.js'
import { generationParamsOf, isReplayable, promptFieldsOf, promptValueOf, withPromptField } from '../../node-params.js'
import { copyTextToClipboard } from '../../clipboard-copy.js'
import { KIND_LABEL as KIND_LABELS, OPERATION_LABELS, kindAccentOf } from './labels.js'
import { clipboardEnv } from './clipboard-env.js'
import { PromptEditor } from './PromptEditor.js'

/** 抽屉高度的下限：再矮就连表头都放不下。 */
const MIN_DRAWER_HEIGHT = 148
/** 抽屉拉高时必须给画布留的高度 —— 抽屉占满整屏就没有「参照」可看了。 */
const MIN_CANVAS_VISIBLE = 180

/** CV-198：复制按钮的三态文案（失败必须说出来，不能停在「复制」上装作没事）。 */
const COPY_STATE_LABELS: Readonly<Record<'idle' | 'ok' | 'fail', string>> = {
  idle: '复制',
  ok: '已复制',
  fail: '复制失败',
}

/**
 * 参数摘要的字段顺序与中文名。只列出**真读得懂**的那几个：把 generationPrompt 的
 * 每个键都摊开是「原始 JSON」那一栏的活（它就在下面，可折叠）。
 * 新增工具带新参数时在这里补一行，不另写一个 if。
 */
const PARAM_READOUTS: ReadonlyArray<{ key: string; label: string; suffix?: string }> = [
  { key: 'aspectRatio', label: '画幅' },
  { key: 'resolution', label: '档位' },
  { key: 'duration', label: '时长', suffix: 's' },
  { key: 'style', label: '风格' },
  { key: 'model', label: '模型' },
  { key: 'bpm', label: 'BPM' },
  { key: 'keyscale', label: '调式' },
  { key: 'language', label: '语言' },
  { key: 'negativePrompt', label: '负向' },
]

/** Props for the node detail drawer. */
export interface NodeDetailDrawerProps {
  node: StudioCanvasNode
  /** 当前项目全部节点：按 Drama filename 反查参考图缩略图。 */
  allNodes: readonly StudioCanvasNode[]
  /** 抽屉高度（px，设备级偏好，由上层持久化）。 */
  height: number
  onHeightChange(height: number): void
  onClose(): void
  onRename(id: string, title: string): void
  onSetOpacity(id: string, opacity: number): void
  onToggleFlip(id: string, axis: 'flipX' | 'flipY'): void
  onToggleLock(id: string): void
  onToggleVisibility(id: string): void
  onReorder(id: string, direction: 'front' | 'back'): void
  onDelete(id: string): void
  /** 节点级重试（同参数重新生成）。 */
  onRetry(id: string): void
  /** 取消运行中的回合（loading 节点）。 */
  onCancel(id: string): void
  /** 更新节点字段（正文 / 参考图角色 / 强度 / 生成参数）。 */
  onUpdateNode(id: string, updates: Partial<StudioCanvasNode>): void
  /** 把该节点作为引用标记插入右侧聊天输入框。 */
  onReferenceToChat(node: StudioCanvasNode): void
  /** CV-020：把节点的图片/视频/音频产物另存到本地。 */
  onDownload(node: StudioCanvasNode): void
}

/**
 * 节点详情抽屉 —— 底部通栏、只占画布宽、底边贴时间轴顶边。
 *
 * ## 为什么从「右上角浮动卡」换成「底部抽屉」
 *
 * 旧面板是 `position: fixed; top: 64px; right: 12px`，与节点坐标**毫无关系**：
 * 节点在哪它都在右上角，离被查看的对象很远，还盖住宿主右栏的对话区。换成画布
 * 内的底部抽屉之后：位置由「画布的下边缘」决定（恒定、可预期），横向空间从
 * 320px 变成整个画布宽 —— 一行能读 60+ 字，提示词终于放得下。
 *
 * ## 信息架构：左身份 / 右内容 / 底操作
 *
 * 旧面板 15 行平铺同权，元信息与编辑项混在一起。这里按「读者要用它干什么」分栏：
 * 左栏只读（身份与变换，扫一眼确认「我选中的是什么」），右栏是可编辑的内容
 * （正文 / 提示词 / 参考图 / 参数），底栏是操作（危险项靠右）。
 */
export function NodeDetailDrawer(props: NodeDetailDrawerProps) {
  const {
    node, allNodes, height, onHeightChange, onClose, onRename, onSetOpacity, onToggleFlip,
    onToggleLock, onToggleVisibility, onReorder, onDelete, onRetry, onCancel, onUpdateNode,
    onReferenceToChat, onDownload,
  } = props
  const rootRef = useRef<HTMLElement>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState(node.title ?? '')
  // CV-198：复制反馈改成三态 —— 此前是布尔，失败时（`.then` 不执行）按钮永远停在
  // 「复制」，用户只会觉得「点了没反应」，而 rejection 还留在控制台里没人看。
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle')
  // 容器（.csCanvasBody）高度 —— 抽屉的上下限都由它推出来，而不是猜窗口尺寸。
  const [containerHeight, setContainerHeight] = useState(0)
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  // CR-073：复制反馈定时器引用（卸载时清理，见下方 effect）。
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
  }, [])

  useLayoutEffect(() => {
    const parent = rootRef.current?.parentElement
    if (parent === undefined || parent === null) return
    const update = (): void => { setContainerHeight(parent.clientHeight) }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(parent)
    return () => { observer.disconnect() }
  }, [])

  const operation = node.operationType !== undefined ? (OPERATION_LABELS[node.operationType] ?? node.operationType) : null
  const generationPrompt = node.generationPrompt !== undefined ? node.generationPrompt : null
  const params = generationParamsOf(node)
  const promptFields = promptFieldsOf(node)
  const canRetry = isReplayable(node) && !node.isLoading

  /** 高度上限：容器高度减去必须留给画布的那一段。 */
  const maxHeight = Math.max(MIN_DRAWER_HEIGHT, containerHeight - MIN_CANVAS_VISIBLE)
  const clampHeight = (value: number): number => Math.min(Math.max(value, MIN_DRAWER_HEIGHT), maxHeight)
  // 渲染值也走同一个 clamp：持久化的高度是**上次**窗口下的合法值，窗口变小后
  // 直接照用会把画布压没。上限的唯一定义就是上面这一处。
  const rendered = clampHeight(height)

  // 按 Drama filename 反查参考图节点：把存储里的文件名还原成可视缩略图，
  // 用户不用对着 ref-a1b2.png 这样的句柄猜用的是哪张图。
  const referenceNames = params === null
    ? []
    : [...new Set([
        typeof params.filename === 'string' ? params.filename : undefined,
        typeof params.styleFilename === 'string' ? params.styleFilename : undefined,
        ...(Array.isArray(params.filenames) ? params.filenames.map(String) : []),
      ].filter((name): name is string => name !== undefined && name.length > 0))]
  const referenceNodes = referenceNames
    .map(name => allNodes.find(candidate => candidate.filename === name))
    .filter((candidate): candidate is StudioCanvasNode => candidate !== undefined)

  const readouts = params === null
    ? []
    : PARAM_READOUTS
      .map(readout => {
        const value = params[readout.key]
        if (typeof value !== 'string' && typeof value !== 'number') return null
        return `${readout.label} ${String(value)}${readout.suffix ?? ''}`
      })
      .filter((text): text is string => text !== null)

  const copyPrompt = (): void => {
    const first = promptFields.length > 0 ? promptValueOf(node, promptFields[0]!.key) : ''
    if (first.length === 0) return
    // CR-073：复制反馈 1.5s 后复位 —— timer 存 ref，卸载时清理，避免面板关闭后
    // 仍对已卸载组件 setState。
    const showFeedback = (state: 'ok' | 'fail'): void => {
      setCopyState(state)
      if (copyTimer.current !== null) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => {
        copyTimer.current = null
        setCopyState('idle')
      }, 1500)
    }
    // CV-198：写入走全仓唯一的那条链路（`clipboardEnv`），成功失败都反馈。
    void copyTextToClipboard(first, clipboardEnv()).then((result) => {
      showFeedback(result.ok ? 'ok' : 'fail')
    })
  }

  const submitTitle = (): void => {
    setEditingTitle(false)
    if (titleInput.trim().length > 0) onRename(node.id, titleInput.trim())
  }

  const formatTime = (value: number): string => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString()
  }

  const resolutionText = (): string => {
    const w = node.mediaWidth
    const h = node.mediaHeight
    return w !== undefined && h !== undefined ? `${w}×${h}` : '未知'
  }

  /** 提示词字段提交：只写回本地字段，**不发生成请求**（要重跑由「重试」负责）。 */
  const commitPrompt = (key: string, next: string): void => {
    const raw = withPromptField(node.generationPrompt, key, next)
    if (raw === null) return
    onUpdateNode(node.id, { generationPrompt: raw })
  }

  const onGripPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    dragRef.current = { startY: event.clientY, startHeight: rendered }
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* 指针已释放 */ }
    event.preventDefault()
  }
  const onGripPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null) return
    // 往上拖 = 变高（屏幕 y 向下增长，所以取 startY - clientY）。
    onHeightChange(clampHeight(drag.startHeight + (drag.startY - event.clientY)))
  }
  const onGripPointerUp = (): void => { dragRef.current = null }

  return (
    // CV-197：类型色彩身份挂在抽屉根上 —— 头部那枚「图片/视频/音频」牌面从它
    // 继承 --cs-kind 着色，与画布卡片、图层行、时间轴 chip 同一份判据。
    // 不给抽屉本体染色：它是玻璃浮层，上色会与「浮层最亮档」的层序语义打架。
    <aside
      className={['csDetailDrawer', kindAccentOf(node.kind)].filter(Boolean).join(' ')}
      ref={rootRef}
      style={{ height: rendered }}
      aria-label="节点详情"
    >
      <div
        className="csDetailDrawerGrip"
        role="separator"
        aria-orientation="horizontal"
        aria-label="拖动调整详情高度"
        title="拖动调整高度"
        onPointerDown={onGripPointerDown}
        onPointerMove={onGripPointerMove}
        onPointerUp={onGripPointerUp}
        onPointerCancel={onGripPointerUp}
      />
      <header className="csDetailDrawerHead">
        <span className="csDetailDrawerKind">{KIND_LABELS[node.kind]}{operation !== null ? ` · ${operation}` : ''}</span>
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
            <button
              type="button"
              className="csDetailDrawerTitle"
              title="点击重命名"
              onClick={() => { setTitleInput(node.title ?? ''); setEditingTitle(true) }}
            >
              {node.title ?? KIND_LABELS[node.kind]}
            </button>
          )}
        <button type="button" className="csDetailDrawerClose" onClick={onClose} aria-label="关闭详情">×</button>
      </header>

      <div className="csDetailDrawerBody">
        {/* ---- 左栏：只读身份与变换 ---- */}
        <section className="csDetailDrawerCol">
          <h3 className="csDetailDrawerColTitle">身份</h3>
          {node.toolName !== undefined && (
            <div className="csDetailRow">
              <span className="csDetailLabel">工具</span>
              <span className="csDetailValue" title={node.toolName}>{node.toolName}</span>
            </div>
          )}
          <div className="csDetailRow">
            <span className="csDetailLabel">创建</span>
            <span className="csDetailValue">{formatTime(node.createdAt)}</span>
          </div>
          {(node.kind === 'image' || node.kind === 'video') && (
            <div className="csDetailRow">
              <span className="csDetailLabel">分辨率</span>
              <span className="csDetailValue">{resolutionText()}</span>
            </div>
          )}
          {node.duration !== undefined && (
            <div className="csDetailRow">
              <span className="csDetailLabel">时长</span>
              <span className="csDetailValue">{node.duration}s</span>
            </div>
          )}
          {node.error !== undefined && (
            <div className="csDetailRow csDetailRowTop">
              <span className="csDetailLabel">错误</span>
              <span className="csDetailError">{node.error}</span>
            </div>
          )}

          <h3 className="csDetailDrawerColTitle">变换</h3>
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
            <span className="csDetailLabel">层级</span>
            <button type="button" className="csDetailButton" onClick={() => { onReorder(node.id, 'front') }}>置顶</button>
            <button type="button" className="csDetailButton" onClick={() => { onReorder(node.id, 'back') }}>置底</button>
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
              onClick={() => { onToggleVisibility(node.id) }}
            >
              {node.visible === false ? '已隐藏' : '可见'}
            </button>
          </div>

          {node.kind === 'image' && (
            <>
              <h3 className="csDetailDrawerColTitle">参考图</h3>
              <div className="csDetailRow">
                <span className="csDetailLabel">标记</span>
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
            </>
          )}
        </section>

        {/* ---- 右栏：内容与生成参数 ---- */}
        <section className="csDetailDrawerCol csDetailDrawerColMain">
          {(node.kind === 'sticky' || node.kind === 'text' || node.kind === 'prompt') && (
            <div className="csDetailBlock">
              <h3 className="csDetailDrawerColTitle">正文</h3>
              {/* CV-001：正文编辑区（key=node.id 保证切换节点时重置草稿）。失焦提交，仅内容变化时写回。
                  CV-241 Q3：带 url 的文字素材 chip 只读预览 —— 正文来自上传文件，改了也不会写回。 */}
              {node.kind === 'text' && node.url !== undefined ? (
                <textarea
                  key={node.id}
                  className="csDetailTextarea"
                  rows={6}
                  value={node.text ?? node.title ?? ''}
                  readOnly
                />
              ) : (
                <textarea
                  key={node.id}
                  className="csDetailTextarea"
                  rows={6}
                  defaultValue={node.text ?? node.title ?? ''}
                  onBlur={event => {
                    const next = event.target.value
                    if (next !== (node.text ?? node.title ?? '')) onUpdateNode(node.id, { text: next })
                  }}
                />
              )}
            </div>
          )}

          {promptFields.length > 0 && (
            <div className="csDetailBlock">
              {promptFields.map(field => (
                <PromptEditor
                  key={field.key}
                  nodeId={node.id}
                  label={field.label}
                  value={promptValueOf(node, field.key)}
                  onCommit={next => { commitPrompt(field.key, next) }}
                  {...(node.isLoading === true ? { disabled: true } : {})}
                />
              ))}
              <div className="csDetailRow">
                <span className="csDetailLabel">提示词</span>
                <div className="csDetailActions">
                  <button type="button" className="csDetailButton" onClick={copyPrompt}>{COPY_STATE_LABELS[copyState]}</button>
                </div>
              </div>
            </div>
          )}

          {referenceNodes.length > 0 && (
            <div className="csDetailBlock">
              <h3 className="csDetailDrawerColTitle">生成时用的参考图</h3>
              <span className="csDetailRefThumbs">
                {referenceNodes.map(ref => (
                  <img
                    key={ref.id}
                    className="csDetailRefThumb"
                    // CR-074：url 缺失时不渲染空 src 破图（刷新后 filename 对不上等）。
                    src={ref.url}
                    alt={ref.title ?? ref.filename ?? ''}
                    title={ref.title ?? ref.filename ?? ''}
                  />
                ))}
              </span>
            </div>
          )}

          {node.kind === 'audio' && node.url !== undefined && (
            <div className="csDetailBlock">
              <h3 className="csDetailDrawerColTitle">试听</h3>
              <audio className="csDetailAudio" src={node.url} controls preload="metadata" />
            </div>
          )}

          {/* CV-130：歌词全文（画布卡片只有一行摘要，这里给完整可读的一份）。
              [Instrumental] 是占位串不是歌词，翻译成人类说法再展示。 */}
          {node.kind === 'audio' && node.lyrics !== undefined && (
            <div className="csDetailBlock">
              <h3 className="csDetailDrawerColTitle">歌词</h3>
              {node.lyrics === INSTRUMENTAL_LYRICS
                ? <span className="csDetailValue">纯器乐（无歌词）</span>
                : <pre className="csDetailPrompt csDetailLyrics">{node.lyrics}</pre>}
            </div>
          )}

          {node.script !== undefined && node.script.length > 0 && (
            <div className="csDetailBlock">
              <h3 className="csDetailDrawerColTitle">文案</h3>
              <pre className="csDetailPrompt">{node.script}</pre>
            </div>
          )}

          {readouts.length > 0 && (
            <div className="csDetailBlock">
              <h3 className="csDetailDrawerColTitle">参数</h3>
              <p className="csDetailReadouts">{readouts.join('　·　')}</p>
            </div>
          )}

          {generationPrompt !== null && (
            <div className="csDetailBlock">
              <details className="csDetailRaw">
                <summary>原始生成参数（JSON）</summary>
                <pre className="csDetailPrompt">{generationPrompt}</pre>
              </details>
            </div>
          )}
        </section>
      </div>

      {/* ---- 底栏：操作（危险项靠右） ---- */}
      <footer className="csDetailDrawerFoot">
        {canRetry && (
          <button type="button" className="csDetailButton" title="用当前保存的参数重新生成一版" onClick={() => { onRetry(node.id) }}>
            重试
          </button>
        )}
        {canDownloadNode(node) && (
          <button type="button" className="csDetailButton" onClick={() => { onDownload(node) }}>下载资产</button>
        )}
        <span className="csDetailFootSpacer" />
        {node.isLoading && (
          <button type="button" className="csDetailButton" onClick={() => { onCancel(node.id) }}>打断</button>
        )}
        <button type="button" className="csDetailButton csDetailButtonDanger" onClick={() => { onDelete(node.id) }}>删除</button>
      </footer>
    </aside>
  )
}
