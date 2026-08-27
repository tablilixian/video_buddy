import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import './slots-contracts.js'
import type { StudioCanvasNode, StudioCanvasView } from '../contracts/canvas.js'
import type { StudioProject } from '../contracts/project.js'
import { createAssetCaptureDefinition } from '../asset-capture.js'
import { answerStudioQuestion, createStudioProject, deleteStudioProject, getStudioWorkflow, listStudioProjects, loadStudioCanvas, postStudioWorkflowAction, retryStudioNode, saveStudioCanvas } from './api.js'
import { StudioLayoutController } from './layout-controller.js'
import { createProjectStore, isTransientNode, viewOf } from './project-store.js'
import { installStudioStyles } from './styles.js'
import { StudioFrame } from './StudioFrame.js'
import { registerQuestionChatNode } from './question-capture.js'
import { apply as applyCanvasStudioSettings } from './settings-card.js'

/**
 * Services required before the studio frame can mount.
 *
 * 注意：`tools` 是 Host 专属服务，客户端没有该服务。媒体生成工具已在 Host
 * 侧（`src/host-tools.ts`）注册，客户端只负责 UI、项目/工作区绑定，以及
 * 通过 `conversationEvents` 捕获工具产物到画布 store（P4），并把画布节点
 * 持久化到 Host（P4+ 重启恢复）。`sessions` 用于打断当前会话的生成回合。
 */
// 注意：settings-card 经 applyCanvasStudioSettings(ctx) 复用本 ctx，因此本插件
// 必须声明它实际（间接）用到的全部服务。DSH Cordis 为隔离 inject：未在列表中
// 声明的服务在 ctx 上不可访问，否则 settings-card 首句 ctx.get('connection')
// 会在桌面启动阶段抛 "service not found" 中断整个启动。
export const inject = ['slots', 'workspaces', 'conversationEvents', 'sessions', 'connection', 'settingsScope']

