/**
 * Shared project-record wire types for the Canvas Studio host registry and
 * the browser client. Pure types plus small pure helpers (normalizeWorkflow /
 * resolveSetModePatch): both halves import them and erase them at build time,
 * so this file never appears in the runtime bundles.
 */

/** P7 执行模式：confirm 逐步确认；auto 放手跑（跳过审批门禁）。 */
export type StudioWorkflowMode = 'confirm' | 'auto'

/** P7 工作流状态：drafting 需求澄清/规划中；script_review 剧本待批准（CV-100）；awaiting_approval 分镜表待批准；keyframe_review 关键帧待确认；executing 执行中。 */
export type StudioWorkflowState = 'drafting' | 'script_review' | 'awaiting_approval' | 'keyframe_review' | 'executing'

/** 每个项目的创作工作流状态机（P7 门控的持久化事实源）。 */
export interface StudioWorkflow {
  mode: StudioWorkflowMode
  state: StudioWorkflowState
  /** 进行中的点选问题（ask_user_choice）；无问题时缺省。 */
  pendingQuestion?: StudioPendingQuestion | null
}

/** 旧记录 / 新建项目的默认工作流。 */
export const WORKFLOW_DEFAULT: StudioWorkflow = { mode: 'confirm', state: 'drafting' }

/**
 * Leniently coerce an unknown parsed workflow into a safe value; invalid or
 * missing fields degrade to their defaults (registry records may predate P7).
 */
export function normalizeWorkflow(value: unknown): StudioWorkflow {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ...WORKFLOW_DEFAULT }
  }
  const record = value as Record<string, unknown>
  const workflow: StudioWorkflow = {
    mode: record.mode === 'auto' ? 'auto' : 'confirm',
    state: record.state === 'awaiting_approval' || record.state === 'script_review' || record.state === 'keyframe_review' || record.state === 'executing'
      ? record.state
      : 'drafting',
  }
  const pending = record.pendingQuestion
  if (pending !== null && pending !== undefined && typeof pending === 'object' && !Array.isArray(pending)) {
    const question = pending as Record<string, unknown>
    // CR-029：options 缺失/非法时给出可见告警而非静默清空——空数组会不可恢复地
    // 写回 registry，使点选卡片无候选项、ask_user_choice 的「推荐项」兜底落空。
    // 正常路径（ask_user_choice）在落盘前保证 options≥2，此处只兜底历史/脏数据。
    if (!Array.isArray(question.options)) {
      console.warn('[canvas-studio] normalizeWorkflow: pendingQuestion.options 缺失或非数组，降级为空候选', question)
    }
    workflow.pendingQuestion = {
      id: typeof question.id === 'string' ? question.id : '',
      question: typeof question.question === 'string' ? question.question : '',
      options: Array.isArray(question.options) ? question.options.map(String) : [],
      ...(question.allowFreeText === false ? { allowFreeText: false } : {}),
      ...(question.multiSelect === true ? { multiSelect: true } : {}),
      ...(typeof question.answer === 'string' ? { answer: question.answer } : {}),
    }
  }
  return workflow
}

/**
 * setMode 动作的状态决策（CV-052/CV-056 修复的单一事实源，纯函数可单测）。
 *
 * 三条判据只对「用户真的切换了模式」有意义（切回逐步确认时执行中的流程回到
 * 澄清态、切到放手跑则解除等待）。它们只看 state 与目标 mode —— 若不先比对
 * current.mode，「点了当前已激活的那个按钮」也会被当成切换执行：最严重时
 * （confirm + keyframe_review 点「逐步确认」）state 被翻成 drafting，确认条
 * 随之消失、AI 已结束回合在睡、setMode 又不唤醒，流程直接死锁。故模式未变化
 * 时必须短路，只回写 mode，绝不碰 state。
 */
export function resolveSetModePatch(current: StudioWorkflow, mode: StudioWorkflowMode): Partial<StudioWorkflow> {
  if (current.mode === mode) return { mode }
  const patch: Partial<StudioWorkflow> = { mode }
  if (current.state === 'executing') patch.state = mode === 'auto' ? 'executing' : 'drafting'
  if (current.state === 'awaiting_approval' && mode === 'auto') patch.state = 'executing'
  if (current.state === 'script_review' && mode === 'auto') patch.state = 'executing'
  if (current.state === 'keyframe_review') patch.state = mode === 'auto' ? 'executing' : 'drafting'
  return patch
}

/** CV-099：预置画幅取值（与生成工具 aspectRatio 的 enum 保持一致）。 */
export const PLAN_ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const

