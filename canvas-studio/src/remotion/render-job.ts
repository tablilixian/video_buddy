/**
 * REQ-034（Remotion 集成）· B3 route B 渲染工单桥（宿主半，**无浏览器**）。
 *
 * 技术事实源 = 仓根 `remotion-integration-devdoc-2026-10-14.md` §6.3（v1.5）。
 *
 * 路线 B（CSR）下真正的渲染发生在 Electron 渲染进程（`@remotion/web-renderer`），
 * 宿主拿不到 `<canvas>` / `VideoEncoder`；于是走一条**工单桥**：
 *
 *   工具 `render_composition`
 *     └─ 宿主 `runRenderJob`：建单（内存表）+ 挂超时 + 等结算
 *          └─ 客户端 `pollRemotionQueue`（GET /remotion/pending）取单 + CSR 渲染
 *               └─ 客户端回写（POST /remotion/commit 传字节 / cancel 传失败原因）
 *     └─ 宿主 `commitRenderJob`：落盘 `saveLocalAssetBytes` + `probeMediaInfo` 探真值 → 结算
 *
 * 工单**不落文件**：Host 半与路由同进程，模块级 `Map` 即单例（devdoc §6.3 注允许，
 * 且比文件式更易测）。新增 CV-xxx。
 */
import { join } from 'node:path'
import { newAssetId } from '../config.js'
import { makeCanvasError } from '../error-system.js'
import { probeMediaInfo } from '../ffmpeg-run.js'
import { saveLocalAssetBytes } from '../generate.js'
import type { ProjectRegistry } from '../projects.js'
import '../errors/catalog.js'
import type { CompositionManifest, RenderQuality } from './manifest.js'
import {
  listRenderJobs,
  reportRenderProgress,
  reserveRenderSlot,
  releaseRenderSlot,
  type RenderJobView,
} from './render-queue.js'
import { hasRenderHostLauncher, warmRenderHost } from '../render-host/dispatch.js'
import { RENDER_HOST_STALE_MS, renderHostHealth, renderHostReady } from '../render-host/status.js'
import { pickSampleFrames, renderTimeoutMs } from './timing.js'

/**
 * 工单超时**下限**（毫秒）。
 *
 * 二期 1b 起不再是固定值：真实超时 = `renderTimeoutMs(帧数)`
 * （`clamp(帧数 × 200ms + 60s, 90s, 20min)`，见 `timing.ts`；REQ-034 O-06 改口径）。
 * 保留这个常量是因为它仍是下限，且外部（测试 / 文档）按「一分钟半量级」理解这条工单。
 */
export const RENDER_JOB_TIMEOUT_MS = 90_000

/**
 * 这张单由谁来渲染（**建单时定；唯一的例外见 `claimRenderJobFor` 的滞留改派**）。
 *
 * - `render-host`：隐藏窗口（`src/render-host/`）。页面被遮挡/最小化/切会话都照跑。
 * - `client`：用户画布页（三期之前的老路径）。页面不可见 ⇒ rAF 停摆 ⇒ 挂到超时。
 *
 * 为什么要在建单时钉死而不是每拍现算：现算会让「窗口在第 3 秒死掉」的单在下一拍
 * 被客户端接走，而客户端只能**从头**渲一遍 —— 用户看到进度条回到 0，且上一单的抽帧
 * 已经落了一半。钉死 + 心跳看门狗（失联即结算失败）语义更诚实：要么渲完，要么明确报错。
 *
 * ⚠️ 2026-10-23 例外（滞留改派）：真机实测「冷启窗口 3s 内没就绪 ⇒ 单钉给 client，
 * 而画布页取单链路死了（页面没开 / 项目没选中 / 轮询早停）」时，这张单**没人认领**，
 * 白等到 `CS-RENDER-TIMEOUT`（10-20 起 11 连败的签名）。故 `client` 单若在宽限期内
 * 连客户端看都没看过一眼（从未被 claim），允许隐藏窗口在就绪后**接管**——它从头渲，
 * 与「页面中途切走导致重渲」的代价一致，而收益是把必然超时变成必然成功。
 */
