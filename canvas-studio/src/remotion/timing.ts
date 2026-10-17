/**
 * REQ-034（Remotion 集成）· B2 时序契约：把组件里的「什么时候出现 / 淡入淡出 /
 * 字幕排布 / 素材时长核对」全部抽成**纯函数**，组件只做布局（devdoc §12.3）。
 *
 * 这样做的理由（§0 R4）：官方没有 `@remotion/test-renderer`，组件行为无法用现有
 * `node --test` 断言；把时序抽出来后，边界与结算都能在 Node 里直接测。
 * 本文件**零 Remotion 依赖**，两条渲染路线通用。
 */

import type { Animate, AnimateEasing, BaseTrack, CompositionManifest, ShapeTrack, TrackFx, VisualState } from './manifest.js'

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

/** 缺省首尾淡入淡出帧数（CV-334 起可由 `track.fadeFrames` 覆盖；`0` = 硬切）。 */
export const DEFAULT_FADE_FRAMES = 6

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

/**
 * 转场效果（与 `TransitionTrack.effect` 同域）。
 *
 * 二期 A4 新增四种，全部**按帧求值**（`clipPath` / `maskImage` / `rotateY`），
 * 不用 CSS transition —— 逐帧截图走真实时钟，CSS 过渡会让同一份 manifest 渲两次不同。
 */
export type TransitionEffect =
  | 'fade' | 'slide' | 'zoom' | 'dissolve'
  | 'wipeLeft' | 'wipeRight' | 'clock' | 'flipX'

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
  /** `wipeLeft` / `wipeRight` 的硬边裁切（空串 = 不裁）。 */
  clipPath: string
  /** `clock` 的扇形扫描遮罩（空串 = 不遮）。 */
  maskImage: string
  /** `flipX` 的 Y 轴翻转角度（度，0 = 未翻）。 */
  rotateY: number
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
 * - `zoom`：opacity 同上，并叠加轻微缩放（`to` 0.92→1，`from` 1→0.96）；
 * - `wipeLeft` / `wipeRight`（A4）：硬边推进，用 `clipPath: inset(...)`，opacity 保持 1
 *   （遮罩本身就是遮挡，再乘 opacity 会出现"半透明条带"）；
 * - `clock`（A4）：`conic-gradient` 从 12 点方向扫描，`to` 逐步揭开、`from` 逐步遮住；
 * - `flipX`（A4）：`rotateY` 翻面（`to` 90°→0、`from` 0→-90°），前 1/4 段压 opacity
 *   避免两张片子同时可见的重影。
 * 窗口外不参与；多个窗口乘性叠加；opacity clamp 到 [0,1]。
 */
export function transitionOverride(
  frame: number,
  windows: readonly TrackTransitionWindow[],
): TrackTransitionOverride {
  let opacity = 1
  let translateXPercent = 0
  let scale = 1
  let clipPath = ''
  let maskImage = ''
  let rotateY = 0
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
    } else if (window.effect === 'wipeLeft') {
      // 左→右推进：incoming 的可见区从左侧长出来；outgoing 从左侧被吃掉。
      const remain = (1 - progress) * 100
      clipPath = incoming ? `inset(0 ${remain.toFixed(3)}% 0 0)` : `inset(0 0 0 ${remain.toFixed(3)}%)`
    } else if (window.effect === 'wipeRight') {
      const remain = (1 - progress) * 100
      clipPath = incoming ? `inset(0 0 0 ${remain.toFixed(3)}%)` : `inset(0 ${remain.toFixed(3)}% 0 0)`
    } else if (window.effect === 'clock') {
      const deg = (progress * 360).toFixed(2)
      maskImage = incoming
        ? `conic-gradient(#000 ${deg}deg, transparent 0deg)`
        : `conic-gradient(transparent ${deg}deg, #000 0deg)`
    } else if (window.effect === 'flipX') {
      rotateY = incoming ? 90 * (1 - progress) : -90 * progress
      opacity *= incoming ? Math.min(1, progress * 2) : Math.min(1, (1 - progress) * 2)
    } else {
      opacity *= incoming ? progress : 1 - progress
    }
  }
  return {
    opacity: Math.max(0, Math.min(1, opacity)),
    translateXPercent,
    scale,
    clipPath,
    maskImage,
    rotateY,
  }
}

