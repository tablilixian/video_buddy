import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// 引入 conversation 插件的类型增强：Context 上获得 `conversation: IConversation`
// （含 send(text)），用于批准/驳回/确认关键帧后自动唤醒 agent（O1）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import './slots-contracts.js'
import type { StudioCanvasNode, StudioCanvasView } from '../contracts/canvas.js'
import { AUDIO_NODE_HEIGHT, AUDIO_NODE_WIDTH } from '../contracts/canvas.js'
import type { StudioProject, StudioProjectPlan, StudioWorkflowMode } from '../contracts/project.js'
// REQ-005 / CV-256：首页对话式创建的自动命名（纯函数，放 src/ 根 —— Host tsconfig
// 排除 client/，纯函数必须写在根目录才能被 tests/project-naming.test.mjs 直连）。
import { dedupeProjectName, summarizeName } from '../project-naming.js'
// REQ-005 v1.3（变体 A）：lobby 认领时把规格草稿组装成预置规格（与规格行同一份实现）。
import { buildPlan } from './ProjectSpecChips.js'
import type { LibAnchorRef, LibraryAsset, LibraryCreateRequest, LibraryUpdateRequest } from '../contracts/asset-library.js'
import { createAssetCaptureDefinition } from '../asset-capture.js'
import { StudioApiError, answerStudioQuestion, createLibraryAsset, createStudioGroup, createStudioProject, createStudioProjectClaimDir, deleteLibraryAsset, deleteStudioGroup, deleteStudioProject, ensureStudioDraftDir, fetchStudioGenerateQueue, getStudioAssetHistory, gcStudioAssets, getStudioWorkflow, listLibraryAssets, listStudioGroups, listStudioProjects, loadActiveSkills, loadStudioCanvas, moveStudioProjectToGroup, postStudioWorkflowAction, promoteStudioImage, renameStudioGroup, retryStudioNode, saveActiveSkills, saveStudioCanvas, saveTestReport, updateLibraryAsset, uploadLibraryMedia, uploadLocalStudioImageDeferred, uploadStudioMedia, uploadStudioVideo, addLibraryAnchor } from './api.js'
import { createBriefCaptureDefinition } from './brief-capture.js'
import { installBrandStyles } from './brand-inject.js'
// REQ-021：回合空闲判据等编排等待原语（与自动测试场景执行器共用的唯一实现；
// BUG-014 起落 src/ 根供单测直连，见 test-driver.ts 头注）。
import { createTestDriver, EFFECT_TEST_CASE_TIMEOUT_MS, EFFECT_TEST_START_TIMEOUT_MS } from '../test-driver.js'
// REQ-021：场景定义 / 检查点断言库 / 报告构造（纯函数模块，src/ 根，单测直连）。
import { AUTO_TEST_CHECKPOINTS, runAutoTestCheckpoints } from '../auto-test-checkpoints.js'
import { scenarioCheckpointErrors, type AutoTestScenario } from '../auto-test-scenarios.js'
import { buildAutoTestReport, type AutoTestCheckpointLine } from '../auto-test-report.js'
import { HeroBrandMark } from './brand/HeroBrandMark.js'
import { StudioLayoutController } from './layout-controller.js'
import { previewSizeOf } from '../canvas-aspect.js'
import { isReplayable } from '../node-params.js'
// CV-220：生成队列快照 → 客户端投影（与 Host 侧同一份纯函数）。
import { generationQueueStateOf } from '../queue-view.js'
// CV-184：落点唯一口径（占位节点与 Host 产物同源）。
import { deriveNodePlacement, resolvePendingSourceIds } from '../canvas-placement.js'
import { formatRefToken, uniqueTitle } from '../reference-token.js'
import { buildAssetHandles } from '../reference-handle.js'
import type { AssetHandle } from '../reference-handle.js'
import { insertAssetChip, insertSkillChip, registerCanvasAssetSourceWhenReady, registerCanvasSkillSourceWhenReady, registerLibAssetSourceWhenReady, insertLibChip } from './reference-source.js'
import { VISIBLE_CATALOG } from '../skill-catalog.js'
import { bytesToBase64 } from '../encoding.js'
import { BRIEF_NODE_TOOL, activeSkillsOf, createProjectStore, isTransientNode, viewOf } from './project-store.js'
import { installStudioStyles } from './styles.js'
import { StudioFrame } from './StudioFrame.js'
import { ProjectContextBar } from './ProjectContextBar.js'
import { MediaUploadBar } from './MediaUploadBar.js'
import { LobbySpecRow } from './LobbySpecRow.js'
import { LobbyStashBar } from './LobbyStashBar.js'
// REQ-008：对话流工具行三档接管（keyed 槽 tool.call.toolview，priority -1）。
import { ToolCallRow } from './ToolCallRow.js'
import { TOOLVIEW_KEYS } from '../tool-presentation.js'
// CV-261：首页暂存的文件侧（File 登记表 + 取出/回收）。展示事实在 store 的
// `lobbyStash`，文件本体在模块级表里 —— 见该文件头。
import { dismissLobbyStashItem, releaseLobbyStash, takeLobbyStashFiles } from './lobby-stash.js'
import { classifyFile, type MediaKind } from '../media-extension.js'
import type { ProjectSpecDraft } from './ProjectSpecChips.js'
import type { CanvasStudioConfig } from '../host-config.js'
import type { CanvasStudioModelApi } from './contracts.js'
import { registerQuestionChatNode } from './question-capture.js'
import { CanvasStudioError, asCanvasError, isDevMode, resolveDevModeFromProcess, routeError, setDevMode, throwError } from '../error-system.js'
import '../errors/catalog.js'

/**
 * Services required before the studio frame can mount.
 *
 * 注意：`tools` 是 Host 专属服务，客户端没有该服务。媒体生成工具已在 Host
 * 侧（`src/host-tools.ts`）注册，客户端只负责 UI、项目/工作区绑定，以及
 * 通过 `conversationEvents` 捕获工具产物到画布 store（P4），并把画布节点
 * 持久化到 Host（P4+ 重启恢复）。`sessions` 用于打断当前会话的生成回合。
 */
// 注意：设置弹窗经 StudioFrame 复用本 ctx，因此本插件必须声明它实际用到的全部
// 服务。DSH Cordis 为隔离 inject：未在列表中声明的服务在 ctx 上不可访问，否则
// 设置弹窗取 settingsScope / connection 会在桌面启动阶段抛 "service not found"。
// 但 `conversation` **绝不能**出现在这个数组里。它是 ui-conversation 包提供的
// 服务，而 ui-conversation 的 inject 里有 `layout` —— 本 profile 下 `layout` 由
// canvas-studio 用 `ctx.reflect.provide('layout', …)` 提供。一旦本插件 inject
// `conversation`，依赖图就成环（studio → conversation → layout → studio），loader
// 里三个 entry 的 fiber 永远进不了 ACTIVE，桌面启动直接报
// 「Renderer boot failed for 3 plugin(s)」（2026-08-31 实测）。官方插件
// （ui-commands、ui-model-selection）也都是在调用处 `ctx.get('conversation')`
// 惰性取服务，不在 inject 里声明。
export const inject = ['slots', 'workspaces', 'conversationEvents', 'sessions', 'connection', 'settingsScope', 'theme']

