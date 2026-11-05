/**
 * 确定性取证三项（CV-445 S2，rea-video A2 吸收的零视觉库子集）。
 *
 * 为什么：拆解画面目前只有 VLM 文字转述 + 均色距 ——「VLM 说的不能当事实」（本仓
 * viral-remake SKILL 的取证铁律）。本模块给**像素级/字节级事实**，供拆解表第七列
 * 「制作方式」选复刻路径。三项全部零视觉库（D1 默认否决 OpenCV 语义）：
 *
 *   1. **AIGC 元数据扫描** —— 容器 Metadata 与文件头尾字节里找生成器签名（C2PA/JUMBF
 *      框、GB 45438 隐式标识、各家生成器水印标签）。出现时**一票定案**；平台转码常
 *      清除，查一次很便宜。
 *   2. **重复帧 / 原生帧率指纹** —— 24fps 源转 30fps 容器 ≈ 20% 重复帧、周期 5；
 *      原生帧率无重复模式。判「转码过的实拍/素材」vs「生成直出」，正是公众号/抖音
 *      转码样片的失分区（能力对照表 §7 实测：rea-video 靠这条识别出 WeChat transcode）。
 *   3. **冻结帧比例** —— changed < 0.004 连续 ≥0.4s 的帧段：判静帧/代码画面/MG 节拍
 *      （rea-video `_mg_beats` 判据）。
 *
 * **绝不抛错**：取证是拆解的「顺带事实读取」，任何一项拿不到就给 null + note，不阻塞
 * evidence_grid 主路径（与 media-probe 的 CV-188 宽容口径一致）。
 * 纯函数（metadata 解析 / 字节扫描 / 指纹统计）直接单测，IO 在 collectMethodEvidence。
 */
import { spawn } from 'node:child_process'
import { statSync, openSync, readSync, closeSync } from 'node:fs'
import { SHOT_SAMPLE_FPS, extractFrameTrack, buildFrameTrack, SHOT_THUMB_H, SHOT_THUMB_W, type FrameTrack } from './shot-detect.js'
import { parseMediaMeta } from './media-probe.js'
import { FFMPEG_TIMEOUT_MS, resolveFfmpegPath, runFfmpeg } from './ffmpeg-run.js'

// ───────────────── 1. AIGC 元数据 ─────────────────

/** 生成器/C2PA 签名片段（小写匹配；选词避开「luma」这类视频术语通用词防误报）。 */
const AIGC_MARKERS: readonly string[] = [
  'c2pa', 'jumb', 'jumd',
  'minimax', 'hailuo', 'klingai', 'kling', 'sora', 'runway', 'vidu', 'jimeng', 'doubao',
  'seedance', 'pixverse', 'pika', 'lumaai', 'veo', 'krea', 'viggle', 'wanx', 'hunyuan',
  'aigc', 'stablediffusion', 'midjourney', 'gen-3', 'gen-4',
]

/** 一处 AIGC 标记命中。 */
export interface AigcMarker {
  /** 证据来源：ffmpeg 元数据段 / 文件头尾字节。 */
  source: 'metadata' | 'bytes'
  /** 命中的签名片段。 */
  marker: string
  /** 人话上下文（metadata 的 key:value 行 / 字节偏移）。 */
  context: string
}

/**
 * 从 `ffmpeg -i` stderr 的 Metadata 段提 AIGC 标记（纯函数）。
 * 只扫 `key : value` 形态的行（容器级与流级都算），key/value 命中签名片段即记。
 */
export function parseMetadataAigcMarkers(stderr: string): AigcMarker[] {
  const hits: AigcMarker[] = []
  for (const rawLine of stderr.split('\n')) {
    const sep = rawLine.indexOf(':')
    if (sep <= 0) continue
    const key = rawLine.slice(0, sep).trim().toLowerCase()
    if (key === '' || key === 'duration' || /^\d+$/.test(key)) continue
    const value = rawLine.slice(sep + 1).trim()
    const haystack = `${key} ${value}`.toLowerCase()
    for (const marker of AIGC_MARKERS) {
      if (haystack.includes(marker)) {
        hits.push({ source: 'metadata', marker, context: rawLine.trim().slice(0, 200) })
        break
      }
    }
  }
  return hits
}

