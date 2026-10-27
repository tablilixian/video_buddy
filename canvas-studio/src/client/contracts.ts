/**
 * Studio root-frame inject face: the shared store (via the framework's hooks
 * compartment) plus the business callbacks the apply world provides to the
 * frame (plain data and callbacks; no hooks, no ctx).
 */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { EngineStoreInstance } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { StoryboardVersionsPayload, StoryboardWriteResult, StoryboardDiffEntry } from './api.js'
import type { StudioProject, StudioProjectPlan, StudioWorkflowMode } from '../contracts/project.js'
import type { LibAnchorRef, LibraryAsset, LibraryCreateRequest, LibraryUpdateRequest } from '../contracts/asset-library.js'
import type { ProjectStoreActions, ProjectStoreState } from './project-store.js'
// REQ-021：场景定义形状（type-only；纯数据模块在 src/ 根，单测直连）。
import type { AutoTestScenario } from '../auto-test-scenarios.js'
// REQ-005 v1.3：首页规格草稿形状（type-only，不引 react 组件）。
// REQ-028：草稿类型与映射真值搬进 src/lobby-spec.ts（两侧共用，可真 import 单测）。
import type { LobbySpecDraft } from '../lobby-spec.js'
import type { ResolutionId } from '../resolution-tiers.js'

/** 某 settings 命名空间的响应式作用域（dsh 0.2.1 `ctx.configForms`，canvas-studio 客户端用）。 */
export interface CanvasStudioSettingsScope {
  get<T>(entryId: string): ConfigForm<T>
}

