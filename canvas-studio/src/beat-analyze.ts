/**
 * S5（2026-10-28 · CV-040 收口）：本地节拍分析 —— 从「能配乐」到「能对拍」。
 *
 * 实现（零新依赖，内置 ffmpeg 6.0 已验证可用）：
 * 1. **响度包络**：`astats=metadata=1:reset=1,ametadata=print` 逐窗口 RMS（stdout 机器可读）；
 * 2. **BPM 估测**：半波整流差分（onset 强度）→ 自相关，在 50–200 BPM 的周期带里找峰（20ms 网格，滞后分辨率 ±0.5 格）；
 *    八度歧义按「落回 70–180 BPM」的先验折回；
 * 3. **拍点定位**：给定周期 P，枚举相位 φ 取 onset 强度和最大的网格 `φ + kP`；
 * 4. **confidence**（D-05）：自相关峰显著度映射到 0–1 —— 低置信时 skill 禁用卡点
 *    （`music-prompt-writing/references/beat-editing.md`），beats 只作参考信息；
 * 5. **LUFS**：`ebur128` Summary 的 Integrated loudness（测量回填，不做母带 —— §7 边界）。
 *
 * 卡点吸附（`snapCutsToBeats`）与歌词启发式对齐（`heuristicLyrics`）也在本文件：
 * 它们是同一个数据面（beats / 包络）上的纯变换。IO 只在 `analyzeBeatsFromFile`。
 */

/** RMS 包络点（db = RMS_level，静音窗口为 -120 哨兵值）。 */
export interface LoudnessPoint {
  t: number
  db: number
}

/** 节拍分析结果（落音频节点 `beats` 字段；即计划所称 beats.json 的载体）。 */
export interface BeatAnalysis {
  /** 60 / 相邻拍间隔中位数（估测 BPM）。 */
  bpm: number
  /** 拍点（秒，升序，网格 `offsetSec + k·periodSec`）。 */
  beats: number[]
  /** 0–1；低于 0.5 = 低置信 → 卡点路径禁用（D-05）。 */
  confidence: number
  /** ebur128 Integrated loudness（测量值；探测失败缺省）。 */
  lufs?: number
  /** 分析方法标记（诚实回显用）。 */
  method: 'onset-autocorrelation'
  /** 分析期说明（低置信原因 / 降级说明）。 */
  notes: string[]
}

/** 歌词时间轴一行（`lyrics` 节点字段；入口②启发式对齐必须标 estimated）。 */
export interface LyricLine {
  line: string
  startSec: number
  endSec: number
  source: 'specified' | 'estimated'
}

/** 分析输入参数（影响自相关搜索带与置信度口径）。 */
export interface BeatAnalyzeOptions {
  /** BPM 搜索带（缺省 50–200）。 */
  minBpm?: number
  maxBpm?: number
  /** 采样网格（秒；缺省 0.05 = 50ms）。 */
  gridSec?: number
}

/** 包络 → 均匀网格（线性插值；静音 -120 参与，不丢点）。 */
export function resampleEnvelope(points: readonly LoudnessPoint[], gridSec = 0.005): number[] {
  if (points.length === 0) return []
  const grid: number[] = []
  const t0 = points[0]!.t
  const tEnd = points[points.length - 1]!.t
  let cursor = 0
  for (let t = t0; t <= tEnd + 1e-9; t += gridSec) {
    while (cursor < points.length - 2 && points[cursor + 1]!.t < t) cursor += 1
    const a = points[cursor]!
    const b = points[Math.min(cursor + 1, points.length - 1)]!
    const span = b.t - a.t
    const ratio = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0
    grid.push(a.db + (b.db - a.db) * ratio)
  }
  return grid
}

/**
 * BPM 估测 + 拍点定位 + 置信度（纯函数，G2 与单测共用同一实现）。
 *
 * 自相关在 [minBpm, maxBpm] 对应的周期带内找峰；八度歧义（测出 250 BPM）按
 * 「折回 70–180」先验减半/加倍。拍点 = onset 强度和最大的相位网格。
 */

/** 浮点时间 → onset 网格值（最近点；越界 0）。 */
function onsetAt(onset: readonly number[], t: number, gridSec: number): number {
  const index = Math.round(t / gridSec)
  return index >= 0 && index < onset.length ? onset[index]! : 0
}

