/**
 * REQ-034（Remotion 集成）· B2 时序契约：把组件里的「什么时候出现 / 淡入淡出 /
 * 字幕排布 / 素材时长核对」全部抽成**纯函数**，组件只做布局（devdoc §12.3）。
 *
 * 这样做的理由（§0 R4）：官方没有 `@remotion/test-renderer`，组件行为无法用现有
 * `node --test` 断言；把时序抽出来后，边界与结算都能在 Node 里直接测。
 * 本文件**零 Remotion 依赖**，两条渲染路线通用。
 */

import type { BaseTrack, CompositionManifest } from './manifest.js'

/** 轨道在给定绝对帧下的局部帧（`frame - startFrame`，可为负 / 超界）。 */
export function trackLocalFrame(track: Pick<BaseTrack, 'startFrame'>, frame: number): number {
  return frame - track.startFrame
}

/**
 * 轨道在给定绝对帧下是否存活（半开区间 `[startFrame, startFrame + durationInFrames)`）。
 *
 * 与 §7.4 组件草图里 `local < 0 || local > durationInFrames` 的写法**有意不同**：
 * 草图的 `>` 会把轨道末帧之后的 1 帧也算进来（`local === durationInFrames` 时仍渲染），
 * 与该轨在转场/重叠窗口里使用的半开区间口径不一致。此处统一为半开区间，多轨叠放与
 * 转场计算才有唯一真值。见 §0.3（R19）。
 */
export function isTrackActive(track: Pick<BaseTrack, 'startFrame' | 'durationInFrames'>, frame: number): boolean {
  if (frame < track.startFrame) return false
  return frame < track.startFrame + track.durationInFrames
}

const DEFAULT_FADE_FRAMES = 6

/**
 * 轨道淡入淡出透明度（0–1），端点 clamp。前 `fadeFrames` 帧淡入、后 `fadeFrames` 帧淡出。
 * 时长不足两个淡入周期时自动折半，避免淡入淡出重叠成一整段半透明。
 */
export function fadeOpacity(
  localFrame: number,
  durationInFrames: number,
  fadeFrames: number = DEFAULT_FADE_FRAMES,
): number {
  if (durationInFrames <= 0) return 0
  const fade = Math.max(0, Math.min(fadeFrames, Math.floor(durationInFrames / 2)))
  if (fade === 0) return localFrame >= 0 && localFrame < durationInFrames ? 1 : 0
  const end = durationInFrames - fade
  if (localFrame <= 0) return 0
  if (localFrame >= durationInFrames) return 0
  if (localFrame < fade) return localFrame / fade
  if (localFrame >= end) return (durationInFrames - localFrame) / fade
  return 1
}

/** 无旁白时的字幕估算速率（4 字/秒；沿用 `voiceover-writing` 现行惯例，§10.3）。 */export const SUBTITLE_FALLBACK_SEC_PER_CHAR = 0.25

/** 句间默认呼吸间隔（秒）；从总时长内扣，不额外拉长（§10.3）。 */
export const SUBTITLE_BREATH_SEC = 0.15

/** 一条字幕卡的时序（帧 + 秒双口径，便于 SKILL 预览表展示）。 */
export interface SubtitleCue {
  text: string
  /** 起始绝对帧（`floor(startSec × fps)`）。 */
  startFrame: number
  /**
   * **屏上**持续帧数（正整数）：从本句开始到**下一句开始**为止（末句到总帧）。
   *
   * ⚠️ 不等于该句的语音时长 —— 句间呼吸间隔算在**前一句**的屏上时长里，这样相邻字幕卡
   * 首尾相接、不留空白（见 `deriveSubtitleTiming` 第 3 条的成因说明）。
   */
  durationInFrames: number
  /** 取整前的起始秒（`startFrame = floor(startSec × fps)`）。 */
  startSec: number
  /** 该句语音的结束帧（未做「延伸到下一句」处理），供预览表核对句长与展示时长是否匹配。 */
  speechEndFrame: number
}

export interface SubtitleTimingInput {
  /** 分句文本（空串会被忽略）。 */
  sentences: readonly string[]
  fps: number
  /** `probeMediaDuration` 实测的旁白总时长（秒）；缺省走 4 字/秒估算。 */
  voiceOverDurationSec?: number
  /** 句间呼吸间隔（秒），默认 `SUBTITLE_BREATH_SEC`。 */
  breathSec?: number
}

export interface SubtitleTimingResult {
  cues: SubtitleCue[]
  /** 字幕总帧（末句 endFrame）。 */
  totalFrames: number
  /** 是否走了 4 字/秒估算（无实测旁白）。 */
  estimated: boolean
  warnings: string[]
}

/** 按码点计数（CJK 安全）：`[...s].length`，而非 `s.length`。 */
function codePointLength(text: string): number {
  return [...text].length
}