export type RenderExecutor = 'render-host' | 'client'

/** 客户端轮询看到的工单视图（不含宿主内部结算 handle）。 */
export interface PendingRenderJob {
  jobId: string
  projectId: string
  /** 校正后的 Manifest（宿主已派生音频构成 / 校正视频时长）。 */
  manifest: CompositionManifest
  fps: number
  /** 三期 W5-3：质量档（客户端据此选编码参数，并决定是否跳过预览闸门）。 */
  quality: RenderQuality
  /**
   * 三期 W5-4：宿主 ffprobe 已探到的真值时长（`src → 秒`）。
   * 客户端**直接复用**，不再自己探一遍（原来 10 段素材要白等 1.5–8s）。
   */
  realDurations: Record<string, number>
  /** 三期 W6-1：建议抽帧位置（绝对帧号）。 */
  sampleFrames: number[]
}

/** 三期 W6-2：渲染报告（宿主侧形状，字段与客户端 `RenderMetrics` 对齐）。 */
export interface RenderJobReport {
  quality: RenderQuality
  frames: number
  totalMs: number
  msPerFrame: number
  encodeMs: number
  bytes: number
  bitrateKbps: number
  width: number
  height: number
  sampledFrames: number
  warm: boolean
}

/** 三期 W6-1：一张抽帧（已落盘的同源 URL）。 */
export interface RenderSampleResult {
  frame: number
  url: string
}

/** `runRenderJob` 结算产物（宿主已落盘并探测真值）。 */
export interface RenderJobOutcome {
  /** 同源资产 URL（`/canvas-studio/assets/<projectId>/<file>`）。 */
  url: string
  /** 落盘文件名（`assetFile`）。 */
  assetFile: string
  /** 成片真值时长（秒）；未探到为 `0`。 */
  duration: number
  width?: number
  height?: number
  /** 渲染期告警（客户端上报的字体降级 / 编码降级 + 宿主探测告警）。 */
  warnings: string[]
  /** 三期 W5-3：本次质量档。 */
  quality: RenderQuality
  /** 三期 W6-1：抽帧（可为空）。 */
  frames: RenderSampleResult[]
  /** 三期 W6-2：渲染报告。 */
  report: RenderJobReport
}

/** 建单参数。 */
export interface RunRenderJobOptions {
  projectId: string
  manifest: CompositionManifest
  /** 渲染帧率（缺省取 `manifest.meta.fps`）。 */
  fps?: number
  /** 超时（毫秒）；缺省 `renderTimeoutMs(帧数)`。测试注入短值。 */
  timeoutMs?: number
  signal?: AbortSignal
  /** 三期 W5-3：质量档（缺省 `standard`）。 */
  quality?: RenderQuality
  /** 三期 W5-4：宿主探测到的素材真值时长（透传给客户端，免二次探测）。 */
  realDurations?: Record<string, number>
  /** 三期 W6-1：抽帧位置（缺省由客户端按 4 张 + 转场中点自选）。 */
  sampleFrames?: number[]
  /** O-06：强制指定执行者（测试 / 排障用；缺省按 RenderHost 是否就绪自动选）。 */
  executor?: RenderExecutor
  /** O-06：等隐藏窗口自报就绪的上限（缺省 3s）。只影响冷启首单。 */
  hostWarmupMs?: number
  /** O-06：心跳判失联阈值（缺省 `RENDER_HOST_STALE_MS`）。测试注入短值。 */
  heartbeatStaleMs?: number
}

/** 客户端回写内容。 */
export interface CommitRenderInput {
  /** 客户端渲染出的 mp4 字节。 */
  bytes: Uint8Array
  /** 客户端上报的渲染期告警。 */
  warnings?: readonly string[]
  /** 三期 W6-2：客户端渲染报告（缺省用宿主侧兜底值）。 */
  report?: Partial<RenderJobReport>
}

