import { memo, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { StudioCanvasNode } from '../../contracts/canvas.js'
import { INSTRUMENTAL_LYRICS, AUDIO_COMPOSITION_HINTS, AUDIO_COMPOSITION_LABELS } from '../../contracts/canvas.js'
import { canRetryNode } from '../../canvas-actions.js'
import { formatMediaDuration } from '../../canvas-aspect.js'
import { isComposeProduct } from '../../shot-versions.js'
import { productLabelOf } from '../../workflow-stage.js'
import { headTitleOf, declaredReadingsOf } from '../../node-presentation.js'
import { KIND_LABEL, REFERENCE_ROLE_SHORT } from './labels.js'
import { useWaveBars } from '../use-waveform.js'

/**
 * Tool names for the transient (loading) node titles.
 *
 * `inpaint` 仅为**历史节点**保留：该工具已于 2026-09-11 删除，老项目里由它生成
 * 的节点仍在画布上，重试时要能显示正确的加载文案。新节点不会再产生这个 toolName。
 */
const TOOL_TITLES: Readonly<Record<string, string>> = {
  image_generate: '生成图片中…',
  character_generate: '生成角色立绘中…',
  inpaint: '图像修复中…',
  video_generate: '生成视频中…',
  video_composite: '合成视频中…',
}

/** CV-010：超过该秒数认为「可能卡住」，overlay 追加可打断提示。 */
const LOADING_SLOW_THRESHOLD = 180

/** CV-082：hover 预览启动延迟（ms）——快速扫过多个视频时不 play/pause 抖动。 */
const HOVER_PREVIEW_DELAY = 150

/** CR-067：系统减少动效偏好，模块加载时计算一次（会话中极少变化；此前每渲染查 matchMedia）。 */
const prefersReducedMotion = typeof window !== 'undefined'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** CV-082：全画布同一时刻只允许一个 hover 播放的 video 元素（模块级登记）。 */
let activeHoverVideo: HTMLVideoElement | null = null

/** CV-128：全画布同一时刻只允许一个音频在响（模块级登记，显式点击播放时互停）。 */
let activeAudioEl: HTMLAudioElement | null = null
/** CV-128：音频波形条数量（高度由节点 id 确定性派生，见 waveBars）。 */
const AUDIO_WAVE_BARS = 28

/**
 * CR-066：全局共享的 1s ticker——所有 loading 节点订阅同一个定时器，避免每个
 * loading 节点各起一个 setInterval + 每秒各重渲染一次（批量生成时 N 个定时器）。
 * 监听器归零时自动停表。
 */
const loadingTicker = (() => {
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setInterval> | null = null
  const stopIfEmpty = (): void => {
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
  return {
    subscribe(fn: () => void): () => void {
      listeners.add(fn)
      if (timer === null) timer = setInterval(() => { for (const l of [...listeners]) l() }, 1000)
      return () => { listeners.delete(fn); stopIfEmpty() }
    },
  }
})()

/** Resize corners (grid of 9, center omitted). */
const RESIZE_CORNERS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type ResizeCorner = typeof RESIZE_CORNERS[number]

/** Props for a single canvas node box. */
export interface CanvasNodeProps {
  node: StudioCanvasNode
  selected: boolean
  /** CV-089：主被拖节点标记 —— 仅在拖动中被按下那个节点为 true；
   * 多选拖拽时区分「主」与「随从」成员，给主节点更明显的视觉。 */
  primary?: boolean
  /**
   * DD-03：血缘聚光生效时，非血缘节点为 true —— 该节点交给 `.csNodeDimmed`
   * 压暗。判定口径在 `src/canvas-lineage.ts`（唯一实现），本组件只负责上色。
   */
  dimmed?: boolean
  /**
   * C6：框选**进行中**的实时命中预览 —— 该节点与框选矩形相交但尚未松手。
   * 判定口径在 `src/canvas-geometry.ts` 的 `marqueeHitIds`（与松手落选同一份），
   * 本组件只负责上色（`.csNodeHit` 轻 accent 描边）。
   */
  hitPreview?: boolean
  /**
   * C2：该片段在**成片序列**里的序号（1 起）。口径与底部时间轴同源 —— 都由
   * `src/shot-versions.ts` 的 `isShotClip` 筛出、按 `deriveTimelineOrder` 的顺序
   * 数号。undefined = 这个节点不进成片序列（关键帧 / 参考图 / 文案 / 音频 /
   * 已作废版本），不显示镜号 chip。
   *
   * 为什么不给每张卡都编号：产品里已有的两套编号都不可替代 ——
   * 标题里的「分镜 N」来自分镜卡、由生成血缘决定；时间轴上的序号是成片顺序、
   * 可被拖拽重排。再发明一套「按阶段数」的序位，会让同一张卡上出现三个
   * 互不相干的数字。镜号 chip 只回答一个问题：**它排在成片的第几段**。
   */
  shotIndex?: number
  /** Begin a drag (also selects; multi-select via ctrl/cmd). */
  onNodePointerDown(event: React.PointerEvent, node: StudioCanvasNode): void
  /** Begin a resize gesture. */
  onResizePointerDown(event: React.PointerEvent, node: StudioCanvasNode, corner: ResizeCorner): void
  /** Begin a manual connection drag (S6). */
  onLinkPointerDown(event: React.PointerEvent, node: StudioCanvasNode): void
  /** Commit an inline rename. */
  onRenameSubmit(id: string, title: string): void
  /** CV-001：提交文本类节点（sticky/text/prompt）的内联正文编辑。 */
  onTextSubmit(id: string, text: string): void
  /** 双击媒体类节点：打开详情 / 编辑面板（D1 方案 A：文本类双击=内联编辑）。 */
  onOpenDetail(node: StudioCanvasNode): void
  /** CV-044：双击视频节点 —— 打开固定尺寸播放浮层（替代原生双击全屏）。 */
  onOpenPlayback?(node: StudioCanvasNode): void
  /** CV-044 扩展：双击图片节点 —— 打开大图预览浮层（替代打开详情面板）。 */
  onOpenPreview?(node: StudioCanvasNode): void
  /** Request the context menu at screen coordinates. */
  onContextMenu(node: StudioCanvasNode, clientX: number, clientY: number): void
  /** CV-018：失败节点就地重试（重放同参数生成）。 */
  onRetry(id: string): void
  /**
   * CV-013/029：媒体加载后上报真实宽高（总是上报；分辨率回填与框比例校正
   * 的决策在 frame 侧统一处理）。加载失败（无真实尺寸）不上报。
   */
  onMediaNatural?(id: string, naturalWidth: number, naturalHeight: number): void
}

/** True when a pointer-down target is an interactive element (no drag). */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.closest('textarea, input, button, select, a, [contenteditable="true"]') !== null
}

/**
 * One canvas node: media box or text annotation, placed at its canvas-space
 * coordinates. The surface owns pan/zoom/drag/resize gestures; this component
 * is presentational and reports pointer-downs with the intended gesture.
 * Visual state follows the reference LayerData semantics: locked (no drag),
 * loading overlay, error badge, opacity, flipX/flipY (media only), hidden
 * nodes are filtered by the surface.
 */
export function CanvasNodeInner(props: CanvasNodeProps) {
  const { node, selected, primary = false, dimmed = false, hitPreview = false, shotIndex, onNodePointerDown, onResizePointerDown, onLinkPointerDown, onRenameSubmit, onTextSubmit, onOpenDetail, onOpenPlayback, onOpenPreview, onContextMenu, onRetry, onMediaNatural } = props
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  // CV-001：文本类节点双击进入内联正文编辑（失焦/Enter 提交，Escape 取消）。
  const [editingBody, setEditingBody] = useState(false)
  const [bodyInput, setBodyInput] = useState('')
  // 媒体加载失败兜底（验收反馈的「黑图」：URL 失效/产物损坏时不再静默黑块）。
  const [mediaFailed, setMediaFailed] = useState(false)
  // CV-083：视频时长角标（loadedmetadata 现算显示，不落盘——重载后重新
  // 读取 metadata 时长自然恢复，省一条契约字段）。
  const [durationLabel, setDurationLabel] = useState<string | null>(null)
  // CV-089：媒体真实分辨率（视频 = videoWidth/Height，图片 = naturalWidth/Height）。
  // 加载失败（无尺寸）时不显示分辨率角标。
  const [mediaDims, setMediaDims] = useState<{ width: number; height: number } | null>(null)
  // CV-082：hover 自动播放（muted + loop）。videoRef 持有元素；hoverTimer
  // 承载 150ms 启动延迟；卸载/离开时统一 stopHoverPreview 清理。
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const hoverTimer = useRef<number | null>(null)
  // CV-128：音频节点就地播放（<audio> + 自绘播放按钮）。音频不做 hover 自动
  // 播放（声音突然响起体验差），改为显式点击播放；全画布同时只允许一个在响。
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // CV-130：进度条可拖动 —— 需要指针横坐标 → 秒数的换算基准，故进度条自身要 ref
  // （与 VideoPlayerModal 同款 pointer capture 手势）。audioDuration 用于换算与
  // aria-valuemax；拖动期间置 seeking 标志，避免 timeupdate 覆写手势位置。
  const audioProgressRef = useRef<HTMLDivElement | null>(null)
  const audioSeekingRef = useRef(false)
  const [audioPlaying, setAudioPlaying] = useState(false)
  const [audioProgress, setAudioProgress] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  const isAudio = node.kind === 'audio'
  // C3：波形条走统一出口 useWaveBars —— 先按节点 id 确定性降级（CV-128：
  // 同一节点每次渲染一致），再异步向 Host 要真包络覆盖。旧的两套伪随机公式
  // 已消灭（另一套在 AudioPlayerModal，同样已收口）。
  const waveBars = useWaveBars(isAudio ? node.url : undefined, AUDIO_WAVE_BARS)
  // CV-010：loading 节点已耗时计时（以节点创建时刻为起点，每秒跳动）。
  // CR-066：订阅全局共享 ticker，不再每节点各起一个 setInterval。
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (node.isLoading !== true) return
    setNow(Date.now())
    return loadingTicker.subscribe(() => { setNow(Date.now()) })
  }, [node.isLoading])

  // CV-082：可 hover 预览的判定（loading/失败/错误节点不播；系统偏好减少
  // 动效时不自动播——这是展示增强，不是功能必需）。
  const canHoverPreview = node.kind === 'video' && node.url !== undefined && !mediaFailed
    && node.isLoading !== true && node.error === undefined

  const stopHoverPreview = (): void => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
    const el = videoRef.current
    if (el !== null && !el.paused) {
      el.pause()
      el.currentTime = 0
    }
    if (el !== null && activeHoverVideo === el) activeHoverVideo = null
  }

  const handleVideoEnter = (): void => {
    if (!canHoverPreview || prefersReducedMotion) return
    if (hoverTimer.current !== null) return
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null
      const el = videoRef.current
      if (el === null) return
      // 单实例约束：上一个 hover 播放的元素先停。
      if (activeHoverVideo !== null && activeHoverVideo !== el) {
        activeHoverVideo.pause()
        activeHoverVideo.currentTime = 0
      }
      activeHoverVideo = el
      el.muted = true
      el.loop = true
      el.play().catch(() => { /* muted 自动播放被拒绝时静默（保持缩略图） */ })
    }, HOVER_PREVIEW_DELAY)
  }

  // 卸载时清理（节点删除/隐藏时若正在播放必须停掉，否则声音/解码泄漏）。
  useEffect(() => { return () => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current)
    const v = videoRef.current
    if (v !== null && !v.paused) v.pause()
    if (v !== null && activeHoverVideo === v) activeHoverVideo = null
    const a = audioRef.current
    if (a !== null && !a.paused) a.pause()
    if (a !== null && activeAudioEl === a) activeAudioEl = null
  } }, [])

  // CV-128：音频显式点击播放（不 hover 自动播放，避免声音突然响起）。
  // 全画布单实例：播放前先把其它正在响的音频停下。
  const handleAudioToggle = (): void => {
    const el = audioRef.current
    if (el === null) return
    if (!el.paused) {
      el.pause()
      return
    }
    if (activeAudioEl !== null && activeAudioEl !== el) activeAudioEl.pause()
    activeAudioEl = el
    el.play().catch(() => { /* 自动播放被拒时静默（保持波形/按钮原状） */ })
  }

  // CV-130：按指针横坐标 seek（pointer capture，拖出条外仍跟踪）。置 seeking
  // 标志让 timeupdate 让位给手势，否则拖到一半会被回放位置拽回去。
  const seekAudioToClientX = (clientX: number): void => {
    const el = audioRef.current
    const bar = audioProgressRef.current
    if (el === null || bar === null || audioDuration <= 0) return
    const rect = bar.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    el.currentTime = ratio * audioDuration
    setAudioProgress(ratio)
  }

  // CV-130：歌词摘要。卡片只有一行位置 → 取首个「非结构标记」的歌词行；
  // [Instrumental] 是占位串而非歌词，不能原样展示给用户。
  const audioLyrics = node.lyrics?.trim() ?? ''
  const lyricsIsInstrumental = audioLyrics.length === 0 || audioLyrics === INSTRUMENTAL_LYRICS
  const lyricsHeadline = lyricsIsInstrumental
    ? ''
    : (() => {
        const lines = audioLyrics.split('\n').map(line => line.trim()).filter(line => line.length > 0)
        return lines.find(line => !line.startsWith('[')) ?? lines[0] ?? ''
      })()

  // CV-128：订阅音频元素事件驱动进度条与按钮状态（timeupdate/ended/play/pause/
  // loadedmetadata）。loadedmetadata 现算时长角标（与视频同理，不落盘）。
  useEffect(() => {
    const el = audioRef.current
    if (el === null) return
    // CV-130：拖动进度期间不让 timeupdate 覆盖手势位置（seek 语义）。
    const onTime = (): void => {
      if (audioSeekingRef.current) return
      if (el.duration > 0) setAudioProgress(el.currentTime / el.duration)
    }
    const onEnded = (): void => { setAudioPlaying(false); setAudioProgress(0); if (activeAudioEl === el) activeAudioEl = null }
    const onPlay = (): void => setAudioPlaying(true)
    const onPause = (): void => setAudioPlaying(false)
    const onMeta = (): void => {
      if (!Number.isFinite(el.duration)) return
      setDurationLabel(formatMediaDuration(el.duration))
      setAudioDuration(el.duration)
    }
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('ended', onEnded)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('loadedmetadata', onMeta)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('ended', onEnded)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('loadedmetadata', onMeta)
    }
  }, [node.id])

  // CR-068：canHoverPreview 翻假（媒体加载失败/节点报错/进入 loading）时取消
  // 已排的 hover 播放 timer——否则到点仍会对已失败的媒体意外 play。
  useEffect(() => {
    if (!canHoverPreview) stopHoverPreview()
  }, [canHoverPreview])

  const isMedia = node.kind === 'image' || node.kind === 'video'
  const isGroup = node.kind === 'group'
  const opacity = node.opacity ?? 1
  // CV-108：失效版本（被新版取代 / 手动作废）——灰显 + 角标，但仍留在画布上可回溯、可恢复。
  const retired = node.supersededBy !== undefined || node.retired === true
  /* C10：镜头条的头 / 脚。
     位置语义从「四角里挑一个」改成**固定两行**：
       头部 = 「这是什么产物」：类型标签 + 标题 + 身份（镜号 / 版本 / 锁 / 失效）
       脚部 = 「读什么数」    ：左读数（音轨构成 / 时长 / 分辨率 / 声明时长 / 字数）
                              右素材角色（金色书签）
     为什么拆成一组布尔量而不是把条件散在 JSX 里：「这条行要不要渲染」与
     「里面有几枚牌面」是两件事，混着写很容易出现「行渲染了但是空的」。
     **脚部永远渲染**（非分组节点）：它的 22px 是几何契约的一部分
     （canvas-aspect 的 NODE_FOOT_HEIGHT），时有时无会让体区高度跳一下 ——
     而且是在媒体 metadata 到达的那一刻跳，正好被用户看见。 */
  const showShotIdx = shotIndex !== undefined
  const showVersion = node.shotVersion !== undefined && node.shotVersion > 1 && !retired
  const isReference = node.isReference === true
  const showAudioMix = node.audioComposition !== undefined
  const showDuration = node.kind === 'video' && durationLabel !== null
  const showDims = mediaDims !== null
  const showResize = !node.locked && isMedia
  /* 头部类型标签：产物名（剧本 / 分镜 / 关键帧 / 角色 / 场景 / 片段 / 成片 / BGM …）。
     派生口径在 src/workflow-stage.ts 的 productLabelOf —— 与阶段轨道逐条对齐，
     不在这里另写一遍判据（那会让卡片与轨道各说各话）。 */
  const headLabel = productLabelOf(node) ?? KIND_LABEL[node.kind] ?? node.kind
  const headTitle = headTitleOf(node, headLabel)
  /** 脚部读数：声明值来自契约（node-presentation），实测值来自媒体元素。 */
  const declaredReadings = declaredReadingsOf(node)
  // CV-010：已耗时 MM:SS（以 createdAt 为起点；间隔 1s 的 now 驱动重渲染）。
  const loadingSeconds = node.isLoading === true ? Math.max(0, Math.floor((now - node.createdAt) / 1000)) : 0
  const loadingLabel = `${String(Math.floor(loadingSeconds / 60)).padStart(2, '0')}:${String(loadingSeconds % 60).padStart(2, '0')}`
  const flipTransform = (node.flipX ? 'scaleX(-1) ' : '') + (node.flipY ? 'scaleY(-1)' : '')

  // CV-044：画布内视频不挂原生 controls（缩略预览，真正的播放走双击浮层），
  // 因此也不存在原生「双击=桌面全屏」的 shadow DOM 内部 handler——双击正常
  // 冒泡到根 div 的 onDoubleClick，由 handleDoubleClick 打开播放浮层。
  // （此前试图在 capture 阶段拦截 / 覆盖 requestFullscreen 均无效：原生控件的
  // 双击全屏走 C++ 内部路径，不经过 JS 的 requestFullscreen，也非可取消默认动作。）

  const handleNodePointerDown = (event: React.PointerEvent): void => {
    if (event.button !== 0 || event.shiftKey) return
    event.stopPropagation()
    if (isInteractiveTarget(event.target)) return
    onNodePointerDown(event, node)
  }

  const handleResizePointerDown = (event: React.PointerEvent, corner: ResizeCorner): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    if (node.locked) return
    onResizePointerDown(event, node, corner)
  }

  const handleLinkPointerDown = (event: React.PointerEvent): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    onLinkPointerDown(event, node)
  }

  const handleDoubleClick = (event: React.MouseEvent): void => {
    event.stopPropagation()
    if (node.locked || editingBody) return
    // D1 方案 A：文本类节点双击=节点内联编辑；视频双击=固定尺寸播放浮层
    // （CV-044，替代原生「双击=桌面全屏」）；图片双击=大图预览浮层（CV-044
    // 扩展，详情查看改由右键菜单入口）；其余节点双击=详情面板。
    if (node.kind === 'sticky' || node.kind === 'text' || node.kind === 'prompt') {
      setBodyInput(node.text ?? node.title ?? '')
      setEditingBody(true)
      return
    }
    // CV-130：音频节点双击 = 打开简单播放器窗口（可拖进度 + 看完整歌词），
    // 与视频一致；未注册回调时退回详情面板（行为不退化）。
    if ((node.kind === 'video' || node.kind === 'audio') && node.url !== undefined && onOpenPlayback !== undefined) {
      onOpenPlayback(node)
      return
    }
    if (node.kind === 'image' && node.url !== undefined && onOpenPreview !== undefined) {
      onOpenPreview(node)
      return
    }
    onOpenDetail(node)
  }

  const handleRenameSubmit = (): void => {
    setEditingTitle(false)
    if (titleInput.trim().length > 0) onRenameSubmit(node.id, titleInput.trim())
  }

  const handleBodySubmit = (): void => {
    setEditingBody(false)
    if (bodyInput !== (node.text ?? node.title ?? '')) onTextSubmit(node.id, bodyInput)
  }

  const handleBodyKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      // Enter 提交；Shift+Enter 换行（便签多行内容）。
      event.preventDefault()
      handleBodySubmit()
      return
    }
    if (event.key === 'Escape') {
      event.stopPropagation()
      setEditingBody(false)
    }
  }

  const handleContextMenu = (event: React.MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    onContextMenu(node, event.clientX, event.clientY)
  }

  // CV-013/029：媒体真实宽高就绪后上报 frame（总是上报，无论框比例是否
  // 偏差——分辨率回填不依赖裁切问题存在）。CV-089：同时回填本地 mediaDims
  // 用于节点右下角分辨率角标。
  const handleMediaLoad = (event: React.SyntheticEvent<HTMLImageElement | HTMLVideoElement>): void => {
    const element = event.currentTarget
    const naturalWidth = element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth
    const naturalHeight = element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight
    if (naturalWidth <= 0 || naturalHeight <= 0) return
    setMediaDims({ width: naturalWidth, height: naturalHeight })
    if (onMediaNatural !== undefined) onMediaNatural(node.id, naturalWidth, naturalHeight)
  }

  // CV-083：视频 metadata 就绪 → 分辨率上报 + 时长角标现算。
  const handleVideoMetadata = (event: React.SyntheticEvent<HTMLVideoElement>): void => {
    setDurationLabel(formatMediaDuration(event.currentTarget.duration))
    handleMediaLoad(event)
  }

  const className = [
    'csNode',
    selected ? 'csNodeSelected' : '',
    selected && primary ? 'csNodePrimary' : '',
    node.locked ? 'csNodeLocked' : '',
    node.error !== undefined ? 'csNodeError' : '',
    node.isLoading ? 'csNodeLoading' : '',
    // CV-108：失效版本（被新版取代 / 已作废）灰显 + 虚线框，一眼区分「还在用」和「历史版本」。
    retired ? 'csNodeRetired' : '',
    // DD-03：成片节点（kind=video + toolName=compose）用青色描边 —— 「已冲印
    // 的成品」与「待用的素材」在画布上一眼可分。判定复用 shot-versions 的
    // isComposeProduct（全仓唯一口径），不在这里重写 `toolName === 'compose'`。
    isComposeProduct(node) ? 'csNodeFilm' : '',
    // DD-03：血缘聚光把非血缘节点压暗。选中项永不被压暗（lit 集含选中项），
    // 这里再挡一道，避免上游传参出错时把正在操作的卡片压灰。
    dimmed && !selected ? 'csNodeDimmed' : '',
    // C6：框选进行中的实时命中预览（设计稿 .nd.isHit）—— 松手前预告选中集合。
    hitPreview ? 'csNodeHit' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={className}
      // CR-081：节点位移走 transform（合成层），不用 left/top 逐帧改布局——
      // 拖拽/微调是每帧高频路径，translate3d 让浏览器走合成而不触发布局重绘。
      // DD-03：**不透明度的唯一出口是 `--cs-node-opacity`**。数据层（node.opacity）
      // 只写这个变量，状态层与血缘层各自只写一个乘数，最终 opacity 由
      // `.csNode` 一条 calc 统一算。改前这里是裸 `opacity`（inline），
      // 会静默压掉 .csNodeLocked(0.75) / .csNodeRetired(0.45) —— 那两个规则
      // 一直是死代码，失效版本从来没真的灰过（只有 grayscale 生效）。
      style={{
        left: 0,
        top: 0,
        transform: `translate3d(${node.x}px, ${node.y}px, 0)`,
        width: node.width,
        height: node.height,
        '--cs-node-opacity': opacity,
      } as CSSProperties}
      onPointerDown={handleNodePointerDown}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      data-node-id={node.id}
    >
      {/* ================= C10：头部（镜头条） =================
          分组卡没有头 —— 它是容器不是产物，给它一个「类型 + 标题」会让人以为
          它能被生成。其余节点一律有头，卡片之间才好左右扫读。 */}
      {!isGroup && (
        <div className="csNodeHead">
          <span className="csNodeHeadKind">{headLabel}</span>
          {/* 失败时标题槽让给告警：长标题压不掉它，它也顺带成为「这张卡坏了」
              的第一现场（放大看画面才知道坏了，就太晚了）。 */}
          {node.error !== undefined
            ? (canRetryNode(node)
              ? (
                <button
                  type="button"
                  className="csNodeHeadAlert"
                  title={`${node.error}\n点击重试（同参数重新生成）`}
                  onClick={() => { onRetry(node.id) }}
                >
                  生成失败 · 点击重试
                </button>
              )
              : <span className="csNodeHeadAlert" title={node.error}>生成失败：{node.error}</span>)
            : (headTitle.length > 0
              ? <span className="csNodeHeadTitle" title={node.title ?? undefined}>{headTitle}</span>
              : null)}
          <div className="csNodeHeadChips">
            {/* CV-108：失效版本直接标出状态；版本号（有效时）与镜号同列。 */}
            {retired && (
              <span className="csNodeBadge csNodeBadgeRetired" title={node.retired === true ? '已作废，不参与默认合成（右键可恢复）' : '已被新版本取代，不参与默认合成（右键可恢复）'}>
                {node.retired === true ? '已作废' : '已失效'}
                {node.shotVersion !== undefined ? ` · v${node.shotVersion}` : ''}
              </span>
            )}
            {/* C2：镜号 chip —— 编号与底部成片时间轴同源（同一次 isShotClip 筛选、
                同一个 deriveTimelineOrder 顺序），所以卡上的 #N 与时间轴上的 N 是
                同一个数。拖拽重排时间轴后两者一起变，不会各说各话。 */}
            {showShotIdx && (
              <span className="csNodeBadge csNodeShotIdx" title={`成片第 ${shotIndex} 段 · 与底部时间轴同号`}>
                #{shotIndex}
              </span>
            )}
            {/* CV-108：版本链角标——「同一镜位重出过」的身份标记。 */}
            {showVersion && (
              <span className="csNodeBadge csNodeBadgeVersion" title={`第 ${node.shotVersion} 版（同一镜位重出过）`}>v{node.shotVersion}</span>
            )}
            {node.locked === true && <span className="csNodeBadge csNodeBadgeLock" title="已锁定（拖拽 / 缩放 / 编辑被拦下）">🔒</span>}
          </div>
        </div>
      )}
      {isGroup
        ? (
          <div className="csNodeGroup">
            <span className="csNodeKind">{node.title ?? '分组'}</span>
          </div>
        )
        : null}
      {isMedia && node.url !== undefined && !mediaFailed
        ? (
          <div
            className="csNodeMediaBox"
            style={flipTransform ? { transform: flipTransform } : undefined}
            onPointerEnter={handleVideoEnter}
            onPointerLeave={stopHoverPreview}
          >
            {node.kind === 'image'
              ? (
                <img
                  className="csNodeMedia"
                  src={node.url}
                  alt={node.title ?? 'image'}
                  draggable={false}
                  onLoad={handleMediaLoad}
                  onError={() => { setMediaFailed(true) }}
                />
              )
              : (
                <video
                  ref={videoRef}
                  className="csNodeMedia"
                  src={node.url}
                  preload="metadata"
                  onLoadedMetadata={handleVideoMetadata}
                  onError={() => { setMediaFailed(true) }}
                />
              )}
            {/* CV-083 / CV-089：时长与分辨率角标已迁出媒体框 —— C2 起由底部角标带
                统一承载（见文件末尾的两条 .csNodeBadgeBand）。理由有两条，都不是
                审美：① 媒体框在 node.flipX/flipY 时带 scaleX(-1)/scaleY(-1)，
                挂在它里面的文字会跟着镜像，翻转过的视频时长曾显示成反写的数字；
                ② 分辨率角标与音轨构成角标此前都钉在右下角，实测互相压住。 */}
          </div>
        )
        : null}
      {isAudio && node.url !== undefined && !mediaFailed
        ? (
          <div className="csNodeAudioBox">
            {/* C10：卡内标题行已删 —— 标题进头部、时长进脚部、「这是音频」由头部的
                BGM 标签回答。同一张卡上写两遍标题，第二遍是噪音。 */}
            <div className="csNodeAudioWave" aria-hidden>
              {waveBars.map((height, index) => (
                <span
                  key={index}
                  className="csNodeAudioBar"
                  style={{
                    height: `${height}%`,
                    opacity: audioPlaying && (index / waveBars.length) <= audioProgress ? 0.95 : 0.4,
                  }}
                />
              ))}
            </div>
            <div className="csNodeAudioControls">
              <button
                type="button"
                className="csNodeAudioPlay"
                onClick={handleAudioToggle}
                // 双击按钮不该顺带弹出播放器窗口（连点播放是常见操作）。
                onDoubleClick={event => { event.stopPropagation() }}
                title={audioPlaying ? '暂停' : '播放'}
              >
                {audioPlaying ? '⏸' : '▶'}
              </button>
              {/* CV-130：可拖进度条（pointer capture）。stopPropagation 阻止
                  冒泡到节点根 —— 否则按下进度条会被当成「拖拽节点」。 */}
              <div
                ref={audioProgressRef}
                className="csNodeAudioProgress"
                role="slider"
                aria-label="播放进度"
                aria-valuemin={0}
                aria-valuemax={Math.round(audioDuration)}
                aria-valuenow={Math.round(audioProgress * audioDuration)}
                onPointerDown={event => {
                  event.stopPropagation()
                  audioSeekingRef.current = true
                  event.currentTarget.setPointerCapture(event.pointerId)
                  seekAudioToClientX(event.clientX)
                }}
                onPointerMove={event => {
                  if (audioSeekingRef.current) seekAudioToClientX(event.clientX)
                }}
                onPointerUp={event => {
                  audioSeekingRef.current = false
                  event.currentTarget.releasePointerCapture(event.pointerId)
                }}
                onDoubleClick={event => { event.stopPropagation() }}
              >
                <div className="csNodeAudioProgressFill" style={{ width: `${audioProgress * 100}%` }} />
              </div>
            </div>
            {/* CV-130：歌词摘要行。有歌词显示首个非标记行，纯器乐显示说明文案
                —— 两种情况都占位，卡片高度才稳定（不会因有无歌词跳动）。 */}
            <div className="csNodeAudioLyrics" title={audioLyrics.length > 0 ? audioLyrics : undefined}>
              {lyricsIsInstrumental ? '纯器乐 · 无歌词' : lyricsHeadline}
            </div>
            {/* preload=metadata：轻量取时长/可播，不提前拉全文件。 */}
            <audio
              ref={audioRef}
              className="csNodeAudioEl"
              src={node.url}
              preload="metadata"
              onError={() => { setMediaFailed(true) }}
            />
          </div>
        )
        : null}
      {/* C10：加载失败卡 —— 只留一句说明，居中。
          告警牌面是 inline-flex，在 flex 列里默认被拉伸成满宽；不给它居中，
          失败卡会读成「一行被拉长的字」而不是「这张卡坏了」。
          用 .csNodeAlert（不占标题格的那一种）：这里的正文本身就是告警，
          头部还留着类型标签与标题，两处不该长得不一样。 */}
      {isAudio && mediaFailed && (
        <div className="csNodeText csNodeTextAlert">
          <span className="csNodeAlert">音频加载失败：{node.title ?? node.kind}</span>
        </div>
      )}
      {isMedia && mediaFailed && node.isLoading !== true && (
        <div className="csNodeText csNodeTextAlert">
          <span className="csNodeAlert">媒体加载失败：{node.title ?? node.kind}</span>
        </div>
      )}
      {node.kind === 'sticky' || node.kind === 'text' || node.kind === 'prompt'
        ? (
          <div className="csNodeText">
            {/* C10：正文卡不再自己顶一个类型标签 —— 头部已经有「便签 / 文本 / 提示」，
                而且头部那一个是**派生出来的**（剧本卡会显示「剧本」而不是「文本」）。
                两处并存时，同一张卡会同时宣称自己是「文本」和「剧本」。 */}
            {editingBody
              ? (
                <textarea
                  className="csNodeBodyEdit"
                  value={bodyInput}
                  autoFocus
                  onChange={event => { setBodyInput(event.target.value) }}
                  onBlur={handleBodySubmit}
                  onKeyDown={handleBodyKeyDown}
                />
              )
              : <p className="csNodeBody">{node.text ?? node.title ?? ''}</p>}
          </div>
        )
        : null}
      {/* CV-089：删 csNodeRing 死元素（空样式，不提供任何视觉）。 */}
      {node.isLoading && (
        <div className="csNodeOverlay">
          <span className="csNodeOverlayLabel">
            {TOOL_TITLES[node.toolName ?? ''] ?? '生成中…'} · {loadingLabel}
          </span>
          <span className="csNodeProgress"><span className="csNodeProgressBar" /></span>
          {loadingSeconds >= LOADING_SLOW_THRESHOLD && (
            <span className="csNodeOverlayHint">耗时较久，可在详情面板或右键菜单打断</span>
          )}
        </div>
      )}
      {/* ================= C10：脚部（读数行） =================
          左 = 读数，右 = 素材角色。读数顺序按 node-presentation 的 READING_ORDER:
          音轨构成 → 时长 → 分辨率 → 声明时长 → 字数。
          顺序统一是**跨卡片可扫读**的前提：一排卡片里「时长」永远在「分辨率」
          左边，眼睛才不用每张卡重新找一遍。
          **永远渲染**（非分组节点）：这 22px 是几何契约（NODE_FOOT_HEIGHT）
          的一部分，时有时无会让体区在媒体 metadata 到达的那一刻跳一下。
          分组卡没有脚 —— 它没有产物，也就没有可读的数。 */}
      {!isGroup && (
        <div className="csNodeFoot">
          <span className="csNodeFootReadings">
            {/* CV-143：成片音轨构成读数——不用回放听就能确认「环境声有没有被丢、
                BGM 有没有混进去」。单镜保留环境声、多镜全丢是自动策略，用户必须能
                一眼看到结论。 */}
            {showAudioMix && node.audioComposition !== undefined && (
              <span
                className="csNodeAudioMix"
                data-audio={node.audioComposition}
                title={AUDIO_COMPOSITION_HINTS[node.audioComposition]}
              >
                {AUDIO_COMPOSITION_LABELS[node.audioComposition]}
              </span>
            )}
            {/* CV-083：时长（m:ss，metadata 就绪后显示）。 */}
            {showDuration && <span className="csNodeDuration">{durationLabel}</span>}
            {/* CV-089：分辨率（图片视频都用；与时长同排，便于左右扫读）。 */}
            {showDims && mediaDims !== null && (
              <span className="csNodeMediaDims">{mediaDims.width} × {mediaDims.height}</span>
            )}
            {/* C10：卡自带读数（不依赖媒体加载）—— 分镜卡的「3.2s」声明时长、
                文案卡的「128 字」。派生口径在 node-presentation，纯函数可直测。 */}
            {declaredReadings.map(reading => (
              <span key={reading.key} className={reading.key === 'declared-duration' ? 'csNodeDuration' : 'csNodeChars'}>
                {reading.text}
              </span>
            ))}
          </span>
          {/* CV-011：参考图素材角色（带色点），不用切托盘/详情就能认出参考节点。 */}
          {isReference && (
            <span className="csNodeRefBadge" data-role={node.referenceRole ?? 'image'} title={`参考图 · ${REFERENCE_ROLE_SHORT[node.referenceRole ?? 'image']}`}>
              <span className="csNodeRefDot" />
              参考 · {REFERENCE_ROLE_SHORT[node.referenceRole ?? 'image']}
            </span>
          )}
        </div>
      )}
      {editingTitle && (
        <input
          className="csNodeRename"
          value={titleInput}
          autoFocus
          onChange={event => { setTitleInput(event.target.value) }}
          onBlur={handleRenameSubmit}
          onKeyDown={event => {
            if (event.key === 'Enter') handleRenameSubmit()
            if (event.key === 'Escape') setEditingTitle(false)
          }}
        />
      )}
      {showResize && (
        <>
          {RESIZE_CORNERS.map(corner => (
            <div
              key={corner}
              className={`csNodeResize csNodeResize${corner.toUpperCase()}`}
              onPointerDown={event => { handleResizePointerDown(event, corner) }}
            />
          ))}
          <div
            className="csNodeLinkHandle"
            title="拖到其它节点建立血缘连线"
            onPointerDown={handleLinkPointerDown}
          />
        </>
      )}
    </div>
  )
}

// CR-063：memo 化——store 的 moveNode 只对「被移动节点及其子节点」产生新对象
// 引用（未变节点引用稳定），因此拖拽时未移动的节点不再重渲染。
export const CanvasNode = memo(CanvasNodeInner)