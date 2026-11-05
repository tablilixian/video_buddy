/**
 * 自适应切点检测（CV-445 S1，rea-video A3 吸收）—— 算法移植自 rea-video `shots.py`
 * （Apache-2.0，JuneYaooo 版权；只移植算法思想，不 vendor 代码，不引入视觉库）。
 *
 * ## 为什么升级
 *
 * 旧实现（`teardown-verify.ts` 的 2fps / 16×16 均色距，注释直书「刻意朴素」）已知缺陷：
 * 「静态版式上文字弹出」会误判切镜（只变局部），固定阈值抗光照闪烁差。rea-video 的
 * 三件套恰好治这两个病：
 *
 *   1. **分数合成** = 0.6×HSV 直方图 Bhattacharyya + 0.4×clip(像素差分×4)——直方图管
 *      「整体换色」，像素差分管「结构变化」，光照闪烁只抬其一；
 *   2. **局部自适应阈值**——分数需显著高于 0.5s 窗口局部中位数（抗整体光变）；
 *   3. **变化面积门限**——`changed`（明显变化的像素占比）> 0.25 才算切：标题在静态
 *      版式上弹出只变局部 → 不算切（旧实现的误报形态）。
 *
 * 另移植黑场/白场淡入淡出（luma 掉到极值又回来）。**交叉溶解检测暂不移植**：其排除
 * 「是运动不是溶解」依赖光流（视觉库语义，D1 默认否决），裸移植会在慢速运镜上误报 ——
 * 溶解单独立项再议（见 docs/plans/2026-11-05-rea-video调研与吸收评估.md D1/A3）。
 *
 * ## 分层
 *
 *   IO（extractFrameTrack，ffmpeg 流式抽帧）← 唯一接缝
 *     └ FrameTrackBuilder（增量特征提取，纯）
 *         └ detectShotBoundaries（纯：分数→局部中位数→三条件→极值段→最短镜长合并）
 *           └ detectCutPointsForVideo（便捷封装，teardown-verify / evidence-grid 共用）
 *
 * 验收基准（docs/plans/2026-11-05-rea-video能力对照表.md §8，B 站 20s 真值片）：
 * 命中 ≥9/10、FP ≤2；正反例：8.167s/14.6s 连续变形不误判、10.40s 爆炸亮帧不漏检。
 */
import { spawn } from 'node:child_process'
import { resolveFfmpegPath, runFfmpeg, FFMPEG_TIMEOUT_MS } from './ffmpeg-run.js'
import { parseMediaMeta } from './media-probe.js'
import { throwError } from './error-system.js'

/** 缩略图宽（与 rea-video THUMB_W 同值；高按 16:9 固定 54 —— 切点检测对纵横比失真不敏感）。 */
export const SHOT_THUMB_W = 96
export const SHOT_THUMB_H = 54

/** 缺省抽帧 fps：6fps 给 0.167s 级切点精度（旧实现 2fps = 0.5s），特征量仍便宜。 */
export const SHOT_SAMPLE_FPS = 6

/** 原生帧率采样封顶：高帧率源（60/120fps）降采样到 30 —— 切点窗口语义（0.5s）不变，控单帧成本。 */
export const SHOT_MAX_SAMPLE_FPS = 30

/** 一帧缩略图的逐帧特征（直方图距离等序列按帧序排列）。 */
export interface FrameTrack {
  /** 抽帧 fps（= 1/帧间隔）。 */
  fps: number
  /** 与前一帧的 HSV 直方图 Bhattacharyya 距离（0–1，首帧为 0）。 */
  histDist: number[]
  /** 灰度平均绝对差 / 255（0–1，首帧为 0）。 */
  pixDiff: number[]
  /** 明显变化像素占比（0–1，阈值见 buildFrameTrack；首帧为 0）。 */
  changed: number[]
  /** 平均亮度（0–255）。 */
  luma: number[]
}

