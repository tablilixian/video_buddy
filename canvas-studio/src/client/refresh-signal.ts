/**
 * 全应用统一的「回到应用」刷新信号（方案 `订阅与积分接入方案-20261102.md` R-1）。
 *
 * ## 它修的是什么
 *
 * 旧实现只有 `document.visibilitychange`（`auth-store.ts` 的
 * `installAuthVisibilityPush`、`credits-store.ts` 的
 * `installCreditsVisibilityRefresh`）。在 **Electron 里这条路不成立**：从系统浏览器
 * 付完款切回来时，页面**一直是 visible**（窗口没最小化），`visibilitychange`
 * 一次都不触发 —— 于是「付了钱看不到到账」「聊完回来积分不动」。
 *
 * 唯一可靠的信号是窗口级 `focus`（外加 `visibilitychange` 兜住最小化/休眠场景）。
 *
 * ## 为什么要有 1 秒去重
 *
 * 切回窗口会连续触发 `focus`、`visibilitychange`，加上用户点一下画布又触发一次
 * `focus`。三个消费者（auth 推会话 / 余额 / 计费）各自发请求 ⇒ 一次切窗能打出
 * 六七个请求。这里在**发信号层**去重一次，比让每个消费者各自节流可靠。
 */
type RefreshListener = () => void

/** 去重窗口（毫秒）：覆盖一轮 focus + visibilitychange 的抖动。 */
const DEDUPE_MS = 1_000

const listeners = new Set<RefreshListener>()
let installed = false
let lastFiredAt = 0

function fire(): void {
  const now = Date.now()
  if (now - lastFiredAt < DEDUPE_MS) return
  lastFiredAt = now
  // 单个监听器抛错不能影响其它消费者（一个刷新逻辑的 bug 不该让整组刷新停摆）。
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // 吞掉：刷新信号是尽力而为，错误由各消费者自己记录。
    }
  }
}

/**
 * 订阅「回到应用」信号；返回取消函数。
 *
 * 同时挂 `focus` 与 `visibilitychange`：前者修 Electron 的主场景（窗口始终 visible），
 * 后者兜住「最小化 → 恢复」与「系统休眠唤醒」。
 */
export function onAppFocus(listener: RefreshListener): () => void {
  installRefreshSignal()
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 幂等安装（重复调用只挂一次监听）。 */
export function installRefreshSignal(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('focus', fire)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') fire()
  })
}

/** 仅测试用：卸载监听并清空订阅者（模块级单例，不提供就没有办法隔离用例）。 */
export function disposeRefreshSignal(): void {
  if (!installed || typeof window === 'undefined') {
    listeners.clear()
    lastFiredAt = 0
    return
  }
  installed = false
  window.removeEventListener('focus', fire)
  listeners.clear()
  lastFiredAt = 0
}

/** 仅测试用：手动触发一次（不依赖 jsdom 的事件系统）。 */
export function fireRefreshSignalForTest(): void {
  lastFiredAt = 0
  fire()
}
