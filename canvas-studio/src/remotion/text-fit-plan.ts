/**
 * 0B（CV-461）：**文本排版计划**（纯函数，零 IO、可单测）。
 *
 * ## 为什么需要这一层
 *
 * 机制早就存在但**没有出口**：`timing.ts:fitTextPolicy` 会返回 `overflow`，`TextCard.tsx`
 * 的 `fitOrKeep` 也算过它，然后**四个 variant 分支全部把它丢掉** ⇒ 文字被外层
 * `overflow:hidden` 静默裁掉，而 `validateManifest` 报 `ok:true, warnings:[]`（零层拦截）。
 *
 * 修法不是「再写一份排版逻辑去体检」——那必然与组件漂移，**体检说没溢出、成片却裁了**
 * 比没有体检更糟。正确做法是把「按 variant 决定字号/行数」这件事抽成**唯一一份**决策，
 * 组件与体检都调它：
 *
 * ```
 *                      ┌─ TextCard.tsx（渲染：贴 fontPx / 用 renderText）
 * planTextFit(...) ────┤
 *                      └─ text-fit-audit.ts（体检：报 overflow / 建议字数）
 * ```
 *
 * ## `renderText` 为什么必须存在（这是本任务最容易做错的一条）
 *
 * 贪心折行 ≠ 浏览器折行。老 manifest 的文字排版必须**逐像素不变**，所以「没缩号」时
 * 必须原样把作者写的文本交给浏览器自己折行；只有真缩了字号（或确实溢出）才换成策略
 * 算出的行。直接用 `lines.join('\n')` 会在一行被算法切开的地方插入硬换行 ⇒ 老片像素漂移。
 *
 * ## 分级（不拒收，只上报）
 *
 * 溢出**不做拒收**：`title` 就是要 3 行可能是作者故意的（真实项目里 `hook-title` =
 * `["四季","是因为离太阳远近吗？"]` 就是有意两行）。硬失败会误杀有意设计。
 */
import { DATA_CARD_PADDING_X, dataCardDesignHeight, dataCardMetrics } from './data-card-metrics.js'
import type { TextCardTrack } from './manifest.js'
import { SUBTITLE_LINE_HEIGHT, subtitleFitBudget } from './subtitle-fit.js'
import { fitTextPolicy, type TextMeasurer } from './timing.js'
import { DESIGN_CANVAS_HEIGHT, DESIGN_CANVAS_WIDTH, scaleDesignPx } from './type-scale.js'

/**
 * 文本轨的排版形态。前四个 = `TextCardTrack.variant`；`caption` 是词级字幕轨
 *（`CaptionTrack`，无 variant 字段但同样是文字轨，需要同口径上报）。
 */
export type TextFitVariant = TextCardTrack['variant'] | 'caption'

/** `title` 基准字号（**设计 px，1080 高画布上**）—— 实际字号经 `canvasTextScale` 换算。 */
export const TITLE_BASE_FONT_PX = 84
/** `title` 行数上限。 */
export const TITLE_MAX_LINES = 2
/** `title` 行高（组件写的是 1.15；这里只影响 `estimatedHeightPx`，不改折行）。 */
export const TITLE_LINE_HEIGHT = 1.15
/** `title` 带 box 时的最小可用宽（px，极窄盒不至于算出 0 宽）。 */
export const TITLE_MIN_WIDTH_PX = 120

/** `bullets` 基准字号（**设计 px，1080 高画布上**）。 */
export const BULLETS_BASE_FONT_PX = 48
/** `bullets` 行数上限。 */
export const BULLETS_MAX_LINES = 6
/** `bullets` 容器宽上限（px）—— 老实现是**写死** 900。 */
export const BULLETS_CONTAINER_MAX_PX = 900
/** `bullets` 单行圆点占用（18px 点 + 24px 右距 = 42px）。文字可用宽必须扣掉它。 */
export const BULLET_DOT_ALLOWANCE_PX = 42

/** `dataCard` 标题字号（设计 px，实际还要乘 `dataCardMetrics` 的缩放系数）。 */
export const DATA_CARD_TITLE_FONT_PX = 40
/** `dataCard` 标题行高（设计 px，与 `DATA_CARD_TITLE_LINE_HEIGHT` 同值）。 */
export const DATA_CARD_TITLE_LINE_HEIGHT = 50

/** `timecode`（≥95% 对齐 S1-B）基准字号（**设计 px，1080 高画布上**）—— HUD 时间码一行，不缩号。 */
export const TIMECODE_BASE_FONT_PX = 36

