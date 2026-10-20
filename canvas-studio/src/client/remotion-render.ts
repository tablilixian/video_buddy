/**
 * REQ-034 · B3：route B（CSR）渲染执行器 —— 在 Electron 渲染进程里用
 * `@remotion/web-renderer` 渲染**产品真实组件**（`StudioComposition` + 标准
 * `CompositionManifest`），产出 mp4 字节回写宿主。
 *
 * 与 S10 验证器（`scripts/remotion-verify/entry.tsx`）同一套 CSR 调用形态，
 * 差异只在：这里不落盘、不画日志，只把字节返回给工单桥。
 *
 * 关键纪律（spike 血泪，勿删）：
 *   - `outputTarget: 'arraybuffer'`（默认 `web-fs` 需用户手势，后台渲染不可用）。
 *   - `licenseKey` 缺省 `free-license`（Free 档消告警）；二期 P-04 起**可注入**，
 *     换档不必改渲染逻辑（见 `DEFAULT_REMOTION_LICENSE_KEY`）。
 *   - 直接吃 `StudioComposition`（不必走 bundle / `registerRoot`）。
 *
 * CV-334：字体注入 / 就绪闸门搬到 `./remotion-font-inject.js`（预览面板也要用同一套，
 * 而本模块顶层 import 了 `@remotion/web-renderer` 这个重依赖，不该被预览面板连带拉起）。
 *
 * 二期新增（同文件，都是"渲染前 / 失败后"的边缘逻辑）：
 * - **B2** 渲染前探真值时长（`probeManifestDurations`）：宿主已用 ffprobe 校正过一遍，
 *   但 ffprobe 不可用时宿主只能告警；这里用浏览器自身的解码器再兜一层。
 * - **D2** 失败分类 + 有界重试（`classifyRenderFailure` / `renderManifestOnWebWithRetry`）：
 *   只有"编码失败"可重试，能力不支持重试是纯浪费（必然再失败一次）。
 */
import {
  canRenderMediaOnWeb,
  renderMediaOnWeb,
  type CanRenderIssue,
  type CanRenderMediaOnWebResult,
  type FrameRange,
  type WebRendererHardwareAcceleration,
  type WebRendererPageResponsiveness,
} from '@remotion/web-renderer'
import { StudioComposition } from '../remotion/components/Root.js'
import { RENDER_QUALITY_SCALE, validateManifest, type CompositionManifest, type RenderQuality } from '../remotion/manifest.js'
import { reconcileManifestVideoDurations } from '../remotion/timing.js'
import { pickSampleFrames } from '../remotion/timing.js'
import { applyManifestFonts } from './remotion-font-inject.js'

/**
 * Free 档许可键（消 library.ts 告警）。
 *
 * 二期 P-04：从"写死在调用里"提成常量 + 可注入参数 —— 商用档只改注入值，
 * 不动渲染逻辑。档位口径见 devdoc §1.3.1（Free 成立前提：主体 ≤3 人）。
 */
export const DEFAULT_REMOTION_LICENSE_KEY = 'free-license'

/**
 * 三期 W5-3：三档质量预设。
 *
 * `standard` = **今天的全部默认值**（`scale 1` / `medium` 码率 / 5s 关键帧 / 每 33ms 让出
 * 主线程 / 不缓存解码），因此缺省行为与三期之前逐帧一致 —— 这是「不退步」的锚。
 *
 * `draft` 的四个杠杆：半分辨率（帧面积 1/4）、低码率、拉长关键帧间隔、关掉主线程让出
 *（`pageResponsiveness: 'disabled'`，渲染时页面会卡，但这是后台任务）。
 */
export interface QualityPreset {
  scale: number
  videoBitrate: 'low' | 'medium' | 'high'
  keyframeIntervalInSeconds: number
  pageResponsiveness: WebRendererPageResponsiveness
  hardwareAcceleration: WebRendererHardwareAcceleration
  mediaCacheSizeInBytes: number | null
}

