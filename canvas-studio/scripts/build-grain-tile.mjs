/**
 * 三期 W2-4：生成颗粒 tile（`assets/remotion/grain.png`）。
 *
 * 为什么自己编码 PNG：沙箱装不了图像库，而这个 tile 只需要「确定性噪点」——
 * 用 32 位 LCG 生成 + 手写最小 PNG 编码（zlib 是 Node 内置），产物入库、可复现。
 *
 * 用法：node scripts/build-grain-tile.mjs [--size 256]
 *
 * ⚠️ 一旦改动生成逻辑，`meta.look.grain` 的观感会变（不是像素级回归，因为颗粒是
 * 「叠加层」）；但 tile 内容仍必须**确定**，否则同一 manifest 渲两次不一样。
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '..', 'assets', 'remotion', 'grain.png')
const sizeArg = process.argv.indexOf('--size')
const size = sizeArg >= 0 ? Number(process.argv[sizeArg + 1]) : 256
const SIZE = Number.isFinite(size) && size > 0 ? Math.floor(size) : 256

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crcBuf])
}

/** 32 位 LCG（与渲染端无关，只用于生成这份静态 tile）。 */
let seed = 0x9e3779b9
function nextRandom() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 0x100000000
}

// 灰度噪点：围绕 128 分布（overlay 混合下 128 ≈ 中性，只增加微对比）。
const raw = Buffer.alloc((SIZE * 3 + 1) * SIZE)
for (let y = 0; y < SIZE; y += 1) {
  const rowStart = y * (SIZE * 3 + 1)
  raw[rowStart] = 0 // filter: none
  for (let x = 0; x < SIZE; x += 1) {
    const value = Math.max(0, Math.min(255, Math.round(128 + (nextRandom() - 0.5) * 110)))
    const offset = rowStart + 1 + x * 3
    raw[offset] = value
    raw[offset + 1] = value
    raw[offset + 2] = value
  }
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 2 // color type: truecolor
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(`grain tile: ${out} (${SIZE}x${SIZE}, ${png.length} bytes)`)
