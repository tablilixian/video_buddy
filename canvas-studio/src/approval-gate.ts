/**
 * 逐步确认模式的**审批门禁**（P7 硬门禁的判定层）—— 「现在这个动作该不该放行」
 * 的唯一实现。
 *
 * ## 为什么必须是拦得住的东西
 *
 * 实测（2026-09-14，真实会话转录）：旧的「提交分镜待批准」在 14:25:46 提交、
 * 用户 14:29:44 才点批准，**这 3 分 58 秒里 agent 把第 4~5 步跑完了** ——
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
 * 1. **「用户在等一个决策」**（REQ-022 后只剩 `keyframe_review`）—— 此时 agent 不该
 *    产出任何新东西。这一级连 Look 样张那种"不限量"的 `image_generate` 也拦：等待期间
 *    出的图不但浪费算力，还会让用户以为流程抢跑了。
 * 2. **「还没落到画布」**（`storyboarding`）—— 正式产线动作（视频、逐镜关键帧、
 *    资产卡、质检、BGM、成片）一律不放行；但 Look 阶段的样张/定妆照要放行
 *    （它们在澄清阶段就得能出，那时 state 也是 `storyboarding`）。
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
 * - 写作类工具（`write_storyboard` / `look_card` / 关键帧提交本身）不在 `PRODUCING_TOOLS`
 *   里，所以**本模块**不拦它们 —— 但「本模块不拦」不等于「审阅态可用」：
 *   `write_storyboard` 由 `host-tools` 的阶段守卫锁死在 `storyboarding`（CV-304：落地后
 *   不许整体重写，`keyframe_review` / `executing` 一律拒）；关键帧驳回走的是
 *   「打回即把 state 退回 `executing`」那条路（CV-051），不靠本模块放行写作工具。
 *   本模块只管**产出**（`write_script` 例外：阶段一写文案会在画布上留一份可能与
 *   故事版不一致的副本，见 `STORYBOARDING_EXTRA`）。
 *
 * 纯函数、无 IO、无 React —— 判定表在 `tests/approval-gate.test.mjs` 里逐格验。
 */
import type { StudioWorkflowMode, StudioWorkflowState } from './contracts/project.js'

/** REQ-022：唯一保留的审阅态（与 `workflow-stage.ts` 的 APPROVAL_STATES 同一集合）。 */
const REVIEW_STATES: ReadonlySet<string> = new Set([
  'keyframe_review',
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
  // CV-271：语音合成占位升真 —— 与 music_generation 同为「产出音频产物」的正式动作。
  'tts_voiceover',
  // CV-327（REQ-034）：代码驱动合成 —— 与 compose_video 同为「出终版成片」的正式动作，
  // 且直接在 execute() 里干活（不走 runGeneration）。漏登记会让它在拍摄定稿阶段 /
  // 关键帧审阅期变成一条后门（Z-3 验收项明文要求「同 compose_video 口径」）。
  'render_composition',
])

/**
 * 审阅态下要一并拦住的**产出类**动作 —— 在正式动作之外，还包括不绑分镜的
 * `image_generate` / `character_generate`（Look 样张、定妆照这类）。它们在
 * `storyboarding` 阶段是合法动作，所以不能进 FORMAL_TOOLS。
 */
const PRODUCING_TOOLS: ReadonlySet<string> = new Set([
  ...FORMAL_TOOLS,
  'image_generate',
  'image_generate_withtxt',
  'image_fix',
  'character_generate',
])

/** 各审阅态的拒绝文案：说清「在等什么」+「不要做什么」（REQ-022 后只剩关键帧）。 */
const REVIEW_MESSAGES: Readonly<Record<string, string>> = {
  keyframe_review: '关键帧正在等待用户确认（画布上方确认条）。请停止一切动作，等待用户点击「确认关键帧」或「打回重出」；用户可能先在画布上二次编辑关键帧，编辑完成后仍需再次确认。确认后用户会发「继续」；在此之前不要重试。（用户点「打回重出」后你会收到带意见的重做指令，那才是重出的信号。）',
}

/**
 * 尚未落地时的拒绝文案（REQ-022：`storyboarding` 态）。
 *
 * 旧文案指向已下线的 `write_screenplay → submit_screenplay_for_approval →
 * submit_storyboard_for_approval` 三步门；三态化后阶段一的终点是**写拍摄定稿**
 * （`write_storyboard`），由用户在覆盖层点「确认落地」，所以出路只有一条。
 */
const STORYBOARDING_MESSAGE = '当前项目还在「拍摄定稿」阶段（尚未落到画布）：请先完成需求澄清与故事板（write_storyboard），由用户在画布顶条「拍摄定稿」里审阅并点「确认落地」。落地前不能调用产线生成工具（Look 阶段的基调样张 / 定妆照不受限），也不要在阶段一写文案节点（文案由落地后的画布节点承接）。'

/**
 * `storyboarding` 态额外拦截的**写作类**工具（契约 §3.2）。
 *
 * 阶段一只写 `storyboard.json`，文案/剧本节点由落地后的画布承接 —— 提前写等于
 * 在画布上留下一份与故事版可能不一致的副本。
 *
 * 刻意**不并进 `FORMAL_TOOLS`**：那张表同时被 `PRODUCING_TOOLS` 复用，并进去会
 * 连带把关键帧期也拦掉，而关键帧期恰恰需要允许「按意见改写」以免流程卡死。
 */
const STORYBOARDING_EXTRA: ReadonlySet<string> = new Set([
  'write_script',
])

/** `approvalGateMessage` 的入参。 */
export interface ApprovalGateInput {
  /** 工具名（`host-tools.ts` 里注册的名字）。 */
  readonly tool: string
  /** 项目当前的执行模式。 */
  readonly mode: StudioWorkflowMode
  /** 项目当前的工作流状态。 */
  readonly state: StudioWorkflowState
  /** 本次调用是否绑定了分镜卡（`image_generate` / `image_generate_withtxt` / `character_generate` 传了 `shotRefs`）。 */
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

  // 到这里 state 只可能是 storyboarding（三态取值已穷尽）。
  if (FORMAL_TOOLS.has(tool) || STORYBOARDING_EXTRA.has(tool)) return STORYBOARDING_MESSAGE
  if (shotBound && (tool === 'image_generate' || tool === 'image_generate_withtxt' || tool === 'character_generate')) {
    return STORYBOARDING_MESSAGE
  }
  return null
}