// ─────────────────── CV-334 · 帧级动画插值（纯函数，组件只消费） ───────────────────
//
// 为什么插值**必须**留在这里、不能写进组件：
// 1. 本文件零 Remotion 依赖 ⇒ Host 侧能算（`scripts/probe-*.mjs` 可复现）、`node --test`
//    能覆盖；写进组件就只剩"眼睛看"这一种验证手段（本仓已明确视觉不在自动覆盖内）。
// 2. 每个组件各写一份 => 必然出现"加了字段但某个组件忘了读" —— 这正是 `Transform`
//    此前只被 `VideoClip` 消费的病根。
// 3. **严禁**用 CSS `transition` / `@keyframes` 代替：Remotion 逐帧截图走**真实时钟**，
//    第 47 帧拍到的位置取决于机器快慢 ⇒ 同一份 manifest 渲两次结果不一样。

/** 缓动函数白名单（与 `AnimateEasing` 同域）。端点收敛：`f(0)=0`、`f(1)=1`。 */
export const EASINGS: Readonly<Record<AnimateEasing, (t: number) => number>> = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => 1 - (1 - t) * (1 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
}

/** 缺省缓动：`easeInOut` —— 入场 / 强调动画开箱即有平滑观感；`linear` 需显式写。 */
export const DEFAULT_ANIMATE_EASING: AnimateEasing = 'easeInOut'

/** `VisualState` 的五个维度（唯一枚举源；`interpolateState` 按它遍历）。 */
const VISUAL_DIMENSIONS = ['x', 'y', 'scale', 'rotation', 'opacity'] as const

/** 维度的"中性值"：某个维度只有单边声明、且无 `transform` 基线时的另一端点。 */
const NEUTRAL_DIMENSION: Readonly<Record<(typeof VISUAL_DIMENSIONS)[number], number>> = {
  x: 50,
  y: 50,
  scale: 1,
  rotation: 0,
  opacity: 1,
}

/** `0–1` clamp（非有限输入按 0 处理，避免 NaN 渗进样式串变成 `translate(NaN%)`）。 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

/**
 * 两个 `VisualState` 之间按 `progress`（`0–1`）插值（纯函数）。
 *
 * 三条规则（`track.animate` 的语义核心）：
 * 1. **只产出"至少一边声明过"的维度** —— 两边都没写的维度不出现在返回值里，
 *    这样"只动 x"绝不会把 `scale` 顺手写成 `undefined` 而抹掉 `transform` 的缩放。
 * 2. **单边声明时另一端取**：`transform` 的基线值 → 都没有则该维度的中性值
 *    （`x/y` = 50、`scale` = 1、`rotation` = 0、`opacity` = 1）。于是
 *    `{"from": {}, "to": {"scale": 1.2}}` 自然读作"从 1 缩到 1.2"。
 * 3. **端点收敛**（不 clamp 到中途）：`progress <= 0` 全部取起点、`>= 1` 全部取终点。
 *    动画开始前与结束后的每帧都是稳定值，不会有末帧跳变。
 */
export function interpolateState(
  from: VisualState,
  to: VisualState,
  progress: number,
  base: VisualState = {},
): VisualState {
  const t = clamp01(progress)
  const out: VisualState = {}
  for (const key of VISUAL_DIMENSIONS) {
    const start = from[key]
    const end = to[key]
    if (start === undefined && end === undefined) continue
    const lower = start ?? base[key] ?? NEUTRAL_DIMENSION[key]
    const upper = end ?? base[key] ?? NEUTRAL_DIMENSION[key]
    out[key] = lower + (upper - lower) * t
  }
  return out
}