/**
 * 文件头尾字节扫描（纯函数）：mp4 的 ilst/udta 与 C2PA JUMBF 框常落在头或尾，
 * 各读 2MB 足够；ASCII / UTF-16LE / UTF-16BE 三种编码形态都搜（Buffer.indexOf 字节级）。
 */
export function scanBinaryAigcMarkers(head: Buffer, tail: Buffer): AigcMarker[] {
  const hits: AigcMarker[] = []
  const regions: { name: string; bytes: Buffer }[] = [
    { name: 'head', bytes: head },
    { name: 'tail', bytes: tail },
  ]
  for (const region of regions) {
    for (const marker of AIGC_MARKERS) {
      const asciiAt = region.bytes.indexOf(Buffer.from(marker, 'latin1'))
      if (asciiAt >= 0) {
        hits.push({ source: 'bytes', marker, context: `${region.name}+${asciiAt} (${marker})` })
        continue
      }
      const utf16leAt = region.bytes.indexOf(Buffer.from(marker, 'utf16le'))
      if (utf16leAt >= 0) {
        hits.push({ source: 'bytes', marker, context: `${region.name}+utf16le(${utf16leAt}) (${marker})` })
        continue
      }
      const utf16beAt = region.bytes.indexOf(utf16beBytes(marker))
      if (utf16beAt >= 0) {
        hits.push({ source: 'bytes', marker, context: `${region.name}+utf16be(${utf16beAt}) (${marker})` })
      }
    }
  }
  return hits
}

/** UTF-16BE 字节形态（Node 无 'utf16be' 编码名 —— LE 字节两两交换；奇数长度尾字节不动）。 */
function utf16beBytes(marker: string): Buffer {
  const le = Buffer.from(marker, 'utf16le')
  const be = Buffer.from(le)
  for (let i = 0; i + 1 < be.length; i += 2) {
    const tmp = be[i]
    be[i] = be[i + 1] ?? 0
    be[i + 1] = tmp ?? 0
  }
  return be
}

function readHeadTail(path: string, bytes = 2 * 1024 * 1024): { head: Buffer; tail: Buffer } | null {
  try {
    const stat = statSync(path)
    if (!stat.isFile() || stat.size === 0) return null
    const fd = openSync(path, 'r')
    try {
      const headSize = Math.min(bytes, stat.size)
      const head = Buffer.alloc(headSize)
      readSync(fd, head, 0, headSize, 0)
      const tailSize = Math.min(bytes, Math.max(0, stat.size - headSize))
      const tail = Buffer.alloc(tailSize)
      if (tailSize > 0) readSync(fd, tail, 0, tailSize, stat.size - tailSize)
      return { head, tail }
    } finally {
      closeSync(fd)
    }
  } catch {
    return null
  }
}

// ───────────────── 2. 帧率指纹 ─────────────────

/** 常见源帧率（吸附目标）。 */
const COMMON_FPS: readonly number[] = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60]

export interface FrameRateFingerprint {
  /** 容器声明 fps（ffmpeg -i 视频流行）；未探到为 null。 */
  containerFps: number | null
  /** 抽样段实测帧率（showinfo pts 中位差倒数）；未测到为 null。 */
  sampledRealFps: number | null
  /** 重复帧占比（changed==0 的帧 / 非首帧）；不可判为 null。 */
  duplicateRatio: number | null
  /** 相邻重复帧间距的中位数（帧数）。 */
  medianGapFrames: number | null
  /** 按 containerFps×(1−dupRatio) 吸附到常见源帧率；不可判为 null。 */
  inferredSourceFps: number | null
  /** 人话结论（进拆解便签）。 */
  verdict: string
}

/**
 * 重复帧 / 原生帧率指纹（纯函数，吃**原生帧率**抽样的 FrameTrack）。
 *
 * 判据：changed==0 的帧占比与相邻重复帧间距周期。24fps 源 → 30fps 容器 ≈ 20% 重复、
 * 周期 5。**画面近乎静止时指纹不可判**（静止片全帧 changed==0 是内容不是转码），
 * 需运动帧占比 ≥0.1 才下结论。
 */
