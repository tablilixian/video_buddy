/**
 * #06 音频驱动视觉 —— mp3 包络驱动 64 柱 + 连续波形线 + 分频段三色（A 级，最便宜的一条）。
 *
 * 对标官方：`audio-visualization`。
 *
 * 要证明的三件事：
 *   1. 解码 → 纯函数 → 逐帧柱高这条链在 CSR 里确定性成立（delayRender 挡住首帧等解码，
 *      渲两次柱高一模一样，H4 会机械验证）；
 *   2. 柱高真的来自音频包络（不是装饰性假动）——包络 = PCM 分桶 RMS，柱高 = 包络采样；
 *   3. 分频段着色：六级 box 低通级联（窗口 46ms→1.4ms）近似频段分离——诚实标注：这不是
 *      FFT，是时域低通残差，频段边界是近似的。
 *
 * 写法照抄产品 `src/remotion/components/AudioViz.tsx` 的成熟模式（生产已在 CSR 链路跑通）。
 */

import React, { useEffect, useRef, useState } from 'react'
import { AbsoluteFill, continueRender, delayRender, useCurrentFrame } from 'remotion'
import { Audio } from '@remotion/media'
import { Badge, BenchFrame, COLORS, FONT_FAMILY, POOL } from './shared.js'

export const meta = {
  id: '06',
  axis: 'audio-viz',
  title: '音频驱动视觉（波形 / 频谱）',
  reference: 'audio-visualization',
  durationInFrames: 300, // 10s @30fps；bgm 8.4s < 10s，包络与 <Audio loop> 同周期循环
  expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: true, minMotion: true },
  stills: [30, 149, 268],
  assets: ['bgm'],
} as const

const BARS = 64
const BANDS = 6
/** 六级 box 低通窗口（样本数 @48kHz）：46ms / 23ms / 11.5ms / 5.7ms / 2.9ms / 1.4ms */
const BAND_WINDOWS = [2205, 1102, 551, 275, 137, 68]
const DECODE_TIMEOUT_MS = 10_000

type Decoded = {
  /** 每帧（1/30s）一组的：全频段包络 + 六个频段 RMS（都 0–1 归一化） */
  frames: number
  envelope: Float32Array
  bands: Float32Array[] // bands[k][frameIndex]
}