/**
 * 句级字幕时序派生（§10.3 MVP 定稿，纯函数）：
 * 1. 有实测旁白总时长 `T` → 按**字数占比**分配；无 → `T = 总字数 × 0.25s` 估算；
 * 2. 句间呼吸间隔从 `T` 内扣（`内容时长 = T - (n-1) × breath`），不额外拉长；
 * 3. `startFrame = floor(累计秒 × fps)`；**末句 `endFrame` 强对齐 `round(T × fps)`**，吸收舍入误差；
 * 4. 实测时若「末句自然结束帧」与旁白总帧偏差 > 0.5s → 记 warning（不阻断）。
 *
 * ⚠️ 5（2026-10-16 补）：`durationInFrames` 是**屏上**时长 —— 每句延伸到**下一句开始**
 * （末句到总帧），句间不留空白。成因：呼吸间隔 + 每卡自带 6 帧淡入淡出叠加后，接缝处
 * 前后两卡的不透明度会同时落到 0（实测第 129 帧 = 0.00）⇒ 每句交界闪一次背景。屏上时长
 * 首尾相接 + 字幕卡不做首尾淡入淡出（见 `components/TextCard.tsx`）两条一起才是零闪。
 */
export function deriveSubtitleTiming(input: SubtitleTimingInput): SubtitleTimingResult {
  const warnings: string[] = []
  const fps = input.fps
  const sentences = input.sentences.map((s) => s.trim()).filter((s) => s.length > 0)
  if (sentences.length === 0 || !Number.isFinite(fps) || fps <= 0) {
    return { cues: [], totalFrames: 0, estimated: false, warnings }
  }

  const weights = sentences.map(codePointLength)
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  const measured = typeof input.voiceOverDurationSec === 'number' &&
    Number.isFinite(input.voiceOverDurationSec) && input.voiceOverDurationSec > 0
  const estimated = !measured
  const totalSec = measured ? (input.voiceOverDurationSec as number) : totalWeight * SUBTITLE_FALLBACK_SEC_PER_CHAR

  const breathSec = Math.max(0, input.breathSec ?? SUBTITLE_BREATH_SEC)
  const gapTotal = breathSec * (sentences.length - 1)
  // 呼吸间隔不能吃掉整段时长；吃不消时退化为无间隔，保证内容时长 > 0。
  const effectiveBreath = gapTotal < totalSec ? breathSec : 0
  const contentSec = totalSec - effectiveBreath * (sentences.length - 1)

  const totalFrames = Math.round(totalSec * fps)
  const startFrames: number[] = []
  const startSecs: number[] = []
  const speechEndFrames: number[] = []
  let cursorSec = 0
  for (let i = 0; i < sentences.length; i += 1) {
    const startFrame = Math.floor(cursorSec * fps)
    const sentenceSec = contentSec * ((weights[i] as number) / totalWeight)
    const isLast = i === sentences.length - 1
    startFrames.push(startFrame)
    startSecs.push(cursorSec)
    // 末句的自然结束帧仍按比例算，**不**直接取 totalFrames —— 否则第 4 条的偏差断言
    // 恒等于 0（自己跟自己比），是一条永远不会响的守卫（2026-10-16 修）。
    speechEndFrames.push(Math.max(startFrame + 1, Math.ceil((cursorSec + sentenceSec) * fps)))
    cursorSec += sentenceSec + effectiveBreath
    if (isLast) speechEndFrames[i] = Math.min(speechEndFrames[i] as number, totalFrames)
  }

  const cues: SubtitleCue[] = sentences.map((text, i) => {
    const startFrame = startFrames[i] as number
    const onScreenEnd = i === sentences.length - 1 ? totalFrames : (startFrames[i + 1] as number)
    return {
      text,
      startFrame,
      durationInFrames: Math.max(1, onScreenEnd - startFrame),
      startSec: startSecs[i] as number,
      speechEndFrame: speechEndFrames[i] as number,
    }
  })

  const naturalEndFrame = speechEndFrames[speechEndFrames.length - 1] as number
  if (measured && Math.abs(naturalEndFrame - totalFrames) > 0.5 * fps) {
    warnings.push(`字幕末帧与旁白总帧偏差超过 0.5s（已由末句吸收舍入误差对齐）`)
  }

  return { cues, totalFrames, estimated, warnings }
}

/** 单条 video 轨「声明时长 vs 真值」核对结论（§10.4）。 */
export interface VideoDurationCheck {
  /** 核后采用的帧数（偏差超阈值时已按真值修正）。 */
  frames: number
  /** 声明帧折算秒与真值秒的绝对偏差（秒）。 */
  driftSec: number
  /** 是否已按真值修正。 */
  corrected: boolean
  warning?: string
}

/** §4.5 / §10.4 的 video 轨时长核对阈值。 */
export const VIDEO_DURATION_DRIFT_TOLERANCE_SEC = 0.5

/**
 * 核对单条 video 轨的声明时长与真值（§10.4）：偏差 > 0.5s → warning 并按真值修正；
 * 真值不可用（非有限 / ≤0）时原样返回，不臆造。真值来自 `list_shots`（`probeMediaInfo`）。
 */