/** 回写响应（也作为路由 200 体）。 */
export interface CommitRenderResult {
  ok: true
  url: string
  assetFile: string
  duration: number
  width?: number
  height?: number
}

interface ActiveRenderJob {
  jobId: string
  projectId: string
  manifest: CompositionManifest
  fps: number
  /** 三期 W5-3：质量档。 */
  quality: RenderQuality
  /** 三期 W5-4：宿主已探到的素材真值（透传客户端）。 */
  realDurations: Record<string, number>
  /** 三期 W6-1：建议抽帧位置。 */
  sampleFrames: number[]
  /** 三期 W6-1：已回写的抽帧。 */
  samples: RenderSampleResult[]
  /** O-06：这张单归谁渲（建单时定）。 */
  executor: RenderExecutor
  /** O-06：最近一次进度上报（心跳看门狗把它也算作「活着」的证据）。 */
  lastProgressAt: number
  /** O-06：宿主心跳看门狗（只在 `render-host` 单派发后存在）。 */
  watchdog: ReturnType<typeof setInterval> | null
  resolve: (outcome: RenderJobOutcome) => void
  reject: (cause: unknown) => void
  timer: ReturnType<typeof setTimeout>
  signal?: AbortSignal
  onAbort?: () => void
  settled: boolean
  /** 二期 1b：是否已获得渲染槽位（排队中为 `false`，客户端暂时看不到这张单）。 */
  dispatched: boolean
  /** 滞留改派：获得槽位的时刻（`armTimeout` 恰在派发时跑一次）。 */
  dispatchedAt?: number
  /** 滞留改派：画布页第一次 claim 到这张单的时刻；从未被看过为 `undefined`。 */
  clientClaimedAt?: number
  /** 滞留改派：被隐藏窗口接管的时刻（观测用）。 */
  takenOverAt?: number
  /** O-06：本单生效的心跳判失联阈值（建单时算好，改派后看门狗复用同一值）。 */
  heartbeatStaleMs: number
}

/** 进程内工单表（Host 半与路由同模块单例）。 */
const activeJobs = new Map<string, ActiveRenderJob>()

/**
 * 取一张**归本执行者渲染**的工单（`GET /remotion/pending` 的唯一实现）。
 *
 * `owner` 是请求方：隐藏窗口传 `render-host`，用户画布页传 `client`。
 * 归谁在建单时已定（见 `RenderExecutor` 的注释），这里只是按归属过滤 ——
 * **不在这里做「先到先得」的抢占**，否则两条 1s 轮询会互相偷单。
 *
 * @param projectId `null` = 任意项目（只有 RenderHost 这么用：它不绑定画布页）
 */
export function claimRenderJobFor(
  projectId: string | null,
  owner: RenderExecutor,
  options: ClaimRenderJobOptions = {},
): PendingRenderJob | null {
  const now = options.now ?? Date.now()
  for (const job of activeJobs.values()) {
    if (job.projectId !== projectId && projectId !== null) continue
    if (!job.dispatched) continue
    if (job.executor !== owner) continue
    // 滞留改派的判据打点：画布页「看过」这张单的第一拍。只记第一次即可，
    // 轮询每秒都会再来，重复打点无害。
    if (owner === 'client' && job.clientClaimedAt === undefined) job.clientClaimedAt = now
    return {
      jobId: job.jobId,
      projectId: job.projectId,
      manifest: job.manifest,
      fps: job.fps,
      quality: job.quality,
      realDurations: job.realDurations,
      sampleFrames: job.sampleFrames,
    }
  }
  if (owner === 'render-host') {
    // 滞留改派（2026-10-23，O-06 真机翻车的兜底）：隐藏窗口取单扑空时，若存在
    // 「已派发、宽限期内画布页从未 claim 过」的 client 单且窗口健康，把它改派给
    // 窗口。判据保证双端不会同时渲同一张单：客户端看过一眼就永不改派。
    const takeover = takeoverOrphanedClientJob(now, options.graceMs ?? RENDER_HOST_TAKEOVER_GRACE_MS, options.onTakeover)
    if (takeover !== null) {
      return {
        jobId: takeover.jobId,
        projectId: takeover.projectId,
        manifest: takeover.manifest,
        fps: takeover.fps,
        quality: takeover.quality,
        realDurations: takeover.realDurations,
        sampleFrames: takeover.sampleFrames,
      }
    }
  }
  return null
}