/** `caption` 软行数上限：超过不裁字，但会顶到画面下沿（只提示，不做硬判）。 */
export const CAPTION_SOFT_MAX_LINES = 3
/** `caption` 字号占画布高的比例（缺省，与 `Caption.tsx` 一致）。 */
export const CAPTION_FONT_RATIO = 0.11
/** `caption` 折行宽度占画布宽百分比（缺省，与 `Caption.tsx` 一致）。 */
export const CAPTION_DEFAULT_WIDTH_PERCENT = 66

/** 排版计划（组件与体检的唯一输入）。 */
export interface TextFitPlan {
  variant: TextFitVariant
  /**
   * **实际要渲染的文本**：未缩号且未溢出时 = 原文（作者写的，含数组拼接口径）；
   * 否则 = 策略算出的行。
   *
   * ⚠️ 组件必须渲染这个字段，**不要**自己拼 `lines`（理由见文件头）。
   */
  renderText: string
  /** 实际采用的字号（px）。 */
  fontPx: number
  /** 基准字号（px，未缩号时的值）。 */
  baseFontPx: number
  /** 允许的最大行数。 */
  maxLines: number
  /** 策略折行后的行（**诊断用**；渲染看 `renderText`）。 */
  lines: string[]
  /** 是否超出 `maxLines`（= 成片会被裁掉）。 */
  overflow: boolean
  /** 是否已缩到字号下限（= base × 0.55）仍然溢出 ⇒ 最严重档。 */
  atMinFont: boolean
  /** 用于折行的文字可用宽（px）。 */
  maxWidthPx: number
  /** 外层 DOM 容器宽（px）—— `bullets` 需要（它比文字可用宽多 42px 圆点）。 */
  containerWidthPx: number
}

export interface TextFitPlanInput {
  variant: TextFitVariant
  /** 轨的 `text`（数组 = 作者显式分行）。 */
  text: string | string[]
  /** 轨的 box（中心 + 尺寸，画布百分比）；没有则 undefined（= 铺满卡 / 老路径）。 */
  box?: { x: number; y: number; w: number; h: number } | undefined
  canvasWidth: number
  canvasHeight: number
  /** `dataCard` 专用：数据行数（决定设计高度 ⇒ 缩放系数）。 */
  dataRows?: number | undefined
  /** `caption` 专用：显式字号 / 折行宽百分比。 */
  caption?: { fontSize?: number | undefined; widthPercent?: number | undefined } | undefined
  /** 真实字形测量器；缺省用 `fitTextPolicy` 的字符宽度估算（Node 侧可用）。 */
  measure?: TextMeasurer | undefined
  /** 测量用的字体族（只在传了 `measure` 时有意义）。 */
  family?: string | undefined
  /** 测量用的字重（缺省 400，与 `fitTextPolicy` 一致；组件实际用 700）。 */
  weight?: number | undefined
}

/** 单条 variant 的排版预算（内部形状）。 */
interface FitBudget {
  maxWidthPx: number
  baseFontPx: number
  maxLines: number
  lineHeight: number
  containerWidthPx: number
  /** 是否允许自动缩字号。`dataCard` / `caption` 有显式字号，不缩。 */
  autoShrink: boolean
}

/**
 * S3（2026-11-11）：`timecode` 变体的**排版口径文本**。
 *
 * 组件渲染的是「标签 + 帧级时间码（恒 11 字符 `HH:MM:SS:FF`）」整行，若排版只按
 * `text`（标签，常 3 字符）算字号，时间码必然被层的 `overflow:hidden` 裁掉
 * （真机实测只剩 "REC 0"）。组件与体检**必须**共用本 helper —— 排版决策只有一份
 * （0B 不变量），两处各写一份必然漂移。
 */
export function textFitSizingText(
  variant: TextFitVariant,
  text: string | string[],
): string | string[] {
  if (variant !== 'timecode') return text
  const label = Array.isArray(text) ? text.join(' ') : text
  return `${label} 00:00:00:00`
}

/** `text` → 原文串（数组按 variant 的拼接口径拼接）。 */
export function rawTextOf(text: string | string[], variant: TextFitVariant): string {
  if (!Array.isArray(text)) return text
  // dataCard 的标题历来是「一行空格拼接」（组件 `lines.join(' ')`）；其余 variant 按作者分行。
  return text.join(variant === 'dataCard' ? ' ' : '\n')
}

