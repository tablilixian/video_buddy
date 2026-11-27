/**
 * P0-2（2026-11-27 超级月亮会话复盘）· **分镜路径的整轨混音**。
 *
 * ## 为什么需要这个模块
 *
 * 分镜渲染（RQ-038 R11）此前只对**无声片**开放 —— `shot-render.ts` 里
 * `allowShots: manifest.audio === undefined`。原因不是"分镜不适合带音频"，而是
 * 分镜链路缺了最后一步：
 *
 * - 段渲染恒 `muteAudio: true`，且 `segmentManifest` 会 `delete audio`（D3）；
 * - `shot-concat` 用 `-c copy` 拼段 ⇒ 合并片**没有音轨**；
 * - `runShotRender` 的 outcome 里没有任何补声步骤。
 *
 * 于是"挂了旁白"这一最基本的情形被迫退回整片渲染：**改一屏 = 整片重渲 68–150s**，
 * 而真正需要的段补渲只要 5–15s。真机会话实测 75s 片子：12 次整片渲染 820s，
 * 其中大半是这一步白付的。
 *
 * 本模块把缺的那一步补上：按 compose 侧**同一套** AudioTimeline 语义把
 * `manifest.audio` 装配成整轨，再 `-c:v copy` 合进合并片 —— 画面零重编码，
 * 分镜的增量收益完整保留。
 *
 * ## 边界（刻意不做的事）
 *
 * 只处理 `audio.*`（bgm / 旁白 / 音效）。`native` 段（video 轨自带声）在这里
 * **没有素材可混**：段渲染时已被 mute，段视频里根本没有音轨。所以带 video 轨的
 * 片子仍整片渲染 —— 判据是 `audioCompatibleWithShots()`，不是在这里假装能补。
 *
 * 失败不抛：成片已经渲出来了，混音失败只该退化成"这一段没声音"，绝不能让成片陪葬
 * （与 `publishSegmentPreview` 同一条纪律）。
 */
import type { CompositionManifest } from './remotion/manifest.js'
import {
  buildAudioTrackArgs,
  buildMuxArgs,
  timelineFromManifestAudio,
} from './audio-compose.js'
import { buildAudioGraph, compositionFromTimeline, resolveAudioTimeline } from './audio-timeline.js'
import { urlToAssetPath } from './compose.js'
import { flattenTracksDeep } from './remotion/group-children.js'
import { resolveFfmpegPath, runFfmpeg, type FfmpegRunResult } from './ffmpeg-run.js'
import type { StudioAudioComposition } from './contracts/canvas.js'

/** 混音超时：整轨是纯音频重编码，比整片渲染便宜一个量级，但长片仍要给足。 */
const MUX_TIMEOUT_MS = 120_000

export interface MuxManifestAudioInput {
  /** 无声母版（分镜拼接产物）。 */
  videoPath: string
  /** 带声成片落点。`mixed:false` 时不会写这个文件。 */
  outputPath: string
  manifest: CompositionManifest
  assetsDir: string
  signal?: AbortSignal
  /** 测试注入；生产走默认 ffmpeg。 */
  run?: (ffmpegPath: string, args: readonly string[], timeoutMs: number, signal?: AbortSignal) => Promise<FfmpegRunResult>
  /** 测试注入；生产走 resolveFfmpegPath。 */
  resolvePath?: () => string
}

export interface MuxManifestAudioResult {
  /** 是否真的混了。false ⇒ 调用方应继续用入参 `videoPath`（无声）。 */
  mixed: boolean
  /** 混音后的视频路径（`mixed:false` 时恒等于入参 `videoPath`）。 */
  videoPath: string
  /** 音轨构成（八枚举派生，回执/交付卡读它）。 */
  audioComposition?: StudioAudioComposition
  /** 降级说明。非空时调用方应把它放进回执 —— 静默无声是最难查的坑。 */
  note?: string
}

/**
 * 带音频的片子能否走分镜。
 *
 * 判据只有一条：**画面里没有自带原生音轨的 video 轨**。
 * - 纯代码/图文片（textCard / shape / image / chart …）⇒ 声音全在 `manifest.audio`，
 *   分镜 + 本模块混音 = 与整片渲染等价；
 * - 有 video 轨 ⇒ 它可能带原生声（H3 的 `generateAudio`），段渲染 mute 之后就找不回来，
 *   仍整片渲染（不赌"这个 video 大概没声音"）。
 */
