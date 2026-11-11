#!/usr/bin/env node
/**
 * S0 · `tech/kinetic-promo` 对原片「≥95% 相同」的**唯一验收尺子**。
 *
 * 口径见 `docs/plans/2026-11-10-视频模板化/开发计划-95percent对齐-20261111.md` §0：
 *   时间轴 20 / 构图元素 30 / 配色明度 20 / 动效 20 / 音频 10；
 *   总分 ≥95 **且单项 ≥85** 才算达标。
 *
 * 逐像素 95% 物理不可能（文案/规格/字体/肖像都不同），所以量的是**视觉语法**：
 * 逐秒暗占比、亮度、电蓝/琥珀面积、色相直方图、3×3 构图向量、帧差峰值、
 * scene 切点、响度，再加上模板轨声明对账的元素清单。
 *
 * 用法：
 *   node scripts/probe/similarity-95.probe.mjs --build-baseline   # 从原片重算 GT
 *   node scripts/probe/similarity-95.probe.mjs                      # 给当前样片打分
 *   REF_VIDEO=... OUR_VIDEO=... SIMILARITY_OUT=... node ...        # 换路径
 *
 * 报告**不含时间戳**，所有数值 4 位小数 ⇒ 同输入两次运行逐字节相同。
 * 退出码：0 = 达到 95 / 1 = 未达标 / 2 = 环境或输入问题。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..', '..')
const plansDir = join(packageRoot, 'docs', 'plans', '2026-11-10-视频模板化')
const GT_FILE = join(plansDir, 'gt', 'reference-24s.json')
const OUT_FILE = process.env.SIMILARITY_OUT ?? join(packageRoot, 'build', 'probe', 'similarity-95.json')
const VIDEO_DIR = join(homedir(), 'Desktop', 'job', 'VideoOut', 'kinetic-promo-20261111')
const REF_VIDEO = process.env.REF_VIDEO ?? join(VIDEO_DIR, 'reference-demo-24s.mp4')
const OUR_VIDEO = process.env.OUR_VIDEO ?? join(VIDEO_DIR, 'kinetic-promo-24s.mp4')
const TEMPLATE_DIR = join(packageRoot, 'assets', 'templates', 'tech', 'kinetic-promo')

const W = 96
const H = 54
const FRAME_BYTES = W * H * 3
const GRAY_BYTES = W * H
const FPS_SAMPLE = 5
const SECONDS = 24

/** 原片 12 段边界（秒）—— 会话 2591 逐秒拆解；60fps 换算在比对时做。 */
const SEGMENTS = [0, 5.6, 6.3, 8.0, 10.3, 12.7, 14.0, 15.3, 16.0, 17.0, 18.3, 22.5, 24.0]

/**
 * 原片逐段元素清单（人工标注，来自 `compare-original-vs-ours.jpg` / poster / compositions）。
 * 这是**期望全集**；探针从模板轨声明自动推「我们实际有什么」，两者求覆盖率。
 */
export const REFERENCE_ELEMENTS = [
  'cardWall', 'timecode', 'playingAll', 'cornerBrackets', 'waveform', 'pushIn',
  'bigNumberMetal', 'metalTitle', 'presenterPortrait', 'subtitle', 'palette',
  'barChart', 'bigNumber', 'indexLabel', 'dataPanel', 'bulletList', 'chart',
  'counters', 'thumbnails', 'thumbnailGrid', 'fullBlue', 'kineticType',
  'starburst', 'darkGold', 'ringOutline', 'shortCopy', 'whitePanel',
  'codeWindow', 'blueGrid', 'roundPip', 'particles', 'stateLabel',
  'namePlates', 'greenChecks', 'dropBounce', 'compareBars', 'cta',
]

export const WEIGHTS = { timeline: 20, composition: 30, color: 20, motion: 20, audio: 10 }

function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH
  return join(packageRoot, '..', 'dsh-plugin-desktop', 'build', 'ffmpeg', 'darwin-arm64', 'ffmpeg')
}

