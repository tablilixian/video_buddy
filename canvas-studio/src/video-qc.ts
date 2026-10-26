/**
 * OPT-10（2026-10-26）：视频镜头质检（qc_shot 的 videoRefs 通道，Host 侧）。
 *
 * 背景：qc_shot 此前只收图片句柄 —— 视频镜头要 QC 得 agent 自己 ffmpeg 抽帧 →
 * upload_image×3 → qc_shot×3（session.v4-4 实证：~3 分钟 6 次调用/镜头）。
 * 本模块把这条链收进 Host 一次调用：解析视频节点 → ffmpeg 定点抽 3 帧
 * （首/中/末，纯函数规划）→ 逐帧走既有 runShotQc → 最差档聚合。
 *
 * 抽帧帧图**不落画布节点**（QC 中间产物，进 assets 目录后由 asset-gc 按
 * 孤儿登记，F-08 只登记不删除）；逐帧结论聚合后写回**源视频节点**。
 * ffmpeg / 上传均可注入（测试替身），与 video-frames.ts 同一套解析链。
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectRegistry } from './projects.js'
import type { StudioCanvasNode, StudioQcRecord } from './contracts/canvas.js'
import { newAssetId } from './config.js'
import { uploadBytesToDrama } from './generate.js'
import { urlToAssetPath } from './compose.js'
import { resolveFfmpegPath, runFfmpeg, parseFfmpegDuration, FFMPEG_TIMEOUT_MS } from './ffmpeg-run.js'
import { findNodeByRef } from './reference-token.js'
import { throwError } from './error-system.js'
import { runShotQc, DEFAULT_QC_BUDGET, type QcShotOptions, type QcVerdict, type QcVerdictValue } from './quality-check.js'

/** 末帧内缩秒数（与 video-frames.ts 同值：避开容器尾部的空帧/黑帧）。 */
const LAST_FRAME_EPSILON_SEC = 0.05

/**
 * 规划视频 QC 的抽帧时间点（纯函数）：首 / 中 / 末三点。
 * 时长未知 / 非正 → 只抽首帧 [0]；短视频三点重合时去重（只抽一帧，不浪费 VLM 调用）。
 */
export function planQcFrameSeeks(durationSec: number): number[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [0]
  const last = Math.max(0, Math.round((durationSec - LAST_FRAME_EPSILON_SEC) * 100) / 100)
  const mid = Math.round((durationSec / 2) * 100) / 100
  // 三点 + 近邻去重（短视频三点挤在 0.1s 内时只抽首帧，不浪费 VLM 调用）。
  const out: number[] = []
  for (const seek of [0, mid, last]) {
    if (out.length === 0 || seek - out[out.length - 1]! > 0.1) out.push(seek)
  }
  return out
}

/**
 * qc_shot 入参「二选一」校验（纯函数，工具入口与单测共用）：
 * 图片镜头 `filename` / 视频镜头 `videoRefs`，都传或都缺都拒，报错文案可执行。
 */
export function validateQcTargetInput(
  filename: unknown,
  videoRefs: unknown,
): { videoRefs: string[]; filename: string } {
  const refs = Array.isArray(videoRefs)
    ? videoRefs.map((ref) => String(ref).trim()).filter((ref) => ref.length > 0)
    : []
  const name = typeof filename === 'string' ? filename.trim() : ''
  if (refs.length > 0 && name.length > 0) {
    throwError('CS-USER-ERR', {
      message: 'filename 与 videoRefs 二选一：图片镜头传 filename，视频镜头传 videoRefs（画布视频节点 id / 标题 / url）',
    })
  }
  if (refs.length === 0 && name.length === 0) {
    throwError('CS-USER-ERR', {
      message: '缺少被检镜头：图片镜头传 filename（upload_image 返回的句柄或 @ref），视频镜头传 videoRefs（画布视频节点 id / 标题 / url）',
    })
  }
  return { videoRefs: refs, filename: name }
}

/** 单帧质检结论（seek 便于报告定位）。 */
export interface FrameQcOutcome extends QcVerdict {
  /** 抽帧时间点（秒）。 */
  seek: number
}

/**
 * 多帧结论聚合（纯函数）：**最差档** —— 任一帧 fail → fail；否则任一 warn → warn；
 * 全部 pass → pass。漂移项带帧号前缀；reason 汇总各帧判定 + 首个最差档帧的理由。
 */
export function aggregateVideoQc(frames: readonly FrameQcOutcome[]): QcVerdict {
  if (frames.length === 0) {
    return { verdict: 'warn', drifts: [], reason: '未产出任何可检帧，请人工确认' }
  }
  const severity: Record<QcVerdictValue, number> = { fail: 0, warn: 1, pass: 2 }
  const worst = frames.reduce<QcVerdictValue>(
    (acc, frame) => (severity[frame.verdict] < severity[acc] ? frame.verdict : acc),
    'pass',
  )
  const drifts = frames.flatMap((frame, index) =>
    frame.drifts.map((drift) => `帧${index + 1}(${frame.seek.toFixed(2)}s): ${drift}`),
  )
  const perFrame = frames
    .map((frame, index) => `帧${index + 1}(${frame.seek.toFixed(2)}s)=${frame.verdict.toUpperCase()}`)
    .join('、')
  const worstReason = frames.find((frame) => frame.verdict === worst)?.reason ?? ''
  return {
    verdict: worst,
    drifts,
    reason: `视频镜头 ${frames.length} 帧抽检（${perFrame}）—— ${worstReason}`,
  }
}