export function reconcileVideoDuration(
  declaredFrames: number,
  realDurationSec: number | undefined,
  fps: number,
): VideoDurationCheck {
  if (
    realDurationSec === undefined || !Number.isFinite(realDurationSec) || realDurationSec <= 0 ||
    !Number.isFinite(fps) || fps <= 0 || !Number.isFinite(declaredFrames)
  ) {
    return { frames: declaredFrames, driftSec: 0, corrected: false }
  }
  const realFrames = Math.round(realDurationSec * fps)
  const driftSec = Math.abs(declaredFrames - realFrames) / fps
  if (driftSec <= VIDEO_DURATION_DRIFT_TOLERANCE_SEC) {
    return { frames: declaredFrames, driftSec, corrected: false }
  }
  return {
    frames: realFrames,
    driftSec,
    corrected: true,
    warning: `video 轨声明 ${declaredFrames} 帧（${(declaredFrames / fps).toFixed(2)}s）与真值 ${realDurationSec.toFixed(2)}s 偏差 ${driftSec.toFixed(2)}s，已按真值修正为 ${realFrames} 帧`,
  }
}

/**
 * 对整份 Manifest 的所有 video 轨做时长核对，返回修正后的轨道副本与聚合 warning。
 * `realDurations` 以素材 `src` 为键（宿主用 `probeMediaInfo` 探得真值后传入）。
 */
export function reconcileManifestVideoDurations(
  manifest: CompositionManifest,
  realDurations: Readonly<Record<string, number>>,
  fps: number,
): { tracks: CompositionManifest['tracks']; warnings: string[] } {
  const warnings: string[] = []
  const tracks = manifest.tracks.map((track) => {
    if (track.type !== 'video') return track
    const check = reconcileVideoDuration(track.durationInFrames, realDurations[track.src], fps)
    if (check.warning !== undefined) warnings.push(check.warning)
    if (!check.corrected) return track
    return { ...track, durationInFrames: check.frames }
  })
  return { tracks, warnings }
}

/** 转场效果（与 `TransitionTrack.effect` 同域）。 */
export type TransitionEffect = 'fade' | 'slide' | 'zoom' | 'dissolve'

/** 一条转场相对某个轨道的角色：该轨是转场的 `from`（淡出）还是 `to`（淡入）。 */
export interface TrackTransitionWindow {
  role: 'from' | 'to'
  effect: TransitionEffect
  /** 转场窗口起始绝对帧。 */
  startFrame: number
  /** 转场窗口时长（帧）。 */
  durationInFrames: number
}

/** 轨道在转场窗口内的可见性覆盖（乘性合成，默认全可见 / 无位移 / 无缩放）。 */
export interface TrackTransitionOverride {
  opacity: number
  /** 水平位移（占画布宽度百分比），`slide` 用。 */
  translateXPercent: number
  scale: number
}

/** 收起一个轨道的全部转场窗口（来自 manifest 的 `transition` 轨）。 */
export function trackTransitionWindows(manifest: CompositionManifest, trackId: string): TrackTransitionWindow[] {
  const windows: TrackTransitionWindow[] = []
  for (const track of manifest.tracks) {
    if (track.type !== 'transition') continue
    if (track.fromTrackId === trackId) {
      windows.push({ role: 'from', effect: track.effect, startFrame: track.startFrame, durationInFrames: track.durationInFrames })
    }
    if (track.toTrackId === trackId) {
      windows.push({ role: 'to', effect: track.effect, startFrame: track.startFrame, durationInFrames: track.durationInFrames })
    }
  }
  return windows
}

/**
 * 给定绝对帧与轨道的转场窗口，算出可见性覆盖（纯函数，组件只消费）。
 * - `fade` / `dissolve`：只改 opacity（`to` 由 0→1，`from` 由 1→0）；
 * - `slide`：opacity 同上，并叠加 12% 画布宽的水平位移（`to` 从右入、`from` 向左出）；
 * - `zoom`：opacity 同上，并叠加轻微缩放（`to` 0.92→1，`from` 1→0.96）。
 * 窗口外不参与；多个窗口乘性叠加；opacity clamp 到 [0,1]。
 */
export function transitionOverride(
  frame: number,
  windows: readonly TrackTransitionWindow[],
): TrackTransitionOverride {
  let opacity = 1
  let translateXPercent = 0
  let scale = 1
  for (const window of windows) {
    if (window.durationInFrames <= 0) continue
    if (frame < window.startFrame || frame >= window.startFrame + window.durationInFrames) continue
    const progress = (frame - window.startFrame) / window.durationInFrames
    const incoming = window.role === 'to'
    if (window.effect === 'slide') {
      translateXPercent += (incoming ? 1 - progress : -(1 - progress)) * 12
      opacity *= incoming ? progress : 1 - progress
    } else if (window.effect === 'zoom') {
      scale *= incoming ? 0.92 + 0.08 * progress : 1 - 0.04 * (1 - progress)
      opacity *= incoming ? progress : 1 - progress
    } else {
      opacity *= incoming ? progress : 1 - progress
    }
  }
  return { opacity: Math.max(0, Math.min(1, opacity)), translateXPercent, scale }
}