function ff(ffmpeg, args, maxBuffer = 64 * 1024 * 1024) {
  const r = spawnSync(ffmpeg, args, { maxBuffer, encoding: undefined })
  if (r.status !== 0) {
    throw new Error(`ffmpeg 失败（${r.status}）：${String(r.stderr).slice(-500)}`)
  }
  return { stdout: r.stdout, stderr: String(r.stderr) }
}

/** 四舍五入到 4 位，保证报告可重复。 */
export function round4(v) {
  return Math.round(v * 10000) / 10000
}

export function clamp01(v) {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
}

/** 距离 → 相似度；`scale` 是「差多少算完全不像」。 */
export function closeness(a, b, scale) {
  return round4(clamp01(1 - Math.abs(a - b) / scale))
}

/** 响度：±1 LU 内满分，之后线性衰减，12 LU 归零（计划 §0 口径）。 */
export function loudnessCloseness(a, b) {
  const diff = Math.abs(a - b)
  if (diff <= 1) return 1
  return round4(clamp01(1 - (diff - 1) / 11))
}

function hueBin(r, g, b) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d < 18 || max < 30) return -1
  let h
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h *= 60
  if (h < 0) h += 360
  return Math.min(11, Math.floor(h / 30))
}

/** 一帧的统计量（纯函数，可单测）。 */
export function frameStats(buf, offset) {
  let dark = 0, blue = 0, amber = 0, luma = 0
  const hist = new Array(12).fill(0)
  const grid = new Array(9).fill(0)
  const gridCount = new Array(9).fill(0)
  let colored = 0
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = offset + (y * W + x) * 3
      const r = buf[i], g = buf[i + 1], b = buf[i + 2]
      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      luma += l
      if (Math.max(r, g, b) < 40) dark += 1
      if (b > 70 && b > r * 1.35 && b > g * 1.05) blue += 1
      if (r > 120 && g > 60 && g < 190 && b < r * 0.65) amber += 1
      const bin = hueBin(r, g, b)
      if (bin >= 0) { hist[bin] += 1; colored += 1 }
      const cell = Math.min(2, Math.floor((y / H) * 3)) * 3 + Math.min(2, Math.floor((x / W) * 3))
      grid[cell] += l
      gridCount[cell] += 1
    }
  }
  const n = W * H
  return {
    dark: round4(dark / n),
    luma: round4(luma / n),
    blue: round4(blue / n),
    amber: round4(amber / n),
    hue: hist.map((v) => round4(colored > 0 ? v / colored : 0)),
    grid: grid.map((v, i) => round4(gridCount[i] > 0 ? v / gridCount[i] : 0)),
  }
}

/** 逐秒 rgb24 → 24 组统计量。 */
export function perSecondStats(raw) {
  const out = []
  for (let s = 0; s < SECONDS; s += 1) {
    const off = s * FRAME_BYTES
    if (off + FRAME_BYTES > raw.length) break
    out.push(frameStats(raw, off))
  }
  return out
}

/** 灰度帧差曲线 → 局部峰值（秒）。 */
export function motionPeaks(raw, fps = FPS_SAMPLE) {
  const count = Math.floor(raw.length / GRAY_BYTES)
  const diffs = []
  for (let f = 1; f < count; f += 1) {
    let sum = 0
    for (let i = 0; i < GRAY_BYTES; i += 1) {
      sum += Math.abs(raw[f * GRAY_BYTES + i] - raw[(f - 1) * GRAY_BYTES + i])
    }
    diffs.push(sum / GRAY_BYTES / 255)
  }
  const mean = diffs.reduce((a, b) => a + b, 0) / Math.max(1, diffs.length)
  const peaks = []
  for (let i = 1; i < diffs.length - 1; i += 1) {
    if (diffs[i] > mean * 1.5 && diffs[i] >= diffs[i - 1] && diffs[i] >= diffs[i + 1]) {
      const sec = round4((i + 1) / fps)
      if (peaks.length === 0 || sec - peaks[peaks.length - 1] > 0.2) peaks.push(sec)
    }
  }
  return { mean: round4(mean), count: peaks.length, peaks, diffs: diffs.map(round4) }
}

