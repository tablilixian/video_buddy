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
import { canRenderMediaOnWeb, renderMediaOnWeb, type CanRenderIssue, type CanRenderMediaOnWebResult } from '@remotion/web-renderer'
import { StudioComposition } from '../remotion/components/Root.js'
import { validateManifest, type CompositionManifest } from '../remotion/manifest.js'
import { reconcileManifestVideoDurations } from '../remotion/timing.js'
import { applyManifestFonts } from './remotion-font-inject.js'

/**
 * Free 档许可键（消 library.ts 告警）。
 *
 * 二期 P-04：从"写死在调用里"提成常量 + 可注入参数 —— 商用档只改注入值，
 * 不动渲染逻辑。档位口径见 devdoc §1.3.1（Free 成立前提：主体 ≤3 人）。
 */
export const DEFAULT_REMOTION_LICENSE_KEY = 'free-license'

export interface RenderManifestOnWebOptions {
  signal?: AbortSignal
  /** 0–1 进度回调（二期 1b 起由工单桥真实消费：本地角标 + 回传宿主）。 */
  onProgress?: (progress: number) => void
  /** 许可键（缺省 `free-license`）；商用档从设置注入。 */
  licenseKey?: string
}

export interface RenderedManifest {
  bytes: Uint8Array
  /** 渲染期非致命告警（能力探测的 warning + 后续字体 / 编码降级）。 */
  warnings: string[]
}

/** 渲染失败时抛出的可读错误（宿主会把它作为 `CS-RENDER-002` 的原因透传）。 */
export class WebRenderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebRenderError'
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
  // R1：字体面先就绪再渲染（顺序不可颠倒 —— 渲染期才注入会拍到回退字体的帧）。
  const fontWarnings = await applyManifestFonts(manifest)
  // 二期 B2：渲染前再探一次真值（宿主 ffprobe 失败时这里是最后一道保险）。
  const probed = await probeManifestDurations(manifest, options.signal)
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
  const result = await renderMediaOnWeb({
    composition: {
      id: 'studio-composition',
      component: StudioComposition,
      width,
      height,
      fps,
      durationInFrames: Math.max(1, Math.round(durationInFrames)),
      defaultProps: { manifest: probedManifest },
      calculateMetadata: null,
    },
    inputProps: { manifest: probedManifest },
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    outputTarget: 'arraybuffer',
    licenseKey: options.licenseKey ?? DEFAULT_REMOTION_LICENSE_KEY,
    ...(options.onProgress !== undefined
      ? { onProgress: (progress: { progress: number }) => options.onProgress?.(progress.progress) }
      : {}),
    ...(signal === undefined ? {} : { signal }),
  })
  const blob = await result.getBlob()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (bytes.length === 0) throw new WebRenderError('渲染产物为空（编码器未产出字节），请重试。')
  return { bytes, warnings }
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
