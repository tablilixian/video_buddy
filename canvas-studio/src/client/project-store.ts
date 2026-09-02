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
import type { StudioCanvasNode, StudioCanvasNodeKind, StudioCanvasView, StudioVideoStylePayload } from '../contracts/canvas.js'
import { BRIEF_NODE_TOOL, VIEW_DEFAULTS } from '../contracts/canvas.js'
import { clampViewScale, computeArrangeLayout } from '../canvas-view.js'
import type { StudioCaptureAsset } from '../asset-capture.js'
import type { StudioProject, StudioWorkflow } from '../contracts/project.js'

/** Snapshot-history cap (reference: MAX_HISTORY = 20). */
const MAX_HISTORY = 20

/** Default rendered box size per node kind (canvas-space pixels). */
const NODE_SIZE: Readonly<Record<StudioCanvasNodeKind, { width: number; height: number }>> = {
  image: { width: 260, height: 180 },
  video: { width: 260, height: 180 },
  sticky: { width: 220, height: 140 },
  text: { width: 220, height: 120 },
  prompt: { width: 240, height: 120 },
  group: { width: 320, height: 220 },
}

/** Auto-layout grid for freshly captured nodes. */
const LAYOUT = { origin: 40, stepX: 300, stepY: 240, columns: 4 }

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
    || ((node.kind === 'image' || node.kind === 'video') && node.url === undefined)
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

