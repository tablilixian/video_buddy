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
import type { StudioWorkflowMode, StudioWorkflowState } from './contracts/project.js';
/** `approvalGateMessage` 的入参。 */
export interface ApprovalGateInput {
    /** 工具名（`host-tools.ts` 里注册的名字）。 */
    readonly tool: string;
    /** 项目当前的执行模式。 */
    readonly mode: StudioWorkflowMode;
    /** 项目当前的工作流状态。 */
    readonly state: StudioWorkflowState;
    /** 本次调用是否绑定了分镜卡（`image_generate` / `character_generate` 传了 `shotRefs`）。 */
    readonly shotBound: boolean;
}
/**
 * 判定一次调用是否被门禁拦下。返回 `null` = 放行；返回字符串 = 拒绝理由
 * （调用方 `throw new Error(该字符串)`）。
 */
export declare function approvalGateMessage(input: ApprovalGateInput): string | null;
