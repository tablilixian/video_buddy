/**
 * S2b（2026-10-28 · CV-040 收口 · D-01 拍板）：音频从零装配层。
 *
 * 结构升级后 compose 的多镜流程是：
 * ```
 * 视频：逐段统一转码 → concat demuxer → 母版（含音轨，合流期只取视频流）
 * 音频：AudioTimeline → buildAudioGraph（audio-timeline.ts 唯一生成点）→ 一条完整音轨
 * 合流：-i 母版 -i 音轨 -map 0:v -map 1:a -c:v copy -c:a aac → 成片
 * ```
 *
 * 本文件持有「装配」的全部纯逻辑：母版/音轨/合流的 ffmpeg 参数构造、
 * compose 侧片段 → AudioTimeline 的映射（`timelineFromComposeClips`，G1a 探针
 * Part 2 的能力标记）、短 BGM 自动补静音的决策（D-02）。ffmpeg 的 IO 编排仍在
 * compose.ts（compose.ts 1200 行棘轮，纯逻辑外移是棘轮要求，见计划 §8）。
 *
 * 兼容面：`buildBgmFade` / `fadeAnchorOf` / `inferBgmSilenceProfile` /
 * `bgmShortfallMessage` / `BGM_SHORTFALL_TOLERANCE_SEC` 自本文件原样再导出
 * （历史调用点与老单测的 import 路径不变）；旧 concat 混音的 `buildAmixArgs`
 * 留在 compose.ts（兼容包装，老单测逐字符判据仍成立）。
 */
import type { AudioTimeline, AudioSegment } from './audio-timeline.js'
import { resolveAudioTimeline, describeTimeline, AUDIO_DELIVERY_SAMPLE_RATE, AUDIO_DELIVERY_CHANNELS } from './audio-timeline.js'

/**
 * CV-141：单镜「环境声 + BGM」叠混时的 BGM 音量。
 *
 * 混音已用 `amix=normalize=0`（线性求和，CV-141：默认归一化会把每一路各乘 0.5）。
 * 线性求和下环境声留在前景、BGM 只作铺底，否则两路相加会削顶。
 */
export const BGM_MIX_VOLUME = 0.35
/** BGM 单轨音量（0–1）：成片只有 BGM 时（无 amix、无归一化）。 */
export const BGM_VOLUME = 0.8
/** 旁白满音量（前景主声，不铺底）。 */
export const VOICE_VOLUME = 1
/** BGM 淡入淡出时长（秒，CV-209 自适应淡入淡出锚点上限）。默认仍是 1s。 */
export const BGM_FADE_SEC = 1
/** 自适应淡入淡出：当 BGM 头/尾留白大于该阈值（秒）时不强制淡入/淡出，信任音频自带的起止。 */
export const BGM_SILENT_EDGE_SEC = 2
/**
 * CV-138：BGM 时长守卫的容差（秒）。差额不超过它视为「等长」（探测本身有毫秒级
 * 抖动，不值得为此报错）。
 */
export const BGM_SHORTFALL_TOLERANCE_SEC = 0.05

/** BGM 头尾留白剖面（CV-209）。 */
export interface BgmSilenceProfile { headSilence: number; tailSilence: number }

/**
 * CV-209：探测 BGM 头尾留白长度（启发式）。返回 `{ headSilence, tailSilence }`（秒）。
 * 无法探测时返回 0。详尽能量探测留给 ffmpeg `silencedetect`，这里以可解析到的常见度量为准。
 */
export function inferBgmSilenceProfile(bgmDuration: number, filmDuration: number): BgmSilenceProfile {
  // 无探测能力的退化路径：以"长于成片部分"估算尾留白 —— "宁可比视频长"的部分
  // 通常是模型为了自然衰减而留的尾巴；按最小留白模型保守估。
  if (!Number.isFinite(bgmDuration) || bgmDuration <= 0) return { headSilence: 0, tailSilence: 0 }
  const overflow = bgmDuration - filmDuration
  if (overflow < 0) return { headSilence: 0, tailSilence: 0 }
  // 经验值：长出的 80% 视作尾留白，最大 4s（再长就明确是失误，去掉）。
  const tailSilence = Math.min(overflow * 0.8, 4)
  return { headSilence: 0, tailSilence }
}

