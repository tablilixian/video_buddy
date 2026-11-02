/**
 * 拆解回核（B3，REQ-036 复刻提效批三）—— 用机器实测核对爆款拆解表的段落边界。
 *
 * 背景：甜品复刻会话 v2 的拆解表自标 verified，实际归段错了（把参考片静帧相误拆成
 * 独立开场、页序漂移 0.5–1s 无人发现）。verified 是自评不是证据 —— 本模块把「拆解表
 * 的边界时刻」与「参考视频的真实画面切换点」做机器比对，作为拆解落表 stop-and-confirm
 * 的人工确认证据。
 *
 * 算法（刻意朴素，不引入视觉库）：
 *   ffmpeg 低帧率抽帧（缺省 2fps）缩到 16×16 rgb24 → 逐帧平均色 → 相邻帧色距信号
 *   → 突变峰提取（阈值 = max(绝对下限, 中位数×倍数)，局部最大合并）→ 与拆解表每段
 *   起点做 ±tolerance 秒贪心最近匹配。
 *
 * 结果三态：matched（报实测切换时刻与偏差）/ unmatched（窗口内无切换 —— 边界可疑）/
 * extraSwitches（实测有切换但表里没有 —— 漏段候选）。ok = 全部 matched 且无 extra。
 *
 * 纯函数（信号→峰→匹配）与 ffmpeg IO 分离：纯函数直接单测，IO 走真 ffmpeg E2E。
 */
import { spawn } from 'node:child_process'
import { throwError } from './error-system.js'
import { resolveFfmpegPath, FFMPEG_TIMEOUT_MS } from './ffmpeg-run.js'

/** 拆解表的一段（与 viral-remake 拆解表的一镜同构）。 */
export interface TeardownSegment {
  /** 段名/镜序说明（仅用于结果回读定位）。 */
  label: string
  /** 起始秒（拆解表口径，0.1s 精度）。 */
  startSec: number
  /** 结束秒。 */
  endSec: number
}

/** 一个实测画面切换点。 */
export interface TeardownSwitchPoint {
  /** 切换时刻（秒，抽帧精度 = 1/sampleFps）。 */
  timeSec: number
  /** 该帧与前一帧的平均色距（0–441 欧氏）。 */
  magnitude: number
}

/** 单个表边界的核对结论。 */
export interface TeardownBoundaryMatch {
  /** 段名（来自拆解表）。 */
  label: string
  /** 拆解表声明的边界时刻 = 该段 startSec（首段不核 —— 开场没有「入点」）。 */
  tableSec: number
  status: 'matched' | 'unmatched'
  /** 实测切换时刻（matched 时有值）。 */
  measuredSec?: number
  /** 实测 − 声明（秒，正 = 片子比表晚切）。 */
  deltaSec?: number
}

export interface TeardownVerifyResult {
  /** 实际抽样帧率。 */
  sampleFps: number
  /** 抽到的帧数。 */
  frameCount: number
  /** 视频覆盖时长（frameCount / sampleFps，秒）。 */
  coveredSec: number
  boundaries: TeardownBoundaryMatch[]
  /** 实测存在、但没有任何表边界认领的切换点（漏段/漏镜候选）。 */
  extraSwitches: TeardownSwitchPoint[]
  /** 全部边界 matched 且无 extraSwitches。 */
  ok: boolean
}

/** 每帧平均色。 */
export interface FrameColor {
  r: number
  g: number
  b: number
}

/**
 * 从 rawvideo 字节流逐帧求平均色。`frameBytes` = 宽×高×3（rgb24）；
 * 末尾不足一帧的字节忽略（ffmpeg 偶尔多吐半个帧）。
 */
export function frameMeanColors(raw: Uint8Array, frameBytes: number): FrameColor[] {
  if (frameBytes <= 0 || frameBytes % 3 !== 0) return []
  const frames: FrameColor[] = []
  for (let offset = 0; offset + frameBytes <= raw.length; offset += frameBytes) {
    let r = 0
    let g = 0
    let b = 0
    const pixels = frameBytes / 3
    for (let i = 0; i < frameBytes; i += 3) {
      r += raw[offset + i] ?? 0
      g += raw[offset + i + 1] ?? 0
      b += raw[offset + i + 2] ?? 0
    }
    frames.push({ r: r / pixels, g: g / pixels, b: b / pixels })
  }
  return frames
}