/** RGB → 16×4×4 HSV 直方图（L1 归一化）。H 桶对齐 OpenCV 0–180°/16 桶的划分。 */
export function rgbHsvHistogram(raw: Uint8Array, offset: number, pixelCount: number): Float64Array {
  const hist = new Float64Array(16 * 4 * 4)
  for (let i = 0; i < pixelCount; i += 1) {
    const r = raw[offset + i * 3] ?? 0
    const g = raw[offset + i * 3 + 1] ?? 0
    const b = raw[offset + i * 3 + 2] ?? 0
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const v = max / 255
    const s = max === 0 ? 0 : (max - min) / max
    let hDeg = 0
    if (max !== min) {
      const delta = max - min
      if (max === r) hDeg = 60 * (((g - b) / delta) % 6)
      else if (max === g) hDeg = 60 * ((b - r) / delta + 2)
      else hDeg = 60 * ((r - g) / delta + 4)
      if (hDeg < 0) hDeg += 360
    }
    const hBin = Math.min(15, Math.floor((hDeg / 360) * 16))
    const sBin = Math.min(3, Math.floor(s * 4))
    const vBin = Math.min(3, Math.floor(v * 4))
    const bin = (hBin * 4 + sBin) * 4 + vBin
    hist[bin] = (hist[bin] ?? 0) + 1
  }
  const total = pixelCount > 0 ? pixelCount : 1
  for (let i = 0; i < hist.length; i += 1) hist[i]! /= total
  return hist
}

/** 直方图 Bhattacharyya 距离（对齐 OpenCV HISTCMP_BHATTACHARYYA：√(1 − Σ√(p·q))）。 */
export function histogramBhattacharyya(a: Float64Array, b: Float64Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i += 1) sum += Math.sqrt((a[i] ?? 0) * (b[i] ?? 0))
  if (sum > 1) sum = 1
  return Math.sqrt(1 - sum)
}

/**
 * 增量特征提取器（纯，无 IO）：喂 rgb24 rawvideo 字节流，逐帧产出特征序列。
 * 只保留逐帧四个标量 + 交换用的单帧灰度缓冲，内存 O(1)（旧实现整缓冲进内存）。
 */
export class FrameTrackBuilder {
  private readonly frameBytes: number
  private readonly pixelCount: number
  private carry: Buffer = Buffer.alloc(0)
  private prevGray: Float64Array | null = null
  private prevHist: Float64Array | null = null
  private prevStd = 0
  private readonly samples: FrameTrack

  constructor(frameBytes: number, fps: number) {
    if (frameBytes <= 0 || frameBytes % 3 !== 0) throwError('CS-DEV-ERR', { detail: `frameBytes 非法：${frameBytes}` })
    this.frameBytes = frameBytes
    this.pixelCount = frameBytes / 3
    this.samples = { fps, histDist: [], pixDiff: [], changed: [], luma: [] }
  }

  get frameCount(): number {
    return this.samples.luma.length
  }