/**
 * 轨道在**轨内相对帧** `localFrame` 处的最终视觉状态（纯函数，组件唯一取值入口）。
 *
 * 输入 = `track.transform`（不动的姿势）+ `track.animate`（从 A 到 B 的若干段）。
 * 多条 `animate` 按数组顺序叠加：后者**覆盖它声明过的维度**，未声明的维度保留前者的结果。
 *
 * ⚠️ 组件必须传**轨内相对帧**（被 `<Sequence>` 包裹时 `useCurrentFrame()` 即是），
 * 与 `startFrame` 的口径一致；传绝对帧会让动画整体前移。
 */
export function animateStateAt(
  track: Pick<BaseTrack, 'animate' | 'transform' | 'durationInFrames'>,
  localFrame: number,
): VisualState {
  const base: VisualState = { ...(track.transform ?? {}) }
  const list = Array.isArray(track.animate)
    ? track.animate
    : (track.animate === undefined ? [] : [track.animate])
  const trackDuration = Math.max(1, Math.floor(track.durationInFrames))
  if (list.length === 0) return base

  // CV-336（Remotion 集成 · 帧级动画）：多段关键帧的**按维度选择**，而非无条件叠加。
  //
  // 旧语义把每条 `animate` 段都无条件 `merge` 进状态 —— 一旦多条段动**同一维度**，
  // 靠后的段在它自己的窗口之前会把 `from` 值钉死（progress=0 ⇒ 取 `from`）。结果：
  // 「公转 / 环绕」（§100 套路）整段被钉在起点不动、例③「呼吸」变成半截锯齿。这正是
  // 成片「像 PPT、行星不绕圈」的隐藏元凶之一。
  //
  // 新语义：每个视觉维度**独立**选段 —— 取「窗口含本帧」的最后一条（重叠窗口后者覆盖
  // 前者，保留 `interpolateState` 的契约语义）；窗口外则保持首段起点 / 末段终点（连续衔接）。
  // 单段行为与「不同维度跨段叠加」完全不变。
  const state: VisualState = { ...base }
  for (const dim of VISUAL_DIMENSIONS) {
    const segs = list.filter(
      (s) => s.from?.[dim] !== undefined || s.to?.[dim] !== undefined,
    )
    if (segs.length === 0) continue
    let active: (typeof list)[number] | null = null
    for (const s of segs) {
      const start = s.startFrame ?? 0
      const dur = s.durationInFrames ?? trackDuration
      if (localFrame >= start && localFrame < start + dur) active = s
    }
    if (active) {
      const partial = interpolateState(active.from, active.to, animateProgressAt(active, localFrame, trackDuration), base)
      const v = partial[dim]
      if (v !== undefined) state[dim] = v
      continue
    }
    // 无活动段：本帧落在所有段之前 / 之后 → 保持首段起点 / 末段终点（连续衔接）。
    const first = segs[0] as Animate
    const last = segs[segs.length - 1] as Animate
    const firstStart = first.startFrame ?? 0
    if (localFrame < firstStart) {
      state[dim] = (first.from as VisualState)?.[dim] ?? base[dim] ?? NEUTRAL_DIMENSION[dim]
    } else {
      state[dim] = (last.to as VisualState)?.[dim] ?? base[dim] ?? NEUTRAL_DIMENSION[dim]
    }
  }
  return state
}

/** 单条 `Animate` 在轨内相对帧 `localFrame` 处的缓动后进度（`0–1`）。 */
function animateProgressAt(animate: Animate, localFrame: number, trackDurationInFrames: number): number {
  const start = animate.startFrame ?? 0
  const duration = animate.durationInFrames ?? trackDurationInFrames
  if (!Number.isFinite(duration) || duration <= 0) return 1
  const ease = EASINGS[animate.easing ?? DEFAULT_ANIMATE_EASING] ?? EASINGS[DEFAULT_ANIMATE_EASING]
  return ease(clamp01((localFrame - start) / duration))
}