/**
 * 构造 BGM 淡入淡出滤镜串（纯函数）。时长不足一个淡入周期时只做淡入。
 * 返回空串表示不做任何淡化（如时长未知）。
 *
 * CV-209 升级：BGM 尾留白 ≥ `BGM_SILENT_EDGE_SEC` 时不加淡出滤镜（信任音频自带
 * 衰减，强加 afade 会造成双重淡出，听感"闷尾"）；头留白 ≥ 同值时不加淡入。
 *
 * ⚠️ CV-138：传入的**不是 BGM 自身时长，而是淡化锚点**（= `fadeAnchorOf(bgm, 成片)`）。
 */
export function buildBgmFade(duration: number, profile?: BgmSilenceProfile): string {
  if (!Number.isFinite(duration) || duration <= 0) return ''
  const skipIn = (profile?.headSilence ?? 0) >= BGM_SILENT_EDGE_SEC
  const fadeIn = skipIn ? '' : `afade=t=in:st=0:d=${BGM_FADE_SEC}`
  const skipOut = (profile?.tailSilence ?? 0) >= BGM_SILENT_EDGE_SEC
  const fadeOut = !skipOut && duration > BGM_FADE_SEC
    ? `afade=t=out:st=${(duration - BGM_FADE_SEC).toFixed(3)}:d=${BGM_FADE_SEC}`
    : ''
  const all = [fadeIn, fadeOut].filter(Boolean).join(',')
  return all.length > 0 ? `,${all}` : ''
}

/** S2b：时间轴段的淡入淡出秒数（`buildBgmFade` 的数值版 —— 装配路径要把淡变写进
 *  AudioSegment，而不是拼滤镜串）。语义与 `buildBgmFade` 完全一致。 */
export function bgmFadeSecondsOf(bgmDuration: number, filmDuration: number): { fadeInSec?: number; fadeOutSec?: number } {
  if (!Number.isFinite(bgmDuration) || bgmDuration <= 0) return {}
  const anchor = fadeAnchorOf(bgmDuration, filmDuration)
  const profile = inferBgmSilenceProfile(bgmDuration, filmDuration)
  if (anchor <= 0) return {}
  const skipIn = profile.headSilence >= BGM_SILENT_EDGE_SEC
  const skipOut = profile.tailSilence >= BGM_SILENT_EDGE_SEC || anchor <= BGM_FADE_SEC
  return {
    ...(skipIn ? {} : { fadeInSec: BGM_FADE_SEC }),
    ...(skipOut ? {} : { fadeOutSec: BGM_FADE_SEC }),
  }
}

/**
 * CV-138：淡出锚点——取 BGM 与成片真值中的较小者（这就是「听着该收尾」的时刻）。
 * 两者都未知（≤0 / 非有限）时返回 0，`buildBgmFade` 会据此不加任何淡化。
 */
export function fadeAnchorOf(bgmDuration: number, filmDuration: number): number {
  const known = [bgmDuration, filmDuration].filter((value) => Number.isFinite(value) && value > 0)
  return known.length === 0 ? 0 : Math.min(...known)
}

/**
 * CV-138：BGM 时长守卫（纯函数）。BGM 短于成片时返回中文报错文案，够长或无法
 * 判定（任一时长未知）时返回 `null`。
 *
 * S2b（D-02）：本守卫从「默认报错」改为「默认自动补静音（见 bgmAutopadDecision）」，
 * `CANVAS_STUDIO_AUDIO_AUTOPAD=0` 回退本守卫的报错行为。拉伸会变调、循环会在非
 * 节拍点接缝 —— 两者都是「听得出错」的降级，补静音是唯一听不出来的处置。
 */
export function bgmShortfallMessage(bgmDuration: number, filmDuration: number): string | null {
  // 无法判定时不报错（调用方会降级并留 warning），避免把「探测失败」当成「BGM 太短」。
  if (!(filmDuration > 0) || !(bgmDuration > 0)) return null
  const shortfall = filmDuration - bgmDuration
  // 浮点容差：两个时长都来自 ffprobe 的小数解析（如 15.5 − 15.45 在二进制下差 7e-16），
  // 恰好在阈值上时不该因为浮点误差报错。
  if (shortfall <= BGM_SHORTFALL_TOLERANCE_SEC + 1e-6) return null
  return `BGM 比成片短 ${shortfall.toFixed(3)} 秒（成片 ${filmDuration.toFixed(3)}s，BGM ${bgmDuration.toFixed(3)}s）。`
    + `请把 BGM 时长提高到 ≥${filmDuration.toFixed(3)}s（建议 ${Math.ceil(filmDuration + 0.5)}s）后重新合成。`
}

