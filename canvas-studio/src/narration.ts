/**
 * 多段旁白批量合成（`tts_narration` 的能力层）。
 *
 * ## 它解决的问题
 *
 * 一条 60 秒片子的旁白通常 5–10 句。此前 agent 要手工做六件事：造音色锚 → 拆段 →
 * 串行调 N 次 `tts_voiceover` → 读 N 条真值时长 → **手算累加帧号** → 抄成
 * `audio.voiceOver[]`。其中三件是额度或正确性的高风险点：
 *
 * | 步骤 | 失败后果 |
 * |---|---|
 * | 忘传 `refaudio` | 每句一个音色（实测同一 instruct 连发 3 次，基频极差 45%） |
 * | 手算帧号 | 叠字或错位，且只有整片渲完才发现 |
 * | 抄成 `@ref` | `validateAssetRefField` 直接拒收，白渲一次 |
 *
 * 本模块把前三件事收进代码：**锚由参数形状强制存在**（不给 `voice.refaudio` 就拿首段
 * 当锚）、**帧号只由 `planVoiceTimeline` 算**、**`src` 只从产物 URL 取**。
 *
 * ## 分层与可测性
 *
 * 依赖注入 `synthesize` / `resolveHandle`，本模块不 import registry、不碰网络 ——
 * 单测可以喂一个「固定返回 2.0s」的假合成器，把排期与锚传递逐条钉死。
 *
 * ## 一个必须如实告知用户的限制：**不是事务**
 *
 * 第 k 段失败时前 k-1 段已落画布、额度已花。回滚节点**不退积分**，所以这里不做
 * 「整体重试」——只把已完成段的活动节点列进报错，让模型用剩余文本续跑。
 */

import type { SpeechParams, SpeechResult } from './generate.js'
import { throwError } from './error-system.js'
import { placeholderParamReason } from './text-guard.js'
import './errors/catalog.js'
import {
  DEFAULT_VOICE_GAP_SECONDS,
  MAX_NARRATION_LINES,
  isVoiceFps,
  planVoiceTimeline,
  totalVoiceFrames,
  voiceOverEntries,
  type VoiceClipTiming,
  type VoiceFps,
  type VoiceOverEntry,
} from './voice-timeline.js'

/** 一段待合成的旁白。 */
export interface NarrationLine {
  /** 要念的文本（不能为空）。 */
  text: string
  /** 本段之前的间隔（秒，覆盖全局 `gapSeconds`）。负数 = 与上一段重叠。 */
  gapSeconds?: number
  /** 本段的声音设计（覆盖 `voice.instructPrompt`；一般不必逐段写）。 */
  instructPrompt?: string
}

/** 整条旁白的音色设定（**锚**就在这里）。 */
export interface NarrationVoice {
  /** 声音设计指令（七维：语言/性别/年龄/语气/情感/语速/方言）。全片一份，逐段复用。 */
  instructPrompt?: string
  /**
   * 音色锚（已解析成后端可用的 Drama 句柄）。**缺省 = 拿第一段当锚**：先合成第一段，
   * 再把它的句柄喂给后面每一段（零额外合成）。
   */
  refaudio?: string
}

/** `generateNarration` 入参。 */
export interface NarrationParams {
  lines: readonly NarrationLine[]
  voice?: NarrationVoice
  /** 成片 fps（必须与 manifest `meta.fps` 一致）。 */
  fps: VoiceFps
  /** 第一段的起始帧。缺省 0。 */
  startFrame?: number
  /** 全局段间隔（秒）。缺省 {@link DEFAULT_VOICE_GAP_SECONDS}。 */
  gapSeconds?: number
  /** 全片统一的语速倍率（宿主 ffmpeg 后处理，非后端参数）。 */
  speed?: number
  /** 全片统一的音高偏移（半音，宿主 ffmpeg 后处理）。 */
  pitchSemitones?: number
}

/** 注入依赖（Host 侧由 `host-tools.ts` 供货，单测给桩）。 */
export interface NarrationDeps {
  /** 合成一段（内部走 `generateSpeech`，产物落画布音频节点）。 */
  synthesize: (params: SpeechParams) => Promise<SpeechResult>
  /** 把画布音频节点换成可作 `refaudio` 的后端句柄（锚复用用）。 */
  resolveHandle: (nodeId: string) => Promise<string>
}

