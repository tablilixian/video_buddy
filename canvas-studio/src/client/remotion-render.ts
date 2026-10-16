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
 *   - `licenseKey: 'free-license'`（两人公司 Free 档，消告警）。
 *   - 直接吃 `StudioComposition`（不必走 bundle / `registerRoot`）。
 */
import { canRenderMediaOnWeb, renderMediaOnWeb, type CanRenderIssue, type CanRenderMediaOnWebResult } from '@remotion/web-renderer'
import { StudioComposition } from '../remotion/components/Root.js'
import { resolveFonts } from '../remotion/fonts.js'
import type { CompositionManifest } from '../remotion/manifest.js'

/** Free 档许可键（消 library.ts 告警；商用档将来从设置注入）。 */
const FREE_LICENSE_KEY = 'free-license'

/** REQ-034 · R1：字体注入的 `<style>` 元素 id（重复渲染时原地覆盖，不叠加）。 */
const FONT_STYLE_ID = 'cs-remotion-fonts'
/** 字体就绪等待上限：超时不阻塞渲染，只记 warning（离线/坏源时不至于卡死出片）。 */
const FONT_READY_TIMEOUT_MS = 8000
/** 探针串：含中文与拉丁，子集内必有 ⇒ 命中即说明该字体面真的可用。 */
const FONT_PROBE_TEXT = '中文成片A1'

/** `Promise.race` 版超时（`AbortSignal.timeout` 对 `document.fonts.load` 不生效）。 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待字体就绪超过 ${ms}ms`)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (cause: unknown) => { clearTimeout(timer); reject(cause instanceof Error ? cause : new Error(String(cause))) },
    )
  })
}

/**
 * REQ-034 · R1：渲染前置 —— 注入随包/声明的 `@font-face`，并**等字体就绪**再截图。
 *
 * 两个硬要求（devdoc §8.3 第 3/4 条）：
 *   1. `src` 必须**同源**（宿主只读路由 `/canvas-studio/remotion/fonts/…`）。跨源会静默 404
 *      → 回退系统字体 → 中文字幕卡观感事故，且**不会报错**、只在成片里看出来。
 *   2. 字体未就绪不许截图（`font-display: block` + `await document.fonts.load`），否则会出现
 *      空白帧 / 半截字（等价于 Remotion 的 `delayRender()` 纪律）。
 *
 * 返回非致命告警（字体面未就绪 / manifest 里声明了未随包字体），由调用方并入渲染结果。
 */
async function applyFontsBeforeRender(manifest: CompositionManifest): Promise<string[]> {
  const fonts = resolveFonts(manifest)
  const warnings = [...fonts.warnings]
  if (fonts.entries.length === 0 || typeof document === 'undefined') return warnings

  const css = fonts.entries
    .map((entry) => `@font-face{font-family:"${entry.family}";font-style:normal;font-weight:${entry.weight};`
      + `font-display:block;src:url("${entry.url}") format("woff2")}`)
    .join('\n')
  const existing = document.getElementById(FONT_STYLE_ID)
  const style = existing instanceof HTMLStyleElement ? existing : document.createElement('style')
  if (existing === null) {
    style.id = FONT_STYLE_ID
    document.head.append(style)
  }
  style.textContent = css

  const notReady = await Promise.all(fonts.entries.map(async (entry) => {
    try {
      const faces = await withTimeout(
        document.fonts.load(`${entry.weight} 48px "${entry.family}"`, FONT_PROBE_TEXT),
        FONT_READY_TIMEOUT_MS,
      )
      return faces.length > 0 ? undefined : `${entry.family} ${entry.weight}`
    } catch {
      return `${entry.family} ${entry.weight}`
    }
  }))
  const missing = notReady.filter((item): item is string => item !== undefined)
  if (missing.length > 0) {
    warnings.push(`字体面未就绪（等待 ${FONT_READY_TIMEOUT_MS}ms 后继续渲染）：${missing.join('、')}；成片可能回退到系统字体。`)
  }
  return warnings
}

export interface RenderManifestOnWebOptions {
  signal?: AbortSignal
  /** 0–1 进度回调（工单桥当前不消费，留给将来的进度条）。 */
  onProgress?: (progress: number) => void
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
  const fontWarnings = await applyFontsBeforeRender(manifest)
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
      defaultProps: { manifest },
      calculateMetadata: null,
    },
    inputProps: { manifest },
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    outputTarget: 'arraybuffer',
    licenseKey: FREE_LICENSE_KEY,
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
