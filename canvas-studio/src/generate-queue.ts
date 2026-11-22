/**
 * 宿主侧在途任务闸（迁移 B3-3，2026-11-22 重写；原 CV-220 单槽 FIFO）。
 *
 * ## 演进：为什么从「单槽」变「宽度 N 的在途计数闸」
 *
 * 旧后台（8082）是**同步单任务**：并发提交只排队、墙钟不变 ⇒ 宿主把并发收敛为 1
 * （CV-220，`maxParallel` 刻意不接线）。新业务 API 是**异步任务 + 套餐并发上限**
 * （`entitlement.features.concurrent_generations`，实测 starter = 2），拍板（2026-11-22）：
 * 客户端按 `min(maxParallel, 套餐值)` 限「同时任务数」，出厂默认 1（保守起步，
 * 设置页可调）。
 *
 * 语义（与旧单槽的关键差别）：
 *  - **acquire 于创建前、release 于终态**——「在途」= 已创建但未终态的任务数，
 *    不是「正在执行的函数」。视频跑 40 分钟只占一个在途名额，不把其它创建挡满
 *    40 分钟（旧实现 video submit 即释放槽位，本质就是手动版的这个语义）。
 *  - **严格 FIFO**、**等待中被取消必须出队**（不变式与 CV-220 相同，测试钉住）。
 *  - 重启恢复轮询在跟的在途任务**不计入**（它们是服务端已知在跑的事实；客户端
 *    闸是尽力而为，真正的硬限制在服务端 409 conflict）。
 *
 * ## 接入点（两处，测试钉住）
 *  - `runBusinessGenerationTask`（业务 API 链路：acquire → 创建+轮询 → release）；
 *  - `callDramaJson`（legacy 视频路径：等价旧 withGenerateSlot）。
 *
 * ## 不变式
 *  - 同刻在途 ≤ width（`active` 集合大小）。
 *  - 严格 FIFO：按入队次序授权，不插队。
 *  - 等待中被取消必须出队（否则一个被取消的请求锁死整条队列——最危险失败模式）。
 */
import { makeCanvasError } from './error-system.js'
import './errors/catalog.js'
import type { GenerateQueueEntry, GenerateQueueSnapshot } from './queue-view.js'

interface Waiter {
  readonly id: number
  readonly label: string
  /** 授权执行（把 resolve 收在闭包里，避免外部拿到裸 resolve）。 */
  readonly grant: () => void
}

let nextId = 1
/** 在途任务（已授权、未 release）。 */
const active = new Map<number, string>()
const waiting: Waiter[] = []

/**
 * 在途上限（同时任务数宽度）。**取值是 getter**：装配层接 `maxParallel` 设置项
 * （设置页改动即时生效，无需重启）。缺省 1 = 拍板④的保守出厂值。
 */
let widthOf: () => number = () => 1

/** 装配时注入宽度来源（settings getter）；测试可直接注入常量。 */
export function setGenerateQueueWidth(source: () => number): void {
  widthOf = source
}

/** 当前生效宽度（clamp 1..8，与 maxParallel 设置项范围一致）。 */
function effectiveWidth(): number {
  const raw = widthOf()
  return Number.isFinite(raw) ? Math.min(8, Math.max(1, Math.round(raw))) : 1
}

/** 把 abort 归一成**取消码**（CV-239：CS-GEN-207，客户端据此移除占位而非标红失败）。 */
function abortReason(signal: AbortSignal | undefined): unknown {
  const reason = signal?.reason
  if (reason instanceof Error) return reason
  return makeCanvasError('CS-GEN-207', { detail: '排队等待被取消' })
}

/**
 * 一次生成结束的钩子（CV-358：把余额缓存标记陈旧）。
 *
 * 刻意做成 setter 而不是直接 `import { markCreditsStale }`：生成队列是媒体链路，
 * 不该反向依赖账号编排模块；接线放装配层（`index.ts`）。
 *
 * 语义是「**本次请求已经结束**」，不是「服务端已经结清」—— 扣费时刻后端才知道，
 * 钩子只负责让下一次读数不吃旧缓存。异常一律吞掉：队列推进的优先级高于记账。
 */
