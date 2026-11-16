/**
 * RQ-038 R11-B2（2026-11-16）· **段级抽帧**（宿主 ffmpeg）。
 *
 * ## 解决什么
 *
 * 真机会话 6f8ba13c 实测：6 次 `render_composition` 回执**零帧**，模型只能自己
 * `ffmpeg -ss` 抽 1920×1080 PNG —— 6 步、8 次读图（占 70 步的 20%），其中 3 次
 * 因 base64 累计超 2MB 被平台驱逐最重试（`IMAGE_OFFLOAD_REQUIRED`），质检证据链
 * 中途断裂。根因是分镜路径合成 outcome 时给了 `frames: []`。
 *
 * ## 为什么在宿主抽而不是客户端
 *
 * 段产物（`deliver/segments/<id>.mp4`）已经落盘，宿主抽一帧与「复用段还是新渲段」
 * 无关 —— 复用段没有本次渲染会话，客户端抽帧对它天然失效。宿主抽帧口径统一，
 * 且缩略图落资产目录后 `read_image` 直接可用。
 *
 * ## 抽哪一帧
 *
 * 段中点（`segment-artifacts.ts` 的 `segmentSampleFrame`）。**不取段首**：段首正是
 * 转场叠化的起点，拍到的两张画面叠影会被误判成排版 bug。
 *
 * 纪律：任何失败（缺 ffmpeg / 解码失败 / 落盘失败）返回 null，由调用方记一行
 * 回执 —— 抽帧是取证设施，不能影响出片。
 */
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectRegistry } from './projects.js'
import { saveLocalAssetBytes } from './generate.js'
import { FFMPEG_TIMEOUT_MS, resolveFfmpegPath, runFfmpeg } from './ffmpeg-run.js'
import type { SegmentArtifact } from './segment-artifacts.js'

/**
 * 段内相对 seek（秒）：段 mp4 的时间轴从 0 起（frameRange 渲染只编码段内帧），
 * 所以 `(绝对帧 − 段首帧) / fps`。非法 fps 按 30 兜底，负值钳 0。
 */
export function segmentFrameSeekSec(artifact: SegmentArtifact, fps: number): number {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30
  const offset = Math.max(0, Math.round(artifact.sampleFrame) - Math.round(artifact.startFrame))
  return Math.round((offset / safeFps) * 1000) / 1000
}

export interface SegmentFrameOptions {
  registry: ProjectRegistry
  projectId: string
  artifact: SegmentArtifact
  /** 段产物绝对路径（`deliver/segments` 或缓存目录里的 mp4）。 */
  file: string
  fps: number
  signal?: AbortSignal
}

/**
 * 从段产物取一帧，落资产目录并回传同源 URL（失败返回 null）。
 * 返回的 URL 走与整片抽帧同一个资产路由 ⇒ 回执里的 `path` 由宿主统一解析。
 */
export async function sampleSegmentFrame(options: SegmentFrameOptions): Promise<{ url: string } | null> {
  if (!existsSync(options.file)) return null
  let workDir: string | null = null
  try {
    workDir = await mkdtemp(join(tmpdir(), 'cs-seg-frame-'))
    const pngPath = join(workDir, `${options.artifact.id}.png`)
    const result = await runFfmpeg(
      resolveFfmpegPath(),
      [
        '-ss', segmentFrameSeekSec(options.artifact, options.fps).toFixed(3),
        '-i', options.file,
        '-frames:v', '1',
        '-q:v', '2',
        '-y', pngPath,
      ],
      FFMPEG_TIMEOUT_MS,
      options.signal,
    )
    if (result.code !== 0 || !existsSync(pngPath)) return null
    const bytes = await readFile(pngPath)
    if (bytes.length === 0) return null
    const saved = await saveLocalAssetBytes(options.registry, options.projectId, `qc-${options.artifact.id}.png`, bytes)
    return { url: saved.url }
  } catch {
    return null
  } finally {
    if (workDir !== null) await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
