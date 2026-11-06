/**
 * 浏览器侧 RMS 包络（C4 相对锚定从 Caption.tsx 抽出共用）。
 *
 * 消费方两处：`Caption`（逐字卡拉OK）与 Root 的锚定解析（`useAnchorResolution`）——
 * 同一份实现不许复制（同 teardown 检测函数纪律）。decode 在浏览器侧
 * （AudioContext.decodeAudioData，同 AudioViz 模式），确定性输入。
 */
import { useEffect, useRef, useState } from 'react'
import { continueRender, delayRender } from 'remotion'

/** 解码兜底超时：卡住也要放行，不能把整条渲染挂在 delayRender 上。 */
export const ENVELOPE_DECODE_TIMEOUT_MS = 10_000

/** 浏览器侧 RMS 包络（10ms 分桶，原始幅值 —— 推导函数内部按峰值归一）。 */
export function envelopeFromPcm(data: Float32Array, sampleRate: number): number[] {
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

/**
 * 取一段音频的 RMS 包络（hook）：解码完成前 `null`（`delayRender` 闸住首帧拍摄），
 * 解码失败 / AudioContext 不可用静默降级为 `null`（调用方走均匀兜底）。
 *
 * `enabled: false` ⇒ 完全不发 `delayRender`、不 fetch、不解码，直接返回 `null`。
 * CV-450：caption 已有更便宜的对齐来源（真实时长 + 字数比例）时，没必要为一段
 * 用不上的包络付「整段解码 + 阻塞首帧」的代价。
 */
export function useEnvelope(src: string, enabled = true): number[] | null {
  const [envelope, setEnvelope] = useState<number[] | null>(null)
  const [handle] = useState(() => (enabled ? delayRender('audio-envelope：解码音频包络') : null))
  const released = useRef(false)
  const release = () => {
    if (released.current) return
    released.current = true
    if (handle !== null) continueRender(handle)
  }
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const guard = setTimeout(release, ENVELOPE_DECODE_TIMEOUT_MS)
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
        // 静默降级：解码不可用 ⇒ 调用方走均匀兜底
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
  }, [src, enabled])
  return enabled ? envelope : null
}
