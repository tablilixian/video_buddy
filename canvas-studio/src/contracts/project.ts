/**
 * Shared project-record wire types for the Canvas Studio host registry and
 * the browser client. Pure types plus small pure helpers (normalizeWorkflow /
 * resolveSetModePatch): both halves import them and erase them at build time,
 * so this file never appears in the runtime bundles.
 */

/** P7 执行模式：confirm 逐步确认；auto 放手跑（跳过审批门禁）。 */
export type StudioWorkflowMode = 'confirm' | 'auto'

/** P7 工作流状态：drafting 需求澄清中；awaiting_approval 分镜表待批准；keyframe_review 关键帧待确认；executing 执行中。 */
export type StudioWorkflowState = 'drafting' | 'awaiting_approval' | 'keyframe_review' | 'executing'

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
    state: record.state === 'awaiting_approval' || record.state === 'keyframe_review' || record.state === 'executing'
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
  if (current.state === 'keyframe_review') patch.state = mode === 'auto' ? 'executing' : 'drafting'
  return patch
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