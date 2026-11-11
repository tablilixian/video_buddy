/**
 * #16 S1 契约小件的**渲染能力前置探针**（一次验三件）。
 *
 * web-renderer 4.0.535 有 CSS 白名单，#12 已实证「父层 perspective 属性被丢 /
 * mix-blend-mode 无视」。所以 `fx:metal`（background-clip:text）、`shape:dotGrid`
 * （radial-gradient 平铺）、`clip:'circle'`（clip-path）在写进产品契约之前，
 * 必须先拿到像素证据，否则会写出「契约有了但成片没有」的假能力。
 *
 * 四格：A 金属渐变字 / B 点阵网格（SVG pattern） / C 圆形裁切 / D 三者组合。
 * 判据：A 必须是银色渐变而非纯白或整块消失；B 必须是规则圆点阵而非纯色；
 * C 必须是圆而非方；D 全部共存。角度/位置随帧微动满足 H2。
 */
import React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { BenchFrame, FONT_FAMILY } from './shared.js'

export const meta = {
  id: '16',
  axis: 'metal-grid-clip',
  title: '金属字 / 点阵网格 / 圆形裁切的渲染能力',
  reference: '≥95% 对齐 · S1 契约小件前置探针',
  durationInFrames: 240,
  stills: [30, 90, 150, 210],
  assets: [],
} as const

const METAL = 'linear-gradient(180deg, #ffffff 0%, #e8eefc 20%, #9aa9c4 46%, #f7faff 52%, #aebbd4 74%, #ffffff 100%)'
// CSS radial-gradient 平铺在 web-renderer 4.0.535 下被忽略（首轮实证），勿再走这条路。

/** CSS radial-gradient 平铺被 web-renderer 忽略（#16 首轮实证）⇒ 改用 SVG pattern。 */
const DotGrid: React.FC<{ shift: number; id: string }> = ({ shift, id }) => (
  <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
    <defs>
      <pattern id={id} width="20" height="20" patternUnits="userSpaceOnUse" patternTransform={`translate(${shift} ${shift})`}>
        <circle cx="10" cy="10" r="1.4" fill="rgba(150,180,225,0.55)" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill={`url(#${id})`} />
  </svg>
)

const Cell: React.FC<{ tag: string; title: string; note: string; children: React.ReactNode }> = ({ tag, title, note, children }) => (
  <div style={{ width: 900, height: 420, borderRadius: 12, border: '1px solid rgba(90,210,255,0.18)', background: '#05080f', position: 'relative', overflow: 'hidden' }}>
    <div style={{ position: 'absolute', left: 14, top: 10, fontFamily: FONT_FAMILY, fontSize: 19, color: '#8aa0c6', zIndex: 3 }}>
      <span style={{ color: '#f0a43a', fontWeight: 700 }}>{tag}</span>　{title}
    </div>
    <div style={{ position: 'absolute', left: 14, top: 36, right: 14, fontFamily: FONT_FAMILY, fontSize: 14, color: '#5b6b86', zIndex: 3 }}>{note}</div>
    {children}
  </div>
)

export const Composition: React.FC = () => {
  const frame = useCurrentFrame()
  const shift = (frame % 18)
  const angle = 180 + Math.sin(frame / 30) * 12

  return (
    <BenchFrame title="16 · 金属字 / 点阵 / 圆形裁切 —— S1 契约能力" footer={`frame ${frame} / 239 · gradient ${angle.toFixed(1)}°`}>
      <AbsoluteFill>
        <div style={{ position: 'absolute', left: 40, top: 150, display: 'flex', gap: 20, flexWrap: 'wrap', width: 1840 }}>
          <Cell tag="A" title="银色金属渐变字" note="background: linear-gradient + -webkit-background-clip:text + fill transparent · 期望：真渐变，不是纯白">
            <div
              style={{
                position: 'absolute', inset: '18% 0 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: FONT_FAMILY, fontSize: 190, fontWeight: 800, letterSpacing: -8,
                background: `linear-gradient(${angle.toFixed(1)}deg, #ffffff 0%, #e8eefc 20%, #8fa1bf 46%, #f7faff 52%, #aebbd4 74%, #ffffff 100%)`,
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                color: 'transparent',
              }}
            >
              47
            </div>
          </Cell>
          <Cell tag="B" title="圆点阵网格（SVG pattern）" note="首轮 CSS radial-gradient 平铺被忽略 ⇒ 改 SVG <pattern> · 期望：规则点阵">
            <div style={{ position: 'absolute', inset: '18% 8% 6% 8%' }}>
              <DotGrid shift={shift} id="dots16b" />
            </div>
          </Cell>
          <Cell tag="C" title="圆形裁切（人像 PIP 用）" note="clip-path: circle(50%) 包一个矩形色块 · 期望：圆，不是方">
            <div style={{ position: 'absolute', left: '32%', top: '20%', width: '36%', height: '72%' }}>
              <div
                style={{
                  width: '100%', height: '100%', background: 'linear-gradient(135deg, #3a4a66, #16233a)',
                  border: '2px solid #3fa9f5',
                  clipPath: 'circle(50% at 50% 50%)',
                }}
              />
            </div>
          </Cell>
          <Cell tag="D" title="三者组合" note="点阵底 + 金属字 + 圆形 PIP 共存 · 期望：都不互相吃掉">
            <DotGrid shift={shift} id="dots16d" />
            <div
              style={{
                position: 'absolute', left: '10%', top: '24%', fontFamily: FONT_FAMILY, fontSize: 128, fontWeight: 800,
                background: METAL, WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}
            >
              12,8
            </div>
            <div style={{ position: 'absolute', right: '8%', top: '22%', width: '22%', height: '58%', background: '#1d3358', clipPath: 'circle(50% at 50% 50%)', border: '1px solid #f0a43a' }} />
          </Cell>
        </div>
      </AbsoluteFill>
    </BenchFrame>
  )
}
