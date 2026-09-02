import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// 引入 conversation 插件的类型增强：Context 上获得 `conversation: IConversation`
// （含 send(text)），用于批准/驳回/确认关键帧后自动唤醒 agent（O1）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import './slots-contracts.js'
import type { StudioCanvasNode, StudioCanvasView } from '../contracts/canvas.js'
import type { StudioProject } from '../contracts/project.js'
import { createAssetCaptureDefinition } from '../asset-capture.js'
import { answerStudioQuestion, createStudioProject, deleteStudioProject, getStudioWorkflow, listStudioProjects, loadActiveSkills, loadStudioCanvas, postStudioWorkflowAction, retryStudioNode, saveActiveSkills, saveStudioCanvas } from './api.js'
import { createBriefCaptureDefinition } from './brief-capture.js'
import { installBrandStyles } from './brand-inject.js'
import { HeroBrandMark } from './brand/HeroBrandMark.js'
import { StudioLayoutController } from './layout-controller.js'
import { BRIEF_NODE_TOOL, activeSkillsOf, createProjectStore, isTransientNode, viewOf } from './project-store.js'
import { installStudioStyles } from './styles.js'
import { StudioFrame } from './StudioFrame.js'
import type { CanvasStudioConfig } from '../host-config.js'
import type { CanvasStudioModelApi } from './contracts.js'
import { registerQuestionChatNode } from './question-capture.js'

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

  /** 画布持久化（排队执行；剔除瞬态占位节点）。与 props.persistCanvas 同一语义。 */
  const persistCanvasQueued = (projectId: string): Promise<void> => enqueueCanvasIo(async () => {
    const snapshot = storeInstance.getSnapshot()
    const nodes = (snapshot.nodes[projectId] ?? []).filter(node => !isTransientNode(node))
    await saveStudioCanvas(projectId, nodes, viewOf(snapshot, projectId).view)
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
  const setWorkflowMode = async (projectId: string, mode: 'confirm' | 'auto'): Promise<void> => {
    // CV-056：从「等待类状态」解除等待后必须唤醒 agent。AI 在调完
    // submit_*_for_approval 时已按工具返回文本的指示结束了回合并在静默等待，
    // 状态条翻成「制作中」并不会让它自己往下走——不唤醒的话流程实际停摆，
    // 用户会以为切到放手跑就自动续跑了。
    const before = storeInstance.getSnapshot().workflows[projectId]
    const workflow = await postStudioWorkflowAction(projectId, 'setMode', mode)
    storeInstance.actions.setWorkflow(projectId, workflow)
    const wasWaiting = before?.state === 'awaiting_approval' || before?.state === 'keyframe_review'
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
    register(options: { name: string }, component: unknown): () => void
  }
  slots.inject(
    'conversation.hero.brand.mark',
    () => slots.register({ name: 'conversation.hero.brand.mark' }, HeroBrandMark),
  )
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
    syncHasConversation()
    alignStartupSession()
    // 会话基线晚于工作区基线到达时，alignStartupSession 需要再被触发一次。
    const unsubscribeWorkspaces = ctx.workspaces.list.subscribe(() => {
      syncActiveProject()
      syncHasConversation()
      alignStartupSession()
    })
    // CV-034：会话列表变化（含启动恢复）也触发画布对齐 —— 当前会话的 cwd
    // 是「画布跟随对话」的第一映射来源，会话晚到时必须补一次同步。
    // CV-064 二期：blank 翻转（首条消息 ACCEPTED）同样走此订阅 → 自动切 work。
    const unsubscribeSessions = sessionSvc.list.subscribe(() => {
      syncActiveProject()
      syncHasConversation()
      alignStartupSession()
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

  // 节点级重试 / 修改提示词：走 Host 生成路由，结果写回原节点（retryOf）。
  // 验收反馈 2026-08-25「点重试没反应」：此前失败经 markPendingError 只作用于
  // isLoading 的占位节点，对真实节点是空操作 —— 错误被静默吞掉。现在发起时
  // 立即进入加载态（画布出现进度遮罩），失败把错误写回节点本体（详情面板与
  // 节点徽标都会显示）；成功后排队重载画布，产物原地更新。
  const rerunNode = async (projectId: string, nodeId: string, overrides?: { prompt?: string }): Promise<void> => {
    const node = storeInstance.getSnapshot().nodes[projectId]?.find((entry) => entry.id === nodeId)
    if (node === undefined) return
    // CV-018：已在生成中的节点忽略重复触发 —— 重放不是幂等操作，双击重试
    // 按钮会派发两次 click（详情面板/右键菜单连点同理），不拦就是多烧一次
    // 生成。这一处守卫覆盖全部入口（节点徽章、右键菜单、详情面板）。
    if (node.isLoading === true) return
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
        // 注意：`sidebar.settings` 不在此声明 —— 它是 dsh-client-ui-sidebar
        // 包拥有的子槽（sidebar 包在 client.js 内 register 并 renderSlot）。
        // canvas-studio 只通过 StudioFrame 的 renderSlot('sidebar.settings') 渲染进
        // 该槽；若在此重复声明，loader 加载 sidebar 包时会报「slot already declared」。
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
        /** 画布为空时预置示例节点（onboarding 示例项目 / dev-seed 共用），幂等。 */
        const seedProjectIfEmpty = async (projectId: string): Promise<void> => {
          const loaded = storeInstance.getSnapshot().nodes[projectId] ?? []
          if (loaded.length > 0) return
          const seeded = seedNodes()
          storeInstance.actions.setNodes(projectId, seeded)
          await persistCanvas(projectId)
        }
        const openProject = async (project: StudioProject): Promise<void> => {
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
            // 验收反馈 2026-08-25「切换后历史对话消失」：connectWorkspace 只复用
            // 工作区下的空白会话 —— 原会话一旦聊过（非 blank），startSession 每次
            // 都新开一个空会话并跳过去。这里改为恢复该工作区 updatedAt 最新的
            // 非空会话；确实没有（首次使用）才走 startSession 建空。
            if (!resumeLatestSession(workspace.workspaceId)) {
              ctx.workspaces.startSession(workspace.workspaceId)
            }
            // P4+：载入持久化画布（含视口）；载入完成后补落暂存的创意节点。
            await reloadCanvasQueued(project.id).then(() => flushPendingBrief(project.id))
            // CV-064 二期：会话已定（恢复历史 / 新建空白），现算一次「有对话」判据。
            syncHasConversation()
            // CV-066：载入已装载 skill（skills.json；失败静默 —— 下次仍会重试）。
            try {
              storeInstance.actions.setActiveSkills(project.id, await loadActiveSkills(project.id))
            } catch {
              /* 装载清单加载失败静默 */
            }
            void refreshWorkflow(project.id)
            if (devSeed) {
              await seedProjectIfEmpty(project.id)
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
            storeInstance.actions.setFailed(cause instanceof Error ? cause.message : '示例项目创建失败')
          } finally {
            storeInstance.actions.setCreating(false)
          }
        }
        // 一键效果测试（2026-09-02）：串行编排「建项目 → 放手跑 → 发测试指令 → 等
        // 回合空闲」。空闲判据两层：先等会话 running 翻 true（回合已启动），再等
        // running=false 且无 pendingInteraction（question 类阻塞由 ask_user_choice
        // 超时自动结算；approval 类弹窗没有客户端 API 可自动批准——超时即记失败，
        // 由人工接管）。产物与报告由 Host 落盘（canvas.json / 效果测试报告.md），
        // 编排只负责驱动与进度回写。
        const EFFECT_TEST_START_TIMEOUT_MS = 120_000
        const EFFECT_TEST_CASE_TIMEOUT_MS = 25 * 60_000
        const effectTestPoll = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })
        /** 等当前会话切到目标项目（cwd 匹配；openProject 的 startSession 是 fire-and-forget）。 */
        const waitSessionBound = async (projectDir: string, timeoutMs: number): Promise<string> => {
          const deadline = Date.now() + timeoutMs
          while (Date.now() < deadline) {
            const sessions = sessionSvc.list.getSnapshot()
            const summary = sessions.current === undefined ? undefined : sessions.byId[sessions.current]
            if (summary !== undefined && summary.cwd === projectDir) return summary.id
            await effectTestPoll(1500)
          }
          throw new Error('会话绑定项目超时')
        }
        /** 等一轮 agent 回合完整结束（启动 → 稳定空闲）。 */
        const waitAgentTurn = async (sessionId: string, timeoutMs: number): Promise<void> => {
          const started = Date.now()
          let sawRunning = false
          let idleStreak = 0
          while (Date.now() - started < timeoutMs) {
            const summary = sessionSvc.list.getSnapshot().byId[sessionId]
            if (summary?.running === true) sawRunning = true
            const idle = summary !== undefined && summary.running !== true && summary.pendingInteraction === undefined
            idleStreak = idle ? idleStreak + 1 : 0
            if (sawRunning && idleStreak >= 2) return
            if (!sawRunning && Date.now() - started > EFFECT_TEST_START_TIMEOUT_MS) {
              throw new Error('测试指令发出后回合未启动')
            }
            await effectTestPoll(3000)
          }
          throw new Error('等待 agent 回合结束超时')
        }
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
              const sessionId = await waitSessionBound(project.dir, EFFECT_TEST_START_TIMEOUT_MS)
              await setWorkflowMode(project.id, 'auto')
              // wakeAgent 静默吞错——编排场景需要显式失败分支，这里直接走 scope send。
              const scoped = sessionSvc.scope(sessionId)
              const conversation = scoped?.get('conversation')
              if (conversation === undefined) throw new Error('会话 conversation 服务未就绪')
              await conversation.send(`跑效果测试 ${caseId}（记为 ${round}）`)
              await waitAgentTurn(sessionId, EFFECT_TEST_CASE_TIMEOUT_MS)
              const snapshot = storeInstance.getSnapshot().effectTest
              storeInstance.actions.patchEffectTest({ done: [...(snapshot?.done ?? []), label] })
            } catch (cause) {
              const message = cause instanceof Error ? cause.message : String(cause)
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
            }
          } catch (cause) {
            storeInstance.actions.setFailed(cause instanceof Error ? cause.message : '项目删除失败')
          }
        }
        return {
          layout,
          actions: storeInstance.actions,
          refreshProjects,
          createProject,
          openProject,
          deleteProject,
          createSampleProject,
          persistCanvas,
          retryNode,
          steerNode,
          cancelCurrentTurn,
          refreshWorkflow,
          approveStoryboard,
          rejectStoryboard,
          confirmKeyframes,
          setWorkflowMode,
          // 一键效果测试：串行跑指定用例（建项目 → 放手跑 → 发指令 → 等空闲）。
          runEffectTests,
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
