/**
 * 能力基准 #05 收口（2026-10-31）：**词级字幕（karaoke）**轨。
 *
 * 单句一条轨：`src` 是该句的 TTS mp3，`text` 是同步文本。词级时间戳两种来源：
 * 1. `words: [{text, from, to}]` 显式声明（帧）—— 外部对齐数据（未来后端词级戳）的即插即用口；
 * 2. 缺省走**能量谷推导**（`word-timing.ts` 纯函数）：浏览器解码 → 10ms RMS 包络 →
 *    字间谷切分。实测精度 ±1–3 帧（30fps 中文慢速 TTS，bench #05 像素验收过）。
 *
 * 渲染：measureText 贪心折行（产品测量器，同 TextCard）+ 逐字三态
 * （已读白 / 当前高亮+辉光 / 未读暗）。音频由本轨自播（`<Audio>`）—— 同一 src 不要
 * 再放进 `audio.voiceOver`（校验层会告警双重播放）。
 * 确定性：解码与折行都是确定性输入；无随机、无时钟。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AbsoluteFill, continueRender, delayRender, useCurrentFrame, useVideoConfig } from 'remotion'
import { Audio } from '@remotion/media'
import type { CaptionTrack } from '../manifest.js'
import { isSpokenChar, wordTimingFromEnvelope, type WordTimingWindow } from '../word-timing.js'
import { useFontFamilyStack } from './font-context.js'

const DECODE_TIMEOUT_MS = 10_000

const DEFAULT_COLOR = '#ffffff'
const DEFAULT_ACTIVE_COLOR = '#5ad2ff'
const DEFAULT_DIM_COLOR = 'rgba(232,238,252,0.28)'

/** 浏览器侧 RMS 包络（10ms 分桶，原始幅值 —— 推导函数内部按峰值归一）。 */
function envelopeFromPcm(data: Float32Array, sampleRate: number): number[] {
  const bucketLen = Math.max(1, Math.floor(sampleRate * 0.01))
  const out: number[] = []
  for (let i = 0; i < data.length; i += bucketLen) {
    let sum = 0
    let count = 0
    for (let k = i; k < Math.min(data.length, i + bucketLen); k += 1) {
      const s = data[k] ?? 0
      sum += s * s
      count += 1
    }
    out.push(count === 0 ? 0 : Math.sqrt(sum / count))
  }
  return out
}

