/**
 * #04 数据可视化 —— 真实镜头时长的柱状+折线双轴 + 抽象 hexmap（零依赖，纯 DOM/SVG）。
 *
 * 对标官方：`AnimatedBarChart` / `switzerland-map`（地图改 hexmap，§12.2 合规红线：
 * 不做真实地理、不编国界 GeoJSON——hexmap 演示的是"数据 → 几何 → 动画"同一链路）。
 *
 * 要证明的三件事：
 *   1. 柱高与数据一一对应：数据是伊甸园 manifest（8 轨视频轨）的**真实镜头时长**
 *      [240,240,218,240,240,218,218,218] 帧 @30fps，柱高比必须 = 240:218；
 *   2. 双轴：柱 = 单镜时长（左轴 0–8s），折线 = 累计进度（右轴 0–61s）；
 *   3. hexmap：确定性伪随机值（GLSL 式 hash，纯函数）驱动六边形阵列亮起，无任何地理信息。
 *
 * 全部 DOM div + SVG polyline/polygon——#07 已证 DOM <svg> 在 web-renderer 可用。
 */

import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { Badge, BenchFrame, COLORS, FONT_FAMILY } from './shared.js'

export const meta = {
  id: '04',
  axis: 'chart-map',
  title: '数据可视化（柱/折线 + 抽象 hexmap）',
  reference: 'AnimatedBarChart · switzerland-map',
  durationInFrames: 360, // 12s @30fps
  expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: false, minMotion: true },
  stills: [80, 179, 299],
  assets: [],
} as const

/** 伊甸园 manifest（meta.durationInFrames=1832, fps=30）8 条视频轨的真实 durationInFrames。 */
const SHOT_FRAMES = [240, 240, 218, 240, 240, 218, 218, 218] as const
const SHOT_SEC = SHOT_FRAMES.map((f) => f / 30)
const CUM_SEC = SHOT_SEC.reduce<number[]>((acc, s, i) => [...acc, (acc[i - 1] ?? 0) + s], [])
const MAX_BAR = Math.max(...SHOT_SEC)
const MAX_CUM = CUM_SEC[CUM_SEC.length - 1]

/** GLSL 式确定性 hash：fract(sin(x·12.9898 + y·78.233)·43758.5453) */
const hash2 = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const ease = (v: number) => 1 - (1 - clamp01(v)) * (1 - clamp01(v))

/* ---------------------------------- 柱状+折线 ---------------------------------- */