export function parseCuts(text) {
  const out = []
  const re = /pts_time:\s*([0-9.]+)/g
  let m
  while ((m = re.exec(text)) !== null) {
    const v = Number(m[1])
    if (Number.isFinite(v) && v > 0 && v < SECONDS) out.push(round4(v))
  }
  return out.sort((a, b) => a - b)
}

export function parseLoudness(text) {
  const m = /I:\s*(-?[0-9.]+)\s*LUFS/.exec(text)
  return m === null ? null : round4(Number(m[1]))
}

/** 从模板轨声明推「我们实际有哪些元素」—— 改模板分数会跟着变，不是手填常量。 */
export function templateElements() {
  const skeleton = JSON.parse(readFileSync(join(TEMPLATE_DIR, 'manifest.template.json'), 'utf8'))
  const furniture = JSON.parse(readFileSync(join(TEMPLATE_DIR, 'furniture.json'), 'utf8'))
  const tracks = Array.isArray(skeleton.tracks) ? skeleton.tracks : []
  const ids = tracks.map((t) => String(t.id))
  const has = (p) => ids.some((id) => p.test(id))
  const fx = tracks.filter((t) => t.fx === 'metal').length
  const set = new Set()
  if (furniture.some((f) => f.id === 'cardWall')) set.add('cardWall')
  // S3：容器化卡墙的推近（容器 animate scale 递增）—— 推近必须真声明才算有。
  if (furniture.some((f) => f.id === 'cardWall' && Array.isArray(f.params?.pushFrom) === false && Number(f.params?.pushFrom) > 0 && Number(f.params?.pushTo) > Number(f.params?.pushFrom))) set.add('pushIn')
  if (furniture.some((f) => f.id === 'cornerBrackets')) set.add('cornerBrackets')
  if (has(/wave|waveform/)) set.add('waveform')
  if (has(/timecode/)) set.add('timecode')
  if (has(/s1-hud/)) set.add('playingAll')
  if (has(/push|pushin/)) set.add('pushIn')
  if (fx > 0) { set.add('bigNumberMetal'); set.add('metalTitle') }
  if (tracks.some((t) => t.type === 'image' || t.type === 'video')) set.add('presenterPortrait')
  if (tracks.some((t) => t.variant === 'subtitle')) set.add('subtitle')
  if (has(/s3-palette/)) set.add('palette')
  if (has(/s4-bar/)) set.add('barChart')
  if (has(/s2-number/)) set.add('bigNumber')
  if (has(/s4-eyebrow/)) set.add('indexLabel')
  if (tracks.some((t) => t.variant === 'dataCard')) set.add('dataPanel')
  if (tracks.some((t) => t.variant === 'bullets')) set.add('bulletList')
  if (has(/s5-graph/)) set.add('chart')
  if (tracks.some((t) => t.countUp === true)) set.add('counters')
  if (has(/s6-cell/)) { set.add('thumbnails'); set.add('thumbnailGrid') }
  if (has(/s7-flash/)) set.add('fullBlue')
  if (has(/s7-k/)) set.add('kineticType')
  if (has(/s7-spark/)) set.add('starburst')
  if (has(/particle/)) set.add('particles')
  if (has(/s8-ground/)) set.add('darkGold')
  if (tracks.some((t) => t.id === 's8-ring' && t.shape === 'circle' && t.fx !== undefined)) set.add('ringOutline')
  if (has(/s8-head|s9-head/)) set.add('shortCopy')
  if (has(/s9-panel/)) set.add('whitePanel')
  if (has(/code|terminal/)) set.add('codeWindow')
  if (has(/s10-grid/)) set.add('blueGrid')
  if (tracks.some((t) => (t.type === 'image' || t.type === 'video') && t.clip === 'circle')) set.add('roundPip')
  if (has(/s10-head/)) set.add('stateLabel')
  if (has(/s11-plate/)) set.add('namePlates')
  if (has(/checkmark/)) set.add('greenChecks')
  if (tracks.some((t) => /s11-plate/.test(String(t.id)) && t.animate !== undefined)) set.add('dropBounce')
  if (has(/s12-bar/)) set.add('compareBars')
  if (has(/s12-cta/)) set.add('cta')
  return [...set].sort()
}