function useEnvelope(src: string): number[] | null {
  const [envelope, setEnvelope] = useState<number[] | null>(null)
  const [handle] = useState(() => delayRender('caption：解码音频包络'))
  const released = useRef(false)
  const release = () => {
    if (released.current) return
    released.current = true
    continueRender(handle)
  }
  useEffect(() => {
    let cancelled = false
    const guard = setTimeout(release, DECODE_TIMEOUT_MS)
    const run = async (): Promise<void> => {
      try {
        const AudioCtor = (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext
        if (AudioCtor === undefined) return
        const res = await fetch(src)
        if (!res.ok) return
        const ctx = new AudioCtor()
        const audio = await ctx.decodeAudioData(await res.arrayBuffer())
        if (cancelled) return
        setEnvelope(envelopeFromPcm(audio.getChannelData(0), audio.sampleRate))
        await ctx.close()
      } catch {
        // 静默降级：解码不可用 ⇒ 全句均匀（见 windows 兜底）
      } finally {
        clearTimeout(guard)
        release()
      }
    }
    void run()
    return () => {
      cancelled = true
      clearTimeout(guard)
      release()
    }
  }, [src])
  return envelope
}

/** 逐字渲染样式：折行后每字的状态色与动效（纯帧函数）。 */
function charStyle(state: 'done' | 'active' | 'todo', prog: number, activeColor: string, dimColor: string, doneColor: string): React.CSSProperties {
  if (state === 'active') {
    return {
      color: activeColor,
      transform: `scale(${1 + 0.06 * Math.sin(prog * Math.PI)})`,
      textShadow: `0 ${(6 + prog * 10).toFixed(1)}px ${(24 + prog * 26).toFixed(1)}px rgba(90,210,255,${(0.45 + prog * 0.3).toFixed(2)})`,
    }
  }
  return { color: state === 'done' ? doneColor : dimColor, transform: 'scale(1)' }
}

export const Caption: React.FC<{ track: CaptionTrack }> = ({ track }) => {
  const frame = useCurrentFrame()
  const { width: canvasWidth, height: canvasHeight, fps } = useVideoConfig()
  const fontFamily = useFontFamilyStack()

  const chars = useMemo(() => Array.from(track.text), [track.text])
  const spokenIndices = useMemo(() => chars.map((c, i) => (isSpokenChar(c) ? i : -1)).filter((i) => i >= 0), [chars])
  const fontSize = Math.round(track.fontSize ?? canvasHeight * 0.11)
  const maxWidth = canvasWidth * ((track.widthPercent ?? 66) / 100)

  // 词级窗口：显式 words 优先（与口播字一一对应），否则能量谷推导
  const explicit = useMemo(() => {
    if (!Array.isArray(track.words) || track.words.length !== spokenIndices.length) return null
    return track.words.map((w) => ({ start: w.from, end: w.to }))
  }, [track.words, spokenIndices.length])

  const envelope = useEnvelope(track.src)
  const derived = useMemo(() => {
    if (explicit !== null || envelope === null) return null
    return wordTimingFromEnvelope({ envelope, fps, spokenChars: spokenIndices.length })
  }, [explicit, envelope, fps, spokenIndices.length])
  const spokenWindows: WordTimingWindow[] | null = explicit ?? derived

  // 口播字窗口 → 全字符窗口（标点骑在前后字的间隙上；首尾标点贴邻字）
  const charWindows = useMemo(() => {
    const out: Array<WordTimingWindow | null> = chars.map(() => null)
    if (spokenWindows === null) return out
    spokenIndices.forEach((charAt, i) => {
      out[charAt] = spokenWindows[i] ?? null
    })
    let lastEnd: number | null = null
    for (let i = 0; i < chars.length; i += 1) {
      if (out[i] !== null) {
        lastEnd = out[i]?.end ?? null
        continue
      }
      const nextSpoken = spokenIndices.find((idx) => idx > i)
      if (lastEnd !== null) {
        const nextStart = nextSpoken !== undefined ? out[nextSpoken]?.start ?? lastEnd : lastEnd
        out[i] = { start: lastEnd, end: nextStart }
      } else if (nextSpoken !== undefined) {
        const w = out[nextSpoken]
        out[i] = w ? { start: w.start, end: w.start } : null
      }
    }
    return out
  }, [chars, spokenWindows, spokenIndices])

  // measureText 贪心折行（无测出器时按字数硬折：每行 ~ maxWidth/字宽）
  const lines = useMemo(() => {
    const rows: Array<Array<{ ch: string; idx: number }>> = [[]]
    let measured = 0
    let measurer: ((text: string) => number) | null = null
    try {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.font = `700 ${fontSize}px ${fontFamily}`
        measurer = (text) => ctx.measureText(text).width
      }
    } catch {
      measurer = null
    }
    const estimate = fontSize // 无测量器时的单字宽估计
    for (let i = 0; i < chars.length; i += 1) {
      const ch = chars[i] ?? ''
      const w = measurer ? measurer(ch) : estimate
      let row = rows[rows.length - 1]
      if (row === undefined) {
        row = []
        rows.push(row)
      }
      if (measured + w > maxWidth && row.length > 0) {
        row = []
        rows.push(row)
        measured = 0
      }
      row.push({ ch, idx: i })
      measured += w
    }
    return rows
  }, [chars, fontSize, maxWidth, fontFamily])

  const dimColor = track.dimColor ?? DEFAULT_DIM_COLOR
  const activeColor = track.activeColor ?? DEFAULT_ACTIVE_COLOR
  const doneColor = track.color ?? DEFAULT_COLOR

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingBottom: '8%',
        fontFamily,
        ...(track.box === undefined
          ? {}
          : {
              left: `${track.box.x}%`,
              top: `${track.box.y}%`,
              width: `${track.box.w}%`,
              height: `${track.box.h}%`,
              transform: 'translate(-50%, -50%)',
              justifyContent: 'center',
              paddingBottom: 0,
            }),
      }}
    >
      {lines.map((row, rowIdx) => (
        <div key={rowIdx} style={{ display: 'flex', marginBottom: fontSize * 0.18 }}>
          {row.map(({ ch, idx }) => {
            const w = charWindows[idx]
            const state = !w
              ? 'todo'
              : frame >= w.end
                ? 'done'
                : frame >= w.start
                  ? 'active'
                  : 'todo'
            const prog = state === 'active' && w ? (frame - w.start) / Math.max(0.5, w.end - w.start) : 0
            return (
              <div
                key={idx}
                style={{
                  fontSize,
                  fontWeight: 700,
                  lineHeight: 1.15,
                  whiteSpace: 'pre',
                  ...charStyle(state, prog, activeColor, dimColor, doneColor),
                }}
              >
                {ch}
              </div>
            )
          })}
        </div>
      ))}
      {/* 本轨自带旁白声音 —— 同一 src 重复挂 audio.voiceOver 会被校验层告警 */}
      <Audio src={track.src} />
    </AbsoluteFill>
  )
}
