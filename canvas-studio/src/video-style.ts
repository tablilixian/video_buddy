/**
 * Canvas Studio P8.4 参考视频拆分（Host 侧）。
 *
 * **2026-09-22 改造**：上传视频**不再自动抽帧** —— 上传只落盘 + 拿 Drama 句柄 +
 * 探时长（见 `routes.ts` 的 `/canvas-studio/upload-video`），产出一个可播放、可被
 * `videoRefs` 引用的**视频节点**；抽帧与风格归纳改为**按需触发**（画布右键
 * 「拆分视频」→ `/canvas-studio/split-video` → 本模块的 `splitVideoAsset`）。
 *
 * 动因（用户 2026-09-22 拍板）：① 上传即抽帧会一次刷出 N 张帧图 + 1 张便签，
 * 画布当场被灌，用户没得选；② 视频本身不落画布 ⇒ 后端支持的参考视频通道
 * （`image2videoref2va` 的 `video1..3`，CV-226 已接）没有可引用的素材；
 * ③ 视频资产无法播放 / 无法复用。
 *
 * 抽帧依据（`planFrameTimes`）：短片（≤ every×max）每 `every` 秒一帧；
 * 长片改为**全片均匀取 `max` 帧**（风格采样要覆盖全片而不是只看开头）；
 * 时长未知/非法只取第 0 帧。归纳时再均匀抽 `styleSamples` 帧送 VLM。
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
import { analyzeImage, assetKeyFromUrl, uploadBytesToDrama } from './generate.js'
import { resolveFfmpegPath, runFfmpeg, parseFfmpegDuration } from './ffmpeg-run.js'
import {
  LOOK_ANALYST_SYSTEM_PROMPT,
  INDUCIBLE_LOOK_TOKENS_PROMPT,
  mergeLookTokens,
} from './style-tokens.js'

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

/**
 * 归纳提示词已抽到 `style-tokens.ts`（单一权威）：5 个字段名与格式在那里定义，
 * Agent 侧 `references/look.md` 的提示词原文由测试断言与其逐字节一致。
 */

/** 单帧产物：同源 URL + Drama 文件名 + 采样时间点（秒）。 */
export interface VideoFrameImport {
  url: string
  filename: string
  time: number
}

