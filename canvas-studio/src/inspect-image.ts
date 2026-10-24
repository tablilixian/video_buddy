/**
 * CV-362 · inspect_image 纯函数层：零依赖 PNG 解码 + 像素级分析。
 *
 * 为什么存在：真机复盘（session-postmortem-2026-10-23）暴露宿主**没有任何图像检测能力**
 * —— `read_image` 对项目素材报错、环境无 PIL/ImageMagick/sharp，agent 为「把代码 UI
 * 精准落进表盘屏幕」手写了 8 个 PNG 解码脚本（decode/an/an2/…/colors），烧 25 分钟与
 * 大量上下文。本模块把那套东西收敛成一个工具。
 *
 * 依赖策略：**只用 node:zlib** —— PNG = zlib 流 + 定义明确的行滤波，纯函数可完整实现；
 * JPEG/WEBP 的解码器复杂度不成比例（超本仓范围），遇到即显式报错并给出替代路径。
 *
 * 支持范围（generated assets 全覆盖）：
 * - colorType 0（灰度）/ 2（RGB）/ 3（调色板）/ 4（灰度+α）/ 6（RGBA）
 * - bitDepth 1/2/4/8/16（1/2/4 仅灰度与调色板；16 取高字节）
 * - interlace 必须为 0（Adam7 显式拒收 —— 生成图与截图不会是隔行）
 */

import { inflateSync } from 'node:zlib'

import { throwError } from './error-system.js'

export interface DecodedPng {
  width: number
  height: number
  /** RGBA8，每像素 4 字节，行主序。 */
  rgba: Uint8Array
  bitDepth: number
  colorType: number
}

export interface ImageProfile {
  format: 'png'
  width: number
  height: number
  bitDepth: number
  colorType: string
  bytes: number
}

