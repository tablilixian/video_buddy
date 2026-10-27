/**
 * Shared project-record wire types for the Canvas Studio host registry and
 * the browser client. Pure types plus small pure helpers (normalizeWorkflow /
 * resolveSetModePatch): both halves import them and erase them at build time,
 * so this file never appears in the runtime bundles.
 *
 * 例外：`normalizePlan` 会用到 `resolution-tiers.ts` 的 `normalizeResolutionId`
 * （纯数据模块，无 IO）—— 档位的历史键归一只允许有一份实现，宁可在这里多一个
 * 运行时 import，也不在三处各写一遍 `'736p' | '2k'` 字面量。
 */

import { normalizeResolutionId, type ResolutionId } from '../resolution-tiers.js'

/** P7 执行模式：confirm 逐步确认；auto 放手跑（跳过审批门禁）。 */
export type StudioWorkflowMode = 'confirm' | 'auto'

/**
 * REQ-022：工作流状态（**三态**，契约 §3.1）。
 *
 * - `storyboarding`：**落画布之前的一切** —— 澄清、搜索、写故事版、调整循环、
 *   版本存档、看预览。项目创建成功即进此态。
 * - `keyframe_review`：关键帧待确认（唯一保留的审批门）。
 * - `executing`：已落地，产线开着（**单向终点，不回退**）。
 *
 * 被删掉的三个旧值（`drafting` / `script_review` / `awaiting_approval`）：剧本门与
 * 分镜门被「拍摄定稿」取代，态随门删；存量项目由 `normalizeWorkflow` 一次性并入
 * `storyboarding`（三者语义都是「还没落到画布」，合并等价）。
 */
export type StudioWorkflowState = 'storyboarding' | 'keyframe_review' | 'executing'

/** 每个项目的创作工作流状态机（P7 门控的持久化事实源）。 */
export interface StudioWorkflow {
  mode: StudioWorkflowMode
  state: StudioWorkflowState
  /** 进行中的点选问题（ask_user_choice）；无问题时缺省。 */
  pendingQuestion?: StudioPendingQuestion | null
}

/** 旧记录 / 新建项目的默认工作流。REQ-022：新建项目直接进「拍摄定稿」。 */
export const WORKFLOW_DEFAULT: StudioWorkflow = { mode: 'confirm', state: 'storyboarding' }

/**
 * CV-196：宽松解析未知值为合法执行模式；非法 / 缺失返回 `undefined`。
 *
 * 调用方（创建项目路由）据此区分「用户显式选了某种模式」与「没传，走设置页默认」
 * —— 二者语义不同，所以这里不返回 `'confirm'` 兜底（那会让「没传」被当成「显式要
 * 逐步确认」，把设置页的 `workflowMode` 架空）。与 `normalizeWorkflow` 的分工：
 * 那个管**已落盘的记录**（必须给一个确定值），这个管**入参**（允许「没说」）。
 */
export function normalizeWorkflowMode(value: unknown): StudioWorkflowMode | undefined {
  return value === 'auto' || value === 'confirm' ? value : undefined
}

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
    // REQ-022 存量迁移：`drafting` / `script_review` / `awaiting_approval` 一律并入
    // `storyboarding`（三者语义都是「还没落到画布」）；`keyframe_review` / `executing`
    // 原样保留。开发阶段不写其他一次性兼容代码。
    state: record.state === 'keyframe_review' || record.state === 'executing'
      ? record.state
      : 'storyboarding',
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
 *
 * CV-196 追加第 ④ 条：**切到放手跑要把挂起问题一并清掉**。放手跑的定义是「不再
 * 需要用户参与」，而上一问留下的点选卡片此时正被 `ask_user_choice` 的轮询等待
 * （最坏白等 `QUESTION_WAIT_MS` = 10 分钟）。清空后工具侧立刻读到「问题已被清除」
 * 并返回，agent 接着往下跑 —— 不清则「切了放手跑还要再等十分钟」。
 */
export function resolveSetModePatch(current: StudioWorkflow, mode: StudioWorkflowMode): Partial<StudioWorkflow> {
  if (current.mode === mode) return { mode }
  const patch: Partial<StudioWorkflow> = { mode }
  // REQ-022：三态下「切到逐步确认」**不再把已落地的项目退回规划态** —— 落地是单向终点
  // （契约 §7.2），退回 `storyboarding` 会重新打开落地入口，等于允许整体重落。模式切换
  // 唯一还需要动 state 的情形只剩「在关键帧确认处切放手跑」= 解除等待。
  if (current.state === 'keyframe_review' && mode === 'auto') patch.state = 'executing'
  if (mode === 'auto' && current.pendingQuestion !== null && current.pendingQuestion !== undefined) {
    patch.pendingQuestion = null
  }
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
 * 三项都可缺省（未锁定）——创建入口允许留空，留空即走旧行为（agent 提问或
 * 全局设置兜底）。字段整体可选，老项目记录无此字段时按「未锁定」处理，零迁移。
 */
export interface StudioProjectPlan {
  /** 画幅比例；未锁定时不出现。 */
  aspectRatio?: StudioPlanAspectRatio
  /** 成片目标总时长（秒）；未锁定时不出现。 */
  targetDuration?: number
  /**
   * **视频**清晰度档位（2026-10-27 拍板：项目预置只管视频）。
   *
   * 名字里带 `video` 是为了封死一个歧义：这一项**不影响图片**。图片的档位由
   * 图片节点自身的 `resolution` 参数决定，缺省走设置页「图片默认分辨率」，
   * 下限 720P —— 两条链路互不相干（用户拍板原话：「首页这里写明白是给视频用的，
   * 图片就不需要单独选择分辨率」）。
   *
   * 加这一项之前，首页的分辨率 chip 只活在 store 里 —— 不落 plan、不进提示词、
   * 不影响生成（`tests/lobby-spec.test.mjs` 曾把这条现状锁成断言）。
   *
   * 历史键名 `resolution`（2026-10-27 当日上午短暂存在）由 `normalizePlan` 兼容读入。
   */
  videoResolution?: ResolutionId
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
  // 档位：历史键（736p / 2k）读时归一为规范键，脏值丢弃该项（不牵连其余两项）。
  // 键名迁移：`resolution` 是 2026-10-27 当日用过数小时的旧名（语义后来收窄为
  // 「只作用于视频」），新名 `videoResolution`；两个键都读，新键优先。写路径只写新名。
  const resolution = normalizeResolutionId(record.videoResolution) ?? normalizeResolutionId(record.resolution)
  if (resolution !== undefined) plan.videoResolution = resolution
  return plan.aspectRatio === undefined && plan.targetDuration === undefined && plan.videoResolution === undefined
    ? undefined
    : plan
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