/**
 * Project + canvas store: the registry snapshot, the current selection
 * (single + multi), per-project canvas node lists, snapshot history
 * (undo/redo), and the clipboard.
 *
 * Reads happen through the framework-bound `useStore`; writes go through the
 * declared actions only (async fetching lives in the apply-world inject
 * callbacks, which commit through these actions). The canvas node list is the
 * full P4+ model: every captured generation result (image/video) or manual
 * annotation (sticky/text/prompt/group) is a node, and bloodline edges are
 * derived from each node's `sourceIds` at render time (plan §7.3).
 *
 * History semantics follow the reference canvas store (snapshot the pre-mutation
 * list, cap 20): atomic actions snapshot first, while drags call `pushHistory`
 * explicitly at drag start (moveNode itself never snapshots — it fires every
 * pointer-move frame). Transient generation state (isLoading/progress/error)
 * lives on client-minted pending nodes and is stripped on reload.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { StudioAudioComposition, StudioCanvasNode, StudioCanvasNodeKind, StudioCanvasView, StudioVideoStylePayload } from '../contracts/canvas.js'
import { AUDIO_NODE_HEIGHT, AUDIO_NODE_WIDTH, BRIEF_NODE_TOOL, VIEW_DEFAULTS } from '../contracts/canvas.js'
import { DEFAULT_NODE_SIZE } from '../canvas-aspect.js'
import { clampViewScale, computeArrangeLayout } from '../canvas-view.js'
// CV-184：落点唯一口径。本文件此前自己有一份 LAYOUT 网格（40/300/240/4 列），
// 与 Host 侧、成片、占位各写各的；现在四处共用本模块。
import { PLACEMENT_GRID, deriveNodePlacement, placeSequence } from '../canvas-placement.js'
// CV-177：托盘几何 / 载入规范化 / 整理排版 —— 与 Host 侧 attachShotGroup 同一份纯函数。
import { groupBoxOf, normalizeGroupBoxes, tidyGroupLayout } from '../canvas-view.js'
import type { StudioCaptureAsset } from '../asset-capture.js'
// CV-217：历史遗留的占位文案 / 占位剧本节点判定（模型「先占位后回填」的产物，
// 内容整篇是「占位」二字）。载入清洗时一并丢弃，用户不必手动删。
import { isStubTextNode } from '../text-guard.js'
import type { StudioProject, StudioProjectGroup, StudioWorkflow } from '../contracts/project.js'
// CV-220：生成队列的对外投影类型（与 Host 侧 queue-view.ts 同一份定义）。
import type { GenerationQueueState } from '../queue-view.js'

/** Snapshot-history cap (reference: MAX_HISTORY = 20). */
const MAX_HISTORY = 20

/** Default rendered box size per node kind (canvas-space pixels). */
const NODE_SIZE: Readonly<Record<StudioCanvasNodeKind, { width: number; height: number }>> = {
  // C10：媒体节点框 = 画面区 + 镜头条 chrome（DEFAULT_NODE_SIZE = frameSizeOf(260×180)
  // = 260×228）。**不要在这里写 260×180** —— 那是「画面」的尺寸，写进节点框会让
  // 占位卡的画面被头/脚挤成 260×132（2:1 的扁条），加载真实媒体后又要跳一次。
  // 同理 Host 的 generate.ts / compose.ts / video-frames.ts 也走同一个出口。
  image: { ...DEFAULT_NODE_SIZE },
  video: { ...DEFAULT_NODE_SIZE },
  // CV-128/130：音频卡片（波形 + 播放条 + 歌词摘要），不需要视频那种 16:9 大框；
  // 尺寸取契约常量，与 Host 落盘尺寸同源，避免两处手写漂移。
  audio: { width: AUDIO_NODE_WIDTH, height: AUDIO_NODE_HEIGHT },
  sticky: { width: 220, height: 140 },
  text: { width: 220, height: 120 },
  prompt: { width: 240, height: 120 },
  group: { width: 320, height: 220 },
}

/** Default titles for manually added annotation nodes. */
const NODE_TITLES: Readonly<Record<'sticky' | 'text' | 'prompt', string>> = {
  sticky: '便签',
  text: '文本',
  prompt: '提示',
}

/**
 * CV-023 创意节点的 toolName 标记：用户首条真人消息自动落的「创意」文本节点。
 * 幂等去重与画布识别都靠它（每项目至多一个）；常量本体在共享契约
 * （contracts/canvas.ts），Host 侧分镜/文案连边共用。
 */
export { BRIEF_NODE_TOOL }