/** Dev-only seed sample media so the canvas is verifiable without a backend. */
const SEED_IMAGE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="260" height="180">'
  + '<rect width="100%" height="100%" fill="#4285f4"/>'
  + '<text x="50%" y="50%" fill="white" font-size="18" text-anchor="middle" dominant-baseline="middle">种子示例图</text>'
  + '</svg>',
)}`
const SEED_VIDEO = 'https://example.invalid/canvas-studio-seed/sample.mp4'

/** Pending-node placeholder box size per kind. */
const NODE_SIZE_PENDING: Readonly<Record<'image' | 'video', { width: number; height: number }>> = {
  image: { width: 260, height: 180 },
  video: { width: 260, height: 180 },
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
  // 块 3：注册 Canvas Studio 设置卡片（settings.plugin.item）。独立于 StudioFrame，
  // 因此在 advanced / compatibility 两种桌面模式下都提供配置入口。
  ctx.effect(() => applyCanvasStudioSettings(ctx), 'canvas-studio: settings card')
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
  // 类型收窄：`Context.sessions` 在类型图里既被 `@deepseek-ai/dsh-session`
  // （Host 端 SessionStore）也被 `@deepseek-ai/dsh-client-runtime`（ISessions）
  // 增强，编译时前者胜出导致 `ctx.sessions` 被解析成原始 API（无 open/binding/
  // 响应式 list）。客户端运行时实际挂载的是 ISessions，故在此以一致签名收窄。
  const sessionSvc = ctx.sessions as unknown as ISessions

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
    const recentId = snapshot.recentWorkspaceId
    if (recentId === undefined) return null
    const view = snapshot.items.find((item) => item.workspaceId === recentId)
    if (view === undefined || view.path === undefined) return null
    const project = storeInstance.getSnapshot().projects.find((entry) => entry.dir === view.path)
    return project?.id ?? null
  }
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
    const id = resolveActiveProjectId()
    if (id === null) return
    if (storeInstance.getSnapshot().selectedProjectId === id) return
    storeInstance.actions.select(id)
    void (async () => {
      await reloadCanvasQueued(id)
      void refreshWorkflow(id)
    })()
  }

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
  const PENDING_TIMEOUT_MS = 660_000
  const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const clearPendingTimer = (runId: string): void => {
    const timer = pendingTimers.get(runId)
    if (timer !== undefined) {
      clearTimeout(timer)
      pendingTimers.delete(runId)
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
    action: 'approve' | 'reject',
  ): Promise<void> => {
    const workflow = await postStudioWorkflowAction(projectId, action)
    storeInstance.actions.setWorkflow(projectId, workflow)
  }
  const approveStoryboard = (projectId: string): Promise<void> => applyWorkflowAction(projectId, 'approve')
  const rejectStoryboard = (projectId: string): Promise<void> => applyWorkflowAction(projectId, 'reject')
  const setWorkflowMode = async (projectId: string, mode: 'confirm' | 'auto'): Promise<void> => {
    const workflow = await postStudioWorkflowAction(projectId, 'setMode', mode)
    storeInstance.actions.setWorkflow(projectId, workflow)
  }
  // P7 点选式澄清：提交用户选择后，Host 侧 ask_user_choice 工具轮询到答案并
  // 清空问题；这里把带答案的工作流写回 store（卡片随即消失）。工具结果回流
  // 会触发一次 tool/result → refreshWorkflow 兜底同步。
  const answerQuestion = async (projectId: string, value: string): Promise<void> => {
    const workflow = await answerStudioQuestion(projectId, value)
    storeInstance.actions.setWorkflow(projectId, workflow)
  }

  ctx.effect(() => installStudioStyles(), 'canvas-studio: studio styles')
  ctx.effect(() => {
    // P4+：捕获画布工具产物。生成的节点由 Host 在落盘时写入 canvas.json（单一
    // 真相源）；这里只在该项目被选中时触发画布重载，不再依赖解析事件渲染文本
    // 里的 URL（后端异常 / 渲染差异时不可靠）。工具调用开始先放一个「生成中」
    // 占位节点，失败时经 tool/result 的 data.error 标记错误。
    const reloadCanvas = (projectId: string): Promise<void> => reloadCanvasQueued(projectId)
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
        const index = projectNodes.length
        const size = NODE_SIZE_PENDING[info.kind]
        storeInstance.actions.setPendingNode(projectId, {
          id: `pending-${info.runId}`,
          runId: info.runId,
          kind: info.kind,
          x: 40 + (index % 4) * 300,
          y: 40 + Math.floor(index / 4) * 240,
          width: size.width,
          height: size.height,
          createdAt: Date.now(),
          origin: 'agent',
          sourceIds: [],
          toolName: info.toolName,
          ...(info.arguments !== undefined ? { generationPrompt: info.arguments } : {}),
          isLoading: true,
          progress: 0,
        })
        const timer = setTimeout(() => {
          pendingTimers.delete(info.runId)
          storeInstance.actions.markPendingError(
            projectId,
            info.runId,
            '生成超时：等待产物超过上限。请在画布右键该节点选择「重试」，或在对话中让 agent 重新生成。',
          )
        }, PENDING_TIMEOUT_MS)
        pendingTimers.set(info.runId, timer)
      },
      onToolError: (projectId, runId, message) => {
        clearPendingTimer(runId)
        storeInstance.actions.markPendingError(projectId, runId, message)
      },
    }))
    return disposeCapture
  }, 'canvas-studio: reload canvas on generated assets')
  // 会话级归属：当前 workspace 变化（含应用启动恢复会话）时，把画布选中态对齐到
  // 该 workspace 绑定的项目并载入其画布，避免「产物已写盘却显示空态」。
  // 会话级项目归属：当前 workspace 变化（含应用启动恢复会话）时，把画布选中态对齐到
  // 该 workspace 绑定的项目并载入其画布，避免「产物已写盘却显示空态」。
  ctx.effect(() => {
    syncActiveProject()
    alignStartupSession()
    // 会话基线晚于工作区基线到达时，alignStartupSession 需要再被触发一次。
    const unsubscribeWorkspaces = ctx.workspaces.list.subscribe(() => {
      syncActiveProject()
      alignStartupSession()
    })
    const unsubscribeSessions = sessionSvc.list.subscribe(alignStartupSession)
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

  // 节点级重试 / 修改提示词：走 Host 生成路由，结果写回原节点（retryOf）。
  // 验收反馈 2026-08-25「点重试没反应」：此前失败经 markPendingError 只作用于
  // isLoading 的占位节点，对真实节点是空操作 —— 错误被静默吞掉。现在发起时
  // 立即进入加载态（画布出现进度遮罩），失败把错误写回节点本体（详情面板与
  // 节点徽标都会显示）；成功后排队重载画布，产物原地更新。
  const rerunNode = async (projectId: string, nodeId: string, overrides?: { prompt?: string }): Promise<void> => {
    const node = storeInstance.getSnapshot().nodes[projectId]?.find((entry) => entry.id === nodeId)
    if (node === undefined) return
    if (node.toolName === undefined || node.generationPrompt === undefined) {
      storeInstance.actions.updateNode(projectId, nodeId, {
        error: '该节点没有可重放的生成参数（仅 agent 生成的媒体节点支持重试）',
      })
      return
    }
    storeInstance.actions.updateNode(projectId, nodeId, { isLoading: true, progress: 0, error: undefined })
    try {
      await retryStudioNode(projectId, node, overrides)
      await reloadCanvasQueued(projectId)
    } catch (cause) {
      storeInstance.actions.updateNode(projectId, nodeId, {
        isLoading: false,
        error: cause instanceof Error ? cause.message : '重试失败',
      })
    }
  }
  const retryNode = (projectId: string, nodeId: string): Promise<void> => rerunNode(projectId, nodeId)
  const steerNode = (projectId: string, nodeId: string, prompt: string): Promise<void> => rerunNode(projectId, nodeId, { prompt })


  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('layout', layout)
    const disposeRegistration = ctx.slots.register({
      name: 'root',
      children: {
        'sidebar': { kind: 'single', scope: 'root' },
        'sidebar.settings': { kind: 'single', scope: 'root' },
        'conversation': { kind: 'single', scope: 'session-maybe' },
        'details': { kind: 'single', scope: 'session' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
      inject: () => {
        const refreshProjects = async (): Promise<void> => {
          storeInstance.actions.setPhase('loading')
          try {
            storeInstance.actions.setLoaded(await listStudioProjects())
            // 项目列表就绪后，对齐一次「当前 workspace → 项目」选中态。
            syncActiveProject()
          } catch (cause) {
            storeInstance.actions.setFailed(cause instanceof Error ? cause.message : '项目列表加载失败')
          }
        }
        // 持久化走同一条串行队列：快照在执行时刻取（而非调用时刻），
        // 并剔除瞬态占位节点 —— 生成中的占位绝不落盘（「黑色生成中图残留」
        // 的根因），队列保证最后一次保存写的永远是最新状态。
        const persistCanvas = (projectId: string): Promise<void> => enqueueCanvasIo(async () => {
          const snapshot = storeInstance.getSnapshot()
          const nodes = (snapshot.nodes[projectId] ?? []).filter(node => !isTransientNode(node))
          await saveStudioCanvas(projectId, nodes, viewOf(snapshot, projectId).view)
        })
        const openProject = async (project: StudioProject): Promise<void> => {
          storeInstance.actions.select(project.id)
          try {
            // workspace.create resolves an existing registration by path, so
            // binding is idempotent; the returned workspace is then in the
            // runtime list and the shared New Session action can navigate.
            const workspace = await ctx.workspaces.create({ path: project.dir })
            // Keep the workspace/session title in sync with the project name
            // so the conversation header matches the project list.
            await ctx.workspaces.rename(workspace.workspaceId, project.name)
            // 验收反馈 2026-08-25「切换后历史对话消失」：connectWorkspace 只复用
            // 工作区下的空白会话 —— 原会话一旦聊过（非 blank），startSession 每次
            // 都新开一个空会话并跳过去。这里改为恢复该工作区 updatedAt 最新的
            // 非空会话；确实没有（首次使用）才走 startSession 建空。
            if (!resumeLatestSession(workspace.workspaceId)) {
              ctx.workspaces.startSession(workspace.workspaceId)
            }
            // P4+：载入持久化画布（含视口）；dev 模式下若项目为空则注入种子。
            await reloadCanvasQueued(project.id)
            void refreshWorkflow(project.id)
            if (devSeed) {
              const loaded = storeInstance.getSnapshot().nodes[project.id] ?? []
              if (loaded.length === 0) {
                const seeded = seedNodes()
                storeInstance.actions.setNodes(project.id, seeded)
                await persistCanvas(project.id)
              }
            }
          } catch (cause) {
            storeInstance.actions.setFailed(cause instanceof Error ? cause.message : '项目会话绑定失败')
          }
        }
        const createProject = async (name: string): Promise<void> => {
          storeInstance.actions.setCreating(true)
          try {
            const project = await createStudioProject(name)
            await refreshProjects()
            await openProject(project)
          } catch (cause) {
            storeInstance.actions.setFailed(cause instanceof Error ? cause.message : '项目创建失败')
          } finally {
            storeInstance.actions.setCreating(false)
          }
        }
        const deleteProject = async (projectId: string): Promise<void> => {
          try {
            await deleteStudioProject(projectId)
            await refreshProjects()
            if (storeInstance.getSnapshot().selectedProjectId === projectId) {
              storeInstance.actions.select(null)
              storeInstance.actions.clearProject(projectId)
            }
          } catch (cause) {
            storeInstance.actions.setFailed(cause instanceof Error ? cause.message : '项目删除失败')
          }
        }
        const openSettings = (): void => {
          try {
            const connection = ctx.get('connection')
            const api = connection?.api
            if (api?.settings?.openDocument) {
              void api.settings.openDocument({})
            } else {
              window.alert('设置面板不可用：当前环境未提供 settings 服务')
            }
          } catch (cause) {
            window.alert('打开设置失败：' + (cause instanceof Error ? cause.message : String(cause)))
          }
        }
        return {
          layout,
          actions: storeInstance.actions,
          refreshProjects,
          createProject,
          openProject,
          deleteProject,
          openSettings,
          persistCanvas,
          retryNode,
          steerNode,
          cancelCurrentTurn,
          refreshWorkflow,
          approveStoryboard,
          rejectStoryboard,
          setWorkflowMode,
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
