/**
 * REQ-034 · O-06 工单执行器（**浏览器侧，两个执行者共用**）。
 *
 * 「取到一张单之后干什么」这件事只有一种正确顺序：
 *   渲染（带分类重试）→ 逐张回写抽帧 → 回写成片+报告 → 失败则撤单。
 * 三期之前它内联在画布页的轮询循环里（`client/index.ts`）；O-06 多了第二个执行者
 * （隐藏窗口 `render-host/main.ts`），如果再抄一份，两边就会各自漂移 ——
 * 最典型的是「抽帧先传还是成片先传」这种顺序，错了只是少几张图，很难发现。
 *
 * 因此这里只抽**协议**，不抽策略：
 * - 画布页仍然自己决定「渲染前弹不弹预览」「进度写不写 store」；
 * - 隐藏窗口没有 UI，直接调本模块即可。
 *
 * 副作用全部可注入（`transport` / `render`）：单测不需要浏览器、不需要编码器。
 */
import type { CompositionManifest } from '../remotion/manifest.js'
import {
  cancelStudioRenderJob,
  commitStudioRenderJob,
  reportStudioRenderProgress,
  uploadStudioRenderSample,
  type PendingStudioRenderJob,
  type StudioRenderReport,
} from './api.js'
import type { RenderedManifest, RenderMetrics } from './remotion-render.js'

/** 一次工单执行的结果（三个终态，恰好覆盖宿主侧的三种结算）。 */
export type RenderJobExecution = 'committed' | 'aborted' | 'failed'

/** 回写通道（默认实现走 `api.ts` 的同源 fetch；单测注入假实现）。 */
export interface RenderJobTransport {
  reportProgress(jobId: string, progress: number): Promise<void>
  uploadSample(jobId: string, frame: number, png: Uint8Array): Promise<string | null>
  commit(jobId: string, bytes: Uint8Array, warnings: readonly string[], report: StudioRenderReport): Promise<void>
  cancel(jobId: string, failed: boolean, reason?: string): Promise<void>
}

export const defaultRenderTransport: RenderJobTransport = {
  reportProgress: (jobId, progress) => reportStudioRenderProgress(jobId, progress),
  uploadSample: (jobId, frame, png) => uploadStudioRenderSample(jobId, frame, png),
  commit: (jobId, bytes, warnings, report) => commitStudioRenderJob(jobId, bytes, warnings, report),
  cancel: (jobId, failed, reason) => cancelStudioRenderJob(jobId, failed, reason),
}

/** 进度上报的台阶数（3% 一档）—— 每帧一发会把本机回环打满。 */
const PROGRESS_STEPS = 33

export interface ExecuteRenderJobOptions {
  job: PendingStudioRenderJob
  signal: AbortSignal
  /** 本地进度回调（画布页写 store / 隐藏窗口写自报状态）；宿主上报由本模块节流后统一做。 */
  onProgress?: (progress: number) => void
  transport?: RenderJobTransport
  /**
   * 渲染实现注入（测试用）。缺省**动态** import `./remotion-render.js` ——
   * 那个模块顶层把 `@remotion/web-renderer` 与 `mediabunny` 拉进来，静态 import
   * 会让空闲窗口白付几十 MB 堆（O-05 的设计前提）。
   */
  render?: (
    manifest: CompositionManifest,
    options: {
      signal: AbortSignal
      quality: PendingStudioRenderJob['quality']
      realDurations: PendingStudioRenderJob['realDurations']
      sampleFrames: PendingStudioRenderJob['sampleFrames']
      onProgress: (progress: number) => void
    },
  ) => Promise<RenderedManifest>
}

/**
 * 执行一张工单。
 *
 * 失败语义：**一律撤单**（`failed: true` + 原因），让宿主立刻结算等待中的工具调用；
 * 不在这里抛错 —— 两个执行者的调用点都只需要知道「这单结束了」。
 */
export async function executeRenderJob(options: ExecuteRenderJobOptions): Promise<RenderJobExecution> {
  const { job, signal } = options
  const transport = options.transport ?? defaultRenderTransport
  const render = options.render ?? (async (manifest, renderOptions) => {
    const mod = await import('./remotion-render.js')
    return await mod.renderManifestOnWebWithRetry(manifest, {
      signal: renderOptions.signal,
      quality: renderOptions.quality,
      realDurations: renderOptions.realDurations,
      sampleFrames: renderOptions.sampleFrames,
      onProgress: renderOptions.onProgress,
    })
  })

  let lastStep = -1
  try {
    const rendered = await render(job.manifest, {
      signal,
      quality: job.quality,
      realDurations: job.realDurations,
      sampleFrames: job.sampleFrames,
      onProgress: (progress) => {
        if (!Number.isFinite(progress)) return
        const clamped = Math.min(1, Math.max(0, progress))
        options.onProgress?.(clamped)
        const step = Math.floor(clamped * PROGRESS_STEPS)
        if (step === lastStep) return
        lastStep = step
        void transport.reportProgress(job.jobId, clamped).catch(() => {})
      },
    })
    if (signal.aborted) return 'aborted'
    // 抽帧先落盘：单张 PNG 几十 KB，早一步；宿主侧抽帧路由是幂等的，失败也不影响成片。
    for (const sample of rendered.samples) {
      if (signal.aborted) return 'aborted'
      await transport.uploadSample(job.jobId, sample.frame, sample.png).catch(() => null)
    }
    await transport.commit(job.jobId, rendered.bytes, rendered.warnings, metricsReport(rendered.metrics))
    return 'committed'
  } catch (cause) {
    if (signal.aborted) return 'aborted'
    const reason = cause instanceof Error ? cause.message : String(cause)
    void transport.cancel(job.jobId, true, reason).catch(() => {})
    return 'failed'
  }
}

/** `RenderMetrics` → 上行 payload（逐字段搬，别把整个对象透传 —— 形状变了宿主也发现不了）。 */
export function metricsReport(metrics: RenderMetrics): StudioRenderReport {
  return {
    quality: metrics.quality,
    frames: metrics.frames,
    totalMs: metrics.totalMs,
    msPerFrame: metrics.msPerFrame,
    encodeMs: metrics.encodeMs,
    bytes: metrics.bytes,
    bitrateKbps: metrics.bitrateKbps,
    width: metrics.width,
    height: metrics.height,
    sampledFrames: metrics.sampledFrames,
    warm: metrics.warm,
  }
}