/** 解码 + 包络计算。确定性：同一文件 decode 两次结果逐样本一致（无随机、无时间输入）。 */
async function decodeEnvelopes(src: string): Promise<Decoded | null> {
  const AudioCtor = (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext
  if (!AudioCtor) return null
  const res = await fetch(src)
  if (!res.ok) return null
  const bytes = await res.arrayBuffer()
  const ctx = new AudioCtor()
  const audio = await ctx.decodeAudioData(bytes)
  const data = audio.getChannelData(0)
  const rate = audio.sampleRate
  const frames = Math.max(1, Math.floor((audio.length / rate) * 30))
  const perFrame = Math.max(1, Math.floor(rate / 30))

  // 六级低通：box 滤波级联（前缀和 O(n)），k 级 = 前 k+1 次均值 ⇒ 窗口递增
  const prefix = new Float64Array(data.length + 1)
  for (let i = 0; i < data.length; i += 1) prefix[i + 1] = prefix[i] + (data[i] ?? 0)
  const bandSignals: Float32Array[] = []
  const windows = [1, ...BAND_WINDOWS] // 第 0 级窗口 1 = 原始信号（最高频段 = 残差基）
  for (let k = 0; k < BANDS; k += 1) {
    const w = windows[k]
    const sig = new Float32Array(data.length)
    for (let i = 0; i < data.length; i += 1) {
      const a = Math.max(0, i - (w >> 1))
      const b = Math.min(data.length, i + (w >> 1) + 1)
      sig[i] = (prefix[b] - prefix[a]) / (b - a)
    }
    bandSignals.push(sig)
  }

  // 每帧 RMS：全频段（原始 PCM）+ 各级低通与上一级的差（= 该频段能量）
  const envelope = new Float32Array(frames)
  const bands: Float32Array[] = Array.from({ length: BANDS }, () => new Float32Array(frames))
  for (let f = 0; f < frames; f += 1) {
    const start = f * perFrame
    const end = Math.min(data.length, start + perFrame)
    let sum = 0
    const bandSum = new Array<number>(BANDS).fill(0)
    for (let i = start; i < end; i += 1) {
      const s = data[i] ?? 0
      sum += s * s
      for (let k = 0; k < BANDS; k += 1) {
        // 第 k 段 = 第 k 级低通减去更深一级的低通（高通残差），最后一级用最深低通本身
        const deep = bandSignals[Math.min(BANDS - 1, k + 1)][i] ?? 0
        const own = bandSignals[k][i] ?? 0
        const d = k === BANDS - 1 ? own : own - deep
        bandSum[k] += d * d
      }
    }
    const n = Math.max(1, end - start)
    envelope[f] = Math.sqrt(sum / n)
    for (let k = 0; k < BANDS; k += 1) bands[k][f] = Math.sqrt(bandSum[k] / n)
  }
  const peak = envelope.reduce((m, v) => (v > m ? v : m), 0) || 1
  for (let f = 0; f < frames; f += 1) envelope[f] /= peak
  for (let k = 0; k < BANDS; k += 1) {
    const bp = bands[k].reduce((m, v) => (v > m ? v : m), 0) || 1
    for (let f = 0; f < frames; f += 1) bands[k][f] /= bp
  }
  await ctx.close()
  return { frames, envelope, bands }
}

function useDecoded(src: string): Decoded | null {
  const [decoded, setDecoded] = useState<Decoded | null>(null)
  const [handle] = useState(() => delayRender('audioViz：解码音频包络'))
  const released = useRef(false)
  useEffect(() => {
    let cancelled = false
    const release = () => {
      if (released.current) return
      released.current = true
      continueRender(handle)
    }
    const guard = setTimeout(release, DECODE_TIMEOUT_MS)
    decodeEnvelopes(src)
      .then((d) => {
        if (!cancelled) setDecoded(d)
      })
      .catch(() => {
        // 静默降级：解码失败 ⇒ 基线柱（成片照常出，只是没有波形）
      })
      .finally(() => {
        clearTimeout(guard)
        release()
      })
    return () => {
      cancelled = true
      clearTimeout(guard)
      release()
    }
  }, [src, handle])
  return decoded
}

const BAND_COLORS = ['#5ad2ff', '#4f9cf9', '#7b61ff', '#b44dff', '#ffb454', '#ff5c5c']

/** 柱 i 在帧 f 的高度：所属频段包络 × 确定性纹理（纯帧函数，无随机）。 */
const barHeight = (decoded: Decoded, frame: number, i: number, loopFrames: number) => {
  const f = frame % loopFrames
  const band = Math.min(BANDS - 1, Math.floor((i / BARS) * BANDS))
  const env = decoded.bands[band][Math.min(decoded.frames - 1, f)] ?? 0
  const texture = 0.78 + 0.22 * Math.sin(i * 1.7 + f * 0.31)
  return Math.max(0.02, Math.min(1, env * texture * 1.25))
}

export const Composition: React.FC = () => {
  const frame = useCurrentFrame()
  const decoded = useDecoded(POOL.bgm)
  const loopFrames = decoded?.frames ?? 300
  const f = decoded ? frame % loopFrames : 0

  const bandNow = [0, 1, 2, 3, 4, 5].map((k) => (decoded ? decoded.bands[k][Math.min(decoded.frames - 1, f)] ?? 0 : 0))
  const envNow = decoded ? decoded.envelope[Math.min(decoded.frames - 1, f)] ?? 0 : 0

  // 连续波形线：全频段包络按帧在时间轴上取 [-2s, +2s] 窗口铺满横向
  const linePoints: string[] = []
  if (decoded) {
    const span = 120
    for (let i = 0; i < span; i += 1) {
      const t = Math.round(f + (i / (span - 1)) * 90 - 30)
      const v = decoded.envelope[Math.min(decoded.frames - 1, Math.max(0, t))] ?? 0
      const x = (i / (span - 1)) * 100
      linePoints.push(`${x.toFixed(2)},${(92 - v * 84).toFixed(2)}`)
    }
  }

  return (
    <BenchFrame title="06 · 音频驱动 —— 64 柱 + 波形线 + 分频段三色" footer={`frame ${frame} / 299 · 包络循环 ${loopFrames}f`}>
      {/* 波形线（连续 polyline，SVG 白名单内） */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ position: 'absolute', left: 0, top: 150, width: '100%', height: 320, display: 'block' }}
      >
        <polyline
          fill="none"
          stroke={COLORS.accent}
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          points={linePoints.join(' ')}
        />
      </svg>

      {/* 64 柱：颜色按所属频段（低→高 = 蓝→紫→橙→红） */}
      <div
        style={{
          position: 'absolute',
          left: 96,
          right: 96,
          bottom: 200,
          height: 430,
          display: 'flex',
          alignItems: 'flex-end',
          gap: 6,
        }}
      >
        {Array.from({ length: BARS }, (_, i) => {
          const band = Math.min(BANDS - 1, Math.floor((i / BARS) * BANDS))
          const h = decoded ? barHeight(decoded, frame, i, loopFrames) : 0.02
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${h * 100}%`,
                background: `linear-gradient(180deg, ${BAND_COLORS[band]}, rgba(10,18,32,0.2))`,
                borderRadius: 3,
                opacity: 0.95,
              }}
            />
          )
        })}
      </div>

      {/* 频段表：六个频段的实时 RMS 横条（不听音频也能对上"柱高来自包络"） */}
      <div style={{ position: 'absolute', right: 110, top: 170, width: 380, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {['低1', '低2', '中1', '中2', '高1', '高2'].map((label, k) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontFamily: FONT_FAMILY, fontSize: 24, color: COLORS.dim, width: 56 }}>{label}</div>
            <div style={{ flex: 1, height: 22, background: 'rgba(255,255,255,0.10)', borderRadius: 5 }}>
              <div
                style={{
                  width: `${Math.min(100, bandNow[k] * 100)}%`,
                  height: '100%',
                  background: BAND_COLORS[k],
                  borderRadius: 5,
                }}
              />
            </div>
          </div>
        ))}
        <div style={{ fontFamily: FONT_FAMILY, fontSize: 22, color: COLORS.dim }}>
          全频段 RMS {envNow.toFixed(3)} · 六级 box 低通（非 FFT）
        </div>
      </div>

      <div style={{ position: 'absolute', left: 96, top: 150 }}>
        <Badge title="AUDIO-VIZ" sub="包络 = PCM 分桶 RMS · 柱高 = 纯帧函数" />
      </div>

      <div style={{ position: 'absolute', left: 96, right: 96, bottom: 62, height: 8, background: 'rgba(255,255,255,0.14)', borderRadius: 4 }}>
        <div style={{ width: `${(frame / 299) * 100}%`, height: '100%', background: COLORS.accent, borderRadius: 4 }} />
      </div>

      {/* 与包络同源的音轨：loop 铺满 10s，包络取样按同一周期循环 ⇒ 音画一致 */}
      <Audio src={POOL.bgm} loop />
    </BenchFrame>
  )
}
