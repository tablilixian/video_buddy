/**
 * 渲染工单诊断快照（从 `render-job.ts` 拆出：CV-447 的新增注释撞了 1200 行棘轮）。
 *
 * 快照成功与失败都会带回，并拼进超时 / 失败文案，让排障不再靠猜。
 */

/** 这张单归谁渲（建单时定）。 */
export type RenderExecutor = 'render-host' | 'client'

/**
 * REQ-035 F-01：工单生命周期快照。
 *
 * 2026-10-24 事故的 39 次超时里，agent 只能看到"超时"这一句，无法区分
 * 「没人取单」「取了没开渲」「渲到一半停了」—— 三种情况的修法完全不同。
 */
export interface RenderJobDiagnostics {
  id: string
  /** 谁在渲：隐藏渲染窗口 or 用户画布页。 */
  path: RenderExecutor
  /** 被认领的时刻；`null` = 从未被认领。 */
  claimedAt: number | null
  /** 第一帧进度上报的时刻；`null` = 一帧都没出过。 */
  firstFrameAt: number | null
  settled: 'ok' | 'failed' | 'timeout' | 'cancelled'
  /** 是否发生过滞留改派（画布页卡住 → 窗口接管）。 */
  takeover: boolean
  /** 从派发到结算的毫秒数。 */
  waitedMs: number
  /** 到过的最大进度（0–1）。 */
  maxProgress: number
  /** CV-447（P0-B）：画布页单的回退原因（为什么没派给隐藏窗口）；render-host 单缺省。 */
  fallbackReason?: string
}

/** 把诊断快照压成一句人读文本（进超时文案与日志）。 */
export function describeDiagnostics(d: RenderJobDiagnostics): string {
  const who = d.path === 'render-host' ? '隐藏渲染窗口' : '画布页'
  const waited = Math.round(d.waitedMs / 1000)
  // CV-447（P0-B）：画布页单带上「为什么在画布页」。模型此前只看得到
  // 「画布页已渲染 330s，进度 55%」，无法判断该查执行器还是改画面。
  const fallback = d.fallbackReason !== undefined ? `；回退原因：${d.fallbackReason}` : ''
  if (d.claimedAt === null) return `${who}从未取走这张工单（等 ${waited}s）${fallback}`
  if (d.firstFrameAt === null) return `${who}已取单但 ${waited}s 内一帧都没渲染${fallback}`
  return `${who}已渲染 ${waited}s，进度 ${Math.round(d.maxProgress * 100)}%${d.takeover ? '（曾发生过改派）' : ''}${fallback}`
}

/**
 * 把诊断快照压成**拼在正文末尾**的一行（P0-1）。
 *
 * 为什么直接拼进 `message` 而不是另开一个模板参数（`{hint}`）：
 * - `detail` 只进 `devMessage`，而 `routeError` 在 `devMode=false`（桌面端默认）时只交
 *   `userMessage`、`recordStudioToolFailure` 也只记 `action.message` ⇒ **两边都到不了**。
 *   本机 4 个会话 34 次 `CS-RENDER-002` 里模型看到的全是「请重试」，`job` 快照一个字都没
 *   露过面，于是它唯一的处置就是 sleep + 重试（最坏 28 分钟 37 次连败）。
 * - 这个码的正文本来就由**调用方**填（`{message}`，客户端撤单时填的是渲染器原话），
 *   诊断属于同一类信息，拼在一起不需要动错误码表（`catalog.ts#SPECS` 有只减不增的行数棘轮）。
 */
export function diagHint(diag: RenderJobDiagnostics): string {
  return `\n工单：${describeDiagnostics(diag)}`
}