/** 相邻帧平均色距（欧氏，0–441）。首帧无前驱，从第 2 帧起。 */
export function colorDistances(colors: readonly FrameColor[]): number[] {
  const distances: number[] = []
  for (let i = 1; i < colors.length; i += 1) {
    const a = colors[i - 1]
    const b = colors[i]
    if (a === undefined || b === undefined) continue
    distances.push(Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2))
  }
  return distances
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const upper = sorted[mid]
  if (upper === undefined) return 0
  if (sorted.length % 2 === 1) return upper
  return ((sorted[mid - 1] ?? upper) + upper) / 2
}

export interface SwitchPointOptions {
  /** 绝对下限：色距低于它的抖动（压缩噪点/轻推运镜）一律不算切换。缺省 30。 */
  minMagnitude?: number
  /** 相对阈值倍数：色距需 ≥ 中位数 × 倍数。缺省 4。 */
  medianMultiplier?: number
  /** 相邻峰合并窗口（秒）：窗口内的连续高距帧只留最大者。缺省 0.75。 */
  mergeWindowSec?: number
}

/**
 * 从色距信号提取画面切换点。`distances[i]` 对应时刻 `(i + 1) / sampleFps`
 * （distance[0] 是第 2 帧对第 1 帧）。
 */
export function findSwitchPoints(
  distances: readonly number[],
  sampleFps: number,
  options: SwitchPointOptions = {},
): TeardownSwitchPoint[] {
  const minMagnitude = options.minMagnitude ?? 30
  const medianMultiplier = options.medianMultiplier ?? 4
  const mergeWindowSec = options.mergeWindowSec ?? 0.75
  if (distances.length === 0 || sampleFps <= 0) return []
  const threshold = Math.max(minMagnitude, median(distances) * medianMultiplier)
  // 候选 = 超阈值帧；合并 mergeWindow 内的连续候选（切镜渐变会连着几帧都高）。
  const candidates: TeardownSwitchPoint[] = []
  for (let i = 0; i < distances.length; i += 1) {
    const value = distances[i]
    if (value === undefined || value < threshold) continue
    candidates.push({ timeSec: (i + 1) / sampleFps, magnitude: value })
  }
  const merged: TeardownSwitchPoint[] = []
  for (const point of candidates) {
    const last = merged[merged.length - 1]
    if (last !== undefined && point.timeSec - last.timeSec <= mergeWindowSec) {
      if (point.magnitude > last.magnitude) merged[merged.length - 1] = point
      continue
    }
    merged.push(point)
  }
  return merged
}

export interface MatchOptions {
  /** 匹配窗口（秒）：表边界 ± 窗口内的最近未认领切换点。缺省 1.0。 */
  toleranceSec?: number
}

/**
 * 拆解表边界 ↔ 实测切换点贪心最近匹配。
 *
 * 只核每段 **startSec**（首段是开场没有入点，跳过）；endSec 与下一段 startSec
 * 是同一时刻，核两遍只会重复报同一处。匹配是贪心最近且一处切换只认领一次
 * （两段表错位到同一切换附近时，近者得）。
 */
export function matchBoundaries(
  segments: readonly TeardownSegment[],
  switches: readonly TeardownSwitchPoint[],
  options: MatchOptions = {},
): { boundaries: TeardownBoundaryMatch[]; extraSwitches: TeardownSwitchPoint[] } {
  const toleranceSec = options.toleranceSec ?? 1.0
  const claimed = new Set<number>()
  const boundaries: TeardownBoundaryMatch[] = []
  for (let i = 1; i < segments.length; i += 1) {
    const segment = segments[i]
    if (segment === undefined) continue
    let bestIndex = -1
    let bestDelta = Number.POSITIVE_INFINITY
    for (let j = 0; j < switches.length; j += 1) {
      if (claimed.has(j)) continue
      const point = switches[j]
      if (point === undefined) continue
      const delta = Math.abs(point.timeSec - segment.startSec)
      if (delta < bestDelta) {
        bestDelta = delta
        bestIndex = j
      }
    }
    if (bestIndex >= 0 && bestDelta <= toleranceSec) {
      const point = switches[bestIndex]
      if (point === undefined) {
        boundaries.push({ label: segment.label, tableSec: segment.startSec, status: 'unmatched' })
        continue
      }
      claimed.add(bestIndex)
      boundaries.push({
        label: segment.label,
        tableSec: segment.startSec,
        status: 'matched',
        measuredSec: point.timeSec,
        deltaSec: point.timeSec - segment.startSec,
      })
    } else {
      boundaries.push({ label: segment.label, tableSec: segment.startSec, status: 'unmatched' })
    }
  }
  const extraSwitches = switches.filter((_, j) => !claimed.has(j))
  return { boundaries, extraSwitches }
}

