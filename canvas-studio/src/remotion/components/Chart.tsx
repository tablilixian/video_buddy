/**
 * 能力基准 #04 收口（2026-10-31）：**数据图表**轨 —— 柱状图 / 柱状+折线双轴图。
 *
 * 对标 bench `04-chart-map.tsx`（像素级同款视觉，参数为 bench 实测值）：
 * - 柱子错峰生长（每根延迟 8 帧、26 帧长完），高度严格 = 数值比例（数据保真）；
 * - 柱顶数值标签（长完后出现）+ 横向网格线 + 左右双轴刻度；
 * - `dual` 折线在柱子长完后从左往右 clip 揭示（SVG polyline，viewBox 0–100）。
 * 全部纯帧函数（确定性铁律）；布局百分比化 ⇒ 任意画幅/box 下等比成立。
 * 字号随画布宽缩放（bench 的 21px@1920 ≈ 画布宽的 1.1%）。
 */
import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import type { ChartTrack } from '../manifest.js'
import { resolveAnimatedStyle } from '../animated-style.js'
import { useFontFamilyStack } from './font-context.js'

/** 数值标签格式：最多两位小数、去尾零（7.2666 → 7.27；8 → 8）。 */
function formatValue(v: number): string {
  return String(Number(v.toFixed(2)))
}

/** 数轴顶值：数据最大值 × 1.08 的余量（标签不顶格）。 */
function axisMax(values: readonly number[]): number {
  return Math.max(...values, 0) * 1.08
}

const DEFAULT_BAR_COLOR = '#4f9cf9'
const DEFAULT_LINE_COLOR = '#ffb454'

export const Chart: React.FC<{ track: ChartTrack }> = ({ track }) => {
  const frame = useCurrentFrame()
  const { width: canvasWidth } = useVideoConfig()
  const fontFamily = useFontFamilyStack()
  const anim = resolveAnimatedStyle(track, frame)

  const { labels, values, unit = '', lineUnit = '' } = track
  const n = labels.length
  const barMax = axisMax(values)
  const lineMax = track.lineValues ? axisMax(track.lineValues) : 0
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

  // 布局（百分比，铺满 box / 画布）：左轴留 9%、右轴留 8%、底留 12%（类目标签）
  const plot = { left: 9, right: 8, top: 7, bottom: 12 }
  const plotW = 100 - plot.left - plot.right
  const plotH = 100 - plot.top - plot.bottom
  const slot = plotW / Math.max(1, n)

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
      <AbsoluteFill style={{ margin: `${plot.top}% ${plot.right}% ${plot.bottom}% ${plot.left}%` }}>
        {/* 网格线 + 左轴（主序列）+ 右轴（副序列，仅 dual） */}
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
              }}
            >
              {formatValue(t * barMax)}
              {unit}
            </div>
            {track.lineValues ? (
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
                {formatValue(t * lineMax)}
                {lineUnit}
              </div>
            ) : null}
          </React.Fragment>
        ))}

        {/* 柱：错峰生长，高度 = 数值比例（数据保真）；数值标签长完才出现 */}
        {values.map((v, i) => {
          const grown = interpolate(frame, [i * stagger, i * stagger + grow], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })
          const eased = 1 - (1 - grown) * (1 - grown)
          const h = (v / barMax) * plotH * eased
          return (
            <React.Fragment key={i}>
              <div
                style={{
                  position: 'absolute',
                  left: `${(i * slot + slot * 0.18).toFixed(3)}%`,
                  width: `${(slot * 0.64).toFixed(3)}%`,
                  top: `${(100 - (h / plotH) * 100).toFixed(3)}%`,
                  height: `${((h / plotH) * 100).toFixed(3)}%`,
                  background: `linear-gradient(180deg, ${barColor}, rgba(79,156,249,0.10))`,
                  borderRadius: '4px 4px 0 0',
                }}
              />
              {grown >= 1 ? (
                <div
                  style={{
                    position: 'absolute',
                    left: `${(i * slot).toFixed(3)}%`,
                    width: `${slot.toFixed(3)}%`,
                    top: `${((1 - h / plotH) * 100 - 7).toFixed(3)}%`,
                    textAlign: 'center',
                    fontFamily,
                    fontSize: valueFont,
                    color: '#e8eefc',
                  }}
                >
                  {formatValue(v)}
                  {unit}
                </div>
              ) : null}
              <div
                style={{
                  position: 'absolute',
                  left: `${(i * slot).toFixed(3)}%`,
                  width: `${slot.toFixed(3)}%`,
                  top: '100%',
                  marginTop: axisFont * 0.6,
                  textAlign: 'center',
                  fontFamily,
                  fontSize: axisFont,
                  color: 'rgba(138,160,198,0.95)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {labels[i]}
              </div>
            </React.Fragment>
          )
        })}

        {/* 折线（dual）：右轴量纲，clip inset 从左往右揭示 */}
        {track.lineValues ? (
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
              points={track.lineValues
                .map(
                  (v, i) =>
                    `${(((i + 0.5) / Math.max(1, n)) * 100).toFixed(2)},${(100 - (v / lineMax) * 100).toFixed(2)}`,
                )
                .join(' ')}
            />
            {track.lineValues.map((v, i) => (
              <circle
                key={i}
                cx={((i + 0.5) / Math.max(1, n)) * 100}
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
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