export const QUALITY_PRESETS: Readonly<Record<RenderQuality, QualityPreset>> = {
  draft: {
    // O-12：缩放值取自 `manifest.ts` 的 `RENDER_QUALITY_SCALE`（宿主侧判「素材是否被
    // 上采样」用的是同一个数 —— 两份写死必然漂移）。
    scale: RENDER_QUALITY_SCALE.draft,
    videoBitrate: 'low',
    keyframeIntervalInSeconds: 10,
    pageResponsiveness: 'disabled',
    hardwareAcceleration: 'prefer-hardware',
    mediaCacheSizeInBytes: 128 * 1024 * 1024,
  },
  standard: {
    scale: 1,
    videoBitrate: 'medium',
    keyframeIntervalInSeconds: 5,
    pageResponsiveness: 'medium',
    hardwareAcceleration: 'no-preference',
    mediaCacheSizeInBytes: null,
  },
  high: {
    scale: 1,
    videoBitrate: 'high',
    keyframeIntervalInSeconds: 2,
    pageResponsiveness: 'medium',
    hardwareAcceleration: 'prefer-hardware',
    mediaCacheSizeInBytes: 256 * 1024 * 1024,
  },
}

/** 一期抽帧结果（PNG 字节 + 帧号）。 */
export interface RenderSample {
  frame: number
  png: Uint8Array
}

/** 三期 W6-2：渲染报告（性能与质量都可复盘）。 */
export interface RenderMetrics {
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

export interface RenderManifestOnWebOptions {
  signal?: AbortSignal
  /** 0–1 进度回调（二期 1b 起由工单桥真实消费：本地角标 + 回传宿主）。 */
  onProgress?: (progress: number) => void
  /** 许可键（缺省 `free-license`）；商用档从设置注入。 */
  licenseKey?: string
  /**
   * 三期 W5-3：质量档（缺省 `standard`）。`draft` 同时会跳过「渲染前预览闸门」
   *（它本身就是预览）—— 那个决策在客户端工单桥里做，不在渲染器里。
   */
  quality?: RenderQuality | undefined
  /**
   * 三期 W5-4：宿主 ffprobe 已探到的真值时长（`src → 秒`）。
   *
   * 非空 ⇒ **跳过**浏览器侧的 `probeManifestDurations`（原来每次渲染都白等一遍）。
   */
  realDurations?: Record<string, number> | undefined
  /** 三期 W6-1：抽帧目标（绝对帧号）；缺省自动取 4 张 + 转场中点（上限 8）。 */
  sampleFrames?: readonly number[] | undefined
  /** 三期 W6-1：只要单帧、不要编码成片时使用（`renderStillOnWeb` 兜底路径）。 */
  frameRange?: FrameRange | undefined
}

export interface RenderedManifest {
  bytes: Uint8Array
  /** 渲染期非致命告警（能力探测的 warning + 后续字体 / 编码降级）。 */
  warnings: string[]
  /** 三期 W6-1：抽帧（PNG 字节）。 */
  samples: RenderSample[]
  /** 三期 W6-2：渲染报告。 */
  metrics: RenderMetrics
}

/** 渲染失败时抛出的可读错误（宿主会把它作为 `CS-RENDER-002` 的原因透传）。 */
export class WebRenderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebRenderError'
  }
}

/**
 * 三期 W6-1：抽帧位置的选择口径在 `timing.ts` 的 `pickSampleFrames`（宿主 / 客户端共用，
 * 纯函数可单测）。这里只做 re-export，方便既有调用方从本模块取。
 */
export { pickSampleFrames } from '../remotion/timing.js'

/** 把一帧 `VideoFrame` 画进 `OffscreenCanvas` 并编码成 PNG（异步，但不阻塞取帧）。 */
async function frameToPng(frame: VideoFrame): Promise<Uint8Array | null> {
  try {
    const width = Math.max(1, frame.displayWidth)
    const height = Math.max(1, frame.displayHeight)
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (context === null) return null
    context.drawImage(frame, 0, 0, width, height)
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return new Uint8Array(await blob.arrayBuffer())
  } catch {
    return null
  }
}

