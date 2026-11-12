/**
 * 零依赖 PNG 编码器（RGBA8 → PNG）。
 *
 * 为什么需要它：playsout 复刻里有三类画面**不能**用 CSS 表达 ——
 *   ① `radial-gradient` 光晕（web-renderer 的 DOM composer 不吃 CSS 径向渐变，
 *      能力基准 #16 实证「CSS radial-gradient 平铺被整个忽略」）；
 *   ② 渐变压暗条（底部 / 顶部 scrim，方向性 linear-gradient 同样没有 DSL 出口）；
 *   ③ 灰阶 logo（`filter: grayscale()` 在 CSR 捕获路径下读不到）。
 * 这三类一律**预生成 PNG**（工程手段，不是抄实现），再作为 `image` 轨进 manifest。
 *
 * 只做「RGBA 像素数组 → PNG 字节」这一件事；不解码、不压缩优化、不调色板。
 * 压缩走 Node 内置 `zlib`（deflate level 9，确定性输出）。
 */
import { deflateSync } from 'node:zlib'

/** CRC32 表（PNG chunk 校验用）。 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  const crcInput = Buffer.concat([Buffer.from(type, 'ascii'), data])
  out.writeUInt32BE(crc32(crcInput), data.length + 8)
  return out
}

/**
 * 把 RGBA 像素数组编码成 PNG。
 *
 * @param {number} width 像素宽
 * @param {number} height 像素高
 * @param {Uint8Array} rgba 长度必须是 width*height*4
 * @returns {Buffer} PNG 字节
 */
export function encodePng(width, height, rgba) {
  if (rgba.length !== width * height * 4) {
    throw new Error(`像素长度不符：期望 ${width * height * 4}，实际 ${rgba.length}`)
  }
  // 每行前置一个 filter 字节（0 = None）。不做逐行滤波：这些图都是渐变，
  // deflate 对「None + 平滑渐变」的压缩已经足够，且滤波会引入实现差异。
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * 建一张 RGBA 画布，逐像素回调填充。
 *
 * @param {number} width
 * @param {number} height
 * @param {(x: number, y: number) => [number, number, number, number]} shade
 * @returns {{ width: number, height: number, data: Uint8Array }}
 */
export function createCanvas(width, height, shade) {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = shade(x, y)
      const i = (y * width + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a
    }
  }
  return { width, height, data }
}

/** `#rrggbb` → [r, g, b]。 */
export function hexToRgb(hex) {
  const s = hex.replace('#', '')
  return [
    Number.parseInt(s.slice(0, 2), 16),
    Number.parseInt(s.slice(2, 4), 16),
    Number.parseInt(s.slice(4, 6), 16),
  ]
}

/** 线性插值两个 0–255 标量。 */
export function lerp(a, b, t) {
  return a + (b - a) * t
}

/** 平滑阶跃（smoothstep），用于光晕的柔和衰减。 */
export function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}
