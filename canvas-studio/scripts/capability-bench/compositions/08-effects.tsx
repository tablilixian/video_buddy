/**
 * #08 滤镜 / 调色链 —— 同一张图切格跑 filter 组合 + look 五参 + mix-blend-mode 对照（零依赖）。
 *
 * 对标官方：`effects-testbed`。
 *
 * 已知边界（§10.9 静态实证，本片的目视判据）：
 *   - `filter` 白名单支持 blur / brightness / contrast / saturate / sepia / hue-rotate /
 *     drop-shadow 及组合 ⇒ 上排四格与下排 look 格**预期全部生效**；
 *   - `mix-blend-mode` 在 4.0.535 命中 0 ⇒ blend 格**预期"无混合效果"**——判 BUG（R2），
 *     不判本片失败。blend 格用 difference：若生效必然反相，若失效就是一块平色，一眼可分。
 *
 * 判定关键：四格肉眼可分 + blend 格的"预期失效"被像素证实。
 */

import React from 'react'
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from 'remotion'
import { Badge, BenchFrame, COLORS, FONT_FAMILY, POOL } from './shared.js'

export const meta = {
  id: '08',
  axis: 'effects',
  title: '滤镜 / 调色链',
  reference: 'effects-testbed',
  durationInFrames: 240, // 8s @30fps
  expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: false, minMotion: true },
  stills: [60, 119, 200],
  assets: ['image'],
} as const

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const osc = (frame: number, period: number) => (Math.sin((frame / period) * Math.PI * 2) + 1) / 2

const CellLabel: React.FC<{ tag: string; note: string }> = ({ tag, note }) => (
  <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: 'rgba(4,8,16,0.78)', padding: '10px 14px' }}>
    <span style={{ fontFamily: FONT_FAMILY, fontSize: 26, fontWeight: 700, color: COLORS.accent }}>{tag}</span>
    <span style={{ fontFamily: FONT_FAMILY, fontSize: 21, color: COLORS.dim, marginLeft: 12 }}>{note}</span>
  </div>
)

const Cell: React.FC<{ style: React.CSSProperties; tag: string; note: string; children?: React.ReactNode }> = ({ style, tag, note, children }) => (
  <div style={{ position: 'relative', flex: 1, borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(90,210,255,0.28)', ...style }}>
    {children}
    <CellLabel tag={tag} note={note} />
  </div>
)

const BaseImg: React.FC = () => (
  <Img src={POOL.image} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
)

export const Composition: React.FC = () => {
  const frame = useCurrentFrame()

  // 上排四格：四组 filter 链，各自带不同的动态参数（同一张图 ⇒ 差异只能来自 filter）
  const blurPx = interpolate(osc(frame, 4), [0, 1], [2, 10])
  const hueDeg = interpolate(frame, [0, 240], [0, 200]) % 360
  const sepiaV = interpolate(osc(frame, 5), [0, 1], [0.25, 0.95])
  const shadowSpread = interpolate(osc(frame, 3.3), [0, 1], [8, 30])

  // 下排 look 五参：brightness/contrast/saturate/hue-rotate/sepia 一条链（产品 look 轨的同类能力）
  const look = `brightness(${(0.85 + osc(frame, 6) * 0.4).toFixed(3)}) contrast(${(1 + osc(frame, 7) * 0.35).toFixed(3)}) saturate(${(0.7 + osc(frame, 5.5) * 0.9).toFixed(3)}) hue-rotate(${(osc(frame, 9) * 60 - 30).toFixed(1)}deg) sepia(${(osc(frame, 8) * 0.35).toFixed(3)})`

  return (
    <BenchFrame title="08 · 滤镜链 —— filter 组合 + look 五参 + blend 对照" footer={`frame ${frame} / 239`}>
      {/* 上排：四组 filter（预期全部生效） */}
      <div style={{ position: 'absolute', left: 90, right: 90, top: 214, height: 376, display: 'flex', gap: 18 }}>
        <Cell tag="F1 blur" note={`动态模糊 ${blurPx.toFixed(1)}px`}>
          <AbsoluteFill style={{ filter: `blur(${blurPx.toFixed(2)}px)`, transform: `scale(${1 + blurPx * 0.012})` }}>
            <BaseImg />
          </AbsoluteFill>
        </Cell>
        <Cell tag="F2 tint" note={`hue-rotate ${hueDeg.toFixed(0)}° + saturate 1.6`}>
          <AbsoluteFill style={{ filter: `hue-rotate(${hueDeg.toFixed(1)}deg) saturate(1.6)` }}>
            <BaseImg />
          </AbsoluteFill>
        </Cell>
        <Cell tag="F3 做旧" note={`sepia ${sepiaV.toFixed(2)} + contrast 1.25`}>
          <AbsoluteFill style={{ filter: `sepia(${sepiaV.toFixed(3)}) contrast(1.25) brightness(1.05)` }}>
            <BaseImg />
          </AbsoluteFill>
        </Cell>
        <Cell tag="F4 光晕" note={`drop-shadow ${shadowSpread.toFixed(0)}px + brightness`}>
          <AbsoluteFill style={{ filter: `drop-shadow(0 0 ${shadowSpread.toFixed(0)}px rgba(90,210,255,0.9)) brightness(1.12)` }}>
            <BaseImg />
          </AbsoluteFill>
        </Cell>
      </div>

      {/* 下排三格：look 五参 / blend 对照（预期失效）/ 原图基线 */}
      <div style={{ position: 'absolute', left: 90, right: 90, top: 614, height: 376, display: 'flex', gap: 18 }}>
        <Cell tag="L1 look 五参" note="brightness+contrast+saturate+hue+sepia 同链">
          <AbsoluteFill style={{ filter: look }}>
            <BaseImg />
          </AbsoluteFill>
        </Cell>
        <Cell tag="B1 blend" note="difference 品红块 · 生效应反相 / 失效=平色块（预期失效 ⇒ R2 BUG）">
          <AbsoluteFill>
            <BaseImg />
          </AbsoluteFill>
          <AbsoluteFill style={{ background: '#ff2daa', mixBlendMode: 'difference' }} />
        </Cell>
        <Cell tag="R0 原图" note="对照组 · 无任何 filter">
          <AbsoluteFill>
            <BaseImg />
          </AbsoluteFill>
        </Cell>
      </div>

      <div style={{ position: 'absolute', left: 90, top: 142, display: 'flex' }}>
        <Badge title="FILTER CHAIN · filter 白名单内四组生效 + blend 对照预期失效" color={COLORS.warn} />
      </div>

      <div style={{ position: 'absolute', left: 90, right: 90, bottom: 62, height: 8, background: 'rgba(255,255,255,0.14)', borderRadius: 4 }}>
        <div style={{ width: `${(frame / 239) * 100}%`, height: '100%', background: COLORS.accent, borderRadius: 4 }} />
      </div>
    </BenchFrame>
  )
}
