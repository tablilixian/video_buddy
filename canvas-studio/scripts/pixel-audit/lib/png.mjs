/**
 * RQ-14（REQ-038）· 预生成资产的 **alpha 剖面自检**（PNG 解码 → 剖面断言）。
 *
 * 为什么自检（E4 事故）：`scrimPng` 的 `t = 1 − y/height` 写反 ⇒ 字幕带以下整屏
 * peak，字幕一出现盖住 75% 画面 —— 渲染期零征兆、校验零告警，只有逐帧亮度扫描
 * 才抓到。自检把这类错误**堵在资产阶段**：出图后立即断言 alpha 剖面，不满足即拒绝
 * 出图（验收口径：故意写回旧公式 ⇒ 资产阶段就红）。
 *
 * PNG 解码：手写（8-bit RGB/RGBA/Gray，filter 0–4）—— 自检是脚本域，不为它引
 * sharp/pngjs 依赖（零新增依赖纪律）。
 */
import { inflateSync } from 'node:zlib'

/** 解析 PNG → { width, height, channels, pixels(Uint8Array, 交错) }。不支持调色板/16-bit。 */
export function decodePng(buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47]
  for (let i = 0; i < 4; i += 1) {
    if (buffer[i] !== signature[i]) throw new Error('不是 PNG（签名不匹配）')
  }
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  if (bitDepth !== 8) throw new Error(`自检只支持 8-bit PNG（收到 ${bitDepth}-bit）`)
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  if (channels === undefined) throw new Error(`自检不支持 colorType ${colorType}（调色板/特殊格式）`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = new Uint8Array(width * height * channels)
  let pos = 0
  const prevRow = new Uint8Array(stride)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos]
    pos += 1
    const row = raw.subarray(pos, pos + stride)
    pos += stride
    const current = new Uint8Array(stride)
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? current[x - channels] : 0
      const up = prevRow[x]
      const upLeft = x >= channels ? prevRow[x - channels] : 0
      let value = row[x]
      if (filter === 1) value += left
      else if (filter === 2) value += up
      else if (filter === 3) value += Math.floor((left + up) / 2)
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
      }
      current[x] = value & 0xff
    }
    out.set(current, y * stride)
    prevRow.set(current)
  }
  return { width, height, channels, pixels: out }
}

/**
 * alpha 剖面（RQ-14 数据面）：每行的平均 alpha（0–255，行内平均）。
 * 返回长度 = height 的数组（无 alpha 通道的 PNG 返回全 255）。
 */
export function alphaProfile(png) {
  const { width, height, channels, pixels } = png
  const hasAlpha = channels === 2 || channels === 4
  const profile = new Array(height)
  for (let y = 0; y < height; y += 1) {
    let sum = 0
    if (hasAlpha) {
      for (let x = 0; x < width; x += 1) sum += pixels[y * width * channels + x * channels + (channels - 1)]
      profile[y] = sum / width
    } else {
      profile[y] = 255
    }
  }
  return profile
}

/**
 * RQ-14 断言本体：
 * - `outOfBandZero`：带外区（行号 < topBand 或 ≥ height − bottomBand）必须全透明（均值 < 2）；
 * - `peakWindow`：带内峰值行必须落在 [peakFrom, peakTo)（比例）且峰值 ≥ peakMinAlpha；
 * - `lowWindow`（vignette 类径向资产）：[lowFrom, lowTo) 行的 alpha 必须 ≤ lowMaxAlpha
 *   （径向暗角的中心必须透明 —— 写反即此断言红）。
 * 任意不满足 ⇒ 返回 `ok: false` + 原因（调用方拒绝出图）。
 */
export function assertAlphaProfile(profile, options = {}) {
  const {
    outOfBandZero = true,
    topBand = 0,
    bottomBand = 0,
    peakFrom = 0,
    peakTo = 1,
    peakMinAlpha = 200,
    lowWindow = null,
  } = options
  const height = profile.length
  const reasons = []
  if (outOfBandZero) {
    for (let y = 0; y < topBand; y += 1) {
      if ((profile[y] ?? 0) >= 2) reasons.push(`带外行 ${y} alpha 均值 ${(profile[y]).toFixed(1)}，应全透明`)
    }
    for (let y = height - bottomBand; y < height; y += 1) {
      if (y >= 0 && (profile[y] ?? 0) >= 2) reasons.push(`带外行 ${y} alpha 均值 ${(profile[y]).toFixed(1)}，应全透明`)
    }
  }
  const peak = Math.max(...profile)
  const peakRow = profile.indexOf(peak)
  const peakRatio = height > 0 ? peakRow / height : 0
  if (peak < peakMinAlpha) reasons.push(`峰值 alpha ${peak.toFixed(1)} < 期望下限 ${peakMinAlpha}（贴边带太淡）`)
  if (peakRatio < peakFrom || peakRatio >= peakTo) {
    reasons.push(`峰值行 ${peakRow}（${(peakRatio * 100).toFixed(1)}%）不在期望窗口 [${peakFrom * 100}%, ${peakTo * 100}%)`)
  }
  if (lowWindow !== null) {
    const lowFrom = Math.max(0, Math.floor((lowWindow.from ?? 0) * height))
    const lowTo = Math.min(height, Math.ceil((lowWindow.to ?? 1) * height))
    for (let y = lowFrom; y < lowTo; y += 1) {
      if ((profile[y] ?? 0) > lowWindow.maxAlpha) {
        reasons.push(`中心窗口行 ${y} alpha ${(profile[y]).toFixed(1)} > 上限 ${lowWindow.maxAlpha}（径向中心应透明 —— 渐变方向可能写反）`)
      }
    }
  }
  return { ok: reasons.length === 0, reasons, peak, peakRow, height }
}
