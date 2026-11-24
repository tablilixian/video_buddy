/**
 * 实扣（某个节点到底花了多少积分）的 client 侧共享缓存。
 *
 * ## 为什么是 store 而不是「每个节点一个 hook」
 *
 * 画布上一屏可能有几十个节点同时挂载。若各自请求一次，就是几十个本机 HTTP 往返
 * ——Host 侧的批量接口一点用没有。同理，一次生成结束会让「还在对账」的节点同时
 * 变可用，这需要一次性广播，而不是等各组件自己轮询。
 *
 * ## 状态三态（与报价同款纪律：查不到 ≠ 0）
 *
 * - `settled`：Host 从流水里对上了这笔 `commit`，`credits` 是**实扣绝对值**。
 * - `pending`：Host 认这个 id 是「登记过但服务端还没结算」，UI 显示「结算中」。
 * - `unknown`：查过了，账本里没有（超出本地 200 条窗口 / 不是业务链路 / 未登录）。
 *   这一态**不重试**：账本里没有的东西，再问一百次也没有。
 *
 * ## 合并与重试
 *
 * 请求按 300ms 窗口合并成一次 POST。`pending` 的 id 会在 6s / 20s / 60s 后再问
 * 三次——服务端 `commit` 落库本来就可能晚于生成响应，立刻反复问只是打自己的脸。
 */
import { useEffect, useState } from 'react'
import { fetchStudioAccountSpend } from './api.js'

/** 一次实扣读数的三态。 */
export type SpendPhase = 'settled' | 'pending' | 'unknown'

/** 组件读到的快照（引用稳定：同值不会触发重渲染）。 */
export interface SpendSnapshot {
  readonly phase: SpendPhase
  /** 实扣积分（仅 `settled` 有值；4 位小数原样）。 */
  readonly credits: number | null
}

const UNKNOWN: SpendSnapshot = { phase: 'unknown', credits: null }
const PENDING: SpendSnapshot = { phase: 'pending', credits: null }

/** 合并窗口：同一帧挂载的一批节点合成一个请求。 */
const MERGE_WINDOW_MS = 300
/** `pending` 的复问时刻（相对首次请求，毫秒）。 */
const RETRY_DELAYS = [6_000, 20_000, 60_000]
/** 已解析结果的保鲜期：退款会在服务端冲正，10 分钟后重新问是安全的。 */
const RESOLVED_TTL_MS = 10 * 60_000

interface Resolved {
  readonly credits: number
  readonly at: number
}

const resolved = new Map<string, Resolved>()
const pendingIds = new Set<string>()
/** 查过、账本里没有（不重试）。 */
const unknownIds = new Set<string>()
/** 已排过的重试轮次（id → 已用轮次）。 */
const retryRound = new Map<string, number>()
const listeners = new Map<string, Set<() => void>>()

let queue = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null
let inFlight: Promise<void> | null = null

/** 读某个 id 的当前快照（`undefined` 的 id 永远 unknown）。 */
export function spendSnapshot(id: string | undefined): SpendSnapshot {
  if (id === undefined || id === '') return UNKNOWN
  const hit = resolved.get(id)
  if (hit !== undefined && Date.now() - hit.at < RESOLVED_TTL_MS) {
    return { phase: 'settled', credits: hit.credits }
  }
  if (pendingIds.has(id)) return PENDING
  return UNKNOWN
}

function notify(id: string): void {
  const set = listeners.get(id)
  if (set === undefined) return
  for (const listener of set) listener()
}

function subscribeId(id: string, listener: () => void): () => void {
  const set = listeners.get(id)
  if (set === undefined) {
    listeners.set(id, new Set([listener]))
  } else {
    set.add(listener)
  }
  return () => {
    const current = listeners.get(id)
    if (current === undefined) return
    current.delete(listener)
    // 没人看了就摘掉容器：画布频繁删节点时，listeners 不能只增不减。
    if (current.size === 0) listeners.delete(id)
  }
}

/** 把 id 排进合并窗口（已在窗口里 / 已解析 / 已判 unknown 的跳过）。 */
export function requestGenerationSpend(id: string): void {
  if (id === '' || queue.has(id) || inFlight !== null) return
  if (spendSnapshot(id).phase !== 'unknown') return
  queue.add(id)
  if (timer === null) {
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, MERGE_WINDOW_MS)
  }
}

async function flush(): Promise<void> {
  const ids = [...queue]
  queue = new Set()
  if (ids.length === 0) return
  inFlight = (async () => {
    const view = await fetchStudioAccountSpend(ids)
    const now = Date.now()
    for (const id of ids) {
      const credits = view.credits[id]
      if (typeof credits === 'number') {
        resolved.set(id, { credits, at: now })
        pendingIds.delete(id)
        retryRound.delete(id)
        unknownIds.delete(id)
        notify(id)
        continue
      }
      if (view.pending.includes(id)) {
        pendingIds.add(id)
        notify(id)
        scheduleRetry(id)
        continue
      }
      // 既没数字也不在 pending：账本里没有。判 unknown 且**不再问**。
      pendingIds.delete(id)
      unknownIds.add(id)
      notify(id)
    }
    // 报价/流水端点不可用时（未登录、Host 断开）不要把这些 id 判死：下一轮挂载
    // 会重新入队（pending 已清、unknown 未置），自然重试。
    if (view.error !== null) {
      for (const id of ids) unknownIds.delete(id)
    }
  })().finally(() => { inFlight = null })
  return inFlight
}

function scheduleRetry(id: string): void {
  const round = retryRound.get(id) ?? 0
  if (round >= RETRY_DELAYS.length) return
  retryRound.set(id, round + 1)
  setTimeout(() => {
    // 期间可能已被别的路径解析掉（另一个节点带了同一 id）：已 settled 就不再问。
    if (spendSnapshot(id).phase !== 'pending') return
    pendingIds.delete(id)
    unknownIds.delete(id)
    requestGenerationSpend(id)
  }, RETRY_DELAYS[round])
}

/**
 * 读一个节点的实扣（React hook）。
 *
 * `id` 为 `undefined`（老节点 / legacy 链路 / 手写标注）时直接 unknown，**不发请求**。
 */
export function useGenerationSpend(id: string | undefined): SpendSnapshot {
  const [snapshot, setSnapshot] = useState<SpendSnapshot>(() => spendSnapshot(id))

  useEffect(() => {
    // 换节点（重出后 generationId 变了）：先把这一帧的读数对齐，再订阅。
    setSnapshot(spendSnapshot(id))
    if (id === undefined || id === '') return
    const unsubscribe = subscribeId(id, () => { setSnapshot(spendSnapshot(id)) })
    requestGenerationSpend(id)
    return unsubscribe
  }, [id])

  return snapshot
}

/** 生成结束后清缓存并重问（`client/index.ts` 的队列信号调用）。 */
export function invalidateSpendCache(): void {
  // 只清 pending 的重试轮次：让它们从头再问三轮（这次账多半已经落库）。
  for (const id of pendingIds) retryRound.delete(id)
  for (const id of pendingIds) requestGenerationSpend(id)
}

/** 登出 / 换账号：全部清掉，避免下一个账号看到上一个的账。 */
export function resetSpend(): void {
  resolved.clear()
  pendingIds.clear()
  unknownIds.clear()
  retryRound.clear()
  queue = new Set()
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  for (const id of [...listeners.keys()]) notify(id)
}
