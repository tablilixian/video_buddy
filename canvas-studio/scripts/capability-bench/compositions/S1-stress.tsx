/**
 * S1/S2 压力样片（非十项能力项，注册键 'S1'）—— 供 `stress.mjs` 在任意
 * 分辨率 / fps / 时长下渲染的**可缩放**合成：
 * - 底图缓推（ken-burns 式，全程运动 ⇒ H1 平帧比与 H2 SSIM 在任意时长下成立）；
 * - 帧计数大字（逐帧变化的确定性文本，证明"每帧真的在画"）；
 * - 扫描条（位置 = frame/total，线性扫描）+ 半透明层叠（适度合成负载）。
 * 全部纯帧函数；内容随 durationInFrames 缩放，无固定分段（180s 长片不会黑尾）。
 */
import React from 'react'
import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig } from 'remotion'
import { FONT_FAMILY, POOL } from './shared.js'

export const meta = {
  id: 'S1',
  axis: 'stress',
  title: '规模压力样片（S1/S2 专用）',
  reference: '—',
  durationInFrames: 300, // 仅占位：实际时长由 stress.mjs 的 config 决定
  expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: false, minMotion: true },
  stills: [0],
  assets: ['image'],
} as const

export const Composition: React.FC = () => {
  const frame = useCurrentFrame()
  const { durationInFrames, width } = useVideoConfig()
  const total = Math.max(1, durationInFrames)
  const p = frame / total

  return (
    <AbsoluteFill style={{ backgroundColor: '#0b1220' }}>
      <AbsoluteFill style={{ transform: `scale(${1 + p * 0.15})`, transformOrigin: '60% 40%' }}>
        <Img src={POOL.image} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(4,8,16,0.55) 0%, rgba(4,8,16,0.05) 45%, rgba(4,8,16,0.6) 100%)' }} />

      {/* 扫描条：线性位置 + 呼吸宽度 */}
      <div
        style={{
          position: 'absolute',
          left: `${p * 92 + 2}%`,
          top: '46%',
          width: 6,
          height: '8%',
          background: '#5ad2ff',
          boxShadow: '0 0 24px rgba(90,210,255,0.8)',
        }}
      />

      {/* 帧计数：逐帧变化的大字（确定性文本渲染证明） */}
      <div
        style={{
          position: 'absolute',
          right: width * 0.06,
          bottom: '14%',
          fontFamily: FONT_FAMILY,
          fontSize: width * 0.05,
          fontWeight: 700,
          color: 'rgba(232,238,252,0.9)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {String(frame).padStart(5, '0')}
      </div>
      <div
        style={{
          position: 'absolute',
          left: width * 0.06,
          top: '10%',
          fontFamily: FONT_FAMILY,
          fontSize: width * 0.024,
          color: 'rgba(138,160,198,0.95)',
          letterSpacing: 2,
        }}
      >
        S1 STRESS · {width}×{Math.round((width * 9) / 16)}
      </div>

      {/* 进度条 */}
      <div style={{ position: 'absolute', left: '5%', right: '5%', bottom: '6%', height: 8, background: 'rgba(255,255,255,0.14)', borderRadius: 4 }}>
        <div style={{ width: `${p * 100}%`, height: '100%', background: '#5ad2ff', borderRadius: 4 }} />
      </div>
    </AbsoluteFill>
  )
}