/** 12 段起始帧命中率：模板轨的 startFrame 是否落在每段边界（60fps）上。 */
function segmentBoundaryHits() {
  const skeleton = JSON.parse(readFileSync(join(TEMPLATE_DIR, 'manifest.template.json'), 'utf8'))
  const starts = new Set((skeleton.tracks ?? []).map((t) => Number(t.startFrame)))
  let hits = 0
  for (let i = 0; i < SEGMENTS.length - 1; i += 1) {
    if (starts.has(Math.round(SEGMENTS[i] * 60))) hits += 1
  }
  return round4(hits / (SEGMENTS.length - 1))
}

/** 五维打分（纯函数，单测直测）。 */
export function scoreSimilarity(baseline, actual) {
  const avg = (list) => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length)

  // ① 时间轴：切点密度 + 12 段边界命中
  const cutRatio = clamp01(actual.cuts.length / Math.max(1, baseline.cuts.length))
  const timeline = round4(100 * (0.5 * cutRatio + 0.5 * actual.segmentHits))

  // ② 构图：3×3 亮度向量距离 + 元素清单覆盖率
  const gridDist = avg(baseline.perSecond.map((ref, i) => {
    const got = actual.perSecond[i]
    if (!got) return 1
    return avg(ref.grid.map((v, k) => Math.abs(v - got.grid[k])))
  }))
  const expected = new Set(REFERENCE_ELEMENTS)
  const got = new Set(actual.elements)
  const coverage = [...expected].filter((e) => got.has(e)).length / expected.size
  const composition = round4(100 * (0.5 * clamp01(1 - gridDist / 0.5) + 0.5 * coverage))

  // ③ 配色/明度：暗占比、亮度、电蓝、琥珀、色相直方图
  const metrics = ['dark', 'luma', 'blue', 'amber']
  const scales = { dark: 0.5, luma: 0.4, blue: 0.15, amber: 0.15 }
  const colorParts = metrics.map((key) => {
    const r = avg(baseline.perSecond.map((f) => f[key]))
    const o = avg(actual.perSecond.map((f) => f[key]))
    return closeness(r, o, scales[key])
  })
  const hueDist = avg(baseline.perSecond.map((ref, i) => {
    const got = actual.perSecond[i]
    if (!got) return 1
    return avg(ref.hue.map((v, k) => Math.abs(v - got.hue[k]))) * 2
  }))
  colorParts.push(clamp01(1 - hueDist))
  const color = round4(100 * avg(colorParts))

  // ④ 动效：峰值密度 + 峰值位置对齐
  const peakRatio = clamp01(actual.motion.count / Math.max(1, baseline.motion.count))
  const aligned = baseline.motion.peaks.filter((p) => actual.motion.peaks.some((q) => Math.abs(q - p) <= 0.4)).length
  const alignRatio = clamp01(aligned / Math.max(1, baseline.motion.peaks.length))
  const motion = round4(100 * (0.5 * peakRatio + 0.5 * alignRatio))

  // ⑤ 音频：响度
  const audio = round4(100 * (baseline.loudness !== null && actual.loudness !== null
    ? loudnessCloseness(baseline.loudness, actual.loudness)
    : 0))

  const dims = { timeline, composition, color, motion, audio }
  const total = round4(Object.entries(dims).reduce((sum, [k, v]) => sum + (WEIGHTS[k] * v) / 100, 0))
  const weakest = Object.entries(dims).sort((a, b) => a[1] - b[1])[0]
  return {
    dims,
    total,
    pass: total >= 95 && Object.values(dims).every((v) => v >= 85),
    weakest: { name: weakest[0], score: weakest[1] },
    elementCoverage: round4(coverage),
    missingElements: [...expected].filter((e) => !got.has(e)),
  }
}

