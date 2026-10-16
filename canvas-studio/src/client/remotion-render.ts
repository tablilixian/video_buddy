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
import type { CompositionManifest } from '../remotion/manifest.js'

/** Free 档许可键（消 library.ts 告警；商用档将来从设置注入）。 */
const FREE_LICENSE_KEY = 'free-license'

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
  const capability: CanRenderMediaOnWebResult = await canRenderMediaOnWeb({ container: 'mp4', videoCodec: 'h264', width, height })
  if (!capability.canRender) {
    const detail = capability.issues.map((issue: CanRenderIssue) => issue.message).join('；')
    throw new WebRenderError(`当前渲染环境不支持该成片${detail.length > 0 ? `（${detail}）` : ''}，请降低分辨率后重试。`)
  }
  const warnings = capability.issues
    .filter((issue: CanRenderIssue) => issue.severity === 'warning')
    .map((issue: CanRenderIssue) => issue.message)

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