/** 作者显式声明的行数（数组长度；字符串按 `\n` 计）。 */
function declaredLineCount(text: string | string[]): number {
  if (Array.isArray(text)) return Math.max(1, text.length)
  return Math.max(1, text.split('\n').length)
}

/** 按 variant 求预算（**与组件逐项对齐**，改这里就是改渲染）。 */
function resolveBudget(input: TextFitPlanInput): FitBudget {
  const { variant, canvasWidth, canvasHeight, box } = input
  const positive = (value: number, fallback: number): number =>
    Number.isFinite(value) && value > 0 ? value : fallback
  const canvasW = positive(canvasWidth, DESIGN_CANVAS_WIDTH)
  const canvasH = positive(canvasHeight, DESIGN_CANVAS_HEIGHT)
  /**
   * 基准号 → 当前画布的实际字号（口径见 `type-scale.ts`）。
   *
   * 只作用于 `title` / `bullets` / `timecode` 这三个**绝对 px** 的 variant。
   * 另外三个变体各有自己的相对口径，不能再乘一次，否则会双缩放：
   * - `subtitle` —— 横向文本，真正的约束是宽度（`maxWidthPx` 已按 `canvasW` 算），
   *   按画布高放大会让整行占满画面；
   * - `caption` —— 已经是 `canvasH × 0.11` 的比例口径；
   * - `dataCard` —— 由容器宽驱动（`dataCardMetrics` 的 `scale`），本身会随画布收放。
   */
  const fontPxOf = (designPx: number): number => scaleDesignPx(designPx, canvasH)

  if (variant === 'subtitle') {
    // 预算口径在 `subtitle-fit.ts`（带 box 按盒子算，不带 box 走老参数）。
    const budget = subtitleFitBudget({
      box: box === undefined ? undefined : { w: box.w, h: box.h },
      canvasWidth: canvasW,
      canvasHeight: canvasH,
    })
    return {
      maxWidthPx: budget.maxWidthPx,
      baseFontPx: budget.baseFontPx,
      maxLines: budget.maxLines,
      lineHeight: SUBTITLE_LINE_HEIGHT,
      containerWidthPx: budget.maxWidthPx + budget.padX * 2,
      autoShrink: true,
    }
  }

  if (variant === 'title') {
    // 0B-4 缺陷修复：旧实现**完全没看 box**（一律按画布 90% 算），窄盒里的标题
    // 算出的字号偏大 ⇒ 折行后被盒子的 `overflow:hidden` 两侧裁掉。
    const boxWidthPx = box === undefined ? undefined : (box.w / 100) * canvasW
    const maxWidthPx = boxWidthPx !== undefined && Number.isFinite(boxWidthPx) && boxWidthPx > 0
      ? Math.max(TITLE_MIN_WIDTH_PX, boxWidthPx)
      : Math.max(240, canvasW * 0.9)
    return {
      maxWidthPx,
      baseFontPx: fontPxOf(TITLE_BASE_FONT_PX),
      maxLines: TITLE_MAX_LINES,
      lineHeight: TITLE_LINE_HEIGHT,
      containerWidthPx: maxWidthPx,
      autoShrink: true,
    }
  }

  if (variant === 'bullets') {
    // 0B-4 缺陷修复：旧实现容器宽写死 900（480p 画布 864 时直接溢出画面），
    // 且折行按 900 算、**没扣 42px 圆点**（18 点 + 24 右距）⇒ 估算比实际宽 5%。
    // 容器上限与圆点占位都跟字号一起缩放（都是同一套「按 1080 高设计」的 px 常量）；
    // 外层 `min(..., canvasW × 0.9)` 仍是画布硬约束，不会因为放大而溢出画面。
    const containerWidthPx = Math.min(
      fontPxOf(BULLETS_CONTAINER_MAX_PX),
      Math.max(fontPxOf(300), canvasW * 0.9),
    )
    return {
      maxWidthPx: Math.max(80, containerWidthPx - fontPxOf(BULLET_DOT_ALLOWANCE_PX)),
      baseFontPx: fontPxOf(BULLETS_BASE_FONT_PX),
      maxLines: BULLETS_MAX_LINES,
      lineHeight: 1.35,
      containerWidthPx,
      autoShrink: true,
    }
  }

  if (variant === 'timecode') {
    // S1-B：HUD 时间码 = 标签 + 固定 11 字符的 `HH:MM:SS:FF`，**不缩号**（缩出来的
    // 时间码没有 HUD 感）；宽度给足（折行上限 = 标签行数），溢出在 1080p 下不现实。
    const maxWidthPx = Math.max(240, canvasW * 0.5)
    return {
      maxWidthPx,
      baseFontPx: fontPxOf(TIMECODE_BASE_FONT_PX),
      maxLines: declaredLineCount(input.text),
      lineHeight: 1.2,
      containerWidthPx: maxWidthPx,
      autoShrink: false,
    }
  }

  if (variant === 'dataCard') {
    // 数据卡的字号由 `dataCardMetrics` 的缩放系数决定（窄/矮盒子整体等比缩小），
    // 且**不做**自动缩号 ⇒ 这里的 plan 只用于上报「标题折行数超过设计行数」。
    const rows = Math.max(0, Math.round(input.dataRows ?? 0))
    const designHeight = dataCardDesignHeight({ titleLines: declaredLineCount(input.text), dataRows: rows })
    const metric = dataCardMetrics(box, canvasW, { canvasHeight: canvasH, designHeight })
    const px = (value: number): number => Math.max(1, Math.round(value * metric.scale))
    const paddingX = px(DATA_CARD_PADDING_X)
    return {
      maxWidthPx: Math.max(80, metric.outerWidth - paddingX * 2),
      baseFontPx: px(DATA_CARD_TITLE_FONT_PX),
      // 设计高度就是按「作者声明行数」算的 ⇒ 折行数超过它就装不下（会被盒上下裁字）。
      maxLines: declaredLineCount(input.text),
      lineHeight: DATA_CARD_TITLE_LINE_HEIGHT / DATA_CARD_TITLE_FONT_PX,
      containerWidthPx: metric.outerWidth,
      autoShrink: false,
    }
  }

  // caption（词级字幕）：字号/折行宽都是显式的，组件不做缩号。
  const explicitFont = input.caption?.fontSize
  const baseFontPx = explicitFont !== undefined && Number.isFinite(explicitFont) && explicitFont > 0
    ? Math.round(explicitFont)
    : Math.round(canvasH * CAPTION_FONT_RATIO)
  const widthPercent = input.caption?.widthPercent
  const percent = widthPercent !== undefined && Number.isFinite(widthPercent) && widthPercent > 0
    ? widthPercent
    : CAPTION_DEFAULT_WIDTH_PERCENT
  const maxWidthPx = Math.max(80, canvasW * (percent / 100))
  return {
    maxWidthPx,
    baseFontPx,
    maxLines: CAPTION_SOFT_MAX_LINES,
    lineHeight: 1.15,
    containerWidthPx: maxWidthPx,
    autoShrink: false,
  }
}