// ─────────────── 二期 A1 · 语义原语：公转 / 路径生长（纯函数，零 Remotion 依赖） ───────────────
//
// 为什么要原语：JSON 表达得了"什么"，表达不了"绕谁转"。此前只能靠 skill 内联上百个关键帧
// （`motion-helpers.mjs` 手算像素），又贵又几乎必然写错几帧。公转是**帧的函数**，一行声明即可。

/** `0–1` 之外按端点收敛（非有限输入按 0 处理），用于生长比例。 */
function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

/**
 * 二期 A1：轨道在轨内相对帧 `localFrame` 处的**公转位置**（画布百分比坐标）。
 * 无 `orbit` 返回 `null`（调用方据此保留 `transform` / 缺省 50/50 的位置语义）。
 *
 * 角度约定：0° = 正右（+x），角度增大 = 顺时针（屏幕 y 向下）。
 * `periodInFrames` 缺省取轨道时长；两者都不可用时返回 `null`（校验层已拦，这里只防 NaN）。
 */
export function orbitStateAt(
  track: Pick<BaseTrack, 'orbit' | 'durationInFrames'>,
  localFrame: number,
): { x: number; y: number } | null {
  const orbit = track.orbit
  if (orbit === undefined) return null
  const period = orbit.periodInFrames ?? Math.max(0, Math.floor(track.durationInFrames))
  if (!Number.isFinite(period) || period <= 0) return null
  const direction = orbit.direction === 'ccw' ? -1 : 1
  const startAngle = Number.isFinite(orbit.startAngle ?? 0) ? (orbit.startAngle ?? 0) : 0
  const degrees = startAngle + direction * ((360 * localFrame) / period)
  const radians = (degrees * Math.PI) / 180
  return {
    x: orbit.center.x + orbit.radius * Math.cos(radians),
    y: orbit.center.y + orbit.radius * Math.sin(radians),
  }
}

/**
 * 二期 A1：`shape:'path'` 轨的生长比例（0–1，已含 `to` 与缓动）。
 * 无 `draw` 返回 1（全画出）；区间前 0、区间后恒为 `to`（端点收敛）。
 */
export function drawProgressAt(
  track: Pick<ShapeTrack, 'draw' | 'durationInFrames'>,
  localFrame: number,
): number {
  const draw = track.draw
  if (draw === undefined) return 1
  const to = clampUnit(draw.to ?? 1)
  const start = draw.startFrame ?? 0
  const duration = draw.durationInFrames ?? Math.max(1, Math.floor(track.durationInFrames))
  if (!Number.isFinite(duration) || duration <= 0) return localFrame >= start ? to : 0
  if (localFrame < start) return 0
  const ease = EASINGS[draw.easing ?? DEFAULT_ANIMATE_EASING] ?? EASINGS[DEFAULT_ANIMATE_EASING]
  return ease(clamp01((localFrame - start) / duration)) * to
}

// ─────────────────────── 二期 A2 · 视觉效果（折算成样式串） ───────────────────────

/** `fx` 折算结果：字段名与 CSS 一一对应，组件只做展开（不各自解读枚举）。 */
export interface FxStyle {
  filter?: string
  textShadow?: string
  /** `-webkit-text-stroke` 的值（描边字）。 */
  textStroke?: string
  boxShadow?: string
  maskImage?: string
}

/**
 * 二期 A2：把单值枚举 `fx` 折算成 CSS 片段（纯函数）。
 *
 * 为什么在纯函数里折算而不是组件内 `switch`：写进组件就会出现「某个组件忘了读」——
 * `Transform` 此前只被 `VideoClip` 消费就是这么坏的。5 类组件共用同一份口径。
 * 未知/缺省值返回空对象（**不报错也不猜**：校验层已拦非法值，这里只负责"没有就不贴"）。
 */