/** Dev-only seed sample media so the canvas is verifiable without a backend. */
const SEED_IMAGE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="260" height="180">'
  + '<rect width="100%" height="100%" fill="#4285f4"/>'
  + '<text x="50%" y="50%" fill="white" font-size="18" text-anchor="middle" dominant-baseline="middle">种子示例图</text>'
  + '</svg>',
)}`
const SEED_VIDEO = 'https://example.invalid/canvas-studio-seed/sample.mp4'

/** Pending-node placeholder box size per kind. */
const NODE_SIZE_PENDING: Readonly<Record<'image' | 'video' | 'audio', { width: number; height: number }>> = {
  image: { width: 260, height: 180 },
  video: { width: 260, height: 180 },
  // CV-130：音频占位与落盘尺寸同源（契约常量），否则生成中/生成后卡片会跳高。
  audio: { width: AUDIO_NODE_WIDTH, height: AUDIO_NODE_HEIGHT },
}

/**
 * Build dev-seed nodes for a project: an image, a video derived from it
 * (bloodline edge), and a sticky note — enough to exercise every node kind,
 * the edge renderer, and the timeline without a live Drama Backend.
 */
function seedNodes(): StudioCanvasNode[] {
  const now = Date.now()
  return [
    {
      id: 'seed-image',
      kind: 'image',
      url: SEED_IMAGE,
      title: '示例图',
      x: 40,
      y: 40,
      width: 260,
      height: 180,
      createdAt: now,
      origin: 'manual',
      sourceIds: [],
    },
    {
      id: 'seed-video',
      kind: 'video',
      url: SEED_VIDEO,
      title: '示例视频',
      x: 340,
      y: 40,
      width: 260,
      height: 180,
      createdAt: now + 1,
      origin: 'manual',
      sourceIds: ['seed-image'],
    },
    {
      id: 'seed-sticky',
      kind: 'sticky',
      text: '种子便签：演示文本 / 提示节点与画布交互',
      x: 40,
      y: 300,
      width: 220,
      height: 140,
      createdAt: now + 2,
      origin: 'manual',
      sourceIds: [],
    },
  ]
}

/**
 * Client plugin body: provide the standard ctx.layout contract (owned by the
 * disabled ui-layout row) and register the studio frame into the runtime's
 * built-in root slot, declaring the standard child seats so the upstream
 * sidebar/conversation/details plugins keep their registration paths.
 *
 * Project switching binds the conversation to the project's workspace: each
 * project owns one workspace registered at its disk directory, and opening a
 * project connects (reusing a blank session) and navigates to it. The canvas
 * nodes for that project are loaded (and, with `?cs-dev-seed=1`, seeded) here.
 * @param ctx - active browser Cordis context.
 */
export function apply(ctx: ClientContext): void {
  ctx.logger.info('canvas-studio client v2 loaded')
  // 开发模式显式声明一次（设计文档 §8）：客户端与 Host 各设一次。默认关闭 ——
  // 渲染进程若没有 process（打包后），resolveDevModeFromProcess() 返回 false，
  // 于是错误文案不会带上 `[dev]` 内部细节。
  setDevMode(resolveDevModeFromProcess())
  // The desktop advanced shell owns the root slot with its own children
  // declarations; the studio frame is a compatibility-mode surface, so the
  // desktop's advanced frame keeps the desktop presentation unchanged.
  const params = new URLSearchParams(window.location.search)
  if (params.get('dsh-desktop-mode') === 'advanced') {
    ctx.logger.warn(
      'canvas-studio: advanced desktop mode keeps the desktop frame; switch the desktop profile to compatibility mode to use the studio layout',
    )
    return
  }
  const devSeed = params.get('cs-dev-seed') === '1'
  const layout = new StudioLayoutController()
  // 唯一的 store 实例：apply 世界（workspace 订阅、capture 回调、openProject）
  // 与 React 组件（经 inject hooks 舱的 useStudio）读写同一个实例。不能再把
  // store 座位交给框架 —— 框架会按 handle×scopeKey 再 create() 一个独立实例，
  // 两个实例互不可见，导致「选中了项目但画布永远空态」。
  const storeInstance = createProjectStore().create()
  /**
   * 把一次界面级失败写进 store —— **文案与结构化错误码一起**（CV-233）。
   *
   * 三类 cause，处理方式不同：
   * - `StudioApiError`（HTTP 层）：`message` 已过服务端 `routeError`，是脱敏后的可读
   *   文案（非展示类错误给的是中性中文兜底），`code` 带原始错误码 → 一起写进 store，
   *   三态卡按码判定处置级别而不是猜文案。
   * - `CanvasStudioError`（本地抛出、已登记）：用 `userMessage` + `code`。
   * - 其余未知异常：**不**把它的 message 当文案。这类 message 常是框架内部标识
   *   （`workspace-name-conflict`）或英文系统串（`Failed to fetch`），用户看不懂也
   *   无从下手；细节进日志，界面给本次动作的中文兜底文案，并**不带码** —— 没码时
   *   三态卡走启发式兜底，正好把 `Failed to fetch` 归到「服务不可达」。
   */
  const failWith = (cause: unknown, fallback: string): void => {
    if (cause instanceof StudioApiError) {
      storeInstance.actions.setFailed(cause.message, cause.code)
      return
    }
    if (cause instanceof CanvasStudioError) {
      storeInstance.actions.setFailed(cause.userMessage, cause.code)
      return
    }
    ctx.logger.warn(`[canvas-studio] ${fallback}: ${cause instanceof Error ? cause.message : String(cause)}`)
    storeInstance.actions.setFailed(fallback)
  }
  // 类型收窄：`Context.sessions` 在类型图里既被 `@deepseek-ai/dsh-session`
  // （Host 端 SessionStore）也被 `@deepseek-ai/dsh-client-runtime`（ISessions）
  // 增强，编译时前者胜出导致 `ctx.sessions` 被解析成原始 API（无 open/binding/
  // 响应式 list）。客户端运行时实际挂载的是 ISessions，故在此以一致签名收窄。
  const sessionSvc = ctx.sessions as unknown as ISessions
  // REQ-021：编排等待原语（waitSessionBound / waitAgentTurn）绑定到本运行时的
  // 会话服务。runEffectTests 与自动测试场景执行器共用同一实例——「回合空闲判据」
  // 只准一份实现（见 test-driver.ts 头注）。
  const testDriver = createTestDriver(sessionSvc)

  // 载入结果（节点 + 视图）统一进 store：视图缺失（v3 之前的文档）时保持
  // 默认视口并标记 saved=false，帧层会对内容适配一次视野。
  const applyLoadedCanvas = (
    projectId: string,
    loaded: { nodes: readonly StudioCanvasNode[]; view: StudioCanvasView | null },
  ): void => {
    storeInstance.actions.setNodes(projectId, loaded.nodes)
    storeInstance.actions.setView(projectId, loaded.view ?? {}, loaded.view !== undefined)
  }

  // 画布读写串行化（验收反馈 2026-08-25「删除后重开又出现」）：删除的保存
  // （POST）与 tool/result 触发的画布重载（GET → 整表替换 store）并发时，
  // GET 可能先带回旧磁盘状态覆盖 store，随后的保存再把旧状态写回盘 —— 删除
  // 就丢了。所有画布读改写都排进同一条 Promise 链，严格按触发顺序执行；
  // 保存永远取执行时刻的最新快照，因此队列里最后一次保存就是最终真相。
  let canvasIoChain: Promise<unknown> = Promise.resolve()
  const enqueueCanvasIo = <T>(job: () => Promise<T>): Promise<T> => {
    const next = canvasIoChain.then(job, job)
    canvasIoChain = next.catch(() => {})
    return next
  }
  /** 从磁盘重载某项目画布进 store（排队执行，避免与保存交错）。 */
  const reloadCanvasQueued = (projectId: string): Promise<void> => enqueueCanvasIo(async () => {
    try {
      applyLoadedCanvas(projectId, await loadStudioCanvas(projectId))
    } catch {
      /* 重载失败静默：下一次打开项目仍会载入 */
    }
  })

  /** 画布持久化（排队执行；剔除瞬态占位节点）。与 props.persistCanvas 同一语义。 */
  const persistCanvasQueued = (projectId: string): Promise<void> => enqueueCanvasIo(async () => {
    const snapshot = storeInstance.getSnapshot()
    const nodes = (snapshot.nodes[projectId] ?? []).filter(node => !isTransientNode(node))
    // CV-242：随保存上送「显式删除」账本，成功后清账（失败保留，下次保存补送）。
    const removedIds = snapshot.pendingRemovedIds[projectId] ?? []
    await saveStudioCanvas(projectId, nodes, viewOf(snapshot, projectId).view, removedIds)
    if (removedIds.length > 0) storeInstance.actions.clearRemovedNodes(projectId, removedIds)
  })

  // CV-066：装载 / 卸载 skill —— store 即时更新 + skills.json 持久化。整表替换
  // 幂等，失败回滚 store（避免 UI 显示与磁盘不一致）。
  const activateSkill = async (projectId: string, name: string): Promise<void> => {
    storeInstance.actions.activateSkill(projectId, name)
    const next = activeSkillsOf(storeInstance.getSnapshot(), projectId)
    try {
      await saveActiveSkills(projectId, next)
    } catch (cause) {
      storeInstance.actions.setActiveSkills(projectId, next.filter(candidate => candidate !== name))
      throw cause
    }
  }
  const deactivateSkill = async (projectId: string, name: string): Promise<void> => {
    const before = activeSkillsOf(storeInstance.getSnapshot(), projectId)
    storeInstance.actions.deactivateSkill(projectId, name)
    const next = activeSkillsOf(storeInstance.getSnapshot(), projectId)
    try {
      await saveActiveSkills(projectId, next)
    } catch (cause) {
      storeInstance.actions.setActiveSkills(projectId, before)
      throw cause
    }
  }

  // 会话级项目归属：画布应跟随「当前会话绑定的 workspace」，而非仅用户手动点击
  // 的项目行。Host 写入产物时用的是会话 cwd（workspace 目录）解析出的 projectId；
  // 应用重启后会话会自动恢复到某 workspace，但 selectedProjectId 是内存态会丢失，
  // 导致画布显示空态 —— 而产物其实已落在该项目的 canvas.json（这正是「小猪已生成
  // 但画布空白」的根因）。这里把当前 workspace 映射回项目，保持选中态与画布内容一致。
  const resolveActiveProjectId = (): string | null => {
    const manual = storeInstance.getSnapshot().selectedProjectId
    if (manual !== null) return manual
    const snapshot = ctx.workspaces.list.getSnapshot()
    if (!snapshot.baselinesReady) return null
    const projects = storeInstance.getSnapshot().projects
    // CV-034：优先用「当前会话的 cwd」映射 —— 画布跟随对话区当前打开的会话。
    // recentWorkspaceId 是「会话最新的 workspace」推导值：孤儿 workspace（项目
    // 已删但残留，或旧版本删除不摘 workspace）的空会话会把它带偏，导致启动后
    // 「对话有内容、画布空、列表无选中」的三不一致（2026-08-28 用户实测）。
    const sessions = sessionSvc.list.getSnapshot()
    const current = sessions.current === undefined ? undefined : sessions.byId[sessions.current]
    if (current !== undefined && current.cwd !== undefined) {
      const bound = projects.find((entry) => entry.dir === current.cwd)
      if (bound !== undefined) return bound.id
    }
    const recentId = snapshot.recentWorkspaceId
    if (recentId === undefined) return null
    const view = snapshot.items.find((item) => item.workspaceId === recentId)
    if (view === undefined || view.path === undefined) return null
    const project = projects.find((entry) => entry.dir === view.path)
    return project?.id ?? null
  }

  // 方案 B（2026-09-05）：对话附件旁路。用户在输入框贴参考图后点发送，图片
  // 不再作为 base64 content block 塞给模型（纯文本模型会报「当前模型不支持
  // 图片」），而是落盘 + 画布落**普通素材节点**（不自动标记参考，由用户在详情
  // 面板手动标记）→ 正文追加 @ref[标题] 引用标记，Host 生成工具可无损解析成
  // Drama filename。旁路处理器注册到 conversation 服务的 sendSession（唯一附件
  // 提交入口，见 ui-conversation service.ts）。
  // 2026-09-05 体验优化（两段式）：发送只等「项目 assets 落盘」（毫秒级），
  // Drama 公网上传由后台预热接力（skill 编排的前置确认就是时间窗）；没传完
  // 也不坏——生成时 @ref 解析有惰性兜底（host-tools.resolveRefFilenames 现场
  // 读盘上传并回写）。
  interface DeferredAsset { url: string; assetFile: string }
  const promoteDeferredAssets = (projectId: string, deferred: readonly DeferredAsset[]): void => {
    for (const item of deferred) {
      void (async () => {
        try {
          const filename = await promoteStudioImage(projectId, item.assetFile)
          const node = storeInstance.getSnapshot().nodes[projectId]?.find((entry) => entry.url === item.url)
          if (node === undefined || node.filename === filename) return
          storeInstance.actions.updateNode(projectId, node.id, { filename })
          void persistCanvasQueued(projectId)
        } catch (cause) {
          // 后台预热失败静默（仅日志）：生成时 @ref 惰性兜底会现场重试。
          ctx.logger.warn(`canvas-studio: deferred Drama promote failed for ${item.assetFile}: ${cause instanceof Error ? cause.message : String(cause)}`)
        }
      })()
    }
  }
  /** 内容指纹（SHA-256 hex）：同字节图片复用已有节点（草稿还原重发 / 双击免疫）。 */
  const sha256Hex = async (buffer: ArrayBuffer): Promise<string> => {
    const digest = await crypto.subtle.digest('SHA-256', buffer)
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  /** 按内容哈希找已有素材节点（contentHash 持久在 canvas.json，重启后依然生效）。 */
  const findNodeByHash = (projectId: string, hash: string): StudioCanvasNode | undefined =>
    (storeInstance.getSnapshot().nodes[projectId] ?? []).find((node) => node.kind === 'image' && node.contentHash === hash)
  /**
   * 一批文件落进画布的结论。
   *
   * `landed` **按入参下标对齐**：调用方（首页暂存条）靠它判定哪些条目可以摘掉、
   * 哪些要留着让用户重试 —— 落盘失败必须可归因到具体文件，否则只能整批丢或整批留。
   */
  interface LandOutcome {
    /** 该下标的文件是否真的成了画布素材（节点回查命中才算）。 */
    landed: readonly boolean[]
    /** 落成素材的 `@ref` 令牌（顺序与 files 里的成功项一致）。 */
    tokens: readonly string[]
    /** 图片的待后台提升清单（Drama 句柄预热）。 */
    deferred: readonly DeferredAsset[]
  }
  /**
   * 把一批本地文件落进某项目的画布（**四类**：图片 / 视频 / 音频 / 文本）。
   *
   * CV-261 起抽出复用：此前只有「对话附件旁路」用（宿主的附件通道固定只收图片，
   * `imageMediaTypes` = png/jpeg/webp/gif），现在首页暂存条的落盘走**同一份**实现 ——
   * 同一个文件「在项目里直接拖入」与「首页拖入后发送」必须得到同一个节点、同一个
   * 令牌、同一个文件名，两套实现迟早分叉成「首页拖的视频不落卡」。
   *
   * 两阶段：先并行**准备**（图片解码 + 落盘 / 其余三类落盘），再串行**落卡** ——
   * 落卡顺序必须等于文件顺序，否则 `deriveNodePlacement` 的连排落点会乱序。
   *
   * 单件失败不牵连整批：`prepare` 逐件 catch，失败件记 `landed[i] = false`，其余照落。
   */
  const landStudioFiles = async (
    projectId: string,
    files: readonly File[],
    signal?: AbortSignal,
  ): Promise<LandOutcome> => {
    // 标题唯一化（2026-09-07）：剪贴板粘贴的 File.name 恒为 image.png，多张
    // 重名 → @ref[token] 无法区分（parseRefTokens 按名去重，同消息第二条同名
    // 引用被静默丢弃）。以项目已有节点标题为基线，重名追加序号（image 2.png）。
    // uniqueTitle 会把新标题写回集合，故整批一次算完即完成批次内去重。
    const usedTitles = new Set<string>()
    for (const node of storeInstance.getSnapshot().nodes[projectId] ?? []) {
      if (node.title !== undefined && node.title !== '') usedTitles.add(node.title)
    }
    const titles = files.map((file) => uniqueTitle(file.name, usedTitles))
    interface Prepared {
      index: number
      kind: MediaKind
      title: string
      url: string
      /** 仅 image：磁盘文件名（后台提升 Drama 句柄用）。 */
      assetFile?: string
      /** 仅 image：内容指纹（同字节去重）。 */
      contentHash?: string
      /** 仅 image：探测到的真实尺寸。 */
      display?: Parameters<typeof storeInstance.actions.addImportNode>[6]
      /** 仅 video：服务端探测的时长（秒，0 = 未知）。 */
      duration?: number
      /** 仅 text：正文截断（详情面板可读）。 */
      body?: string
    }
    // 快速段并行化：5 张图从串行 ~230ms 压到 ~1 次往返。
    const prepared = await Promise.all(files.map(async (file, index): Promise<Prepared | null> => {
      const kind = classifyFile(file.name)
      if (kind === null) return null
      // 标题已在外层批量唯一化（uniqueTitle），此处直接取用。
      const title = titles[index] as string
      try {
        if (kind === 'image') {
          // 直接走 ArrayBuffer：file.text() 会按 UTF-8 解码二进制破坏图片头字节
          // （与工具条上传 handleUploadImage 同一坑，见该处注释）。
          const buffer = await file.arrayBuffer()
          const [dataBase64, contentHash] = await Promise.all([
            Promise.resolve(bytesToBase64(new Uint8Array(buffer))),
            sha256Hex(buffer),
          ])
          // 快速段：只落盘拿同源 url（毫秒级），Drama filename 稍后后台回填。
          const { url, assetFile } = await uploadLocalStudioImageDeferred(projectId, file.name, dataBase64, signal)
          // 探测真实宽高（与工具条上传一致；解码失败回退默认尺寸并由媒体加载校正兜底）。
          let display: Prepared['display']
          try {
            const bitmap = await createImageBitmap(new Blob([buffer]))
            display = {
              ...previewSizeOf({ width: bitmap.width, height: bitmap.height }),
              mediaWidth: bitmap.width,
              mediaHeight: bitmap.height,
            }
            bitmap.close()
          } catch {
            display = undefined
          }
          return { index, kind, title, url, assetFile, contentHash, display }
        }
        if (kind === 'video') {
          // 视频走独立端点（Host 落盘 + 探时长）；**不预提升 Drama 句柄** ——
          // 整段视频发远端耗时随大小线性增长，句柄由 @ref 首次引用时惰性补上
          // （与工具条 handleUploadVideo 同一口径，落卡事实也必须一致）。
          const payload = await uploadStudioVideo(projectId, file, signal)
          return { index, kind, title, url: payload.videoUrl, duration: payload.duration }
        }
        const { url } = await uploadStudioMedia(projectId, file, signal)
        if (kind === 'text') {
          return { index, kind, title, url, body: (await file.text()).slice(0, 4000) }
        }
        return { index, kind, title, url }
      } catch (cause) {
        // 日志只记事实，不弹提示：调用方（发送链路 / 暂存落盘）负责用户可见的说明。
        ctx.logger.warn(`canvas-studio: land ${kind} "${file.name}" failed: ${cause instanceof Error ? cause.message : String(cause)}`)
        return null
      }
    }))
    // 用户拍板（2026-09-05）：旁路落**普通素材节点**，不自动标记参考，
    // 由用户在详情面板手动标记；@ref 解析侧已支持普通节点兜底命中。
    const landed = files.map(() => false)
    const tokens: string[] = []
    const deferred: DeferredAsset[] = []
    for (const item of prepared) {
      if (item === null) continue
      if (item.kind === 'image') {
        // 内容去重：同字节图片（草稿还原后重发 / 双击 / 同消息内重复）复用已有
        // 节点——不重复落盘、不重复上传 Drama、不重复落卡，token 指向同一节点。
        // 实测（2026-09-05）：同一草稿 41s 内发了两次 → 两批节点 + 两次 Drama 上传。
        // 指纹与磁盘句柄在 image 分支必然存在（上面那一段刚赋的值），空串兜底只是
        // 让类型收窄得干净，不会真的走到。
        const contentHash = item.contentHash ?? ''
        const assetFile = item.assetFile ?? ''
        const existing = findNodeByHash(projectId, contentHash)
        if (existing !== undefined) {
          // CV-114：句柄用 node id（标题会重名/被改名，id 唯一稳定）。
          tokens.push(formatRefToken(existing.id))
          landed[item.index] = true
          continue
        }
        // 用户拍板（2026-09-05 22:22 修订）：附件节点**自动标记为参考**（role=image）
        // 进参考托盘——agent 调 list_references 能直接看到用户上传的素材；
        // 具体定位（角色/风格/首末帧）仍由用户在详情面板手动调整。
        // select=false（用户拍板 2026-09-13）：聊天发图是后台静默旁路，副作用
        // 不得抢画布选中 —— 否则每发一张图，聚光随选区跳变，画布「自己蒙蓝」。
        storeInstance.actions.addImportNode(projectId, item.url, item.title, undefined, undefined, true, item.display, contentHash, false)
        // addImportNode 不返回 id：按 url 回查刚落的节点拿 id 作引用句柄
        // （CV-114）。查不到时降级用标题——Host 侧仍有标题兜底匹配。
        const created = (storeInstance.getSnapshot().nodes[projectId] ?? []).find((node) => node.url === item.url)
        if (created === undefined) {
          // 节点表尚未建立（画布未载入完就落卡）——令牌退回标题兜底，但**不算落成**：
          // 落成与否决定暂存条目留不留，谎报成功会让用户的文件静默消失。
          ctx.logger.warn(`canvas-studio: landed node not found by url (${item.kind}) — canvas not loaded?`)
        }
        landed[item.index] = created !== undefined
        tokens.push(formatRefToken(created?.id ?? item.title))
        if (assetFile !== '') deferred.push({ url: item.url, assetFile })
        continue
      }
      // 视频 / 音频 / 文本：三类各走自己的落卡动作（节点形态不同：视频有框、
      // 音频是窄条、文本是便签）。这三条动作不带 select 开关，落卡会自动选中
      // 最后一个 —— 与图片那条「静默旁路」的差别来自动作面本身的能力，不在这里补。
      if (item.kind === 'video') {
        storeInstance.actions.addVideoNode(projectId, {
          url: item.url,
          title: item.title,
          ...(typeof item.duration === 'number' && item.duration > 0 ? { duration: item.duration } : {}),
        })
      } else if (item.kind === 'audio') {
        storeInstance.actions.addAudioNode(projectId, item.url, item.title)
      } else {
        storeInstance.actions.addTextAssetNode(projectId, item.url, item.body ?? '', item.title)
      }
      const created = (storeInstance.getSnapshot().nodes[projectId] ?? []).find((node) => node.url === item.url)
      landed[item.index] = created !== undefined
      if (created === undefined) ctx.logger.warn(`canvas-studio: landed node not found by url (${item.kind}) — canvas not loaded?`)
      tokens.push(formatRefToken(created?.id ?? item.title))
    }
    // 旁路落卡走同一串行持久化队列，避免与工具产物触发的画布重载交错。
    if (tokens.length > 0 || deferred.length > 0) {
      void persistCanvasQueued(projectId)
      // 后台预热：不阻塞发送；完成后把 filename 回填节点并落盘。
      if (deferred.length > 0) promoteDeferredAssets(projectId, deferred)
    }
    return { landed, tokens, deferred }
  }
  const divertAttachments = async (
    files: readonly File[],
    text: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> => {
    if (files.length === 0) return undefined
    const projectId = resolveActiveProjectId()
    if (projectId === null) return undefined
    const { tokens } = await landStudioFiles(projectId, files, signal)
    if (tokens.length === 0) return text.trim() === '' ? undefined : text
    const tokenText = tokens.join(' ')
    return text.trim() === '' ? tokenText : `${text}\n${tokenText}`
  }
  /**
   * CV-261：首页暂存素材 → 落画布。返回要追加进正文的 `@ref` 串（无暂存 / 全失败 = 空串）。
   *
   * 与 `divertAttachments` 共用 `landStudioFiles`：同一个文件「首页拖入后发送」与
   * 「项目里直接拖入」必须落出同一个节点。差别只在**入口**（清单来自 store 而不是
   * 宿主的附件 id）与**失败处置**：
   *
   * 失败件**留在清单里**（只摘落成的那几条）—— 回首页还能看见，还能重发。这是本题的
   * 起点：用户上一次的反馈正是「文件静默消失，只留一句『仅支持 PNG…』」，落盘失败
   * 又把文件吞掉一次，等于同一个坑踩两遍。
   */
  const landLobbyStash = async (projectId: string, signal?: AbortSignal): Promise<string> => {
    const items = storeInstance.getSnapshot().lobbyStash
    if (items.length === 0) return ''
    const pairs = takeLobbyStashFiles(items)
    // 清单里有、文件表里没有的幽灵条目（理论上不该出现）：一并清掉，否则会留下
    // 一条永远落不下去、点发送也永远失败的 chip。
    const ghosts = items.filter((item) => !pairs.some((pair) => pair.item.id === item.id))
    if (pairs.length === 0) {
      releaseLobbyStash(ghosts)
      for (const item of ghosts) storeInstance.actions.dismissLobbyStash(item.id)
      return ''
    }
    const outcome = await landStudioFiles(projectId, pairs.map((pair) => pair.file), signal)
    const done = pairs.filter((_, index) => outcome.landed[index] === true).map((pair) => pair.item)
    const kept = pairs.filter((_, index) => outcome.landed[index] !== true).map((pair) => pair.item)
    const consumed = [...done, ...ghosts]
    releaseLobbyStash(consumed)
    for (const item of consumed) storeInstance.actions.dismissLobbyStash(item.id)
    if (kept.length > 0) {
      // 提示出口在 StudioFrame（toast），这里只留事实；用户回首页看得到未落成的条目。
      ctx.logger.warn(`canvas-studio: lobby stash kept ${String(kept.length)} item(s) — landing failed, still stashed`)
    }
    return outcome.tokens.join(' ')
  }

  // CV-114：把画布素材接进聊天输入框的引用管线——
  // ① 注册 '@' 候选源：在输入框打 @ 能搜到画布素材并选中插入 chip；
  // ② 提供「把素材插成同一个 chip」的通道给右键菜单 / 参考托盘 / 详情面板。
  // 上游服务缺失（或签名漂移）时整体跳过，三处入口自动降级为纯文本 @ref 注入。
  const currentSessionId = (): string | undefined => sessionSvc.list.getSnapshot().current
  const activeAssetHandles = (): readonly AssetHandle[] => {
    const projectId = storeInstance.getSnapshot().selectedProjectId
    if (projectId === null) return []
    return buildAssetHandles(storeInstance.getSnapshot().nodes[projectId] ?? [])
  }
  // 注册走「等服务就绪」：canvas-studio 的 apply 通常早于 ui-input-trigger 的
  // fiber ACTIVE，直接 get 会拿到 undefined 而静默不注册（@ 菜单无画布分组）。
  registerCanvasAssetSourceWhenReady(ctx, {
    assets: activeAssetHandles,
    sessionId: currentSessionId,
  })
  /** 「引用到对话」插入真 chip；false = 调用方降级为纯文本注入。 */
  const insertAssetChipForNode = (nodeId: string): boolean => {
    const asset = activeAssetHandles().find((item) => item.nodeId === nodeId)
    if (asset === undefined) return false
    return insertAssetChip(ctx, currentSessionId(), asset)
  }

  // REQ-001：`@` 资产库源（order -2 → 菜单分区：资产库 / 画布素材 / 工作区文件）。
  // 候选取 store.libraryAssets 缓存；静默预热一次（失败不打扰——菜单退化为空区，
  // 用户开资产库页或下次变更会补上）。
  registerLibAssetSourceWhenReady(ctx, {
    library: () => storeInstance.getSnapshot().libraryAssets,
    sessionId: currentSessionId,
  })
  void listLibraryAssets()
    .then((assets) => storeInstance.actions.setLibraryAssets(assets))
    .catch(() => {})
  /** 资产库条目插真 chip（详情抽屉「引用到对话」；false = 降级纯文本注入）。 */
  const insertLibChipForId = (assetId: string): boolean => {
    const asset = storeInstance.getSnapshot().libraryAssets.find((item) => item.id === assetId)
    if (asset === undefined) return false
    return insertLibChip(ctx, currentSessionId(), asset)
  }

  // CV-124：技能接进同一条引用管线——
  // ① 注册 '/' 候选源：输入框行首打 / 能搜技能并选中插入 chip；
  // ② 「使用」按钮走 insertSkillChip 插同一个 chip，失败降级纯文本注入。
  registerCanvasSkillSourceWhenReady(ctx, {
    skills: () => VISIBLE_CATALOG,
    sessionId: currentSessionId,
  })
  const insertSkillChipForName = (name: string): boolean => {
    const skill = VISIBLE_CATALOG.find((item) => item.name === name)
    if (skill === undefined) return false
    return insertSkillChip(ctx, currentSessionId(), skill)
  }

  // CV-023 创意捕获（方案 A）：项目会话第一条真人消息自动落为「创意」文本
  // 节点（画布叙事锚点）。幂等去重在 addBriefNode（每项目至多一个
  // toolName=BRIEF_NODE_TOOL 节点）；合成注入（skill/文件通知等非 user 来源）
  // 不触发。画布未载入时先暂存，任意一次画布重载完成后补落 —— 避免历史重放
  // 早于 reload 完成时，刚落的节点被磁盘真相冲掉。
  const pendingBriefs = new Map<string, string>()
  const flushPendingBrief = (projectId: string): Promise<void> => {
    const text = pendingBriefs.get(projectId)
    if (text === undefined) return Promise.resolve()
    pendingBriefs.delete(projectId)
    try {
      storeInstance.actions.addBriefNode(projectId, text)
    } catch {
      return Promise.resolve()
    }
    return persistCanvasQueued(projectId).catch(() => {})
  }
  ctx.effect(() => ctx.conversationEvents.register(createBriefCaptureDefinition({
    getSelectedProjectId: () => resolveActiveProjectId(),
    hasBriefNode: (projectId) => (storeInstance.getSnapshot().nodes[projectId] ?? [])
      .some((node) => node.toolName === BRIEF_NODE_TOOL),
    onBrief: (projectId, text) => {
      if (storeInstance.getSnapshot().nodes[projectId] !== undefined) {
        storeInstance.actions.addBriefNode(projectId, text)
        void persistCanvasQueued(projectId)
      } else {
        pendingBriefs.set(projectId, text)
      }
    },
  })), 'canvas-studio: brief capture')
  // 旁路注册（无 fork 方案，见 docs/plans/attachment-divert-no-fork.md）：不再
  // 依赖 harness fork 的 registerAttachmentDivert 扩展点——dist 补丁已被证明
  // 会被依赖重装冲掉（2026-09-07 应验）。改为对 conversation 服务的 sendSession
  // 实例方法做运行时包装：它是附件提交唯一入口（ui-conversation service.ts 的
  // sendSession），唯一调用方 InputHub.sink 在调用时经 ctx.get('conversation')
  // 取单例再查方法，实例级包装即可拦截。升级韧性设计：
  //   ① 特征检测——公开 facade（sendSession/draftImages/releaseDraftImages）
  //      不匹配则不安装 + warn，行为静默退回原生，上游内部重构不会崩；
  //   ② rest args 透传——纯文本消息零开销直通，上游加参数不影响直通路径；
  //   ③ disposer 还原原方法——热重载/插件停用不留痕；
  //   ④ divert 失败回落原生 base64 路径（与原补丁语义一致）。
  // conversation 服务由 ui-conversation 包提供，cordis loader 的 fiber 顺序不
  // 保证先于本插件 apply，故短轮询直到服务可用再安装（约 500ms 一拍，30s 仍
  // 不可得则放弃）。绝不能把 `conversation` 放进 inject（见文件顶部环依赖注
  // 释），沿用官方插件的「调用处惰性取服务」写法。
  ctx.effect(() => {
    type SubmitOutcomeLike = { kind: 'success' } | { kind: 'error' }
    type DraftAttachmentLike = { id: string; file: File }
    /** 结构化 facade：不 import 上游内部类型，仅约束 wrapper 触碰的公开面。 */
    type DivertConversation = {
      sendSession(
        session: unknown,
        text: string,
        attachmentIds: readonly string[],
        mode: unknown,
        signal?: AbortSignal,
      ): Promise<SubmitOutcomeLike>
      draftImages(ids: readonly string[]): readonly DraftAttachmentLike[]
      releaseDraftImages(attachments: readonly { id: string }[]): void
    }
    let timer: ReturnType<typeof setInterval> | null = null
    let attempts = 0
    let installed: { conversation: DivertConversation; original: DivertConversation['sendSession'] } | undefined
    const tryInstall = (): void => {
      if (installed !== undefined) return
      const conversation = ctx.get('conversation') as unknown as DivertConversation | undefined
      if (conversation === undefined) {
        attempts += 1
        if (attempts <= 60 && timer !== null) return
        if (timer !== null) { clearInterval(timer); timer = null }
        return
      }
      if (timer !== null) { clearInterval(timer); timer = null }
      if (
        typeof conversation.sendSession !== 'function'
        || typeof conversation.draftImages !== 'function'
        || typeof conversation.releaseDraftImages !== 'function'
      ) {
        ctx.logger.warn('canvas-studio: conversation sendSession facade not detected (upstream changed?), attachment divert disabled — native behavior preserved')
        return
      }
      const original = conversation.sendSession
      /** 附件改道链路（CV-247 原逻辑，抽出复用）：纯文本直通，带图落盘 + @ref。 */
      const divertSend = (args: Parameters<DivertConversation['sendSession']>): Promise<SubmitOutcomeLike> => {
        const [session, text, attachmentIds, mode, signal] = args
        if (attachmentIds.length === 0) return original.apply(conversation, args)
        const attachments = conversation.draftImages(attachmentIds)
        if (attachments.length === 0 || attachments.length !== attachmentIds.length) {
          return original.apply(conversation, args)
        }
        const files = attachments.map((attachment) => attachment.file)
        return divertAttachments(files, text, signal)
          .then((divertedText) => {
            // 无激活项目等场景：divertAttachments 返回 undefined → 原生路径。
            if (divertedText === undefined) return original.apply(conversation, args)
            // 纯文本提交（空附件列表）；成功后自行释放草稿（含 blob URL 回收），
            // 与原补丁「草稿在 prompt 成功结算后才释放」语义一致。
            return original.call(conversation, session, divertedText, [], mode, signal)
              .then((result) => {
                if (result.kind === 'success') conversation.releaseDraftImages(attachments)
                return result
              })
          })
          .catch((cause: unknown) => {
            ctx.logger.warn(`canvas-studio: attachment divert failed, fallback to native: ${cause instanceof Error ? cause.message : String(cause)}`)
            return original.apply(conversation, args)
          })
      }
      // ── REQ-005 v1.3（变体 A）：首页（lobby）发送 → 先认领 draft 目录为项目 ──
      // 认领成功后按正常链路放行（会话不变 —— cwd 即项目目录；附件走改道；无孤儿）。
      // 任何认领失败返回 { kind:'error' } → 宿主保草稿不丢创意（SubmitOutcome 契约）。
      let claiming = false
      /**
       * 认领失败必须**可见**（2026-10-04）。此前只写一条客户端日志（不落文件）并返回
       * `{ kind:'error' }`，界面零反馈 —— 用户看到的就是「点了发送没反应」。改写进统一
       * 错误面：ProjectList 的 StudioErrorState（非阻塞卡片 + 重试按钮）。
       */
      const reportClaimFailure = (cause: unknown): void => {
        storeInstance.actions.setFailed(
          '没能创建项目：项目保存位置可能已变更。请重新发送；若仍失败，请到设置里确认「资产库位置」后重启应用。',
        )
        ctx.logger.warn(`canvas-studio: lobby claim failed (surfaced to user): ${cause instanceof Error ? cause.message : String(cause)}`)
      }
      const claimAndSend = (args: Parameters<DivertConversation['sendSession']>): Promise<SubmitOutcomeLike> => {
        // 双击防抖：认领进行中的第二次发送直接 error 保草稿（不并发建两个项目）。
        if (claiming) return Promise.resolve({ kind: 'error' })
        claiming = true
        const attempt = async (dir: string): Promise<StudioProject> => {
          const spec = storeInstance.getSnapshot().lobbySpec
          // D2：摘要命名 + 本地去重；E11 撞名由外层 refreshProjects 后重算重试。
          const name = dedupeProjectName(
            summarizeName(args[1]),
            storeInstance.getSnapshot().projects.map((entry) => entry.name),
          )
          const project = await createStudioProjectClaimDir(name, dir, buildPlan(spec), spec.mode)
          await refreshProjects()
          return project
        }
        /**
         * 一次「取会话 cwd → 认领 → 落盘」。
         *
         * `allowStorageRebuild` = 存储根自愈开关（2026-10-04）。用户在会话建立之后改了
         * 「资产库位置」时，会话 cwd 还指在**旧根** draft 目录上，认领必被守卫拒
         * （目录不在当前 projects 根内）。这类失败可自愈：强制重建落点（按新根）→
         * 用新 cwd 原地重试一次。只许重试一次，免得与真失败互相刷请求。
         */
        const once = async (allowStorageRebuild: boolean): Promise<SubmitOutcomeLike> => {
          // 认领严格用当前会话 cwd：会话未就位（落点还在建 / inert 占位）不认领。
          const sessions = sessionSvc.list.getSnapshot()
          const current = sessions.current === undefined ? undefined : sessions.byId[sessions.current]
          const dir = current?.cwd
          if (dir === undefined) return { kind: 'error' }
          let project: StudioProject
          try {
            project = await attempt(dir)
          } catch (cause) {
            const duplicate = isDuplicateProjectName(cause)
            if (duplicate) {
              // E11：本地 projects 快照过期（另一窗口先建了同名）→ 重拉重算重试一次。
              await refreshProjects()
              try {
                project = await attempt(dir)
              } catch (retryCause) {
                ctx.logger.warn(`canvas-studio: lobby claim retry failed: ${retryCause instanceof Error ? retryCause.message : String(retryCause)}`)
                void ensureDraftLanding(!isDuplicateProjectName(retryCause))
                reportClaimFailure(retryCause)
                return { kind: 'error' }
              }
            } else if (allowStorageRebuild) {
              // 最可能的原因：会话 cwd 落在旧根（用户改过「资产库位置」）。强制重建落点
              // 把会话切到新根目录，再用新 cwd 重试一次 —— 用户不必重启应用。
              ctx.logger.warn(`canvas-studio: lobby claim failed, rebuilding landing on current root and retrying once: ${cause instanceof Error ? cause.message : String(cause)}`)
              await ensureDraftLanding(true)
              return once(false)
            } else {
              ctx.logger.warn(`canvas-studio: lobby claim failed: ${cause instanceof Error ? cause.message : String(cause)}`)
              // 目录已被别的窗口认领（双窗口互斥）→ 强制重建落点（Host 顺延新目录），
              // 草稿保留，用户再点发送即落在新目录上。
              void ensureDraftLanding(true)
              reportClaimFailure(cause)
              return { kind: 'error' }
            }
          }
          // 认领成功：选中新项目（select 清 homePinned）+ 载画布；会话不变，首条
          // prompt ACCEPTED 后 blank 翻转 → 自动进 work（CV-064 既有机制）。
          storeInstance.actions.select(project.id)
          // CV-261：**先等画布落到本地真相再落素材**。`addImportNode` 一族在
          // nodes[projectId] 尚未建立时直接 return（节点表是载入才建的），而
          // 认领前的这个项目必然是全新的空项目 —— 抢在重载前面落 = 素材静默不落卡。
          // 串行队列保证这次重载先于随后的 persistCanvasQueued 执行。
          await reloadCanvasQueued(project.id).then(() => flushPendingBrief(project.id))
          syncHasConversation()
          // 首页暂存的素材并进正文（`@ref` 令牌），再走统一的附件改道放行 ——
          // 宿主草稿附件（图片）与暂存素材（四类）最后合成同一条消息。
          const stashTokens = await landLobbyStash(project.id, args[4])
          if (stashTokens !== '') {
            const [session, text, attachmentIds, mode] = args
            const merged = text.trim() === '' ? stashTokens : `${text}\n${stashTokens}`
            args = [session, merged, attachmentIds, mode, args[4]]
          }
          return divertSend(args)
        }
        return once(true).finally(() => { claiming = false })
      }
      conversation.sendSession = (...args: Parameters<DivertConversation['sendSession']>): Promise<SubmitOutcomeLike> => {
        // lobby 判定：基线就绪且当前会话不映射任何项目（首页/启动无选中）。
        // 基线未就绪时不误判（resolveActiveProjectId 那时恒 null）。
        if (ctx.workspaces.list.getSnapshot().baselinesReady && resolveActiveProjectId() === null) {
          return claimAndSend(args)
        }
        return divertSend(args)
      }
      installed = { conversation, original }
    }
    timer = setInterval(tryInstall, 500)
    tryInstall()
    return () => {
      if (timer !== null) { clearInterval(timer); timer = null }
      if (installed !== undefined) {
        installed.conversation.sendSession = installed.original
        installed = undefined
      }
    }
  }, 'canvas-studio: conversation attachment divert')

  /** 挑工作区里 updatedAt 最新的非空会话（排除 archived）；没有则 undefined。 */
  const latestResumableSession = (workspaceId: string) => {
    const workspaces = ctx.workspaces.list.getSnapshot()
    const entry = workspaces.items.find(item => item.workspaceId === workspaceId)
    if (entry === undefined) return undefined
    const sessions = sessionSvc.list.getSnapshot()
    const byId = sessions.byId
    return (entry.sessionIds as string[])
      .map((id: string) => byId[id])
      .filter((summary): summary is NonNullable<(typeof byId)[string]> =>
        summary !== undefined
        && summary.blank !== true
        && !workspaces.archivedSessionIds.includes(summary.id))
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]
  }
  /** 恢复工作区最近的非空会话（已在目标会话时是空操作）；无历史返回 false。 */
  const resumeLatestSession = (workspaceId: string): boolean => {
    const resumable = latestResumableSession(workspaceId)
    if (resumable === undefined) return false
    if (sessionSvc.list.getSnapshot().current !== resumable.id) sessionSvc.open(resumable.id)
    return true
  }

  const syncActiveProject = (): void => {
    // REQ-005 / CV-256（§5.3）：回首页后抑制「最近 workspace → 项目」回填。
    // workspaces / sessions 任何变化都会跑这里，不短路就会把停在首页的用户
    // 立刻踢回 work 态（品牌区回首页形同虚设）。解除时机见 project-store 的
    // `select` —— 任何 projectId !== null 的选中都视作离开首页。
    if (storeInstance.getSnapshot().homePinned) return
    const id = resolveActiveProjectId()
    if (id === null) return
    if (storeInstance.getSnapshot().selectedProjectId === id) return
    storeInstance.actions.select(id)
    void (async () => {
      await reloadCanvasQueued(id).then(() => flushPendingBrief(id))
      void refreshWorkflow(id)
    })()
  }

  // CV-064 二期：把「当前项目是否有过对话」同步进 store（三态布局判据）。
  // 判据 = 会话列表里**当前会话**的 blank 字段：blank=true 无对话；首条 prompt
  // ACCEPTED 后上游 manager 自动镜像 blank→false 进 list row（subscribe 触发），
  // 无需等 agent 响应即可立即切 work。内存态不持久化 —— 打开项目 / 会话变化
  // 时现算覆盖。会话基线未就绪（首拉 pending）时不动，避免误写 false。
  const syncHasConversation = (): void => {
    const projectId = resolveActiveProjectId()
    if (projectId === null) return
    const sessions = sessionSvc.list.getSnapshot()
    if (sessions.phase === 'pending') return
    const current = sessions.current === undefined ? undefined : sessions.byId[sessions.current]
    const has = current !== undefined && current.blank !== true
    if ((storeInstance.getSnapshot().hasConversation[projectId] ?? false) !== has) {
      storeInstance.actions.setHasConversation(projectId, has)
    }
  }

  // ── REQ-005 v1.3（变体 A）：首页 draft 落点 ────────────────────────────────
  // 首页 = projectId === null，宿主卡的发送/附件都要落到一个真实 workspace/会话
  // （无会话时 composer 是 inert 的「选择工作区」占位，sendSession 根本不会触发）。
  // 落点 = Host 端 draft 目录（projects/.draft-<yyyyMM>，不在 registry）绑定的
  // workspace + blank 会话：宿主卡呈活跃 hero，插件侧仍是 lobby 态。用户发送的
  // 瞬间由 sendSession 拦截分支把该目录认领为项目（见 DivertConversation）。
  /** in-flight 去重：goHome 与启动订阅可能同拍触发，落点动作只跑一份。 */
  let draftLanding: Promise<void> | null = null
  /**
   * 本次运行是否已成功绑过一次落点（CV-260）。
   *
   * 首个落点**不看短路**，一定重跑 workspace.create + startSession：宿主把会话
   * 踢出 workspace membership 之后，会话的 cwd 只剩空串，chipTitle 变 undefined，
   * 首页就卡在 inert 的「选择一个工作区开始」；此时即便目录被 mkdir 重建，会话也
   * 不会自己回到 membership 里 —— 只有重新绑一次才救得回来。两个调用都幂等
   * （workspace 按 path 复用、startSession 复用该工作区的 blank 会话），
   * 代价约等于零；此后的订阅重复触发仍走原短路，保持「零成本」。
   */
  let landedThisRun = false
  /**
   * @param force - 认领失败（draft 目录被别的窗口认领成项目）后的强制重建：
   *   跳过「当前会话已绑目录」短路，重新向 Host 要目录（已认领的会被顺延成
   *   `.draft-YYYYMM-2`）并切会话，用户草稿保留、再点发送即落在新目录上。
   */
  const ensureDraftLanding = (force = false): Promise<void> => {
    if (draftLanding !== null) return draftLanding
    draftLanding = (async () => {
      try {
        const dir = await ensureStudioDraftDir()
        // 当前会话已绑 draft 目录 → 落点就绪（幂等短路，订阅重复触发零成本）。
        if (!force && landedThisRun) {
          const sessions = sessionSvc.list.getSnapshot()
          const current = sessions.current === undefined ? undefined : sessions.byId[sessions.current]
          if (current !== undefined && current.cwd === dir) return
        }
        // workspace.create 按 path 幂等复用既有注册（openProject 同款）。
        const workspace = await ctx.workspaces.create({ path: dir })
        // 切到 draft 工作区会话：startSession 会复用该工作区的 blank 会话（回首页
        // 来回切换不会堆积空会话），没有才新建。fire-and-forget（openProject 同款）。
        sessionSvc.clear()
        ctx.workspaces.startSession(workspace.workspaceId)
        landedThisRun = true
      } catch (cause) {
        // 落点失败 = 首页宿主卡只剩 inert 占位（不崩、不阻塞回首页动作本身），
        // 错误进统一错误面；用户重进首页时订阅会再次触发本函数。
        failWith(cause, '首页准备失败')
      } finally {
        draftLanding = null
      }
    })()
    return draftLanding
  }
  /**
   * 启动/会话变化路径的落点守卫：基线就绪、无手动选中，且（首页意图 homePinned
   * 或当前会话确实不映射任何项目）才建落点。避免「基线未就绪的瞬间」误建 draft。
   */
  const maybeDraftLanding = (): void => {
    if (!ctx.workspaces.list.getSnapshot().baselinesReady) return
    if (sessionSvc.list.getSnapshot().phase === 'pending') return
    if (storeInstance.getSnapshot().selectedProjectId !== null) return
    if (storeInstance.getSnapshot().homePinned || resolveActiveProjectId() === null) {
      void ensureDraftLanding()
    }
  }

  /**
   * 重拉项目注册表进 store（含效果测试半成品清扫）。原在 inject 闭包内，v1.3
   * 起 lobby 认领拦截分支（apply 顶层的 DivertConversation wrapper）也用它，
   * 词法上必须可见，提升到顶层；inject 回调与认领分支共用同一份。
   */
  const refreshProjects = async (): Promise<void> => {
    storeInstance.actions.setPhase('loading')
    try {
      let projects = await listStudioProjects()
      // 效果测试半成品清扫（2026-09-02）：自动化测试中途退出会留下「有注册
      // 记录、无 canvas.json」的空项目（画布文件首次保存才创建）。这类项目
      // 必然没有任何产物，自动删除防残留污染轮次号自增。只清匹配命名规范
      // 的效果验证项目，绝不碰用户手建的项目。
      // 保护窗口：创建时间 10 分钟内的项目一律跳过——本轮编排刚建的项目
      // 在首个节点落盘前必然是空的，不能被自己的清扫误删（竞态实录：
      // createStudioProject → refreshProjects 清扫 → openProject ENOENT）。
      const STALE_GRACE_MS = 10 * 60_000
      const createdMs = (p: { createdAt: string }): number => {
        const t = Date.parse(p.createdAt)
        return Number.isFinite(t) ? t : 0
      }
      const stale = projects.filter((p) => /^效果验证-R\d+-/.test(p.name)
        && Date.now() - createdMs(p) > STALE_GRACE_MS)
      const staleChecks = await Promise.all(stale.map(async (p) => ({
        project: p,
        // readCanvas 对缺失/损坏的 canvas.json 返回空节点表（不抛错）——
        // 空 nodes 即「从未有任何产物落盘」。
        empty: await loadStudioCanvas(p.id).then((doc) => doc.nodes.length === 0).catch(() => false),
      })))
      for (const { project, empty } of staleChecks) {
        if (!empty) continue
        try {
          await deleteStudioProject(project.id)
          const bound = ctx.workspaces.list.getSnapshot().items.find(item => item.path === project.dir)
          if (bound !== undefined) await ctx.workspaces.delete(bound.workspaceId)
        } catch { /* 清扫失败不阻塞启动，下轮再清 */ }
      }
      if (staleChecks.some(({ empty }) => empty)) {
        projects = await listStudioProjects()
      }
      storeInstance.actions.setLoaded(projects)
      // CV-091：分组元信息与项目同源于 Host 注册表，一并载入（失败不阻塞项目列表）。
      try {
        storeInstance.actions.setGroups(await listStudioGroups())
      } catch {
        /* 分组加载失败不阻塞项目列表 */
      }
      // 项目列表就绪后，对齐一次「当前 workspace → 项目」选中态。
      syncActiveProject()
    } catch (cause) {
      failWith(cause, '项目列表加载失败')
    }
  }
  /**
   * E11 判据：Host 撞名拒绝（`projects.ts` create/createClaimingDir → `CS-USER-ERR` +
   * `项目名已存在: xxx` 的中文 message）。`catalog.ts` 的 userMessage 是
   * `{message}` 原样透传，所以这里按码 + 前缀双条件判定，不裸猜中文文案。
   */
  const isDuplicateProjectName = (cause: unknown): boolean =>
    cause instanceof StudioApiError
    && cause.code === 'CS-USER-ERR'
    && cause.message.startsWith('项目名已存在')

  // 验收反馈 2026-08-25「启动后历史对话不显示，点一下项目才出现」：上游的初始
  // 选择策略只恢复最近工作区的**空白**会话（connectWorkspace 复用 blank），项目
  // 已有历史时表现为打开客户端只见空对话 Hero。这里做一次性启动对齐 —— 会话/
  // 工作区基线就绪后，若当前会话缺失或为空白，就恢复该项目工作区最近的非空会话。
  // 仅此一次：用户之后主动新建的空白会话不会被强行跳走。
  let startupSessionAligned = false
  const alignStartupSession = (): void => {
    if (startupSessionAligned) return
    const workspaces = ctx.workspaces.list.getSnapshot()
    if (!workspaces.baselinesReady) return
    const sessions = sessionSvc.list.getSnapshot()
    // 会话基线未就绪（首拉未完成）时再等一拍，避免误判「无历史」。
    if (sessions.phase === 'pending') return
    startupSessionAligned = true
    const recentId = workspaces.recentWorkspaceId
    if (recentId === undefined) return
    const current = sessions.current === undefined ? undefined : sessions.byId[sessions.current]
    // 上游已恢复真实历史（非空会话）则不干预。
    if (current !== undefined && current.blank !== true) return
    const resumable = latestResumableSession(recentId)
    if (resumable !== undefined && sessions.current !== resumable.id) sessionSvc.open(resumable.id)
  }

  // 验收反馈（2026-08-24）：占位节点可能因 tool/result 事件丢失而永远
  // 「生成中」。每个占位放置时起一个宽限超时器（比 Host 侧最长视频超时
  // 600s 更宽）；正常结算后画布重载会整体替换节点，迟到的触发是空操作。
  //
  // CV-220 修正：这个截止**只用来兜「事件丢失」**（没有任何生成在跑却停在
  // 「生成中」）。原先它从占位落地起无条件计时，而 `DRAMA_TIMEOUT_MS.video = 600s`
  // 只留 60s 余量 —— 一旦有请求排队（后端同步单任务，还被他人占用），排在后面的
  // 占位就会在「还没轮到」时被判「生成超时」。所以计时器改为可重起，队列非空
  // 期间由 `pollGenerationQueue` 不断顺延（见下方）。
  // 后端 0.5.0 视频改异步 + 放开连续提交多镜头：Host 侧整体超时 40min，占位
  // 截止必须**严格大于**它（最后一个任务要等完整条队列），42min 成对调整。
  const PENDING_TIMEOUT_MS = 2_520_000
  const pendingTimers = new Map<string, { projectId: string; timer: ReturnType<typeof setTimeout> }>()
  const clearPendingTimer = (runId: string): void => {
    const entry = pendingTimers.get(runId)
    if (entry !== undefined) {
      clearTimeout(entry.timer)
      pendingTimers.delete(runId)
    }
  }
  /** 起 / 重起某个占位的结算上限（唯一实现——顺延也走它，避免两处计时口径分叉）。 */
  const armPendingTimer = (projectId: string, runId: string): void => {
    const existing = pendingTimers.get(runId)
    if (existing !== undefined) clearTimeout(existing.timer)
    pendingTimers.set(runId, {
      projectId,
      timer: setTimeout(() => {
        pendingTimers.delete(runId)
        storeInstance.actions.markPendingError(
          projectId,
          runId,
          '生成超时：等待产物超过上限。请在画布右键该节点选择「重试」，或在对话中让 agent 重新生成。',
        )
      }, PENDING_TIMEOUT_MS),
    })
  }

  // CV-220：生成队列轮询。**只在有生成在飞时才跑**（空闲即停 ⇒ 零后台流量）。
  // 两个用途：① 把「排队全景」写进 store 供遮罩显示；② 队列非空期间顺延占位的
  // 结算上限 —— 排队等待是我们自己造成的确定性等待，把它算进「超时」就是误报。
  const QUEUE_POLL_MS = 2000
  let queuePoll: ReturnType<typeof setInterval> | null = null
  /**
   * 客户端发起的生成在飞数量（节点重试 / 一键重出）。
   *
   * 为什么不能只看 `pendingTimers`：重试走的是**真实节点**（`isLoading` 置真），
   * 不起占位计时器；而重试正是客户端侧最容易造成并发的入口 —— 漏掉它就等于
   * 在「自己造成的排队」这一半场景里完全没对齐。
   */
  let clientGenerations = 0
  /**
   * Host 正在恢复轮询的 Drama 异步任务数（上一次快照值）。
   * 后端 0.5.0：客户端重启前提交的视频任务由 Host 从 jobs.json 续查——客户端
   * 重启后没有对应的 pendingTimers / 在飞请求，需要靠这个计数维持轮询，
   * 并在计数下降（一个任务结算完成）时重载画布让产物现身。
   */
  let lastResumedJobs = 0
  const queuePollNeeded = (): boolean => pendingTimers.size > 0 || clientGenerations > 0 || lastResumedJobs > 0
  const stopQueuePoll = (): void => {
    if (queuePoll === null) return
    clearInterval(queuePoll)
    queuePoll = null
    storeInstance.actions.setGenerationQueue(null)
  }
  const pollGenerationQueue = async (): Promise<void> => {
    const snapshot = await fetchStudioGenerateQueue()
    const resumed = snapshot?.resumedJobs ?? 0
    // 计数下降 = 有恢复任务结算完成：产物已落盘，重载画布让它现身（恢复路径
    // 没有 tool/result 事件，画布重载是它唯一的结算通知渠道）。必须在
    // queuePollNeeded 早退**之前**做——最后一个任务结算时轮询恰好要停。
    const resumedSettled = lastResumedJobs > resumed
    lastResumedJobs = resumed
    if (resumedSettled) {
      const projectId = resolveActiveProjectId()
      // reloadCanvasQueued：与 tool/result 的结算同一重载通道（排队执行，避免与保存交错）。
      if (projectId !== null) void reloadCanvasQueued(projectId).then(() => flushPendingBrief(projectId))
    }
    // 没有生成在飞 ⇒ 收工（同时清掉痕量，避免残留一行「排队中」）。
    if (!queuePollNeeded()) {
      stopQueuePoll()
      return
    }
    const state = generationQueueStateOf(snapshot)
    storeInstance.actions.setGenerationQueue(state)
    if (state === null) return
    // 队列还有活 ⇒ 重起全部占位的计时器（等价于「排队时间不计入截止」）。
    for (const [runId, entry] of pendingTimers) armPendingTimer(entry.projectId, runId)
  }
  const ensureQueuePoll = (): void => {
    if (queuePoll !== null) return
    queuePoll = setInterval(() => { void pollGenerationQueue() }, QUEUE_POLL_MS)
  }
  /** 包住一次客户端发起的生成：进出各记一次，并保证轮询在这段时间里是活的。 */
  const trackClientGeneration = async <T>(run: () => Promise<T>): Promise<T> => {
    clientGenerations += 1
    ensureQueuePoll()
    try {
      return await run()
    } finally {
      clientGenerations -= 1
      if (!queuePollNeeded()) stopQueuePoll()
    }
  }

  // P7：创作工作流（审批门禁 + 执行模式）。打开项目时随画布一起载入；批准 /
  // 驳回 / 切模式走 Host workflow 路由，成功后同步进 store 驱动审批条显隐。
  const refreshWorkflow = async (projectId: string): Promise<void> => {    try {
      storeInstance.actions.setWorkflow(projectId, await getStudioWorkflow(projectId))
    } catch {
      /* 工作流读取失败静默：审批条按默认（隐藏）处理 */
    }
  }
  const applyWorkflowAction = async (
    projectId: string,
    action: 'approve' | 'reject' | 'approve_script' | 'reject_script' | 'reject_keyframes',
  ): Promise<void> => {
    const workflow = await postStudioWorkflowAction(projectId, action)
    storeInstance.actions.setWorkflow(projectId, workflow)
  }
  // O1 自动唤醒：审批动作落库后，自动向当前会话发送一条提示词唤醒 agent 继续。
  // 先落 workflow 状态、再 send —— 否则 agent 醒来时门禁仍是旧状态会误判。
  // conversation 服务按当前 scope 寻址，send 发到当前项目绑定的会话。
  const wakeAgent = (text: string): void => {
    // `conversation` 服务的 `send` 是「按调用方 scope 寻址」的 —— 在根上下文上
    // 调用会直接抛错（service.d.ts：`Resolve the caller scope's session face or
    // throw on root contexts`）。所以必须先取当前会话的 scope，再从 scope 上取
    // 服务，这也正是 ui-commands 的官方写法（`sessions.scope(id).get(...)`）。
    // 取不到就静默：用户仍可手动在对话框里发送。
    const sessionId = sessionSvc.list.getSnapshot().current
    if (sessionId === undefined) return
    const scoped = sessionSvc.scope(sessionId)
    if (scoped === undefined) return
    const conversation = scoped.get('conversation')
    if (conversation === undefined) return
    void conversation.send(text).catch(() => {})
  }
  const approveStoryboard = async (projectId: string): Promise<void> => {
    await applyWorkflowAction(projectId, 'approve')
    wakeAgent('继续')
  }
  const rejectStoryboard = async (projectId: string, feedback?: string): Promise<void> => {
    await applyWorkflowAction(projectId, 'reject')
    // R1（G1）：审批条意见框里用户写下的具体不满意点随驳回消息定向转述给
    // agent——固定文案只能让模型盲改；留空则保持原行为。
    const trimmed = feedback?.trim()
    wakeAgent(trimmed !== undefined && trimmed.length > 0
      ? `分镜已驳回，请按以下意见修改后重新提交：${trimmed}`
      : '请按我的修改意见重新提交分镜')
  }
  const confirmKeyframes = async (projectId: string): Promise<void> => {
    const workflow = await postStudioWorkflowAction(projectId, 'confirm_keyframes')
    storeInstance.actions.setWorkflow(projectId, workflow)
    wakeAgent('继续')
  }
  /**
   * CV-051：打回关键帧。
   *
   * 此前关键帧阶段只有「确认」没有「打回」—— 整体不满意时用户只能逐张右键重做
   * （AI 全程不知情，重出完还得手工再确认一次），或者去对话里说一句（没有任何
   * 状态机响应）。复用分镜审批条的意见框：填了就定向转述，留空只发通用重做指令。
   *
   * 状态与「确认」同样回 `executing`：`image_generate` 在 `keyframe_review` 下被
   * 门禁拦死（PRODUCING_TOOLS），不解除等待 agent 一步都动不了。
   */
  const rejectKeyframes = async (projectId: string, feedback?: string): Promise<void> => {
    await applyWorkflowAction(projectId, 'reject_keyframes')
    const trimmed = feedback?.trim()
    wakeAgent(trimmed !== undefined && trimmed.length > 0
      ? `关键帧已打回，请按以下意见重出后重新提交确认：${trimmed}`
      : '关键帧已打回，请按我的意见重出关键帧并重新提交确认')
  }
  // CV-100：剧本审批。批准后必须回 drafting（executing 会让 GATED_TOOLS 放行、
  // 分镜审批被跳过）；agent 醒来后按「继续」进入分镜规划。
  const approveScreenplay = async (projectId: string): Promise<void> => {
    await applyWorkflowAction(projectId, 'approve_script')
    wakeAgent('剧本已批准，请进入分镜规划')
  }
  const rejectScreenplay = async (projectId: string, feedback?: string): Promise<void> => {
    await applyWorkflowAction(projectId, 'reject_script')
    const trimmed = feedback?.trim()
    wakeAgent(trimmed !== undefined && trimmed.length > 0
      ? `剧本已驳回，请按以下意见修改后重新提交：${trimmed}`
      : '请按我的修改意见重写剧本并重新提交审批')
  }
  const setWorkflowMode = async (projectId: string, mode: 'confirm' | 'auto'): Promise<void> => {
    // CV-056：从「等待类状态」解除等待后必须唤醒 agent。AI 在调完
    // submit_*_for_approval 时已按工具返回文本的指示结束了回合并在静默等待，
    // 状态条翻成「制作中」并不会让它自己往下走——不唤醒的话流程实际停摆，
    // 用户会以为切到放手跑就自动续跑了。
    const before = storeInstance.getSnapshot().workflows[projectId]
    const workflow = await postStudioWorkflowAction(projectId, 'setMode', mode)
    storeInstance.actions.setWorkflow(projectId, workflow)
    const wasWaiting = before?.state === 'awaiting_approval' || before?.state === 'script_review' || before?.state === 'keyframe_review'
    if (wasWaiting && workflow.state === 'executing') wakeAgent('继续')
  }
  // P7 点选式澄清：提交用户选择后，Host 侧 ask_user_choice 工具轮询到答案并
  // 清空问题；这里把带答案的工作流写回 store（卡片随即消失）。工具结果回流
  // 会触发一次 tool/result → refreshWorkflow 兜底同步。
  const answerQuestion = async (projectId: string, value: string): Promise<void> => {
    const workflow = await answerStudioQuestion(projectId, value)
    storeInstance.actions.setWorkflow(projectId, workflow)
  }

  ctx.effect(() => installStudioStyles(), 'canvas-studio: studio styles')
  // 品牌令牌：以持久化的配色预设启动（设置弹窗「外观」区可切换并持久化），并注入
  // 品牌 favicon。installBrandStyles 幂等，返回的卸载函数仅断开引用（元素常驻）。
  const brandScope = ctx.settingsScope.bind<CanvasStudioConfig>({ namespace: 'canvas-studio' })
  const initialBrandPreset = brandScope.getSnapshot().value?.brandPreset
  ctx.effect(() => installBrandStyles(initialBrandPreset), 'canvas-studio: brand tokens + favicon')
  /**
   * 「资产库位置」变更后的整套重置（2026-10-04）。
   *
   * 三件事缺一不可：① 清掉按旧根 projectId 索引的内存态（否则旧节点 / 资产库跨库残留）；
   * ② 重拉新根的项目列表与全局资产库（两者都住在 root 下）；③ **强制**重建首页落点 ——
   * 会话 cwd 还指在旧根 draft 目录上，不 force 会被「当前会话已绑目录」短路，于是下一次
   * 发送仍拿旧路径去认领（400 → 静默失败）。
   */
  const resetForStorageRootChange = async (): Promise<void> => {
    storeInstance.actions.resetStorageScoped()
    try {
      await refreshProjects()
      storeInstance.actions.setLibraryAssets(await listLibraryAssets())
    } catch (cause) {
      failWith(cause, '切换项目保存位置后重新载入失败')
    }
    // 落点重建与列表成败无关：会话还挂在旧根目录上，不重建就永远认领失败。
    await ensureDraftLanding(true)
  }
  // 客户端设置作用域只提供 subscribe（Host 侧才是 watch），也没有服务端推送，
  // 所以这里比对快照里的 assetDir。**首个就绪快照只记录、不触发** —— 启动时
  // loading → ready 会带来一次「'' → 真实路径」的跳变，那不是用户改设置。
  let lastAssetDir: string | null = null
  const onStorageSettingChanged = (): void => {
    const snapshot = brandScope.getSnapshot()
    if (snapshot.status !== 'ready') return
    const next = snapshot.value?.assetDir ?? ''
    if (lastAssetDir === null) { lastAssetDir = next; return }
    if (next === lastAssetDir) return
    lastAssetDir = next
    void resetForStorageRootChange()
  }
  ctx.effect(() => {
    onStorageSettingChanged()
    return brandScope.subscribe(onStorageSettingChanged)
  }, 'canvas-studio: 资产库位置变更 → 重置存储作用域状态')
  // 主题 presenter 补位（Bug 1 根因）：刷新 body[data-ds-dark-theme] / html color-scheme
  // 的 ThemePresenter 由 ui-layout 提供，而本 profile 的 patch 禁用了 ui-layout；桌面壳的
  // presenter 只挂在 advanced/extended shell（extended-shell.ts:37 / advanced-shell.ts:38），
  // 兼容模式没有。缺它 → 设置里切换主题只有重启才生效（boot script 启动时写一次）。
  // 这里按 ThemeRuntime 的 snapshot 同步 DOM：colorScheme + dark 属性，启动时对齐一次，
  // theme/change 后同步（ui-theme 的 ThemeRuntime 本身不接触 DOM，职责在这里）。
  const applyThemeToDom = (): void => {
    const snapshot = ctx.theme.getTheme()
    const dark = snapshot.active.colorScheme === 'dark'
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    document.body.toggleAttribute('data-ds-dark-theme', dark)
  }
  ctx.effect(() => {
    applyThemeToDom()
    return ctx.on('theme/change', applyThemeToDom)
  }, 'canvas-studio: theme presenter (ui-layout disabled)')
  // 对话区空态 hero 的品牌标识：替换官方 FishLogo 为场记板。