/** Mint a node id in the browser (secure context over loopback). */
export function newNodeId(): string {
  const cryptoObj = globalThis.crypto
  if (cryptoObj !== undefined && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID()
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 客户端瞬态节点判定：生成中的占位（isLoading / `pending-*` id）以及没有产物
 * URL 的 agent 媒体节点。它们只应存在于内存 —— 持久化前必须剔除，载入时也要
 * 丢弃（否则一次生成中途的保存就会让画布永久残留「黑块」节点）。
 */
export function isTransientNode(node: StudioCanvasNode): boolean {
  return node.isLoading === true
    || node.id.startsWith('pending-')
    || ((node.kind === 'image' || node.kind === 'video' || node.kind === 'audio') && node.url === undefined)
}

/**
 * 节点字段补丁：与 Partial 不同，允许显式传 undefined 来清除可选字段
 * （exactOptionalPropertyTypes 下 `Partial<T>` 不接受 undefined 值）。
 */
export type NodePatch = { [K in keyof StudioCanvasNode]?: StudioCanvasNode[K] | undefined }

/** One undo/redo history entry: a full node-list snapshot of one project. */
export interface HistoryEntry {
  projectId: string
  nodes: readonly StudioCanvasNode[]
}

/** Per-project viewport entry: the view plus whether it came from disk. */
export interface ProjectViewEntry {
  view: StudioCanvasView
  /** False when no persisted view existed (client should fit content once). */
  saved: boolean
}

/**
 * 一键效果测试的编排状态（内存态，不持久化）。apply 世界串行驱动，
 * ProjectList 经 useStudio 订阅展示进度。
 */
export interface EffectTestRunState {
  running: boolean
  /** 本轮轮次号（如 R002）。 */
  round: string
  /** 待跑用例队列（如 ['T1','T3']）。 */
  queue: readonly string[]
  /** 正在跑的队列下标（空闲/结束时为 -1）。 */
  currentIndex: number
  /** 当前项目的名字（如 效果验证-R002-T1）。 */
  currentLabel: string | null
  /** 已完成（含失败）的项目名。 */
  done: readonly string[]
  /** 失败摘要（"项目名: 原因"）。 */
  failures: readonly string[]
  /** 整轮结束标记（message 为汇总文案）。 */
  finished: boolean
  message: string | null
}

/**
 * 刚拖入 / 上传中的视频（**内存态**，不持久化 —— 它的产物是画布节点，节点才是真相）。
 *
 * 为什么需要它：视频上传的可见反馈不能只靠画布节点 —— lobby / 首屏态下画布不可见，
 * 用户拖完视频「看不到任何东西」（2026-09-22 验收反馈）。这条数据驱动的就是宿主输入框
 * 上方那条 dock（`conversation.input.dock`，宿主源码确认 hero 态也渲染）。
 */
export interface VideoUploadItem {
  /** 本地条目 id（**不是节点 id**：落卡之前还没有节点）。 */
  id: string
  /** 原文件名（展示用）。 */
  name: string
  /** 字节数（展示用）。 */
  size: number
  /** 本地预览 URL（上传中用它画首帧；成功后有同源 url 就换掉）。 */
  objectUrl?: string
  /** 落盘后的同源 URL（成功后才有）。 */
  url?: string
  /** 探测到的时长（秒；0/缺省表示未知）。 */
  duration?: number
  status: 'uploading' | 'ready' | 'failed'
  /** 失败原因（status = 'failed' 时展示）。 */
  message?: string
}

/** 按 id 改写某项目的上传条目；项目或条目不存在时原样返回（不抛）。 */
function patchVideoUpload(
  all: Readonly<Record<string, readonly VideoUploadItem[]>>,
  projectId: string,
  id: string,
  patch: (item: VideoUploadItem) => VideoUploadItem,
): Readonly<Record<string, readonly VideoUploadItem[]>> {
  const list = all[projectId]
  if (list === undefined) return all
  return { ...all, [projectId]: list.map((item) => (item.id === id ? patch(item) : item)) }
}

/** Project-list + canvas store state. */
export interface ProjectStoreState {
  projects: readonly StudioProject[]
  /** CV-091：用户自定义分组（左侧栏可折叠分组；与 projects 同源于 Host 注册表）。 */
  groups: readonly StudioProjectGroup[]
  selectedProjectId: string | null
  selectedNodeId: string | null
  /** Multi-select roster (contains selectedNodeId when non-null). */
  selectedNodeIds: string[]
  phase: 'idle' | 'loading' | 'error'
  error: string | null
  /**
   * CV-233：失败的结构化错误码（`CS-*`，可空）。
   *
   * 只带一句文案时错误分级只能靠字符串猜（见 error-kind.ts 的启发式）；有了码，
   * 三态错误卡直接读注册表里该码声明的 `uiKind` —— 文案怎么改都不影响分级。
   * 与 `error` 同生共死：两处一起写、一起清。
   */
  errorCode: string | null
  creating: boolean
  /** 每个项目的画布节点（按生成时间追加）。 */
  nodes: Readonly<Record<string, readonly StudioCanvasNode[]>>
  /** 每个项目的视口/面板状态（缩放、平移、图层与小地图开关）。 */
  views: Readonly<Record<string, ProjectViewEntry>>
  /** P7：每个项目的创作工作流（模式 + 审批门禁状态）。 */
  workflows: Readonly<Record<string, StudioWorkflow>>
  /** CV-066：每个项目已装载的 skill 清单（skills.json 持久化）。 */
  activeSkills: Readonly<Record<string, readonly string[]>>
  /** CV-064 二期：每个项目是否有过对话（会话 `blank=false`，内存态不持久化，恢复时现算）。 */
  hasConversation: Readonly<Record<string, boolean>>
  /** 刚拖入 / 上传中的视频（内存态；驱动输入框上方的首帧卡片）。 */
  videoUploads: Readonly<Record<string, readonly VideoUploadItem[]>>
  /** 一键效果测试编排状态（null = 本会话从未跑过）。 */
  effectTest: EffectTestRunState | null
  /**
   * CV-220：宿主生成队列的最小投影（全局，内存态不持久化）。
   * `null` = 空闲 / 未知 —— 只有**真有等待**时才是非 null（见 queue-view.ts）。
   */
  generationQueue: GenerationQueueState | null
  /** Undo/redo snapshot history (global, entries carry their project). */
  history: HistoryEntry[]
  historyIndex: number
  /** Client-side clipboard (copy/paste). */
  clipboard: StudioCanvasNode[]
}

/** Annotation twin of the actions literal below. */
export type ProjectStoreActions = {
  setPhase: (draft: ProjectStoreState, phase: ProjectStoreState['phase']) => void
  setLoaded: (draft: ProjectStoreState, projects: readonly StudioProject[]) => void
  /** CV-091：载入分组元信息（与 setLoaded 同源于 Host 注册表）。 */
  setGroups: (draft: ProjectStoreState, groups: readonly StudioProjectGroup[]) => void
  /**
   * 记一次加载失败。`code` 是可选的结构化错误码（HTTP 层响应体里的 `CS-*`），
   * 有码时三态卡的处置级别按码判定而不是猜文案（CV-233）。
   */
  setFailed: (draft: ProjectStoreState, error: string, code?: string | null) => void
  select: (draft: ProjectStoreState, projectId: string | null) => void
  setCreating: (draft: ProjectStoreState, creating: boolean) => void
  /** 打开项目时载入持久化节点（剥离瞬态状态）。 */
  setNodes: (draft: ProjectStoreState, projectId: string, nodes: readonly StudioCanvasNode[]) => void
  /**
   * 载入 / 更新某项目的视口与面板状态（增量合并）。`saved` 标记该视图是否
   * 来自磁盘（未保存过时客户端应先适配内容一次）。
   */
  setView: (draft: ProjectStoreState, projectId: string, patch: Partial<StudioCanvasView>, saved?: boolean) => void
  /** P7：写入某项目的工作流状态（打开项目 / 审批动作后调用）。 */
  setWorkflow: (draft: ProjectStoreState, projectId: string, workflow: StudioWorkflow) => void
  /** CV-066：载入某项目已装载的 skill 清单（打开项目时）。 */
  setActiveSkills: (draft: ProjectStoreState, projectId: string, skills: readonly string[]) => void
  /** CV-066：装载一个 skill 到项目（去重；持久化由调用方负责）。 */
  activateSkill: (draft: ProjectStoreState, projectId: string, name: string) => void
  /** CV-066：从项目卸载一个 skill（持久化由调用方负责）。 */
  deactivateSkill: (draft: ProjectStoreState, projectId: string, name: string) => void
  /** CV-064 二期：写入某项目「是否有过对话」标记（blank 翻转 / 打开项目现算）。 */
  setHasConversation: (draft: ProjectStoreState, projectId: string, has: boolean) => void
  /** 一键效果测试：增量更新编排状态（apply 世界的编排循环调用）。 */
  patchEffectTest: (draft: ProjectStoreState, patch: Partial<EffectTestRunState>) => void
  /**
   * CV-220：写入生成队列投影（轮询回调调用）。传 `null` = 清空排队痕迹。
   * **只做赋值** —— 投影由 queue-view.ts 的 generationQueueStateOf 单点推导，
   * 本动作不参与判定（避免判据在 store 里多长出一份）。
   */
  setGenerationQueue: (draft: ProjectStoreState, state: GenerationQueueState | null) => void
  /** 捕获一条 agent 资产 → 自动布局 + 血缘链接后写入节点列表。 */
  addAsset: (draft: ProjectStoreState, projectId: string, asset: StudioCaptureAsset) => void
  /** 选中节点（ctrl/cmd 追加多选；null 清空）。 */
  selectNode: (draft: ProjectStoreState, id: string | null, multi?: boolean) => void
  /** 全选当前项目节点。 */
  selectAllNodes: (draft: ProjectStoreState) => void
  /** C1：按 id 集选中（六阶段轨道「点某段 → 聚焦该段产物」；空数组 = 清空）。 */
  selectNodes: (draft: ProjectStoreState, ids: readonly string[]) => void
  /** 移动节点（拖拽逐帧调用；不写历史）。group 节点联动子图层。 */
  moveNode: (draft: ProjectStoreState, projectId: string, id: string, x: number, y: number) => void
  /** 增量更新节点字段（拖拽 resize 逐帧；不写历史）。补丁可传 undefined 清除字段。 */
  updateNode: (draft: ProjectStoreState, projectId: string, id: string, updates: NodePatch) => void
  /** 删除节点并清理指向它的血缘（写历史）。 */
  removeNodes: (draft: ProjectStoreState, projectId: string, ids: string[]) => void
  /** 快照当前项目节点列表进历史（拖拽/缩放开始时调用）。 */
  pushHistory: (draft: ProjectStoreState, projectId: string) => void
  undo: (draft: ProjectStoreState) => void
  redo: (draft: ProjectStoreState) => void
  /** 复制选中节点到剪贴板。 */
  copySelected: (draft: ProjectStoreState, projectId: string) => void
  /** 粘贴剪贴板节点（偏移 +20，新 id，写历史）。 */
  pasteNodes: (draft: ProjectStoreState, projectId: string) => void
  /** z 序操作（zIndex 字段语义，写历史）。 */
  reorderNode: (draft: ProjectStoreState, projectId: string, id: string, direction: 'front' | 'back' | 'forward' | 'backward') => void
  toggleLock: (draft: ProjectStoreState, projectId: string, id: string) => void
  setVisibility: (draft: ProjectStoreState, projectId: string, id: string, visible: boolean) => void
  setOpacity: (draft: ProjectStoreState, projectId: string, id: string, opacity: number) => void
  renameNode: (draft: ProjectStoreState, projectId: string, id: string, title: string) => void
  /** 手动连线：给目标节点追加 sourceIds（写历史）。 */
  linkLayers: (draft: ProjectStoreState, projectId: string, sourceIds: string[], targetId: string) => void
  /** 编组：创建 group 节点包裹选中节点（写历史）。 */
  groupSelected: (draft: ProjectStoreState, projectId: string) => void
  /** CV-177：「整理托盘」——把组成员按阅读顺序重排成网格（可撤销）。 */
  tidyGroup: (draft: ProjectStoreState, projectId: string, groupId: string) => void
  /** 解组：移除 group 节点并释放子节点 parentId（写历史）。 */
  ungroup: (draft: ProjectStoreState, projectId: string, groupId: string) => void
  /**
   * 一键整理布局：按制作流程阶段排列 + 组随行（写历史）。适配视野由调用方负责。
   * @param visibleIds 如提供，仅重排这些节点（其余不动）——用于隐藏废弃素材时只排可见节点。
   */
  /**
   * 整理布局。`recordHistory = false` 供**系统自动**触发使用（放手跑模式下新节点落地
   * 后自动整理）：自动动作不进撤销栈，否则用户按 Ctrl+Z 撤销的是「整理」而不是他自己
   * 上一个操作。手动点击（工具栏 / 隐藏失效节点）保持默认 `true`。
   */
  autoArrange: (draft: ProjectStoreState, projectId: string, visibleIds?: readonly string[], recordHistory?: boolean) => void
  /** 生成中的占位节点（client 侧瞬态）。 */
  setPendingNode: (draft: ProjectStoreState, projectId: string, node: StudioCanvasNode) => void
  /** 手动新增一个便签/文本/提示节点（写历史）。CV-016：`at` 指定落点（右键空白处新建），缺省仍走网格落点。 */
  addNode: (draft: ProjectStoreState, projectId: string, kind: 'sticky' | 'text' | 'prompt', at?: { x: number; y: number }) => void
  /** CV-023：用户首条创意落画布（幂等：已有 BRIEF_NODE_TOOL 节点或画布未载入时跳过）。 */
  addBriefNode: (draft: ProjectStoreState, projectId: string, text: string) => void
  /** P8.1：把本地上传的图片作为参考素材节点落到画布（manual origin，带 url/filename）。contentHash 用于附件旁路同字节去重。 */
  addImportNode: (draft: ProjectStoreState, projectId: string, url: string, title?: string, filename?: string, referenceRole?: StudioCanvasNode['referenceRole'], isReference?: boolean, display?: { width: number; height: number; mediaWidth?: number; mediaHeight?: number }, contentHash?: string, select?: boolean) => void
  /**
   * 2026-09-22：上传的**音频**落卡（`kind: 'audio'`）。与 addImportNode 分开而不是再给
   * 它加个 kind 参数 —— 那个签名已经有 10 个参数，而音频用不到 referenceRole /
   * display / contentHash 这一套。落卡后由布局的「上传素材按来源分栏」规则归**创意栏**
   * （`origin: 'manual'`）。
   */
  addAudioNode: (draft: ProjectStoreState, projectId: string, url: string, title?: string, filename?: string) => void
  /**
   * CV-241 D2：上传的**文字文件**落素材 chip（`kind: 'text'`，与图片 import 同级）。
   * `url` 指向同源落盘文件（详情只读预览 + 惰性 promote 兜底）；`body` 是截前
   * 4000 字符的可读正文。不设 toolName / referenceRole —— 它不是生成产物也不是
   * 参考角色素材；`origin: 'manual'` 让布局归**创意栏**。
   */
  addTextAssetNode: (draft: ProjectStoreState, projectId: string, url: string, body: string, title?: string) => void
  /**
   * 2026-09-22：上传的**参考视频**落卡（`kind: 'video'`）。
   *
   * 与图片/音频的上传落卡分开：视频多带一个 `duration`（详情展示 + 参考视频规格
   * 校验的时长项），`toolName` 固定 `upload_video` —— 布局的「上传素材按来源分栏」
   * 由它直接归**创意栏**（`canvas-view.ts` 的 switch 已有该 case，不必依赖 origin 兜底）。
   */
  addVideoNode: (draft: ProjectStoreState, projectId: string, asset: {
    url: string
    title?: string
    filename?: string
    duration?: number
  }) => void
  /**
   * 视频上传的**可见反馈**（内存态，驱动输入框上方的首帧卡片）。
   *
   * 四条分开是因为触发点不同：开始时还不知道任何结果；成功时有 url + duration；
   * 失败时只有原因。**移除只动这张卡** —— 节点已经在画布上，不联动删除素材。
   */
  beginVideoUpload: (draft: ProjectStoreState, projectId: string, item: VideoUploadItem) => void
  settleVideoUpload: (draft: ProjectStoreState, projectId: string, id: string, result: { url: string; duration?: number }) => void
  failVideoUpload: (draft: ProjectStoreState, projectId: string, id: string, message: string) => void
  dismissVideoUpload: (draft: ProjectStoreState, projectId: string, id: string) => void
  /**
   * P8.4：参考视频抽帧结果落画布（一次历史快照）：每个抽帧一张 image 参考节点
   * （role=style，带 Drama filename），外加一张风格归纳 sticky 节点（sourceIds
   * 指向全部帧，形成血缘边）。选中 sticky 便于用户立刻看到归纳文本。
   */
  addVideoStyleNodes: (draft: ProjectStoreState, projectId: string, payload: StudioVideoStylePayload & { name: string; sourceVideoId?: string }) => void
  /** P9.3：成片合成结果回写画布（video-composite 终节点，manual origin，血缘指向全部源 clip）。 */
  addComposedVideo: (draft: ProjectStoreState, projectId: string, asset: {
    /** 可选预生成 id（合成后自动聚焦用，缺省则内部生成）。 */
    id?: string
    url: string
    title: string
    duration?: number
    /** 成片真实分辨率（探测所得），落 mediaWidth/mediaHeight。 */
    mediaWidth?: number
    mediaHeight?: number
    /** 成片文案（广告词/对白/字幕等），来自「文案」节点。 */
    script?: string
    /** CV-143：成片音轨构成（角标展示：环境声 / 环境声 + BGM / 纯 BGM / 无声）。 */
    audioComposition?: StudioAudioComposition
    sourceIds: string[]
  }) => void
  /** 移除 runId 匹配的占位节点（重载/完成时）。 */
  removePendingByRunId: (draft: ProjectStoreState, projectId: string, runId: string) => void
  /** 占位节点标记失败（tool/result 的 data.error）。 */
  markPendingError: (draft: ProjectStoreState, projectId: string, runId: string, error: string) => void
  /** 清空某项目的画布（清掉内存态；持久化由调用方负责）。 */
  clearProject: (draft: ProjectStoreState, projectId: string) => void
}

/** 取某项目的全部节点（未绑定或空时返回空数组）。 */
export function nodesOf(state: ProjectStoreState, projectId: string | null): readonly StudioCanvasNode[] {
  if (projectId === null) return []
  return state.nodes[projectId] ?? []
}

/** CV-066：取某项目已装载的 skill 清单（未绑定或空时返回空数组）。 */
export function activeSkillsOf(state: ProjectStoreState, projectId: string | null): readonly string[] {
  if (projectId === null) return []
  return state.activeSkills[projectId] ?? []
}

/** CV-064 二期：取某项目「是否有过对话」（未绑定或未标记时视为无对话）。 */
export function hasConversationOf(state: ProjectStoreState, projectId: string | null): boolean {
  if (projectId === null) return false
  return state.hasConversation[projectId] === true
}

/** Shared fallback so `viewOf` never allocates (stable snapshot identity). */
const DEFAULT_VIEW_ENTRY: ProjectViewEntry = { view: VIEW_DEFAULTS, saved: false }

/** 取某项目的视口条目（缺失时回退默认值，`saved: false`）。 */
export function viewOf(state: ProjectStoreState, projectId: string | null): ProjectViewEntry {
  if (projectId === null) return DEFAULT_VIEW_ENTRY
  return state.views[projectId] ?? DEFAULT_VIEW_ENTRY
}

/** 取某项目最新的画布节点（用于回看 / 默认聚焦）；缺失时返回 null。 */
export function lastNodeOf(state: ProjectStoreState, projectId: string | null): StudioCanvasNode | null {
  const list = nodesOf(state, projectId)
  return list.length === 0 ? null : list[list.length - 1]!
}

/** 取当前选中的节点。 */
export function selectedNodeOf(state: ProjectStoreState): StudioCanvasNode | null {
  if (state.selectedNodeId === null || state.selectedProjectId === null) return null
  return nodesOf(state, state.selectedProjectId).find(node => node.id === state.selectedNodeId) ?? null
}

/** 取当前多选节点列表（按 zIndex+createdAt 排序）。 */
export function selectedNodesOf(state: ProjectStoreState): StudioCanvasNode[] {
  if (state.selectedProjectId === null || state.selectedNodeIds.length === 0) return []
  const byId = new Map(nodesOf(state, state.selectedProjectId).map(node => [node.id, node]))
  return state.selectedNodeIds
    .map(id => byId.get(id))
    .filter((node): node is StudioCanvasNode => node !== undefined)
    .sort(compareNodes)
}

/** 渲染序：zIndex 升序，同层按 createdAt 稳定。 */
export function compareNodes(left: StudioCanvasNode, right: StudioCanvasNode): number {
  const leftZ = left.zIndex ?? 0
  const rightZ = right.zIndex ?? 0
  if (leftZ !== rightZ) return leftZ - rightZ
  return left.createdAt - right.createdAt
}

/** 节点的直接子图层（parentId === id）。 */
export function childrenOf(nodes: readonly StudioCanvasNode[], id: string): StudioCanvasNode[] {
  return nodes.filter(node => node.parentId === id)
}

/** 快照当前节点列表进历史（内部实现：先截断 redo 尾部，再压入）。 */
function snapshotHistory(
  history: HistoryEntry[],
  historyIndex: number,
  projectId: string,
  nodes: readonly StudioCanvasNode[],
): { history: HistoryEntry[]; historyIndex: number } {
  const trimmed = history.slice(0, historyIndex + 1)
  trimmed.push({ projectId, nodes: [...nodes] })
  return {
    history: trimmed.slice(-MAX_HISTORY),
    historyIndex: Math.min(trimmed.length - 1, MAX_HISTORY - 1),
  }
}

/**
 * Create the project + canvas store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createProjectStore(): EngineStoreHandle<ProjectStoreState, ProjectStoreActions> {
  return defineStore({
    init: (): ProjectStoreState => ({
      projects: [],
      groups: [],
      selectedProjectId: null,
      selectedNodeId: null,
      selectedNodeIds: [],
      phase: 'idle',
      error: null,
      errorCode: null,
      creating: false,
       nodes: {},
       views: {},
       workflows: {},
       activeSkills: {},
       hasConversation: {},
       videoUploads: {},
      effectTest: null,
      generationQueue: null,
      history: [],
      historyIndex: -1,
      clipboard: [],
    }),
    actions: {
      setPhase: (draft, phase) => { draft.phase = phase },
      setLoaded: (draft, projects) => {
        draft.projects = projects
        draft.phase = 'idle'
        draft.error = null
        draft.errorCode = null
        if (draft.selectedProjectId !== null && !projects.some(project => project.id === draft.selectedProjectId)) {
          draft.selectedProjectId = null
          draft.selectedNodeId = null
          draft.selectedNodeIds = []
        }
      },
      setGroups: (draft, groups) => {
        // 按 order 升序，保证渲染顺序稳定（与 Host listGroups 一致）。
        draft.groups = [...groups].sort((left, right) => left.order - right.order)
      },
      setFailed: (draft, error, code) => {
        draft.phase = 'error'
        draft.error = error
        draft.errorCode = code ?? null
      },
      select: (draft, projectId) => {
        draft.selectedProjectId = projectId
        draft.selectedNodeId = null
        draft.selectedNodeIds = []
      },
      setCreating: (draft, creating) => { draft.creating = creating },
      setNodes: (draft, projectId, nodes) => {
        // 载入清洗：丢弃瞬态占位与历史版本误存盘的残缺节点（isLoading 等
        // 瞬态字段一并剥离），避免「生成中黑块」在重启后永久残留。
        // CV-217：同时丢弃模型写下的「占位文案 / 占位剧本」节点——它们已由
        // Host 侧守卫拦在新写入之外，这里负责把此前跑出来的历史垃圾清掉。
        const clean = nodes
          .filter(node => !isTransientNode(node) && !isStubTextNode(node))
          .map(node => {
            const { isLoading: _isLoading, progress: _progress, error: _error, ...rest } = node
            return rest as StudioCanvasNode
          })
        draft.nodes = { ...draft.nodes, [projectId]: normalizeGroupBoxes(clean) }
      },
      setView: (draft, projectId, patch, saved) => {
        const current = draft.views[projectId] ?? { view: VIEW_DEFAULTS, saved: false }
        draft.views = {
          ...draft.views,
          [projectId]: {
            view: { ...current.view, ...patch, scale: clampViewScale(patch.scale ?? current.view.scale) },
            saved: saved ?? current.saved,
          },
        }
      },
      setWorkflow: (draft, projectId, workflow) => {
        draft.workflows = { ...draft.workflows, [projectId]: workflow }
      },
      setActiveSkills: (draft, projectId, skills) => {
        draft.activeSkills = { ...draft.activeSkills, [projectId]: [...skills] }
      },
      activateSkill: (draft, projectId, name) => {
        const current = draft.activeSkills[projectId] ?? []
        if (current.includes(name)) return
        draft.activeSkills = { ...draft.activeSkills, [projectId]: [...current, name] }
      },
      deactivateSkill: (draft, projectId, name) => {
        const current = draft.activeSkills[projectId] ?? []
        if (!current.includes(name)) return
        draft.activeSkills = { ...draft.activeSkills, [projectId]: current.filter(candidate => candidate !== name) }
      },
      setHasConversation: (draft, projectId, has) => {
        draft.hasConversation = { ...draft.hasConversation, [projectId]: has }
      },
      setGenerationQueue: (draft, state) => { draft.generationQueue = state },
      patchEffectTest: (draft, patch) => {
        draft.effectTest = { ...(draft.effectTest ?? {
          running: false, round: '', queue: [], currentIndex: -1, currentLabel: null,
          done: [], failures: [], finished: false, message: null,
        }), ...patch }
      },
      addAsset: (draft, projectId, asset) => {
        const existing = draft.nodes[projectId] ?? []
        if (existing.some(candidate => candidate.url === asset.url)) return
        const sourceIds: string[] = []
        if (asset.sourceUrl !== undefined) {
          const source = existing.find(candidate => candidate.url === asset.sourceUrl)
          if (source !== undefined) sourceIds.push(source.id)
        }
        const size = NODE_SIZE[asset.kind]
        // CV-184：落点走唯一入口。顺带修好一处旧账 —— 这里本来就算出了
        // sourceIds（按 sourceUrl 反查血缘），却没用它落位，永远走网格。
        const position = deriveNodePlacement(existing, sourceIds, size.width, size.height)
        const node: StudioCanvasNode = {
          id: newNodeId(),
          kind: asset.kind,
          url: asset.url,
          x: position.x,
          y: position.y,
          width: size.width,
          height: size.height,
          createdAt: asset.createdAt,
          toolName: asset.toolName,
          runId: asset.runId,
          origin: 'agent',
          sourceIds,
        }
        draft.nodes = { ...draft.nodes, [projectId]: [...existing, node] }
      },
      selectNode: (draft, id, multi = false) => {
        if (multi && id !== null) {
          const roster = new Set(draft.selectedNodeIds)
          if (roster.has(id)) roster.delete(id)
          else roster.add(id)
          draft.selectedNodeIds = [...roster]
          draft.selectedNodeId = roster.size === 1 ? id : null
        } else {
          draft.selectedNodeIds = id === null ? [] : [id]
          draft.selectedNodeId = id
        }
      },
      selectAllNodes: (draft) => {
        if (draft.selectedProjectId === null) return
        const ids = nodesOf(draft, draft.selectedProjectId).map(node => node.id)
        draft.selectedNodeIds = ids
        draft.selectedNodeId = ids.length === 1 ? ids[0]! : null
      },
      /**
       * C1：按 id 集选中（阶段轨道 → 聚焦该阶段产物）。
       *
       * 只保留**当前项目真实存在**的 id：调用方拿的是上一次渲染算出的快照，期间
       * 节点可能已被删除 / 撤销 / 换项目 —— 直接写入会留下幽灵选中项，表现为
       * 「详情面板空着，但画布显示有选中、于是别的操作全落空」。
       */
      selectNodes: (draft, ids) => {
        if (draft.selectedProjectId === null) return
        const alive = new Set(nodesOf(draft, draft.selectedProjectId).map(node => node.id))
        const kept = ids.filter(id => alive.has(id))
        draft.selectedNodeIds = kept
        draft.selectedNodeId = kept.length === 1 ? kept[0]! : null
      },
      moveNode: (draft, projectId, id, x, y) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined) return
        const node = existing.find(candidate => candidate.id === id)
        if (node === undefined) return
        const deltaX = x - node.x
        const deltaY = y - node.y
        draft.nodes = {
          ...draft.nodes,
          [projectId]: existing.map(candidate =>
            candidate.id === id
              ? { ...candidate, x, y }
              : candidate.parentId === id
                ? { ...candidate, x: candidate.x + deltaX, y: candidate.y + deltaY }
                : candidate,
          ),
        }
      },
      updateNode: (draft, projectId, id, updates) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined) return
        // 断言安全：updates 里显式的 undefined 只用于清除可选字段
        // （error / isLoading 等），必填字段不会以 undefined 覆盖。
        draft.nodes = {
          ...draft.nodes,
          [projectId]: existing.map(node => (node.id === id ? ({ ...node, ...updates } as StudioCanvasNode) : node)),
        }
      },
      removeNodes: (draft, projectId, ids) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined || ids.length === 0) return
        const removed = new Set(ids)
        const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing)
        draft.history = history.history
        draft.historyIndex = history.historyIndex
        draft.nodes = {
          ...draft.nodes,
          [projectId]: existing
            .filter(node => !removed.has(node.id))
            .map(node => {
              const survivors = { ...node, sourceIds: node.sourceIds.filter(sourceId => !removed.has(sourceId)) }
              if (node.parentId !== undefined && removed.has(node.parentId)) {
                const { parentId: _staleParent, ...rest } = survivors
                return rest
              }
              return survivors
            }),
        }
        draft.selectedNodeIds = draft.selectedNodeIds.filter(id => !removed.has(id))
        if (draft.selectedNodeId !== null && removed.has(draft.selectedNodeId)) {
          draft.selectedNodeId = draft.selectedNodeIds.length === 1 ? draft.selectedNodeIds[0]! : null
        }
      },
      pushHistory: (draft, projectId) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined) return
        const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing)
        draft.history = history.history
        draft.historyIndex = history.historyIndex
      },
      undo: (draft) => {
        if (draft.historyIndex < 0 || draft.historyIndex >= draft.history.length) return
        const entry = draft.history[draft.historyIndex]!
        draft.nodes = { ...draft.nodes, [entry.projectId]: [...entry.nodes] }
        draft.historyIndex -= 1
        draft.selectedNodeId = null
        draft.selectedNodeIds = []
      },
      redo: (draft) => {
        const nextIndex = draft.historyIndex + 1
        if (nextIndex >= draft.history.length) return
        const entry = draft.history[nextIndex]!
        draft.nodes = { ...draft.nodes, [entry.projectId]: [...entry.nodes] }
        draft.historyIndex = nextIndex
        draft.selectedNodeId = null
        draft.selectedNodeIds = []
      },
      copySelected: (draft, projectId) => {
        const byId = new Map(nodesOf(draft, projectId).map(node => [node.id, node]))
        draft.clipboard = draft.selectedNodeIds
          .map(id => byId.get(id))
          .filter((node): node is StudioCanvasNode => node !== undefined)
      },
      pasteNodes: (draft, projectId) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined || draft.clipboard.length === 0) return
        const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing)
        draft.history = history.history
        draft.historyIndex = history.historyIndex
        const idMap = new Map<string, string>()
        const pasted: StudioCanvasNode[] = draft.clipboard.map(node => {
          const newId = newNodeId()
          idMap.set(node.id, newId)
          return { ...node, id: newId, x: node.x + 20, y: node.y + 20, createdAt: Date.now() }
        })
        draft.nodes = {
          ...draft.nodes,
          [projectId]: [
            ...existing,
            ...pasted.map(node => ({
              ...node,
              sourceIds: node.sourceIds.map(sourceId => idMap.get(sourceId) ?? sourceId),
              ...(node.parentId !== undefined ? { parentId: idMap.get(node.parentId) ?? node.parentId } : {}),
            })),
          ],
        }
        draft.selectedNodeIds = pasted.map(node => node.id)
        draft.selectedNodeId = pasted.length === 1 ? pasted[0]!.id : null
      },
      reorderNode: (draft, projectId, id, direction) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined) return
        const node = existing.find(candidate => candidate.id === id)
        if (node === undefined) return
        const sorted = [...existing].sort(compareNodes)
        const index = sorted.findIndex(candidate => candidate.id === id)
        if (index === -1) return
        const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing)
        draft.history = history.history
        draft.historyIndex = history.historyIndex
        const currentZ = node.zIndex ?? 0
        let targetZ = currentZ
        if (direction === 'front') {
          const maxZ = Math.max(0, ...existing.map(candidate => candidate.zIndex ?? 0))
          targetZ = maxZ + 1
        } else if (direction === 'back') {
          const minZ = Math.min(0, ...existing.map(candidate => candidate.zIndex ?? 0))
          targetZ = minZ - 1
        } else if (direction === 'forward') {
          const next = sorted[index + 1]
          if (next !== undefined) targetZ = (next.zIndex ?? 0) + 1
        } else if (direction === 'backward') {
          const previous = sorted[index - 1]
          if (previous !== undefined) targetZ = (previous.zIndex ?? 0) - 1
        }
        draft.nodes = {
          ...draft.nodes,
          [projectId]: existing.map(candidate =>
            candidate.id === id ? { ...candidate, zIndex: targetZ } : candidate),
        }
      },
      toggleLock: (draft, projectId, id) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined) return
        const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing)
        draft.history = history.history
        draft.historyIndex = history.historyIndex
        draft.nodes = {
          ...draft.nodes,
          [projectId]: existing.map(node =>
            node.id === id ? { ...node, locked: !node.locked } : node),
        }
      },
      setVisibility: (draft, projectId, id, visible) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined) return
        const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing)
        draft.history = history.history
        draft.historyIndex = history.historyIndex
        draft.nodes = {
          ...draft.nodes,
          [projectId]: existing.map(node =>
            node.id === id ? { ...node, visible } : node),
        }
      },
      setOpacity: (draft, projectId, id, opacity) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined) return
        const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing)
        draft.history = history.history
        draft.historyIndex = history.historyIndex
        const clamped = Math.min(1, Math.max(0, opacity))
        draft.nodes = {
          ...draft.nodes,
          [projectId]: existing.map(node =>
            node.id === id ? { ...node, opacity: clamped } : node),
        }
      },
      renameNode: (draft, projectId, id, title) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined) return
        const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing)
        draft.history = history.history
        draft.historyIndex = history.historyIndex
        const nextTitle = title.trim()
        if (nextTitle.length === 0) return
        draft.nodes = {
          ...draft.nodes,
          [projectId]: existing.map(node =>
            node.id === id ? { ...node, title: nextTitle } : node),
        }
      },
      linkLayers: (draft, projectId, sourceIds, targetId) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined || sourceIds.length === 0) return
        const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing)
        draft.history = history.history
        draft.historyIndex = history.historyIndex
        draft.nodes = {
          ...draft.nodes,
          [projectId]: existing.map(node => {
            if (node.id !== targetId) return node
            const merged = [...node.sourceIds]
            for (const sourceId of sourceIds) {
              if (sourceId !== targetId && !merged.includes(sourceId)) merged.push(sourceId)
            }
            return { ...node, sourceIds: merged }
          }),
        }
      },
      groupSelected: (draft, projectId) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined || draft.selectedNodeIds.length < 2) return
        const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing)
        draft.history = history.history
        draft.historyIndex = history.historyIndex
        const byId = new Map(existing.map(node => [node.id, node]))
        const members = draft.selectedNodeIds
          .map(id => byId.get(id))
          .filter((node): node is StudioCanvasNode => node !== undefined)
        const box = groupBoxOf(members)
        if (box === null) return
        const group: StudioCanvasNode = {
          id: newNodeId(),
          kind: 'group',
          title: '分组',
          ...box,
          createdAt: Date.now(),
          origin: 'manual',
          sourceIds: [],
          zIndex: Math.min(...members.map(node => node.zIndex ?? 0)) - 1,
        }
        const memberIds = new Set(members.map(node => node.id))
        draft.nodes = {
          ...draft.nodes,
          [projectId]: [
            ...existing.map(node =>
              memberIds.has(node.id) ? { ...node, parentId: group.id } : node),
            group,
          ],
        }
        draft.selectedNodeIds = [group.id]
        draft.selectedNodeId = group.id
      },
      ungroup: (draft, projectId, groupId) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined) return
        const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing)
        draft.history = history.history
        draft.historyIndex = history.historyIndex
        draft.nodes = {
          ...draft.nodes,
          [projectId]: existing
            .filter(node => node.id !== groupId)
            .map(node => {
              if (node.parentId !== groupId) return node
              const { parentId: _staleParent, ...rest } = node
              return rest
            }),
        }
        draft.selectedNodeIds = draft.selectedNodeIds.filter(id => id !== groupId)
        if (draft.selectedNodeId === groupId) draft.selectedNodeId = null
      },
      /**
       * CV-177：「整理托盘」——把组成员按阅读顺序重排成网格，并把托盘重新贴合。
       * 只有一条规则来自 canvas-view 的 tidyGroupLayout，这里只负责写盘：
       * 成员落新位置、托盘落新盒子，其余节点原样。走 snapshotHistory，可撤销。
       */
      tidyGroup: (draft, projectId, groupId) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined) return
        const group = existing.find(node => node.id === groupId && node.kind === 'group')
        if (group === undefined) return
        const members = existing.filter(node => node.parentId === groupId)
        if (members.length === 0) return
        const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing)
        draft.history = history.history
        draft.historyIndex = history.historyIndex
        const layout = tidyGroupLayout(group, members)
        draft.nodes = {
          ...draft.nodes,
          [projectId]: existing.map(node => {
            const position = layout.positions.get(node.id)
            if (position !== undefined) return { ...node, x: position.x, y: position.y }
            if (node.id === groupId && layout.box !== null) return { ...node, ...layout.box }
            return node
          }),
        }
      },
      autoArrange: (draft, projectId, visibleIds, recordHistory = true) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined || existing.length === 0) return
        // 自动触发（放手跑模式）不记撤销栈 —— 见接口注释。
        if (recordHistory) {
          const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing)
          draft.history = history.history
          draft.historyIndex = history.historyIndex
        }
        const stagePositions = computeArrangeLayout(existing)
        const visibleSet = visibleIds !== undefined ? new Set(visibleIds) : undefined
        // Apply stage-based positions first, then tidy each group's children.
        let result = existing.map(node => {
          if (visibleSet !== undefined && !visibleSet.has(node.id)) return node
          const pos = stagePositions.get(node.id)
          return pos === undefined ? node : { ...node, x: pos.x, y: pos.y }
        })
        for (const node of result) {
          if (node.kind !== 'group') continue
          const members = result.filter(n => n.parentId === node.id)
          if (members.length === 0) continue
          const layout = tidyGroupLayout(node, members)
          result = result.map(n => {
            if (visibleSet !== undefined && !visibleSet.has(n.id)) return n
            const memberPos = layout.positions.get(n.id)
            if (memberPos !== undefined) return { ...n, x: memberPos.x, y: memberPos.y }
            if (n.id === node.id && layout.box !== null) return { ...n, ...layout.box }
            return n
          })
        }
        draft.nodes = { ...draft.nodes, [projectId]: result }
      },
      setPendingNode: (draft, projectId, node) => {
        const existing = draft.nodes[projectId] ?? []
        if (existing.some(candidate => candidate.runId === node.runId && candidate.isLoading)) return
        draft.nodes = { ...draft.nodes, [projectId]: [...existing, node] }
      },
      addNode: (draft, projectId, kind, at) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined) return
        const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing)
        draft.history = history.history
        draft.historyIndex = history.historyIndex
        const size = NODE_SIZE[kind]
        const defaults: Partial<StudioCanvasNode> = kind === 'sticky'
          ? { text: '新便签' }
          : kind === 'text'
            ? { text: '新文本' }
            : { text: '新提示' }
        // CV-016：右键空白处新建时落在光标处（左上角对齐光标）；工具栏新建走
        // 共享落点入口（CV-184 起不再本地算格子）。
        const position = at ?? deriveNodePlacement(existing, [], size.width, size.height)
        const node: StudioCanvasNode = {
          id: newNodeId(),
          kind,
          title: NODE_TITLES[kind],
          x: position.x,
          y: position.y,
          width: size.width,
          height: size.height,
          createdAt: Date.now(),
          origin: 'manual',
          sourceIds: [],
          ...defaults,
        }
        draft.nodes = { ...draft.nodes, [projectId]: [...existing, node] }
        draft.selectedNodeIds = [node.id]
        draft.selectedNodeId = node.id
      },
      addBriefNode: (draft, projectId, text) => {
        const existing = draft.nodes[projectId]
        // 项目画布尚未载入时不落（调用方会在载入后重试，避免被磁盘真相冲掉）。
        if (existing === undefined) return
        // 方案 A 幂等：每项目至多一个创意节点 —— 会话历史重放反复触发也是空操作。
        if (existing.some((node) => node.toolName === BRIEF_NODE_TOOL)) return
        const node: StudioCanvasNode = {
          id: newNodeId(),
          kind: 'text',
          title: '创意',
          text,
          // 创意是叙事锚点：固定落在画布原点区域（后续生成的节点在其右侧流动）。
          x: PLACEMENT_GRID.origin,
          y: PLACEMENT_GRID.origin,
          width: 360,
          height: 200,
          createdAt: Date.now(),
          toolName: BRIEF_NODE_TOOL,
          origin: 'manual',
          sourceIds: [],
          operationType: 'import',
        }
        draft.nodes = { ...draft.nodes, [projectId]: [...existing, node] }
      },
      // select = false：宿主旁路导入（聊天发消息带图，divertAttachments）不抢
      // 画布选中 —— 用户拍板（2026-09-13）：发消息是后台静默动作，副作用不得
      // 改写画布交互状态（选中跳变 + 聚光蒙蓝随选区变化，被读成「灵异状态」）。
      // 用户主动上传（工具条按钮）仍默认选中。
      addImportNode: (draft, projectId, url, title, filename, referenceRole = 'image', isReference = true, display?: { width: number; height: number; mediaWidth?: number; mediaHeight?: number }, contentHash?: string, select = true) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined) return
        const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing)
        draft.history = history.history
        draft.historyIndex = history.historyIndex
        // CV-029（用户修订）：长边固定 480、短边按真实比例缩放；未探测到尺寸
        // 时回退默认节点框（媒体加载后会被框比例自动校正兜底）。
        // C10：默认值来自 DEFAULT_NODE_SIZE（= 画面 260×180 + 镜头条 chrome），
        // 不再在注释里写死 260×180 —— 注释写着旧数字比代码更难发现。
        // CV-013：探测到的真实分辨率入 mediaWidth/mediaHeight（详情面板展示）。
        const size = display ?? NODE_SIZE.image
        // CV-184：上传/旁路导入是**成批**发生的（一次拖 N 张），落点必须走
        // 唯一入口才能不叠 —— 而且尺寸用探测到的真实框，不是默认 260×180。
        const position = deriveNodePlacement(existing, [], size.width, size.height)
        const node: StudioCanvasNode = {
          id: newNodeId(),
          kind: 'image',
          title: typeof title === 'string' && title.length > 0 ? title : '本地素材',
          url,
          ...(typeof filename === 'string' && filename.length > 0 ? { filename } : {}),
          ...(isReference ? { isReference: true } : {}),
          ...(isReference && referenceRole !== undefined ? { referenceRole } : {}),
          ...(display?.mediaWidth !== undefined ? { mediaWidth: display.mediaWidth } : {}),
          ...(display?.mediaHeight !== undefined ? { mediaHeight: display.mediaHeight } : {}),
          ...(contentHash !== undefined && contentHash.length > 0 ? { contentHash } : {}),
          x: position.x,
          y: position.y,
          width: size.width,
          height: size.height,
          createdAt: Date.now(),
          origin: 'manual',
          sourceIds: [],
        }
        draft.nodes = { ...draft.nodes, [projectId]: [...existing, node] }
        if (select) {
          draft.selectedNodeIds = [node.id]
          draft.selectedNodeId = node.id
        }
      },
      /**
       * 2026-09-22：上传的本地音频落卡。位置走同一个 `deriveNodePlacement`（唯一落点
       * 入口，不会与已有节点叠在一起），尺寸用 NODE_SIZE.audio（音频节点是窄条）。
       * `origin: 'manual'` 正是布局判它进**创意栏**的判据（见 canvas-view 的音频分支）。
       */
      addAudioNode: (draft, projectId, url, title, filename) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined) return
        const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing)
        draft.history = history.history
        draft.historyIndex = history.historyIndex
        const size = NODE_SIZE.audio
        const position = deriveNodePlacement(existing, [], size.width, size.height)
        const node: StudioCanvasNode = {
          id: newNodeId(),
          kind: 'audio',
          title: typeof title === 'string' && title.length > 0 ? title : '本地音频',
          url,
          ...(typeof filename === 'string' && filename.length > 0 ? { filename } : {}),
          x: position.x,
          y: position.y,
          width: size.width,
          height: size.height,
          createdAt: Date.now(),
          origin: 'manual',
          sourceIds: [],
        }
        draft.nodes = { ...draft.nodes, [projectId]: [...existing, node] }
        draft.selectedNodeIds = [node.id]
        draft.selectedNodeId = node.id
      },
      /**
       * CV-241 D2：上传文字文件落卡。位置走同一个 `deriveNodePlacement`（唯一落点
       * 入口）；尺寸用 NODE_SIZE.text。`operationType: 'import'` 让阶段表把它归
       * 「导入」product（与 brief 同值靠**不设 toolName** 区分）。
       */
      addTextAssetNode: (draft, projectId, url, body, title) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined) return
        const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing)
        draft.history = history.history
        draft.historyIndex = history.historyIndex
        const size = NODE_SIZE.text
        const position = deriveNodePlacement(existing, [], size.width, size.height)
        const node: StudioCanvasNode = {
          id: newNodeId(),
          kind: 'text',
          title: typeof title === 'string' && title.length > 0 ? title : '本地文本',
          url,
          ...(body.length > 0 ? { text: body } : {}),
          x: position.x,
          y: position.y,
          width: size.width,
          height: size.height,
          createdAt: Date.now(),
          origin: 'manual',
          sourceIds: [],
          operationType: 'import',
          // filename 惰性留空：Drama 句柄由消费侧 resolveRefFilenames 兜底。
        }
        draft.nodes = { ...draft.nodes, [projectId]: [...existing, node] }
        draft.selectedNodeIds = [node.id]
        draft.selectedNodeId = node.id
      },
      addVideoNode: (draft, projectId, asset) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined) return
        const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing)
        draft.history = history.history
        draft.historyIndex = history.historyIndex
        const size = NODE_SIZE.video
        const position = deriveNodePlacement(existing, [], size.width, size.height)
        const node: StudioCanvasNode = {
          id: newNodeId(),
          kind: 'video',
          title: typeof asset.title === 'string' && asset.title.length > 0 ? asset.title : '参考视频',
          url: asset.url,
          x: position.x,
          y: position.y,
          width: size.width,
          height: size.height,
          createdAt: Date.now(),
          // toolName 固定 upload_video ⇒ 布局的 switch 直接把它归**创意栏**；
          // origin: 'manual' 是「按来源分栏」规则的另一半（与图片/音频一致）。
          toolName: 'upload_video',
          origin: 'manual',
          sourceIds: [],
          operationType: 'import',
          // filename 为空串 = 后端上传失败：**不落这个字段**，免得留下空句柄
          // （被 @ref 引用时由 host-tools 的「有 url 无 filename ⇒ 现场提升」补）。
          ...(typeof asset.filename === 'string' && asset.filename.length > 0 ? { filename: asset.filename } : {}),
          ...(typeof asset.duration === 'number' && asset.duration > 0 ? { duration: asset.duration } : {}),
        }
        draft.nodes = { ...draft.nodes, [projectId]: [...existing, node] }
        draft.selectedNodeIds = [node.id]
        draft.selectedNodeId = node.id
      },
      // —— 视频上传的可见反馈（内存态；四条各管一件事，见 interface 上的说明）。
      beginVideoUpload: (draft, projectId, item) => {
        draft.videoUploads = {
          ...draft.videoUploads,
          [projectId]: [...(draft.videoUploads[projectId] ?? []), item],
        }
      },
      settleVideoUpload: (draft, projectId, id, result) => {
        draft.videoUploads = patchVideoUpload(draft.videoUploads, projectId, id, (item) => ({
          ...item,
          status: 'ready',
          url: result.url,
          ...(result.duration !== undefined && result.duration > 0 ? { duration: result.duration } : {}),
        }))
      },
      failVideoUpload: (draft, projectId, id, message) => {
        draft.videoUploads = patchVideoUpload(draft.videoUploads, projectId, id, (item) => ({
          ...item,
          status: 'failed',
          message,
        }))
      },
      dismissVideoUpload: (draft, projectId, id) => {
        // 只摘掉卡片（可 revoke 的本地 URL 由组件在卸载时处理）。
        draft.videoUploads = {
          ...draft.videoUploads,
          [projectId]: (draft.videoUploads[projectId] ?? []).filter((item) => item.id !== id),
        }
      },
      addVideoStyleNodes: (draft, projectId, payload) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined) return
        const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing)
        draft.history = history.history
        draft.historyIndex = history.historyIndex
        const size = NODE_SIZE.image
        const stickySize = NODE_SIZE.sticky
        const createdAt = Date.now()
        // 每个抽帧一张参考图节点（role=style，带 Drama filename，可直接被生成工具引用）。
        // CV-184：整批一次性算好落点（placeSequence 把「本批已排好的」算进占用表），
        // 否则 20 帧抽帧会全部落在同一个格子里。
        const frameSizes = payload.frames.map(() => ({ width: size.width, height: size.height }))
        const framePositions = placeSequence(existing, frameSizes)
        const frameNodes: StudioCanvasNode[] = payload.frames.map((frame, i) => {
          const position = framePositions[i]!
          return {
            id: newNodeId(),
            kind: 'image',
            title: `帧 ${String(i + 1).padStart(2, '0')} @${frame.time.toFixed(1)}s`,
            url: frame.url,
            filename: frame.filename,
            isReference: true,
            referenceRole: 'style',
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
            createdAt,
            toolName: 'upload_video',
            origin: 'manual',
            // 血缘指向**源视频节点**（拆分时由调用方提供）：画布上「视频 → 帧图 → 便签」
            // 的推导关系才连得起来，血缘聚光与补全也才认得出这组帧的出处。
            sourceIds: payload.sourceVideoId !== undefined ? [payload.sourceVideoId] : [],
            operationType: 'import',
            generationPrompt: JSON.stringify({ video: payload.name, time: frame.time }),
          }
        })
        // 风格归纳便签：血缘指向全部帧（画布上可见推导关系），落点由同一入口算
        // （帧节点也算进占用表），不再是「帧网格的下一格」这种自己推的算法。
        const stickyBox = { width: stickySize.width + 140, height: stickySize.height + 120 }
        const stickyPosition = deriveNodePlacement(
          [...existing, ...frameNodes],
          [],
          stickyBox.width,
          stickyBox.height,
        )
        const stickyNode: StudioCanvasNode = {
          id: newNodeId(),
          kind: 'sticky',
          title: `风格归纳 · ${payload.name.length > 0 ? payload.name : '参考视频'}`,
          text: payload.summary,
          x: stickyPosition.x,
          y: stickyPosition.y,
          width: stickyBox.width,
          height: stickyBox.height,
          createdAt,
          toolName: 'upload_video',
          origin: 'manual',
          sourceIds: frameNodes.map(node => node.id),
          operationType: 'import',
          generationPrompt: JSON.stringify({
            video: payload.name,
            duration: payload.duration,
            videoUrl: payload.videoUrl,
            frames: payload.frames.map(frame => frame.time),
          }),
        }
        draft.nodes = {
          ...draft.nodes,
          [projectId]: [...existing, ...frameNodes, stickyNode],
        }
        draft.selectedNodeIds = [stickyNode.id]
        draft.selectedNodeId = stickyNode.id
      },
      addComposedVideo: (draft, projectId, asset) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined) return
        const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing)
        draft.history = history.history
        draft.historyIndex = history.historyIndex
        const size = NODE_SIZE.video
        // CV-184：客户端侧的成片兜底落点 —— 与 Host 侧 appendComposedVideoNode
        // 现在共用同一个入口（此前两处各写一份网格，成片必叠）。
        const position = deriveNodePlacement(existing, asset.sourceIds, size.width, size.height)
        const node: StudioCanvasNode = {
          id: asset.id ?? newNodeId(),
          kind: 'video',
          title: asset.title,
          url: asset.url,
          ...(typeof asset.duration === 'number' ? { duration: asset.duration } : {}),
          ...(typeof asset.mediaWidth === 'number' ? { mediaWidth: asset.mediaWidth } : {}),
          ...(typeof asset.mediaHeight === 'number' ? { mediaHeight: asset.mediaHeight } : {}),
          ...(typeof asset.script === 'string' ? { script: asset.script } : {}),
          ...(asset.audioComposition !== undefined ? { audioComposition: asset.audioComposition } : {}),
          x: position.x,
          y: position.y,
          width: size.width,
          height: size.height,
          createdAt: Date.now(),
          toolName: 'compose',
          origin: 'manual',
          sourceIds: asset.sourceIds,
          operationType: 'video-composite',
        }
        draft.nodes = { ...draft.nodes, [projectId]: [...existing, node] }
        draft.selectedNodeIds = [node.id]
        draft.selectedNodeId = node.id
      },
      removePendingByRunId: (draft, projectId, runId) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined) return
        const pending = existing.find(node => node.runId === runId && node.isLoading)
        if (pending === undefined) return
        draft.nodes = {
          ...draft.nodes,
          [projectId]: existing.filter(node => node.id !== pending.id),
        }
      },
      markPendingError: (draft, projectId, runId, error) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined) return
        draft.nodes = {
          ...draft.nodes,
          [projectId]: existing.map(node =>
            node.runId === runId && node.isLoading
              ? { ...node, isLoading: false, error }
              : node),
        }
      },
      clearProject: (draft, projectId) => {
        draft.nodes = { ...draft.nodes, [projectId]: [] }
        draft.activeSkills = { ...draft.activeSkills, [projectId]: [] }
        draft.hasConversation = { ...draft.hasConversation, [projectId]: false }
        draft.selectedNodeId = null
        draft.selectedNodeIds = []
      },
    },
  })
}