// ---- 0.2.1 wire 面（`ctx.remote` 三域）----
// 方法签名取自各域包的生成 remote-client 投影（typert 声明合并进
// `TypertRemoteNamespaceMap`），本地只做命名收窄、不手写签名（防漂移）。
// 运行时由客户端装配按 `remote.<namespace>` 提供同名 Cordis 服务；
// `import type {}` 仅拉类型合并，零运行时副作用。
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-llm/remote'
import type {} from '@deepseek-ai/dsh-api-settings-controller/remote'
import type { LlmDiscoveredModel, LlmModelDiscoveryRequest, LlmProviderInfo } from '@deepseek-ai/dsh-llm/types'
import type { SettingsDescribeValue, SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-settings/types'
import type { CredentialInfo } from '@deepseek-ai/dsh-credentials/types'
import type { ConfigurableProviderView } from '../model-directory.js'

export type { ConfigurableProviderView }
export type { LlmDiscoveredModel, LlmModelDiscoveryRequest, LlmProviderInfo }
export type { SettingsDescribeValue, SettingsNamespaceView, SettingsPathOpView }
/** 0.2.1 兼容别名：旧名 DiscoveredModelView = 上游 LlmDiscoveredModel。 */
export type DiscoveredModelView = LlmDiscoveredModel
/** 单个凭据 ref 的状态视图（credentials.describe 值行；值不落明文）。 */
export type CredentialView = CredentialInfo

/** 凭据客户端面（设置弹窗保存 / 查询密钥用；0.2.1 `remote.credentials` 命名空间）。 */
export type CanvasStudioCredentials = TypertRemoteNamespaceMap['credentials']

/**
 * 模型设置所需的 Host wire 接口（仅取 canvas-studio 实际用到的三个域）。
 *
 * 直接复用桌面 `dsh-client-ui-settings-models` 的 `ModelsSettingsStore` /
 * `ModelsSection` 不可行——它们包内私有、不导出，且没有打开桌面设置页的命令。
 * 但 dsh 的模型设置本质是一层很薄的前端，背后只有三个 wire 域：`llm`
 * （provider 目录 + 模型发现）、`settings`（namespace 视图读写）、
 * `credentials`（密钥）。本面板只取这几个域、调用与桌面原生「模型」设置
 * 完全相同的接口，因此状态与桌面原生设置**共享同一份存储**，功能对等。
 */
export interface CanvasStudioModelApi {
  llm: TypertRemoteNamespaceMap['llm']
  settings: TypertRemoteNamespaceMap['settings']
  credentials: CanvasStudioCredentials
}

/** The store instance's bound actions (draft stripped by the runtime). */
export type StudioActions = EngineStoreInstance<ProjectStoreState, ProjectStoreActions>['actions']

/**
 * DD-09 / d：输入区「项目上下文条」的注入面。
 *
 * 它只需要**同一个 store 实例**（`index.ts` 的 `storeInstance`），不引入第二份
 * 状态、也不需要动作面（本批不做按钮：宿主把可点元素划给 `input.left` /
 * `input.right`）。
 *
 * CV-179 起，阶段胶囊（原 DD-09 / c 的 `StageChipInjected`）**并入这条带子** ——
 * 它撤出 `conversation.session.header.utilities` 是为了把宽度还给宿主的会话标题
 * （根因与实测见 `src/project-context.ts` 文件头）。胶囊随之退化成纯展示组件，
 * 不再有自己的注入舱：判定由 `deriveProjectContextView` 一处给出。
 */
export interface ProjectContextInjected {
  hooks: {
    /** 共用 studio store（选中项目 + 项目记录表 + 每项目 workflow 与画布节点）。 */
    studio: HostObservable<ProjectStoreState>
  }
}

/**
 * 「刚上传的素材」回执卡（`conversation.input.dock`，2026-09-22 视频 / CV-247 泛化到
 * 音频与文字）的注入面。
 *
 * 与 ProjectContextBar 同一个 store（**不存在第二份状态**）；额外多一个回调是为了
 * 「移除卡片」—— 注入面的既有约定是「plain data and callbacks」，所以给回调而不是
 * 整个 actions 面。
 */
export interface MediaUploadBarInjected {
  hooks: {
    studio: HostObservable<ProjectStoreState>
  }
  /** 摘掉某张上传回执卡（**只动卡片**：节点已在画布上，不联动删素材）。 */
  dismissUpload: (projectId: string, id: string) => void
}

/**
 * REQ-005 v1.3（变体 A）：首页规格行（`conversation.input.dock` 槽）的注入面。
 *
 * 与 MediaUploadBar 同一条 dock、同一个 store：草稿值 `lobbySpec` 是
 * **发送拦截分支（lobby 认领）也要读的**，所以放 store 而不是组件 state ——
 * 组件树之外读不到 state。写走注入回调（与 dismissUpload 同一约定：
 * plain data + callbacks），模式默认值对齐由注册侧读设置页（`ctx.settingsScope`）。
 */
export interface LobbySpecRowInjected {
  hooks: {
    studio: HostObservable<ProjectStoreState>
  }
  /** 写规格草稿（注册侧负责在 mode 变化时置 modeDirty）。 */
  setSpec: (spec: LobbySpecDraft) => void
  /** 设置页「默认执行模式」的惰性读取（进首页对齐一次用，CV-196 口径）。 */
  defaultMode(): StudioWorkflowMode
  /**
   * 设置页「视频默认分辨率」的惰性读取（2026-10-27）：首页 chip 进页面时按它对齐一次。
   *
   * 为什么读视频档而不是图片档：首页这一行是**成片规格**（画幅 + 清晰度 + 时长），
   * 落 plan 后驱动的是视频生成。改造前 chip 初值硬编码 720P，而出厂视频默认是 480P ——
   * 用户进首页看到 720P、出片 480P，且这中间没有任何一步会纠正它。
   */
  defaultResolution(): ResolutionId
}

/**
 * REQ-005 v1.4（CV-261）：首页「已暂存素材」条（`conversation.input.dock` 槽）的注入面。
 *
 * 与 MediaUploadBar 同一条 dock、同一个 store（`lobbyStash`）：清单是**发送拦截分支
 * （lobby 落盘）也要读的**，所以放 store —— 组件树之外读不到组件 state。写走注入回调
 * （与 dismissUpload 同一约定：plain data + callbacks），文件分类与落盘全在
 * `lobby-stash.ts` 与拦截分支里，本组件只负责「看得见 + 能移除」。
 */
export interface LobbyStashBarInjected {
  hooks: {
    studio: HostObservable<ProjectStoreState>
  }
  /** 摘掉一条暂存（**只动清单**：文件尚未落盘，没有画布节点可联动）。 */
  dismissStash: (id: string) => void
}

/** Inject face of the studio root registration. */
export interface StudioProjectListInjected {
  hooks: {
    /** The shared studio store (selection, registry, per-project canvas nodes). */
    studio: HostObservable<ProjectStoreState>
  }
  /** The layout service the frame exposes through the standard layout slot. */
  layout: ILayout
  /**
   * All declared store actions, bound to the shared instance. Components write
   * through these; the apply world owns async fetch/persist orchestration.
   */
  actions: StudioActions
  /** Re-pull the project registry into the store. */
  refreshProjects(): Promise<void>
  /** Create a project (registry + disk directory), select it, and open its session.
   * CV-099：`plan` 为创建时锁定的产出规格（画幅 / 目标总时长），省略即未锁定。
   * CV-196：`mode` 为创建时锁定的执行模式（实现 `index.ts` 一直收这个参数，此处
   * 旧声明漏写 —— CV-256 顺手补齐）。 */
  createProject(name: string, groupId?: string | null, plan?: StudioProjectPlan, mode?: StudioWorkflowMode): Promise<void>
  /**
   * REQ-005 / CV-256：回首页（品牌区 / 左栏「+ 新建项目」/ 分组头「+」）。
   *
   * 置 `homePinned` 抑制 `syncActiveProject` 把用户踢回项目 —— workspaces /
   * sessions 任何变化都会按「最近 workspace → 项目」重新 select（方案 §5.3）。
   * 不清当前会话：用户可能马上点回项目继续聊。
   */
  goHome(): void
  /**
   * CV-277：从磁盘重载某项目画布进 store（排队执行，避免与保存交错）。
   *
   * 给「服务端已改了 canvas.json、客户端 store 必须跟磁盘一致」的动作用——目前
   * 只有历史面板的批量清理失效产物（会移除画布节点）。走既有
   * `reloadCanvasQueued` 同一条串行链，不新开写盘通道。
   */
  reloadCanvas(projectId: string): Promise<void>
  /** Select a project and bind the conversation to its workspace session. */
  openProject(project: StudioProject): Promise<void>
  /** Delete a project (registry record + disk directory + canvas). */
  deleteProject(projectId: string): Promise<void>
  /** CV-091：拉取分组元信息进 store。 */
  refreshGroups(): Promise<void>
  /** CV-091：新建分组。 */
  createGroup(name: string): Promise<void>
  /** CV-091：重命名分组。 */
  renameGroup(groupId: string, name: string): Promise<void>
  /** CV-091：删除分组（组内项目回落未分组）。 */
  deleteGroup(groupId: string): Promise<void>
  /** CV-091：把项目移入/移出分组（groupId=null 即归未分组）。 */
  moveProjectToGroup(projectId: string, groupId: string | null): Promise<void>
  /** REQ-001：拉取全局资产库清单进 store（资产库页打开 / 入库成功后刷新）。 */
  refreshLibrary(): Promise<void>
  /** REQ-001：新建库资产（`anchors` 非空 = 从画布入库），成功后刷新清单缓存。 */
  createLibraryAsset(request: LibraryCreateRequest): Promise<LibraryAsset>
  /** REQ-001：更新库资产元数据（名称/分类/别名/描述/标签/提示词/媒体元数据），成功后刷新缓存。 */
  updateLibraryAsset(id: string, request: LibraryUpdateRequest): Promise<LibraryAsset>
  /** REQ-001：删除库资产（注册表墓碑 + 清媒体目录），成功后刷新缓存。 */
  deleteLibraryAsset(id: string): Promise<void>
  /** REQ-001：给已有资产追加画布锚点（再挂一张参考图；媒体由 Host 同步拷入），成功后刷新缓存。 */
  addLibraryAnchor(id: string, anchor: LibAnchorRef): Promise<LibraryAsset>
  /** REQ-001：上传一份媒体进库条目（octet-stream；Host 落 `m_<n>` + contentHash），成功后刷新缓存。 */
  uploadLibraryMedia(id: string, file: File, label?: string): Promise<LibraryAsset>
  /** 创建示例项目（建项目 + 预置画布节点，onboarding 欢迎屏入口）。 */
  createSampleProject(): Promise<void>
  /** Persist the selected project's canvas node list to the Host. */
  persistCanvas(projectId: string): Promise<void>
  /**
   * CV-114：把画布素材插成右侧聊天输入框里的**真引用 chip**（与打 `@` 选中
   * 候选同一产物）。上游引用管线不可用 / 当前无会话 / 素材不在画布上时返回
   * false，调用方降级为纯文本 `@ref[...]` 注入。
   */
  insertAssetChip(nodeId: string): boolean
  /**
   * CV-124：把技能插成输入框里的**真引用 chip**（`/` 菜单 /「使用」按钮同一
   * 产物，显示 `⚡短标题`，整体可删）。管线不可用 / 无会话 / 技能不在目录时
   * 返回 false，调用方降级为纯文本提示词注入。
   */
  insertSkillChip(name: string): boolean
  /**
   * REQ-001：把库资产插成输入框里的**真引用 chip**（`@` 选中 / 详情抽屉「引用到
   * 对话」同一产物，显示资产名，序列化 `@ref[lib:<id>]`）。管线不可用 / 无会话 /
   * 资产不在缓存时返回 false，调用方降级为纯文本注入。
   */
  insertLibChip(assetId: string): boolean
  /**
   * 按**节点上已保存的**生成参数重试一个节点（写回原节点，不产生新边）。
   * 参数编辑走 `updateNode({ generationPrompt })`，本接口不接受覆盖 ——
   * 见 `src/node-params.ts` 的说明。
   */
  retryNode(projectId: string, nodeId: string): Promise<void>
  /** 打断当前会话的运行中回合（stop 生成）。 */
  cancelCurrentTurn(): Promise<void>
  /** P7：拉取某项目的工作流状态进 store（打开项目与审批动作后调用）。 */
  refreshWorkflow(projectId: string): Promise<void>
  /** P7：确认关键帧（keyframe_review → executing），并自动发送「继续」继续视频流程。 */
  confirmKeyframes(projectId: string): Promise<void>
  /**
   * CV-051：打回关键帧（keyframe_review → executing，放行逐镜重出），并把用户在
   * 意见框里写下的不满意点定向转述给 agent；feedback 留空时只发通用重做指令。
   */
  rejectKeyframes(projectId: string, feedback?: string): Promise<void>

  /** REQ-022：把「拍摄定稿」落到画布（覆盖层「确认落地」）。`version` 省略 = 落活副本。 */
  landStoryboard(projectId: string, version?: string): Promise<{ shots: number; nodes: number; assets: number; version: string; warnings: readonly string[] }>
  /** REQ-022：读版本摘要（版本面板）。 */
  fetchStoryboardVersions(projectId: string): Promise<StoryboardVersionsPayload>
  /** REQ-022：把活副本存成一个新版本。 */
  archiveStoryboardVersion(projectId: string, label?: string, note?: string): Promise<StoryboardWriteResult>
  /** REQ-022：回退到某个历史版本（Host 先自动打点当前活副本）。 */
  restoreStoryboardVersion(projectId: string, version: string): Promise<StoryboardWriteResult>
  /** REQ-022：改版本名。 */
  renameStoryboardVersion(projectId: string, version: string, label: string, note?: string): Promise<StoryboardWriteResult>
  /** REQ-022：读两版字段级差异。 */
  fetchStoryboardDiff(projectId: string, from: string, to: string): Promise<{ total: number; entries: readonly StoryboardDiffEntry[] }>
  /** P7：切换执行模式（confirm / auto），并同步门禁状态。 */
  setWorkflowMode(projectId: string, mode: 'confirm' | 'auto'): Promise<void>
  /** 一键效果测试：串行跑指定用例（每例建独立项目 → 切放手跑 → 发测试指令 → 等回合空闲）；进度写 store.effectTest。 */
  runEffectTests(round: string, cases: readonly string[]): Promise<void>
  /**
   * REQ-021：跑一个自动测试场景（建项目 → 逐条发送固定剧本 → 等回合空闲 →
   * 持久化快照机器断言 → test-report.md 落盘）；进度写 store.autoTest。
   * 同一时刻只允许一个场景在跑（防重入由执行器守卫）。
   */
  runAutoTestScenario(scenario: AutoTestScenario): Promise<void>
  /** REQ-021：请求停止当前场景（取消当前回合；执行器在两条回合之间落停）。 */
  stopAutoTest(): void
  /**
   * REQ-021：清理全部历史测试项目（名字匹配 效果验证-R#，含有内容的也删 ——
   * 启动清扫只回收空项目）。沿用 deleteStudioProject 删除语义；返回实删数量。
   */
  cleanupTestProjects(): Promise<number>
  /** CV-066：装载一个 skill 到项目（store 即时更新 + skills.json 持久化；失败回滚 store）。 */
  activateSkill(projectId: string, name: string): Promise<void>
  /** CV-066：从项目卸载一个 skill（store 即时更新 + skills.json 持久化；失败回滚 store）。 */
  deactivateSkill(projectId: string, name: string): Promise<void>
  /** 绑定 'canvas-studio' 命名空间的 settings 作用域（供设置弹窗读写配置）。 */
  settingsScope: CanvasStudioSettingsScope
  /** 惰性取凭据客户端（密钥写凭据域，不落明文）；凭据服务未就绪时返回 undefined。 */
  getCredentials(): CanvasStudioCredentials | undefined
  /** 惰性取模型设置所需的 Host wire 接口（llm/settings/credentials 三域）；连接未就绪时返回 undefined。 */
  getModelApi(): CanvasStudioModelApi | undefined
  /** 惰性取桌面原生目录选择器（设置页「资产库位置」用）；OS chooser 选出的路径 dsh Host 已校验可写。 */
  getDirectoryPicker(): { pick: () => Promise<string | null> } | undefined
  /** 桌面主题运行时（设置页「主题」分区复用，切换全局浅色/深色/跟随系统）。 */
  theme: ThemeRuntime
  /**
   * 订阅全局主题变化（宿主 `theme/change`）。`ThemeRuntime` 本身**不暴露 subscribe**
   * （见其类型注释），组件拿不到重渲染信号时会停在旧色板 —— 覆盖层 iframe 尤其明显：
   * 它的色板是渲染时写进 URL 的，不重渲染就不会重新加载。
   * 返回取消订阅函数。
   */
  subscribeTheme(listener: () => void): () => void
}