/** 参考视频拆分的完整结果（`/canvas-studio/split-video` 路由响应）。 */
export interface VideoStyleResult {
  /** 被拆分的视频的同源 URL（回传供调用方把帧图血缘指向该视频节点）。 */
  videoUrl: string
  /** 探测到的视频时长（秒；探测失败为 0）。 */
  duration: number
  frames: VideoFrameImport[]
  /** 风格归纳文本（风格归纳 sticky 节点的正文）：头部 + 逐帧观察 + 末尾「5 项风格 tokens」段。 */
  summary: string
  /**
   * 归并后的 5 项 tokens（色彩 / 光线 / 材质 / 镜头语汇 / 节奏，每行一个字段）。
   * 供 Look 采集直接复用（`docs/look-asset-plan.md` §3.2）；`''` 表示 VLM 未按格式输出、
   * 归并失败 → 应走降级（改用参考图归纳或从用户原话反推），不要把空串当结论。
   */
  tokens: string
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
/** 上传视频的落盘结果（`/canvas-studio/upload-video` 响应）。 */
export interface VideoImportResult {
  /** 同源 URL（画布节点直接用它播放）。 */
  videoUrl: string
  /** 探测到的时长（秒）；探测失败为 **0**（不阻断落卡）。 */
  duration: number
  /** Drama 句柄（`ref-*.mp4`）；**空串 = 上传失败**，画布仍可播放，句柄由惰性提升补。 */
  filename: string
}

/**
 * 上传视频：**只落盘 + 探时长 + 拿 Drama 句柄**，不抽帧。
 *
 * 抽帧与风格归纳改成按需触发（画布右键「拆分视频」→ `splitVideoAsset`）。上传时
 * 一次性抽帧会把画布灌满帧图、且视频本身不落节点 ⇒ 既没法播放，也当不了参考视频。
 *
 * **两处刻意都不阻断**：
 * - 时长探测失败（ffmpeg 不可用 / 非预期容器）→ `duration = 0`，节点照常落；
 *   参考视频规格校验对未知时长是「跳过该项」，不会因此误拦。
 * - Drama 上传失败 → `filename = ''`；播放走同源 URL 不受影响，将来被 `@ref`
 *   引用时由 `resolveRefFilenames` 的「有 url 无 filename ⇒ 现场提升并回写」兜住。
 */
export async function importVideoAsset(
  registry: ProjectRegistry,
  projectId: string,
  name: string,
  bytes: Buffer,
  options: VideoStyleOptions = {},
  signal?: AbortSignal,
): Promise<VideoImportResult> {
  const project = (await registry.list()).find((entry) => entry.id === projectId)
  if (!project) throw new Error(`项目不存在: ${projectId}`)
  if (bytes.length === 0) throw new Error('视频内容为空')
  const ext = /\.(mp4|mov|m4v|webm|avi|mkv)$/iu.exec(name)?.[0]?.slice(1).toLowerCase() ?? 'mp4'

  const directory = registry.assetsDir(projectId)
  await mkdir(directory, { recursive: true })
  const videoFile = `${newAssetId()}.${ext}`
  const inputPath = join(directory, videoFile)
  await writeFile(inputPath, bytes)

  let duration = 0
  try {
    const probe = await runFfmpeg(resolveFfmpegPath(options.ffmpegPath), ['-i', inputPath], FFMPEG_TIMEOUT_MS, signal)
    duration = parseFfmpegDuration(probe.stderr)
  } catch { /* 探不到就留 0：时长是展示/校验的增强项，不该拦住上传 */ }

  let filename = ''
  try {
    filename = await uploadBytesToDrama(bytes, ext, signal)
  } catch { /* 留空，交给 host-tools 的惰性提升 */ }

  return { videoUrl: `/canvas-studio/assets/${projectId}/${videoFile}`, duration, filename }
}

export async function splitVideoAsset(
  registry: ProjectRegistry,
  projectId: string,
  videoUrl: string,
  label: string,
  options: VideoStyleOptions = {},
  signal?: AbortSignal,
): Promise<VideoStyleResult> {
  const project = (await registry.list()).find((entry) => entry.id === projectId)
  if (!project) throw new Error(`项目不存在: ${projectId}`)
  // 只接受本项目画布资产 URL —— `assetKeyFromUrl` 已按白名单字符集挡住路径穿越。
  const assetKey = assetKeyFromUrl(videoUrl)
  if (assetKey === null || !assetKey.startsWith(`${projectId}/`)) {
    throw new Error(`拆分视频：不是本项目的画布资产（${videoUrl}）`)
  }
  const videoFile = assetKey.slice(projectId.length + 1)
  const directory = registry.assetsDir(projectId)
  const inputPath = join(directory, videoFile)
  if (!existsSync(inputPath)) throw new Error(`拆分视频：资产文件不存在（${videoFile}）`)
  return runFramePipeline(projectId, directory, inputPath, videoUrl, label, options, signal)
}

/**
 * 抽帧 → 上传帧图拿 filename → VLM 风格归纳的共用实现。
 *
 * @param directory 项目 assets 目录（帧图写这里）。
 * @param inputPath ffmpeg 输入：已落盘的视频绝对路径（**不会被删** —— 它属于画布节点，
 *   故与旧实现不同，失败清理只覆盖本次新抽的帧）。
 * @param videoUrl 回传给调用方的同源 URL。
 * @param label 归纳便签抬头用的名字（通常是节点标题）。
 */
async function runFramePipeline(
  projectId: string,
  directory: string,
  inputPath: string,
  videoUrl: string,
  label: string,
  options: VideoStyleOptions,
  signal?: AbortSignal,
): Promise<VideoStyleResult> {
  const ffmpegPath = resolveFfmpegPath(options.ffmpegPath)
  // CR-021 的清理范围收敛到「本次新抽的帧」：原视频是画布上的正式资产，
  // 派生失败不该连它一起删（旧实现里输入视频是本次上传的，故一并清理）。
  const writtenFiles: string[] = []
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

    // 4) 风格归纳：均匀抽样 ≤ styleSamples 帧，逐帧 VLM 分析后归并成 5 项 tokens。
    //    逐帧拼接（sections）只是**过程留痕**，结论是归并出来的 tokens —— 归并不是 join，
    //    而是按「字段 → 子句」两级去重（见 style-tokens.ts mergeLookTokens）。
    const samples = sampleEvenly(frames, options.styleSamples ?? STYLE_SAMPLE_MAX)
    const sections: string[] = []
    const analyses: string[] = []
    for (const frame of samples) {
      const analysis = await analyzeImage(frame.filename, INDUCIBLE_LOOK_TOKENS_PROMPT, LOOK_ANALYST_SYSTEM_PROMPT, signal)
      const trimmed = truncate(String(analysis).trim(), ANALYSIS_MAX_CHARS)
      analyses.push(trimmed)
      sections.push(`帧 @${frame.time.toFixed(1)}s\n${trimmed}`)
    }
    const header = `【参考视频风格归纳】${label.length > 0 ? label : '参考视频'} · ${frames.length} 帧 · 时长 ${formatDuration(duration)}`
    const merged = mergeLookTokens(analyses)
    // tokens 段必须在同一份 sticky 里 —— Agent 是读便签正文来取风格的，另开字段它读不到。
    const tokensSection =
      merged.length > 0
        ? `【5 项风格 tokens】\n${merged}`
        : '【5 项风格 tokens】未能按 5 项格式归纳。请改用参考图归纳，或从用户原话反推 5 项。'
    const summary = [header, ...sections, tokensSection].join('\n\n')

    return { videoUrl, duration, frames, summary, tokens: merged }
  } catch (cause) {
    for (const file of writtenFiles) await rm(join(directory, file)).catch(() => {})
    throw cause
  }
}
