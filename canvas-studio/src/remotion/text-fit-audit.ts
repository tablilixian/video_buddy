/**
 * 0B（CV-461）：**文本容量体检**（纯函数，遍历 manifest 的文字轨）。
 *
 * 谁调它、为什么：
 * - 落点在 `client/remotion-render.ts` 的 **prepare 阶段**（字体已注入、与渲染同页同字体），
 *   结果并进渲染报告的 `report.textFit` + `warnings`。渲染器本身没有回传通道
 *  （`renderMediaOnWeb` 跑完就结束），所以只能在渲前把度量做掉。
 * - 体检是**只读**的：不改 manifest、不改像素、不阻塞渲染。建不出测量器（非浏览器 /
 *   字体没就绪）就回落字符宽度估算 —— 估算口径与组件无 canvas 时完全一致。
 *
 * 为什么不做拒收：溢出只上报（`决策日志.md` D-19）。「标题就是要 3 行」可能是作者故意的，
 * 硬失败会误杀有意设计；而「截了但没人知道」违反仓库的「不静默截断」铁律 —— 上报即合规。
 */
import type { CaptionTrack, CompositionManifest, TextCardTrack } from './manifest.js'
import { fontFamilyStack, resolveFonts } from './fonts.js'
import { createCanvasMeasurer } from './text-measure.js'
import { planTextFit, textFitOverflowWarning, type TextFitVariant } from './text-fit-plan.js'

/** 一条文字轨的体检结论（**进 `report.textFit`**，字段名与 `TextFitPlan` 同名同义）。 */
export interface TextFitReportEntry {
  /** 轨 id（定位用；警告文案也会带它）。 */
  id: string
  variant: TextFitVariant
  fontPx: number
  baseFontPx: number
  maxLines: number
  /** 策略折行结果（诊断用：能看到「算法认为会断在哪」）。 */
  lines: string[]
  overflow: boolean
  atMinFont: boolean
  /** 折行可用宽（px）—— 判断「是不是盒太窄」时用。 */
  maxWidthPx: number
}

/** 一次渲染最多上报多少条（防病态 manifest 把报告撑爆）。 */
export const MAX_TEXT_FIT_ENTRIES = 64
/** 单条最多保留多少行（同上）。 */
export const MAX_TEXT_FIT_LINES = 24
/** 单行最多保留多少字符（同上）。 */
export const MAX_TEXT_FIT_LINE_CHARS = 240
/** warnings 里最多逐条列几条（其余折成计数）。 */
export const MAX_TEXT_FIT_WARNINGS = 5

/** 文字轨判定：`textCard`（四个 variant）+ `caption`（词级字幕）。其余类型一律不进。 */
function isTextTrack(track: CompositionManifest['tracks'][number]): track is TextCardTrack | CaptionTrack {
  return track.type === 'textCard' || track.type === 'caption'
}

/**
 * 遍历 manifest 的文字轨，逐条求排版计划。
 *
 * @param measure 真实字形测量器（prepare 阶段传 `createCanvasMeasurer()` 的结果）；
 *               缺省时自己试着建一个，非浏览器环境返回 `undefined` ⇒ 走估算。
 * @returns 每条文字轨一条结论；空 manifest / 无文字轨返回 `[]`，**从不抛错**。
 */
