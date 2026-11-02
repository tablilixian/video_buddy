/**
 * 媒体探针（REQ-036 C3，CV-397）—— 时长 / 分辨率 / fps / 音轨 / 容器 / 综合响度的统一入口。
 *
 * 背景：拆解表头部需要时长/fps/音轨，响度对齐需要参考片 LUFS —— 此前散装在
 * `ffmpeg -i` 与 ebur128 的临场拼命令里（viral-remake SKILL §4 靠临场拼命令），
 * 没有统一入口，模型每次都要自己组 argv、自己从 stderr 里抠数字。
 *
 * 实现口径（与 ffmpeg-run.ts 的 CV-188 先例同源）：**`ffmpeg -i` stderr 解析**，
 * 不依赖 ffprobe —— 随包分发只有 ffmpeg 单二进制（`build/ffmpeg/<key>/`），ffprobe
 * 在打包产物里不存在，开发机的 PATH 上有也不能当产品依赖。响度走既有
 * `probeLoudnessLufs`（ebur128，同一份实现，不许复制）。
 *
 * 绝不抛错的边界与 CV-188 一致：探针是「顺带的元数据读取」，文件不存在在工具壳
 * 层前置拒收（CS-USER-ERR），解析层面拿不到的字段一律 `undefined` / 0 / null。
 * 响度只在有音轨时测量；测量失败不阻塞探针（`audioLoudnessLufs: null` + 原因）。
 */
import { statSync } from 'node:fs'
import { basename } from 'node:path'
import {
  FFMPEG_TIMEOUT_MS,
  parseFfmpegDuration,
  parseFfmpegStreams,
  probeLoudnessLufs,
  resolveFfmpegPath,
  runFfmpeg,
} from './ffmpeg-run.js'
import { throwError } from './error-system.js'
import './errors/catalog.js'

/** 从 `ffmpeg -i` stderr 解析出的流级元数据（纯函数输出，可单测）。 */
export interface ParsedStreamsMeta {
  width?: number
  height?: number
  /** 帧率（fps，视频流行上的 `30 fps` / `29.97 fps` / 分数形态）；未探到为 undefined。 */
  fps?: number
  hasAudio: boolean
  /** `Video:` 流条数（m4a 封面图这类 attached_pic 也算视频流，如实计数）。 */
  videoStreams: number
  /** `Audio:` 流条数。 */
  audioStreams: number
  /** 容器标签（见 parseContainer 的取-tag 规则）；未探到为 undefined。 */
  container?: string
}

/** 响度结论：测得值或「为什么没有」。 */
export interface LoudnessOutcome {
  /** 综合响度（ITU-R BS.1770 integrated LUFS）。未测得为 null。 */
  lufs: number | null
  /** lufs 为 null 时的人话原因（无音轨 / 测量失败）。 */
  reason?: string
}

export interface MediaProbeResult {
  /** 时长（秒）；未探到为 0（与 parseFfmpegDuration 口径一致）。 */
  durationSec: number
  width?: number
  height?: number
  fps?: number
  hasAudio: boolean
  audioLoudnessLufs: number | null
  /** audioLoudnessLufs 为 null 时的人话原因。 */
  loudnessNote?: string
  audioStreams: number
  videoStreams: number
  container?: string
}

/**
 * 容器标签：`Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'x.mp4':` 的 tag 逗号表里
 * **优先取与文件扩展名一致的那个**（mp4 文件报 "mp4" 而不是别名链头的 "mov"，
 * 与工具结果里人话口径一致）；没有一致项取链头；没有 Input 行返回 undefined。
 */