/**
 * 求一条文本轨的排版计划（纯函数）。
 *
 * 口径与 `TextCard.tsx` 的四个分支逐项对齐：**未缩号且未溢出 ⇒ `renderText` 就是原文**
 *（老 manifest 逐像素不变）；缩了字号或确实溢出才算行。
 */
export function planTextFit(input: TextFitPlanInput): TextFitPlan {
  const budget = resolveBudget(input)
  const raw = rawTextOf(input.text, input.variant)
  const base = Math.max(1, budget.baseFontPx)
  const minFont = Math.max(1, Math.min(base, base * 0.55))
  const fit = fitTextPolicy(raw, {
    maxWidthPx: budget.maxWidthPx,
    baseFontPx: base,
    maxLines: budget.maxLines,
    lineHeight: budget.lineHeight,
    // 不缩号的 variant 把下限钉在基准字号上 ⇒ 策略的缩号循环一次都不跑。
    ...(budget.autoShrink ? {} : { minFontPx: base }),
    ...(input.measure === undefined ? {} : { measure: input.measure }),
    ...(input.family === undefined ? {} : { family: input.family }),
    ...(input.weight === undefined ? {} : { weight: input.weight }),
  })
  const overflow = fit.lines.length > budget.maxLines
  // 「没缩号」= 字号没降且没溢出 ⇒ 原样交给浏览器（它才知道真正的折行点）。
  const shrunk = budget.autoShrink && !(fit.fontPx >= base && !overflow)
  const fontPx = budget.autoShrink ? fit.fontPx : base
  return {
    variant: input.variant,
    renderText: shrunk ? fit.lines.join('\n') : raw,
    fontPx,
    baseFontPx: base,
    maxLines: budget.maxLines,
    lines: fit.lines,
    overflow,
    atMinFont: overflow && budget.autoShrink && fontPx <= minFont + 1e-6,
    maxWidthPx: budget.maxWidthPx,
    containerWidthPx: budget.containerWidthPx,
  }
}

