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
import type { CompositionManifest } from './manifest.js'
import {
  listRenderJobs,
  reportRenderProgress,
  reserveRenderSlot,
  releaseRenderSlot,
  type RenderJobView,
} from './render-queue.js'
import { renderTimeoutMs } from './timing.js'

/**
 * 工单超时**下限**（毫秒）。
 *
 * 二期 1b 起不再是固定值：真实超时 = `renderTimeoutMs(片长, fps)`
 * （`clamp(2 × 片长 + 120s, 10min, 30min)`，见 `timing.ts`）。保留这个常量是因为
 * 它仍是下限，且外部（测试 / 文档）按「十分钟量级」理解这条工单。
 */
export const RENDER_JOB_TIMEOUT_MS = 10 * 60_000

/** 客户端轮询看到的工单视图（不含宿主内部结算 handle）。 */
export interface PendingRenderJob {
  jobId: string
  projectId: string
  /** 校正后的 Manifest（宿主已派生音频构成 / 校正视频时长）。 */
  manifest: CompositionManifest
  fps: number
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
}

/** 建单参数。 */
export interface RunRenderJobOptions {
  projectId: string
  manifest: CompositionManifest
  /** 渲染帧率（缺省取 `manifest.meta.fps`）。 */
  fps?: number
  /** 超时（毫秒）；缺省 `RENDER_JOB_TIMEOUT_MS`。测试注入短值。 */
  timeoutMs?: number
  signal?: AbortSignal
}

/** 客户端回写内容。 */
export interface CommitRenderInput {
  /** 客户端渲染出的 mp4 字节。 */
  bytes: Uint8Array
  /** 客户端上报的渲染期告警。 */
  warnings?: readonly string[]
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
  resolve: (outcome: RenderJobOutcome) => void
  reject: (cause: unknown) => void
  timer: ReturnType<typeof setTimeout>
  signal?: AbortSignal
  onAbort?: () => void
  settled: boolean
  /** 二期 1b：是否已获得渲染槽位（排队中为 `false`，客户端暂时看不到这张单）。 */
  dispatched: boolean
}

/** 进程内工单表（Host 半与路由同模块单例）。 */
const activeJobs = new Map<string, ActiveRenderJob>()

/**
 * 每个项目的**可渲染**工单（二期 1b：只返回已获得槽位的那张）。
 *
 * 排队中的单不暴露给客户端 —— 否则队列就只是装饰：客户端会立刻开渲，并发又回到 N。
 */
export function pendingRenderJobFor(projectId: string): PendingRenderJob | null {
  for (const job of activeJobs.values()) {
    if (job.projectId !== projectId) continue
    if (!job.dispatched) continue
    return { jobId: job.jobId, projectId: job.projectId, manifest: job.manifest, fps: job.fps }
  }
  return null
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
  return reportRenderProgress(jobId, progress)
}

function settleAndForget(job: ActiveRenderJob, state: 'succeeded' | 'failed' | 'cancelled' | 'timedOut', error?: string): void {
  clearTimeout(job.timer)
  if (job.onAbort !== undefined) job.signal?.removeEventListener('abort', job.onAbort)
  activeJobs.delete(job.jobId)
  releaseRenderSlot(job.jobId, state, error)
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
  // 二期 1b（D-04）：超时按片长自适应，不再固定 10 分钟。
  const timeoutMs = options.timeoutMs ?? renderTimeoutMs(manifest.meta.durationInFrames, fps)
  const { signal } = options
  if (signal?.aborted === true) {
    throw makeCanvasError('CS-GEN-207', { detail: 'render job aborted before start' })
  }
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
      resolve,
      reject,
      timer: setTimeout(() => {}, 0),
      settled: false,
      dispatched: slot.dispatched,
      ...(signal !== undefined ? { signal } : {}),
    }
    activeJobs.set(jobId, job)
    const armTimeout = (): void => {
      if (job.settled) return
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
  const outcome: RenderJobOutcome = {
    url: saved.url,
    assetFile: saved.assetFile,
    duration: info.duration,
    warnings,
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
