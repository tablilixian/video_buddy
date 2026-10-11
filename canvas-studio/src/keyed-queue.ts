/**
 * AR-01 / AR-04：**按文件路径串行**的进程内写队列。
 *
 * ## 为什么需要
 *
 * `canvas.json` / `jobs.json` 这类状态档的写路径都是
 * `read → 内存改 → writeFileAtomic`。**原子写只保证文件不损坏，不保证「读-改-写」
 * 语义的原子性** —— 两个并发写者可以各自读到同一份快照，再各自写回，后写者把
 * 先写者整段覆盖（丢的是**节点/记录本身**，不是文件完整性）。
 *
 * 复现证据：`scripts/canvas-write-race-repro.mjs` 修复前每场景 10 轮**轮轮丢失**
 * （并发 append ×20 → 只剩 1 条；并发 upsertAsset ×10 → 只剩 1 条）。
 *
 * 本仓此前**已经有**三种同款串行化，但各写各的、且恰好漏了最大的事实源：
 *   - `storyboard-store.ts` 的 `storyboardQueue`（storyboard.json）
 *   - `asset-history.ts` 的 `historyQueue`（history.json）
 *   - `generate.ts` 的 `manifestQueue`（reference-manifest.json）
 *   - ❌ **`canvas.json`（ProjectRegistry）与 `jobs.json` 从来没有人管**
 *
 * 本模块把「同键串行」抽成一份通用实现，供上述缺口复用。
 *
 * ## 不变式（由 `tests/keyed-queue.test.mjs` 钉住）
 *
 * 1. **同 key 严格 FIFO 串行** —— 同一 key 上任何时刻至多一个任务在执行。
 * 2. **单任务失败不阻断后续** —— 与 `generate-queue.ts` 的同款教训：
 *    「等待中被取消必须出队，否则一个被取消的请求会把整条队列锁死」。
 * 3. **调用方拿到真实错误** —— 队列只负责串行，不吞错（`run` 返回的 Promise
 *    按任务自身结果 settle）。
 * 4. **链尾自清理** —— 一个 key 排空后从表里摘除。**这很重要**：只进不出的缓存
 *    本身就是 AR-09 那类问题（见审查报告）。
 * 5. **不同 key 互不阻塞** —— key 粒度取**文件路径**，所以两个项目天然并行。
 *
 * ## ⚠️ 唯一的坑：同 key 重入 = 死锁（已有探测器）
 *
 * 任务体里**不得**再对同一个 key 调 `run()` —— 那会等自己，永久挂起。而且这个挂起
 * **极其隐蔽**：死锁的 promise 链不是事件循环句柄，Node 会在没有其它活时**正常退出**，
 * 于是表现为「进程提前结束 / 测试被 cancelled / 业务上生成完了但画布没动」，而不是
 * 报错堆栈。2026-10-11 就被咬过一次（`tests/projects-touch.test.mjs` 的 C-10 用
 * 「在 `readCanvas` 钩子里内联触发 `writeCanvas`」模拟并发，入队后正是同 key 重入）。
 *
 * 因此本模块用 `AsyncLocalStorage` 记录「当前任务占着哪个 key」，重入时**抛错**而不是
 * 挂起 —— 把一个最难查的静默故障换成一个能直接读出 key 的异常。
 *
 * 调用方的义务：**只把最外层写口入队，内部复用未入队的实现**（见 `projects.ts` 的
 * `writeCanvasLocked` / `writeCanvas` 分层）。
 */
import { AsyncLocalStorage } from 'node:async_hooks'

interface QueueState {
  /** 该 key 当前的链尾。**永不 reject**，故不会产生 unhandled rejection。 */
  tail: Promise<void>
  /** 该 key 已入队但未完成的任务数（含执行中的那个）。 */
  depth: number
}

export interface KeyedQueue {
  /**
   * 在 `key` 上串行执行 `task`。
   *
   * @returns 透传 `task` 的结果；`task` 抛错则返回的 Promise 也 reject（不吞错）。
   */
  run<T>(key: string, task: () => Promise<T>): Promise<T>
  /** 该 key 尚未完成的任务数（诊断 / 测试用，非业务判据）。 */
  pending(key: string): number
  /** 当前有排队活动的 key 数（诊断用）。 */
  activeKeys(): number
}

export function createKeyedQueue(): KeyedQueue {
  const chains = new Map<string, QueueState>()
  /**
   * 「当前异步上下文正占着哪个 key」。用 `AsyncLocalStorage` 而不是普通变量：
   * 任务体里 `await` 出去之后的深层调用也要能被认出来（重入常常发生在几层之下）。
   */
  const holding = new AsyncLocalStorage<string>()

  /** 任务收尾：深度归零才摘除 state（还有后续任务时必须保留链尾，否则丢串行性）。 */
  function release(key: string): void {
    const state = chains.get(key)
    if (state === undefined) return
    state.depth -= 1
    if (state.depth <= 0) chains.delete(key)
  }

  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      // 同 key 重入 = 等自己 = 死锁。抛错而不是挂起（见文件头注：挂起会静默到
      // 只表现为「进程提前退出」或「业务没生效」）。
      if (holding.getStore() === key) {
        return Promise.reject(new Error(
          `keyed-queue: 同一 key 的重入会自锁，已拒绝执行（key=${key}）。`
          + '修法：只把最外层写口入队，内部改调「未入队」的实现（如 projects.ts 的 writeCanvasLocked）。',
        ))
      }
      // 先取旧链尾（可能不存在），再登记深度 —— 顺序不能反，否则读到的是自己的尾。
      const existing = chains.get(key)
      const previousTail = existing?.tail ?? Promise.resolve()
      const state = existing ?? { tail: previousTail, depth: 0 }
      if (existing === undefined) chains.set(key, state)
      state.depth += 1

      // `.then(() => task())` 而不是 `.then(task)`：既保证「前一个完成才启动本个」，
      // 也让 task 内部的**同步抛错**被这个 then 回调吸收成 rejected promise
      // （否则同步抛错会逃出队列，链尾状态就断了）。
      const result = previousTail.then(() => holding.run(key, () => task()))
      // 链尾永不 reject（失败也照样推进）——否则一个失败任务会让后续任务全部
      // 排在 rejected promise 上，同时触发 unhandled rejection 与「后续静默不执行」。
      state.tail = result.then(
        () => { release(key) },
        () => { release(key) },
      )
      return result
    },

    pending(key: string): number {
      return chains.get(key)?.depth ?? 0
    },

    activeKeys(): number {
      return chains.size
    },
  }
}

/**
 * 全仓共享的写队列实例。
 *
 * 共享一个实例（而不是每个模块各造一个）有实际意义：**同一个文件可能被多个模块
 * 写**（例如 `canvas.json` 既被 `ProjectRegistry` 写、也可能被其它 Host 路径写），
 * 只有同一张表才能保证「同文件串行」。key 取文件绝对路径，天然把不同文件分开。
 */
export const sharedWriteQueue: KeyedQueue = createKeyedQueue()