/** 网格长度 → 时长（秒）。 */
function durationOf(n: number, gridSec: number): number {
  return n * gridSec
}

export function estimateBpm(
  envelope: readonly number[],
  { minBpm = 50, maxBpm = 200, gridSec = 0.005 }: BeatAnalyzeOptions = {},
): { bpm: number; periodSec: number; offsetSec: number; beats: number[]; confidence: number } {
  const n = envelope.length
  if (n < 20) return { bpm: 0, periodSec: 0, offsetSec: 0, beats: [], confidence: 0 }
  // onset 强度：半波整流差分（能量上升沿 = 潜在拍点），归一化。
  const onset = new Array<number>(n).fill(0)
  let onsetMax = 0
  for (let i = 1; i < n; i += 1) {
    const rise = Math.max(0, envelope[i]! - envelope[i - 1]!)
    onset[i] = rise
    if (rise > onsetMax) onsetMax = rise
  }
  if (onsetMax <= 0) return { bpm: 0, periodSec: 0, offsetSec: 0, beats: [], confidence: 0 }
  for (let i = 0; i < n; i += 1) onset[i] = onset[i]! / onsetMax

  const minLag = Math.max(2, Math.floor((60 / maxBpm) / gridSec))
  const maxLag = Math.min(Math.floor(n / 2), Math.ceil((60 / minBpm) / gridSec))
  let bestOffset = 0
  const scores: number[] = []
  let bestScore = 0
  let meanCorr = 0
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0
    let samples = 0
    for (let i = lag; i < n; i += 1) {
      sum += onset[i]! * onset[i - lag]!
      samples += 1
    }
    const score = samples > 0 ? sum / samples : 0
    scores.push(score)
    meanCorr += score
    if (score > bestScore) bestScore = score
  }
  const count = scores.length
  if (count > 0) meanCorr /= count
  // 基频优先：准周期脉冲的自相关在 2×/3× 周期处同样出峰（细格下甚至更高 —— 累积
  // 漂移更小）。取「≥0.9×峰值的最小滞后」作为基音候选，再抛物线细化。
  let bestLag = 0
  for (let index = 0; index < count; index += 1) {
    if (scores[index]! >= bestScore * 0.9) {
      bestLag = minLag + index
      break
    }
  }
  if (bestLag === 0 || bestScore <= 0) {
    return { bpm: 0, periodSec: 0, offsetSec: 0, beats: [], confidence: 0 }
  }
  bestScore = scores[bestLag - minLag]!
  if (bestLag === 0 || bestScore <= 0) {
    return { bpm: 0, periodSec: 0, offsetSec: 0, beats: [], confidence: 0 }
  }
  const durationSec = durationOf(n, gridSec)
  // 八度折回到 70–180 先验带（候选含 ±1 个八度，下一步用梳状评分裁决基频）。
  let periodSec0 = bestLag * gridSec
  const bpmOf = (period: number) => 60 / period
  while (bpmOf(periodSec0) > 180 && periodSec0 * 2 <= durationSec / 2) periodSec0 *= 2
  while (bpmOf(periodSec0) < 70 && periodSec0 / 2 >= minLag * gridSec) periodSec0 /= 2

  // 梳状精修：自相关在细格上会被「准周期抖动偏爱 2× 周期（累积漂移更小）」与
  // 「±1 格量化」双重扭曲 —— 梳状评分直接度量「每拍都踩在 onset 上」的平均强度，
  // 基频（每拍都命中）天然胜过 2× 周期（隔拍命中，平均分减半）。
  const combScore = (period: number, phase: number): number => {
    let sum = 0
    let hits = 0
    for (let t = phase; t <= durationSec + 1e-9; t += period) {
      sum += onsetAt(onset, t, gridSec)
      hits += 1
    }
    return hits > 0 ? sum / hits : 0
  }
  const candidates = [periodSec0, periodSec0 / 2, periodSec0 * 2].filter((period) => bpmOf(period) >= minBpm && bpmOf(period) <= maxBpm)
  const scored: Array<{ period: number; phase: number; score: number }> = []
  for (const candidate of candidates) {
    // 全网格扫描：周期 ±5%（1ms 步）× 相位 [0, P)（半格步）。坐标上升在此会掉进
    // 「P 的最优 φ ≠ φ 的最优 P」的局部最优（90 BPM 档实测）；2D 网格 ~400k 次内积
    // 采样，成本可忽略，且对 (P, φ) 联合全局最优有保证。
    let refined = candidate
    let finalPhase = 0
    let finalScore = -Infinity
    for (let period = candidate * 0.95; period <= candidate * 1.05; period += 0.001) {
      for (let phase = 0; phase < period; phase += gridSec / 2) {
        const score = combScore(period, phase)
        if (score > finalScore) { finalScore = score; refined = period; finalPhase = phase }
      }
    }
    scored.push({ period: refined, phase: finalPhase, score: finalScore })
  }
  // 倍频平局裁决：完美周期曲上「每拍命中」与「隔拍命中」的平均分相同（梳状网格是
  // 子集），真机包络还有 ±1 帧的量化抖动（astats 帧边界 ≈43ms）——同分带宽取
  // ≥0.80×最优，带宽内取**最高 BPM**（基频）；带宽外取最高分。
  const bestComb = Math.max(...scored.map((entry) => entry.score))
  const winners = scored.filter((entry) => entry.score >= bestComb * 0.80)
  const winner = winners.reduce((left, right) => (bpmOf(right.period) > bpmOf(left.period) ? right : left), winners[0]!)
  const periodSec = winner.period
  bestOffset = winner.phase
  const bpm = Math.round(bpmOf(periodSec) * 10) / 10
  const beats: number[] = []
  for (let t = bestOffset; t <= durationSec + 1e-9; t += periodSec) {
    beats.push(Math.round(t * 1000) / 1000)
  }
  // 置信度：峰相对均值的高差占比 —— click 曲 best≫mean → →1；无节拍噪声 best≈mean → →0
  // （此前的「峰占比」公式对平滑自相似噪声会虚高，已废弃）。
  const prominence = (bestScore - meanCorr) / (bestScore + meanCorr + 1e-9)
  const confidence = Math.round(Math.min(1, Math.max(0, prominence * 1.3)) * 100) / 100
  return { bpm, periodSec, offsetSec: bestOffset * gridSec, beats, confidence }
}