  /** 喂一段字节流；凑满一帧处理一帧，残字节留到下次。 */
  push(chunk: Uint8Array): void {
    if (chunk.length === 0) return
    this.carry = this.carry.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.carry, chunk])
    let offset = 0
    while (offset + this.frameBytes <= this.carry.length) {
      this.consumeFrame(offset)
      offset += this.frameBytes
    }
    this.carry = offset === 0 ? this.carry : this.carry.subarray(offset)
  }

  /** 收尾：返回特征序列（残字节忽略 —— 与旧实现「尾部残字节忽略」同口径）。 */
  finish(): FrameTrack {
    return this.samples
  }

  private consumeFrame(offset: number): void {
    const { pixelCount } = this
    const gray = new Float64Array(pixelCount)
    const hist = new Float64Array(16 * 4 * 4)
    let graySum = 0
    let graySqSum = 0
    for (let i = 0; i < pixelCount; i += 1) {
      const r = this.carry[offset + i * 3] ?? 0
      const g = this.carry[offset + i * 3 + 1] ?? 0
      const b = this.carry[offset + i * 3 + 2] ?? 0
      // Rec601 亮度（与 OpenCV BGR2GRAY 同系数）
      const y = 0.299 * r + 0.587 * g + 0.114 * b
      gray[i] = y
      graySum += y
      graySqSum += y * y
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const v = max / 255
      const s = max === 0 ? 0 : (max - min) / max
      let hDeg = 0
      if (max !== min) {
        const delta = max - min
        if (max === r) hDeg = 60 * (((g - b) / delta) % 6)
        else if (max === g) hDeg = 60 * ((b - r) / delta + 2)
        else hDeg = 60 * ((r - g) / delta + 4)
        if (hDeg < 0) hDeg += 360
      }
      const hBin = Math.min(15, Math.floor((hDeg / 360) * 16))
      const sBin = Math.min(3, Math.floor(s * 4))
      const vBin = Math.min(3, Math.floor(v * 4))
      const bin = (hBin * 4 + sBin) * 4 + vBin
      hist[bin] = (hist[bin] ?? 0) + 1
    }
    const mean = graySum / pixelCount
    const variance = Math.max(0, graySqSum / pixelCount - mean * mean)
    const std = Math.sqrt(variance)
    for (let i = 0; i < hist.length; i += 1) hist[i]! /= pixelCount
    if (this.prevGray === null || this.prevHist === null) {
      this.samples.histDist.push(0)
      this.samples.pixDiff.push(0)
      this.samples.changed.push(0)
    } else {
      let diffSum = 0
      let changedCount = 0
      const thr = Math.max(6.0, 0.35 * Math.min(std, this.prevStd))
      for (let i = 0; i < pixelCount; i += 1) {
        const d = Math.abs(gray[i]! - this.prevGray[i]!)
        diffSum += d
        if (d > thr) changedCount += 1
      }
      this.samples.pixDiff.push(diffSum / pixelCount / 255)
      this.samples.changed.push(changedCount / pixelCount)
      this.samples.histDist.push(histogramBhattacharyya(this.prevHist, hist))
    }
    this.samples.luma.push(mean)
    this.prevGray = gray
    this.prevHist = hist
    this.prevStd = std
  }
}

/** 整段缓冲的一次性形态（测试/小视频便捷入口）。 */
export function buildFrameTrack(raw: Uint8Array, frameBytes: number, fps: number): FrameTrack {
  const builder = new FrameTrackBuilder(frameBytes, fps)
  builder.push(raw)
  return builder.finish()
}

/** 局部中位数（窗口**不含自身** —— 分数不应被自己抬高/压低，对齐 shots.py `_local_median`）。 */
export function localMedian(values: readonly number[], radius: number): number[] {
  const n = values.length
  const out = new Array<number>(n)
  for (let i = 0; i < n; i += 1) {
    const lo = Math.max(0, i - radius)
    const hi = Math.min(n, i + radius + 1)
    const window: number[] = []
    for (let j = lo; j < hi; j += 1) {
      if (j === i) continue
      const v = values[j]
      if (v !== undefined) window.push(v)
    }
    out[i] = medianOf(window)
  }
  return out
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const upper = sorted[mid] ?? 0
  if (sorted.length % 2 === 1) return upper
  return ((sorted[mid - 1] ?? upper) + upper) / 2
}

/** 百分位（线性插值，对齐 numpy percentile 缺省口径）。 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0] ?? 0
  const rank = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  const a = sorted[lo] ?? 0
  const b = sorted[hi] ?? 0
  return a + (b - a) * (rank - lo)
}

export interface ShotBoundary {
  /** 帧下标（该帧与前一帧之间发生切换）。 */
  index: number
  /** 切换时刻（秒，= index / fps）。 */
  timeSec: number
  kind: 'cut' | 'fade'
  /** 边界分数（cut = max(合成分, changed)；fade = 0.5）。 */
  score: number
}

export interface ShotDetectOptions {
  /** 切点判定的合成分下限。缺省 0.30（rea-video 同值）。 */
  cutThreshold?: number
  /** 最短镜长（秒）：相邻边界近于此值合并。缺省 0.35。 */
  minShotSec?: number
  /** 极值段（黑场/白场）最长认作淡入淡出的时长。缺省 2.5s。 */
  fadeMaxSec?: number
}

/**
 * 从帧特征序列提取画面切换边界（纯函数，移植 `detect_shots` 的 1) 硬切 与 2) 黑白场淡入淡出）。
 *
 * 硬切双通道（任一满足）：
 *   strong   = 分数 > cutThreshold 且 > 局部中位×2.5+0.06 且 changed > 0.25（变化面积门限）
 *   relative = changed > 0.45 且 > 局部中位×3+0.2 且 分数 > 局部中位×4+0.03（低对比场景的相对突变）
 */