export function fxStyles(fx: TrackFx | undefined): FxStyle {
  switch (fx) {
    case 'glow':
      return {
        filter: 'drop-shadow(0 0 10px rgba(120,190,255,0.85))',
        textShadow: '0 0 18px rgba(120,190,255,0.9)',
      }
    case 'stroke':
      return {
        textStroke: '1.5px rgba(8,12,20,0.9)',
        textShadow: '0 2px 6px rgba(0,0,0,0.65)',
      }
    case 'shadow':
      return {
        filter: 'drop-shadow(0 14px 28px rgba(0,0,0,0.55))',
        textShadow: '0 6px 18px rgba(0,0,0,0.7)',
        boxShadow: '0 18px 48px rgba(0,0,0,0.55)',
      }
    case 'blur':
      return { filter: 'blur(3px)' }
    case 'maskFade':
      return { maskImage: 'linear-gradient(180deg, #000 0%, #000 62%, transparent 100%)' }
    default:
      return {}
  }
}

// ─────────────────────── 二期 A5 · 文本排版策略（纯函数） ───────────────────────

export interface TextFitOptions {
  /** 可用宽度（像素，来自 `useVideoConfig().width` 与容器百分比）。 */
  maxWidthPx: number
  /** 起始字号（像素）。 */
  baseFontPx: number
  /** 最多行数（超出则继续缩字号，直到 `minFontPx`）。 */
  maxLines: number
  /** 最小字号（像素，缺省 0.55 × base）。 */
  minFontPx?: number
  /** 行高倍数（缺省 1.35）。 */
  lineHeight?: number
}

export interface TextFitResult {
  /** 最终字号（像素，已向下取整）。 */
  fontPx: number
  /** 换行后的行（按宽度贪心切）。 */
  lines: string[]
  /** 缩到最小字号仍超出 `maxLines` ⇒ 溢出（调用方可以截断或告警）。 */
  overflow: boolean
  /** 估算所需总高度（像素），供调用方判断是否压到别的内容。 */
  estimatedHeightPx: number
}

/** 单个码点的宽度系数（相对字号）：CJK / 全角按 1，ASCII 按 0.55，空白按 0.3。 */
function charWidthRatio(char: string): number {
  const code = char.codePointAt(0) ?? 0
  if (char === ' ' || char === '\t') return 0.3
  // CJK 统一表意文字 / 日文假名 / 全角标点
  if (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0x3000 && code <= 0x303f)
  ) {
    return 1
  }
  return 0.55
}

/** 按像素宽度贪心换行（纯函数；不做字形度量 —— 没有 canvas 的地方也要能算）。 */
function wrapByWidth(text: string, maxWidthPx: number, fontPx: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let current = ''
    let width = 0
    for (const char of [...paragraph]) {
      const w = charWidthRatio(char) * fontPx
      if (current !== '' && width + w > maxWidthPx) {
        lines.push(current)
        current = char
        width = w
      } else {
        current += char
        width += w
      }
    }
    lines.push(current)
  }
  return lines
}

/**
 * 二期 A5：**「文本长度 → 字号 / 行数」策略**（纯函数，可单测）。
 *
 * 分层要点（写进 skill，别混）：真正的字形度量需要 canvas（浏览器里才有），因此
 * `measureText` 只能在组件内跑，**不能单测**；能在 Node 里断言的是这层**策略** ——
 * 「给这段文本、这个宽度，字号该多大、会断成几行」。组件拿到 `fontPx` 后直接贴样式。
 *
 * 规则：从 `baseFontPx` 起按 0.94 递减，直到行数 ≤ `maxLines` 或触及 `minFontPx`；
 * 仍超行数则标注 `overflow`（不静默截断 —— 截断要看得到）。
 */
