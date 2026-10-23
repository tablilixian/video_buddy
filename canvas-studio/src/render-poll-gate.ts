/**
 * REQ-034 · B3 渲染工单轮询的**决策表**（纯函数，便于单测）。
 *
 * 背景（2026-10-23 真机 11 连败的根因之一）：客户端 `pollRenderJob` 在「没单可取」
 * 时直接停表收工，而宿主建单发生在工具调用的**校验/素材探测之后**（可达几十秒），
 * O-06 又把建单再推迟了执行者冷启等待 —— 轮询的最早几拍必然扑空，一扑空就永久
 * 停表，之后建好的工单没人认领，白等到 `CS-RENDER-TIMEOUT`。
 *
 * 修复口径：**轮询的生命周期由「render_composition 工具调用是否在飞」驱动**——
 * 在飞期间扑空只等待（hold），收工交给工具结算回调（成功 / 失败 / 取消都会清理
 * 在飞计数）。`stop` 只在「没有在飞调用、也没有镜像进度」时出现，即老的
 * 「工单已结算 ⇒ 收工」路径。
 */

/** 轮询这一拍该做什么。 */
export type RenderPollStep =
  /** 取到了归本页的工单 ⇒ 渲染它。 */
  | 'claim'
  /** 没有本页的单，但队列里有在跑/排队的（多为隐藏窗口的单）⇒ 镜像进度。 */
  | 'mirror'
  /** 什么都没有，但仍有 render_composition 在飞 ⇒ 空转一拍等建单。 */
  | 'hold'
  /** 什么都没有且没有在飞调用 ⇒ 停表收工。 */
  | 'stop'

export interface RenderPollInput {
  /** 画布页当前是否解析得出项目 id（claim 与镜像查询都要用它）。 */
  hasProjectId: boolean
  /** pending 是否返回了归本页的工单。 */
  jobFound: boolean
  /** 队列镜像里是否有 rendering/queued 的工单（隐藏窗口的进度）。 */
  mirrorRunning: boolean
  /** 在飞的 render_composition 工具调用数（工具结算回调负责清零）。 */
  renderRunsInFlight: number
}

/** 决定这一拍的行为。见模块注释的「修复口径」。 */
export function decideRenderPollStep(input: RenderPollInput): RenderPollStep {
  const inFlight = input.renderRunsInFlight > 0
  if (!input.hasProjectId) {
    // 项目没同步出来（画布页刚启动 / 用户在首页）不能 claim，但在飞时不能停表 ——
    // 项目可能下一拍就有了；工具结算自会收表。
    return inFlight ? 'hold' : 'stop'
  }
  if (input.jobFound) return 'claim'
  if (input.mirrorRunning) return 'mirror'
  return inFlight ? 'hold' : 'stop'
}