/** D-02：短 BGM 处置决策（纯函数）。默认自动补静音（graph 尾部 apad 已实现补齐，
 *  这里只决定「告知」还是「报错」）；`autopad=false` 回退旧守卫报错。 */
export function bgmAutopadDecision(bgmDurationSec: number, filmDurationSec: number, autopad: boolean): { action: 'ok' | 'pad' | 'error'; message?: string } {
  const shortfall = bgmShortfallMessage(bgmDurationSec, filmDurationSec)
  if (shortfall === null) return { action: 'ok' }
  if (!autopad) return { action: 'error', message: shortfall }
  const gap = filmDurationSec - bgmDurationSec
  return { action: 'pad', message: `BGM 比成片短 ${gap.toFixed(1)} 秒，已自动补静音（旧行为可用 CANVAS_STUDIO_AUDIO_AUTOPAD=0 回退为报错）。` }
}

/** compose 多镜片段的最小结构面（structural，避免与 compose.ts 相互 import 成环）。 */
export interface ComposeClipTimelineSource {
  id: string
  /** 本地绝对路径（装配 ffmpeg 的 `-i` 输入）。 */
  inputPath: string
  hasAudio: boolean
  /** 探测到的真实时长（秒；0/缺省 = 未探到，不伪造）。 */
  realDurationSec?: number
}

/** 多句旁白入参：字符串 = 顺序堆叠（自动排布）；对象 = 显式起点（与 render 路径
 *  `audio.voiceOver[]` 的 startFrame 语义对齐）。 */
export interface VoiceOverPlacement {
  nodeId: string
  /** 绝对起点（秒）。缺省按顺序堆叠（前一句结束处）。 */
  startSec?: number
  /** 线性增益（0–1）；缺省满音量（旁白=前景主声，D6 口径）。 */
  gain?: number
}

/** 已解析的旁白素材（compose.ts 负责「节点 → 文件」的 IO 解析，本函数只做纯映射）。 */
export interface ResolvedVoiceOver extends VoiceOverPlacement {
  url: string
  inputPath: string
  realDurationSec?: number
  /** 节点 audioTimeline 写回的 duck 深度（混音面板；显式 API 入参优先）。 */
  duckAmount?: number
}

/** 已解析的混入音源（bgmNodeId 指向的节点；role 由 resolveAudioMixRole 判定）。 */
export interface ResolvedMixSource {
  url: string
  inputPath: string
  role: 'bgm' | 'voiceOver'
  realDurationSec?: number
  /** 节点 audioTimeline 写回的表现参数覆盖（混音面板 S3；缺省 = 装配默认口径）。 */
  override?: {
    gain?: number
    fadeInSec?: number
    fadeOutSec?: number
  }
}

export interface ComposeTimelineInput {
  clips: ReadonlyArray<ComposeClipTimelineSource>
  bgm?: ResolvedMixSource
  voiceOvers?: ReadonlyArray<ResolvedVoiceOver>
  /** 成片真值（秒；0 = 未知，装配期不钉长度）。 */
  filmDurationSec: number
  fps: number
}

export interface ComposeTimelineResult {
  timeline: AudioTimeline
  /** 归一化/堆叠过程需要回显的事项（已 resolve：error 已被调用方拦截）。 */
  notices: string[]
  /** 模型自查摘要（describeTimeline 产物，进结果 warnings）。 */
  summary: string
}

/**
 * compose 多镜片段 → AudioTimeline（**装配事实源的 compose 侧唯一入口**）。
 *
 * - native 段：每个**真有声**的片段一段 —— `startSec` = 前面片段真实时长的前缀和，
 *   `durationSec` = 本段真实时长（素材即原始片段文件，装配期从素材 0 处取满段长）。
 *   无音轨片段不产生段（该区间保持静音 —— S2a 补的静音轨在此被时间轴语义取代）。
 * - bgm 段：`startSec` 0；gain 有原生声时铺底（0.35）、无原生声时单轨（0.8）；
 *   淡入淡出按 CV-209 自适应口径（`bgmFadeSecondsOf`）。`bgmNodeId` 实际指向旁白时
 *   role=voiceOver：满音量、不淡变、允许短于成片（D6 口径）。
 * - voiceOver 段：字符串形式顺序堆叠（前一句结束处，零间隙）；对象形式用显式
 *   `startSec`。时长未知的旁白按 0 堆叠并回显 notice（不伪造）。
 */