/** 便利封装：LoudnessPoint 序列 → 完整 BeatAnalysis（含 LUFS 透传）。 */
export function analyzeEnvelope(
  points: readonly LoudnessPoint[],
  options: BeatAnalyzeOptions & { lufs?: number } = {},
): BeatAnalysis {
  const { lufs, ...bpmOptions } = options
  const notes: string[] = []
  const grid = resampleEnvelope(points, bpmOptions.gridSec ?? 0.005)
  const result = estimateBpm(grid, bpmOptions)
  if (result.beats.length === 0 || result.bpm === 0) {
    return { bpm: 0, beats: [], confidence: 0, ...(lufs !== undefined ? { lufs } : {}), method: 'onset-autocorrelation', notes: ['未能从响度包络估出稳定节拍（曲子可能是氛围/弦乐类，或过短）'] }
  }
  if (result.confidence < 0.5) {
    notes.push(`节拍置信度 ${result.confidence}（<0.5，低置信）——按 D-05 禁用卡点吸附，beats 仅作参考信息`)
  }
  return {
    bpm: result.bpm,
    beats: result.beats,
    confidence: result.confidence,
    ...(lufs !== undefined ? { lufs } : {}),
    method: 'onset-autocorrelation',
    notes,
  }
}

// ────────────────────────────── 卡点吸附（纯函数） ──────────────────────────────

export interface SnappedCut {
  /** 原切点（秒）。 */
  original: number
  /** 吸附后的切点（秒）；不吸附 = undefined（保持原值）。 */
  snapped?: number
  /** 偏移（秒；吸附时 = snapped - original）。 */
  deltaSec?: number
  /** 拍点下标（吸附时给）。 */
  beatIndex?: number
}

export interface SnapCutsResult {
  cuts: SnappedCut[]
  /** 吸附上的切点数。 */
  snappedCount: number
  /** 总时长漂移（秒；吸附后各镜时长变化之和的绝对值 —— 必须回显并重算 durationInFrames）。 */
  totalDriftSec: number
  warnings: string[]
}

