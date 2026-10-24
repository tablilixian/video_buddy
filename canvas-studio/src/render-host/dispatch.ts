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
  lastWarmAt = 0
  lastResetAt = Number.NEGATIVE_INFINITY
}