/** 扫描区（像素坐标，含端点）；缺省 = 整图。REQ-035 F-06。 */
export interface PixelRegion {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface LuminanceBBox {
  polarity: 'dark' | 'bright'
  /** 命中像素的包围盒（像素坐标，含端点）。 */
  x0: number
  y0: number
  x1: number
  y1: number
  /** 包围盒中心与尺寸（画布百分比，x/y 中心语义，与 render_composition 的 box 同口径）。 */
  centerX: number
  centerY: number
  widthPct: number
  heightPct: number
  /** 命中像素占全图比例（%）。 */
  coveragePct: number
  threshold: number
}

export interface DominantColor {
  /** 量化后的 hex（#RRGGBB）。 */
  hex: string
  /** 占比（%，全图）。 */
  pct: number
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

const COLOR_TYPE_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
const COLOR_TYPE_LABEL: Record<number, string> = {
  0: 'grayscale', 2: 'RGB', 3: 'palette', 4: 'grayscale+alpha', 6: 'RGBA',
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

function u32(data: Uint8Array, at: number): number {
  return ((data[at] ?? 0) << 24 | (data[at + 1] ?? 0) << 16 | (data[at + 2] ?? 0) << 8 | (data[at + 3] ?? 0)) >>> 0
}

/** 解码 PNG 为 RGBA8。任何不支持的形态都抛带明确原因的 Error（调用方转 CS-USER-ERR）。 */
export function decodePng(buf: Uint8Array): DecodedPng {
  if (buf.length < 8 || PNG_SIGNATURE.some((byte, i) => buf[i] !== byte)) {
    throwError('CS-USER-ERR', { message: '不是 PNG 文件（签名不符）。本工具只支持 PNG；JPG/WEBP 请先用其它手段转 PNG。' })
  }
  let ihdr: { width: number; height: number; bitDepth: number; colorType: number; interlace: number } | null = null
  let palette: Uint8Array | null = null
  let transparency: Uint8Array | null = null
  const idat: Uint8Array[] = []
  let at = 8
  while (at + 8 <= buf.length) {
    const len = u32(buf, at)
    const type = String.fromCharCode(buf[at + 4] ?? 0, buf[at + 5] ?? 0, buf[at + 6] ?? 0, buf[at + 7] ?? 0)
    const dataStart = at + 8
    const dataEnd = dataStart + len
    if (dataEnd + 4 > buf.length) throwError('CS-USER-ERR', { message: 'PNG 数据损坏（chunk 越界）' })
    if (type === 'IHDR') {
      if (len < 13) throwError('CS-USER-ERR', { message: 'PNG 数据损坏（IHDR 过短）' })
      ihdr = {
        width: u32(buf, dataStart),
        height: u32(buf, dataStart + 4),
        bitDepth: buf[dataStart + 8] ?? 0,
        colorType: buf[dataStart + 9] ?? 0,
        interlace: buf[dataStart + 12] ?? 0,
      }
    } else if (type === 'PLTE') {
      palette = buf.slice(dataStart, dataEnd)
    } else if (type === 'tRNS') {
      transparency = buf.slice(dataStart, dataEnd)
    } else if (type === 'IDAT') {
      idat.push(buf.slice(dataStart, dataEnd))
    } else if (type === 'IEND') {
      break
    }
    at = dataEnd + 4 // 跳过 CRC
  }
  if (ihdr === null) throwError('CS-USER-ERR', { message: 'PNG 数据损坏（缺 IHDR）' })
  const { width, height, bitDepth, colorType, interlace } = ihdr
  if (width <= 0 || height <= 0 || width > 20000 || height > 20000) {
    throwError('CS-USER-ERR', { message: `PNG 尺寸非法（${width}×${height}）` })
  }
  if (interlace !== 0) throwError('CS-USER-ERR', { message: '不支持隔行（Adam7）PNG —— 请用非隔行 PNG 重出素材' })
  if (!(colorType in COLOR_TYPE_CHANNELS)) throwError('CS-USER-ERR', { message: `不支持的颜色类型 colorType=${colorType}` })
  const channels: number = COLOR_TYPE_CHANNELS[colorType] ?? 0
  const packed = colorType === 0 || colorType === 3
  const allowedDepths = packed ? [1, 2, 4, 8, 16] : [8, 16]
  if (!allowedDepths.includes(bitDepth)) {
    throwError('CS-USER-ERR', { message: `不支持的位深 bitDepth=${bitDepth}（colorType=${colorType} 只允许 ${allowedDepths.join('/')}）` })
  }
  if (colorType === 3 && palette === null) throwError('CS-USER-ERR', { message: 'PNG 数据损坏（调色板图缺 PLTE）' })

  let raw: Uint8Array
  try {
    raw = inflateSync(idat.length > 0 ? Buffer.concat(idat.map((c) => Buffer.from(c))) : Buffer.alloc(0))
  } catch {
    throwError('CS-USER-ERR', { message: 'PNG 数据损坏（zlib 解压失败）' })
  }
  const bytesPerSample = bitDepth === 16 ? 2 : 1
  const bpp = channels * bytesPerSample
  const stride = Math.ceil(width * channels * bitDepth / 8)
  const expected = (stride + 1) * height
  if (raw.length < expected) throwError('CS-USER-ERR', { message: `PNG 数据损坏（像素数据不足：${raw.length} < ${expected}）` })

  // 逐行反滤波（PNG 规范 §6；滤波字节独立于 bpp 对齐）。
  const lines: Uint8Array[] = []
  let prev = new Uint8Array(stride)
  let cursor = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor]
    cursor += 1
    const line = raw.slice(cursor, cursor + stride)
    cursor += stride
    for (let x = 0; x < stride; x += 1) {
      const raw0 = line[x] ?? 0
      const a = x >= bpp ? line[x - bpp] ?? 0 : 0
      const b = prev[x] ?? 0
      const c = x >= bpp ? prev[x - bpp] ?? 0 : 0
      if (filter === 1) line[x] = (raw0 + a) & 0xff
      else if (filter === 2) line[x] = (raw0 + b) & 0xff
      else if (filter === 3) line[x] = (raw0 + ((a + b) >> 1)) & 0xff
      else if (filter === 4) line[x] = (raw0 + paeth(a, b, c)) & 0xff
      else if (filter !== 0) throwError('CS-USER-ERR', { message: `PNG 数据损坏（未知行滤波 ${filter}）` })
    }
    lines.push(line)
    prev = line
  }