/**
 * 镜头切点吸附到最近拍点（卡点剪辑核心，纯函数）。
 *
 * 容差 = toleranceBeats × 拍长（计划口径 ±0.5 拍）：超差不吸附并告警 —— 硬吸会把
 * 镜头拉出明显跳变。**吸附后总时长会漂移**，调用方必须重算 durationInFrames 并过
 * 尾部完整性校验（CV-361 教训）。
 */
export function snapCutsToBeats(
  cutPointsSec: readonly number[],
  beats: readonly number[],
  bpm: number,
  toleranceBeats = 0.5,
): SnapCutsResult {
  const warnings: string[] = []
  if (beats.length === 0 || bpm <= 0) {
    return { cuts: cutPointsSec.map((original) => ({ original })), snappedCount: 0, totalDriftSec: 0, warnings: ['无有效节拍数据，未做吸附'] }
  }
  const tolerance = toleranceBeats * (60 / bpm)
  const cuts: SnappedCut[] = cutPointsSec.map((original) => {
    let bestIndex = -1
    let bestDist = Infinity
    beats.forEach((beat, index) => {
      const dist = Math.abs(beat - original)
      if (dist < bestDist) {
        bestDist = dist
        bestIndex = index
      }
    })
    if (bestIndex >= 0 && bestDist <= tolerance) {
      const snapped = beats[bestIndex]!
      return { original, snapped, deltaSec: Math.round((snapped - original) * 1000) / 1000, beatIndex: bestIndex }
    }
    return { original }
  })
  const snappedCount = cuts.filter((cut) => cut.snapped !== undefined).length
  if (snappedCount < cuts.length) {
    warnings.push(`${cuts.length - snappedCount} 个切点超出 ±${toleranceBeats} 拍容差，未吸附（保持原切点）`)
  }
  const totalDriftSec = Math.round(cuts.reduce((sum, cut) => sum + Math.abs(cut.deltaSec ?? 0), 0) * 1000) / 1000
  if (totalDriftSec > 0) {
    warnings.push(`吸附使总时长漂移 ${totalDriftSec.toFixed(3)}s —— 必须重算各镜 durationInFrames（fps = round(sec × fps) / sec）并过尾部完整性校验`)
  }
  return { cuts, snappedCount, totalDriftSec, warnings }
}

// ────────────────────────────── 歌词启发式对齐（纯函数） ──────────────────────────────

/**
 * 歌词启发式对齐（入口②）：按静音区间（人声换气/句间隙）切分 + 字数比例兜底。
 * 精度有限 —— **必须标 `source: 'estimated'`**，UI 弱化显示（D-05 同源纪律）。
 */
export function heuristicLyrics(
  lines: readonly string[],
  silenceRanges: ReadonlyArray<{ start: number; end: number | null }>,
  durationSec: number,
): LyricLine[] {
  if (lines.length === 0 || !(durationSec > 0)) return []
  // 边界候选：静音区间的中点（跳过贴头贴尾的静音）。
  const boundaries: number[] = [0]
  for (const range of silenceRanges) {
    if (range.end === null) continue
    const mid = (range.start + range.end) / 2
    if (mid > 0.15 && mid < durationSec - 0.15) boundaries.push(mid)
  }
  boundaries.push(durationSec)
  const usable = [...new Set(boundaries.map((b) => Math.round(b * 1000) / 1000))].sort((a, b) => a - b)
  const results: LyricLine[] = []
  if (usable.length - 1 >= lines.length) {
    // 静音段够用：按「歌词行 → 相邻静音中点」顺序对齐（多余静音段并进邻近行）。
    const step = (usable.length - 1) / lines.length
    for (let i = 0; i < lines.length; i += 1) {
      const start = usable[Math.round(i * step)]!
      const end = usable[Math.round((i + 1) * step)]!
      results.push({ line: lines[i]!, startSec: start, endSec: end, source: 'estimated' })
    }
    return results
  }
  // 静音段不够：按字数比例切满全程（粗但可用，诚实标注）。
  const totalChars = lines.reduce((sum, line) => sum + Math.max(1, line.length), 0)
  let cursor = 0
  for (const line of lines) {
    const share = (Math.max(1, line.length) / totalChars) * durationSec
    const start = Math.round(cursor * 1000) / 1000
    const end = Math.round(Math.min(durationSec, cursor + share) * 1000) / 1000
    results.push({ line, startSec: start, endSec: end, source: 'estimated' })
    cursor += share
  }
  return results
}

