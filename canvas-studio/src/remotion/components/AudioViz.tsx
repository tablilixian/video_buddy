/**
 * REQ-034 · 二期 B1：`audioViz` 轨 → 随音频跳动的波形柱。
 *
 * 分层（照计划 §六 的陷阱条目办）：
 * 1. **解码在浏览器**：`fetch` + `AudioContext.decodeAudioData` 得到 PCM，再压成
 *    512 格 RMS 包络。这一段依赖 Web Audio，Node 里跑不了 ⇒ 不可单测。
 * 2. **取样在纯函数**：`waveformBars`（`timing.ts`）决定"第 N 帧每根柱多高"，
 *    纯函数、可单测、与帧一一对应 ⇒ 同一份 manifest 渲两次柱高一模一样。
 *    （绝不能把这段写成 `requestAnimationFrame` / CSS animation —— 逐帧截图会漂移。）
 * 3. 解码失败（跨域 / 格式不支持 / 环境无 AudioContext）**不抛错**：画一条基线，
 *    成片照常出，只是没有波形 —— 比整条片子渲染失败好。
 */
import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { AbsoluteFill, continueRender, delayRender, useCurrentFrame } from 'remotion'
import { resolveAnimatedStyle } from '../animated-style.js'
import type { AudioVizTrack } from '../manifest.js'
import { waveformBarsSmoothed, colorShiftAt } from '../timing.js'

/** 包络格数：够细（512 格）又不至于让解码循环变慢。 */
const ENVELOPE_BUCKETS = 512
/** 解码兜底超时（毫秒）：超时就按基线渲染，不能把整条片卡死在这里。 */
const DECODE_TIMEOUT_MS = 10_000

/**
 * 解码音频为「512 格 RMS 包络（0–1 归一化）」。失败返回空数组（= 画基线）。
 *
 * ⚠️ 必须 `delayRender`：解码是**异步**的，若不阻塞首帧，前若干帧拍到的会是"还没解码好"
 * 的基线柱、后面才变成真波形 —— 而拍到的帧数取决于机器快慢 ⇒ 同一 manifest 渲两次
 * 结果不同，直接违反确定性铁律。`delayRender` 让渲染等数据就绪再开拍（解码本身是
 * 确定性输入 ⇒ 结果稳定）。
 */
function useAudioAmplitudes(src: string): number[] {
  const [amplitudes, setAmplitudes] = useState<number[]>([])
  const [handle] = useState(() => delayRender('audioViz：解码音频包络'))
  const released = useRef(false)

  useEffect(() => {
    let cancelled = false
    const release = (): void => {
      if (released.current) return
      released.current = true
      continueRender(handle)
    }
    // 兜底：解码 / 取文件卡住时也要放行（否则整条渲染挂在 delayRender 上）。
    const guard = setTimeout(release, DECODE_TIMEOUT_MS)
    const run = async (): Promise<void> => {
      try {
        const ResolvedAudioContext =
          (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext
        if (ResolvedAudioContext === undefined) return
        const response = await fetch(src)
        if (!response.ok) return
        const bytes = await response.arrayBuffer()
        const context = new ResolvedAudioContext()
        const audio = await context.decodeAudioData(bytes)
        const data = audio.getChannelData(0)
        const bucket = Math.max(1, Math.floor(data.length / ENVELOPE_BUCKETS))
        const out: number[] = []
        for (let b = 0; b < ENVELOPE_BUCKETS; b += 1) {
          const start = b * bucket
          const end = Math.min(data.length, start + bucket)
          let sum = 0
          let count = 0
          for (let i = start; i < end; i += 1) {
            const sample = data[i] ?? 0
            sum += sample * sample
            count += 1
          }
          out.push(count === 0 ? 0 : Math.sqrt(sum / count))
        }
        const peak = out.reduce((max, value) => (value > max ? value : max), 0)
        if (!cancelled) setAmplitudes(peak <= 0 ? out : out.map((value) => value / peak))
        await context.close()
      } catch {
        // 静默降级：解码不可用 ⇒ 基线波形（见文件头第 3 条）。
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
  }, [src, handle])
  return amplitudes
}

export const AudioViz: React.FC<{ track: AudioVizTrack }> = ({ track }) => {
  const frame = useCurrentFrame()
  const anim = resolveAnimatedStyle(track, frame)
  const amplitudes = useAudioAmplitudes(track.src)
  const bars = Math.max(1, Math.min(128, Math.floor(track.bars ?? 24)))
  // `speed` 0.6：按 30fps 计，每秒前进 18 格 —— 视觉上跟得上音乐又不至于抽搐。
  // 三期 W3-3：`smoothing` 帧间指数平滑（仍是纯函数；0 = 与今天完全一致）。
  const heights = waveformBarsSmoothed(amplitudes, frame, {
    bars,
    gain: track.gain ?? 1.6,
    speed: 0.6,
    smoothing: track.smoothing ?? 0,
  })
  const mirror = track.mode === 'mirror'
  const lineMode = track.mode === 'line'
  const heightPercent = Math.max(1, Math.min(100, track.heightPercent ?? 28))
  // 三期 W2-3：`colorShift` 覆盖静态色。
  const color = colorShiftAt(track, frame) ?? track.color ?? '#4f9cf9'
  // 三期 W3-3：柱体渐变（缺省纯色）。
  const fill = track.gradient === undefined
    ? color
    : `linear-gradient(180deg, ${track.gradient.from ?? color}, ${track.gradient.to ?? 'rgba(0,0,0,0)'})`
  const anchoredBottom = (track.position ?? 'bottom') === 'bottom'
  return (
    <AbsoluteFill
      style={{
        opacity: anim.opacity,
        justifyContent: (track.position ?? 'bottom') === 'bottom' ? 'flex-end' : 'flex-start',
        transform: anim.layerTransform,
        ...(anim.blend === 'normal' ? {} : { mixBlendMode: anim.blend }),
        ...(anim.fx.filter !== undefined ? { filter: anim.fx.filter } : {}),
        ...(anim.fx.maskImage !== undefined ? { maskImage: anim.fx.maskImage } : {}),
      }}
    >
      {lineMode ? (
        // 连续波形线：`points` 由纯函数算出的柱高映射到 0–100 viewBox，无插值、无动画。
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          width="100%"
          height={`${heightPercent}%`}
          style={{ display: 'block' }}
        >
          <polyline
            fill="none"
            stroke={color}
            strokeWidth={1.6}
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={heights
              .map((value, index) => {
                const x = heights.length <= 1 ? 50 : (index / (heights.length - 1)) * 100
                const y = mirror ? 50 - (value * 100) / 2 : 100 - value * 100
                return `${x.toFixed(3)},${y.toFixed(3)}`
              })
              .join(' ')}
          />
        </svg>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: mirror ? 'center' : (anchoredBottom ? 'flex-end' : 'flex-start'),
            gap: '0.35%',
            width: '100%',
            height: `${heightPercent}%`,
            ...(anchoredBottom ? { marginBottom: 0 } : { marginTop: 0 }),
          }}
        >
          {heights.map((value, index) => (
            <div
              key={index}
              style={{
                flex: 1,
                // 基线：无振幅时也留 2% 高度，看上去是"静音时的波形"，不是渲染失败。
                height: `${Math.max(2, value * 100)}%`,
                background: fill,
                borderRadius: 4,
                opacity: 0.92,
              }}
            />
          ))}
        </div>
      )}
    </AbsoluteFill>
  )
}
