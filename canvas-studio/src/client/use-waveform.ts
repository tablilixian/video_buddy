/**
 * C3：波形条共用 hook —— 三处音频消费方（CanvasNode 节点卡 / AudioPlayerModal
 * 播放器 / CanvasTimeline BGM 轨）**必须**都走这里，防止再长出第二套波形公式
 * （旧代码曾有两套互不相同的伪随机公式）。
 *
 * 行为：先用确定性降级公式同步出条（同一 url 每次一致，CV-128 语义保留），
 * 再异步向 Host 要真包络（ffmpeg 解码）—— 拿到就重采样覆盖，失败静默保持
 * 降级。url 变化时重置；卸载时丢弃在途请求结果。
 */
import { createElement, useEffect, useMemo, useState } from 'react'
import { waveBarsDeterministic, waveBarsFromEnvelope } from '../waveform.js'
import { fetchStudioWaveform } from './api.js'

/** 从同源资产 URL 解析 projectId / file（非资产 URL 返回 null）。 */
function parseAssetRef(url: string): { projectId: string; file: string } | null {
  const match = url.match(/\/canvas-studio\/assets\/([^/]+)\/(.+?)(?:\?.*)?$/)
  return match === null ? null : { projectId: match[1]!, file: match[2]! }
}

export function useWaveBars(url: string | undefined, bars: number): number[] {
  const seedText = url ?? ''
  const fallback = useMemo(() => waveBarsDeterministic(seedText, bars), [seedText, bars])
  const [barsState, setBarsState] = useState(fallback)
  // url 换曲时立即回到该曲的降级条，避免上一曲的真包络串台。
  useEffect(() => { setBarsState(fallback) }, [fallback])
  useEffect(() => {
    if (url === undefined) return
    const asset = parseAssetRef(url)
    if (asset === null) return
    const controller = new AbortController()
    let alive = true
    void fetchStudioWaveform(asset.projectId, asset.file, controller.signal).then((envelope) => {
      if (alive && envelope !== null) setBarsState(waveBarsFromEnvelope(envelope, bars))
    })
    return () => {
      alive = false
      controller.abort()
    }
  }, [url, bars])
  return barsState
}

export interface WaveBarsProps {
  /** 音频资产 URL（同源 /canvas-studio/assets/...；缺省 = 全降级条）。 */
  url?: string | undefined
  /** 波形条数。 */
  bars: number
}

/**
 * 波形条带（`.csWaveBars > i`）。时间轴 BGM 轨等「在 map 里渲染」的场景不能
 * 逐项调 hook，用这个实例级组件承载（组件内部调 useWaveBars 合规）。
 */
export function WaveBars(props: WaveBarsProps): React.JSX.Element {
  const { url, bars } = props
  const heights = useWaveBars(url, bars)
  return createElement(
    'span',
    { className: 'csWaveBars', 'aria-hidden': 'true' },
    heights.map((height, index) =>
      createElement('i', { key: index, style: { height: `${height}%` } })),
  )
}