  // 解包成 RGBA8。
  const rgba = new Uint8Array(width * height * 4)
  const readSample = (line: Uint8Array, index: number): number =>
    bytesPerSample === 2 ? line[index * 2] ?? 0 : line[index] ?? 0
  const readPacked = (line: Uint8Array, index: number): number => {
    const perByte = 8 / bitDepth
    const byte = line[(index / perByte) | 0] ?? 0
    const shift = 8 - bitDepth * ((index % perByte) + 1)
    const mask = (1 << bitDepth) - 1
    return (byte >> shift) & mask
  }
  for (let y = 0; y < height; y += 1) {
    const line = lines[y] ?? new Uint8Array(stride)
    for (let x = 0; x < width; x += 1) {
      const out = (y * width + x) * 4
      let r = 0
      let g = 0
      let b = 0
      let a = 255
      if (colorType === 0) {
        const v = bitDepth < 8 ? readPacked(line, x) : readSample(line, x)
        r = g = b = v
      } else if (colorType === 2) {
        r = readSample(line, x * 3)
        g = readSample(line, x * 3 + 1)
        b = readSample(line, x * 3 + 2)
      } else if (colorType === 3) {
        const idx = bitDepth < 8 ? readPacked(line, x) : readSample(line, x)
        r = palette![idx * 3] ?? 0
        g = palette![idx * 3 + 1] ?? 0
        b = palette![idx * 3 + 2] ?? 0
        if (transparency !== null && idx < transparency.length) a = transparency[idx] ?? 255
      } else if (colorType === 4) {
        const v = readSample(line, x * 2)
        r = g = b = v
        a = readSample(line, x * 2 + 1)
      } else {
        r = readSample(line, x * 4)
        g = readSample(line, x * 4 + 1)
        b = readSample(line, x * 4 + 2)
        a = readSample(line, x * 4 + 3)
      }
      rgba[out] = r
      rgba[out + 1] = g
      rgba[out + 2] = b
      rgba[out + 3] = a
    }
  }
  return { width, height, rgba, bitDepth, colorType }
}

const pct = (value: number, total: number): number => Math.round(value / total * 1000) / 10

/** 基础信息（格式 / 尺寸 / 位深）。非 PNG 显式报错（带替代路径提示）。 */
export function profileImage(buf: Uint8Array): ImageProfile {
  const decoded = decodePng(buf)
  return {
    format: 'png',
    width: decoded.width,
    height: decoded.height,
    bitDepth: decoded.bitDepth,
    colorType: COLOR_TYPE_LABEL[decoded.colorType] ?? `未知(${decoded.colorType})`,
    bytes: buf.length,
  }
}

/**
 * 亮度阈值包围盒：`dark` = 亮度 ≤ threshold 的像素（定位「屏幕暗区 / 深色主体」），
 * `bright` = ≥ threshold（定位「高光 / 白底」）。亮度用 Rec.601 加权。
 * 超大图按行抽样，把参与像素压到 ~400 万以内（bbox 精度损失 ≤1px 量级）。
 *
 * REQ-035 F-06：新增 `region`（像素矩形）。深色屏幕落在深色背景上时，全图 bbox 会退化成
 * 「整张图」（2026-10-24 实测 threshold 收到 8 仍占 97.3% 宽），agent 只好自己手写 PNG
 * 解码器。限定扫描区后，同一个阈值就能给出屏幕本身的矩形。
 */
export function luminanceBBox(
  decoded: DecodedPng,
  polarity: 'dark' | 'bright',
  threshold: number,
  region?: PixelRegion,
): LuminanceBBox | null {
  const { width, height, rgba } = decoded
  const x0Bound = Math.max(0, Math.min(width - 1, region?.x0 ?? 0))
  const y0Bound = Math.max(0, Math.min(height - 1, region?.y0 ?? 0))
  const x1Bound = Math.max(x0Bound, Math.min(width - 1, region?.x1 ?? width - 1))
  const y1Bound = Math.max(y0Bound, Math.min(height - 1, region?.y1 ?? height - 1))
  const scanned = (x1Bound - x0Bound + 1) * (y1Bound - y0Bound + 1)
  const step = scanned > 4_000_000 ? Math.ceil(Math.sqrt(scanned / 4_000_000)) : 1
  let x0 = -1
  let y0 = -1
  let x1 = -1
  let y1 = -1
  let hits = 0
  for (let y = y0Bound; y <= y1Bound; y += step) {
    for (let x = x0Bound; x <= x1Bound; x += step) {
      const at = (y * width + x) * 4
      const lum = 0.299 * (rgba[at] ?? 0) + 0.587 * (rgba[at + 1] ?? 0) + 0.114 * (rgba[at + 2] ?? 0)
      const hit = polarity === 'dark' ? lum <= threshold : lum >= threshold
      if (!hit) continue
      hits += 1
      if (x0 < 0 || x < x0) x0 = x
      if (x > x1) x1 = x
      if (y0 < 0 || y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (hits === 0) return null
  return {
    polarity,
    x0,
    y0,
    x1,
    y1,
    centerX: pct(x0 + x1 + 1, width * 2),
    centerY: pct(y0 + y1 + 1, height * 2),
    widthPct: pct(x1 - x0 + 1, width),
    heightPct: pct(y1 - y0 + 1, height),
    // 覆盖率的分母是**扫描区**（不是全图）：限定 region 后它就是"这块区域里有多少命中"，
    // 与"包围盒退化"的判据同一口径。
    coveragePct: pct(hits * step * step, scanned),
    threshold,
  }
}

/**
 * 粗粒度亮度网格（REQ-035 F-06）。
 *
 * 为什么需要它：`bbox-*` 只给"整体最暗/最亮的包络"，而"手表屏幕在画面哪个位置"
 * 本质是**空间分布**问题。给一张 32×18 的均值亮度表 + 最暗块坐标，模型就能自己
 * 读出"右偏中部的暗矩形"，不用再手写 ASCII 亮度图（事故里为此写了 9 个脚本）。
 */
export interface LuminanceGridCell {
  row: number
  col: number
  /** 该块平均亮度 0–255。 */
  meanLum: number
  /** 块中心在画布上的百分比坐标（与 render_composition 的 box 同口径）。 */
  centerX: number
  centerY: number
}

export interface LuminanceGrid {
  cols: number
  rows: number
  /** 行优先的均值矩阵（0–255），可直接当文本表打印。 */
  matrix: number[][]
  /** 最暗的一块 / 最亮的一块（含画布百分比矩形，可直接当轨道 box 用）。 */
  darkest: { row: number; col: number; meanLum: number; centerX: number; centerY: number; widthPct: number; heightPct: number }
  brightest: { row: number; col: number; meanLum: number; centerX: number; centerY: number; widthPct: number; heightPct: number }
}

export function luminanceGrid(decoded: DecodedPng, cols: number, rows: number): LuminanceGrid {
  const c = Math.max(2, Math.min(96, Math.floor(cols)))
  const r = Math.max(2, Math.min(96, Math.floor(rows)))
  const { width, height, rgba } = decoded
  const matrix: number[][] = []
  for (let row = 0; row < r; row += 1) {
    const line: number[] = []
    const ys = Math.floor((row * height) / r)
    const ye = Math.max(ys, Math.floor(((row + 1) * height) / r) - 1)
    for (let col = 0; col < c; col += 1) {
      const xs = Math.floor((col * width) / c)
      const xe = Math.max(xs, Math.floor(((col + 1) * width) / c) - 1)
      // 大图按步长抽样：每块最多约 400 点，够稳定又不会拖慢
      const step = Math.max(1, Math.ceil(Math.sqrt(((xe - xs + 1) * (ye - ys + 1)) / 400)))
      let sum = 0
      let n = 0
      for (let y = ys; y <= ye; y += step) {
        for (let x = xs; x <= xe; x += step) {
          const at = (y * width + x) * 4
          sum += 0.299 * (rgba[at] ?? 0) + 0.587 * (rgba[at + 1] ?? 0) + 0.114 * (rgba[at + 2] ?? 0)
          n += 1
        }
      }
      line.push(n === 0 ? 0 : Math.round(sum / n))
    }
    matrix.push(line)
  }
  const cellRect = (row: number, col: number): LuminanceGrid['darkest'] => ({
    row,
    col,
    meanLum: matrix[row]?.[col] ?? 0,
    centerX: pct((col + 0.5) * width / c, width),
    centerY: pct((row + 0.5) * height / r, height),
    widthPct: pct(width / c, width),
    heightPct: pct(height / r, height),
  })
  let darkest: LuminanceGrid['darkest'] = cellRect(0, 0)
  let brightest: LuminanceGrid['brightest'] = cellRect(0, 0)
  for (let row = 0; row < r; row += 1) {
    for (let col = 0; col < c; col += 1) {
      const lum = matrix[row]?.[col] ?? 0
      if (lum < darkest.meanLum) darkest = cellRect(row, col)
      if (lum > brightest.meanLum) brightest = cellRect(row, col)
    }
  }
  return { cols: c, rows: r, matrix, darkest, brightest }
}

/**
 * 主色分布：每通道量化到 16 级（4bit，量化容差 ≈ ±8/255），按占比降序取前 N。
 * 忽略 α < 128 的像素（透明区不计色）。
 */
export function dominantColors(decoded: DecodedPng, topN: number): DominantColor[] {
  const { width, height, rgba } = decoded
  const total = width * height
  const step = total > 4_000_000 ? Math.ceil(Math.sqrt(total / 4_000_000)) : 1
  const counts = new Map<number, number>()
  let counted = 0
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const at = (y * width + x) * 4
      if ((rgba[at + 3] ?? 0) < 128) continue
      const key = (rgba[at] ?? 0) >> 4 << 8 | (rgba[at + 1] ?? 0) >> 4 << 4 | (rgba[at + 2] ?? 0) >> 4
      counts.set(key, (counts.get(key) ?? 0) + 1)
      counted += 1
    }
  }
  if (counted === 0) return []
  const hex = (key: number): string =>
    '#' + [key >> 8 & 0xf, key >> 4 & 0xf, key & 0xf].map((v) => v * 17).map((v) => v.toString(16).padStart(2, '0')).join('')
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, Math.min(topN, 16)))
    .map(([key, count]) => ({ hex: hex(key), pct: pct(count, counted) }))
}