/**
 * 滞留改派宽限期（毫秒）：`client` 单派发后这么久仍**从未被画布页 claim 过**，
 * 隐藏窗口取单时可以接管。
 *
 * 为什么是 15s：健康的画布页每 1s 一拍、取到单立刻开渲，宽限期只要盖过几拍
 * 轮询就够（「工具调用 → 宿主建单」的校验/素材探测延迟发生在派发**前**，不占
 * 这段）。太短会和「客户端正在路上」的正常竞态抢单，太长则把用户白等的超时
 * 又拉长一截。
 */
export const RENDER_HOST_TAKEOVER_GRACE_MS = 15_000

/** 滞留改派的可调参数（`claimRenderJobFor` 第三参；生产路径不传）。 */
export interface ClaimRenderJobOptions {
  /** 现在时刻（测试注入假时钟）。 */
  now?: number
  /** 宽限期（缺省 `RENDER_HOST_TAKEOVER_GRACE_MS`）。 */
  graceMs?: number
  /** 发生改派时的通知（路由层拿去打日志，排障用）。 */
  onTakeover?: (jobId: string) => void
}

/**
 * 滞留改派：找最老一张「client 单但画布页从没认领过」的工单，转给隐藏窗口。
 *
 * 只转**一张**：隐藏窗口的取单是 1s 一拍的轮询，并发又是 1 —— 一拍接一单，
 * 剩下的下一拍自然轮到（FIFO 由 Map 插入序保证，与队列口径一致）。
 *
 * @returns 被改派的工单；没有合格候选时返回 `null`（调用方照旧返回无单）。
 */
function takeoverOrphanedClientJob(
  now: number,
  graceMs: number,
  onTakeover: ((jobId: string) => void) | undefined,
): ActiveRenderJob | null {
  // 窗口必须健康才配接管：这条 claim 也可能来自 curl（排障手工取单），
  // 没有一个活着的窗口就不该把单从「可能只是慢」的客户端手里抢走。
  if (!renderHostReady(now)) return null
  for (const job of activeJobs.values()) {
    if (job.executor !== 'client' || job.settled || !job.dispatched) continue
    if (job.clientClaimedAt !== undefined) continue
    // 派发时刻未知按「刚派发」处理：宁可少改派，不多抢。
    const dispatchedAt = job.dispatchedAt ?? now
    if (now - dispatchedAt < graceMs) continue
    job.executor = 'render-host'
    job.takenOverAt = now
    // 看门狗在 armTimeout 只给建单时就归窗口的单装；改派单要在这里补装，
    // 否则窗口渲到一半死掉，这张单要干等原始超时而不是 30s 内结算。
    armHostWatchdog(job, job.heartbeatStaleMs)
    onTakeover?.(job.jobId)
    return job
  }
  return null
}

/**
 * 向后兼容的旧入口（等价于「以客户端身份取单」）。
 *
 * ⚠️ 在 RenderHost 就绪时，属于隐藏窗口的单这里会返回 `null` —— 这正是 O-06 要的：
 * 客户端不该看见别人（别的执行者）的单。
 */
export function pendingRenderJobFor(projectId: string): PendingRenderJob | null {
  return claimRenderJobFor(projectId, 'client')
}