/** 抽帧常量：2fps 足够定位 0.5s 级边界；16×16 均色对整页换色灵敏度足够。 */
export const TEARDOWN_SAMPLE_FPS = 2
export const TEARDOWN_GRID = 16

/**
 * 抽帧取色：`ffmpeg -i video -vf fps=N,scale=16:16 -f rawvideo -pix_fmt rgb24 -`，
 * stdout 收二进制。返回逐帧平均色序列（IO 与纯函数的唯一接缝）。
 */
export async function extractFrameColors(
  videoPath: string,
  sampleFps = TEARDOWN_SAMPLE_FPS,
  ffmpegPath?: string,
  signal?: AbortSignal,
): Promise<FrameColor[]> {
  const ffmpeg = resolveFfmpegPath(ffmpegPath)
  const frameBytes = TEARDOWN_GRID * TEARDOWN_GRID * 3
  const raw = await new Promise<Buffer>((resolvePromise, rejectPromise) => {
    const child = spawn(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-i', videoPath,
      '-vf', `fps=${sampleFps},scale=${TEARDOWN_GRID}:${TEARDOWN_GRID}`,
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    let lastError = ''
    const MAX_BYTES = 64 * 1024 * 1024 // 2fps × 768B ≈ 1.5KB/s，上限只防异常输入
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
      total += chunk.length
      if (total <= MAX_BYTES) chunks.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => { lastError += String(chunk).slice(0, 4000) })
    child.on('error', (cause) => {
      finish(() => rejectPromise(new Error(`ffmpeg 启动失败: ${cause instanceof Error ? cause.message : String(cause)}`)))
    })
    child.on('close', (code) => {
      finish(() => {
        if (code !== 0 && chunks.length === 0) {
          rejectPromise(new Error(`ffmpeg 抽帧失败（exit ${code}）: ${lastError.trim() || '无 stderr'}`))
          return
        }
        resolvePromise(Buffer.concat(chunks))
      })
    })
  })
  return frameMeanColors(raw, frameBytes)
}

/**
 * 回核入口：参考视频 + 拆解表 → 边界三态结论 + 漏段候选。
 * 抛错只发生在「根本没法核」（ffmpeg 不可用 / 视频读不出帧 / 表结构非法）；
 * 核得上但对不齐不算错，走结果对象（ok=false + 逐边界 status）。
 */
export async function verifyTeardown(options: {
  videoPath: string
  segments: readonly TeardownSegment[]
  sampleFps?: number
  toleranceSec?: number
  ffmpegPath?: string
  signal?: AbortSignal
}): Promise<TeardownVerifyResult> {
  const { videoPath, segments } = options
  if (segments.length < 2) {
    throwError('CS-USER-ERR', { message: '拆解表至少要 2 段才有可核的边界（首段开场不入点）。', detail: 'teardown segments < 2' })
  }
  for (const segment of segments) {
    if (!Number.isFinite(segment.startSec) || !Number.isFinite(segment.endSec)
      || segment.endSec <= segment.startSec) {
      throwError('CS-USER-ERR', { message: `拆解表段「${segment.label}」起止非法（${segment.startSec}–${segment.endSec}）。`, detail: 'invalid segment range' })
    }
  }
  const sampleFps = options.sampleFps ?? TEARDOWN_SAMPLE_FPS
  const colors = await extractFrameColors(videoPath, sampleFps, options.ffmpegPath, options.signal)
  if (colors.length < 4) {
    throwError('CS-USER-ERR', { message: `视频抽帧不足（${colors.length} 帧，抽样 ${sampleFps}fps）—— 文件损坏或不是视频。`, detail: 'insufficient frames' })
  }
  const switches = findSwitchPoints(colorDistances(colors), sampleFps)
  const { boundaries, extraSwitches } = matchBoundaries(segments, switches, options.toleranceSec !== undefined ? { toleranceSec: options.toleranceSec } : {})
  return {
    sampleFps,
    frameCount: colors.length,
    coveredSec: colors.length / sampleFps,
    boundaries,
    extraSwitches,
    ok: boundaries.every((b) => b.status === 'matched') && extraSwitches.length === 0,
  }
}