/**
 * 该预算下「装得下多少个中文字」—— 警告文案里的可执行建议。
 *
 * 按汉字全角宽（1 em）反算，向下取整；中英混排会比它多装几个字符（README/契约里都写
 * 「按中文计」，宁可建议偏保守 —— 建议偏大等于没建议）。
 */
export function suggestedMaxChars(plan: Pick<TextFitPlan, 'maxWidthPx' | 'maxLines' | 'baseFontPx'>): number {
  const perLine = plan.maxWidthPx / Math.max(1, plan.baseFontPx)
  return Math.max(1, Math.floor(perLine * Math.max(1, plan.maxLines)))
}

/** 一句话定位（警告文案共用）：`《轨 id》`；空 id 用于校验层（那里自己拼定位）。 */
function labelOf(id: string): string {
  return id.length === 0 ? '' : `《${id}》`
}

/**
 * 溢出警告文案（**必须可执行**：给「改短到 N 字」或「加大 box」两条出路）。
 *
 * 两档（任务包 §2 决策 3）：缩到下限仍溢出 = 严重；还能再缩 = 提示。
 */
export function textFitOverflowWarning(
  id: string,
  plan: Pick<TextFitPlan, 'variant' | 'fontPx' | 'baseFontPx' | 'maxLines' | 'lines' | 'atMinFont' | 'maxWidthPx'>,
): string {
  const over = plan.lines.length - plan.maxLines
  const chars = suggestedMaxChars(plan)
  if (plan.variant === 'caption') {
    return `${labelOf(id)}字幕折成 ${plan.lines.length} 行（软上限 ${plan.maxLines} 行）——不会裁字，但会顶到画面下沿；建议拆句到 ${chars} 字以内。`
  }
  if (plan.variant === 'dataCard') {
    return `${labelOf(id)}数据卡标题在可用宽 ${Math.round(plan.maxWidthPx)}px 下折成 ${plan.lines.length} 行，`
      + `而卡片设计高度按 ${Math.max(1, plan.maxLines)} 行算 ⇒ 多出的 ${over} 行会被盒子上下一刀裁掉；`
      + `请把标题压到 ${chars} 字以内，或加大该轨 box 的高度。`
  }
  if (plan.atMinFont) {
    return `${labelOf(id)}文字已缩到字号下限 ${plan.fontPx}px（基准 ${plan.baseFontPx}px）仍超出 ${plan.maxLines} 行上限，`
      + `成片会裁掉多出的 ${over} 行 —— 请把文案压到 ${chars} 字以内，或加大该轨 box（当前可用宽 ${Math.round(plan.maxWidthPx)}px）。`
  }
  return `${labelOf(id)}文字放不下：缩到 ${plan.fontPx}px（基准 ${plan.baseFontPx}px）后仍是 ${plan.lines.length} 行 > ${plan.maxLines} 行上限，`
    + `成片会裁掉多出的 ${over} 行 —— 请把文案压到 ${chars} 字以内，或加大该轨 box（当前可用宽 ${Math.round(plan.maxWidthPx)}px）。`
}

/**
 * Node 侧静态合同（L1）：`validateManifest` 用的一份**无需测量**的粗判。
 *
 * 为什么是 warning 而不是 error（与 `任务包-0B` §2 决策 4 的原始写法不同，拍板见决策日志
 * **D-19**）：Node 侧没有 canvas，折行全靠字符宽度估算；把估算结果做成 error 等于让估算
 * 有权**拒收**一份能渲的 manifest —— 一次误判就打断整条渲染流水线。而 `render_composition`
 * 恰恰以 `errors` 非空为拒收判据。真实测量在浏览器（prepare 阶段）做，那份进 `report.textFit`。
 */
export function textCardCapacityWarnings(input: {
  id?: string | undefined
  variant: TextFitVariant
  text: string | string[]
  box?: { x: number; y: number; w: number; h: number } | undefined
  canvasWidth: number
  canvasHeight: number
  dataRows?: number | undefined
}): string[] {
  try {
    const plan = planTextFit(input)
    if (!plan.overflow) return []
    return [textFitOverflowWarning(input.id ?? '', plan)]
  } catch {
    // 静态合同是「锦上添花」：算不出来就当没有，绝不因为它让校验崩掉。
    return []
  }
}