/** 单段结果（含排期）。 */
export interface NarrationClip {
  /** 段序号（0 起，与 `lines` 对齐）。 */
  index: number
  nodeId: string
  url: string
  /** ffprobe 实测真值（秒）；0 = 探测失败。 */
  duration: number
  startFrame: number
  endFrame: number
  /** 原文（便于模型核对段落顺序，不必回查画布）。 */
  text: string
}

/** 锚的来源：`given` = 调用方提供；`first-line` = 拿第一段当锚。 */
export type NarrationAnchorSource = 'given' | 'first-line'

/** `generateNarration` 结果。 */
export interface NarrationResult {
  /** 锚节点 id（`given` 时 = 第一段节点，锚本身是外部音频时不落画布）。 */
  anchorNodeId: string
  anchorSource: NarrationAnchorSource
  fps: VoiceFps
  clips: NarrationClip[]
  /** 可直接抄进 manifest 的 `audio.voiceOver[]`。 */
  voiceOver: VoiceOverEntry[]
  /** 旁白总占帧（最后一段的 endFrame）—— 与 `meta.durationInFrames` 对照。 */
  totalFrames: number
  warnings: string[]
}

/** 单段文本清洗：全空白视为「忘写台词」，占位串视为「还没写台词」——都拦在合成之前（别拿脏文本烧额度）。 */
function requireText(value: unknown, index: number): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length === 0) {
    throwError('CS-USER-ERR', { message: `第 ${index + 1} 段旁白的 text 为空——每一段都必须是要念的话，空串会被合成成静音并占一帧。` })
  }
  // `lines` 是对象数组，中央占位守卫（`param-guard.ts`）看不进嵌套结构，所以在那张表里
  // 归为「豁免」。代价必须在这里补上：占位串会被**真的念出来**并花掉一次合成额度
  // （比普通句柄类占位更贵 —— 那些只是当场拒收，不烧钱）。
  const placeholder = placeholderParamReason(text)
  if (placeholder !== null) {
    throwError('CS-PARAM-002', {
      tool: 'tts_narration',
      param: `lines[${index}].text`,
      value: text,
      detail: `narration line ${index + 1} is placeholder-only: ${placeholder}`,
    })
  }
  return text
}

/**
 * 单段合成失败时**把进度交出去**再抛。
 *
 * 为什么要改写错误而不是原样上抛：批量调用里「第 3 段挂了，前 2 段已经落卡并花了
 * 额度」是模型看不到的隐状态。不告诉它，下一步必然整批重跑 —— 那 2 段白花钱，
 * 而且首段换了新节点，后续 `@ref` 指向的锚也变了。所以报错里必须带：已完成的节点 id、
 * 「不要整批重跑」、以及续跑该传什么锚。
 */
async function synthesizeOrThrow(
  index: number,
  total: number,
  done: readonly SpeechResult[],
  run: () => Promise<SpeechResult>,
): Promise<SpeechResult> {
  try {
    return await run()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const ids = done.map((entry) => entry.nodeId)
    throwError('CS-USER-ERR', {
      message: `批量配音在第 ${index + 1}/${total} 段失败：${reason}`
        + (ids.length > 0
          ? `。⚠️ 前 ${ids.length} 段**已落画布且额度已花**（节点 ${ids.join('、')}），回滚不退——不要整批重跑；`
            + `把剩下的文本再调一次本工具，并用 refaudio="@ref[第一段节点标题]" 或 lib:<音色id> 承接音色，`
            + '或逐段用 tts_voiceover 补齐。'
          : '。还没有任何段落落卡，修好参数后可整批重试。'),
    })
  }
}

/**
 * 串行合成 N 段 + 用真值排帧。
 *
 * **顺序必须串行**：`txt2speech` 是同步端点、后端单任务串行，并发打过去只会排队
 * 并放大超时概率（实测同类端点单发 4s、被占时 33s）。
 */
