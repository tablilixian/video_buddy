/**
 * 逐步确认模式的**审批门禁**（P7 硬门禁的判定层）—— 「现在这个动作该不该放行」
 * 的唯一实现。
 *
 * ## 为什么必须是拦得住的东西
 *
 * 实测（2026-09-14，真实会话转录）：`submit_storyboard_for_approval` 在 14:25:46
 * 提交、用户 14:29:44 才点批准，**这 3 分 58 秒里 agent 把第 4~5 步跑完了** ——
 * 加载 h3-prompt-writing、读分册、2 次 `image_generate` 出定妆照、`character_sheet`
 * 建资产卡。原门禁 `GATED_TOOLS` 只含 `video_generate` / `video_composite`，而
 * 最贵的那一步（逐镜出图）走的是 `image_generate`，完全不设防；`character_sheet`
 * 更是连门禁都没进。
 *
 * 「靠提示词让模型自己停」被证明不可靠：同一个模型在同一天，剧本审批的返回文本
 * 152 字符、停止指令在第 49% 处 → 它停了；分镜审批 1080 字符、停止指令被压到第
 * 95% → 它没停。所以提示词层（`approval-notice.ts`）只负责"少浪费几步"，**真正
 * 的闸」在这里**：`host-tools.ts` 在每个产物类工具的入口用本模块判定并抛错，加上
 * `exec.concludeTurn()` 在提交那一刻就结束回合。
 *
 * ## 两级判定（不是一张工具黑名单）
 *
 * 门禁要回答的问题其实有两个，混在一张表里就会两类都答错：
 *
 * 1. **「用户在等一个决策」**（三个审阅态）—— 此时 agent 不该产出任何新东西。
 *    这一级连 Look 样张那种"不限量"的 `image_generate` 也拦：等待期间出的图
 *    不但浪费算力，还会让用户以为流程抢跑了。
 * 2. **「还没拿到分镜批准」**（`drafting`）—— 正式产线动作（视频、逐镜关键帧、
 *    资产卡、质检、BGM、成片）一律不放行；但 Look 阶段的样张/定妆照要放行
 *    （它们在澄清阶段就得能出，那时 state 也是 `drafting`）。
 *
 * 判据用 `shotBound`（本次调用是否绑定了分镜卡）区分「逐镜关键帧」与「Look 图」：
 * 绑定到某一镜的图才是产线产物。这与 `generate.ts` 的 `operationTypeOf` 同源 ——
 * **同一规则只准一份判据**（阶段判定与门禁判定若各写一份，迟早一个放行一个拦）。
 *
 * ## 谁不受限
 *
 * - `mode === 'auto'`（放手跑）：用户已明确授权一路跑完。
 * - `state === 'executing'`：分镜已获批，产线开着。
 * - **画布上用户手动发起的节点重试**：走 `/generate` 路由，不经本模块（既有设计，
 *   用户对画布有最终处置权）。
 * - 写作类工具（`write_screenplay` / `write_script` / `look_card` / 审批提交本身）：
 *   驳回后用户可能直接在对话里给意见而**不点**驳回按钮（state 仍停在审阅态），
 *   此时必须允许 agent 按意见改写并重新提交，否则流程会卡死。本模块只管**产出**。
 *
 * 纯函数、无 IO、无 React —— 判定表在 `tests/approval-gate.test.mjs` 里逐格验。
 */
import type { StudioWorkflowMode, StudioWorkflowState } from './contracts/project.js'

/** 用户在等决策的三个状态（与 `workflow-stage.ts` 的 APPROVAL_STATES 同一集合）。 */
const REVIEW_STATES: ReadonlySet<string> = new Set([
  'script_review', 'awaiting_approval', 'keyframe_review',
])

/**
 * 需要「分镜已获批」才能调用的正式产线动作。
 *
 * 收敛过的教训：`compose_video` / `extract_last_frame` / `music_generation` 过去也
 * 不在表内 —— 它们分别能拼片、抽帧、出 BGM，都是第 8~10 步的动作。它们单靠自己
 * 出不了新关键帧，但放行它们等于允许「没批分镜就先出 BGM/拼一版看看」。
 */