// ────────────────────────────── ffmpeg IO（Host 侧） ──────────────────────────────

import { runFfmpeg, FFMPEG_TIMEOUT_MS } from './ffmpeg-run.js'
import { throwError } from './error-system.js'
import './errors/catalog.js'

/** 从 astats+ametadata 的 stdout 解析响度包络（`pts_time` + `RMS_level` 成对出现）。 */
export function parseEnvelopeStdout(stdout: string): LoudnessPoint[] {
  const points: LoudnessPoint[] = []
  let currentTime: number | null = null
  for (const rawLine of stdout.split('\n')) {
    const timeMatch = /pts_time:(-?[\d.]+)/u.exec(rawLine)
    if (timeMatch !== null) {
      currentTime = Number(timeMatch[1])
      continue
    }
    const dbMatch = /lavfi\.astats\.Overall\.RMS_level=(-?[\d.inf-]+)/u.exec(rawLine)
    if (dbMatch !== null && currentTime !== null) {
      const raw = dbMatch[1]!
      const db = raw.includes('inf') ? -120 : Number(raw)
      points.push({ t: currentTime, db: Number.isFinite(db) ? db : -120 })
      currentTime = null
    }
  }
  return points
}

/** 从 ebur128 stderr 的 Summary 解析 Integrated loudness（LUFS）；无 Summary 返回 undefined。 */
export function parseLufs(stderr: string): number | undefined {
  const match = /I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/u.exec(stderr)
  if (match === null) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) ? value : undefined
}

/** 从 silencedetect stderr 解析静音区间（与探针口径一致：时间戳是判据）。 */
export function parseSilenceRanges(stderr: string): Array<{ start: number; end: number | null }> {
  const starts = [...stderr.matchAll(/silence_start:\s*(-?[\d.]+)/gu)].map((m) => Number(m[1]))
  const ends = [...stderr.matchAll(/silence_end:\s*(-?[\d.]+)/gu)].map((m) => Number(m[1]))
  return starts.map((start, index) => ({
    start: Math.max(0, start),
    end: index < ends.length ? ends[index]! : null,
  }))
}

/**
 * 对一个本地音频文件跑完整节拍分析（两遍 ffmpeg：包络 + ebur128）。
 * 第三遍 silencedetect 只在需要歌词对齐时跑（`withSilences`）。
 */
export async function analyzeBeatsFromFile(
  ffmpegPath: string,
  file: string,
  options: { withSilences?: boolean; signal?: AbortSignal } = {},
): Promise<BeatAnalysis & { silences: Array<{ start: number; end: number | null }>, durationSec: number }> {
  const signal = options.signal
  const envelopeRun = await runFfmpeg(
    ffmpegPath,
    ['-i', file, '-af', 'astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-', '-f', 'null', '-'],
    FFMPEG_TIMEOUT_MS,
    signal,
  )
  const points = parseEnvelopeStdout(envelopeRun.stdout)
  if (points.length === 0) {
    throwError('CS-USER-ERR', { message: `节拍分析失败：未能从 ${file} 读取响度包络（astats/ametadata 无输出），请确认文件是有效音频` })
  }
  const eburRun = await runFfmpeg(
    ffmpegPath,
    ['-i', file, '-af', 'ebur128=peak=none', '-f', 'null', '-'],
    FFMPEG_TIMEOUT_MS,
    signal,
  )
  const lufs = parseLufs(eburRun.stderr)
  let silences: Array<{ start: number; end: number | null }> = []
  if (options.withSilences === true) {
    const silenceRun = await runFfmpeg(
      ffmpegPath,
      ['-i', file, '-af', 'silencedetect=noise=-35dB:d=0.18', '-f', 'null', '-'],
      FFMPEG_TIMEOUT_MS,
      signal,
    )
    silences = parseSilenceRanges(silenceRun.stderr)
  }
  const analysis = analyzeEnvelope(points, { ...(lufs !== undefined ? { lufs } : {}) })
  const durationSec = points.length > 0 ? points[points.length - 1]!.t : 0
  return { ...analysis, silences, durationSec }
}