export function timelineFromComposeClips(input: ComposeTimelineInput): ComposeTimelineResult {
  const notices: string[] = []
  const segments: AudioSegment[] = []
  let cursorSec = 0
  for (const clip of input.clips) {
    const real = clip.realDurationSec ?? 0
    if (clip.hasAudio) {
      segments.push({
        sourceNodeId: clip.id,
        url: clip.inputPath,
        startSec: cursorSec,
        ...(real > 0 ? { durationSec: real } : {}),
        role: 'native',
      })
    } else {
      notices.push(`片段 ${clip.id} 无原生音轨，该区间${real > 0 ? `（${real.toFixed(1)}s）` : ''}保持静音`)
    }
    if (real > 0) cursorSec += real
  }
  if (input.clips.some((clip) => (clip.realDurationSec ?? 0) <= 0)) {
    notices.push('有片段未探到真实时长，后续段起点按 0 偏移堆叠（不伪造时长）；成片音画对齐请以成片真值为准。')
  }
  // 旁白堆叠光标独立于 native 前缀和：字符串形式的第一句从 0s 起（旁白是前景主声，
  // 不该排在原生声之后），后续句紧跟前一句结束处。
  let voCursorSec = 0
  if (input.bgm !== undefined) {
    if (input.bgm.role === 'voiceOver') {
      segments.push({ sourceNodeId: 'bgm', url: input.bgm.inputPath, startSec: 0, ...(input.bgm.realDurationSec !== undefined && input.bgm.realDurationSec > 0 ? { durationSec: input.bgm.realDurationSec } : {}), gain: input.bgm.override?.gain ?? VOICE_VOLUME, role: 'voiceOver' })
    } else {
      const hasNative = segments.some((segment) => segment.role === 'native')
      const fades = bgmFadeSecondsOf(input.bgm.realDurationSec ?? 0, input.filmDurationSec)
      // 节点 audioTimeline（混音面板 S3）的覆盖优先于装配默认口径（0.35/0.8 + CV-209 淡变）。
      const gain = input.bgm.override?.gain ?? (hasNative ? BGM_MIX_VOLUME : BGM_VOLUME)
      segments.push({
        sourceNodeId: 'bgm',
        url: input.bgm.inputPath,
        startSec: 0,
        ...(input.bgm.realDurationSec !== undefined && input.bgm.realDurationSec > 0 ? { durationSec: input.bgm.realDurationSec } : {}),
        gain,
        ...(input.bgm.override?.fadeInSec !== undefined ? { fadeInSec: input.bgm.override.fadeInSec } : fades.fadeInSec !== undefined ? { fadeInSec: fades.fadeInSec } : {}),
        ...(input.bgm.override?.fadeOutSec !== undefined ? { fadeOutSec: input.bgm.override.fadeOutSec } : fades.fadeOutSec !== undefined ? { fadeOutSec: fades.fadeOutSec } : {}),
        role: 'bgm',
      })
    }
  }
  for (const voiceOver of input.voiceOvers ?? []) {
    const startSec = voiceOver.startSec ?? voCursorSec
    const real = voiceOver.realDurationSec ?? 0
    segments.push({
      sourceNodeId: voiceOver.nodeId,
      url: voiceOver.inputPath,
      startSec,
      ...(real > 0 ? { durationSec: real } : {}),
      ...(voiceOver.gain !== undefined ? { gain: voiceOver.gain } : {}),
      ...(voiceOver.duckAmount !== undefined ? { duckAmount: voiceOver.duckAmount } : {}),
      role: 'voiceOver',
    })
    if (voiceOver.startSec === undefined) {
      // 字符串形式：顺序堆叠光标推进（时长未知按 0，下一句与本级重叠 —— 已回显）。
      if (real > 0) voCursorSec = startSec + real
      else notices.push(`旁白 ${voiceOver.nodeId} 未探到时长，后续旁白按同点堆叠（不伪造时长）。`)
    }
  }
  const timeline: AudioTimeline = { fps: input.fps, durationSec: input.filmDurationSec, segments }
  const resolved = resolveAudioTimeline(timeline)
  notices.push(...resolved.issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.message))
  return { timeline: resolved.timeline, notices, summary: describeTimeline(resolved.timeline) }
}

