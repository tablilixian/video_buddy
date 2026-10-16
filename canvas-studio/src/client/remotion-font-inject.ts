/**
 * CV-334 · B3.3：`@font-face` 注入 + 字体就绪闸门（**独立轻量模块**）。
 *
 * 从 `client/remotion-render.ts` 抽出来的原因：渲染前预览面板（`RenderPreviewOverlay`）
 * 也要用同一套字体注入 —— "预览所见即成片所得"，字体不同会让人误判排版。而
 * `remotion-render.ts` 顶层 import 了 `@remotion/web-renderer`（重依赖），预览面板
 * 不该把它拉进主 bundle ⇒ 把这段与渲染器无关的逻辑单独成文件，两边共用。
 *
 * 两个硬要求（devdoc §8.3 第 3/4 条）：
 *   1. `src` 必须**同源**（宿主只读路由 `/canvas-studio/remotion/fonts/…`）。跨源会静默
 *      404 → 回退系统字体 → 中文字幕卡观感事故，且**不会报错**、只在成片里看出来。
 *   2. 字体未就绪不许截图（`font-display: block` + `await document.fonts.load`），否则
 *      会出现空白帧 / 半截字（等价于 Remotion 的 `delayRender()` 纪律）。
 */
import { resolveFonts } from '../remotion/fonts.js'
import type { CompositionManifest } from '../remotion/manifest.js'

/** 字体注入的 `<style>` 元素 id（重复调用原地覆盖，不叠加）。 */
const FONT_STYLE_ID = 'cs-remotion-fonts'
/** 字体就绪等待上限：超时不阻塞渲染，只记 warning（离线 / 坏源时不至于卡死出片）。 */
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
 * 注入随包 / 声明的 `@font-face` 并**等字体就绪**；返回非致命告警
 * （字体面未就绪 / manifest 里声明了未随包字体），由调用方并入渲染结果。
 */
export async function applyManifestFonts(manifest: CompositionManifest): Promise<string[]> {
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
    warnings.push(`字体面未就绪（等待 ${FONT_READY_TIMEOUT_MS}ms 后继续）：${missing.join('、')}；成片可能回退到系统字体。`)
  }
  return warnings
}