/** 测试 / 诊断用：当前活跃工单数（含排队中的）。 */
export function activeRenderJobCount(): number {
  return activeJobs.size
}

/** 测试 / 诊断用：仍在排队（未获槽位）的工单数。 */
export function queuedRenderJobCount(): number {
  let count = 0
  for (const job of activeJobs.values()) if (!job.dispatched) count += 1
  return count
}

/** 进度接口的数据源（`GET /remotion/jobs`）。 */
export function listRenderJobViews(projectId?: string): RenderJobView[] {
  return listRenderJobs(projectId)
}

/** 客户端上报渲染进度（0–1）；单不存在 / 未在渲染返回 `false`。 */
export function reportRenderJobProgress(jobId: string, progress: number): boolean {
  const applied = reportRenderProgress(jobId, progress)
  // O-06：进度也是「页面还活着」的证据 —— 看门狗用它兜住「主线程被编码器按住」的窗口。
  if (applied) {
    const job = activeJobs.get(jobId)
    if (job !== undefined) job.lastProgressAt = Date.now()
  }
  return applied
}

function settleAndForget(job: ActiveRenderJob, state: 'succeeded' | 'failed' | 'cancelled' | 'timedOut', error?: string): void {
  clearTimeout(job.timer)
  if (job.watchdog !== null) {
    clearInterval(job.watchdog)
    job.watchdog = null
  }
  if (job.onAbort !== undefined) job.signal?.removeEventListener('abort', job.onAbort)
  activeJobs.delete(job.jobId)
  releaseRenderSlot(job.jobId, state, error)
}

/** 冷启探测间隔（毫秒）。 */
const EXECUTOR_PROBE_MS = 100

/**
 * 建单时决定这张单归谁渲（见 `RenderExecutor` 的注释）。
 *
 * ⚠️ 这个函数**必须只在真正需要等的时候才 await**：`runRenderJob` 在它之前建单，
 * 一旦无条件 `await`，调用方「起单 → 立刻取单」的一拍就会拿到 `null`
 *（工单表还是空的）—— 老测试与老客户端都是这么用的。所以这里先算能**同步**定的
 * 两种情况，只有「有拉起器但窗口还在起」才真去等。
 */
function immediateExecutor(options: RunRenderJobOptions): RenderExecutor | undefined {
  if (options.executor !== undefined) return options.executor
  // 没有拉起器（纯 CLI 宿主 / 单测）⇒ 没有窗口可言，直接客户端，零等待。
  if (!hasRenderHostLauncher()) return 'client'
  // 窗口已自报就绪 ⇒ 同步归它。
  if (renderHostReady()) return 'render-host'
  return undefined
}

/**
 * 冷启等待：窗口存在但还没自报就绪（新建约 1s）。
 *
 * 为什么值得等这 3 秒：首单如果甩给画布页，而用户此时切走了，就正好复现本次要修的
 * 那个挂死。3s 换「首单也走隐藏窗口」是划算的；等不到则老实回退客户端。
 */
async function pickExecutor(options: RunRenderJobOptions): Promise<RenderExecutor> {
  warmRenderHost()
  const budget = Math.max(0, options.hostWarmupMs ?? 3000)
  if (budget === 0) return 'client'
  const deadline = Date.now() + budget
  while (Date.now() < deadline) {
    if (options.signal?.aborted === true) return 'client'
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, EXECUTOR_PROBE_MS)
      ;(timer as unknown as { unref?: () => void }).unref?.()
    })
    if (renderHostReady()) return 'render-host'
  }
  return 'client'
}

/**
 * 心跳看门狗：`render-host` 单派发后开始盯着。
 *
 * 判据 = 「距最近一次生命迹象」> 阈值，生命迹象取两者**较新**的一个：
 * ① 页面自报（`POST /render-host/status`，每 1s）；
 * ② 进度上报（渲染循环里的 `onProgress`，`draft` 档冻结主线程时**只有它还会到**）。
 *
 * 只看①会误杀：`pageResponsiveness: 'disabled'` 会把主线程按住几十秒。
 * 两个都不来 ⇒ 页面真死了（或被系统挂起），此时**必须**结算，否则工具调用干等到超时。
 */
