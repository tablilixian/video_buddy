/**
 * 宿主侧「同步单任务」生成队列（CV-220）。
 *
 * ## 为什么需要
 *
 * Drama 后端是**同步单任务**：同刻只处理一个请求，并发提交只排队、墙钟不变
 * （实测 A 9.4s + B 18.7s 并发墙钟仍 18.7s；模型可见纪律见 `config.ts`）。
 * 宿主此前**没有任何队列** —— `/canvas-studio/generate` 收到即发，客户端连点
 * 节点重试 / 打回重出 / 模型同回合发多个调用，都会把多个请求同时压给后端。
 *
 * 真正的代价不是「慢」，而是**误判**：
 *  - 客户端占位节点的结算上限 `PENDING_TIMEOUT_MS = 660s` 从**占位落地那一刻**
 *    起算（`client/index.ts` 的 `onToolCall`），而 `DRAMA_TIMEOUT_MS.video = 600s`
 *    —— 只剩 **60s 余量**。只要请求重叠一次，排在后面的请求「还没轮到」就会被
 *    判成「生成超时」。
 *  - 后端还被**他人**占用（实测 `queue_task_count=5`），我们无从预知。
 *
 * 于是本模块做两件事：
 *  ① 把宿主自己的并发收敛为 1 —— 至少做到「我们这边不再往后端队列里堆」；
 *  ② 把「谁在执行 / 谁在等 / 排第几」变成**可读快照**，让 UI 如实显示，
 *    并把排队时间从「超时」里摘出去（见 `client/index.ts` 的轮询）。
 *
 * ## 边界（刻意不做的事）
 *
 * - **不排队上传 / 健康探针 / 文本工具**：接入点选在 `callDrama`（媒体生成的
 *   唯一网络入口）。`uploadBytesToDrama`、`ensureDramaReachable`、`callDramaRaw`
 *   各自独立，因此上传、探活、prompt 增强都不会抢占生成槽位。
 * - **不排队异步供应商**：fal 是 submit → 轮询的三段式，天然不走 `callDrama`，
 *   所以显式选 fal 的用户不受影响。「provider-aware」在这里是**结构**保证
 *   （接在 Drama 专属入口上），不是散落的 `if (provider === 'drama')` 分支。
 * - **不接 `maxParallel`**：后端同步单任务，调大并发只会堆积排队并放大上面的
 *   误判，收益为零。设置页继续如实标注「本项不会生效」（见 `host-config.ts`）。
 *
 * ## 不变式
 *
 * - **同刻最多一个在执行**（`active` 至多一个非空）。
 * - **严格 FIFO**：按入队次序授权，不插队。
 * - **槽位必须释放**：`withGenerateSlot` 在 `finally` 里释放，`run()` 抛错同理。
 * - **等待中被取消必须出队**：否则一个被取消的请求会把整条队列锁死 ——
 *   这是本模块最危险的失败模式，由 `tests/generate-queue.test.mjs` 钉住。
 */
import type { GenerateQueueEntry, GenerateQueueSnapshot } from './queue-view.js'

interface Waiter {
  readonly id: number
  readonly label: string
  /** 授权执行（把 resolve 收在闭包里，避免外部拿到裸 resolve）。 */
  readonly grant: () => void
}

let nextId = 1
let active: { id: number; label: string } | null = null
const waiting: Waiter[] = []

/**
 * 授权下一个：仅在空闲时出队。
 *
 * 唯一的推进点 —— `withGenerateSlot` 释放槽位后必须调它，否则队列永不再前进
 * （表现为「第一个跑完，后面的永远不动」）。
 */
function pump(): void {
  if (active !== null) return
  const next = waiting.shift()
  if (next === undefined) return
  active = { id: next.id, label: next.label }
  next.grant()
}

/** 把 abort 归一成错误对象：`reason` 是 Error 就用它，否则给一句中文。 */
function abortReason(signal: AbortSignal | undefined): unknown {
  const reason = signal?.reason
  return reason instanceof Error ? reason : new Error('已取消')
}

/**
 * 申请一个槽位。等待期间被 abort 则**出队并抛错** —— 不清理就锁死整条队列。
 */
function acquire(label: string, signal: AbortSignal | undefined): Promise<void> {
  // 入队前就已取消：直接拒绝，不占用队列位置。
  if (signal?.aborted === true) return Promise.reject(abortReason(signal))
  return new Promise<void>((resolve, reject) => {
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
      resolve()
    }
    if (signal !== undefined) signal.addEventListener('abort', onAbort, { once: true })
    waiting.push({ id, label, grant })
    pump()
  })
}

/**
 * 在队列里执行 `run()`：先排队拿到槽位，跑完（或抛错）必然释放。
 *
 * @param label - 展示用标签（`generateLabelOf(endpoint)` 派生）。
 * @param signal - 取消信号；等待期间取消会出队。
 * @param run - 真正的生成逻辑。
 */
export async function withGenerateSlot<T>(
  label: string,
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  await acquire(label, signal)
  try {
    return await run()
  } finally {
    // 释放与推进必须在一起：漏掉 pump() 会让队列停在第一个上。
    active = null
    pump()
  }
}

/** 取当前队列快照（纯读取，无副作用）。 */
export function generateQueueSnapshot(): GenerateQueueSnapshot {
  // 执行中的条目 `position` 恒为 0（对位次的约定只在 queue-view.ts 里写一次）。
  const activeEntry: GenerateQueueEntry | null = active === null
    ? null
    : { id: `g${active.id}`, label: active.label, position: 0 }
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
  active = null
  nextId = 1
}
