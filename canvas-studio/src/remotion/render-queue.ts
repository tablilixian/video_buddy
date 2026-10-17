/**
 * REQ-034 · 二期 1b：**渲染工单队列**（宿主侧，进程内单例）。
 *
 * 为什么需要它：此前 `pendingRenderJobFor(projectId)` 只返回该项目**第一张**工单，
 * 客户端同时只跑一个 `activeRender` ⇒ 并发多单是「隐式排队」：没有顺序保证、没有上限、
 * 队列满了也照收，最后一起超时。渲染又是 CPU/内存重操作（CSR 软编），多开只会互相抢。
 *
 * 拍板（二期 D-04）：
 * - **并发 = 1**（客户端本来只能串行，见 `client/index.ts` 的 `activeRender`）；
 * - **队列上限 4**，超出**立刻拒收**（`CS-USER-ERR`），不排到超时；
 * - **严格 FIFO**。
 *   ⚠️ 计划里提过「同项目优先」，落码时改成严格 FIFO：并发为 1 时"同项目优先"反而会
 *   放大「A 项目一串单把 B 堵死」的问题，而且导出顺序随调用方时序漂移、不便断言。
 *   要改回优先策略只需改 `pickNextJobId` 一处。
 * - 超时**从派发时刻开始算**（排队等待不计入），公式见 `timing.ts` 的 `renderTimeoutMs`。
 *
 * 状态机：`queued → rendering → succeeded | failed | cancelled | timedOut`。
 * 已结算工单保留最近 `RENDER_JOB_HISTORY` 条供 `GET /remotion/jobs` 展示。
 */
import { makeCanvasError } from '../error-system.js'

export type RenderJobState = 'queued' | 'rendering' | 'succeeded' | 'failed' | 'cancelled' | 'timedOut'

/** 队列上限：第 5 单直接拒收（不做无限缓冲 —— 缓冲只会把失败推到十分钟后）。 */
export const RENDER_QUEUE_LIMIT = 4
/** 渲染并发上限。 */
export const RENDER_CONCURRENCY = 1
/** 已结算工单的保留条数（供进度接口展示，不参与调度）。 */
export const RENDER_JOB_HISTORY = 16

export interface RenderJobView {
  jobId: string
  projectId: string
  state: RenderJobState
  /** 0–1（客户端上报，节流到 ~3% 一次）。 */
  progress: number
  enqueuedAt: number
  startedAt?: number
  durationInFrames: number
  fps: number
  /** 失败 / 取消 / 超时的简述（仅结算态有）。 */
  error?: string
}

interface RenderQueueEntry extends RenderJobView {
  /** 入队序号（FIFO 判据；`Date.now()` 同毫秒会打平）。 */
  seq: number
}

export interface EnqueueRenderJobInput {
  jobId: string
  projectId: string
  durationInFrames: number
  fps: number
}

const entries = new Map<string, RenderQueueEntry>()
/** 等待派发的 jobId（FIFO）。 */
const waiting: string[] = []
/** 入队方拿到的「已派发」承诺。 */
const dispatchResolvers = new Map<string, () => void>()
let running = 0
let seq = 0

function isSettled(state: RenderJobState): boolean {
  return state !== 'queued' && state !== 'rendering'
}

/** 按 FIFO 取下一单（改优先策略的唯一落点）。 */
function pickNextJobId(): string | null {
  return waiting.length > 0 ? (waiting[0] as string) : null
}

/** 并发有空位就派发。派发是同步的 —— 调用方 `await` 的 Promise 当拍就 resolve。 */
function drain(): void {
  while (running < RENDER_CONCURRENCY) {
    const jobId = pickNextJobId()
    if (jobId === null) return
    const entry = entries.get(jobId)
    if (entry === undefined) {
      waiting.shift()
      continue
    }
    waiting.shift()
    running += 1
    entry.state = 'rendering'
    entry.startedAt = Date.now()
    const resolve = dispatchResolvers.get(jobId)
    dispatchResolvers.delete(jobId)
    if (resolve !== undefined) resolve()
  }
}

/** 结算后裁剪历史（只保留最近 N 条已结算单）。 */
function trimHistory(): void {
  const settled = [...entries.values()].filter((entry) => isSettled(entry.state))
  if (settled.length <= RENDER_JOB_HISTORY) return
  settled
    .sort((a, b) => a.seq - b.seq)
    .slice(0, settled.length - RENDER_JOB_HISTORY)
    .forEach((entry) => entries.delete(entry.jobId))
}