function armHostWatchdog(job: ActiveRenderJob, staleMs: number): void {
  if (job.watchdog !== null) return
  const timer = setInterval(() => {
    if (job.settled) return
    const now = Date.now()
    const silentFor = Math.min(renderHostHealth(now).ageMs, now - job.lastProgressAt)
    if (silentFor <= staleMs) return
    job.settled = true
    settleAndForget(job, 'failed', `render host silent for ${Math.round(silentFor / 1000)}s`)
    job.reject(makeCanvasError('CS-RENDER-002', {
      message: '渲染窗口异常，已中止本次渲染。请重试。',
      detail: `render host heartbeat lost for ${Math.round(silentFor / 1000)}s`,
    }))
  }, Math.max(200, Math.min(1000, Math.floor(staleMs / 4))))
  ;(timer as unknown as { unref?: () => void }).unref?.()
  job.watchdog = timer
}

/**
 * 渲染窗口没了（renderer 崩溃 / 无响应 / 窗口被关）：立刻结算**所有**归它的单。
 *
 * 比等看门狗早 30 秒 —— 用户看到的是「立即报错重试」而不是半分钟的空转。
 * @returns 被结算的工单数（0 = 当时没有在飞的隐藏窗口单，调用方不必打日志）
 */
export function failRenderHostJobs(reason: string): number {
  let count = 0
  for (const job of [...activeJobs.values()]) {
    if (job.executor !== 'render-host' || job.settled) continue
    job.settled = true
    settleAndForget(job, 'failed', reason)
    job.reject(makeCanvasError('CS-RENDER-002', {
      message: '渲染窗口异常，已中止本次渲染。请重试。',
      detail: reason,
    }))
    count += 1
  }
  return count
}

/** 测试 / 诊断用：当前归隐藏窗口渲染的单数（含排队中的）。 */
export function renderHostJobCount(): number {
  let count = 0
  for (const job of activeJobs.values()) if (job.executor === 'render-host') count += 1
  return count
}

/**
 * 建单并等待客户端结算。
 *
 * 结算三条路：`commitRenderJob`（成功）/ `cancelRenderJob`（失败或撤单）/ 超时（本函数）。
 * abort（用户打断本轮）与超时都**不** `CS-GEN-207` 之外的特殊处理：abort 收敛到
 * `CS-GEN-207`（客户端据此移除占位节点，取消不是故障）。
 */