export function detectShotBoundaries(samples: FrameTrack, options: ShotDetectOptions = {}): ShotBoundary[] {
  const cutThreshold = options.cutThreshold ?? 0.30
  const minShotSec = options.minShotSec ?? 0.35
  const fadeMaxSec = options.fadeMaxSec ?? 2.5
  const n = samples.luma.length
  if (n === 0 || samples.fps <= 0) return []
  const fps = samples.fps
  const score = samples.histDist.map((h, i) => 0.6 * h + 0.4 * Math.min(1, (samples.pixDiff[i] ?? 0) * 4))
  if (score.length > 0) score[0] = 0
  const radius = Math.max(4, Math.round(fps * 0.5))
  const base = localMedian(score, radius)
  const chgBase = localMedian(samples.changed, radius)
  const boundaries = new Map<number, { kind: 'cut' | 'fade'; score: number }>()

  for (let i = 1; i < n; i += 1) {
    const s = score[i] ?? 0
    const chg = samples.changed[i] ?? 0
    const b = base[i] ?? 0
    const cb = chgBase[i] ?? 0
    const strong = s > cutThreshold && s > b * 2.5 + 0.06 && chg > 0.25
    const relative = chg > 0.45 && chg > cb * 3 + 0.2 && s > b * 4 + 0.03
    if (strong || relative) boundaries.set(i, { kind: 'cut', score: Math.max(s, chg) })
  }

  // 黑场/白场淡入淡出：亮度掉到极值又回来，边界记在极值段结束处（下一镜从淡入开始）。
  const loLuma = Math.min(10, percentile(samples.luma, 50) * 0.35)
  let i = 0
  while (i < n) {
    const l = samples.luma[i] ?? 0
    if (l < loLuma || l > 248) {
      let j = i
      while (j < n) {
        const lj = samples.luma[j] ?? 0
        if (lj < loLuma || lj > 248) j += 1
        else break
      }
      if (i > 0 && j < n && j - i <= fps * fadeMaxSec) {
        const nearExisting = [...boundaries.keys()].some((b) => Math.abs(j - b) < radius)
        if (!nearExisting) boundaries.set(j, { kind: 'fade', score: 0.5 })
      }
      i = j
    } else {
      i += 1
    }
  }

  // 最短镜长合并：与前一个保留边界近于 minShotSec 的边界并入前镜（防密集抖动连报）。
  const minLen = Math.max(1, Math.round(minShotSec * fps))
  const kept: ShotBoundary[] = []
  for (const index of [...boundaries.keys()].sort((a, b) => a - b)) {
    const last = kept[kept.length - 1]
    if (last !== undefined && index - last.index < minLen) continue
    const info = boundaries.get(index)
    if (info === undefined) continue
    kept.push({ index, timeSec: index / fps, kind: info.kind, score: Math.round(info.score * 1000) / 1000 })
  }
  return kept
}

/** detectCutPointsForVideo 的返回（teardown-verify / evidence-grid 共用的切换点形态）。 */
export interface DetectedSwitch {
  timeSec: number
  magnitude: number
  kind: 'cut' | 'fade'
}

export interface DetectCutPointsResult {
  switches: DetectedSwitch[]
  /** 实际抽到的帧数。 */
  frameCount: number
  /** 实际抽帧 fps。 */
  fps: number
}

/**
 * 抽帧 + 检测一步到位（teardown-verify 与 evidence-grid 共用的唯一入口，切点口径同源）。
 * 帧数不足（<4）不算错误，返回空 switches 由调用方按「检不出」处理。
 */
