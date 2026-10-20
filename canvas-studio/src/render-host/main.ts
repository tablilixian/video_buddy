/**
 * REQ-034 · RenderHost 页面入口（**浏览器侧，只跑在隐藏窗口里**）。
 *
 * O-05 只做到「能自检、能自报 idle」；O-06 起它成为**第二个渲染执行者**：
 *
 *   每 1s 心跳（POST /render-host/status）→ 每 1s 取单（GET /remotion/pending?owner=host）
 *     → `executeRenderJob`（与画布页同一份协议）→ 回写抽帧/成片
 *
 * 三条纪律：
 * 1. **心跳与取单都不碰重依赖**：`@remotion/web-renderer` 只在真取到单时动态 import。
 * 2. **渲染期心跳不能只靠 `setInterval`**：`draft` 档 `pageResponsiveness: 'disabled'`
 *    会把主线程按住几十秒，定时器会抖。所以进度回调里也顺手补一拍（宿主按 1s 合并）。
 * 3. **窗口被关 = 渲染中止**：`pagehide` 时 abort 当前单，让宿主立刻结算而不是等看门狗。
 */

type RenderModule = typeof import('../client/remotion-render.js')
type ExecutorModule = typeof import('../client/render-job-executor.js')
/** 只借类型（`import type` 会被完全擦除，不把 api.ts 拖进启动路径）。 */
type PendingRenderJob = import('../client/api.js').PendingStudioRenderJob

const STATUS_ENDPOINT = '/canvas-studio/render-host/status'
/** 心跳间隔（宿主判失联阈值 30s，见 `render-host/status.ts`）。 */
const HEARTBEAT_MS = 1000
/** 取单间隔。 */
const POLL_MS = 1000
/** 进度回调里补心跳的最小间隔（比心跳周期略短，避免同一拍打两次）。 */
const PROGRESS_BEAT_MS = 800

export type RenderHostState = 'booting' | 'idle' | 'rendering' | 'unsupported' | 'error'

export interface RenderHostSelfCheck {
  webCodecs: boolean
  videoEncoder: boolean
  videoDecoder: boolean
  hardwareConcurrency: number
}

interface RenderHostStatusBody {
  state: RenderHostState
  detail?: string
  selfCheck?: RenderHostSelfCheck
  jobId?: string
}

const stateEl = (): HTMLElement | null => document.getElementById('state')
const detailEl = (): HTMLElement | null => document.getElementById('detail')

let state: RenderHostState = 'booting'
let detail = ''
let currentJobId: string | null = null
let lastBeatAt = 0
let selfCheckResult: RenderHostSelfCheck | undefined

function paint(next: RenderHostState, text: string): void {
  state = next
  detail = text
  const s = stateEl()
  if (s !== null) s.textContent = next
  const d = detailEl()
  if (d !== null) d.textContent = text
}

async function reportStatus(body: RenderHostStatusBody): Promise<void> {
  lastBeatAt = Date.now()
  try {
    await fetch(STATUS_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    // 宿主还没起来 / 正在重启：状态上报失败不影响窗口存活，下一拍会重报。
  }
}

/** 一拍心跳（宿主用它判活；`jobId` 只是观测面）。 */
function beat(): void {
  void reportStatus({
    state,
    ...(detail.length === 0 ? {} : { detail }),
    ...(selfCheckResult === undefined ? {} : { selfCheck: selfCheckResult }),
    ...(currentJobId === null ? {} : { jobId: currentJobId }),
  })
}

/** 一次性自检：真机上「编码器能用吗」决定这条执行者是否可用。 */
export function selfCheck(): RenderHostSelfCheck {
  const scope = globalThis as unknown as {
    VideoEncoder?: unknown
    VideoDecoder?: unknown
    navigator?: { hardwareConcurrency?: number }
  }
  return {
    webCodecs: typeof scope.VideoEncoder === 'function',
    videoEncoder: typeof scope.VideoEncoder === 'function',
    videoDecoder: typeof scope.VideoDecoder === 'function',
    hardwareConcurrency: scope.navigator?.hardwareConcurrency ?? 0,
  }
}

let rendererPromise: Promise<RenderModule> | undefined

/**
 * 重依赖按需加载（S2 派单时调）。
 *
 * 用函数而不是顶层 import：空闲窗口不必为「可能永远不会来的工单」付 3MB 解析 + 几十 MB 堆。
 */
export function loadRenderer(): Promise<RenderModule> {
  rendererPromise ??= import('../client/remotion-render.js')
  return rendererPromise
}

let executorPromise: Promise<ExecutorModule> | undefined

function loadExecutor(): Promise<ExecutorModule> {
  executorPromise ??= import('../client/render-job-executor.js')
  return executorPromise
}

/** 在飞的那一单（`pagehide` 时要 abort）。 */
let inflight: AbortController | null = null

async function runJob(job: PendingRenderJob): Promise<void> {
  const jobId = job.jobId
  currentJobId = jobId
  paint('rendering', `渲染中 · ${jobId}`)
  beat()
  const controller = new AbortController()
  inflight = controller
  try {
    const { executeRenderJob } = await loadExecutor()
    const outcome = await executeRenderJob({
      job,
      signal: controller.signal,
      onProgress: (progress) => {
        // 主线程被编码器按住时定时器会抖 —— 进度回调是**另一条**活着的证据，顺手补心跳。
        const now = Date.now()
        if (now - lastBeatAt >= PROGRESS_BEAT_MS) beat()
        paint('rendering', `渲染中 · ${jobId} · ${Math.round(progress * 100)}%`)
      },
    })
    paint('idle', outcome === 'committed' ? `完成 · ${jobId}` : `收工 · ${jobId}（${outcome}）`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    paint('error', message)
  } finally {
    inflight = null
    currentJobId = null
    beat()
  }
}

let polling = false

async function pollOnce(): Promise<void> {
  if (polling || currentJobId !== null) return
  polling = true
  try {
    const { fetchRenderHostStudioJob } = await import('../client/api.js')
    const job = await fetchRenderHostStudioJob()
    if (job === null) return
    await runJob(job)
  } catch {
    // 取单失败（宿主重启 / 网络抖动）：下一拍再试。轮询本身就是重试。
  } finally {
    polling = false
  }
}

async function boot(): Promise<void> {
  paint('booting', '自检中…')
  const check = selfCheck()
  selfCheckResult = check

  if (!check.webCodecs) {
    paint('unsupported', '本机不支持 WebCodecs，无法承担渲染')
    await reportStatus({ state: 'unsupported', detail: 'no-webcodecs', selfCheck: check })
    return
  }

  paint('idle', `就绪 · WebCodecs 可用 · 并发 ${String(check.hardwareConcurrency)}`)
  await reportStatus({ state: 'idle', selfCheck: check })
  setInterval(beat, HEARTBEAT_MS)
  setInterval(() => { void pollOnce() }, POLL_MS)
  void pollOnce()
}

// 便于宿主/探针在真机上直接驱动，不必再塞一个调试入口。
;(globalThis as unknown as { __csRenderHost?: unknown }).__csRenderHost = {
  boot,
  loadRenderer,
  selfCheck,
  get state() { return state },
  get jobId() { return currentJobId },
}

// 窗口被关 / 页面被卸载：abort 在飞的单，宿主看门狗立刻结算（而不是等 30s）。
globalThis.addEventListener?.('pagehide', () => {
  inflight?.abort()
})

void boot().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  paint('error', message)
  await reportStatus({ state: 'error', detail: message })
})