export function audioCompatibleWithShots(manifest: CompositionManifest): boolean {
  if (manifest.audio === undefined) return true
  return !flattenTracksDeep(manifest.tracks).some((track) => track.type === 'video')
}

/**
 * 把 `manifest.audio` 混进无声母版。**纯 IO，无状态**，失败只降级不抛。
 */
export async function muxManifestAudio(input: MuxManifestAudioInput): Promise<MuxManifestAudioResult> {
  const audio = input.manifest.audio
  if (audio === undefined) return { mixed: false, videoPath: input.videoPath }

  const timeline = timelineFromManifestAudio(input.manifest)
  // native 段没有素材可混（段渲染已 mute，段视频无音轨）—— 剔掉它才能过 resolveAudioTimeline
  // 的 `empty-source` 校验，也才是这条路径能真实出声的源集合。
  const mixable = timeline.segments.filter((segment) => segment.role !== 'native')
  if (mixable.length === 0) {
    return {
      mixed: false,
      videoPath: input.videoPath,
      note: 'ℹ️ 本片音频只有 video 轨原生声，分镜路径无法补（段渲染恒静音）——已输出无声母版；要原生声请走整片渲染。',
    }
  }

  // fps / durationSec 要跟着走：`resolveAudioTimeline` 的入参是完整 AudioTimeline，
  // 只截 segments 会丢掉帧率（时间轴校验靠它做帧↔秒换算）。
  const resolved = resolveAudioTimeline({ ...timeline, segments: mixable })
  if (!resolved.ok) {
    const detail = resolved.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => issue.message)
      .join('；')
    return { mixed: false, videoPath: input.videoPath, note: `⚠️ 分镜成片混音跳过（音轨时间轴校验失败）：${detail}` }
  }

  // filterComplex 的输入序号与 `-i` 的顺序必须一一对应 ⇒ 用同一个数组派生，不各写一遍。
  const segmentInputs = resolved.timeline.segments.map((segment) => urlToAssetPath(input.assetsDir, segment.url))
  const graph = buildAudioGraph(resolved.timeline)
  const filmDurationSec = input.manifest.meta.durationInFrames / input.manifest.meta.fps
  const audioTrackPath = `${input.outputPath}.audio.m4a`

  const ffmpegPath = (input.resolvePath ?? resolveFfmpegPath)()
  const run = input.run ?? runFfmpeg
  try {
    // 变量名不叫 `track`：`tests/manifest-fields-drift.test.mjs` 的 P-02 扫描按
    // `track.X` 字面匹配 manifest 轨道字段，叫 track 会把 ffmpeg 的 `track.stderr`
    // 误判成「读了未登记的 track 字段」。用 audioTrack 与 compose.ts 同口径。
    const audioTrack = await run(
      ffmpegPath,
      buildAudioTrackArgs(segmentInputs, graph.filterComplex, audioTrackPath, filmDurationSec),
      MUX_TIMEOUT_MS,
      input.signal,
    )
    if (audioTrack.code !== 0) {
      const detail = audioTrack.stderr.trim().split('\n').at(-1) ?? ''
      return { mixed: false, videoPath: input.videoPath, note: `⚠️ 分镜成片混音跳过（音轨装配失败）：${detail}` }
    }
    const mux = await run(
      ffmpegPath,
      buildMuxArgs(input.videoPath, audioTrackPath, input.outputPath, filmDurationSec),
      MUX_TIMEOUT_MS,
      input.signal,
    )
    if (mux.code !== 0) {
      const detail = mux.stderr.trim().split('\n').at(-1) ?? ''
      return { mixed: false, videoPath: input.videoPath, note: `⚠️ 分镜成片混音跳过（成片合流失败）：${detail}` }
    }
  } catch (cause) {
    return {
      mixed: false,
      videoPath: input.videoPath,
      note: `⚠️ 分镜成片混音跳过（ffmpeg 异常）：${cause instanceof Error ? cause.message : String(cause)}`,
    }
  }

  return {
    mixed: true,
    videoPath: input.outputPath,
    audioComposition: compositionFromTimeline(resolved.timeline),
    ...(graph.notes.length === 0 ? {} : { note: graph.notes.join('；') }),
  }
}