/** 视频 QC 可注入项（测试替身）。 */
export interface VideoQcOptions extends QcShotOptions {
  /** 显式 ffmpeg 路径。 */
  ffmpegPath?: string
  /** 帧图上传实现（缺省 uploadBytesToDrama）。 */
  upload?: (bytes: Uint8Array, signal?: AbortSignal) => Promise<string>
}

/** 单个视频镜头的 QC 结果。 */
export interface VideoQcResult {
  /** 聚合判定（最差档）。 */
  verdict: QcVerdictValue
  drifts: string[]
  reason: string
  /** 帧数（VLM 调用次数）。 */
  frameCount: number
  /** 逐帧明细。 */
  frames: FrameQcOutcome[]
  /** 源视频节点 id（未匹配到画布节点时为 null）。 */
  nodeId: string | null
}

/**
 * 对单个视频镜头做一致性质检：定点抽帧 → 逐帧 runShotQc → 聚合。
 *
 * `videoRef` 接受三种形态（与既有引用习惯一致）：画布视频节点 id、节点标题、
 * 节点的同源 URL（`/canvas-studio/assets/...`）。抽帧失败 / 文件不存在 → 中文可执行报错。
 */
export async function runVideoShotQc(
  nodes: readonly StudioCanvasNode[],
  registry: ProjectRegistry,
  projectId: string,
  videoRef: string,
  options: VideoQcOptions,
): Promise<VideoQcResult> {
  const videoNodes = nodes.filter((node) => node.kind === 'video')
  const node = findNodeByRef(videoNodes, videoRef)
  const videoUrl = node?.url ?? videoRef
  const inputPath = urlToAssetPath(registry.assetsDir(projectId), videoUrl)
  if (!existsSync(inputPath)) {
    throwError('CS-USER-ERR', {
      message: `视频文件不存在（${videoUrl}）。请传本项目画布上视频节点的 id / 标题 / url（video_generate / video_composite 产物）。`,
      detail: videoRef,
    })
  }

  const ffmpegPath = resolveFfmpegPath(options.ffmpegPath)
  // 1) 探测时长（`ffmpeg -i` 无输出目标非零码结束属预期，元信息在 stderr）。
  const probe = await runFfmpeg(ffmpegPath, ['-i', inputPath], FFMPEG_TIMEOUT_MS, options.signal)
  const duration = parseFfmpegDuration(probe.stderr)
  const seeks = planQcFrameSeeks(duration)

  // 2) 逐帧抽取 → 上传 → 逐帧质检。
  const directory = registry.assetsDir(projectId)
  await mkdir(directory, { recursive: true })
  const upload = options.upload ?? ((bytes: Uint8Array, sig?: AbortSignal) => uploadBytesToDrama(bytes, 'png', sig))
  const frames: FrameQcOutcome[] = []
  for (const seek of seeks) {
    const frameId = newAssetId()
    const framePath = join(directory, `${frameId}.png`)
    const extraction = await runFfmpeg(
      ffmpegPath,
      ['-ss', seek.toFixed(2), '-i', inputPath, '-frames:v', '1', '-q:v', '2', '-y', framePath],
      FFMPEG_TIMEOUT_MS,
      options.signal,
    )
    if (extraction.code !== 0 || !existsSync(framePath)) {
      const detail = (extraction.stderr.trim().split('\n').at(-1) ?? '').slice(0, 200)
      throwError('CS-USER-ERR', { message: `QC 抽帧失败（seek ${seek.toFixed(2)}s），请检查视频文件`, detail })
    }
    const filename = await upload(new Uint8Array(await readFile(framePath)), options.signal)
    const frameResult = await runShotQc(nodes, filename, options)
    frames.push({ seek, verdict: frameResult.verdict, drifts: frameResult.drifts, reason: frameResult.reason })
  }

  const merged = aggregateVideoQc(frames)
  return {
    verdict: merged.verdict,
    drifts: merged.drifts,
    reason: merged.reason,
    frameCount: frames.length,
    frames,
    nodeId: node?.id ?? null,
  }
}

/** 由聚合结论构造待写回视频节点的质检记录（video 通道不参与预算重跑，attempts 恒 1）。 */
export function buildVideoQcRecord(merged: QcVerdict, expect: string, now: number): StudioQcRecord {
  return { verdict: merged.verdict, drifts: merged.drifts, reason: merged.reason, attempts: 1, checkedAt: now, expect }
}

/** video 通道的重跑预算展示值（不参与重跑语义，仅对齐 output schema 的必填字段）。 */
export const VIDEO_QC_BUDGET = DEFAULT_QC_BUDGET