// 用 ctx.slots.inject 等上游 ui-conversation 声明该槽后再 register（cordis fiber
// 加载顺序不保证 ui-conversation 必先于 canvas-studio apply；若 conversation 槽的
// children 尚未声明，register 会抛「registering into an undeclared slot throws」→
// 渲染进程 abort → 「Renderer boot failed for 2 plugin(s)」。SlotRegistry.inject 的
// callback 在声明就绪后同步执行；声明已存在则立即同步触发，无竞态）。
// cast: SlotRegistry 字段类型 narrow 到 'root'（augment 已合并 SlotMap，但
// SlotRegistry 的 inject/register 字段未刷新），内联 facade 走宽类型。
{
  const slots = ctx.slots as unknown as {
    inject(key: string, callback: () => () => void): () => void
    register(options: {
      name: string
      /** `list` 槽**必填**：宿主 SlotRegistry 缺它直接抛「requires options.id」→ 渲染进程 abort。 */
      id?: string
      /** `keyed` 槽**必填**：分发键（REQ-008 的 tool.call.toolview 按 wire 工具名分发）。 */
      key?: string
      /**
       * keyed 槽优先级：升序排序、最小者胜出（ui-slots/src/index.ts:862-868）。
       * REQ-008 统一 -1，接管上游默认 0 的 keyed 行且不触发同键同优先级抛错。
       */
      priority?: number
      /** `list` 槽的排序位。负值 = 静态会话上下文，排在交互动作之前（宿主约定）。 */
      order?: number
      /** 注册者自己的注入面（组件侧变成 `use<Name>` selector hook）。 */
      inject?: () => object
    }, component: unknown): () => void
  }
  slots.inject(
    'conversation.hero.brand.mark',
    () => slots.register({ name: 'conversation.hero.brand.mark' }, HeroBrandMark),
  )
  // CV-179：会话头**不再挂任何插件元素** —— 这是刻意的，别把它加回来。
  // 阶段胶囊原本注册在这里（DD-09 / c 的 `conversation.session.header.utilities`），
  // 但它占的 133px 把宿主的会话标题挤到只剩约 93px：宿主 `.headerUtilities` 是
  // `flex: none`、标题簇是 `flex: 1; min-width: 0`，标题只能被压；而 `.crumb` 的
  // 硬上限是 220px。实测（2026-09-14 用户截图）标题只显示三个字「创作演…」，真标题
  // 其实是宿主自动生成的 14 字「创作演唱会MV及简单女声歌曲」。压窄胶囊救不回来
  // （压到最简也只剩 ~93px），**唯一解是撤出**；撤走后标题可用宽度回到 ~234px
  // ≥ 它所需的 ~202px，完整可读（渲染台有回归断言）。
  // 胶囊现随 ProjectContextBar 渲染在输入区读数带右端（下一个注册）。
  // DD-09 / d：输入卡片下方的「项目上下文条」—— 项目身份 + 规格 + 阶段胶囊。
  // 槽的选型按宿主语义定：`conversation.input.dock` 是「卡片上方的整行，给需要
  // 独占一行 / 会换行带正文的内容」（goal、queue 都在那），而
  // `conversation.composer.dock` 才是「卡片下方的**环境读数**位」—— 自带的 stats
  // 行就注册在这里（`id: 'stats', order: 0`）。我们是一行不换行的短读数，归后者。
  // kind 是 `list`，**必须给 `id`**（缺了直接抛「requires options.id」→ 渲染进程
  // abort）。`order: -10` 让它排在 stats 之前 —— 身份与阶段读数紧贴卡片，统计读数在其下。
  // 宿主对 composer.dock 的渲染条件是 `!hero`，故 hero 态（尚无会话内容）不显示，
  // 这是可接受的（此时中栏与左栏都已在表明项目身份）。
  slots.inject(
    'conversation.composer.dock',
    () => slots.register({
      name: 'conversation.composer.dock',
      id: 'canvas-studio-project',
      order: -10,
      inject: () => ({ hooks: { studio: storeInstance } }),
    }, ProjectContextBar),
  )
  // 上传回执卡（2026-09-22 视频；CV-247 泛化到音频与文字）：挂**输入卡片上方**那条 dock。
  // 宿主对 `input.dock` 的渲染**不带 `!hero`** 条件（`ConversationRoot.tsx` 里相邻的
  // composer.dock 才带），而首屏态正是用户拖文件的场景 —— 挂 composer.dock 会看不见。
  // 数据与 StudioFrame 同一个 store（`mediaUploads`），不引第二份状态。
  slots.inject(
    'conversation.input.dock',
    () => slots.register({
      name: 'conversation.input.dock',
      id: 'canvas-studio-media-upload',
      order: -10,
      inject: () => ({
        hooks: { studio: storeInstance },
        dismissUpload: (projectId: string, id: string) => {
          storeInstance.actions.dismissMediaUpload(projectId, id)
        },
      }),
    }, MediaUploadBar),
  )
  // REQ-005 v1.3（变体 A）：首页规格行（§3.4）—— 画幅/时长/模式三组 chips 挂
  // 同一条 `input.dock`（卡片上方整行，hero 态可见）。order: -5 排在上传回执卡
  // （-10）之后、其余默认项之前，紧贴对话卡。组件内 lobby 态才渲染；草稿存
  // store.lobbySpec —— 发送拦截分支（lobby 认领）在组件树之外读同一份。
  slots.inject(
    'conversation.input.dock',
    () => slots.register({
      name: 'conversation.input.dock',
      id: 'canvas-studio-lobby-spec',
      order: -5,
      inject: () => ({
        hooks: { studio: storeInstance },
        // mode 变化即置 modeDirty：进首页的默认值对齐只覆盖没动过的草稿。
        setSpec: (next: ProjectSpecDraft) => {
          const prev = storeInstance.getSnapshot().lobbySpec
          storeInstance.actions.setLobbySpec(next.mode === prev.mode ? next : { ...next, modeDirty: true })
        },
        // CV-196：设置页「默认执行模式」惰性读取（StudioFrame.readDefaultCreateMode
        // 同款；读不到按 schema 默认 confirm）。settingsScope 在 inject 列表里。
        defaultMode: (): StudioWorkflowMode => {
          try {
            const value = ctx.settingsScope
              .bind<CanvasStudioConfig>({ namespace: 'canvas-studio' })
              .getSnapshot().value?.workflowMode
            return value === 'auto' ? 'auto' : 'confirm'
          } catch {
            return 'confirm'
          }
        },
      }),
    }, LobbySpecRow),
  )
  // REQ-005 v1.4（CV-261）：首页「已暂存素材」条 —— 同一 dock，但排在规格行**之后**
  // （order -4）：它紧贴对话卡，与效果图的次序 [规格 deck][暂存条][对话卡] 一致 ——
  // 它讲的是「这条消息带什么」，贴着输入框才读得通。组件内 lobby 态才渲染，且无
  // 条目时返回 null（不占一个空行）。数据与拦截分支共用 store.lobbyStash。
  slots.inject(
    'conversation.input.dock',
    () => slots.register({
      name: 'conversation.input.dock',
      id: 'canvas-studio-lobby-stash',
      order: -4,
      inject: () => ({
        hooks: { studio: storeInstance },
        // 文件侧收尾（回收预览 URL + 丢掉 File 句柄）也在这条路径上 ——
        // 只让 store 的清单少一条、模块级表里却留着文件，是一处纯漏。
        dismissStash: (id: string) => { dismissLobbyStashItem(id, storeInstance.actions) },
      }),
    }, LobbyStashBar),
  )
  // REQ-008：对话流工具行三档接管 —— 对 `tool.call.toolview`（keyed 槽，按 wire
  // 工具名分发）逐 key 注册 ToolCallRow。要点（全部源码实证，见方案 v1.1 §1.1）：
  // - keyed 无 catch-all：表外工具自动回落上游 GenericToolCard，所以键集合必须
  //   等于 tool-presentation.ts 的表（tests/tool-presentation.test.mjs 钉住全覆盖）；
  // - priority -1：上游 12 个 keyed 注册（read/bash/grep/.../cordis_stop 等）全部
  //   缺省 0，升序排序最小者胜出 ⇒ -1 安全接管且不触发「同 key 同 priority」抛错；
  // - cordis_define / todo_write 刻意不在表内（排除清单，保留上游行）；
  // - 每个 key 一条独立 inject：声明就绪后各注册各的、dispose 各自回收，与上方
  //   各槽的 inject 范式一致（宿主删槽时静默不挂，整体照常启动）。
  for (const key of TOOLVIEW_KEYS) {
    slots.inject(
      'tool.call.toolview',
      () => slots.register({ name: 'tool.call.toolview', key, priority: -1 }, ToolCallRow),
    )
  }
}
  ctx.effect(() => {
    // P4+：捕获画布工具产物。生成的节点由 Host 在落盘时写入 canvas.json（单一
    // 真相源）；这里只在该项目被选中时触发画布重载，不再依赖解析事件渲染文本
    // 里的 URL（后端异常 / 渲染差异时不可靠）。工具调用开始先放一个「生成中」
    // 占位节点，失败时经 tool/result 的 data.error 标记错误。
    const reloadCanvas = (projectId: string): Promise<void> => reloadCanvasQueued(projectId).then(() => flushPendingBrief(projectId))
    const disposeCapture = ctx.conversationEvents.register(createAssetCaptureDefinition({
      reloadCanvas,
      getSelectedProjectId: () => resolveActiveProjectId(),
      // P7：工作流工具（submit_storyboard_for_approval / ask_user_choice）结算后
      // 刷新工作流状态与画布 —— 审批条与分镜表节点即时出现。
      onToolFinished: (projectId) => {
        void reloadCanvas(projectId)
        void refreshWorkflow(projectId)
      },
      // P7 点选卡片：ask_user_choice 在 execute 开头才把问题写入 registry，
      // tool/call 事件可能先到 —— 延迟刷新两次确保卡片拉出来。
      onWorkflowToolStarted: (projectId) => {
        setTimeout(() => { void refreshWorkflow(projectId) }, 600)
        setTimeout(() => { void refreshWorkflow(projectId) }, 2500)
      },
      // 验收反馈（2026-08-24）：占位节点可能因事件丢失永远「生成中」。
      // 放置占位时起一个超时器（比 Host 侧最长视频超时更宽），到点把该
      // 占位标记为失败；正常结算（重载替换）后触发是空操作，无副作用。
      onToolCall: (projectId, info) => {
        const project = storeInstance.getSnapshot().projects.find((entry) => entry.id === projectId)
        if (project === undefined) return
        const projectNodes = storeInstance.getSnapshot().nodes[projectId] ?? []
        const size = NODE_SIZE_PENDING[info.kind]
        // CV-184：占位节点落点同样走唯一入口（此前是本文件第三份裸网格，
        // 与 Host 侧的真实产物落点各算各的）。
        // A-4：arguments 里带 shotRefs/sourceUrls/filename——占位期就预连血缘，
        // 落位锚到分镜组旁（不再丢进无来源网格的远角），成卡后位置基本不动。
        const pendingSources = resolvePendingSourceIds(projectNodes, info.arguments)
        const placement = deriveNodePlacement(projectNodes, pendingSources, size.width, size.height)
        storeInstance.actions.setPendingNode(projectId, {
          id: `pending-${info.runId}`,
          runId: info.runId,
          kind: info.kind,
          x: placement.x,
          y: placement.y,
          width: size.width,
          height: size.height,
          createdAt: Date.now(),
          origin: 'agent',
          sourceIds: pendingSources,
          toolName: info.toolName,
          ...(info.arguments !== undefined ? { generationPrompt: info.arguments } : {}),
          isLoading: true,
          progress: 0,
        })
        // CV-220：起结算上限，并让队列轮询开始跑（排队期间它会把这一切顺延）。
        armPendingTimer(projectId, info.runId)
        ensureQueuePoll()
      },
      onToolError: (projectId, runId, message) => {
        clearPendingTimer(runId)
        storeInstance.actions.markPendingError(projectId, runId, message)
      },
      // CV-239：取消类调用（用户打断）—— 占位节点**直接移除**，不标红失败。
      // 会话转录里仍有「生成已取消」一行，叙事不丢；画布不留「生成失败」的坑。
      onToolCancelled: (projectId, runId) => {
        clearPendingTimer(runId)
        storeInstance.actions.removePendingByRunId(projectId, runId)
      },
    }))
    return disposeCapture
  }, 'canvas-studio: reload canvas on generated assets')

  // Drama 异步任务恢复（后端 0.5.0）：启动时先探一次队列快照——若 Host 正在
  // 恢复轮询 jobs.json 里的未完成任务（resumedJobs > 0），保持队列轮询；
  // 任务结算（计数下降）时 pollGenerationQueue 会自行重载画布让产物现身。
  // 此后由 queuePollNeeded 决定轮询的启停（恢复任务清零且无生成在飞即停）。
  void pollGenerationQueue().then(() => {
    if (lastResumedJobs > 0) ensureQueuePoll()
  }).catch(() => { /* 启动探测失败静默：下一次 tool/call / 项目打开自会再探 */ })
  // E-2（R-P2-02 履约「每次进入 app 需停留在首页」）：启动即置位首页意图。
  // 宿主启动期逐个恢复 workspace / 会话，每一次恢复都会触发下面的订阅 →
  // syncActiveProject 的「最近 workspace → 项目」回填——不置位就会连续加载
  // ≥2 张画布、停在最后一个映射（E-1 同区报告的「打开 App 自动加载多个画布」）。
  // 置位后所有回填在 syncActiveProject 入口被 homePinned 短路，画布只在用户
  // 点项目行时经 openProject 载入（自足：select + 绑 workspace + reload）。
  // homePinned 是瞬时内存态不持久化，天然只影响启动窗口；会话恢复
  // （alignStartupSession）不受影响——恢复的是对话，不是画布选中。
  storeInstance.actions.setHomePinned(true)
  maybeDraftLanding()
  // 会话级归属：当前 workspace 变化（含应用启动恢复会话）时，把画布选中态对齐到
  // 该 workspace 绑定的项目并载入其画布，避免「产物已写盘却显示空态」。
  // 会话级项目归属：当前 workspace 变化（含应用启动恢复会话）时，把画布选中态对齐到
  // 该 workspace 绑定的项目并载入其画布，避免「产物已写盘却显示空态」。
  ctx.effect(() => {
    syncActiveProject()
    syncHasConversation()
    alignStartupSession()
    // 会话基线晚于工作区基线到达时，alignStartupSession 需要再被触发一次。
    const unsubscribeWorkspaces = ctx.workspaces.list.subscribe(() => {
      syncActiveProject()
      syncHasConversation()
      alignStartupSession()
      // 变体 A：无项目选中时保证 draft 落点（守卫内部自判，幂等）。
      maybeDraftLanding()
    })
    // CV-034：会话列表变化（含启动恢复）也触发画布对齐 —— 当前会话的 cwd
    // 是「画布跟随对话」的第一映射来源，会话晚到时必须补一次同步。
    // CV-064 二期：blank 翻转（首条消息 ACCEPTED）同样走此订阅 → 自动切 work。
    const unsubscribeSessions = sessionSvc.list.subscribe(() => {
      syncActiveProject()
      syncHasConversation()
      alignStartupSession()
      maybeDraftLanding()
    })
    return () => {
      unsubscribeWorkspaces()
      unsubscribeSessions()
    }
  }, 'canvas-studio: sync canvas to active workspace')

  // P7 点选式澄清：问题卡片内联在对话区（ask_user_choice 的工具调用下方），
  // 用户点选后答案回流给模型；画布侧不再重复渲染卡片。
  ctx.effect(() => registerQuestionChatNode(ctx, {
    getSelectedProjectId: () => resolveActiveProjectId(),
    onAnswer: (projectId, value) => { void answerQuestion(projectId, value).catch(() => {}) },
  }), 'canvas-studio: question chat node')

  // 打断当前会话的运行中回合（工具生成时把 Host 侧请求取消）。
  const cancelCurrentTurn = async (): Promise<void> => {
    const current = sessionSvc.list.getSnapshot().current
    if (current === undefined) return
    const binding = sessionSvc.binding(current)
    if (binding === undefined) return
    await binding.session.cancel()
  }

  // 节点级重试：走 Host 生成路由，结果写回原节点（retryOf）。
  // 验收反馈 2026-08-25「点重试没反应」：此前失败经 markPendingError 只作用于
  // isLoading 的占位节点，对真实节点是空操作 —— 错误被静默吞掉。现在发起时
  // 立即进入加载态（画布出现进度遮罩），失败把错误写回节点本体（详情抽屉与
  // 节点徽标都会显示）；成功后排队重载画布，产物原地更新。
  //
  // 2026-09-16：参数**只能**来自节点自己保存的那份（`retryStudioNode` 不再收
  // overrides）。原 `steerNode`（调用点临时覆盖 prompt）随之下线 —— 它与
  // 「改完参数、再点重试」的新语义冲突，留着就是第二条改参数的路，且改完不留痕。
  // 判据（能不能重放）在 `isReplayable`，入口侧只负责不重复触发。
  const retryNode = async (projectId: string, nodeId: string): Promise<void> => {
    const node = storeInstance.getSnapshot().nodes[projectId]?.find((entry) => entry.id === nodeId)
    if (node === undefined) return
    // CV-018：已在生成中的节点忽略重复触发 —— 重放不是幂等操作，双击重试
    // 按钮会派发两次 click（工具条/右键菜单连点同理），不拦就是多烧一次
    // 生成。这一处守卫覆盖全部入口（节点徽章、右键菜单、就近工具条）。
    if (node.isLoading === true) return
    if (!isReplayable(node)) {
      storeInstance.actions.updateNode(projectId, nodeId, {
        error: '该节点没有可重放的生成参数（仅 agent 生成的媒体节点支持重试）',
      })
      return
    }
    storeInstance.actions.updateNode(projectId, nodeId, { isLoading: true, progress: 0, error: undefined })
    try {
      // CV-220：这一条是客户端侧最主要的并发来源（连点多个节点重试 / 打回重出）。
      // 进出各记一次，让队列轮询在飞期间保持存活 —— 自己造成的排队也必须被如实
      // 显示、也必须不被算进「超时」。
      await trackClientGeneration(() => retryStudioNode(projectId, node))
      await reloadCanvasQueued(projectId)
    } catch (cause) {
      storeInstance.actions.updateNode(projectId, nodeId, {
        isLoading: false,
        error: cause instanceof Error ? cause.message : '重试失败',
      })
    }
  }


  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('layout', layout)
    const disposeRegistration = ctx.slots.register({
      name: 'root',
      children: {
        'sidebar': { kind: 'single', scope: 'root' },
        // 注意：`sidebar.settings` 不在此声明 —— 它是 dsh-client-ui-sidebar
        // 包拥有的子槽（sidebar 包在 client.js 内 register 并 renderSlot）。
        // canvas-studio 只通过 StudioFrame 的 renderSlot('sidebar.settings') 渲染进
        // 该槽；若在此重复声明，loader 加载 sidebar 包时会报「slot already declared」。
        'conversation': { kind: 'single', scope: 'session-maybe' },
        'details': { kind: 'single', scope: 'session' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
      inject: () => {
        // refreshProjects / isDuplicateProjectName 在 apply 顶层定义（lobby 认领
        // 拦截分支与 inject 回调共用一份；见 maybeDraftLanding 之后的定义处）。
        // 持久化走同一条串行队列：快照在执行时刻取（而非调用时刻），
        // 并剔除瞬态占位节点 —— 生成中的占位绝不落盘（「黑色生成中图残留」
        // 的根因），队列保证最后一次保存写的永远是最新状态。
        const persistCanvas = (projectId: string): Promise<void> => enqueueCanvasIo(async () => {
          const snapshot = storeInstance.getSnapshot()
          const nodes = (snapshot.nodes[projectId] ?? []).filter(node => !isTransientNode(node))
          // CV-242：与 persistCanvasQueued 同一删除账本协议（上送 + 成功清账）。
          const removedIds = snapshot.pendingRemovedIds[projectId] ?? []
          await saveStudioCanvas(projectId, nodes, viewOf(snapshot, projectId).view, removedIds)
          if (removedIds.length > 0) storeInstance.actions.clearRemovedNodes(projectId, removedIds)
        })
        /** 画布为空时预置示例节点（onboarding 示例项目 / dev-seed 共用），幂等。 */
        const seedProjectIfEmpty = async (projectId: string): Promise<void> => {
          const loaded = storeInstance.getSnapshot().nodes[projectId] ?? []
          if (loaded.length > 0) return
          const seeded = seedNodes()
          storeInstance.actions.setNodes(projectId, seeded)
          await persistCanvas(projectId)
        }
        /**
         * 打开项目：选中 → 绑定 workspace → 恢复/新建会话 → 载画布。
         *
         * @returns 是否成功绑定。原本只回 void，CV-256 起要区分「项目建成但没绑上」
         * 与「压根没建成」两种失败（REQ-005 的失败二分依赖这个信号）；既有调用点
         * 忽略返回值，行为不变。
         */
        const openProject = async (project: StudioProject): Promise<boolean> => {
          storeInstance.actions.select(project.id)
          try {
            // workspace.create resolves an existing registration by path, so
            // binding is idempotent; the returned workspace is then in the
            // runtime list and the shared New Session action can navigate.
            const workspace = await ctx.workspaces.create({ path: project.dir })
            // CV-033：同名孤儿 workspace 清理 —— 项目已删但 workspace 残留时
            // （历史版本删除项目不摘 workspace），重名 rename 会报
            // workspace-name-conflict。同名且 path 不属于任何现存项目的即孤儿，
            // 摘除后再改名；path 仍属现存项目的真重名照常报错。
            const projects = storeInstance.getSnapshot().projects
            const occupied = ctx.workspaces.list.getSnapshot().items.find(
              item => item.title === project.name && item.path !== project.dir,
            )
            if (occupied !== undefined && !projects.some(entry => entry.dir === occupied.path)) {
              await ctx.workspaces.delete(occupied.workspaceId)
            }
            // Keep the workspace/session title in sync with the project name
            // so the conversation header matches the project list.
            await ctx.workspaces.rename(workspace.workspaceId, project.name)
            // 切换项目时先清除当前会话选择，避免 startSession/connectWorkspace
            // 异步完成前，右侧面板仍显示上一个项目的会话内容。
            // clear() 让布局进入 no-session 空态；connectWorkspace 随后会设置正确会话。
            sessionSvc.clear()
            // 验收反馈 2026-08-25「切换后历史对话消失」：connectWorkspace 只复用
            // 工作区下的空白会话 —— 原会话一旦聊过（非 blank），startSession 每次
            // 都新开一个空会话并跳过去。这里改为恢复该工作区 updatedAt 最新的
            // 非空会话；确实没有（首次使用）才走 startSession 建空。
            if (!resumeLatestSession(workspace.workspaceId)) {
              ctx.workspaces.startSession(workspace.workspaceId)
            }
            // P4+：载入持久化画布（含视口）；载入完成后补落暂存的创意节点。
            await reloadCanvasQueued(project.id).then(() => flushPendingBrief(project.id))
            // CV-243：打开项目顺手 GC 资产废料（回收站物理清 + 历史孤儿清）。
            // fire-and-forget：维护任务不阻塞打开，失败静默（下次打开再试）。
            void gcStudioAssets(project.id).catch(() => {})
            // CV-064 二期：会话已定（恢复历史 / 新建空白），现算一次「有对话」判据。
            syncHasConversation()
            // CV-066：载入已装载 skill（skills.json；失败静默 —— 下次仍会重试）。
            try {
              storeInstance.actions.setActiveSkills(project.id, await loadActiveSkills(project.id))
            } catch {
              /* 装载清单加载失败静默 */
            }
            void refreshWorkflow(project.id)
            // CV-264③：REQ-005/T4 的「打开即 touch」已删除 —— 打开项目不再写
            // updatedAt（验收反馈：点哪个哪个跳第一，不稳定）。列表按「最后修改」
            // 倒序，燃料在 Host 侧真修改处落（writeCanvas / updateWorkflow 等）。
            if (devSeed) {
              await seedProjectIfEmpty(project.id)
            }
            return true
          } catch (cause) {
            failWith(cause, '项目会话绑定失败')
            return false
          }
        }
        // isDuplicateProjectName 在 apply 顶层（与 refreshProjects 一起，见其定义处）。
        /**
         * 建项目一条龙（`createProject` 与 `createProjectFromIdea` 的共用实现）。
         *
         * `nameOf` 是**惰性**取名：E11 撞名重试时要按重拉后的注册表重算一次名字，
         * 传值进去就只能拿旧名字再撞一次。失败已进 `failWith` 错误面，返回 null。
         */
        const createAndOpenByName = async (
          nameOf: () => string,
          groupId?: string | null,
          plan?: StudioProjectPlan,
          mode?: StudioWorkflowMode,
        ): Promise<StudioProject | null> => {
          try {
            let project: StudioProject
            try {
              project = await createStudioProject(nameOf(), groupId, plan, mode)
            } catch (cause) {
              if (!isDuplicateProjectName(cause)) throw cause
              // E11：本地 `projects` 快照可能已过期（另一窗口/标签页先建了同名）。
              // 重拉注册表 → 重算名字 → 自动重试一次；再失败才落 E4 错误面。
              await refreshProjects()
              project = await createStudioProject(nameOf(), groupId, plan, mode)
            }
            await refreshProjects()
            return await openProject(project) ? project : null
          } catch (cause) {
            failWith(cause, '项目创建失败')
            return null
          }
        }
        const createProject = async (name: string, groupId?: string | null, plan?: StudioProjectPlan, mode?: StudioWorkflowMode): Promise<void> => {
          storeInstance.actions.setCreating(true)
          try {
            // CV-196：模式随创建请求一起落盘（而不是创建成功后再补打一次 setMode）
            // —— 补打会在「创建成功但设模式失败」时留下一个用户以为选了放手跑、
            // 实际是逐步确认的项目，而弹窗那时已经关了。
            await createAndOpenByName(() => name, groupId, plan, mode)
          } finally {
            storeInstance.actions.setCreating(false)
          }
        }
        // REQ-005 v1.3（变体 A）：原 createProjectFromIdea / sendFirstMessage /
        // READY_* 就绪等待随 LobbyComposer 退役 —— 首页创意现在走宿主发送链路，
        // DivertConversation 的 lobby 分支先认领 draft 目录为项目再放行，会话
        // 一直存在（无 startSession 空窗），就绪等待不再是主链路步骤。
        /**
         * 回首页（REQ-005 §5.3）。
         *
         * `homePinned` 是瞬时标志（不持久化）：短路 `syncActiveProject` 的
         * 「最近 workspace → 项目」回填，否则任何会话/工作区变化都会把用户踢回
         * work 态。不清理当前会话 —— 用户可能马上点回项目继续聊。
         */
        const goHome = (): void => {
          storeInstance.actions.setHomePinned(true)
          storeInstance.actions.select(null)
          // 变体 A：首页宿主卡要可输入/可附件，draft 落点（workspace + blank 会话）
          // 异步就绪；失败静默进错误面，不阻塞回首页动作本身。
          void ensureDraftLanding()
        }
        // CV-091：分组 inject 回调（均经 api.ts → /canvas-studio/groups 路由）。
        const refreshGroups = async (): Promise<void> => {
          try {
            storeInstance.actions.setGroups(await listStudioGroups())
          } catch (cause) {
            failWith(cause, '分组加载失败')
          }
        }
        const createGroup = async (name: string): Promise<void> => {
          try {
            await createStudioGroup(name)
            await refreshGroups()
          } catch (cause) {
            failWith(cause, '分组创建失败')
          }
        }
        const renameGroup = async (groupId: string, name: string): Promise<void> => {
          try {
            await renameStudioGroup(groupId, name)
            await refreshGroups()
          } catch (cause) {
            failWith(cause, '分组重命名失败')
          }
        }
        const deleteGroup = async (groupId: string): Promise<void> => {
          try {
            await deleteStudioGroup(groupId)
            await refreshGroups()
          } catch (cause) {
            failWith(cause, '分组删除失败')
          }
        }
        const moveProjectToGroup = async (projectId: string, groupId: string | null): Promise<void> => {
          try {
            await moveStudioProjectToGroup(projectId, groupId)
            await refreshProjects()
          } catch (cause) {
            failWith(cause, '项目移动分组失败')
          }
        }
        // REQ-001：全局资产库回调（均经 api.ts → /canvas-studio/library 路由）。
        // 刷新走 refreshLibrary（失败经 failWith 归 store 错误面）；写操作的错误
        // **原样抛回调用方**（资产库页自己决定怎么呈现——重名 CS-LIB-002 这类
        // 预期错误不该炸掉项目列表的 phase，与分组 CRUD 的吞错模式刻意不同）。
        const refreshLibrary = async (): Promise<void> => {
          try {
            storeInstance.actions.setLibraryAssets(await listLibraryAssets())
          } catch (cause) {
            failWith(cause, '资产库加载失败')
          }
        }
        const createLibraryAssetAndRefresh = async (request: LibraryCreateRequest): Promise<LibraryAsset> => {
          const asset = await createLibraryAsset(request)
          await refreshLibrary()
          return asset
        }
        const updateLibraryAssetAndRefresh = async (id: string, request: LibraryUpdateRequest): Promise<LibraryAsset> => {
          const asset = await updateLibraryAsset(id, request)
          await refreshLibrary()
          return asset
        }
        const deleteLibraryAssetAndRefresh = async (id: string): Promise<void> => {
          await deleteLibraryAsset(id)
          await refreshLibrary()
        }
        const addLibraryAnchorAndRefresh = async (id: string, anchor: LibAnchorRef): Promise<LibraryAsset> => {
          const asset = await addLibraryAnchor(id, anchor)
          await refreshLibrary()
          return asset
        }
        const uploadLibraryMediaAndRefresh = async (id: string, file: File, label?: string): Promise<LibraryAsset> => {
          const asset = await uploadLibraryMedia(id, file, label)
          await refreshLibrary()
          return asset
        }
        // onboarding 欢迎屏入口：已有「示例项目」直接打开并预置节点，否则新建再预置。
        const createSampleProject = async (): Promise<void> => {
          storeInstance.actions.setCreating(true)
          try {
            const existing = storeInstance.getSnapshot().projects.find(entry => entry.name === '示例项目')
            const project = existing ?? await createStudioProject('示例项目')
            if (existing === undefined) await refreshProjects()
            await openProject(project)
            await seedProjectIfEmpty(project.id)
          } catch (cause) {
            failWith(cause, '示例项目创建失败')
          } finally {
            storeInstance.actions.setCreating(false)
          }
        }
        // 一键效果测试（2026-09-02）：串行编排「建项目 → 放手跑 → 发测试指令 → 等
        // 回合空闲」。会话绑定等待与回合空闲判据抽在 test-driver.ts（REQ-021 起
        // 与自动测试场景执行器共用同一份实现）；question 类阻塞由 ask_user_choice
        // 超时自动结算，approval 类弹窗没有客户端 API 可自动批准——超时即记失败，
        // 由人工接管。产物与报告由 Host 落盘（canvas.json / 效果测试报告.md），
        // 编排只负责驱动与进度回写。
        const runEffectTests = async (round: string, cases: readonly string[]): Promise<void> => {
          if (storeInstance.getSnapshot().effectTest?.running) return
          if (cases.length === 0) return
          storeInstance.actions.patchEffectTest({
            running: true, round, queue: [...cases], currentIndex: -1, currentLabel: null,
            done: [], failures: [], finished: false, message: null,
          })
          for (let index = 0; index < cases.length; index += 1) {
            const caseId = cases[index]!
            const label = `效果验证-${round}-${caseId}`
            storeInstance.actions.patchEffectTest({ currentIndex: index, currentLabel: label })
            try {
              const project = await createStudioProject(label)
              await refreshProjects()
              await openProject(project)
              const sessionId = await testDriver.waitSessionBound(project.dir, EFFECT_TEST_START_TIMEOUT_MS)
              await setWorkflowMode(project.id, 'auto')
              // wakeAgent 静默吞错——编排场景需要显式失败分支，这里直接走 scope send。
              const scoped = sessionSvc.scope(sessionId)
              const conversation = scoped?.get('conversation')
              if (conversation === undefined) throwError('CS-EFFECT-004', { detail: 'conversation service undefined' })
              await conversation.send(`跑效果测试 ${caseId}（记为 ${round}）`)
              await testDriver.waitAgentTurn(sessionId, EFFECT_TEST_CASE_TIMEOUT_MS)
              const snapshot = storeInstance.getSnapshot().effectTest
              storeInstance.actions.patchEffectTest({ done: [...(snapshot?.done ?? []), label] })
            } catch (cause) {
              // D3 效果测试错误槽：文案交给统一错误系统决定 —— 登记的码用其
              // userMessage（开发模式附 [dev]），未登记的裸异常回退到 dev 细节
              // （面板是排障面，保留细节比隐藏更有用；用户面节点/toast 不这么做）。
              const failure = asCanvasError(cause)
              const action = routeError(failure, { devMode: isDevMode() })
              if (action.kind !== 'surface') {
                ctx.logger.warn(`[canvas-studio][${failure.code}] ${action.dev}`)
              }
              const message = action.kind === 'surface' ? action.message : action.dev
              const snapshot = storeInstance.getSnapshot().effectTest
              storeInstance.actions.patchEffectTest({
                done: [...(snapshot?.done ?? []), label],
                failures: [...(snapshot?.failures ?? []), `${label}: ${message}`],
              })
            }
          }
          const finished = storeInstance.getSnapshot().effectTest
          const succeeded = (finished?.done.length ?? 0) - (finished?.failures.length ?? 0)
          storeInstance.actions.patchEffectTest({
            running: false, currentIndex: -1, currentLabel: null, finished: true,
            message: `本轮 ${round} 完成：成功 ${succeeded} · 失败 ${finished?.failures.length ?? 0}。报告在各项目目录「效果测试报告.md」，跑 scripts/collect-effect-tests.mjs 归档。`,
          })
        }
        // ── REQ-021：应用内一键测试模式（「代驾」回归）────────────────────────
        // 场景执行器：建项目 → 逐条发送固定剧本 → 等回合空闲 → 拉持久化快照跑
        // 机器断言 → 报告覆盖写进测试项目目录。驱动与断言都是确定性代码（执行器
        // **不经过 LLM**，agent 在回合内自己调度）；回合空闲判据与 runEffectTests
        // 共用 test-driver.ts 的唯一实现。开关只控制浮窗可见（拍板④），跑不跑
        // 由用户在这里手点；同一时刻只允许一个场景在跑。
        let autoTestStopRequested = false
        /** 只读快照：报告记录「本次生效设置」（拍板：运行期间不改任何真实设置）。 */
        const autoTestEffectiveSettings = () => {
          const value = ctx.settingsScope
            .bind<CanvasStudioConfig>({ namespace: 'canvas-studio' })
            .getSnapshot().value
          // 设置未就绪时按 schema 默认值兜底（与 host-config 的 default 同值；
          // 不 import config.ts 取 DEFAULT_RESOLUTION —— 它有 node:crypto，
          // 客户端 bundle 拖不动，见 output-size.ts 头注）。
          return {
            aspectRatio: value?.defaultAspectRatio ?? '16:9',
            videoProvider: value?.defaultVideoProvider ?? 'drama',
            imageResolution: value?.defaultImageResolution ?? '736p',
            videoResolution: value?.defaultVideoResolution ?? '480p',
          }
        }
        const runAutoTestScenario = async (scenario: AutoTestScenario): Promise<void> => {
          if (storeInstance.getSnapshot().autoTest?.running) return
          const originProjectId = storeInstance.getSnapshot().selectedProjectId
          const startedAt = Date.now()
          const logs: { at: number; text: string; kind: 'info' | 'pass' | 'fail' }[] = []
          const appendLog = (text: string, kind: 'info' | 'pass' | 'fail' = 'info'): void => {
            logs.push({ at: Date.now(), text, kind })
            storeInstance.actions.patchAutoTest({ log: [...logs] })
          }
          autoTestStopRequested = false
          storeInstance.actions.patchAutoTest({
            running: true, scenarioId: scenario.id, scenarioLabel: scenario.label, round: null,
            currentStep: '准备：创建测试项目', projectId: null, projectName: null,
            log: [], checkpoints: [], reportProjectId: null, reportProjectName: null,
            originProjectId, finished: false, ok: null, message: null,
          })
          // 开场完整性守卫：场景引用的检查点 id 必须都在注册表内 —— 两侧任何漂移
          // 当场红（fail-fast），而不是跑到一半才红。
          const integrity = scenarioCheckpointErrors(scenario, AUTO_TEST_CHECKPOINTS)
          if (integrity.length > 0) {
            appendLog(integrity.join('；'), 'fail')
            storeInstance.actions.patchAutoTest({
              running: false, finished: true, ok: false, currentStep: null,
              message: '场景定义与检查点注册表不一致（见日志），未执行。',
            })
            return
          }
          const effective = autoTestEffectiveSettings()
          // 轮次号沿用 效果验证-R#（拍板①：吃到既有启动清扫；口径与 ProjectList 一致）。
          const maxRound = storeInstance.getSnapshot().projects.reduce((acc, project) => {
            const match = /^效果验证-R(\d+)-/.exec(project.name)
            return match === null ? acc : Math.max(acc, Number(match[1]))
          }, 0)
          const round = `R${String(maxRound + 1).padStart(3, '0')}`
          const label = `效果验证-${round}-${scenario.shortName}`
          const checkpointLines: AutoTestCheckpointLine[] = []
          let project: StudioProject | null = null
          try {
            storeInstance.actions.patchAutoTest({ round })
            // 放手跑模式随创建落盘（CV-196：模式是创建时锁定的具体决定），
            // 免去创建后再补打一次 setWorkflowMode。
            project = await createStudioProject(label, undefined, undefined, 'auto')
            await refreshProjects()
            storeInstance.actions.patchAutoTest({ projectId: project.id, projectName: project.name })
            appendLog(`项目已创建：${project.name}（放手跑模式）`)
            await openProject(project)
            const sessionId = await testDriver.waitSessionBound(project.dir, EFFECT_TEST_START_TIMEOUT_MS)
            appendLog('会话已绑定项目目录，开始逐条发送剧本')
            for (let turn = 0; turn < scenario.scriptTurns.length; turn += 1) {
              if (autoTestStopRequested) break
              const turnText = scenario.scriptTurns[turn]!
              const turnName = turn === 0 ? '创意剧本' : `追加指令 ${turn}`
              storeInstance.actions.patchAutoTest({ currentStep: `第 ${turn + 1} 轮：发送${turnName}，等待 agent 回合结束（上限 50 分钟）` })
              // 与 runEffectTests 同款：wakeAgent 静默吞错，编排场景需要显式失败
              // 分支，直接走 scope send（官方发送入口）。
              const scoped = sessionSvc.scope(sessionId)
              const conversation = scoped?.get('conversation')
              if (conversation === undefined) throwError('CS-EFFECT-004', { detail: 'conversation service undefined' })
              await conversation.send(turnText)
              await testDriver.waitAgentTurn(sessionId, EFFECT_TEST_CASE_TIMEOUT_MS)
              if (autoTestStopRequested) break
              appendLog(`第 ${turn + 1} 轮（${turnName}）回合结束，拉取持久化快照跑机器断言`)
              // 检查点只用持久化状态（拍板口径）：画布文档 / 产物历史 / 队列快照，
              // 不碰会话流。
              const [canvas, history] = await Promise.all([
                loadStudioCanvas(project.id),
                getStudioAssetHistory(project.id),
              ])
              const queue = await fetchStudioGenerateQueue()
              const snapshots = {
                project,
                nodes: canvas.nodes,
                history: history.entries,
                queue,
                expectedImageResolution: effective.imageResolution,
                expectedVideoResolution: effective.videoResolution,
              }
              const group = scenario.checkpointGroups.find(entry => entry.turn === turn)
              const results = runAutoTestCheckpoints(group?.checkpointIds ?? [], snapshots, turn)
              for (const result of results) {
                checkpointLines.push({ turn, ...result })
                appendLog(`[${result.pass ? 'PASS' : 'FAIL'}] ${result.label}`, result.pass ? 'pass' : 'fail')
              }
              storeInstance.actions.patchAutoTest({ checkpoints: checkpointLines.map(line => ({ ...line })) })
              // 报告覆盖写进测试项目目录（拍板②；写失败不中断场景，日志留痕，
              // 下一轮断言后会再写）。
              try {
                const markdown = buildAutoTestReport({
                  scenarioId: scenario.id,
                  scenarioLabel: scenario.label,
                  scenarioVersion: scenario.version,
                  round,
                  projectName: project.name,
                  projectDir: project.dir,
                  startedAt,
                  finishedAt: Date.now(),
                  appVersion: 'canvas-studio client (dev)',
                  effective,
                  results: checkpointLines,
                  snapshots,
                  sentTurns: [...scenario.scriptTurns],
                  // 浮窗执行日志随报告落盘（P0-a）：此前日志只活在前端内存，排障
                  // 必须去翻会话转录（R001 实证）。快照拷贝，报告拿到的是当刻定值。
                  logs: logs.map(entry => ({ ...entry })),
                })
                await saveTestReport(project.id, markdown)
                storeInstance.actions.patchAutoTest({ reportProjectId: project.id, reportProjectName: project.name })
                appendLog(`test-report.md 已更新（累计断言 ${checkpointLines.length} 条）`)
              } catch (cause) {
                appendLog(`报告写入失败：${cause instanceof Error ? cause.message : String(cause)}`, 'fail')
              }
            }
            const failed = checkpointLines.filter(entry => !entry.pass)
            const stopped = autoTestStopRequested
            storeInstance.actions.patchAutoTest({
              running: false, finished: true, currentStep: null,
              ok: failed.length === 0 && !stopped,
              message: stopped
                ? `场景已手动停止（轮次 ${round}）：断言 ${checkpointLines.length - failed.length}/${checkpointLines.length} 通过，报告已保留在测试项目目录。`
                : `场景完成（${round}）：断言 ${checkpointLines.length - failed.length}/${checkpointLines.length} 通过${failed.length > 0 ? `，失败 ${failed.length} 条` : ''}。报告在测试项目目录 test-report.md。`,
            })
          } catch (cause) {
            // 错误口径与 runEffectTests 一致：登记的码用统一错误系统的 userMessage
            // （浮窗是排障面，未登记的裸异常保留 dev 细节）。
            const failure = asCanvasError(cause)
            const action = routeError(failure, { devMode: isDevMode() })
            const message = action.kind === 'surface' ? action.message : action.dev
            appendLog(`执行中断：${message}`, 'fail')
            storeInstance.actions.patchAutoTest({
              running: false, finished: true, currentStep: null, ok: false,
              message: `场景中断（${round}）：${message}${project !== null ? '。报告与已落盘产物保留在测试项目目录。' : ''}`,
            })
          }
        }
        /** 请求停止当前场景：取消当前回合（waitAgentTurn 随之空闲返回），执行器在两条回合之间落停。 */
        const stopAutoTest = (): void => {
          autoTestStopRequested = true
          void cancelCurrentTurn().catch(() => {})
        }
        /**
         * 清理全部历史测试项目（名字匹配 效果验证-R#；**含有内容的也删** ——
         * 既有启动清扫只回收空项目，场景项目要靠这里显式回收）。沿用
         * deleteStudioProject 的删除语义（注册表移除 + 目录彻底删除）与
         * deleteProject 的 workspace 摘除路径，不另写删除逻辑；单个失败不阻塞
         * 其余（完成后 refreshProjects，返回实删数量供浮窗汇报）。
         */
        const cleanupTestProjects = async (): Promise<number> => {
          const targets = storeInstance.getSnapshot().projects
            .filter(project => /^效果验证-R\d+/.test(project.name))
          let removed = 0
          for (const project of targets) {
            try {
              await deleteStudioProject(project.id)
              const bound = ctx.workspaces.list.getSnapshot().items.find(item => item.path === project.dir)
              if (bound !== undefined) await ctx.workspaces.delete(bound.workspaceId)
              removed += 1
            } catch (cause) {
              ctx.logger.warn(`canvas-studio: cleanup test project ${project.name} failed: ${cause instanceof Error ? cause.message : String(cause)}`)
            }
          }
          await refreshProjects()
          return removed
        }
        const deleteProject = async (projectId: string): Promise<void> => {
          try {
            // CV-033：先取项目目录 —— 删除目录后要同步摘除绑定的 DSH
            // workspace，否则 workspace 残留占用项目名，新建同名项目时
            // rename 报 workspace-name-conflict（用户实测复现）。
            const project = storeInstance.getSnapshot().projects.find(entry => entry.id === projectId)
            await deleteStudioProject(projectId)
            if (project !== undefined) {
              const bound = ctx.workspaces.list.getSnapshot().items.find(item => item.path === project.dir)
              if (bound !== undefined) await ctx.workspaces.delete(bound.workspaceId)
            }
            await refreshProjects()
            if (storeInstance.getSnapshot().selectedProjectId === projectId) {
              storeInstance.actions.select(null)
              storeInstance.actions.clearProject(projectId)
              // 删除后自动切换下一个项目：必须走与点击项目行相同的 openProject
              // 链路（workspace 绑定 → 恢复/新建会话 → 载入画布）。若只靠
              // syncActiveProject 的 workspace→项目映射，它只 select + 载画布、
              // 不绑会话 —— 表现为「列表选中了，对话区却停在空 Hero」（用户实测）。
              // workspaces 快照经 SSE 异步投影：被删 workspace 若还没从 items 摘除，
              // recentWorkspaceId 仍指向已删目录 → resolveActiveProjectId 返回 null。
              // 所以先等投影落地（带超时兜底），再算下一个项目。
              if (project !== undefined) {
                const deadline = Date.now() + 5000
                while (
                  ctx.workspaces.list.getSnapshot().items.some(item => item.path === project.dir)
                  && Date.now() < deadline
                ) {
                  await new Promise(resolve => { setTimeout(resolve, 100) })
                }
              }
              const nextId = resolveActiveProjectId()
              const next = nextId === null
                ? undefined
                : storeInstance.getSnapshot().projects.find(entry => entry.id === nextId)
              if (next !== undefined) await openProject(next)
            }
          } catch (cause) {
            failWith(cause, '项目删除失败')
          }
        }
        return {
          layout,
          actions: storeInstance.actions,
          refreshProjects,
          createProject,
          // REQ-005 / CV-256：回首页（homePinned 短路，见下方 syncActiveProject 注释）。
          // v1.3 变体 A：创意提交走宿主发送拦截（DivertConversation 的 lobby 认领），
          // createProjectFromIdea / sendFirstMessage 三态链路随 LobbyComposer 退役。
          goHome,
          // CV-277：历史面板批量清理失效产物后重载画布（服务端已移除节点）。
          reloadCanvas: reloadCanvasQueued,
          openProject,
          deleteProject,
          createSampleProject,
          // CV-091：分组 CRUD + 移动（左侧栏可折叠分组）。
          refreshGroups,
          createGroup,
          renameGroup,
          deleteGroup,
          moveProjectToGroup,
          // REQ-001：全局资产库（清单缓存 + CRUD/锚点，写错误抛回调用方呈现）。
          refreshLibrary,
          createLibraryAsset: createLibraryAssetAndRefresh,
          updateLibraryAsset: updateLibraryAssetAndRefresh,
          deleteLibraryAsset: deleteLibraryAssetAndRefresh,
          addLibraryAnchor: addLibraryAnchorAndRefresh,
          uploadLibraryMedia: uploadLibraryMediaAndRefresh,
          persistCanvas,
          retryNode,
          cancelCurrentTurn,
          refreshWorkflow,
          approveStoryboard,
          rejectStoryboard,
          confirmKeyframes,
          rejectKeyframes,
          approveScreenplay,
          rejectScreenplay,
          setWorkflowMode,
          // 一键效果测试：串行跑指定用例（建项目 → 放手跑 → 发指令 → 等空闲）。
          runEffectTests,
          // REQ-021：自动测试场景执行器（建项目 → 逐条发送 → 机器断言 → 报告落盘）。
          runAutoTestScenario,
          stopAutoTest,
          cleanupTestProjects,
          // CV-066：装载 / 卸载 skill（store + skills.json 持久化）。
          activateSkill,
          deactivateSkill,
          // 设置弹窗：绑定 'canvas-studio' 命名空间作用域 + 惰性凭据客户端。
          settingsScope: ctx.settingsScope,
          getCredentials: () => ctx.get('connection')?.api?.credentials,
          // 模型设置：惰性取 Host wire 接口（llm/settings/credentials 三域）。
          // 与桌面 dsh 原生「模型」设置共享同一份存储，状态对等。
          getModelApi: () => (ctx.get('connection')?.api as unknown as CanvasStudioModelApi | undefined),
          // 资产库位置：复用 dsh 官方 client API `ctx.workspaces.pickDirectory()`，
          // 它在 macOS/Linux/Windows 都走宿主原生文件夹选择器（macOS→osascript、
          // Linux→Zenity/KDialog、Windows→IFileOpenDialog），返回的路径 dsh Host
          // 已校验可写，无需额外 validate 步骤。
          getDirectoryPicker: () => ({ pick: () => ctx.workspaces.pickDirectory() }),
          // CV-114：把素材插成聊天输入框里的真 chip（不可用时降级纯文本）。
          insertAssetChip: insertAssetChipForNode,
          // CV-124：把技能插成聊天输入框里的真 chip（同上降级策略）。
          insertSkillChip: insertSkillChipForName,
          insertLibChip: insertLibChipForId,
          // 主题分区复用桌面 dsh-client-ui-theme 运行时（切换全局浅色/深色/跟随系统）。
          theme: ctx.theme,
          // 组件经 useStudio 读取同一个实例（hooks 舱绑定为 use<Name>）。
          hooks: { studio: storeInstance },
        }
      },
    } as never, StudioFrame)
    return () => {
      disposeRegistration()
      void disposeService()
    }
  }, 'canvas-studio: layout service + studio root frame')
}
