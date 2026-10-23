/**
 * 余额卡的 client 侧状态（CV-358）。
 *
 * 与 `auth/auth-store.ts` 同构：模块级单例 + `subscribe`，因为它的**触发源有三个**
 * ——左栏卡片挂载、登录态变化、以及 `client/index.ts` 里「一次生成彻底结束」的
 * 队列信号。挂在 React state 上就得把队列信号一路透传成 props，反而更绕。
 *
 * 分工：**TTL / 登录态 / 403 全在 Host 判**（`account-state.ts`），这里只管
 * 「什么时候问一次」与「请求在飞/失败」。两处都判一次的状态迟早漂移。
 */
import { fetchStudioAccountCredits } from './api.js'
import type { AccountCreditsView } from '../contracts/account.js'

export interface CreditsState {
  /** Host 视图；null = 还没问过（首帧，不能当成 0）。 */
  view: AccountCreditsView | null
  /** 请求在飞：只用于 `aria-busy` 与点击防抖，不阻塞渲染、不换数字。 */
  loading: boolean
  /** client 侧请求失败（连不上 Host）；Host 视图里的 error 是服务端失败，分开显示。 */
  failure: string | null
}

/** 生成结束后复检延迟：服务端扣费可能晚于「请求返回」这一瞬间。 */
const SETTLE_RECHECK_MS = 6_000

let state: CreditsState = { view: null, loading: false, failure: null }
const listeners = new Set<() => void>()

export function getCreditsState(): CreditsState {
  return state
}

export function subscribeCredits(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function emit(next: CreditsState): void {
  state = next
  for (const listener of listeners) listener()
}

let inFlight: Promise<void> | null = null

/**
 * 读一次余额。`force=false` 由 Host 的 TTL 决定要不要真的打接口。
 *
 * 在飞去重：连点、卡片挂载与队列信号撞在一起也只发一个请求（Host 侧还有一层
 * 同款保护，两层都不多余 —— 这一层省掉的是本机 HTTP 往返）。
 */
export function refreshCredits(force = false): Promise<void> {
  if (inFlight !== null) return inFlight
  emit({ ...state, loading: true })
  inFlight = (async () => {
    try {
      const view = await fetchStudioAccountCredits(force)
      emit({ view, loading: false, failure: null })
    } catch (cause) {
      // 失败保留旧视图：数字宁可旧，也不要跳成 0 或空白。
      emit({ ...state, loading: false, failure: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

let recheckTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 一次生成彻底结束后的刷新（`client/index.ts` 的队列信号调用）。
 *
 * 两次请求封顶：立刻一次（拿到已结清的账）+ 6s 后一次（兜住异步结算）。上一个
 * 复检计时器未触发时先清掉，连续生成不会叠计时器。
 */
export function refreshCreditsAfterGeneration(): void {
  void refreshCredits(true)
  if (recheckTimer !== null) clearTimeout(recheckTimer)
  recheckTimer = setTimeout(() => {
    recheckTimer = null
    void refreshCredits(true)
  }, SETTLE_RECHECK_MS)
}

/** 登出 / 换账号：清掉内存视图，避免下一个账号看到上一个的余额。 */
export function resetCredits(): void {
  if (recheckTimer !== null) {
    clearTimeout(recheckTimer)
    recheckTimer = null
  }
  emit({ view: null, loading: false, failure: null })
}

/**
 * 页面重新可见时对一次（切走再回来）。TTL 由 Host 判，这里不重复判 ——
 * 30s 内回来就是一个零请求的空转。
 *
 * 幂等由调用方保证（StudioFrame 的挂载 effect），不在这里做去重标记：本函数
 * 只加监听，重复调用会重复加，故调用点必须是「只跑一次」的 effect。
 */
export function installCreditsVisibilityRefresh(): void {
  if (typeof document === 'undefined') return
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshCredits(false)
  })
}