/**
 * 入队并等待派发。返回的 Promise 在**轮到本单渲染**时 resolve。
 *
 * @throws `CS-USER-ERR` 队列已满（`waiting.length >= RENDER_QUEUE_LIMIT`）。
 */
/** 入队结果：`dispatched=true` 表示**当拍就轮到它**（并发有空位）。 */
export interface RenderSlotReservation {
  dispatched: boolean
  /** 被派发时 resolve（已派发则为已 resolve 的 Promise）。 */
  when: Promise<void>
}

/**
 * 预留一个渲染槽位（同步部分：入表 + 排队 + 尝试派发）。
 *
 * 为什么不是纯异步 `await enqueue(...)`：建单必须是**同步可见**的 —— 工具调用刚发出，
 * 客户端同一拍就要能取到工单（既有单测也按这个语义断言）。因此这里把「入表」与
 * 「等待派发」拆开：入表同步完成，等派发由 `when` 表达。
 *
 * @throws `CS-USER-ERR` 队列已满（`waiting.length >= RENDER_QUEUE_LIMIT`）。
 */
export function reserveRenderSlot(input: EnqueueRenderJobInput, signal?: AbortSignal): RenderSlotReservation {
  if (waiting.length >= RENDER_QUEUE_LIMIT) {
    throw makeCanvasError('CS-USER-ERR', {
      message: `渲染队列已满（最多 ${RENDER_QUEUE_LIMIT} 单等待），请等当前任务完成后再试。`,
      detail: `render queue full: waiting=${waiting.length}`,
    })
  }
  const entry: RenderQueueEntry = {
    jobId: input.jobId,
    projectId: input.projectId,
    state: 'queued',
    progress: 0,
    enqueuedAt: Date.now(),
    durationInFrames: input.durationInFrames,
    fps: input.fps,
    seq: seq++,
  }
  entries.set(input.jobId, entry)
  waiting.push(input.jobId)
  const when = new Promise<void>((resolve) => { dispatchResolvers.set(input.jobId, resolve) })
  drain()
  // 排队期间的 abort 也必须能走掉：否则用户点了"停止"，工具调用要排到轮到它才响应。
  if (signal !== undefined) {
    const onAbort = (): void => {
      releaseRenderSlot(input.jobId, 'cancelled', 'render job aborted while queued')
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  return { dispatched: entries.get(input.jobId)?.state === 'rendering', when }
}

/**
 * 结算占用，交给下一单。
 *
 * 排队中被取消的单（`startedAt` 未设）只从等待队列里摘掉，**不**递减并发计数。
 */
export function releaseRenderSlot(jobId: string, state: RenderJobState, error?: string): void {
  const entry = entries.get(jobId)
  if (entry === undefined) return
  const wasRunning = entry.state === 'rendering'
  entry.state = state
  if (state === 'succeeded') entry.progress = 1
  if (error !== undefined) entry.error = error
  if (wasRunning) running = Math.max(0, running - 1)
  else {
    const index = waiting.indexOf(jobId)
    if (index >= 0) waiting.splice(index, 1)
    const resolve = dispatchResolvers.get(jobId)
    dispatchResolvers.delete(jobId)
    if (resolve !== undefined) resolve()
  }
  trimHistory()
  drain()
}

/** 客户端上报进度（节流在客户端做，这里只 clamp）。 */
export function reportRenderProgress(jobId: string, progress: number): boolean {
  const entry = entries.get(jobId)
  if (entry === undefined || entry.state !== 'rendering') return false
  if (!Number.isFinite(progress)) return false
  entry.progress = Math.max(0, Math.min(1, progress))
  return true
}

/** 工单列表（`projectId` 缺省 = 全部），按入队顺序返回。 */
export function listRenderJobs(projectId?: string): RenderJobView[] {
  return [...entries.values()]
    .filter((entry) => projectId === undefined || entry.projectId === projectId)
    .sort((a, b) => a.seq - b.seq)
    .map(({ seq: _seq, ...view }) => view)
}

/** 等待派发的单数（队列深度，不含正在渲染那单）。 */
export function renderQueueDepth(): number {
  return waiting.length
}

/** 正在渲染的单数。 */
export function activeRenderCount(): number {
  return running
}

/** 单测用：清空队列（生产代码不得调用）。 */
export function resetRenderQueueForTests(): void {
  entries.clear()
  waiting.length = 0
  dispatchResolvers.clear()
  running = 0
  seq = 0
}
