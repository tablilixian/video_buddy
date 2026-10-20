/**
 * REQ-034 · O-05 RenderHost 生命周期（**纯逻辑，零 electron 依赖**）。
 *
 * 为什么把它单独抽出来：窗口创建/销毁是副作用，不能被 node:test 直接驱动；
 * 而「什么时候该销毁」是纯状态判断 —— 拆开后可以用假时钟把
 * 「忙时不回收 / 空闲到点回收 / 再次取用重置计时」全部断言死，反向变异能真红。
 *
 * 口径（与方案 §4.5 一致）：
 * - **单实例**：同一时刻只有一个隐藏窗口，重复 `acquire()` 返回 false；
 * - **忙时不回收**：渲染期间 idle 计时暂停，结算后重新起算；
 * - **空闲回收**：默认 5 分钟无动作即销毁（冷启约 1s，用户感知成本低）。
 */

/** 空闲回收默认值：5 分钟。 */
export const RENDER_HOST_IDLE_MS = 5 * 60_000

export interface RenderHostLifecycleOptions {
  /** 空闲多久销毁窗口；≤0 表示不自动回收（仅测试/调试用）。 */
  idleMs?: number | undefined
  /** 注入时钟（测试用）。 */
  now?: () => number
  /** 真正销毁窗口的回调（生产实现 = disposeRenderHost）。 */
  onDispose: (reason: string) => void
  /** 注入定时器（测试用）。返回清除函数。 */
  schedule?: (fn: () => void, delayMs: number) => () => void
}

export interface RenderHostSnapshot {
  active: boolean
  busy: boolean
  /** 距上次活动的毫秒数；未激活时为 0。 */
  idleForMs: number
}

/**
 * 隐藏渲染窗口的生命周期状态机。
 *
 * 只做判断与计时，不碰 Electron —— 调用方（`window.ts`）在 `onDispose` 里闭窗口。
 */
export class RenderHostLifecycle {
  private active = false
  private busy = false
  private lastActiveAt = 0
  private cancelTimer: (() => void) | null = null
  private readonly idleMs: number
  private readonly now: () => number
  private readonly onDispose: (reason: string) => void
  private readonly schedule: (fn: () => void, delayMs: number) => () => void

  constructor(options: RenderHostLifecycleOptions) {
    this.idleMs = options.idleMs ?? RENDER_HOST_IDLE_MS
    this.now = options.now ?? Date.now
    this.onDispose = options.onDispose
    this.schedule = options.schedule ?? ((fn, delayMs) => {
      const timer = setTimeout(fn, delayMs)
      // 别让这台定时器独撑进程存活：宿主退出时不该被它拖住。
      if (typeof timer.unref === 'function') timer.unref()
      return () => clearTimeout(timer)
    })
  }

  /**
   * 申请窗口。
   * @returns true = 本次新建（调用方要真去建窗口）；false = 已在用，只管 touch。
   */
  acquire(): boolean {
    this.lastActiveAt = this.now()
    if (this.active) {
      this.rearm()
      return false
    }
    this.active = true
    this.rearm()
    return true
  }

  /** 渲染开始/结束时调用；`busy=true` 期间不回收。 */
  setBusy(busy: boolean): void {
    this.busy = busy
    this.lastActiveAt = this.now()
    this.rearm()
  }

  /** 任何一次来自渲染窗口的请求都算活动（心跳也走这里）。 */
  touch(): void {
    if (!this.active) return
    this.lastActiveAt = this.now()
    this.rearm()
  }

  snapshot(): RenderHostSnapshot {
    return {
      active: this.active,
      busy: this.busy,
      idleForMs: this.active ? Math.max(0, this.now() - this.lastActiveAt) : 0,
    }
  }

  /** 主动销毁（App 退出、插件卸载、启动失败）。 */
  dispose(reason: string): void {
    this.clearTimer()
    if (!this.active) return
    this.active = false
    this.busy = false
    this.onDispose(reason)
  }

  private clearTimer(): void {
    this.cancelTimer?.()
    this.cancelTimer = null
  }

  /**
   * 重新排一次 idle 计时。
   *
   * `busy` 时不排 —— 渲染可能远超 idle 时长，按「最近一次心跳」算会误杀正在干活的窗口；
   * 结算时 `setBusy(false)` 会重新起算。
   */
  private rearm(): void {
    this.clearTimer()
    if (!this.active || this.busy || this.idleMs <= 0) return
    this.cancelTimer = this.schedule(() => {
      this.cancelTimer = null
      if (!this.active || this.busy) return
      this.dispose('idle')
    }, this.idleMs)
  }
}
