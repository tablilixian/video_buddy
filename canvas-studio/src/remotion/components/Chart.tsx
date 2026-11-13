/**
 * 能力基准 #04 收口（2026-10-31）+ P2' 扩型（2026-11-03）：**数据图表**轨 —— 柱状 / 柱状+折线双轴 / 独立折线。
 *
 * 对标 bench `04-chart-map.tsx`（像素级同款视觉，参数为 bench 实测值）：
 * - 柱子错峰生长（每根延迟 8 帧、26 帧长完），高度严格 = 数值比例（数据保真）；
 * - 柱顶数值标签（长完后出现）+ 横向网格线 + 左右双轴刻度；
 * - `dual` 折线在柱子长完后从左往右 clip 揭示（SVG polyline，viewBox 0–100）；
 * - `line`（P2'）：主序列 `values` 直接画折线（左轴、折线色用 `color`），同一揭示动画，
 *   揭示波前扫过的点依次弹出数值标签；不画柱子。
 * 全部纯帧函数（确定性铁律）；布局百分比化 ⇒ 任意画幅/box 下等比成立。
 * 字号随画布宽缩放（bench 的 21px@1920 ≈ 画布宽的 1.1%）。
 */
import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import { donutSlicePath, gaugeDashArray, GAUGE_R, GAUGE_STROKE_WIDTH, PIE_PALETTE, sliceFractions, wedgePath } from '../chart-pie.js'
import type { ChartTimelineData } from '../chart-data.js'
import type { ChartTrack } from '../manifest.js'
import {
  chartCategoryLabelTopPercent,
  chartLabelBox,
  chartLabelFontPx,
  chartPlotFor,
  chartPointXPercent,
  chartSlotPercent,
  CHART_TITLE_BAND_PERCENT,
  pickLabelIndices,
} from '../chart-layout.js'

import { resolveAnimatedStyle } from '../animated-style.js'
import { countUpTextAt } from '../count-up.js'
import { useFontFamilyStack } from './font-context.js'

/** 数值标签格式：最多两位小数、去尾零（7.2666 → 7.27；8 → 8）。 */
function formatValue(v: number): string {
  return String(Number(v.toFixed(2)))
}

/**
 * 刻度文案：轴上的值只用来定标，不该带 2 位小数。
 *
 * 真机事故：20 个月新增的轴顶 ≈ 52,550，四等分后出现 `47108.52 人` —— 四位有效
 * 数字挤在 74px 的轴标签位里既读不出量级也压线。按量级收小数位（≥10 取整），
 * 数值本身的量级不动（不换单位，避免与柱顶标签口径打架）。
 */
function formatTick(v: number): string {
  const a = Math.abs(v)
  if (a >= 10) return String(Math.round(v))
  if (a >= 1) return String(Number(v.toFixed(1)))
  return String(Number(v.toFixed(2)))
}

/** 数轴顶值：数据最大值 × 1.08 的余量（标签不顶格）。 */
function axisMax(values: readonly number[]): number {
  return Math.max(...values, 0) * 1.08
}

const DEFAULT_BAR_COLOR = '#4f9cf9'
const DEFAULT_LINE_COLOR = '#ffb454'

/**
 * 4.1（2026-11-04）：pie / donut / gauge 渲染分支。
 *
 * 非等比护栏：SVG 用**缺省等比 meet** 缩放（绝不 `preserveAspectRatio="none"`），
 * 路径全部来自 `chart-pie.ts` 的 0–100 正方形 viewBox —— 圆永远是圆。
 * pie/donut：逐片错峰浮现（与柱状图 stagger 同参）+ 右侧图例（色点 + 类目 + 数值）；
 * gauge：整圆 stroke-dasharray 扫描（0→45% 轨长），中心百分比复用 `countUpTextAt`
 * （与 dataCard 数位滚动同语言），labels[0] 落环下说明位。
 */