/** CV-099：预置画幅类型。 */
export type StudioPlanAspectRatio = (typeof PLAN_ASPECT_RATIOS)[number]

/** CV-099：目标总时长上限（秒，5 分钟）——超出按此夹取，防止误填撑爆分镜预算。 */
export const MAX_TARGET_DURATION = 300

/** CV-099：单镜建议时长（秒）——由目标总时长推导镜头数的分母。 */
export const SUGGESTED_SHOT_SECONDS = 10

/**
 * CV-099：项目创建时锁定的产出规格。
 *
 * 两项都可缺省（未锁定）——创建弹窗允许留空，留空即走旧行为（agent 提问或
 * 全局设置兜底）。字段整体可选，老项目记录无此字段时按「未锁定」处理，零迁移。
 */
export interface StudioProjectPlan {
  /** 画幅比例；未锁定时不出现。 */
  aspectRatio?: StudioPlanAspectRatio
  /** 成片目标总时长（秒）；未锁定时不出现。 */
  targetDuration?: number
}

/**
 * CV-099：宽松校验未知值为合法的预置规格；整体非法/空时返回 undefined（调用方
 * 据此决定「不写该字段」而非写空对象）。单项非法只丢弃该项，不牵连另一项。
 * 纯函数，单测直连。
 */
export function normalizePlan(value: unknown): StudioProjectPlan | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const plan: StudioProjectPlan = {}
  const ratio = record.aspectRatio
  if (ratio === '16:9' || ratio === '9:16' || ratio === '1:1') plan.aspectRatio = ratio
  const duration = record.targetDuration
  if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
    plan.targetDuration = Math.min(MAX_TARGET_DURATION, Math.round(duration))
  }
  return plan.aspectRatio === undefined && plan.targetDuration === undefined ? undefined : plan
}

/**
 * CV-099：目标总时长 → 建议镜头数（总时长 ÷ 单镜建议时长，至少 1 镜）。
 * 未锁定/非法时返回 undefined（调用方据此省略该提示）。纯函数，单测直连。
 */
export function suggestShotCount(targetDuration: number | undefined): number | undefined {
  if (targetDuration === undefined || !Number.isFinite(targetDuration) || targetDuration <= 0) return undefined
  return Math.max(1, Math.round(targetDuration / SUGGESTED_SHOT_SECONDS))
}

/** One Canvas Studio project record. */
export interface StudioProject {
  /** Stable project id (Host-minted UUID). */
  id: string
  /** User-facing project name. */
  name: string
  /** Creation timestamp (ISO 8601). */
  createdAt: string
  /** Last change timestamp (ISO 8601). */
  updatedAt: string
  /** Absolute path of the project directory; assets live under `assets/`. */
  dir: string
  /**
   * P7 creation workflow (mode + gate state). Optional on the wire so
   * pre-P7 registry documents stay readable; readers must treat absence as
   * `WORKFLOW_DEFAULT`.
   */
  workflow?: StudioWorkflow
  /**
   * CV-091：用户自定义分组 id。老记录无此字段即未分组（兜底常驻分组），
   * 读取无需迁移；`null` 与 `undefined` 等价（视图层统一按「未分组」处理）。
   */
  groupId?: string | null
  /**
   * CV-099：创建时锁定的产出规格（画幅 / 目标总时长）。老记录无此字段即
   * 未锁定，按既有流程（澄清提问 + 全局设置兜底）处理，零迁移。
   */
  plan?: StudioProjectPlan
}

/** CV-091：用户自定义项目分组（左侧栏可折叠分组的一等公民，独立于 projects.json）。 */
export interface StudioProjectGroup {
  /** 稳定分组 id（Host-minted UUID）。 */
  id: string
  /** 用户-facing 分组名（trim + 长度校验同项目名约束的轻量版）。 */
  name: string
  /** 排序权重（同级升序；删除中间项不影响其余顺序）。 */
  order: number
}

/**
 * 一条待回答的选择题（ask_user_choice 工具落盘，画布端渲染成点选卡片）。
 * 用户点击后 answer 被写入，Host 工具轮询读到即回传给模型并清空本条。
 */
export interface StudioPendingQuestion {
  id: string
  question: string
  options: string[]
  /** 自由输入框开关；缺省开启（CV-049），显式 false 隐藏。旧数据里的 true 仍视为开启。 */
  allowFreeText?: boolean
  /** true 时为多选题（CV-062）：客户端可勾选多项，确认后 answer 以「、」拼接。 */
  multiSelect?: boolean
  /** 用户的选择（选项原文或自由输入），由 workflow 路由的 answer 动作写入。 */
  answer?: string
}