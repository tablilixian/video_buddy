/**
 * spot-check 的**单帧预算**（REQ-041 F3）。
 *
 * 真机事故（2026-11-25 会话 `session-3140fcd3`）：`render_composition` 带
 * `spotFrames:[150,480,…,2250]` 连试 3 次，全部落成
 *
 *   「渲染窗口异常：隐藏窗口 31s 内既没有心跳也没有进度（渲染器被卡住），已中止本次渲染。
 *     工单：隐藏渲染窗口已渲染 32s，进度 50%」
 *
 * 也就是说：前 4 张静帧已经渲出来了，第 5 张把主线程按死 ⇒ 宿主 30s 判死整张工单 ⇒
 * **已经渲好的 4 张一起被扔掉**，模型看到的是「一张都没有」。三次探针白烧，最后靠整片
 * draft 硬猜。
 *
 * 这里的判据只有一条：**一帧渲不动不许带走整批静帧**。
 * - 单帧超时（`SPOT_FRAME_TIMEOUT_MS`）⇒ 放弃这一帧、记一条带帧号的告警、继续下一帧；
 * - 超时值必须**小于**隐藏窗口的判失联阈值（`RENDER_HOST_STALE_MS`，30s），否则看门狗
 *   先杀工单，我们连「是哪一帧卡住」都来不及写下来。这条不变式由测试守着。
 *
 * 纯函数（渲染实现由调用方注入），所以不需要浏览器 / 编码器就能被反例驱动。
 */

/**
 * 单帧硬预算（毫秒）。超时即放弃该帧、继续下一帧。
 *
 * 25s 的取值理由：draft 单帧实测在 0.2–1.5s 量级（整片 1350 帧 ≈ 200ms/帧），25s 已是
 * 两个数量级的余量；同时必须留在 30s 看门狗**之内**（见上）。
 */
export const SPOT_FRAME_TIMEOUT_MS = 25_000

/**
 * 交给 Remotion 自己的 `delayRenderTimeoutInMilliseconds`（比硬预算早 5s）。
 *
 * 为什么要它先响：`delayRender` 是 Remotion 内部「等图片解码 / 视频 seek 完成」的闸门，
 * 由它自己超时能带着自己的错误信息干净地 reject 并释放资源；我们的 25s 硬预算只是
 * **兜底**（万一卡的是同步循环，Remotion 的闸门根本轮不到）。
 */
export const SPOT_FRAME_DELAYRENDER_TIMEOUT_MS = 20_000

export type SpotFrameSkipReason = 'timeout' | 'error'

/** 一帧没渲出来（带帧号与原因，直接进 warnings / 错误文案）。 */
export interface SpotFrameSkip {
  frame: number
  reason: SpotFrameSkipReason
  /** 人读文案（已含帧号）。 */
  message: string
}

export interface SpotFrameRunResult<T> {
  /** 渲出来的帧（按输入顺序）。 */
  done: Array<{ frame: number; value: T }>
  /** 被放弃的帧（超时 / 报错）。 */
  skipped: SpotFrameSkip[]
  /** 调用方主动取消（不是一个「失败」）。 */
  aborted: boolean
}

export interface SpotFrameRunOptions {
  /** 单帧预算（缺省 `SPOT_FRAME_TIMEOUT_MS`；测试注入短值）。 */
  timeoutMs?: number
  /** 调用方取消信号（换会话 / 窗口关闭）。 */
  signal?: AbortSignal
  /** 每帧开渲前的回调（进度文案 / 记录「正在渲哪一帧」）。 */
  onFrameStart?: (frame: number, index: number, total: number) => void
}

/**
 * 逐帧渲染，**每帧独立计预算**：超时或报错只丢这一帧。
 *
 * 纪律：
 * - 调用方取消（`options.signal`）⇒ 立刻停，`aborted: true`，已完成的帧照样带出去；
 * - 帧内错误不吞成静默：全部失败由调用方决定是否抛（这里只负责分类）；
 * - 超时后 `controller.abort()`，把 Remotion 那次 still 渲染尽量停掉，别让它在后台
 *   继续按住主线程。
 */
export async function runSpotFramesWithTimeout<T>(
  frames: readonly number[],
  renderOne: (frame: number, signal: AbortSignal) => Promise<T>,
  options: SpotFrameRunOptions = {},
): Promise<SpotFrameRunResult<T>> {
  const timeoutMs = Math.max(1, Math.round(options.timeoutMs ?? SPOT_FRAME_TIMEOUT_MS))
  const total = frames.length
  // 必须走函数读：直接在原地写 `options.signal?.aborted === true` 会被 TS 的流分析
  // 记住「上一次判断为 false」，第二次比较被判成永不重叠（TS2367）—— 而 abort 是
  // 事件驱动的，编译器看不到它变了。
  const isAborted = (): boolean => options.signal?.aborted === true
  const done: Array<{ frame: number; value: T }> = []
  const skipped: SpotFrameSkip[] = []
  for (let index = 0; index < total; index += 1) {
    const frame = frames[index] as number
    if (isAborted()) return { done, skipped, aborted: true }
    options.onFrameStart?.(frame, index, total)
    const controller = new AbortController()
    const relay = (): void => controller.abort()
    options.signal?.addEventListener('abort', relay, { once: true })
    // 用对象而不是裸 `let`：定时器回调里的赋值会被 TS 的流分析当成「不可能发生」，
    // catch 里的 `timedOut` 会被窄化成 `false`（TS2367）。
    const state: { timedOut: boolean } = { timedOut: false }
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        state.timedOut = true
        controller.abort()
        reject(new Error(`第 ${frame} 帧 ${Math.round(timeoutMs / 1000)}s 内没渲出来（这一帧把渲染器卡住了）`))
      }, timeoutMs)
      // 不要 unref 这颗定时器：当某一帧卡死时，**它是唯一会把这一帧结算掉的东西**
      //（进度回调已经停了）。unref 之后事件循环空转就会退出，调用方拿到的是一个永远
      // 不结算的 promise（测试里表现为 cancelledByParent）。
    })
    try {
      const value = await Promise.race([renderOne(frame, controller.signal), timeoutPromise])
      done.push({ frame, value })
    } catch (cause) {
      if (isAborted()) return { done, skipped, aborted: true }
      const message = cause instanceof Error ? cause.message : String(cause)
      skipped.push({
        frame,
        reason: state.timedOut ? 'timeout' : 'error',
        // 超时文案由上面那颗定时器给出（已带帧号与秒数）；帧内报错在这里补帧号。
        message: state.timedOut ? message : `第 ${frame} 帧渲染失败：${message}`,
      })
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      options.signal?.removeEventListener('abort', relay)
    }
  }
  return { done, skipped, aborted: false }
}
