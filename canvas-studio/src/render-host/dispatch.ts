/**
 * REQ-034 · O-06 RenderHost 派单登记表（**零依赖，纯调度**）。
 *
 * 为什么单独一个模块而不是让 `render-job.ts` 直接 import `window.ts`：
 * 工单桥是**渲染无关**的宿主逻辑（测试里天天直接 import），一旦它反向依赖
 * 「建窗口」这种 electron 副作用，单测就再也跑不起来了。这里只放两个函数指针：
 *
 * - `launcher`：谁来「保证窗口存在」（生产实现 = `routes.ts` 里的 `ensureRenderHost`）；
 * - 没有 launcher ⇒ 这个宿主根本不能开窗口（纯 CLI / 测试）⇒ 永远走客户端，零等待。
 *
 * 谁注册、谁消费：`routes.ts` 注册；`render-job.ts` 在**建单时**消费一次
 * （决定这张单归谁渲染，决定后不再改）。
 */

import type { IncomingMessage } from 'node:http'

export type RenderHostLauncher = () => boolean

/**
 * 渲染失败后**重置隐藏窗口**的钩子（REQ-035 B2-2 / D10）。
 *
 * 为什么需要：2026-10-24 事故里"越试越死" —— 一次超时后窗口带着半残状态继续接单，
 * 后续每单都在同一个坏状态上失败，只有重启客户端才恢复。
 * 与 `setRenderHostLauncher` 同一注入风格：宿主侧自己会 `disposeRenderHost`，
 * 本模块只负责"什么时候该重置"，不知道窗口怎么造。
 */
export type RenderHostResetter = (reason: string) => void

let launcher: RenderHostLauncher | undefined
let resetter: RenderHostResetter | undefined
/**
 * 宿主日志出口（`routes.ts` 注册成 `ctx.logger.info`）。
 *
 * 为什么需要它：`render-job.ts` 是**渲染无关**的宿主逻辑，故意不依赖 cordis ctx；
 * 但「这张单为什么没派给隐藏窗口」只有它知道，而这条信息此前**完全没有留痕**
 * （日志里只有「RenderHost 已创建」，28s 后直接报「画布页从未取单」）。
 * 与 launcher / resetter 同一注入风格：模块只喊话，谁记日志由宿主决定。
 */
export type RenderHostLogger = (message: string) => void
let logger: RenderHostLogger | undefined
// 初值取 -Infinity：0 会被"距上次重置 30s"判成刚重置过，导致**第一次失败反而不重置**。
let lastResetAt = Number.NEGATIVE_INFINITY

/** 两次重置之间的最小间隔：防止"失败→重置→再失败"抖动成抖窗。 */
export const RENDER_HOST_RESET_MIN_INTERVAL_MS = 30_000
let lastWarmAt = 0

/** 注册/注销拉起器（插件卸载时传 `undefined`）。 */
export function setRenderHostLauncher(next: RenderHostLauncher | undefined): void {
  launcher = next
}

export function hasRenderHostLauncher(): boolean {
  return launcher !== undefined
}

/** 登记日志出口（`undefined` = 关掉；纯 CLI / 单测下没登记就静默丢弃）。 */
export function setRenderHostLogger(next: RenderHostLogger | undefined): void {
  logger = next
}

/**
 * 往宿主日志写一行（没登记出口时是空操作）。
 *
 * 为什么吞异常：排障日志写失败（logger 抛错）绝不能连累一次渲染 —— 这是**观测**
 * 通道，不是控制流。
 */
export function logRenderHost(message: string): void {
  try {
    logger?.(message)
  } catch { /* 观测失败不影响渲染 */ }
}

/** 被拒请求的留痕频率上限：页面 1s 一拍，不限频会立刻刷屏。 */
const REJECTED_WARN_INTERVAL_MS = 10_000
let lastRejectedWarnAt = 0

/**
 * **渲染链路的请求被本机同源闸拒绝**时留痕（P0-3④）。
 *
 * 为什么这条日志比什么都重要：Electron 的 `loadURL` 把 403 / 404 / 503 一律当「加载成功」，
 * 于是页面是个白屏、没有脚本、没有自报，宿主侧**一个字都不会记**。本机 10-15 起的
 * 34 次 `CS-RENDER-002` 就是这种「静默白屏」：12 次建窗、0 条自报、0 条加载失败。
 * 而仓里所有探针的假宿主**不做同源校验** ⇒ 探针全绿、真机全红。这条日志把鸿沟摊开。
 *
 * 放在本模块而不是 `routes.ts`：`routes.ts` 有只减不增的行数棘轮，而这里是渲染链路的
 * 观测出口，`render-job.ts` 与本文件已经是「谁喊话 / 谁记日志」的分工。
 */
export function warnRenderRequestRejected(req: IncomingMessage, path: string, expectedPort: number | undefined): void {
  if (Date.now() - lastRejectedWarnAt < REJECTED_WARN_INTERVAL_MS) return
  lastRejectedWarnAt = Date.now()
  const site = req.headers['sec-fetch-site']
  logRenderHost(
    `[canvas-studio] 渲染链路的请求被本机同源闸拒绝：${req.method ?? '?'} ${path}`
    + ` · host=${req.headers.host ?? '-'} · origin=${req.headers.origin ?? '-'}`
    + ` · sec-fetch-site=${typeof site === 'string' ? site : '-'}`
    + ` · peer=${req.socket.remoteAddress ?? '-'} · 期望端口=${String(expectedPort)}`
    + ' —— 页面会因此白屏且不会自报状态（CS-RENDER-002 的静默成因）',
  )
}

/**
 * 试着把隐藏窗口拉起来（幂等、防抖 2s）。
 *
 * 防抖的理由：`render_composition` 在渲染期可能被连着调（用户「再渲一次」），
 * 每次都去 `ensureRenderHost` 虽然幂等，但会白走一遍 electron 取值链。
 *
 * @returns true = 已发起（或窗口本来就在）；false = 没有拉起器
 */
export function warmRenderHost(now = Date.now()): boolean {
  if (launcher === undefined) return false
  if (now - lastWarmAt < 2000) return true
  lastWarmAt = now
  try {
    launcher()
    return true
  } catch {
    // 建窗口失败（无 electron / 被系统拒）不是致命错误：调用方看到 ready=false 会走客户端。
    return false
  }
}

/** 登记重置钩子（`undefined` = 关掉）。 */
export function setRenderHostResetter(next: RenderHostResetter | undefined): void {
  resetter = next
}

/**
 * 刚刚失败的是**隐藏窗口自己**的时候调一次：把窗口丢掉，下一单拿一个干净的。
 *
 * @returns true = 真的重置了；false = 没有钩子 / 距上次重置太近（被节流）。
 */
export function resetRenderHostAfterFailure(reason: string, now = Date.now()): boolean {
  if (resetter === undefined) return false
  if (now - lastResetAt < RENDER_HOST_RESET_MIN_INTERVAL_MS) return false
  lastResetAt = now
  try {
    resetter(reason)
    return true
  } catch {
    // 重建失败不是致命错误：下一单 `pickExecutor` 会重试拉起（等不到就回退客户端）。
    return false
  }
}

/** 测试用：清掉登记与防抖时间戳。 */
export function resetRenderHostDispatch(): void {
  launcher = undefined
  resetter = undefined
  logger = undefined
  lastWarmAt = 0
  lastResetAt = Number.NEGATIVE_INFINITY
  lastRejectedWarnAt = 0
}
