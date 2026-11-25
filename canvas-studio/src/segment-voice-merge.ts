/**
 * REQ-041 P1（2026-11-25）· **段视频 + 对应旁白 → 带声副本**（IO 执行层）。
 *
 * 纯配对在 `segment-audio.ts`；本模块只做三件事：
 * ① 把 manifest 的 `voiceOver[].src`（同源 URL）解析成 assets 里的本地音频文件；
 * ② 用 `buildMuxArgs`（`-c:v copy` 画面零重编码）把无声段 + 旁白合流；
 * ③ 写 `assets/seg-<id>-voice.mp4`（确定性覆盖），失败回退无声版并记 note。
 *
 * 纪律：
 * - **不覆盖无声段** —— concat / 缓存仍需流结构一致的无声 mp4；
 * - 合流失败不抛（成片和清单照常，只是这一段没声音）；
 * - `runFfmpeg` 可注入 —— 行为测试用假执行器，不依赖本机 ffmpeg。
 */
import { join } from 'node:path'
import { buildMuxArgs } from './audio-compose.js'
import { resolveAssetPathIn } from './asset-path.js'
import { resolveFfmpegPath, runFfmpeg, FFMPEG_TIMEOUT_MS } from './ffmpeg-run.js'
import { segmentAssetName } from './segment-artifacts.js'
import { segmentVoiceName, type SegmentVoiceMatch } from './segment-audio.js'

export type FfmpegRun = typeof runFfmpeg

export interface MergeSegmentVoiceInput {
  projectDir: string
  assetsDir: string
  /** 段 id（产物 id，已清洗；来自 planSegmentArtifacts）。 */
  id: string
  /** 无声段在 assets 下的文件名（`seg-<id>.mp4`）。 */
  silentFile: string
  /** 段时长（秒，来自段窗 / fps）；用于 `-t` 精确截断。 */
  durationSec: number
  match: SegmentVoiceMatch
  signal?: AbortSignal
  run?: FfmpegRun
}

export interface MergeSegmentVoiceResult {
  /** 带声副本文件名（成功）；失败时 undefined —— 清单回退无声版。 */
  voiceFile?: string
  note?: string
}

/** manifest 音频 URL → assets 本地路径（只认同源两段式 `/canvas-studio/assets/<pid>/<file>`）。 */
export function voiceAssetFileOf(src: string): string | undefined {
  const marker = '/canvas-studio/assets/'
  const at = src.indexOf(marker)
  if (at < 0) return undefined
  const rest = src.slice(at + marker.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return undefined
  return rest.slice(slash + 1).split('?')[0] || undefined
}

/**
 * 合成一段的带声副本。返回 `voiceFile` 表示清单应改指向它；失败一律回退（不抛）。
 */
export async function mergeSegmentVoice(input: MergeSegmentVoiceInput): Promise<MergeSegmentVoiceResult> {
  const audioFile = voiceAssetFileOf(input.match.src)
  if (audioFile === undefined) return { note: `${input.id} 旁白 URL 不是同源资产，跳过合声` }
  let voicePath: string
  let silentPath: string
  try {
    voicePath = resolveAssetPathIn(input.assetsDir, audioFile)
    silentPath = resolveAssetPathIn(input.assetsDir, input.silentFile)
  } catch {
    return { note: `${input.id} 旁白 / 无声段路径越界，跳过合声` }
  }
  const voiceFile = segmentVoiceName(input.id)
  const outputPath = join(input.assetsDir, voiceFile)
  try {
    const run = input.run ?? runFfmpeg
    // REQ-041 P1-4：`offsetSec` = 台词相对段首的偏移。段窗起点不是台词起点
    // （实测每段差 10 帧 = 0.333s），整条贴段首会让预览比成片早开口。
    const result = await run(
      resolveFfmpegPath(),
      buildMuxArgs(silentPath, voicePath, outputPath, input.durationSec, input.match.offsetSec),
      FFMPEG_TIMEOUT_MS,
      input.signal,
    )
    if (result.code !== 0) return { note: `${input.id} 合声失败（ffmpeg ${String(result.code)}），清单回退无声版` }
    return { voiceFile, ...(input.match.note === undefined ? {} : { note: input.match.note }) }
  } catch (cause) {
    return { note: `${input.id} 合声异常（${cause instanceof Error ? cause.message : String(cause)}），清单回退无声版` }
  }
}

/** 清单指向哪个文件：带声副本存在用它，否则无声段（只读 stat 已由调用方做）。 */
export function segmentPlaybackFile(id: string, hasVoice: boolean): string {
  return hasVoice ? segmentVoiceName(id) : segmentAssetName(id)
}