/**
 * 在渲染进程里把一个 `CompositionManifest` 渲染成 mp4 字节。
 *
 * @throws {WebRenderError} 能力不支持 / 编码器未产出字节（调用方据此回 `CS-RENDER-002`）。
 */
export async function renderManifestOnWeb(
  manifest: CompositionManifest,
  options: RenderManifestOnWebOptions = {},
): Promise<RenderedManifest> {
  const { width, height, fps, durationInFrames } = manifest.meta
  const quality: RenderQuality = options.quality ?? manifest.meta.quality ?? 'standard'
  const preset = QUALITY_PRESETS[quality] ?? QUALITY_PRESETS.standard
  const startedAt = Date.now()
  // R1：字体面先就绪再渲染（顺序不可颠倒 —— 渲染期才注入会拍到回退字体的帧）。
  const fontWarnings = await applyManifestFonts(manifest)
  // 三期 W5-4：宿主已探到的真值直接复用；没给才在浏览器里再探一遍（二期 B2 兜底）。
  const hostDurations = options.realDurations ?? {}
  const probed: ManifestDurationProbe = Object.keys(hostDurations).length > 0
    ? { realDurations: hostDurations, warnings: [] }
    : await probeManifestDurations(manifest, options.signal)
  const probedManifest = applyProbedDurations(manifest, probed, fontWarnings)
  const capability: CanRenderMediaOnWebResult = await canRenderMediaOnWeb({ container: 'mp4', videoCodec: 'h264', width, height })
  if (!capability.canRender) {
    const detail = capability.issues.map((issue: CanRenderIssue) => issue.message).join('；')
    throw new WebRenderError(`当前渲染环境不支持该成片${detail.length > 0 ? `（${detail}）` : ''}，请降低分辨率后重试。`)
  }
  const warnings = [
    ...fontWarnings,
    ...capability.issues
      .filter((issue: CanRenderIssue) => issue.severity === 'warning')
      .map((issue: CanRenderIssue) => issue.message),
  ]

  const { signal } = options
  const frames = Math.max(1, Math.round(durationInFrames))
  const sampleFrames = options.frameRange === undefined
    ? (options.sampleFrames ?? pickSampleFrames(probedManifest))
    : []
  const sampleSet = new Set(sampleFrames)
  const pendingSamples: { frame: number; promise: Promise<Uint8Array | null> }[] = []
  let frameIndex = 0
  let encodeMs = 0
  const result = await renderMediaOnWeb({
    composition: {
      id: 'studio-composition',
      component: StudioComposition,
      width,
      height,
      fps,
      durationInFrames: frames,
      defaultProps: { manifest: probedManifest },
      calculateMetadata: null,
    },
    inputProps: { manifest: probedManifest },
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    outputTarget: 'arraybuffer',
    licenseKey: options.licenseKey ?? DEFAULT_REMOTION_LICENSE_KEY,
    // ── 三期 W5-3：质量档（`standard` 与今天的默认值完全一致） ──
    scale: preset.scale,
    videoBitrate: preset.videoBitrate,
    keyframeIntervalInSeconds: preset.keyframeIntervalInSeconds,
    pageResponsiveness: preset.pageResponsiveness,
    hardwareAcceleration: preset.hardwareAcceleration,
    mediaCacheSizeInBytes: preset.mediaCacheSizeInBytes,
    ...(options.frameRange === undefined ? {} : { frameRange: options.frameRange }),
    // ── 三期 W6-1：抽帧（回调必须**同步返回** frame；编码异步攒着，渲染结束后统一收） ──
    ...(sampleSet.size === 0 ? {} : {
      onFrame: (frame: VideoFrame): VideoFrame => {
        const index = frameIndex
        frameIndex += 1
        if (sampleSet.has(index)) {
          pendingSamples.push({ frame: index, promise: frameToPng(frame) })
        }
        return frame
      },
    }),
    ...(options.onProgress !== undefined
      ? {
        onProgress: (progress: { progress: number; doneIn: number | null }) => {
          if (typeof progress.doneIn === 'number' && Number.isFinite(progress.doneIn)) encodeMs = progress.doneIn
          options.onProgress?.(progress.progress)
        },
      }
      : {}),
    ...(signal === undefined ? {} : { signal }),
  })
  const blob = await result.getBlob()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (bytes.length === 0) throw new WebRenderError('渲染产物为空（编码器未产出字节），请重试。')
  const samples: RenderSample[] = []
  for (const entry of pendingSamples) {
    const png = await entry.promise
    if (png !== null && png.length > 0) samples.push({ frame: entry.frame, png })
  }
  samples.sort((a, b) => a.frame - b.frame)
  const totalMs = Date.now() - startedAt
  const seconds = frames / (Number.isFinite(fps) && fps > 0 ? fps : 30)
  const metrics: RenderMetrics = {
    quality,
    frames,
    totalMs,
    msPerFrame: Math.round((totalMs / frames) * 100) / 100,
    encodeMs,
    bytes: bytes.length,
    bitrateKbps: seconds > 0 ? Math.round((bytes.length * 8) / seconds / 1000) : 0,
    width: Math.max(1, Math.round(width * preset.scale)),
    height: Math.max(1, Math.round(height * preset.scale)),
    sampledFrames: samples.length,
    warm: false,
  }
  return { bytes, warnings, samples, metrics }
}