/** 装配音轨的 ffmpeg 参数（`-i` × N → filter_complex → aac 48k 立体声 → 钉片长）。 */
export function buildAudioTrackArgs(
  segmentInputs: readonly string[],
  filterComplex: string,
  output: string,
  filmDurationSec: number,
): string[] {
  return [
    ...segmentInputs.flatMap((path) => ['-i', path]),
    '-filter_complex', filterComplex,
    '-map', '[out]',
    '-c:a', 'aac', '-ar', String(AUDIO_DELIVERY_SAMPLE_RATE), '-ac', String(AUDIO_DELIVERY_CHANNELS),
    ...(filmDurationSec > 0 ? ['-t', filmDurationSec.toFixed(3)] : []),
    '-y', output,
  ]
}

/** 母版 + 装配音轨 → 成片（`-c:v copy` 零重编码；音频 REPLACES 母版音轨）。 */
export function buildMuxArgs(master: string, audioTrack: string, output: string, filmDurationSec: number): string[] {
  return [
    '-i', master,
    '-i', audioTrack,
    '-map', '0:v',
    '-map', '1:a',
    '-c:v', 'copy',
    '-c:a', 'aac',
    ...(filmDurationSec > 0 ? ['-t', filmDurationSec.toFixed(3)] : []),
    '-y', output,
  ]
}

/** CompositionManifest.audio 的最小结构面（避免装配层反向依赖 remotion/manifest）。 */
export interface ManifestAudioLike {
  bgmUrl?: string
  voiceOverUrl?: string
  voiceOver?: ReadonlyArray<{ src?: string; startFrame?: number; volume?: number }>
  mix?: { bgmVolume?: number; voiceVolume?: number }
  fadeInSeconds?: number
  fadeOutSeconds?: number
  duck?: { amount?: number }
}

/** render 路径的 manifest 轨道最小结构面（只要「有没有 video 轨」这一事实）。 */
export interface ManifestTracksLike {
  type: string
}

/**
 * S2b：ManifestAudio → AudioTimeline 适配（**render 路径接入统一模型的读出口**，
 * 与 compose 侧的 `timelineFromComposeClips` 同层对称）。渲染器侧只做播放（Remotion
 * `<Audio>` 自己管混音），但音轨构成派生、结果回显、校验与 compose 路径共用同一份
 * AudioTimeline 语义：`deriveAudioComposition` = compositionFromTimeline(本函数)。
 *
 * native 段是占位（video 轨的原生声由渲染器随画面播放），只表达「有原生声」这一
 * 派生事实；段时长/起点由渲染器按帧精确控制，不在此复述。
 */
export function timelineFromManifestAudio(manifest: { tracks: ReadonlyArray<ManifestTracksLike>; audio?: ManifestAudioLike }): AudioTimeline {
  const segments: AudioSegment[] = []
  if (manifest.tracks.some((track) => track.type === 'video')) {
    segments.push({ url: '', startSec: 0, role: 'native' })
  }
  const audio = manifest.audio
  if (audio !== undefined) {
    if (typeof audio.bgmUrl === 'string' && audio.bgmUrl.length > 0) {
      segments.push({
        url: audio.bgmUrl,
        startSec: 0,
        role: 'bgm',
        ...(audio.mix?.bgmVolume !== undefined ? { gain: audio.mix.bgmVolume } : {}),
        ...(audio.fadeInSeconds !== undefined ? { fadeInSec: audio.fadeInSeconds } : {}),
        ...(audio.fadeOutSeconds !== undefined ? { fadeOutSec: audio.fadeOutSeconds } : {}),
      })
    }
    const duckAmount = audio.duck?.amount
    if (typeof audio.voiceOverUrl === 'string' && audio.voiceOverUrl.length > 0) {
      segments.push({
        url: audio.voiceOverUrl,
        startSec: 0,
        role: 'voiceOver',
        ...(audio.mix?.voiceVolume !== undefined ? { gain: audio.mix.voiceVolume } : {}),
        ...(duckAmount !== undefined && duckAmount > 0 ? { duckAmount } : {}),
      })
    }
    for (const clip of audio.voiceOver ?? []) {
      if (typeof clip.src !== 'string' || clip.src.length === 0) continue
      segments.push({
        // manifest 旁白 startFrame 是 30fps 基准（与渲染器帧率约定一致）。
        startSec: Math.round(((clip.startFrame ?? 0) / 30) * 1000) / 1000,
        url: clip.src,
        role: 'voiceOver',
        ...(clip.volume !== undefined ? { gain: clip.volume } : {}),
        ...(duckAmount !== undefined && duckAmount > 0 ? { duckAmount } : {}),
      })
    }
  }
  return { fps: 0, durationSec: 0, segments }
}
