/**
 * #10 剪辑能力 —— 多段同源 + 跳剪 + 变速 + 独立音轨（A 级，最便宜的一条）。
 *
 * 对标官方：`video-editing-transition-series` / `sequence-playback-rate-testbed` / `jump-cuts`。
 *
 * 要证明的四件事（全部可从成片机械判定，不靠感觉）：
 *   1. 同一段素材被 5 次跳剪复用（`trimBefore` 各不相同）—— 画面内容确实跳了；
 *   2. `playbackRate` 0.5 / 1 / 1.5 / 2 分别生效 —— 同一 trim 下运动速度不同；
 *   3. 独立音轨与 ducking 生效（`<Audio>` + frame 回调），成片必须同时有 h264 与 aac；
 *   4. 末帧不冻结、段间无重复帧堆叠（可复现性检查会顺带验证）。
 */

import React from 'react'
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from 'remotion'
import { Audio, Video } from '@remotion/media'
import { Badge, BenchFrame, COLORS, FONT_FAMILY, POOL } from './shared.js'

export const meta = {
  id: '10',
  axis: 'editing',
  title: '剪辑：跳剪 / 变速 / 独立音轨',
  reference: 'video-editing-transition-series · sequence-playback-rate-testbed · jump-cuts',
  durationInFrames: 300, // 10s @30fps
  /** driver 用来做机械判定：判定帧（首/中/末）与期望的流构成。 */
  expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: true, minMotion: true },
  /** 抽帧做 contact sheet 的位置。 */
  stills: [0, 60, 120, 180, 240, 299],
  /** 素材键（driver 负责映射到真实文件）。 */
  assets: ['clip', 'bgm'],
} as const

const CUT = 60 // 每段 2s

/** 5 段跳剪：trimBefore 故意乱序、playbackRate 故意跨档，这样"跳"和"变速"都不可能被误认为连续播放。
 *  trim 点位是挑过的（1s / 8s / 11s / 17s / 27s）：源片 21–24s 是一段暗场，落那里会让
 *  contact sheet 看起来像"没渲出来"，虽然实际只是素材本身黑。 */
const SEGMENTS = [
  { trimBefore: 30, rate: 1, label: 'trim 30f · 1.0×' },
  { trimBefore: 240, rate: 2, label: 'trim 240f · 2.0×' },
  { trimBefore: 330, rate: 0.5, label: 'trim 330f · 0.5×' },
  { trimBefore: 510, rate: 1.5, label: 'trim 510f · 1.5×' },
  { trimBefore: 810, rate: 1, label: 'trim 810f · 1.0×' },
] as const

const TOTAL = CUT * SEGMENTS.length

/** 音量包络：第 3、4 段压低（ducking），首尾恢复。纯 frame 函数，可复现。 */
const bgmVolume = (frame: number) => {
  const dips = [
    [CUT * 2, CUT * 2 + 20, 0.22],
    [CUT * 3, CUT * 3 + 20, 0.22],
    [CUT * 3 + CUT - 20, CUT * 4, 0.9],
  ] as const
  let volume = 0.9
  for (const [from, to, target] of dips) {
    if (frame >= from && frame <= to) {
      volume = interpolate(frame, [from, to], [volume, target], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    }
  }
  return volume
}

const Cut: React.FC<{ index: number }> = ({ index }) => {
  const segment = SEGMENTS[index]
  const frame = useCurrentFrame()
  // 每段内做一次 1.0 → 1.04 的推近，用来证明"段内也在动"（纯 frame 函数，不是 transition）。
  const scale = interpolate(frame, [0, CUT - 1], [1, 1.04])

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${scale})` }}>
        <Video
          src={POOL.clip}
          objectFit="cover"
          trimBefore={segment.trimBefore}
          playbackRate={segment.rate}
          muted
          style={{ width: '100%', height: '100%' }}
        />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(4,8,16,0.62) 0%, rgba(4,8,16,0) 34%)' }} />
    </AbsoluteFill>
  )
}

export const Composition: React.FC = () => {
  const frame = useCurrentFrame()
  const index = Math.min(SEGMENTS.length - 1, Math.floor(frame / CUT))
  const segment = SEGMENTS[index]
  const progress = frame / (TOTAL - 1)

  return (
    <BenchFrame title="10 · 剪辑能力 —— 跳剪 / 变速 / 独立音轨" footer={`frame ${frame} / ${TOTAL - 1}`}>
      {SEGMENTS.map((_, i) => (
        <Sequence key={i} from={i * CUT} durationInFrames={CUT} layout="none">
          <Cut index={i} />
        </Sequence>
      ))}

      {/* 角标：每段硬切一次，文件名/参数一变即证明"跳"发生了 */}
      <div style={{ position: 'absolute', left: 96, top: 150 }}>
        <Badge title={`CUT ${String(index + 1).padStart(2, '0')}`} sub={segment.label} />
      </div>

      {/* 大号序号：让 contact sheet 一眼看出 5 段不连续 */}
      <div
        style={{
          position: 'absolute',
          right: 110,
          bottom: 120,
          fontFamily: FONT_FAMILY,
          fontSize: 190,
          fontWeight: 700,
          color: 'rgba(255,255,255,0.16)',
          lineHeight: 1,
        }}
      >
        {String(index + 1).padStart(2, '0')}
      </div>

      {/* 进度条 */}
      <div style={{ position: 'absolute', left: 96, right: 96, bottom: 62, height: 8, background: 'rgba(255,255,255,0.14)', borderRadius: 4 }}>
        <div
          style={{
            width: `${progress * 100}%`,
            height: '100%',
            background: COLORS.accent,
            borderRadius: 4,
          }}
        />
      </div>

      {/* 独立音轨（带 ducking）——与视频原声无关，故视频 muted；bgm 只有 8.4s，loop 铺满 10s */}
      <Audio src={POOL.bgm} loop volume={bgmVolume} />
    </BenchFrame>
  )
}