export function fitTextPolicy(text: string, options: TextFitOptions): TextFitResult {
  const maxWidthPx = Math.max(1, options.maxWidthPx)
  const base = Math.max(1, options.baseFontPx)
  const minFont = Math.max(1, Math.min(base, options.minFontPx ?? base * 0.55))
  const lineHeight = options.lineHeight ?? 1.35
  let fontPx = Math.floor(base)
  let lines = wrapByWidth(text, maxWidthPx, fontPx)
  while (lines.length > options.maxLines && fontPx > minFont) {
    fontPx = Math.max(minFont, Math.floor(fontPx * 0.94))
    lines = wrapByWidth(text, maxWidthPx, fontPx)
  }
  return {
    fontPx,
    lines,
    overflow: lines.length > options.maxLines,
    estimatedHeightPx: Math.round(lines.length * fontPx * lineHeight),
  }
}

// ─────────────────── 二期 B1 · 音频可视化采样（纯函数；解码在组件侧） ───────────────────

export interface WaveformOptions {
  /** 柱数（1–128）。 */
  bars: number
  /** 振幅增益（0–4）。 */
  gain?: number
  /** 每帧前进多少采样格（缺省 1；越大跳动越快）。 */
  speed?: number
  /** 采样窗口在振幅数组里的起始偏移（缺省 0，通常按音频绝对帧推导）。 */
  offset?: number
}

/**
 * 二期 B1：从**振幅包络数组**取某一帧的柱高（0–1，已乘增益并 clamp）。
 *
 * 分层说明：解码（`decodeAudioData`）只能在浏览器里做 ⇒ 不可单测；能单测的是这层
 * 「包络数组 + 帧 → 柱高」。这层越简单越好：只做**窗口取样 + 增益**，不做插值/平滑，
 * 避免"单测绿、成片没波形"（那是解码段的问题，不是这层的问题）。
 *
 * 数组长度不足 `bars` 时循环取样；空数组返回全 0（组件据此画基线，不抛错）。
 */
export function waveformBars(amplitudes: readonly number[], frame: number, options: WaveformOptions): number[] {
  const count = Math.max(1, Math.min(128, Math.floor(options.bars)))
  const gain = Number.isFinite(options.gain ?? 1) ? Math.max(0, Math.min(4, options.gain ?? 1)) : 1
  const speed = Number.isFinite(options.speed ?? 1) ? Math.max(0, options.speed ?? 1) : 1
  const base = (options.offset ?? 0) + Math.floor(frame * speed)
  const total = amplitudes.length
  const out: number[] = []
  for (let i = 0; i < count; i += 1) {
    if (total === 0) {
      out.push(0)
      continue
    }
    const value = amplitudes[(((base + i) % total) + total) % total] ?? 0
    out.push(clampUnit(Math.abs(value) * gain))
  }
  return out
}

// ─────────────────────── 二期 1b · 渲染超时（按片长自适应） ───────────────────────

/** 渲染超时下限 / 上限（毫秒）：短片不至于被误杀，长片也不会挂死。 */
export const RENDER_TIMEOUT_MIN_MS = 10 * 60_000
export const RENDER_TIMEOUT_MAX_MS = 30 * 60_000

/**
 * 二期 1b：按声明片长推导渲染工单超时（D-04 已定）。
 *
 * 公式：`clamp(2 × 片长 + 120s, 10min, 30min)`。固定 10 分钟对 3 分钟以上的片子偏紧
 * （CSR 软编比原生编码慢，长片被误杀后整批重渲），对上不封顶则挂了也看不出来。
 */
export function renderTimeoutMs(durationInFrames: number, fps: number): number {
  const frames = Number.isFinite(durationInFrames) ? Math.max(0, durationInFrames) : 0
  const rate = Number.isFinite(fps) && fps > 0 ? fps : 30
  const seconds = frames / rate
  const raw = seconds * 2000 + 120_000
  return Math.round(Math.min(RENDER_TIMEOUT_MAX_MS, Math.max(RENDER_TIMEOUT_MIN_MS, raw)))
}