export async function runRenderJob(options: RunRenderJobOptions): Promise<RenderJobOutcome> {
  const { projectId, manifest } = options
  const fps = options.fps ?? manifest.meta.fps
  // 二期 1b（D-04）：超时按片长自适应；REQ-034 O-06 改按帧数。
  const timeoutMs = options.timeoutMs ?? renderTimeoutMs(manifest.meta.durationInFrames)
  const { signal } = options
  if (signal?.aborted === true) {
    throw makeCanvasError('CS-GEN-207', { detail: 'render job aborted before start' })
  }
  // O-06：先定执行者（可能要等窗口冷启），再建单 —— 等待不该算进渲染预算。
  const fastExecutor = immediateExecutor(options)
  const executor = fastExecutor ?? await pickExecutor(options)
  const heartbeatStaleMs = Math.max(50, options.heartbeatStaleMs ?? RENDER_HOST_STALE_MS)
  const jobId = `rj-${newAssetId()}`
  // 入队 + 尝试派发（同步入表 ⇒ 客户端当拍可见；并发 = 1 ⇒ 第二单要等前一单结算）。
  const slot = reserveRenderSlot(
    { jobId, projectId, durationInFrames: manifest.meta.durationInFrames, fps },
    signal,
  )
  return await new Promise<RenderJobOutcome>((resolve, reject) => {
    const job: ActiveRenderJob = {
      jobId,
      projectId,
      manifest,
      fps,
      quality: options.quality ?? manifest.meta.quality ?? 'standard',
      realDurations: options.realDurations ?? {},
      sampleFrames: options.sampleFrames ?? pickSampleFrames(manifest),
      samples: [],
      executor,
      lastProgressAt: Date.now(),
      watchdog: null,
      resolve,
      reject,
      timer: setTimeout(() => {}, 0),
      settled: false,
      dispatched: slot.dispatched,
      heartbeatStaleMs,
      ...(signal !== undefined ? { signal } : {}),
    }
    activeJobs.set(jobId, job)
    const armTimeout = (): void => {
      if (job.settled) return
      // 滞留改派以本时刻为宽限起点（armTimeout 恰在「获得槽位」时跑一次）。
      job.dispatchedAt = Date.now()
      if (job.executor === 'render-host') armHostWatchdog(job, heartbeatStaleMs)
      job.timer = setTimeout(() => {
        if (job.settled) return
        job.settled = true
        settleAndForget(job, 'timedOut', `timeout after ${timeoutMs}ms`)
        reject(makeCanvasError('CS-RENDER-TIMEOUT', { seconds: Math.round(timeoutMs / 1000) }))
      }, timeoutMs)
    }
    if (slot.dispatched) {
      armTimeout()
    } else {
      // 排队中：**超时从派发时刻起算**（等队列的时间不该算进渲染预算）。
      void slot.when.then(() => {
        if (job.settled) return
        job.dispatched = true
        armTimeout()
      })
    }
    if (signal !== undefined) {
      job.onAbort = () => {
        if (job.settled) return
        job.settled = true
        settleAndForget(job, 'cancelled', 'render job aborted by user')
        reject(makeCanvasError('CS-GEN-207', { detail: 'render job aborted by user' }))
      }
      signal.addEventListener('abort', job.onAbort, { once: true })
      // abort 发生在入队阶段（`reserveRenderSlot` 内部已按取消处理）⇒ 直接结算，不再等槽位。
      if (signal.aborted) {
        job.settled = true
        settleAndForget(job, 'cancelled', 'render job aborted before start')
        reject(makeCanvasError('CS-GEN-207', { detail: 'render job aborted before start' }))
      }
    }
  })
}

/**
 * 三期 W6-1：客户端回写一张抽帧（PNG 字节 → 项目资产目录）。
 *
 * @returns 落盘后的同源 URL；工单不存在 / 已结算返回 `null`（路由据此回 200 幂等）。
 */
export async function recordRenderSample(
  registry: ProjectRegistry,
  jobId: string,
  frame: number,
  png: Uint8Array,
): Promise<RenderSampleResult | null> {
  const job = activeJobs.get(jobId)
  if (job === undefined || job.settled || png.length === 0) return null
  const safeFrame = Number.isFinite(frame) ? Math.max(0, Math.round(frame)) : 0
  // ⚠️ `saveLocalAssetBytes` 只按**扩展名**分类，落盘名由它自己生成（`<assetId>.png`）——
  // 这里传的 name 不进文件名。帧号的真值在 `job.samples` / 结算产物的 `frames[].frame` 里，
  // **不要**让任何调用方依赖文件名里的帧号（会静默对不上）。
  const saved = await saveLocalAssetBytes(
    registry,
    job.projectId,
    `remotion-sample-${newAssetId()}.png`,
    png,
  )
  const sample: RenderSampleResult = { frame: safeFrame, url: saved.url }
  job.samples.push(sample)
  return sample
}

/**
 * 客户端回写成片字节：落盘（`saveLocalAssetBytes`，不 promote）+ 探测真值 + 结算。
 *
 * 探测失败（`duration: 0`）只加告警，不阻断——与 `compose_video` 对探测的宽容口径一致。
 */
