/**
 * RQ-13（REQ-038）· 像素对拍闸 — **核心度量**（纯函数：输入灰度帧数组，零 IO）。
 *
 * 为什么单独一层：ffmpeg 解码只能在 CLI 做（不进单测）；能单测的是「给帧序列 →
 * 度量结论」。三个判据的阈值直接来自 playsout 复刻的实测（需求正本 §1.2 E4/E5/E7
 * 与 §3 RQ-13 验收）：
 * - 亮度跳变 p99 ≤ 4（修复前 4.51 = 判红，修复后 2.29 = 过）；
 * - 关键帧 PSNR：同规格复现 ≥40dB；参数化换参 <30dB（≥40 即判红「参数是摆设」）；
 *   不雷同 中位数 <25dB 且最小值 <20dB；
 * - 落点偏差 ≤ 容差（RQ-15：box 中心 vs 墨迹中心）。
 */

/** 单帧平均亮度（0–255，灰度帧等价于逐像素均值）。 */
export function meanLuma(grayFrame) {
  let sum = 0
  for (let i = 0; i < grayFrame.length; i += 1) sum += grayFrame[i]
  return sum / grayFrame.length
}

/** 帧序列 → 逐帧平均亮度数组。 */
export function lumaSeries(grayFrames) {
  return grayFrames.map((frame) => meanLuma(frame))
}

/** 帧间亮度跳变序列（|Δ|，长度 = 帧数 − 1）。 */
export function lumaJumps(grayFrames) {
  const means = lumaSeries(grayFrames)
  const jumps = []
  for (let i = 1; i < means.length; i += 1) jumps.push(Math.abs(means[i] - means[i - 1]))
  return jumps
}

/**
 * 分位数（线性插值法；p99 的口径与需求文档一致）。
 * 输入空数组返回 0（无跳变 = 无异常）。
 */
export function percentile(values, p) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * p
  const lo = Math.floor(index)
  const hi = Math.ceil(index)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo)
}

/**
 * RQ-13 判据 ②：亮度跳变 p99 检查。
 * `threshold` 缺省 4（修复前实测 4.51 判红；硬切/白闪等**帧级**异常靠 `jumpLimit`
 * 列出帧号供人工复核 —— 检查器不自动豁免任何帧）。
 */
export function auditLumaJumps(grayFrames, { threshold = 4, jumpLimit = 6 } = {}) {
  const jumps = lumaJumps(grayFrames)
  const p99 = percentile(jumps, 0.99)
  const spikes = jumps
    .map((delta, index) => ({ frame: index + 1, delta }))
    .filter(({ delta }) => delta > jumpLimit)
  return { p99, spikes, pass: p99 <= threshold, threshold }
}

/** 单帧对 PSNR（dB；MSE=0 返回 Infinity —— 逐字节相同）。 */
export function psnrOfFramePair(a, b) {
  if (a.length !== b.length) throw new Error(`帧尺寸不一致：${a.length} vs ${b.length}`)
  let se = 0
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i]
    se += d * d
  }
  const mse = se / a.length
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse)
}

/**
 * RQ-13 判据 ③：帧序列对 PSNR（按帧对齐；短的一方决定比对长度）。
 * 返回分桶（与需求正本 E7 口径一致）与关键帧明细。
 */
export function psnrSeries(framesA, framesB) {
  const n = Math.min(framesA.length, framesB.length)
  const psnrs = []
  for (let i = 0; i < n; i += 1) psnrs.push(psnrOfFramePair(framesA[i], framesB[i]))
  const buckets = { '>=40dB': 0, '30-40dB': 0, '20-30dB': 0, '<20dB': 0 }
  for (const value of psnrs) {
    if (value >= 40) buckets['>=40dB'] += 1
    else if (value >= 30) buckets['30-40dB'] += 1
    else if (value >= 20) buckets['20-30dB'] += 1
    else buckets['<20dB'] += 1
  }
  const finite = psnrs.filter((value) => Number.isFinite(value))
  return {
    frames: n,
    buckets,
    median: percentile(finite, 0.5),
    min: finite.length > 0 ? Math.min(...finite) : 0,
    psnrs,
  }
}

/** 墨迹带（scan-ink 的行段判定：一行内有 ≥1 个亮像素 = 命中）。 */
export function inkBands(grayFrame, width, height, threshold = 120) {
  const rowHits = []
  for (let y = 0; y < height; y += 1) {
    let hits = 0
    for (let x = 0; x < width; x += 1) {
      if (grayFrame[y * width + x] >= threshold) hits += 1
    }
    rowHits.push(hits)
  }
  const bands = []
  let start = -1
  for (let y = 0; y <= height; y += 1) {
    const has = y < height && rowHits[y] > 0
    if (has && start < 0) start = y
    if (!has && start >= 0) {
      bands.push({ y0: start, y1: y - 1 })
      start = -1
    }
  }
  return bands
}

/**
 * RQ-15 · **落点审计**：box 声明中心 vs 墨迹中心，超容差告警。
 * 输入：灰度帧 + box（画布百分比，中心语义，与 BaseTrack.box 同口径）+ 容差 px（缺省 24，
 * playsout 实测右移 70px 的 1/3 —— 小于它不会被装饰层带偏，大于它必是真漂移）。
 * 返回 `{ inkCenter, boxCenter, offsetPx, pass }`；画面无墨迹返回 `pass: true` 且
 * `offsetPx: null`（空画面不是落点错误）。
 */
export function auditInkOffset(grayFrame, width, height, box, { threshold = 120, tolerancePx = 24 } = {}) {
  let sx = 0
  let sy = 0
  let hits = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (grayFrame[y * width + x] >= threshold) {
        sx += x
        sy += y
        hits += 1
      }
    }
  }
  const boxCenter = { x: (box.x / 100) * width, y: (box.y / 100) * height }
  if (hits === 0) return { inkCenter: null, boxCenter, offsetPx: null, pass: true, tolerancePx }
  const inkCenter = { x: sx / hits, y: sy / hits }
  const offsetPx = Math.hypot(inkCenter.x - boxCenter.x, inkCenter.y - boxCenter.y)
  return { inkCenter, boxCenter, offsetPx, pass: offsetPx <= tolerancePx, tolerancePx }
}