const ChartPanel: React.FC<{ frame: number }> = ({ frame }) => {
  const plotLeft = 150
  const plotRight = 900
  const plotTop = 240
  const plotBottom = 860
  const plotW = plotRight - plotLeft
  const plotH = plotBottom - plotTop
  const bw = plotW / SHOT_FRAMES.length

  // 折线在柱子长完后从左往右画出（clip inset 右侧收进）
  const lineReveal = interpolate(frame, [110, 190], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: 960, height: '100%' }}>
      <div style={{ position: 'absolute', left: 96, top: 130, fontFamily: FONT_FAMILY, fontSize: 34, color: COLORS.ink, fontWeight: 700 }}>
        a) 柱状 + 折线双轴 —— 真实镜头时长
      </div>
      <div style={{ position: 'absolute', left: 96, top: 178, fontFamily: FONT_FAMILY, fontSize: 22, color: COLORS.dim }}>
        数据源：伊甸园 manifest 8 条视频轨 durationInFrames（非假数）
      </div>

      {/* 网格线 + 左轴（单镜 0–8s）+ 右轴（累计 0–61s） */}
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <div key={t}>
          <div
            style={{
              position: 'absolute',
              left: plotLeft,
              right: 60,
              top: plotBottom - t * plotH,
              height: 1,
              background: 'rgba(255,255,255,0.08)',
            }}
          />
          <div style={{ position: 'absolute', left: 66, top: plotBottom - t * plotH - 14, fontFamily: FONT_FAMILY, fontSize: 21, color: COLORS.accent, width: 74, textAlign: 'right' }}>
            {(t * MAX_BAR).toFixed(1)}s
          </div>
          <div style={{ position: 'absolute', left: plotRight + 8, top: plotBottom - t * plotH - 14, fontFamily: FONT_FAMILY, fontSize: 21, color: COLORS.warn, width: 60 }}>
            {(t * MAX_CUM).toFixed(0)}s
          </div>
        </div>
      ))}

      {/* 柱：逐根错峰长出，高度严格 = 时长比例 */}
      {SHOT_SEC.map((sec, i) => {
        const grow = ease((frame - 24 - i * 8) / 26)
        const h = (sec / MAX_BAR) * plotH * grow
        return (
          <div key={i}>
            <div
              style={{
                position: 'absolute',
                left: plotLeft + i * bw + bw * 0.18,
                width: bw * 0.64,
                top: plotBottom - h,
                height: h,
                background: `linear-gradient(180deg, ${COLORS.accent}, rgba(90,210,255,0.10))`,
                borderRadius: '6px 6px 0 0',
              }}
            />
            {grow >= 1 ? (
              <>
                <div
                  style={{
                    position: 'absolute',
                    left: plotLeft + i * bw,
                    width: bw,
                    top: plotBottom - h - 36,
                    textAlign: 'center',
                    fontFamily: FONT_FAMILY,
                    fontSize: 22,
                    color: COLORS.ink,
                  }}
                >
                  {sec.toFixed(2)}
                </div>
                <div style={{ position: 'absolute', left: plotLeft + i * bw, width: bw, top: plotBottom + 12, textAlign: 'center', fontFamily: FONT_FAMILY, fontSize: 21, color: COLORS.dim }}>
                  shot{i + 1}
                </div>
              </>
            ) : null}
          </div>
        )
      })}

      {/* 折线：累计时长（右轴），clip inset 从左往右揭示 */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{
          position: 'absolute',
          left: plotLeft,
          top: plotTop,
          width: plotW,
          height: plotH,
          clipPath: `inset(0 ${(1 - lineReveal) * 100}% 0 0)`,
          display: 'block',
        }}
      >
        <polyline
          fill="none"
          stroke={COLORS.warn}
          strokeWidth={2.4}
          vectorEffect="non-scaling-stroke"
          points={CUM_SEC.map((s, i) => `${(((i + 0.5) / SHOT_FRAMES.length) * 100).toFixed(2)},${(100 - (s / MAX_CUM) * 100).toFixed(2)}`).join(' ')}
        />
        {CUM_SEC.map((s, i) => (
          <circle key={i} cx={((i + 0.5) / SHOT_FRAMES.length) * 100} cy={100 - (s / MAX_CUM) * 100} r={1.4} fill={COLORS.warn} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
    </div>
  )
}

/* ----------------------------------- hexmap ----------------------------------- */

const HEX_COLS = 9
const HEX_ROWS = 5
const HEX_R = 86 // 外接圆半径

/** 尖顶六边形顶点（中心 cx,cy） */
const hexPoints = (cx: number, cy: number, r: number) =>
  Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 180) * (60 * k - 30)
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`
  }).join(' ')

const HexPanel: React.FC<{ frame: number }> = ({ frame }) => {
  const originX = 1180
  const originY = 300
  const dx = HEX_R * 1.732
  const dy = HEX_R * 1.5

  return (
    <div style={{ position: 'absolute', left: 960, top: 0, width: 960, height: '100%' }}>
      <div style={{ position: 'absolute', left: 114, top: 130, fontFamily: FONT_FAMILY, fontSize: 34, color: COLORS.ink, fontWeight: 700 }}>
        b) 抽象 hexmap —— 数据 → 几何 → 动画
      </div>
      <div style={{ position: 'absolute', left: 114, top: 178, fontFamily: FONT_FAMILY, fontSize: 22, color: COLORS.dim }}>
        值 = 确定性 hash（纯函数）· 无国界 / 无投影 / 无地理信息（合规替代）
      </div>
      <svg viewBox="0 0 960 620" style={{ position: 'absolute', left: 100, top: 230, width: 780, height: 560, display: 'block' }}>
        {Array.from({ length: HEX_ROWS }, (_, row) =>
          Array.from({ length: HEX_COLS }, (_, col) => {
            const cx = 80 + col * dx + (row % 2) * (dx / 2)
            const cy = 90 + row * dy
            const value = 0.18 + 0.82 * hash2(col + 1, row + 1)
            const dist = Math.hypot(col - HEX_COLS / 2 + 0.5, (row - HEX_ROWS / 2 + 0.5) * 1.4)
            const light = ease((frame - 36 - dist * 14) / 22) // 从中心向外的光浪
            const breathe = 0.9 + 0.1 * Math.sin(frame * 0.09 + value * 6.28)
            const a = value * light * breathe
            const hue = 200 - value * 160 // 低值蓝 → 高值橙
            return (
              <polygon
                key={`${row}-${col}`}
                points={hexPoints(cx, cy, HEX_R * 0.92)}
                fill={`hsla(${hue}, 85%, ${38 + value * 22}%, ${0.08 + a * 0.92})`}
                stroke={`hsla(${hue}, 85%, 60%, ${0.15 + a * 0.5})`}
                strokeWidth={2}
              />
            )
          }),
        )}
      </svg>
      <div style={{ position: 'absolute', left: 114, top: 850, fontFamily: FONT_FAMILY, fontSize: 24, color: COLORS.dim }}>
        换 GeoJSON path 即是地图（本轮不做 · 合规）
      </div>
    </div>
  )
}

export const Composition: React.FC = () => {
  const frame = useCurrentFrame()
  return (
    <BenchFrame title="04 · 数据可视化 —— 真实数据双轴图 + 抽象 hexmap" footer={`frame ${frame} / 359`}>
      <ChartPanel frame={frame} />
      <HexPanel frame={frame} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 88, display: 'flex', justifyContent: 'center' }}>
        <Badge title="CHART + HEXMAP · 零依赖纯 DOM/SVG" color={COLORS.warn} />
      </div>
      <div style={{ position: 'absolute', left: 96, right: 96, bottom: 62, height: 8, background: 'rgba(255,255,255,0.14)', borderRadius: 4 }}>
        <div style={{ width: `${(frame / 359) * 100}%`, height: '100%', background: COLORS.accent, borderRadius: 4 }} />
      </div>
    </BenchFrame>
  )
}