export type GenerationSettledHook = () => void
let settledHook: GenerationSettledHook | null = null

/** 装配时接线；传 null 撤销（单测复位用）。 */
export function setGenerationSettledHook(hook: GenerationSettledHook | null): void {
  settledHook = hook
}

/** 释放并推进（pump 在前：先让下一单拿到名额，记账失败不传导给队列）。 */
function release(id: number): void {
  active.delete(id)
  pump()
  try {
    settledHook?.()
  } catch {
    // 记账钩子的异常绝不外抛（它是附加语义，不是生成结果的一部分）。
  }
}

/**
 * 授权下一个：在途 < 宽度时出队（可能一次授权多个——release 后空位补齐）。
 * 唯一的推进点：release 后必须调它。
 */
function pump(): void {
  for (;;) {
    if (active.size >= effectiveWidth()) return
    const next = waiting.shift()
    if (next === undefined) return
    active.set(next.id, next.label)
    next.grant()
  }
}

/** 一次在途任务的租约：调用方在终态/放弃时调用 `release()`（必须 finally）。 */
export interface InFlightLease {
  readonly release: () => void
}

/**
 * 申请一个在途名额。等待期间被 abort 则**出队并抛错** —— 不清理就锁死整条队列。
 *
 * 用法（创建前 acquire、终态 release）：
 * ```ts
 * const lease = await acquireInFlight(label, signal)
 * try { /* 创建 + 轮询 *\/ } finally { lease.release() }
 * ```
 */
export function acquireInFlight(label: string, signal: AbortSignal | undefined): Promise<InFlightLease> {
  // 入队前就已取消：直接拒绝，不占用队列位置。
  if (signal?.aborted === true) return Promise.reject(abortReason(signal))
  return new Promise<InFlightLease>((resolve, reject) => {
    const id = nextId
    nextId += 1
    // `done` 是「本次等待已有结论」的唯一判据：保证 grant / abort 二者只有一个生效。
    let done = false
    const detach = (): void => { signal?.removeEventListener('abort', onAbort) }
    const onAbort = (): void => {
      if (done) return
      done = true
      detach()
      const index = waiting.findIndex((entry) => entry.id === id)
      // 已出队（= 已授权）时不该走到这里；`done` 已挡住，此处只为防御。
      if (index >= 0) waiting.splice(index, 1)
      reject(abortReason(signal))
    }
    const grant = (): void => {
      if (done) return
      done = true
      detach()
      resolve({ release: () => release(id) })
    }
    if (signal !== undefined) signal.addEventListener('abort', onAbort, { once: true })
    waiting.push({ id, label, grant })
    pump()
  })
}

/**
 * 旧口径兼容：在队列里执行 `run()`（acquire → run → release）。legacy callDramaJson
 * 与测试继续用它；业务 API 链路用 {@link acquireInFlight} 手动配对（创建前/终态）。
 */
export async function withGenerateSlot<T>(
  label: string,
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const lease = await acquireInFlight(label, signal)
  try {
    return await run()
  } finally {
    lease.release()
  }
}

/** 取当前队列快照（纯读取，无副作用）。 */
export function generateQueueSnapshot(): GenerateQueueSnapshot {
  // 执行中的条目 `position` 恒为 0（对位次的约定只在 queue-view.ts 里写一次）。
  const activeEntry: GenerateQueueEntry | null = active.size === 0
    ? null
    : { id: `g${active.keys().next().value ?? 0}`, label: active.values().next().value ?? '', position: 0 }
  const waitingEntries: GenerateQueueEntry[] = waiting.map((entry, index) => ({
    id: `g${entry.id}`,
    label: entry.label,
    position: index + 1,
  }))
  // 快照只有事实：`busy` 由 queue-view.ts 的 generateQueueBusyOf 单点推导。
  return { active: activeEntry, waiting: waitingEntries }
}

/**
 * 清空队列（**仅供测试隔离**）。
 *
 * 产品路径不该调用：它会把仍在等待的请求永久挂起（既不授权也不拒绝）。
 */
export function resetGenerateQueue(): void {
  waiting.length = 0
  active.clear()
  nextId = 1
}