export function analyzeFrameRateFingerprint(samples: FrameTrack): FrameRateFingerprint {
  const n = samples.changed.length
  const base: FrameRateFingerprint = {
    containerFps: null,
    sampledRealFps: null,
    duplicateRatio: null,
    medianGapFrames: null,
    inferredSourceFps: null,
    verdict: '帧率指纹未测（抽样不足）',
  }
  if (n < 8) return base
  const dupIndexes: number[] = []
  let movingFrames = 0
  for (let i = 1; i < n; i += 1) {
    const changed = samples.changed[i] ?? 0
    if (changed === 0) dupIndexes.push(i)
    if (changed > 0.01) movingFrames += 1
  }
  const motionRatio = movingFrames / (n - 1)
  const duplicateRatio = dupIndexes.length / (n - 1)
  const gaps: number[] = []
  for (let k = 1; k < dupIndexes.length; k += 1) {
    const gap = (dupIndexes[k] ?? 0) - (dupIndexes[k - 1] ?? 0)
    if (gap > 0) gaps.push(gap)
  }
  const medianGap = medianOf(gaps)
  const result: FrameRateFingerprint = {
    ...base,
    duplicateRatio: Math.round(duplicateRatio * 1000) / 1000,
    medianGapFrames: medianGap,
  }
  if (motionRatio < 0.1) {
    return {
      ...result,
      duplicateRatio: null,
      medianGapFrames: null,
      inferredSourceFps: null,
      verdict: `画面近乎静止（运动帧占比 ${(motionRatio * 100).toFixed(0)}%）—— 指纹不可判，改看冻结帧结论`,
    }
  }
  if (duplicateRatio < 0.02) {
    return { ...result, verdict: '无重复帧模式 —— 原生帧率直出（生成视频或原生高清实拍）' }
  }
  if (duplicateRatio >= 0.08 && medianGap !== null && medianGap >= 2) {
    return {
      ...result,
      verdict: `检出转码重复帧模式（重复 ${Math.round(duplicateRatio * 100)}%、周期 ≈${medianGap} 帧）—— 疑似低帧率源转码（平台二压的实拍/素材常见）`,
    }
  }
  return { ...result, verdict: `弱重复模式（${Math.round(duplicateRatio * 100)}%）—— 证据不足，不下结论` }
}

/** 按 containerFps×(1−dupRatio) 吸附常见源帧率（±1fps 容差，吸不上为 null）。 */
export function inferSourceFps(containerFps: number, duplicateRatio: number): number | null {
  const candidate = containerFps * (1 - duplicateRatio)
  let best: number | null = null
  let bestDelta = Number.POSITIVE_INFINITY
  for (const fps of COMMON_FPS) {
    const delta = Math.abs(fps - candidate)
    if (delta < bestDelta) {
      bestDelta = delta
      best = fps
    }
  }
  return best !== null && bestDelta <= 1.0 ? best : null
}

function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const upper = sorted[mid] ?? 0
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] ?? upper) + upper) / 2
}

// ───────────────── 3. 冻结帧 ─────────────────

export interface FrozenRun {
  startSec: number
  endSec: number
}

export interface FrozenFramesResult {
  /** 冻结帧占比（处于冻结段内的帧 / 全部帧）。 */
  frozenRatio: number
  /** 最长冻结段（秒）。 */
  longestFreezeSec: number
  /** 冻结段清单（时长 ≥0.4s）。 */
  runs: FrozenRun[]
}

/**
 * 冻结帧检测（纯函数，吃 6fps 全片轨迹）：changed < 0.004 连续 ≥0.4s 记一段
 * （rea-video `_mg_beats` 判据）。静帧卡点 / 代码画面的定格段会被点名。
 */
export function analyzeFrozenFrames(samples: FrameTrack): FrozenFramesResult {
  const fps = samples.fps
  const n = samples.changed.length
  const minRun = Math.max(3, Math.round(0.4 * fps))
  const runs: FrozenRun[] = []
  let i = 0
  let frozenFrames = 0
  while (i < n) {
    if ((samples.changed[i] ?? 1) < 0.004) {
      let j = i
      while (j < n && (samples.changed[j] ?? 1) < 0.004) j += 1
      if (j - i >= minRun) {
        runs.push({ startSec: Math.round((i / fps) * 100) / 100, endSec: Math.round((j / fps) * 100) / 100 })
        frozenFrames += j - i
      }
      i = j
    } else {
      i += 1
    }
  }
  let longest = 0
  for (const run of runs) longest = Math.max(longest, run.endSec - run.startSec)
  return {
    frozenRatio: n > 0 ? Math.round((frozenFrames / n) * 1000) / 1000 : 0,
    longestFreezeSec: Math.round(longest * 100) / 100,
    runs,
  }
}

