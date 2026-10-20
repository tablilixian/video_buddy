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

let launcher: RenderHostLauncher | undefined
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

/** 测试用：清掉登记与防抖时间戳。 */
export function resetRenderHostDispatch(): void {
  launcher = undefined
  lastWarmAt = 0
}