const FORMAL_TOOLS: ReadonlySet<string> = new Set([
  'video_generate',
  'video_composite',
  'compose_video',
  'extract_last_frame',
  'character_sheet',
  'qc_shot',
  'music_generation',
])

/**
 * 审阅态下要一并拦住的**产出类**动作 —— 在正式动作之外，还包括不绑分镜的
 * `image_generate` / `character_generate`（Look 样张、定妆照这类）。它们在
 * `drafting` 阶段是合法动作，所以不能进 FORMAL_TOOLS。
 */
const PRODUCING_TOOLS: ReadonlySet<string> = new Set([
  ...FORMAL_TOOLS,
  'image_generate',
  'character_generate',
])

/** 各审阅态的拒绝文案：说清「在等什么」+「不要做什么」。 */
const REVIEW_MESSAGES: Readonly<Record<string, string>> = {
  script_review: '剧本正在等待用户批准（画布上方审批条）。请停止一切动作，等待用户点击「批准剧本」或给出修改意见；批准后用户会发「继续」。不要重试，也不要把等待时间用来做后续步骤的准备（加载 skill、读分册、出定妆照、建资产卡都属于「批准后才做」）。',
  awaiting_approval: '分镜表正在等待用户批准（画布上方审批条）。请停止一切动作，等待用户点击「批准并开始制作」或给出修改意见；批准后用户会发「继续」。不要重试，也不要把等待时间用来做第 4~6 步的准备（建资产卡 / 出定妆照 / 逐镜出图都属于「批准后才做」）。',
  keyframe_review: '关键帧正在等待用户确认（画布上方确认条）。请停止一切动作，等待用户点击「确认关键帧」或「打回重出」；用户可能先在画布上二次编辑关键帧，编辑完成后仍需再次确认。确认后用户会发「继续」；在此之前不要重试。（用户点「打回重出」后你会收到带意见的重做指令，那才是重出的信号。）',
}

/** 未获批时的拒绝文案（drafting：还没走到分镜批准）。 */
const DRAFTING_MESSAGE = '当前项目为「逐步确认」模式且尚未获批分镜：请先完成需求澄清与剧本创作（write_screenplay → submit_screenplay_for_approval），用户批准剧本后再规划分镜并用 submit_storyboard_for_approval 提交。分镜获批前不能调用产线生成工具（Look 阶段的基调样张 / 定妆照不受限）。'

/** `approvalGateMessage` 的入参。 */
export interface ApprovalGateInput {
  /** 工具名（`host-tools.ts` 里注册的名字）。 */
  readonly tool: string
  /** 项目当前的执行模式。 */
  readonly mode: StudioWorkflowMode
  /** 项目当前的工作流状态。 */
  readonly state: StudioWorkflowState
  /** 本次调用是否绑定了分镜卡（`image_generate` / `character_generate` 传了 `shotRefs`）。 */
  readonly shotBound: boolean
}

/**
 * 判定一次调用是否被门禁拦下。返回 `null` = 放行；返回字符串 = 拒绝理由
 * （调用方 `throw new Error(该字符串)`）。
 */
export function approvalGateMessage(input: ApprovalGateInput): string | null {
  const { tool, mode, state, shotBound } = input
  // 放手跑：用户已授权一路跑完，审批提交本身就是放行。
  if (mode !== 'confirm') return null
  // 已获批：产线开着。
  if (state === 'executing') return null

  if (REVIEW_STATES.has(state)) {
    return PRODUCING_TOOLS.has(tool) ? (REVIEW_MESSAGES[state] ?? null) : null
  }

  // 到这里 state 只可能是 drafting（五个取值已穷尽）。
  if (FORMAL_TOOLS.has(tool)) return DRAFTING_MESSAGE
  if (shotBound && (tool === 'image_generate' || tool === 'character_generate')) {
    return DRAFTING_MESSAGE
  }
  return null
}