// ───────────────── 汇总入口 ─────────────────

/** 取证汇总（三项字段都可能因「拿不到」而为 null —— 绝不抛错）。 */
export interface MethodEvidence {
  aigc: {
    found: boolean
    markers: AigcMarker[]
    note: string
  }
  frameRate: FrameRateFingerprint & { note?: string }
  frozen: FrozenFramesResult & { note?: string }
}

/** 原生帧率抽样的默认窗口（秒）—— 只取头部 20s，控解码成本。 */
export const NATIVE_SAMPLE_SEC = 20

/**
 * 取证汇总入口：metadata 扫描 + 头尾字节扫描 + 原生帧率抽样（≤20s）+（可选）全片
 * 6fps 轨迹复用。三个 IO 子步各自 try/catch，互不拖垮。
 */
export async function collectMethodEvidence(options: {
  videoPath: string
  ffmpegPath?: string
  signal?: AbortSignal
  /** evidence-grid 已抽好的全片 6fps 轨迹（复用，免二次解码）；缺省现抽。 */
  fullTrack?: FrameTrack
  /** 测试注入：原生抽样秒数。 */
  nativeSampleSec?: number
}): Promise<MethodEvidence> {
  const { videoPath } = options
  const ffmpegPath = safeResolve(options.ffmpegPath)

  // ① AIGC：metadata + 头尾字节
  let markers: AigcMarker[] = []
  let aigcNote = ''
  try {
    if (ffmpegPath !== null) {
      const probe = await runFfmpeg(ffmpegPath, ['-i', videoPath], FFMPEG_TIMEOUT_MS, options.signal)
      markers = parseMetadataAigcMarkers(probe.stderr)
    } else {
      aigcNote = 'ffmpeg 不可用，metadata 扫描跳过；'
    }
  } catch {
    aigcNote += 'metadata 扫描失败；'
  }
  try {
    const headTail = readHeadTail(videoPath)
    if (headTail !== null) {
      markers = [...markers, ...scanBinaryAigcMarkers(headTail.head, headTail.tail)]
    } else {
      aigcNote += '字节扫描不可读；'
    }
  } catch {
    aigcNote += '字节扫描失败；'
  }

  // ② 帧率指纹：原生帧率抽头部 ≤20s（showinfo 记 pts → 实测帧率）
  let fingerprint: FrameRateFingerprint = {
    containerFps: null, sampledRealFps: null, duplicateRatio: null,
    medianGapFrames: null, inferredSourceFps: null,
    verdict: '帧率指纹未测',
  }
  try {
    if (ffmpegPath !== null) {
      fingerprint = await sampleFpsFingerprint(videoPath, ffmpegPath, options.nativeSampleSec ?? NATIVE_SAMPLE_SEC, options.signal)
    } else {
      fingerprint = { ...fingerprint, verdict: '帧率指纹未测（ffmpeg 不可用）' }
    }
  } catch {
    fingerprint = { ...fingerprint, verdict: '帧率指纹未测（抽样失败）' }
  }

  // ③ 冻结帧：复用全片 6fps 轨迹（没有就现抽）
  let frozen: FrozenFramesResult & { note?: string } = { frozenRatio: 0, longestFreezeSec: 0, runs: [] }
  try {
    const track = options.fullTrack ?? await extractFrameTrack(videoPath, SHOT_SAMPLE_FPS, ffmpegPath ?? undefined, options.signal)
    frozen = analyzeFrozenFrames(track)
  } catch {
    frozen = { frozenRatio: 0, longestFreezeSec: 0, runs: [], note: '冻结帧未测（抽帧失败）' }
  }

  return {
    aigc: {
      found: markers.length > 0,
      markers,
      note: markers.length > 0
        ? '出现生成器/C2PA 标记 —— 制作方式一票定案（但平台转码可能只留残迹，判定写「标记指认」）'
        : `未发现 AIGC 标记（${aigcNote === '' ? '不代表不是 AI 生成：多数平台会清除' : aigcNote.trim()}）`,
    },
    frameRate: fingerprint,
    frozen,
  }
}

// ───────────────── IO 子步 ─────────────────

function safeResolve(explicit?: string): string | null {
  try {
    return resolveFfmpegPath(explicit)
  } catch {
    return null
  }
}