export async function commitRenderJob(
  registry: ProjectRegistry,
  jobId: string,
  input: CommitRenderInput,
): Promise<CommitRenderResult> {
  const job = activeJobs.get(jobId)
  if (job === undefined || job.settled) {
    throw makeCanvasError('CS-RENDER-002', {
      message: '渲染工单不存在或已结束（可能已超时 / 被取消）。',
      detail: `unknown jobId ${jobId}`,
    })
  }
  if (input.bytes.length === 0) {
    throw makeCanvasError('CS-USER-ERR', { message: '渲染产物为空，请重试。', detail: 'empty render bytes' })
  }
  const saved = await saveLocalAssetBytes(registry, job.projectId, `remotion-${newAssetId()}.mp4`, input.bytes)
  const info = await probeMediaInfo(join(registry.assetsDir(job.projectId), saved.assetFile))
  const warnings = [...(input.warnings ?? [])]
  if (info.duration <= 0) warnings.push('未能探测成片真实时长（ffprobe 不可用或产物不可识别）。')

  job.settled = true
  settleAndForget(job, 'succeeded')
  const frames = [...job.samples].sort((a, b) => a.frame - b.frame)
  const report: RenderJobReport = {
    // 宿主侧已知的字段（质量档 / 帧数 / 真实字节数 / 真实分辨率）优先；
    // 客户端上报的耗时与码率只填宿主测不到的项。
    quality: job.quality,
    frames: Math.max(1, Math.round(job.manifest.meta.durationInFrames)),
    totalMs: input.report?.totalMs ?? 0,
    msPerFrame: input.report?.msPerFrame ?? 0,
    encodeMs: input.report?.encodeMs ?? 0,
    bytes: input.bytes.length,
    bitrateKbps: input.report?.bitrateKbps ?? 0,
    width: info.width ?? input.report?.width ?? 0,
    height: info.height ?? input.report?.height ?? 0,
    sampledFrames: frames.length,
    warm: input.report?.warm ?? false,
  }
  const outcome: RenderJobOutcome = {
    url: saved.url,
    assetFile: saved.assetFile,
    duration: info.duration,
    warnings,
    quality: job.quality,
    frames,
    report,
    ...(info.width !== undefined ? { width: info.width } : {}),
    ...(info.height !== undefined ? { height: info.height } : {}),
  }
  job.resolve(outcome)
  return {
    ok: true,
    url: saved.url,
    assetFile: saved.assetFile,
    duration: info.duration,
    ...(info.width !== undefined ? { width: info.width } : {}),
    ...(info.height !== undefined ? { height: info.height } : {}),
  }
}

/** 客户端撤单参数。 */
export interface CancelRenderInput {
  /** `failed: true` = 客户端渲染失败（带原因）；否则视为主动撤单（无原因）。 */
  failed?: boolean
  /** 失败原因 / 取消说明（透传到错误文案与 dev 详情）。 */
  reason?: string
}

/**
 * 客户端撤单：渲染失败（`CS-RENDER-002`）或主动取消（`CS-GEN-207`）。
 *
 * @returns 命中并结算返回 `true`；工单不存在 / 已结算返回 `false`（路由据此回 200 幂等）。
 */
export function cancelRenderJob(jobId: string, input: CancelRenderInput = {}): boolean {
  const job = activeJobs.get(jobId)
  if (job === undefined || job.settled) return false
  job.settled = true
  settleAndForget(
    job,
    input.failed === true ? 'failed' : 'cancelled',
    input.reason ?? (input.failed === true ? 'client render failed' : 'render job cancelled by client'),
  )
  if (input.failed === true) {
    job.reject(makeCanvasError('CS-RENDER-002', {
      message: input.reason ?? '客户端渲染失败，请重试。',
      detail: input.reason ?? 'client render failed',
    }))
  } else {
    job.reject(makeCanvasError('CS-GEN-207', { detail: input.reason ?? 'render job cancelled by client' }))
  }
  return true
}