export function parseContainer(stderr: string, fileName?: string): string | undefined {
  const inputLine = stderr.split('\n').find((line) => /^Input #\d+,/.test(line))
  if (inputLine === undefined) return undefined
  const head = inputLine.slice(inputLine.indexOf(',') + 1)
  const tags = head.split(',').map((t) => t.trim()).filter((t) => t.length > 0 && !t.startsWith('from '))
  if (tags.length === 0) return undefined
  const ext = fileName === undefined ? '' : basename(fileName).replace(/^.*\./u, '').toLowerCase()
  const hit = ext !== '' ? tags.find((t) => t.toLowerCase() === ext) : undefined
  return hit ?? tags[0]
}

/** 单条视频流行上的 fps：`30 fps` / `29.97 fps` / `30000/1001 fps`。 */
export function parseFpsFromVideoLine(line: string): number | undefined {
  const fraction = /(\d+)\/(\d+)\s+fps/u.exec(line)
  if (fraction !== null) {
    const denominator = Number(fraction[2])
    if (denominator > 0) {
      const value = Number(fraction[1]) / denominator
      if (Number.isFinite(value) && value > 0) return Math.round(value * 1000) / 1000
    }
  }
  const decimal = /(\d+(?:\.\d+)?)\s+fps/u.exec(line)
  if (decimal === null) return undefined
  const value = Number(decimal[1])
  if (!Number.isFinite(value) || value <= 0) return undefined
  return Math.round(value * 1000) / 1000
}

/**
 * 从 `ffmpeg -i` 的 stderr 解析流级元数据（纯函数，固定样本可单测）。
 * 分辨率 / hasAudio 复用 `parseFfmpegStreams`（同一份实现，不许复制）。
 */
export function parseMediaMeta(stderr: string, fileName?: string): ParsedStreamsMeta {
  const lines = stderr.split('\n')
  const streams = parseFfmpegStreams(stderr)
  const videoLines = lines.filter((line) => /Video:/.test(line))
  const fps = videoLines.map(parseFpsFromVideoLine).find((v) => v !== undefined)
  const container = parseContainer(stderr, fileName)
  return {
    ...(streams.width !== undefined ? { width: streams.width } : {}),
    ...(streams.height !== undefined ? { height: streams.height } : {}),
    ...(fps !== undefined ? { fps } : {}),
    hasAudio: streams.hasAudio,
    videoStreams: videoLines.length,
    audioStreams: lines.filter((line) => /Audio:/.test(line)).length,
    ...(container !== undefined ? { container } : {}),
  }
}

/**
 * 探针入口：本地媒体文件 → 元数据 + 响度。
 *
 * `fileName` 只用于容器 tag 消歧（缺省从 path 取 basename）。文件不存在 / 不是
 * 普通文件直接 CS-USER-ERR（工具壳前置拒收的同一把尺，这里再兜一层底）。
 */
export async function probeMedia(options: {
  path: string
  fileName?: string
  ffmpegPath?: string
  signal?: AbortSignal
}): Promise<MediaProbeResult> {
  const { path } = options
  let statResult: ReturnType<typeof statSync>
  try {
    statResult = statSync(path)
  } catch {
    throwError('CS-USER-ERR', { message: `文件不可读：${path} —— 媒体要先落盘（画布产物绝对路径即可）。` })
  }
  if (!statResult.isFile()) {
    throwError('CS-USER-ERR', { message: `不是普通文件：${path}` })
  }
  const ffmpegPath = resolveFfmpegPath(options.ffmpegPath)
  // `ffmpeg -i <file>` 无输出参数必然非零退出，元信息在 stderr —— 与 CV-188 同口径。
  const probe = await runFfmpeg(ffmpegPath, ['-i', path], FFMPEG_TIMEOUT_MS, options.signal)
  const meta = parseMediaMeta(probe.stderr, options.fileName ?? basename(path))
  let loudness: LoudnessOutcome
  if (!meta.hasAudio) {
    loudness = { lufs: null, reason: '无音轨' }
  } else {
    const lufs = await probeLoudnessLufs(path, ffmpegPath, options.signal)
    loudness = lufs === undefined
      ? { lufs: null, reason: 'ebur128 测量失败（音频无法解码或 ffmpeg 不可用）' }
      : { lufs }
  }
  return {
    durationSec: parseFfmpegDuration(probe.stderr),
    ...(meta.width !== undefined ? { width: meta.width } : {}),
    ...(meta.height !== undefined ? { height: meta.height } : {}),
    ...(meta.fps !== undefined ? { fps: meta.fps } : {}),
    hasAudio: meta.hasAudio,
    audioLoudnessLufs: loudness.lufs,
    ...(loudness.reason !== undefined ? { loudnessNote: loudness.reason } : {}),
    audioStreams: meta.audioStreams,
    videoStreams: meta.videoStreams,
    ...(meta.container !== undefined ? { container: meta.container } : {}),
  }
}
