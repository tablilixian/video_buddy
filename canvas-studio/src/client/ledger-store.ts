/**
 * 积分流水的 client 侧状态（账务页的数据源）。
 *
 * 与 `credits-store` 同构：模块级单例 + `subscribe`。理由也一样 —— 同一份流水会被
 * 「订阅与积分页」与将来的「今日消耗」卡片读，各持一份必然漂移；而 TTL / 翻页游标
 * 全在 Host（`account-state.ts`）判，这里只管「什么时候问」与「在飞/失败」。
 */
import { fetchStudioAccountLedger } from './api.js'
import type { AccountLedgerView } from '../contracts/account.js'

export interface LedgerState {
  /** Host 视图；null = 还没问过（首帧，不能当成「没有记录」）。 */
  view: AccountLedgerView | null
  loading: boolean
  /** 翻下一页在飞（与首屏 loading 分开：翻页时不能把已有列表换成骨架）。 */
  loadingMore: boolean
  /** client 连不上 Host；Host 视图里的 error 是服务端失败，分开显示。 */
  failure: string | null
}

let state: LedgerState = { view: null, loading: false, loadingMore: false, failure: null }
const listeners = new Set<() => void>()

export function getLedgerState(): LedgerState {
  return state
}

export function subscribeLedger(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function emit(next: LedgerState): void {
  state = next
  for (const listener of listeners) listener()
}

let inFlight: Promise<void> | null = null

/** 读流水（`force` 绕 Host 的 60s TTL，`more` 按游标追加下一页）。 */
export function refreshLedger(force = false, more = false): Promise<void> {
  if (inFlight !== null) return inFlight
  emit(more ? { ...state, loadingMore: true } : { ...state, loading: true })
  inFlight = (async () => {
    try {
      const view = await fetchStudioAccountLedger({ force, more })
      emit({ view, loading: false, loadingMore: false, failure: null })
    } catch (cause) {
      // 失败保留旧视图：账目宁可旧，也不要跳成一张空表（「我的记录没了」）。
      emit({
        ...state,
        loading: false,
        loadingMore: false,
        failure: cause instanceof Error ? cause.message : String(cause),
      })
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

/** 登出 / 换账号：清掉列表，避免下一个账号看到上一个人的账。 */
export function resetLedger(): void {
  emit({ view: null, loading: false, loadingMore: false, failure: null })
}
