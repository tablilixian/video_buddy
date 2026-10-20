/**
 * REQ-034 · O-09：`tts_voiceover` 的**音色后处理**（宿主侧 ffmpeg，零后端改动）。
 *
 * ## 为什么不是「加一个后端参数」
 * 真机会话里用户连提两轮「要 60 岁沙哑」，后端 `txt2speech`（VoxCPM2）只认
 * `txt_prompt` / `instruct_prompt` / `refaudio` —— 音色与语速只能靠自然语言描述引导，
 * **没有** `voiceId` / `speed` 字段。给一个不存在的参数比不给更糟：模型会反复重试，
 * 每次烧一次 TTS 额度（实测重试 2 轮）。
 *
 * 所以这里做两件**真能用**的事：
 * 1. **语速** `speed`（0.5–2.0）：`atempo` 变速不变调；
 * 2. **音高** `pitchSemitones`（-12 ~ +12）：`aresample→asetrate→aresample→atempo`
 *    变调不变速（先统一到 44.1k 再改采样率，否则源采样率不同会让音高倍率错位）。
 *
 * 音色（沙哑 / 苍老感）本身仍靠 `instructPrompt` 描述；这两项是**超出音域时的确定性补丁**，
 * 也是「60 岁沙哑」这类需求真正落地的最后一公里。
 *
 * 失败不阻断交付：TTS 产物已经生成，后处理只是锦上添花 —— 返回 `warning` 让模型如实
 * 告知用户「语速/音高未生效」，而不是把一次成功调用变成失败（对齐 `probeMediaInfo`
 * 的「绝不抛错」取向）。
 */
import { resolveFfmpegPath, runFfmpeg } from './ffmpeg-run.js'

/** 语速允许区间（`atempo` 单级 0.5–2.0 安全；超出要拆两级，收益小、复杂度高）。 */
export const SPEECH_SPEED_RANGE = { min: 0.5, max: 2 } as const
/** 音高允许区间（半音；±12 = 一个八度）。 */
export const SPEECH_PITCH_RANGE = { min: -12, max: 12 } as const
/** 变调统一采样率（`asetrate` 的基准必须固定，否则倍率随源文件漂移）。 */
const PITCH_SAMPLE_RATE = 44_100
/** 后处理单独的超时（TTS 片段通常几秒；60s 足够，别让一次滤镜挂住整条工具调用）。 */
const POST_TIMEOUT_MS = 60_000

export interface SpeechPostOptions {
  /** 语速倍率（0.5–2.0；缺省/1 = 不变）。 */
  readonly speed?: number
  /** 音高偏移（半音，-12 ~ +12；缺省/0 = 不变）。 */
  readonly pitchSemitones?: number
}

/**
 * 构造 ffmpeg `-filter:a` 滤镜链（纯函数，可单测）。
 *
 * @returns 无实际改动时返回 `null`（调用方据此跳过整个后处理）。
 */
export function speechFilterChain(options: SpeechPostOptions): string | null {
  const speed = options.speed ?? 1
  const semitones = options.pitchSemitones ?? 0
  const parts: string[] = []
  if (Number.isFinite(semitones) && Math.abs(semitones) >= 0.01) {
    const ratio = 2 ** (semitones / 12)
    // 顺序不可调：先统一采样率 → 改采样率（= 变速变调）→ 回到 44.1k（= 变调不变速的
    // 前半）→ `atempo 1/ratio` 把时长拉回来。漏掉第一句，源是 24k 时音高倍率就错了。
    parts.push(
      `aresample=${String(PITCH_SAMPLE_RATE)}`,
      `asetrate=${String(Math.round(PITCH_SAMPLE_RATE * ratio))}`,
      `aresample=${String(PITCH_SAMPLE_RATE)}`,
      `atempo=${(1 / ratio).toFixed(6)}`,
    )
  }
  if (Number.isFinite(speed) && Math.abs(speed - 1) >= 0.01) {
    parts.push(`atempo=${speed.toFixed(6)}`)
  }
  return parts.length > 0 ? parts.join(',') : null
}

/** 把入参收敛到合法区间（越界不报错，夹住并在 warning 里说明 —— 与工具「尽力而为」一致）。 */
export function clampSpeechOptions(options: SpeechPostOptions): { speed: number; pitchSemitones: number; notes: string[] } {
  const notes: string[] = []
  const rawSpeed = options.speed ?? 1
  const rawPitch = options.pitchSemitones ?? 0
  let speed = Number.isFinite(rawSpeed) ? rawSpeed : 1
  let pitchSemitones = Number.isFinite(rawPitch) ? rawPitch : 0
  if (speed < SPEECH_SPEED_RANGE.min || speed > SPEECH_SPEED_RANGE.max) {
    const clamped = Math.min(SPEECH_SPEED_RANGE.max, Math.max(SPEECH_SPEED_RANGE.min, speed))
    notes.push(`语速 ${speed} 超出 ${SPEECH_SPEED_RANGE.min}–${SPEECH_SPEED_RANGE.max}，已按 ${clamped} 处理`)
    speed = clamped
  }
  if (pitchSemitones < SPEECH_PITCH_RANGE.min || pitchSemitones > SPEECH_PITCH_RANGE.max) {
    const clamped = Math.min(SPEECH_PITCH_RANGE.max, Math.max(SPEECH_PITCH_RANGE.min, pitchSemitones))
    notes.push(`音高 ${pitchSemitones} 半音超出 ±12，已按 ${clamped} 处理`)
    pitchSemitones = clamped
  }
  return { speed, pitchSemitones, notes }
}

export interface SpeechPostResult {
  /** 是否真的改写了文件（false = 无改动或后处理不可用）。 */
  readonly applied: boolean
  /** 非致命提示（越界夹取 / ffmpeg 不可用 / 滤镜失败）。非空时必须转告用户。 */
  readonly warnings: string[]
}

/**
 * 就地后处理一个音频文件（写入 `outputPath`；调用方决定是否覆盖源文件）。
 *
 * **绝不抛错**：ffmpeg 不可用、滤镜不支持、超时 —— 一律返回 `applied:false` + warning。
 */
export async function postProcessSpeech(
  inputPath: string,
  outputPath: string,
  options: SpeechPostOptions,
  ffmpegPath?: string,
): Promise<SpeechPostResult> {
  const { speed, pitchSemitones, notes } = clampSpeechOptions(options)
  const chain = speechFilterChain({ speed, pitchSemitones })
  if (chain === null) return { applied: false, warnings: notes }
  try {
    const resolved = resolveFfmpegPath(ffmpegPath)
    const result = await runFfmpeg(
      resolved,
      ['-y', '-i', inputPath, '-filter:a', chain, '-c:a', 'libmp3lame', '-b:a', '192k', outputPath],
      POST_TIMEOUT_MS,
    )
    if (result.code !== 0) {
      const tail = result.stderr.trim().split('\n').slice(-2).join(' ').slice(0, 200)
      return {
        applied: false,
        warnings: [...notes, `语速/音高后处理失败（ffmpeg 退出码 ${String(result.code)}${tail === '' ? '' : `：${tail}`}），产物按原样交付`],
      }
    }
    return { applied: true, warnings: notes }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      applied: false,
      warnings: [...notes, `语速/音高后处理不可用（${detail.slice(0, 160)}），产物按原样交付`],
    }
  }
}
