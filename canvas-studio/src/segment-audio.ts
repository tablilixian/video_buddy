/**
 * REQ-041 P1（2026-11-25）· **段视频 + 对应旁白 → 带声段副本**（纯规划层）。
 *
 * ## 为什么需要这一层
 *
 * R11-C3 刻意让段 mp4 无音轨（-91dB 静音轨 / 拼接点 40ms 定格 / hover 浏览器限制），
 * 但用户看分镜卡时想听到「这一屏的台词」。解法不是推翻段渲染，而是**多产出一个
 * 面向预览的带声副本**：无声段留给 concat/缓存，带声副本只给画布清单。
 *
 * ## 配对纪律（最关键的纯函数）
 *
 * `voiceOver[].startFrame` 落在段的 `[startFrame, endFrame)` 帧窗 ⇒ 这一句属于这一段。
 * **禁止按序号配**：manifest 段表可能过期、voiceOver 可能缺句、中文 id 会把产物名
 * 折成 `-`。落窗是唯一判据，落不进任何窗的旁白不合并（诚实失败，不静默配错屏）。
 *
 * 一段多句时取落窗的第一句并在 note 里说明 —— 真机数据是 11 段对 11 句；
 * 多句场景保留「不丢句子」的扩展位，但本轮不引入第二次 ffmpeg 拼接复杂度。
 */
import type { CompositionManifest, ManifestVoiceOver } from './remotion/manifest.js'
import { segmentAssetName } from './segment-artifacts.js'

/** 带声副本文件名（`seg-<id>-voice.mp4`）——**只有这一处拼这个扩展名**。 */
export function segmentVoiceName(id: string): string {
  return segmentAssetName(id).replace(/\.mp4$/, '-voice.mp4')
}

/** 落窗结果：一段一句。`note` 在有多句/跨窗时给出，供回执说清楚。 */
export interface SegmentVoiceMatch {
  /** 旁白资产 URL（manifest 原文，宿主侧经 `resolveAssetPathIn` 取本地路径）。 */
  src: string
  startFrame: number
  /**
   * REQ-041 P1-4：台词相对**段首**的偏移（秒，≥0）。
   *
   * 段窗起点不等于台词起点。真机数据：s2 段窗 `[235,480)`、旁白 `startFrame=245`
   * ⇒ 段内 10 帧 = 0.333s；s3/s4 同样差 10 帧，只有 s1（0/0）恰好对齐。
   * 合声时按它补前置静音，否则预览里每一段都比成片早 1/3 秒开口。
   */
  offsetSec: number
  volume?: number
  note?: string
}

/**
 * 一段的旁白配对：按 `startFrame` 落窗，不按序号。
 *
 * - `frameEnd` 用半开区间 `[start, end)`；落在边界上的句子归后一段；
 * - 一段多句 ⇒ 取第一句 + note（本轮不做二次拼接）；
 * - 落不进任何窗 ⇒ undefined（不发带声副本，清单回退无声版）。
 */
export function matchVoiceForSegment(input: {
  voiceOver: readonly ManifestVoiceOver[] | undefined
  startFrame: number
  endFrame: number
  /** 整片帧率 —— 只用来把「台词相对段首的帧差」换成秒（合声补静音）。 */
  fps: number
}): SegmentVoiceMatch | undefined {
  if (!Array.isArray(input.voiceOver) || input.voiceOver.length === 0) return undefined
  const hits = input.voiceOver.filter((v) => {
    const at = typeof v?.startFrame === 'number' && Number.isFinite(v.startFrame) ? v.startFrame : 0
    return at >= input.startFrame && at < input.endFrame
  })
  if (hits.length === 0) return undefined
  const first = hits[0] as ManifestVoiceOver
  if (typeof first.src !== 'string' || first.src.length === 0) return undefined
  const startFrame = typeof first.startFrame === 'number' && Number.isFinite(first.startFrame)
    ? first.startFrame
    : input.startFrame
  // 落窗已保证 startFrame ∈ [段首, 段尾)，所以帧差恒 ≥ 0；max 只是防脏数据反向。
  const offsetFrames = Math.max(0, startFrame - input.startFrame)
  const offsetSec = Number.isFinite(input.fps) && input.fps > 0 ? offsetFrames / input.fps : 0
  return {
    src: first.src,
    startFrame,
    offsetSec,
    ...(typeof first.volume === 'number' ? { volume: first.volume } : {}),
    ...(hits.length > 1 ? { note: `该段有 ${String(hits.length)} 句旁白，带声副本只合第一句` } : {}),
  }
}

/**
 * 整条 manifest 的段→旁白配对表（键 = 段 id，来自 `planSegmentArtifacts`）。
 * 只做落窗，不读盘、不算 hash —— 宿主据此决定哪些段要合带声副本。
 */
export function matchSegmentVoices(input: {
  manifest: CompositionManifest
  artifacts: readonly { id: string; startFrame: number; frames: number }[]
}): Map<string, SegmentVoiceMatch> {
  const out = new Map<string, SegmentVoiceMatch>()
  const voiceOver = input.manifest.audio?.voiceOver
  // meta.fps 在 manifest 里是必填正数，但派生层不该因为一条脏数据整批抛 —— 取不到
  // 就当 0，`offsetSec` 兜底成 0（旧行为：整条贴段首），不拿 NaN 去算 ffmpeg 毫秒。
  const metaFps: unknown = input.manifest.meta?.fps
  const fps = typeof metaFps === 'number' && Number.isFinite(metaFps) && metaFps > 0 ? metaFps : 0
  for (const artifact of input.artifacts) {
    const match = matchVoiceForSegment({
      voiceOver,
      startFrame: artifact.startFrame,
      endFrame: artifact.startFrame + artifact.frames,
      fps,
    })
    if (match !== undefined) out.set(artifact.id, match)
  }
  return out
}
