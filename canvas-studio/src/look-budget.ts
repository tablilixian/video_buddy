/**
 * 落地前样张 / 定妆照的**软预算**（2026-10-22 拍板，审计 P1-3）。
 *
 * ## 为什么要有它
 *
 * 门禁判据（`approval-gate.ts` 的 `shotBound`）只能拦「**绑了镜**的产线动作」；
 * 落地前**不绑镜**的 `image_generate` / `character_generate` 与 Look 样张在判据上
 * 不可区分 —— 样张本来就是这个形态出的。于是「不传任何绑定参数、连出十几张
 * 逐镜构图图」成为门禁修完 `storyboardRef` 旁路后剩下的最后一条软肋。
 *
 * 硬拦会误伤样张阶段（澄清期出概念图是合法动作），所以做成**周期软预算**：
 * confirm + `storyboarding` 态下，不绑镜的出图每周期最多 `LOOK_BUDGET_PER_CYCLE`
 * 张；超限抛可操作报错，要求先 `ask_user_choice` 征得用户同意。用户答复
 * （`answerPendingQuestion` 成功，`routes.ts` 调 `resetLookBudget`）即清零进入
 * 下一周期 —— 等于「每多出一批样张都要用户点头一次」，而不是一刀切禁掉。
 *
 * ## 刻意不做的
 *
 * - **不落盘**：计数在 Host 内存（Map）。重启即清零 —— 这是防批量抢跑的软约束，
 *   不是审计账本；为它加持久化属于过度设计。
 * - **不管 auto 模式**：放手跑用户已授权一路跑完，预算只对 confirm 模式生效。
 * - **不管绑镜调用**：绑镜在 `storyboarding` 态由硬门禁直接拦，轮不到预算。
 *
 * 纯内存、无 IO；判据与报错文案集中在本模块，host-tools 只做接线。
 */
import { throwError } from './error-system.js'

/** 每周期（两次用户确认之间）允许的不绑镜出图张数。 */
export const LOOK_BUDGET_PER_CYCLE = 3

const counters = new Map<string, number>()

/** 该项目的预算是否适用（confirm 模式 + 尚未落地的 storyboarding 态）。 */
export function lookBudgetApplies(mode: string, state: string): boolean {
  return mode === 'confirm' && state === 'storyboarding'
}

/** 超限抛可操作报错（CS-USER-ERR，模型可据此走 ask_user_choice 解锁）。 */
export function assertLookBudget(projectId: string): void {
  const used = counters.get(projectId) ?? 0
  if (used < LOOK_BUDGET_PER_CYCLE) return
  throwError('CS-USER-ERR', {
    message: `落地前样张/定妆照本周期已产出 ${String(LOOK_BUDGET_PER_CYCLE)} 张（软预算上限）。继续出图前必须先用 ask_user_choice 征求用户意见（说清楚还想出哪几张、为什么需要）；用户答复后预算自动重置。不要换参数绕道 —— 绑镜出图在落地前一律被门禁拦截。`,
  })
}

/** 一次不绑镜出图**成功后**计数（失败的调用不占预算）。 */
export function chargeLookBudget(projectId: string): void {
  counters.set(projectId, (counters.get(projectId) ?? 0) + 1)
}

/** 用户答复（answerPendingQuestion 成功）后清零，进入下一周期。 */
export function resetLookBudget(projectId: string): void {
  counters.delete(projectId)
}