export function auditTextFit(
  manifest: CompositionManifest,
  canvasWidth?: number,
  canvasHeight?: number,
  measure?: TextFitPlanMeasure | undefined,
): TextFitReportEntry[] {
  const tracks = Array.isArray(manifest?.tracks) ? manifest.tracks : []
  if (tracks.length === 0) return []
  const width = positiveOr(canvasWidth, manifest?.meta?.width, 1920)
  const height = positiveOr(canvasHeight, manifest?.meta?.height, 1080)
  const measurer = measure ?? createCanvasMeasurer()
  // 字体族必须与组件**逐字一致**（`StudioComposition` 也是这条路径：resolveFonts → fontFamilyStack），
  // 否则同一段文字在体检里与成片里折在不同位置。解析失败不抛 —— 解析器自身已回落随包族名。
  let family: string | undefined
  try {
    family = fontFamilyStack(resolveFonts(manifest).defaultFamily)
  } catch {
    family = undefined
  }
  const entries: TextFitReportEntry[] = []
  for (const track of tracks) {
    if (!isTextTrack(track) || entries.length >= MAX_TEXT_FIT_ENTRIES) continue
    try {
      const plan = track.type === 'textCard'
        ? planTextFit({
          variant: track.variant,
          text: track.text,
          ...(track.box === undefined ? {} : { box: track.box }),
          canvasWidth: width,
          canvasHeight: height,
          dataRows: (track.data ?? []).length,
          ...(measurer === undefined ? {} : { measure: measurer }),
          ...(family === undefined ? {} : { family }),
          weight: 700,
        })
        : planTextFit({
          variant: 'caption',
          text: track.text,
          ...(track.box === undefined ? {} : { box: track.box }),
          canvasWidth: width,
          canvasHeight: height,
          caption: {
            ...(track.fontSize === undefined ? {} : { fontSize: track.fontSize }),
            ...(track.widthPercent === undefined ? {} : { widthPercent: track.widthPercent }),
          },
          ...(measurer === undefined ? {} : { measure: measurer }),
          ...(family === undefined ? {} : { family }),
          weight: 700,
        })
      entries.push({
        id: String(track.id ?? ''),
        variant: plan.variant,
        fontPx: plan.fontPx,
        baseFontPx: plan.baseFontPx,
        maxLines: plan.maxLines,
        lines: plan.lines.slice(0, MAX_TEXT_FIT_LINES),
        overflow: plan.overflow,
        atMinFont: plan.atMinFont,
        maxWidthPx: Math.round(plan.maxWidthPx),
      })
    } catch {
      // 单轨算不出来不该毁掉整份体检（也绝不阻塞渲染）。
      continue
    }
  }
  return entries
}

/** `auditTextFit` 的测量器入参类型（复述 `timing.ts` 的签名，避免调用方多引一层）。 */
export type TextFitPlanMeasure = NonNullable<Parameters<typeof planTextFit>[0]['measure']>

/** 取第一个有限正数（画布尺寸三来源：显式入参 > meta > 缺省）。 */
function positiveOr(...values: (number | undefined)[]): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  }
  return 1920
}

/**
 * 体检结论 → warnings 文案（**可执行**：每条都带「改短到 N 字」或「加大 box」）。
 *
 * 有溢出才出告警；超过 `MAX_TEXT_FIT_WARNINGS` 条时折成一行计数（逐条措辞不该吃掉
 * 上下文预算，完整清单在 `report.textFit`）。不溢出的轨不出任何噪音。
 */
export function textFitWarnings(entries: readonly TextFitReportEntry[]): string[] {
  const overflowing = entries.filter((entry) => entry.overflow)
  if (overflowing.length === 0) return []
  const shown = overflowing.slice(0, MAX_TEXT_FIT_WARNINGS)
  const warnings = shown.map((entry) => textFitOverflowWarning(entry.id, entry))
  const rest = overflowing.length - shown.length
  if (rest > 0) warnings.push(`另有 ${rest} 条文字轨也会被裁（完整清单见 report.textFit）。`)
  return warnings
}

/**
 * 宿主侧收口：把客户端上报的 `textFit` 洗成合法条目（`/remotion/commit` 的 query 通道）。
 *
 * 与 `asRenderWarnings` 同口径：形状不符就**丢弃这一项**而不是 400 —— 报告是观测信息，
 * 不值得为它打断一次已经渲完的成片回写。
 */
export function sanitizeTextFitEntries(raw: unknown): TextFitReportEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: TextFitReportEntry[] = []
  for (const item of raw.slice(0, MAX_TEXT_FIT_ENTRIES)) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.slice(0, 120) : ''
    const variant = asVariant(record.variant)
    const fontPx = asFinite(record.fontPx)
    const baseFontPx = asFinite(record.baseFontPx)
    const maxLines = asFinite(record.maxLines)
    const maxWidthPx = asFinite(record.maxWidthPx)
    const lines = asLines(record.lines)
    if (variant === undefined || fontPx === undefined || baseFontPx === undefined
      || maxLines === undefined || maxWidthPx === undefined || lines === undefined) continue
    out.push({
      id,
      variant,
      fontPx,
      baseFontPx,
      maxLines,
      lines,
      overflow: record.overflow === true,
      atMinFont: record.atMinFont === true,
      maxWidthPx,
    })
  }
  return out
}

const TEXT_FIT_VARIANTS = new Set<TextFitVariant>(['subtitle', 'dataCard', 'title', 'bullets', 'caption'])

function asVariant(value: unknown): TextFitVariant | undefined {
  return typeof value === 'string' && TEXT_FIT_VARIANTS.has(value as TextFitVariant)
    ? (value as TextFitVariant)
    : undefined
}

function asFinite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asLines(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value
    .slice(0, MAX_TEXT_FIT_LINES)
    .filter((line): line is string => typeof line === 'string')
    .map((line) => line.slice(0, MAX_TEXT_FIT_LINE_CHARS))
}
