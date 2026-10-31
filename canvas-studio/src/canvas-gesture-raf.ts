/**
 * CV-384 P0-2：手势事件 → 渲染帧的合并器（纯逻辑，帧调度可注入以便单测）。
 *
 * pointermove / wheel 的事件频率可以高于显示帧率（mac 触控板 120Hz+），
 * 每个事件直写 store + 重渲会把同一帧画好几遍。合并器把「一帧内到达的多个
 * 事件」折叠成恰好一次应用：
 *
 *   - `push`：事件先落这里；本帧首次 push 时排一帧回调；
 *   - 回调：用 `merge` 折叠出的那一帧调 `apply`（一帧至多一次）；
 *   - `flush`：取消已排的回调并立刻应用待处理帧 —— 松手时最后一帧坐标必须
 *     入账（拖拽终点精度），由 onPointerUp 在收口前调用；
 *   - `reset`：丢弃待处理帧并取消回调（手势已终结）。
 *
 * 折叠语义由调用方给，两栖各有一例：拖拽/平移取**最新坐标**（绝对位置，
 * 中间点无意义，`mergeLatestPoint`）；滚轮缩放**累乘因子**（log 域累加，
 * 中间量丢失会改变缩放总量）。
 *
 * 纯模块：不碰 React / DOM（`schedule` 可注入假时钟）；放 `src/` 根与
 * canvas-math 同款 —— 单测直连 `lib/` 编译产物（`src/client/**` 不进 tsc 产物）。
 */

/** 帧调度器：排一帧回调，返回取消函数。默认 requestAnimationFrame。 */
export type FrameScheduler = (callback: () => void) => () => void

const defaultScheduler: FrameScheduler = (callback) => {
  if (typeof requestAnimationFrame !== 'function') {
    // 非浏览器环境（Node 单测）退化：语义仍是「本帧一次」。
    let cancelled = false
    void Promise.resolve().then(() => {
      if (!cancelled) callback()
    })
    return () => { cancelled = true }
  }
  const id = requestAnimationFrame(callback)
  return () => cancelAnimationFrame(id)
}

export interface FrameCoalescer<T> {
  /** 落一帧事件；本帧首次调用时排帧回调。 */
  push(frame: T): void
  /** 立刻应用待处理帧（并取消已排回调）。返回是否真的应用了。 */
  flush(): boolean
  /** 丢弃待处理帧并取消已排回调（手势终结）。 */
  reset(): void
  /** 是否还有待处理帧（测试与断言用）。 */
  hasPending(): boolean
}

export function createFrameCoalescer<T>(options: {
  /** 一帧内多个事件的折叠方式（prev 已折叠帧 + next 新事件 → 折叠帧）。 */
  merge: (prev: T, next: T) => T
  apply: (frame: T) => void
  schedule?: FrameScheduler
}): FrameCoalescer<T> {
  const { merge, apply } = options
  const schedule = options.schedule ?? defaultScheduler
  let pending: T | undefined
  let cancelScheduled: (() => void) | null = null
  const run = (): boolean => {
    if (pending === undefined) return false
    const frame = pending
    pending = undefined
    apply(frame)
    return true
  }
  return {
    push(frame: T): void {
      pending = pending === undefined ? frame : merge(pending, frame)
      if (cancelScheduled === null) {
        cancelScheduled = schedule(() => {
          cancelScheduled = null
          run()
        })
      }
    },
    flush(): boolean {
      if (cancelScheduled !== null) {
        cancelScheduled()
        cancelScheduled = null
      }
      return run()
    },
    reset(): void {
      if (cancelScheduled !== null) {
        cancelScheduled()
        cancelScheduled = null
      }
      pending = undefined
    },
    hasPending(): boolean {
      return pending !== undefined
    },
  }
}

/** 拖拽 / 平移的折叠语义：取最新坐标（绝对位置，中间点无意义）。 */
export function mergeLatestPoint(
  _prev: { x: number; y: number },
  next: { x: number; y: number },
): { x: number; y: number } {
  return next
}