/** Project-list + canvas store state. */
export interface ProjectStoreState {
  projects: readonly StudioProject[]
  selectedProjectId: string | null
  selectedNodeId: string | null
  /** Multi-select roster (contains selectedNodeId when non-null). */
  selectedNodeIds: string[]
  phase: 'idle' | 'loading' | 'error'
  error: string | null
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
  /** 一键效果测试编排状态（null = 本会话从未跑过）。 */
  effectTest: EffectTestRunState | null
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
  setFailed: (draft: ProjectStoreState, error: string) => void
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
  /** 捕获一条 agent 资产 → 自动布局 + 血缘链接后写入节点列表。 */
  addAsset: (draft: ProjectStoreState, projectId: string, asset: StudioCaptureAsset) => void
  /** 选中节点（ctrl/cmd 追加多选；null 清空）。 */
  selectNode: (draft: ProjectStoreState, id: string | null, multi?: boolean) => void
  /** 全选当前项目节点。 */
  selectAllNodes: (draft: ProjectStoreState) => void
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
  /** 解组：移除 group 节点并释放子节点 parentId（写历史）。 */
  ungroup: (draft: ProjectStoreState, projectId: string, groupId: string) => void
  /** 一键整理布局：无重叠网格 + 组随行（写历史）。适配视野由调用方负责。 */
  autoArrange: (draft: ProjectStoreState, projectId: string) => void
  /** 生成中的占位节点（client 侧瞬态）。 */
  setPendingNode: (draft: ProjectStoreState, projectId: string, node: StudioCanvasNode) => void
  /** 手动新增一个便签/文本/提示节点（写历史）。CV-016：`at` 指定落点（右键空白处新建），缺省仍走网格落点。 */
  addNode: (draft: ProjectStoreState, projectId: string, kind: 'sticky' | 'text' | 'prompt', at?: { x: number; y: number }) => void
  /** CV-023：用户首条创意落画布（幂等：已有 BRIEF_NODE_TOOL 节点或画布未载入时跳过）。 */
  addBriefNode: (draft: ProjectStoreState, projectId: string, text: string) => void
  /** P8.1：把本地上传的图片作为参考素材节点落到画布（manual origin，带 url/filename）。 */
  addImportNode: (draft: ProjectStoreState, projectId: string, url: string, title?: string, filename?: string, referenceRole?: StudioCanvasNode['referenceRole'], isReference?: boolean, display?: { width: number; height: number; mediaWidth?: number; mediaHeight?: number }) => void
  /**
   * P8.4：参考视频抽帧结果落画布（一次历史快照）：每个抽帧一张 image 参考节点
   * （role=style，带 Drama filename），外加一张风格归纳 sticky 节点（sourceIds
   * 指向全部帧，形成血缘边）。选中 sticky 便于用户立刻看到归纳文本。
   */
  addVideoStyleNodes: (draft: ProjectStoreState, projectId: string, payload: StudioVideoStylePayload & { name: string }) => void
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

/** 从节点列表里找 union 边界（空表返回 null）。 */
export function boundsOf(nodes: readonly StudioCanvasNode[]): { x: number; y: number; width: number; height: number } | null {
  if (nodes.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x + node.width)
    maxY = Math.max(maxY, node.y + node.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
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
      selectedProjectId: null,
      selectedNodeId: null,
      selectedNodeIds: [],
      phase: 'idle',
      error: null,
      creating: false,
       nodes: {},
       views: {},
       workflows: {},
       activeSkills: {},
       hasConversation: {},
      effectTest: null,
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
        if (draft.selectedProjectId !== null && !projects.some(project => project.id === draft.selectedProjectId)) {
          draft.selectedProjectId = null
          draft.selectedNodeId = null
          draft.selectedNodeIds = []
        }
      },
      setFailed: (draft, error) => {
        draft.phase = 'error'
        draft.error = error
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
        const clean = nodes
          .filter(node => !isTransientNode(node))
          .map(node => {
            const { isLoading: _isLoading, progress: _progress, error: _error, ...rest } = node
            return rest as StudioCanvasNode
          })
        draft.nodes = { ...draft.nodes, [projectId]: clean }
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
        const index = existing.length
        const size = NODE_SIZE[asset.kind]
        const node: StudioCanvasNode = {
          id: newNodeId(),
          kind: asset.kind,
          url: asset.url,
          x: LAYOUT.origin + (index % LAYOUT.columns) * LAYOUT.stepX,
          y: LAYOUT.origin + Math.floor(index / LAYOUT.columns) * LAYOUT.stepY,
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
        const bounds = boundsOf(members)
        if (bounds === null) return
        const group: StudioCanvasNode = {
          id: newNodeId(),
          kind: 'group',
          title: '分组',
          x: bounds.x - 12,
          y: bounds.y - 12,
          width: bounds.width + 24,
          height: bounds.height + 24,
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
      autoArrange: (draft, projectId) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined || existing.length === 0) return
        const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing)
        draft.history = history.history
        draft.historyIndex = history.historyIndex
        const positions = computeArrangeLayout(existing)
        draft.nodes = {
          ...draft.nodes,
          [projectId]: existing.map(node => {
            const position = positions.get(node.id)
            return position === undefined ? node : { ...node, x: position.x, y: position.y }
          }),
        }
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
        const index = existing.length
        const size = NODE_SIZE[kind]
        const defaults: Partial<StudioCanvasNode> = kind === 'sticky'
          ? { text: '新便签' }
          : kind === 'text'
            ? { text: '新文本' }
            : { text: '新提示' }
        const node: StudioCanvasNode = {
          id: newNodeId(),
          kind,
          title: NODE_TITLES[kind],
          // CV-016：右键空白处新建时落在光标处（左上角对齐光标）；工具栏新建仍走网格落点。
          x: at?.x ?? LAYOUT.origin + (index % LAYOUT.columns) * LAYOUT.stepX,
          y: at?.y ?? LAYOUT.origin + Math.floor(index / LAYOUT.columns) * LAYOUT.stepY,
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
          x: LAYOUT.origin,
          y: LAYOUT.origin,
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
      addImportNode: (draft, projectId, url, title, filename, referenceRole = 'image', isReference = true, display?: { width: number; height: number; mediaWidth?: number; mediaHeight?: number }) => {
        const existing = draft.nodes[projectId]
        if (existing === undefined) return
        const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing)
        draft.history = history.history
        draft.historyIndex = history.historyIndex
        const index = existing.length
        // CV-029（用户修订）：长边固定 480、短边按真实比例缩放；未探测到尺寸
        // 时回退默认 260×180（媒体加载后会被框比例自动校正兜底）。
        // CV-013：探测到的真实分辨率入 mediaWidth/mediaHeight（详情面板展示）。
        const size = display ?? NODE_SIZE.image
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
          x: LAYOUT.origin + (index % LAYOUT.columns) * LAYOUT.stepX,
          y: LAYOUT.origin + Math.floor(index / LAYOUT.columns) * LAYOUT.stepY,
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
        const frameNodes: StudioCanvasNode[] = payload.frames.map((frame, i) => {
          const index = existing.length + i
          return {
            id: newNodeId(),
            kind: 'image',
            title: `帧 ${String(i + 1).padStart(2, '0')} @${frame.time.toFixed(1)}s`,
            url: frame.url,
            filename: frame.filename,
            isReference: true,
            referenceRole: 'style',
            x: LAYOUT.origin + (index % LAYOUT.columns) * LAYOUT.stepX,
            y: LAYOUT.origin + Math.floor(index / LAYOUT.columns) * LAYOUT.stepY,
            width: size.width,
            height: size.height,
            createdAt,
            toolName: 'upload_video',
            origin: 'manual',
            sourceIds: [],
            operationType: 'import',
            generationPrompt: JSON.stringify({ video: payload.name, time: frame.time }),
          }
        })
        // 风格归纳便签放在帧网格的下一格，血缘指向全部帧（画布上可见推导关系）。
        const stickyIndex = existing.length + frameNodes.length
        const stickyNode: StudioCanvasNode = {
          id: newNodeId(),
          kind: 'sticky',
          title: `风格归纳 · ${payload.name.length > 0 ? payload.name : '参考视频'}`,
          text: payload.summary,
          x: LAYOUT.origin + (stickyIndex % LAYOUT.columns) * LAYOUT.stepX,
          y: LAYOUT.origin + Math.floor(stickyIndex / LAYOUT.columns) * LAYOUT.stepY,
          width: stickySize.width + 140,
          height: stickySize.height + 120,
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
        const index = existing.length
        const size = NODE_SIZE.video
        const node: StudioCanvasNode = {
          id: asset.id ?? newNodeId(),
          kind: 'video',
          title: asset.title,
          url: asset.url,
          ...(typeof asset.duration === 'number' ? { duration: asset.duration } : {}),
          ...(typeof asset.mediaWidth === 'number' ? { mediaWidth: asset.mediaWidth } : {}),
          ...(typeof asset.mediaHeight === 'number' ? { mediaHeight: asset.mediaHeight } : {}),
          ...(typeof asset.script === 'string' ? { script: asset.script } : {}),
          x: LAYOUT.origin + (index % LAYOUT.columns) * LAYOUT.stepX,
          y: LAYOUT.origin + Math.floor(index / LAYOUT.columns) * LAYOUT.stepY,
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