/** 采集一支片子的全部可测事实。 */
function collect(ffmpeg, file) {
  if (!existsSync(file)) throw new Error(`视频不存在：${file}`)
  const rgb = ff(ffmpeg, ['-v', 'error', '-i', file, '-vf', `fps=1,scale=${W}:${H},format=rgb24`, '-an', '-f', 'rawvideo', '-']).stdout
  const gray = ff(ffmpeg, ['-v', 'error', '-i', file, '-vf', `fps=${FPS_SAMPLE},scale=${W}:${H},format=gray`, '-an', '-f', 'rawvideo', '-']).stdout
  const cuts = ff(ffmpeg, ['-hide_banner', '-i', file, '-vf', "select='gt(scene,0.12)',metadata=print:file=-", '-an', '-f', 'null', '-'])
  const loud = ff(ffmpeg, ['-hide_banner', '-i', file, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'])
  return {
    perSecond: perSecondStats(rgb),
    motion: motionPeaks(gray),
    cuts: parseCuts(`${String(cuts.stdout)}\n${cuts.stderr}`),
    loudness: parseLoudness(loud.stderr),
  }
}

function buildBaseline(ffmpeg) {
  const c = collect(ffmpeg, REF_VIDEO)
  const baseline = {
    source: 'motiontemplates/385712 assets/demo.mp4',
    spec: { durationSec: 24, width: 1280, height: 720, fps: 30, frames: 720, loudnessLUFS: -17.3 },
    segments: SEGMENTS,
    referenceElements: REFERENCE_ELEMENTS,
    ...c,
  }
  mkdirSync(dirname(GT_FILE), { recursive: true })
  writeFileSync(GT_FILE, JSON.stringify(baseline, null, 2) + '\n')
  return baseline
}

async function main() {
  const ffmpeg = resolveFfmpeg()
  if (!existsSync(ffmpeg)) throw new Error(`ffmpeg 不存在：${ffmpeg}（用 FFMPEG_PATH 指定）`)
  const build = process.argv.includes('--build-baseline')
  const baseline = build ? buildBaseline(ffmpeg) : JSON.parse(readFileSync(GT_FILE, 'utf8'))
  if (!existsSync(GT_FILE)) throw new Error(`缺基线文件，先跑 --build-baseline：${GT_FILE}`)

  const c = collect(ffmpeg, OUR_VIDEO)
  const actual = {
    ...c,
    segmentHits: segmentBoundaryHits(),
    elements: templateElements(),
  }
  const verdict = scoreSimilarity(baseline, actual)
  const report = {
    criterion: { totalMin: 95, dimensionMin: 85, weights: WEIGHTS },
    reference: baseline.source,
    ourVideo: OUR_VIDEO,
    baseline: { cutCount: baseline.cuts.length, motionPeaks: baseline.motion.count, loudness: baseline.loudness },
    actual: { cutCount: actual.cuts.length, motionPeaks: actual.motion.count, loudness: actual.loudness, segmentHits: actual.segmentHits },
    gaps: {
      cutDelta: baseline.cuts.length - actual.cuts.length,
      motionPeakDelta: baseline.motion.count - actual.motion.count,
      loudnessDelta: baseline.loudness !== null && actual.loudness !== null ? round4(actual.loudness - baseline.loudness) : null,
    },
    verdict,
  }
  mkdirSync(dirname(OUT_FILE), { recursive: true })
  writeFileSync(OUT_FILE, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report.verdict, null, 2))
  console.log(`报告 → ${OUT_FILE}`)
  if (build) console.log(`基线 → ${GT_FILE}`)
  process.exitCode = verdict.pass ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`❌ ${error.message}`)
    process.exitCode = 2
  })
}