// ───────────────── 二期 D2：失败分类 + 有界重试（红线：重试前必须中断上一次） ─────────────────

export type RenderFailureKind = 'cancelled' | 'capability' | 'encode' | 'resource' | 'timeout' | 'unknown'

/**
 * 把渲染失败归因到一类（纯判定，不抛错）。
 *
 * 为什么要分类：`capability`（环境不支持）重试是纯浪费 —— 必然再失败一次，还白等
 * 一整轮编码；只有 `encode`（编码器中途失败 / 产物为空）值得重试。
 */
export function classifyRenderFailure(cause: unknown): RenderFailureKind {
  const name = (cause as { name?: string } | null)?.name ?? ''
  if (name === 'AbortError') return 'cancelled'
  const message = cause instanceof Error ? cause.message : String(cause)
  if (/不支持|not supported|canRender|cannot render/i.test(message)) return 'capability'
  if (/timeout|超时/i.test(message)) return 'timeout'
  if (/编码|encoder|codec|产物为空|arraybuffer/i.test(message)) return 'encode'
  if (/404|fetch|加载|decode|解码|缺失|not found/i.test(message)) return 'resource'
  return 'unknown'
}

/** 只有 `encode` 可重试（最多一次）—— 其余重试只会把同一次失败再走一遍。 */
export function isRetryableRenderFailure(kind: RenderFailureKind): boolean {
  return kind === 'encode'
}

export interface RetryRenderOptions extends RenderManifestOnWebOptions {
  /** 总尝试次数（含首次），缺省 2。 */
  maxAttempts?: number
  /** 重试前等待毫秒（缺省 600；给编码器释放资源的时间）。 */
  retryDelayMs?: number
}

/**
 * 带**有界重试**的渲染。
 *
 * 红线（计划 §七）：重试前必须确保上一次渲染已经中止 —— 否则两个编码器同时跑，
 * CPU 打满、两个都会失败。实现上靠两点：① 只在 `renderManifestOnWeb` **已抛出**
 * （意味着本次调用结束）后才重试；② 每次重试都复用同一个 `signal`，调用方 abort 时
 * 立即停手，绝不在 abort 之后继续起第二次。
 */
export async function renderManifestOnWebWithRetry(
  manifest: CompositionManifest,
  options: RetryRenderOptions = {},
): Promise<RenderedManifest> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 2))
  const delayMs = Math.max(0, options.retryDelayMs ?? 600)
  let attempt = 0
  for (;;) {
    try {
      return await renderManifestOnWeb(manifest, options)
    } catch (cause) {
      const kind = classifyRenderFailure(cause)
      const aborted = options.signal?.aborted === true
      if (aborted || !isRetryableRenderFailure(kind) || attempt >= maxAttempts - 1) {
        if (cause instanceof WebRenderError) throw cause
        const message = cause instanceof Error ? cause.message : String(cause)
        throw new WebRenderError(`渲染失败（${kind}）：${message}`)
      }
      attempt += 1
      if (delayMs > 0) await new Promise<void>((resolve) => { setTimeout(resolve, delayMs) })
      if (options.signal?.aborted === true) {
        throw new WebRenderError('渲染已取消（重试前收到中断信号）。')
      }
    }
  }
}

