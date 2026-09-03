/**
 * Canvas Studio P8.4 参考视频抽帧提风格（Host 侧）。
 *
 * 上传本地参考视频 → ffmpeg 抽帧（默认每 2s 一帧，封顶 8 帧；长片自动改为
 * 全片均匀采样）→ 帧图走 Drama `uploadimage` 拿 filename → 均匀抽样调
 * `image2vl` 归纳风格要素。帧素材与归纳文本返回给客户端，由客户端落成
 * 「一组帧 image 节点 + 一张风格归纳 sticky 节点」——与 P8.1 图片上传一致：
 * Host 只产事实（文件与 filename），画布节点由客户端写入并持久化。
 *
 * ffmpeg 解析顺序：显式指定 → `FFMPEG_PATH` 环境变量 → ffmpeg-static 包内
 * 二进制（若已下载）→ PATH 上的系统 ffmpeg。仓库根 .yarnrc.yml 设了
 * enableScripts: false，ffmpeg-static 的 postinstall 二进制下载会被跳过，
 * 此时自动回退系统 ffmpeg；两者都不可用时抛可操作的中文错误。
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectRegistry } from './projects.js'
import { newAssetId } from './config.js'
import { analyzeImage, uploadBytesToDrama } from './generate.js'
import { resolveFfmpegPath, runFfmpeg, parseFfmpegDuration } from './ffmpeg-run.js'

/** ffmpeg 解析顺序与运行基础设施已抽到 ffmpeg-run（P9 复用）；API 保持不变。 */
export { resolveFfmpegPath, parseFfmpegDuration }

/** 抽帧默认间隔（秒）。 */
const FRAME_EVERY_SECONDS = 2
/** 抽帧数量上限。 */
const MAX_FRAMES = 8
/** 风格归纳最多送 VLM 的帧数（在抽出的帧里均匀取样，含首末）。 */
const STYLE_SAMPLE_MAX = 4
/** 单个 ffmpeg 进程超时（毫秒）：探测与单帧抽图都应秒级完成。 */
const FFMPEG_TIMEOUT_MS = 60_000

/** 单帧 VLM 归纳文本的最大长度（sticky 节点正文保持紧凑）。 */
const ANALYSIS_MAX_CHARS = 600

const STYLE_SYSTEM_PROMPT = '你是一个专业的影视视觉分析师，擅长从画面中提炼可复用的风格要素。'
const STYLE_PROMPT =
  '请从电影摄影角度归纳这段画面的视觉风格，用简洁中文要点列出（不超过 6 条），' +
  '覆盖：色调与调色、光线、构图与镜头语言、材质质感、美术设定。只输出要点本身。'

/** 单帧产物：同源 URL + Drama 文件名 + 采样时间点（秒）。 */
export interface VideoFrameImport {
  url: string
  filename: string
  time: number
}

/** 参考视频抽帧提风格的完整结果（返回给客户端落画布）。 */
export interface VideoStyleResult {
  /** 视频本体落盘后的同源 URL（留档；画布暂不建视频节点，见 plan §4.4）。 */
  videoUrl: string
  /** 探测到的视频时长（秒；探测失败为 0）。 */
  duration: number
  frames: VideoFrameImport[]
  /** 风格归纳文本（风格归纳 sticky 节点的正文）。 */
  summary: string
}

/** 可选覆盖项（测试注入 / 高级用法）。 */
export interface VideoStyleOptions {
  /** 显式指定 ffmpeg 可执行文件路径（优先于 env 与自动探测）。 */
  ffmpegPath?: string
  everySeconds?: number
  maxFrames?: number
  styleSamples?: number
}

/**
 * 规划抽帧时间点（纯函数）：
 * - 时长未知/非法：只取第 0 帧；
 * - 短片（≤ every×max）：从 0 开始每 every 秒一帧；
 * - 长片（> every×max）：改为全片均匀取 max 帧（风格采样覆盖全片，仍 ≤ max）。
 * 返回保留两位小数的秒值，均严格小于时长。
 */
export function planFrameTimes(durationSec: number, options?: { everySeconds?: number; maxFrames?: number }): number[] {
  const every = Math.max(0.5, options?.everySeconds ?? FRAME_EVERY_SECONDS)
  const max = Math.max(1, options?.maxFrames ?? MAX_FRAMES)
  const duration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0
  if (duration <= every) return [0]
  const round2 = (value: number): number => Math.round(value * 100) / 100
  const byStep = Math.ceil(duration / every)
  const count = Math.min(max, byStep)
  const times: number[] = []
  if (byStep <= max) {
    for (let t = 0; t < duration && times.length < count; t += every) times.push(round2(t))
  } else {
    for (let i = 0; i < count; i += 1) times.push(round2((i * duration) / count))
  }
  const inRange = times.filter((t) => t >= 0 && t < duration)
  return inRange.length > 0 ? inRange : [0]
}