const PieFamily: React.FC<{
  track: ChartTrack
  labels: readonly string[]
  values: readonly number[]
  unit: string
  dur: number
  frame: number
  fontFamily: string
  axisFont: number
  valueFont: number
}> = ({ track, labels, values, unit, dur, frame, fontFamily, axisFont, valueFont }) => {
  const isGauge = track.variant === 'gauge'
  const isDonut = track.variant === 'donut'
  const fracs = sliceFractions(values)
  const palette = track.palette !== undefined && track.palette.length > 0 ? track.palette : PIE_PALETTE
  const color0 = track.color ?? palette[0] ?? DEFAULT_BAR_COLOR
  const sliceColor = (i: number): string => (i === 0 ? color0 : palette[i % palette.length] ?? DEFAULT_BAR_COLOR)
  const stagger = Math.min(8, Math.max(2, Math.round(dur * 0.02)))
  const sum = values.reduce((acc, v) => acc + Math.max(0, v), 0)

  if (isGauge) {
    const max = track.gaugeMax ?? 100
    const progress = Math.min(1, Math.max(0, (values[0] ?? 0) / max))
    // 扫针与中心数字的时长：短轨按 45% 铺满，长轨**必须封顶**。
    // 不封顶时 dur 是整段跨句窗口（真机 S4 的 gauge 跨 8 句 ≈ 700 帧），扫针要 315 帧
    // 才走完，中段长时间停在「4%」这类中间值上，和旁边的标题 6.94% 直接矛盾。
    const revealFrames = Math.min(Math.max(8, Math.round(dur * 0.45)), 40)
    const sweep = interpolate(frame, [0, revealFrames], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })
    const dash = gaugeDashArray(progress * sweep)
    // 中心数字用**原始值**（6.94%），不能 `Math.round(progress*100)` ——
    // 那会把 6.94% 抹成 7%，标题与实际读数对不上。
    const centerText = countUpTextAt(`${formatValue(values[0] ?? 0)}${unit}`, frame, revealFrames)
    return (
      <AbsoluteFill>
        <svg viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}>
          <circle cx={50} cy={50} r={GAUGE_R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={GAUGE_STROKE_WIDTH} />
          <circle
            cx={50}
            cy={50}
            r={GAUGE_R}
            fill="none"
            stroke={color0}
            strokeWidth={GAUGE_STROKE_WIDTH}
            strokeLinecap="round"
            strokeDasharray={dash}
            transform="rotate(-90 50 50)"
          />
        </svg>
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontFamily, fontSize: valueFont * 2.2, fontWeight: 600, color: '#e8eefc' }}>{centerText}</div>
        </AbsoluteFill>
        {labels[0] ? (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: '66%',
              textAlign: 'center',
              fontFamily,
              fontSize: axisFont,
              color: 'rgba(138,160,198,0.95)',
            }}
          >
            {labels[0]}
          </div>
        ) : null}
      </AbsoluteFill>
    )
  }

  // pie / donut：图占左侧 64%，图例占右侧 36%（窄盒下图例仍在右，SVG 等比 meet 内缩）
  let startFrac = 0
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '64%' }}>
        <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', display: 'block' }}>
          {fracs.map((f, i) => {
            const sliceStart = startFrac
            startFrac += f
            const appear = interpolate(frame, [i * stagger, i * stagger + 12], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            })
            if (appear <= 0 || f <= 0) return null
            const d = isDonut ? donutSlicePath(f, sliceStart) : wedgePath(f, sliceStart)
            return <path key={i} d={d} fill={sliceColor(i)} opacity={appear} />
          })}
        </svg>
      </div>
      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '36%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: valueFont * 0.5 }}>
        {values.map((v, i) => {
          const appear = interpolate(frame, [i * stagger + 6, i * stagger + 18], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })
          if (appear <= 0) return null
          const pct = sum > 0 ? Math.round((Math.max(0, v) / sum) * 100) : 0
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: axisFont * 0.6, opacity: appear }}>
              <span style={{ width: axisFont * 0.7, height: axisFont * 0.7, borderRadius: '50%', background: sliceColor(i), flex: 'none' }} />
              <span style={{ fontFamily, fontSize: axisFont, color: 'rgba(138,160,198,0.95)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {labels[i] ?? `#${i + 1}`}
              </span>
              <span style={{ fontFamily, fontSize: valueFont, color: '#e8eefc', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                {formatValue(v)}
                {unit} · {pct}%
              </span>
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

export const Chart: React.FC<{ track: ChartTrack; timelineData?: ChartTimelineData | null | undefined }> = ({
  track,
  timelineData,
}) => {
  const frame = useCurrentFrame()
  const { width: canvasWidth, height: canvasHeight } = useVideoConfig()
  const fontFamily = useFontFamilyStack()
  const anim = resolveAnimatedStyle(track, frame)

  // 数据来源（A2）：source:'timeline' 时由 Root 传入推导数据，优先于内联字段。
  const labels = timelineData?.labels ?? track.labels ?? []
  const values = timelineData?.values ?? track.values ?? []
  const lineValues = timelineData && track.variant === 'dual' ? timelineData.lineValues : track.lineValues
  const unit = timelineData?.unit ?? track.unit ?? ''
  const lineUnit = timelineData?.lineUnit ?? track.lineUnit ?? ''
  const n = labels.length
  const barMax = axisMax(values)
  const lineMax = lineValues ? axisMax(lineValues) : 0
  const dur = Math.max(1, track.durationInFrames)

  // 入场时序（bench 实测参数按轨长归一）：柱子错峰 8 帧/根、26 帧长完；折线 30%→55% 揭示。
  const stagger = Math.min(8, Math.max(2, Math.round(dur * 0.02)))
  const grow = 26
  const lineReveal = interpolate(frame, [dur * 0.3, dur * 0.55], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  // 字号（px，随画布宽缩放；bench@1920：轴/类目 21、数值 22）
  const axisFont = Math.max(11, canvasWidth * 0.011)
  const valueFont = Math.max(12, canvasWidth * 0.0115)
  const barColor = track.color ?? DEFAULT_BAR_COLOR
  const lineColor = track.lineColor ?? DEFAULT_LINE_COLOR

  // 布局（百分比，铺满 box / 画布）：左轴留 9%、右轴留 8%、底留 12%（类目标签）；
  // 标题在场时顶边让出一个标题带（老 manifest 无 title ⇒ 几何逐像素不变，Q-A4）。
  const hasTitle = typeof track.title === 'string' && track.title.length > 0
  const plot = chartPlotFor(hasTitle)
  const plotW = 100 - plot.left - plot.right
  const plotH = 100 - plot.top - plot.bottom
  // 容器内百分比尺度：下面的柱 / 标签 / 折线点都住在这个已 inset 的容器里，
  // 尺子只有一把（见 chartSlotPercent 注释里的真机事故）。
  const slot = chartSlotPercent(n)
  // 绘图区像素宽（用于判断标签放不放得下）：盒宽 × 绘图区占比。
  const plotWidthPx = canvasWidth * ((track.box?.w ?? 100) / 100) * (plotW / 100)

  // 标签抽稀（Q-A3）：只抽标签不改数据点；首末点强制保留（末点是 countUp 终值锚点）。
  const pickedLabels = new Set(pickLabelIndices(n, track.labelEvery, track.maxLabels))
  // 柱顶数值标签：缺省全画（老 manifest 不变）；给了 `maxValueLabels` 就等距抽取。
  // 槽宽不足时相邻数字会互相压住（20 根柱一柱一数 = 真机事故），抽稀是唯一解 ——
  // 不能靠缩字号，缩到能塞下就低于可读下限了。
  const valueLabelIndices = new Set(
    track.maxValueLabels === undefined ? values.map((_, i) => i) : pickLabelIndices(n, undefined, track.maxValueLabels),
  )
  // 抽稀后的实际间距（以槽计）：标签盒按这个宽度给，否则 5 字符的 `25/04` 照样被剪成 `25…`。
  const labelStep = n / Math.max(1, pickedLabels.size)
  const valueStep = n / Math.max(1, valueLabelIndices.size)
  // 柱顶数值标签的下限：矮柱（断崖后的月度只剩几百）标签会掉进类目标签带，
  // 直接压在 `26/06` 这种月份上（真机 S3/S9：轴上一排「26/05 4 6 0 人 26/08」）。
  // 压到标签带就往上提，贴着绘图区底边排 —— 数字仍在自己那根柱的列里。
  const plotHeightPx = canvasHeight * ((track.box?.h ?? 100) / 100) * (plotH / 100)
  const valueLabelMinTop = chartCategoryLabelTopPercent(hasTitle) - (valueFont * 1.2 * 100) / Math.max(1, plotHeightPx)

  // CV-334 同款分层：整轨位置/缩放走 layerTransform，box 在场改盒子定位层。
  const box = track.box
  const layer: React.CSSProperties = {
    opacity: anim.opacity,
    ...(box === undefined
      ? { transform: anim.layerTransform, transformOrigin: 'center' }
      : {
          left: `${box.x}%`,
          top: `${box.y}%`,
          width: `${box.w}%`,
          height: `${box.h}%`,
          transform: `translate(-50%, -50%) ${anim.shapeTransform}`,
          overflow: 'hidden',
        }),
    ...(anim.blend === 'normal' ? {} : { mixBlendMode: anim.blend }),
    ...(anim.fx.filter !== undefined ? { filter: anim.fx.filter } : {}),
    ...(anim.fx.maskImage !== undefined ? { maskImage: anim.fx.maskImage } : {}),
  }

  return (
    <AbsoluteFill style={{ fontFamily, ...layer }}>
      {/* 图上标题（Q-A4）：住在顶带里，绘图区随之让位（chartPlotFor） */}
      {hasTitle && typeof track.title === 'string' ? (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: `${plot.left}%`,
            width: `${plotW}%`,
            height: `${CHART_TITLE_BAND_PERCENT}%`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily,
            fontSize: Math.max(13, canvasWidth * 0.0125),
            fontWeight: 600,
            color: 'rgba(232,238,252,0.92)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {track.title}
        </div>
      ) : null}
      {/*
        绘图区留白必须走 **inset**（top/right/bottom/left），不能用 `margin`：
        CSS 百分比 margin **四个方向都按包含块宽度**解析（不是高度），盒高 38% 时
        `margin-top:15%` 会被算成 0.15×宽（1920×0.84 时 ≈242px）而不是 0.15×高，
        于是整块绘图区被推到底部之外，再由外层 `overflow:hidden` 裁掉 ——
        真机表现是「柱图只画出最左边一两根柱」，其余全在可视盒下面（DOM 几何完全正确，
        只有像素缺失，极难从结构上发现）。inset 的 top/bottom 百分比才按高度解析。
      */}
      <AbsoluteFill
        style={{
          top: `${plot.top}%`,
          right: `${plot.right}%`,
          bottom: `${plot.bottom}%`,
          left: `${plot.left}%`,
          width: 'auto',
          height: 'auto',
        }}
      >
        {/* 4.1：pie / donut / gauge 分支（无轴无网格，整域交给 PieFamily） */}
        {track.variant === 'pie' || track.variant === 'donut' || track.variant === 'gauge' ? (
          <PieFamily
            track={track}
            labels={labels}
            values={values}
            unit={unit}
            dur={dur}
            frame={frame}
            fontFamily={fontFamily}
            axisFont={axisFont}
            valueFont={valueFont}
          />
        ) : null}

        {/* 网格线 + 左轴（主序列）+ 右轴（副序列，仅 dual）；pie/donut/gauge 不铺 */}
        {track.variant !== 'pie' && track.variant !== 'donut' && track.variant !== 'gauge' ? (
          <React.Fragment>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <React.Fragment key={t}>
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: `${(1 - t) * 100}%`,
                height: 1,
                background: 'rgba(255,255,255,0.08)',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: -axisFont * 3.6,
                top: `${(1 - t) * 100}%`,
                transform: 'translateY(-50%)',
                fontFamily,
                fontSize: axisFont,
                color: barColor,
                width: axisFont * 3.4,
                textAlign: 'right',
                opacity: 0.9,
                // 刻度文案必须单行：`47109` + `人` 在 3.4em 宽的盒里折成两行，
                // 第二个字落到下一行轴位、与下方刻度错位（真机 S3/S9 满屏都是孤立「人」）。
                whiteSpace: 'nowrap',
              }}
            >
              {formatTick(t * barMax)}
              {unit}
            </div>
            {lineValues ? (
              <div
                style={{
                  position: 'absolute',
                  right: -axisFont * 3.6,
                  top: `${(1 - t) * 100}%`,
                  transform: 'translateY(-50%)',
                  fontFamily,
                  fontSize: axisFont,
                  color: lineColor,
                  opacity: 0.9,
                }}
              >
                {formatTick(t * lineMax)}
                {lineUnit}
              </div>
            ) : null}
          </React.Fragment>
        ))}

        {/* 柱：错峰生长，高度 = 数值比例（数据保真）；数值标签长完才出现。
            P2'：variant:'line' 不画柱子 —— 主序列走下方折线分支，类目标签单独铺。 */}
        {track.variant !== 'line' ? values.map((v, i) => {
          const grown = interpolate(frame, [i * stagger, i * stagger + grow], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })
          const eased = 1 - (1 - grown) * (1 - grown)
          const h = (v / barMax) * plotH * eased
          const center = chartPointXPercent(i, n)
          const valueBox = chartLabelBox(i, n, valueStep)
          const catBox = chartLabelBox(i, n, labelStep)
          const catText = labels[i] ?? ''
          const catFont = chartLabelFontPx(catText, axisFont, (catBox.width / 100) * plotWidthPx)
          return (
            <React.Fragment key={i}>
              <div
                style={{
                  position: 'absolute',
                  left: `${(center - slot * 0.32).toFixed(3)}%`,
                  width: `${(slot * 0.64).toFixed(3)}%`,
                  top: `${(100 - (h / plotH) * 100).toFixed(3)}%`,
                  height: `${((h / plotH) * 100).toFixed(3)}%`,
                  background: `linear-gradient(180deg, ${barColor}, rgba(79,156,249,0.10))`,
                  borderRadius: '4px 4px 0 0',
                }}
              />
              {grown >= 1 && valueLabelIndices.has(i) ? (
                <div
                  style={{
                    position: 'absolute',
                    left: `${valueBox.left.toFixed(3)}%`,
                    width: `${valueBox.width.toFixed(3)}%`,
                    top: `${Math.min((1 - h / plotH) * 100 - 7, valueLabelMinTop).toFixed(3)}%`,
                    textAlign: 'center',
                    fontFamily,
                    fontSize: valueFont,
                    color: '#e8eefc',
                    // 同理单行：盒宽按抽稀后的间距给，`42055人` 才不会被折成「42055 / 人」。
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatValue(v)}
                  {unit}
                </div>
              ) : null}
              {pickedLabels.has(i) ? (
                <div
                  style={{
                    position: 'absolute',
                    left: `${catBox.left.toFixed(3)}%`,
                    width: `${catBox.width.toFixed(3)}%`,
                    // 2026-11-06 修（真机事故）：此处原为 `top: '100%'` = **容器底部**，
                    // 而布局已经用 `plot.bottom: 12` 在容器内预留了标签带 ⇒ 标签落在
                    // 预留区**下方**，被 box 层的 `overflow: hidden` 整条裁掉（agent 三次
                    // 裁切取证后放弃修复，把年份塞进头部卡绕过）。定位到绘图区底边
                    //（`plot.top + plotH` = 88%）才落在预留带里。
                    top: `${chartCategoryLabelTopPercent(hasTitle).toFixed(3)}%`,
                    marginTop: axisFont * 0.6,
                    textAlign: 'center',
                    fontFamily,
                    fontSize: catFont,
                    color: 'rgba(138,160,198,0.95)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {labels[i]}
                </div>
              ) : null}
            </React.Fragment>
          )
        }) : null}

        {/* P2'：variant:'line' 的类目标签（无柱时单独铺一行，样式与柱状图一致；同受抽稀） */}
        {track.variant === 'line'
          ? labels.map((l, i) => {
            if (!pickedLabels.has(i)) return null
            const catBox = chartLabelBox(i, n, labelStep)
            const catFont = chartLabelFontPx(l, axisFont, (catBox.width / 100) * plotWidthPx)
            return (
            <div
              key={`cat-${i}`}
              style={{
                position: 'absolute',
                left: `${catBox.left.toFixed(3)}%`,
                width: `${catBox.width.toFixed(3)}%`,
                // 同上（折线分支）：`top: '100%'` 会落进 `overflow: hidden` 的裁切区。
                top: `${chartCategoryLabelTopPercent(hasTitle).toFixed(3)}%`,
                marginTop: axisFont * 0.6,
                textAlign: 'center',
                fontFamily,
                fontSize: catFont,
                color: 'rgba(138,160,198,0.95)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {l}
            </div>
            )
          })
          : null}

        {/* P2'：独立折线 —— 主序列 values，左轴量纲，同一 30%→55% 揭示；
            揭示波前扫过的点依次弹出数值标签（HTML 层，避开 viewBox 非等比拉伸） */}
        {track.variant === 'line' && values.length > 0 ? (
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              clipPath: `inset(0 ${(1 - lineReveal) * 100}% 0 0)`,
              display: 'block',
            }}
          >
            <polyline
              fill="none"
              stroke={barColor}
              strokeWidth={2.2}
              vectorEffect="non-scaling-stroke"
              points={values
                .map(
                  (v, i) =>
                    `${chartPointXPercent(i, n).toFixed(2)},${(100 - (v / barMax) * 100).toFixed(2)}`,
                )
                .join(' ')}
            />
            {values.map((v, i) => (
              <circle
                key={i}
                cx={chartPointXPercent(i, n)}
                cy={100 - (v / barMax) * 100}
                r={1.3}
                fill={barColor}
              />
            ))}
          </svg>
        ) : null}
        {track.variant === 'line'
          ? values.map((v, i) =>
            lineReveal >= (i + 0.5) / Math.max(1, n) ? (
              <div
                key={`val-${i}`}
                style={{
                  position: 'absolute',
                  left: `${chartPointXPercent(i, n).toFixed(3)}%`,
                  top: `${((1 - v / barMax) * 100 - 7).toFixed(3)}%`,
                  transform: 'translateX(-50%)',
                  fontFamily,
                  fontSize: valueFont,
                  color: '#e8eefc',
                  whiteSpace: 'nowrap',
                }}
              >
                {formatValue(v)}
                {unit}
              </div>
            ) : null,
          )
          : null}

        {/* 折线（dual）：右轴量纲，clip inset 从左往右揭示 */}
        {lineValues ? (
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              clipPath: `inset(0 ${(1 - lineReveal) * 100}% 0 0)`,
              display: 'block',
            }}
          >
            <polyline
              fill="none"
              stroke={lineColor}
              strokeWidth={2.2}
              vectorEffect="non-scaling-stroke"
              points={lineValues
                .map(
                  (v, i) =>
                    `${chartPointXPercent(i, n).toFixed(2)},${(100 - (v / lineMax) * 100).toFixed(2)}`,
                )
                .join(' ')}
            />
            {lineValues.map((v, i) => (
              <circle
                key={i}
                cx={chartPointXPercent(i, n)}
                cy={100 - (v / lineMax) * 100}
                r={1.3}
                fill={lineColor}
              />
            ))}
            {track.lineLabel ? (
              <text
                x={100}
                y={4}
                textAnchor="end"
                fill={lineColor}
                style={{ fontSize: 4.2, fontFamily }}
              >
                {track.lineLabel}
                {lineUnit}
              </text>
            ) : null}
          </svg>
        ) : null}
          </React.Fragment>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