export async function generateNarration(deps: NarrationDeps, params: NarrationParams): Promise<NarrationResult> {
  if (!isVoiceFps(params.fps)) {
    throwError('CS-USER-ERR', { message: `fps 必须是 ${String([24, 25, 30, 60].join(' / '))} 之一（收到 ${String(params.fps)}）——它必须与成片 manifest 的 meta.fps 完全一致。` })
  }
  const lines = params.lines ?? []
  if (lines.length === 0) {
    throwError('CS-USER-ERR', { message: 'lines 为空：至少要有一段旁白。只有一句话时直接用 tts_voiceover。' })
  }
  if (lines.length > MAX_NARRATION_LINES) {
    throwError('CS-USER-ERR', { message: `lines 最多 ${MAX_NARRATION_LINES} 段（收到 ${lines.length}）——更长的旁白请拆成两次调用，或用 tts_voiceover 逐段合成。` })
  }

  const texts = lines.map((line, index) => requireText(line.text, index))
  const anchorSource: NarrationAnchorSource = params.voice?.refaudio !== undefined ? 'given' : 'first-line'
  let anchorRef = params.voice?.refaudio
  let anchorNodeId = ''

  const results: SpeechResult[] = []
  for (let index = 0; index < texts.length; index += 1) {
    const line = lines[index]!
    const instruct = line.instructPrompt ?? params.voice?.instructPrompt
    const result = await synthesizeOrThrow(index, texts.length, results, () => deps.synthesize({
      text: texts[index]!,
      ...(instruct !== undefined && instruct.trim() !== '' ? { instructPrompt: instruct } : {}),
      // 锚已就位就每段都带（第一段在 `first-line` 策略下还没有锚，故不带）。
      ...(anchorRef !== undefined && anchorRef !== '' ? { refaudio: anchorRef } : {}),
      ...(params.speed !== undefined ? { speed: params.speed } : {}),
      ...(params.pitchSemitones !== undefined ? { pitchSemitones: params.pitchSemitones } : {}),
    }))
    results.push(result)
    if (index !== 0) continue
    anchorNodeId = result.nodeId
    if (anchorSource !== 'first-line') continue
    // 首段即锚：把它的产物换成句柄，供后续每段克隆。
    try {
      anchorRef = await deps.resolveHandle(result.nodeId)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throwError('CS-USER-ERR', {
        message: `第一段已合成（节点 ${result.nodeId}），但把它当音色锚时失败：${reason}。`
          + '后续段不要重跑第一段——直接传 refaudio="@ref[该节点标题]"（或先 add_to_library 入库再传 lib:<id>）接着合成剩余段落。',
      })
    }
  }

  const durations = results.map((entry) => entry.duration)
  const timings: VoiceClipTiming[] = planVoiceTimeline(durations, {
    fps: params.fps,
    ...(params.startFrame !== undefined ? { startFrame: params.startFrame } : {}),
    gapSeconds: params.gapSeconds ?? DEFAULT_VOICE_GAP_SECONDS,
    gapsSeconds: lines.map((line) => line.gapSeconds),
  })
  const clips: NarrationClip[] = results.map((result, index) => {
    const timing = timings[index]!
    return {
      index,
      nodeId: result.nodeId,
      url: result.url,
      duration: result.duration,
      startFrame: timing.startFrame,
      endFrame: timing.endFrame,
      text: texts[index]!,
    }
  })

  const warnings: string[] = []
  results.forEach((result, index) => {
    if (result.warnings !== undefined && result.warnings.length > 0) {
      warnings.push(`第 ${index + 1} 段：${result.warnings.join('；')}`)
    }
    if (result.duration <= 0) {
      warnings.push(`第 ${index + 1} 段时长探测失败，已按 1 帧排期——请人工核对这一段的落位（不要当它占满了整句时长）。`)
    }
  })
  const negativeGaps = lines.filter((line, index) => index > 0 && (line.gapSeconds ?? params.gapSeconds ?? DEFAULT_VOICE_GAP_SECONDS) < 0)
  if (negativeGaps.length > 0) {
    warnings.push(`${negativeGaps.length} 处段间隔为负（有意重叠）——确认这是你要的交叉，否则会出现两句话叠在一起。`)
  }

  return {
    anchorNodeId,
    anchorSource,
    fps: params.fps,
    clips,
    voiceOver: voiceOverEntries(results.map((entry) => entry.url), timings),
    totalFrames: totalVoiceFrames(timings),
    warnings,
  }
}
