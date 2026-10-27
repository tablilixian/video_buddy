/**
 * 多段旁白的**帧级排期**（纯函数，`tts_narration` 的核心可测部分）。
 *
 * ## 为什么要有这个模块
 *
 * 排帧原先由 LLM 手算：读 N 条 `duration` → 逐段累加 → `round(秒 × fps)`。这条
 * 算术链有三个必错点，且错了只有等整片渲完才暴露（渲一次几分钟）：
 *   1. **单位混用**：`duration` 是秒，manifest 要帧；
 *   2. **累加漂移**：5 段以上手算加法，漏加一段整条轴就错位；
 *   3. **间隔语义**：`startAfter.gapFrames` 是相对上一段**结束**，人算时容易当成
 *      相对上一段**开始**，于是全部叠在一起（叠字，听感上是「两个人在抢话」）。
 *
 * 所以它被抽成纯函数：入参只有「每段真实时长（秒）+ fps + 间隔」，出参是绝对帧号。
 * 无 IO、无 registry、无网络 —— 可以拿固定输入钉死断言，也能反向变异（改坏
 * `Math.round` 让守卫变红）。
 *
 * ## 两条与渲染器一致的口径
 *
 * - **帧数向上取整到最近的整帧**：`Math.round(秒 × fps)`，最少 1 帧。渲染器按
 *   `startFrame` 定位音频、按自身时长播放，四舍五入的误差 ≤ 半帧（30fps 下 16ms），
 *   听感不可察；而 `ceil` 会把 5 段各多算半帧，累计到片尾可能顶出 `durationInFrames`。
 * - **间隔是「上一段结束 → 本段开始」**：`gapSeconds` 负数 = 有意重叠（交叉淡入时
 *   用），但绝不允许本段排在上一段**开始之前**（那样 manifest 里就是倒序，渲染器
 *   只会如实照做，成片出现「后一句先说完」）。
 */

import { throwError } from './error-system.js'
import './errors/catalog.js'

/** 支持的 fps（与 `CompositionManifest.meta.fps` 的可选值同一份口径）。 */
export const VOICE_FPS = [24, 25, 30, 60] as const
/** 合法 fps 的联合类型。 */
export type VoiceFps = (typeof VOICE_FPS)[number]

/** 缺省段间隔（秒）：0.4s ≈ 一句旁白自然换气的停顿。 */
export const DEFAULT_VOICE_GAP_SECONDS = 0.4

/** `tts_narration` 单次最多合成段数（与 manifest `audio.voiceOver` 的 64 条上限留余量）。 */
export const MAX_NARRATION_LINES = 32

/** fps 是否合法（工具层用它把模型的非法值拦成可行动的报错）。 */
export function isVoiceFps(value: unknown): value is VoiceFps {
  return typeof value === 'number' && (VOICE_FPS as readonly number[]).includes(value)
}

/** 一段旁白的排期结果（绝对帧号，含首尾）。 */
export interface VoiceClipTiming {
  /** 起始帧（含）。 */
  startFrame: number
  /** 结束帧（**不含**：与 `startFrame + frames` 一致，便于直接比较下一段起点）。 */
  endFrame: number
  /** 本段占用帧数（≥1）。 */
  frames: number
}

/** 排期入参。 */
export interface VoiceTimelineOptions {
  /** 成片 fps —— 必须与 manifest `meta.fps` 完全一致，否则整条轴按比例错位。 */
  fps: number
  /** 第一段的起始帧（整片旁白延后开口时用）。缺省 0。 */
  startFrame?: number
  /** 段间隔（秒）。缺省 {@link DEFAULT_VOICE_GAP_SECONDS}；负数 = 重叠。 */
  gapSeconds?: number
  /**
   * 逐段覆盖间隔（秒）：`gapsSeconds[i]` 是**第 i 段之前**的间隔（`[0]` 无意义，忽略）。
   * 缺项回落到 `gapSeconds`。`tts_narration` 用它支持「某段前多留 1 秒」。
   */
  gapsSeconds?: readonly (number | undefined)[]
}

/**
 * 按「每段真实时长」排出绝对帧号。
 *
 * @param durations - 每段时长（秒，ffprobe 真值）。`0` / 非法值按 1 帧处理（探测失败的
 *   段仍要占位，否则它会被后面一段覆盖成「一句话都没说完就接下一句」）。
 * @throws CS-USER-ERR - fps 不在 {@link VOICE_FPS} 内（工具层通常已先行拦成同一条报错）。
 */
export function planVoiceTimeline(durations: readonly number[], options: VoiceTimelineOptions): VoiceClipTiming[] {
  if (!isVoiceFps(options.fps)) {
    // 走错误系统而非 `throw new RangeError`：本项目铁律是「src/ 内禁止裸抛」，
    // 否则前端拿不到可判别的 error code，只能显示一串英文栈。
    throwError('CS-USER-ERR', {
      message: `fps 必须是 ${VOICE_FPS.join(' / ')} 之一（收到 ${String(options.fps)}）——它必须与成片 manifest 的 meta.fps 完全一致，否则整条旁白按比例错位。`,
      detail: `planVoiceTimeline unsupported fps: ${String(options.fps)}`,
    })
  }
  const fps = options.fps
  const gapSeconds = options.gapSeconds ?? DEFAULT_VOICE_GAP_SECONDS
  const out: VoiceClipTiming[] = []
  let cursor = Math.max(0, Math.round(options.startFrame ?? 0))
  let previousStart = -1
  durations.forEach((duration, index) => {
    const safe = Number.isFinite(duration) && duration > 0 ? duration : 0
    const frames = Math.max(1, Math.round(safe * fps))
    if (out.length > 0) {
      // 逐段覆盖优先；缺项回落全局间隔。负数 = 有意重叠（由下面的下限兜住）。
      const own = options.gapsSeconds?.[index]
      const gapFrames = Math.round((own ?? gapSeconds) * fps)
      // 上一段结束 + 间隔；同时不许早于上一段起点（负 gap 过大时兜底）。
      cursor = Math.max(cursor + gapFrames, previousStart + 1)
    }
    const startFrame = Math.max(0, cursor)
    out.push({ startFrame, endFrame: startFrame + frames, frames })
    previousStart = startFrame
    cursor = startFrame + frames
  })
  return out
}

/** `audio.voiceOver[]` 的单条（`src` 必须是同源 URL，见 `validateAssetRefField`）。 */
export interface VoiceOverEntry {
  src: string
  startFrame: number
}

/**
 * 拼出可直接进 manifest 的 `audio.voiceOver[]`。
 *
 * `src` **原样**取自合成产物 URL（`/canvas-studio/assets/<projectId>/<file>`）——
 * manifest 校验只认同源 URL 或本地绝对路径，写 `@ref[...]` / 节点 id 会被
 * `validateAssetRefField` 直接拒收，这是最容易在最后一步翻车的地方。
 */
export function voiceOverEntries(urls: readonly string[], timings: readonly VoiceClipTiming[]): VoiceOverEntry[] {
  const count = Math.min(urls.length, timings.length)
  const out: VoiceOverEntry[] = []
  for (let index = 0; index < count; index += 1) {
    const url = urls[index]
    const timing = timings[index]
    if (url === undefined || timing === undefined) continue
    out.push({ src: url, startFrame: timing.startFrame })
  }
  return out
}

/** 旁白总占帧（= 最后一段的 `endFrame`）；无段时为 0。 */
export function totalVoiceFrames(timings: readonly VoiceClipTiming[]): number {
  const last = timings[timings.length - 1]
  return last === undefined ? 0 : last.endFrame
}