export async function detectCutPointsForVideo(options: {
  videoPath: string
  sampleFps?: number
  ffmpegPath?: string
  signal?: AbortSignal
}): Promise<DetectCutPointsResult> {
  // 缺省走原生帧率（rea-video 同口径，见 extractFrameTrack）；显式传 sampleFps 才定档。
  const samples = await extractFrameTrack(options.videoPath, options.sampleFps, options.ffmpegPath, options.signal)
  const boundaries = detectShotBoundaries(samples)
  return {
    switches: boundaries.map((b) => ({ timeSec: Math.round(b.timeSec * 1000) / 1000, magnitude: b.score, kind: b.kind })),
    frameCount: samples.luma.length,
    fps: samples.fps,
  }
}

/**
 * 抽帧取特征。缺省**原生帧率逐帧采样**（rea-video `build_track` 同口径：硬切在原生
 * 帧率下是孤立单帧尖峰，窗口中位数保持低位；降采样会把快速运动的帧间 delta 放大成
 * 伪切点、并把真切点的局部基数抬高 —— B 站真值片实测 6fps 只有 3/10，原生 9/10）。
 * 显式传 `sampleFps` 则按定档抽（冻结帧检测等便宜特征用 6fps）。
 *
 * 原生帧率封顶 `SHOT_MAX_SAMPLE_FPS`（高帧率源降采样，控流器成本上限）；容器 fps
 * 探不到时退回 6fps 定档（旧口径降级）。流式增量处理（FrameTrackBuilder），内存 O(1)。
 */
export async function extractFrameTrack(
  videoPath: string,
  sampleFps?: number,
  ffmpegPath?: string,
  signal?: AbortSignal,
): Promise<FrameTrack> {
  const ffmpeg = resolveFfmpegPath(ffmpegPath)
  const frameBytes = SHOT_THUMB_W * SHOT_THUMB_H * 3
  let vf = `scale=${SHOT_THUMB_W}:${SHOT_THUMB_H}`
  let effectiveFps: number
  if (sampleFps !== undefined) {
    vf = `fps=${sampleFps},${vf}`
    effectiveFps = sampleFps
  } else {
    // `ffmpeg -i` 无输出必然非零退出，元信息在 stderr —— 与 media_probe 同口径。
    const probe = await runFfmpeg(ffmpeg, ['-i', videoPath], FFMPEG_TIMEOUT_MS, signal)
    const containerFps = parseMediaMeta(probe.stderr).fps
    if (containerFps !== undefined && containerFps > 0) {
      effectiveFps = Math.min(containerFps, SHOT_MAX_SAMPLE_FPS)
      if (effectiveFps < containerFps) vf = `fps=${effectiveFps},${vf}`
    } else {
      effectiveFps = SHOT_SAMPLE_FPS
      vf = `fps=${SHOT_SAMPLE_FPS},${vf}`
    }
  }
  return await new Promise<FrameTrack>((resolvePromise, rejectPromise) => {
    const child = spawn(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-i', videoPath,
      '-vf', vf,
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    const builder = new FrameTrackBuilder(frameBytes, effectiveFps)
    let settled = false
    let lastError = ''
    let bytesSeen = 0
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () => {
      child.kill('SIGKILL')
      finish(() => rejectPromise(signal?.reason ?? new DOMException('aborted', 'AbortError')))
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(() => rejectPromise(new Error(`抽帧超时（${Math.round(FFMPEG_TIMEOUT_MS / 1000)}s）`)))
    }, FFMPEG_TIMEOUT_MS)
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on('data', (chunk: Buffer) => {
      bytesSeen += chunk.length
      if (bytesSeen <= MAX_RAW_BYTES) builder.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => { lastError += String(chunk).slice(0, 4000) })
    child.on('error', (cause) => {
      finish(() => rejectPromise(new Error(`ffmpeg 启动失败: ${cause instanceof Error ? cause.message : String(cause)}`)))
    })
    child.on('close', (code) => {
      finish(() => {
        if (code !== 0 && bytesSeen === 0) {
          rejectPromise(new Error(`ffmpeg 抽帧失败（exit ${code}）: ${lastError.trim() || '无 stderr'}`))
          return
        }
        resolvePromise(builder.finish())
      })
    })
  })
}

/** rawvideo 累计上限：原生 30fps 封顶 ≈ 466KB/s，120s ffmpeg 超时内最多约 56MB —— 上限只防异常输入。 */
export const MAX_RAW_BYTES = 256 * 1024 * 1024