async function sampleFpsFingerprint(
  videoPath: string,
  ffmpegPath: string,
  sampleSec: number,
  signal?: AbortSignal,
): Promise<FrameRateFingerprint> {
  // 先探容器 fps（parseMediaMeta 与 media-probe 同一份解析，不复制）
  const probe = await runFfmpeg(ffmpegPath, ['-i', videoPath], FFMPEG_TIMEOUT_MS, signal)
  const meta = parseMediaMeta(probe.stderr)
  const containerFps = meta.fps ?? null

  // 原生帧率抽头部 sampleSec：不用 fps 滤镜（保留容器真实帧序），showinfo 记 pts。
  // stdout 是 rawvideo 二进制 —— runFfmpeg 收 string 会毁字节，这里本地 spawn 收 Buffer。
  const { raw, stderr } = await spawnBinaryFfmpeg(ffmpegPath, [
    '-hide_banner', '-loglevel', 'info',
    '-t', String(sampleSec),
    '-i', videoPath,
    '-vf', `scale=${SHOT_THUMB_W}:${SHOT_THUMB_H},showinfo`,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
  ], signal)
  const times = parseShowinfoPts(stderr)
  if (times.length < 8) {
    return {
      containerFps, sampledRealFps: null, duplicateRatio: null,
      medianGapFrames: null, inferredSourceFps: null,
      verdict: '帧率指纹未测（抽样帧不足）',
    }
  }
  const deltas: number[] = []
  for (let i = 1; i < times.length; i += 1) {
    const delta = (times[i] ?? 0) - (times[i - 1] ?? 0)
    if (delta > 0) deltas.push(delta)
  }
  const medianDelta = medianOf(deltas)
  const sampledRealFps = medianDelta !== null && medianDelta > 0 ? Math.round((1 / medianDelta) * 1000) / 1000 : null

  const frameBytes = SHOT_THUMB_W * SHOT_THUMB_H * 3
  const track = buildFrameTrack(raw, frameBytes, sampledRealFps ?? containerFps ?? 30)
  const result = analyzeFrameRateFingerprint(track)
  const inferred = containerFps !== null && result.duplicateRatio !== null
    ? inferSourceFps(containerFps, result.duplicateRatio)
    : null
  return {
    ...result,
    containerFps,
    sampledRealFps,
    inferredSourceFps: inferred,
    verdict: inferred !== null
      ? `${result.verdict}；按容器 ${containerFps}fps 推算源 ≈${inferred}fps`
      : result.verdict,
  }
}

/** 二进制 stdout 的 ffmpeg 单次调用（rawvideo 专用；超时/中断语义与 runFfmpeg 一致）。 */
function spawnBinaryFfmpeg(ffmpegPath: string, args: readonly string[], signal?: AbortSignal): Promise<{ raw: Buffer; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    let total = 0
    let stderr = ''
    let settled = false
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
      finish(() => rejectPromise(new Error(`ffmpeg 执行超时（${Math.round(FFMPEG_TIMEOUT_MS / 1000)}s）`)))
    }, FFMPEG_TIMEOUT_MS)
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total <= MAX_FINGERPRINT_BYTES) chunks.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 1024 * 1024) stderr += String(chunk)
    })
    child.on('error', (cause) => {
      finish(() => rejectPromise(new Error(`ffmpeg 启动失败: ${cause instanceof Error ? cause.message : String(cause)}`)))
    })
    child.on('close', (code) => {
      finish(() => {
        if (code !== 0 && chunks.length === 0) {
          rejectPromise(new Error(`ffmpeg 抽帧失败（exit ${code}）`))
          return
        }
        resolvePromise({ raw: Buffer.concat(chunks), stderr })
      })
    })
  })
}

/** 原生抽样字节上限：60fps×20s×15.5KB ≈ 19MB，上限只防异常输入。 */
export const MAX_FINGERPRINT_BYTES = 256 * 1024 * 1024

/** showinfo pts_time 解析（与 evidence-grid 的 parseShowinfoTimes 同形态，独立小函数避免跨模块耦合）。 */
export function parseShowinfoPts(stderr: string): number[] {
  const times: number[] = []
  for (const match of stderr.matchAll(/pts_time:(\d+(?:\.\d+)?)/gu)) {
    const value = Number(match[1])
    if (Number.isFinite(value)) times.push(value)
  }
  return times
}