/** 均匀取样（含首末）：从候选帧里取至多 max 条用于 VLM 归纳。 */
function sampleEvenly<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items]
  const step = (items.length - 1) / (max - 1)
  const out: T[] = []
  for (let i = 0; i < max; i += 1) out.push(items[Math.round(i * step)]!)
  return out
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`
}

function formatDuration(seconds: number): string {
  return `${seconds.toFixed(1)}s`
}

/**
 * 执行「上传参考视频 → 抽帧 → 上传 Drama → 风格归纳」全流程。
 * 视频与帧都写入项目 assets 目录（同源 URL 由 webServer 托管）；任何一步失败
 * 都整体抛错（客户端提示，不落半成品节点）。
 */
export async function extractVideoStyle(
  registry: ProjectRegistry,
  projectId: string,
  name: string,
  bytes: Buffer,
  options: VideoStyleOptions = {},
  signal?: AbortSignal,
): Promise<VideoStyleResult> {
  const project = (await registry.list()).find((entry) => entry.id === projectId)
  if (!project) throw new Error(`项目不存在: ${projectId}`)
  if (bytes.length === 0) throw new Error('视频内容为空')
  const ext = /\.(mp4|mov|m4v|webm|avi|mkv)$/iu.exec(name)?.[0]?.slice(1).toLowerCase() ?? 'mp4'

  const directory = registry.assetsDir(projectId)
  await mkdir(directory, { recursive: true })

  // 1) 视频本体落盘（留档 + 作为 ffmpeg 输入）。
  const videoId = newAssetId()
  const videoFile = `${videoId}.${ext}`
  await writeFile(join(directory, videoFile), bytes)
  const inputPath = join(directory, videoFile)

  const ffmpegPath = resolveFfmpegPath(options.ffmpegPath)

  // CR-021：视频本体已落盘后，抽帧 / 上传 / VLM 归纳任一步失败都要清理本次
  // 生成的视频与已抽帧，避免遗留无画布节点引用的孤儿资产。
  const writtenFiles: string[] = [videoFile]
  try {
    // 2) 探测时长：`ffmpeg -i`（无输出目标）以非零码结束属预期，元信息在 stderr。
    const probe = await runFfmpeg(ffmpegPath, ['-i', inputPath], FFMPEG_TIMEOUT_MS, signal)
    const duration = parseFfmpegDuration(probe.stderr)

    // 3) 逐帧抽取 PNG 并上传 Drama 拿 filename —— 后续生成工具直接可用。
    const times = planFrameTimes(duration, options)
    const frames: VideoFrameImport[] = []
    for (const time of times) {
      const frameId = newAssetId()
      const frameFile = `${frameId}.png`
      const framePath = join(directory, frameFile)
      const extraction = await runFfmpeg(ffmpegPath, [
        '-ss',
        time.toFixed(2),
        '-i',
        inputPath,
        '-frames:v',
        '1',
        '-q:v',
        '3',
        '-y',
        framePath,
      ], FFMPEG_TIMEOUT_MS, signal)
      if (extraction.code !== 0) {
        const detail = truncate(extraction.stderr.trim().split('\n').at(-1) ?? '', 200)
        throw new Error(`参考视频抽帧失败（@${time.toFixed(1)}s${detail.length > 0 ? `: ${detail}` : ''}）`)
      }
      if (!existsSync(framePath)) {
        throw new Error(`参考视频抽帧失败（@${time.toFixed(1)}s）：ffmpeg 正常退出但未产出帧图`)
      }
      writtenFiles.push(frameFile)
      const filename = await uploadBytesToDrama(await readFile(framePath), 'png', signal)
      frames.push({ url: `/canvas-studio/assets/${projectId}/${frameFile}`, filename, time })
    }

    // 4) 风格归纳：均匀抽样 ≤ styleSamples 帧，逐帧 VLM 分析后合并成 sticky 正文。
    const samples = sampleEvenly(frames, options.styleSamples ?? STYLE_SAMPLE_MAX)
    const sections: string[] = []
    for (const frame of samples) {
      const analysis = await analyzeImage(frame.filename, STYLE_PROMPT, STYLE_SYSTEM_PROMPT, signal)
      sections.push(`帧 @${frame.time.toFixed(1)}s\n${truncate(String(analysis).trim(), ANALYSIS_MAX_CHARS)}`)
    }
    const header = `【参考视频风格归纳】${name.length > 0 ? name : '参考视频'} · ${frames.length} 帧 · 时长 ${formatDuration(duration)}`
    const summary = [header, ...sections].join('\n\n')

    return { videoUrl: `/canvas-studio/assets/${projectId}/${videoFile}`, duration, frames, summary }
  } catch (cause) {
    for (const file of writtenFiles) await rm(join(directory, file)).catch(() => {})
    throw cause
  }
}