// ───────────────── 二期 B2：渲染前探真值时长（浏览器解码器兜底） ─────────────────

export interface ManifestDurationProbe {
  /** `src → 真实秒数`（探不到的不入表）。 */
  realDurations: Record<string, number>
  warnings: string[]
}

/** 用原生 `<video>` 的 `loadedmetadata` 探时长（超时 / 出错返回 `undefined`，不抛错）。 */
function probeVideoDuration(src: string, signal?: AbortSignal): Promise<number | undefined> {
  return new Promise<number | undefined>((resolve) => {
    const element = document.createElement('video')
    let settled = false
    const finish = (value: number | undefined): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      element.removeAttribute('src')
      resolve(value)
    }
    const timer = setTimeout(() => finish(undefined), 8000)
    element.preload = 'metadata'
    element.muted = true
    element.onloadedmetadata = () => finish(Number.isFinite(element.duration) && element.duration > 0 ? element.duration : undefined)
    element.onerror = () => finish(undefined)
    if (signal !== undefined) {
      if (signal.aborted) { finish(undefined); return }
      signal.addEventListener('abort', () => finish(undefined), { once: true })
    }
    element.src = src
  })
}

/**
 * 探一份 manifest 里所有 video 轨的真实时长。
 *
 * 只探 `video` 轨：`audio` 不影响画面排布（音频时长由 `<Audio>` 自己播到进程结束，
 * 短了只是没声，不会出现黑帧）；探它只增加渲染前等待。
 */
export async function probeManifestDurations(
  manifest: CompositionManifest,
  signal?: AbortSignal,
): Promise<ManifestDurationProbe> {
  const realDurations: Record<string, number> = {}
  const warnings: string[] = []
  for (const track of manifest.tracks) {
    if (track.type !== 'video') continue
    if (realDurations[track.src] !== undefined) continue
    const seconds = await probeVideoDuration(track.src, signal)
    if (seconds === undefined) {
      warnings.push(`未能探测「${track.src}」的真实时长（浏览器解码器不可用），已按 manifest 声明值渲染。`)
      continue
    }
    realDurations[track.src] = seconds
  }
  return { realDurations, warnings }
}

/**
 * 把探测到的真值套回 manifest（**只在结果仍自洽时**改）。
 *
 * 为什么加这道自洽检查：改短 video 轨会让原本重叠的相邻轨不再重叠（转场失效），
 * 宿主侧刚为此加过"校正后复校"。这里若盲目改写，等于从客户端把那个洞重新打开。
 * 因此：校正结果必须仍能通过 `validateManifest`，否则**保留原样**并明确告警。
 */
function applyProbedDurations(
  manifest: CompositionManifest,
  probe: ManifestDurationProbe,
  warnings: string[],
): CompositionManifest {
  if (Object.keys(probe.realDurations).length === 0) {
    warnings.push(...probe.warnings)
    return manifest
  }
  const corrected = reconcileManifestVideoDurations(manifest, probe.realDurations, manifest.meta.fps)
  const candidate: CompositionManifest = { ...manifest, tracks: corrected.tracks }
  if (corrected.warnings.length === 0) {
    warnings.push(...probe.warnings)
    return manifest
  }
  if (validateManifest(candidate).ok) {
    warnings.push(...probe.warnings, ...corrected.warnings, '已按浏览器探测到的真实时长校正 video 轨。')
    return candidate
  }
  warnings.push(
    ...probe.warnings,
    ...corrected.warnings,
    '按浏览器探测到的真实时长校正后，轨道排布与转场不再自洽，已保留宿主校正后的时长（请检查该片段的真实时长）。',
  )
  return manifest
}
