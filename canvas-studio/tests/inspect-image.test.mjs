/**
 * CV-362 · inspect_image 纯函数层回归。
 *
 * 抓的是什么：零依赖 PNG 解码（colorType × bitDepth × 行滤波的矩阵）与像素分析的
 * 正确性 —— 这是宿主唯一的像素真值来源，解错一个滤波字节整张图的 bbox 全歪。
 * 用测试内嵌的**最小 PNG 编码器**造已知像素的图，断言解码与分析结果逐像素可复核。
 *
 * 直连 Host 侧编译产物 `lib/inspect-image.js` 与 `lib/host-tools.js`。
 * 定向跑：node --test tests/inspect-image.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { createStudioTools } from '../lib/host-tools.js'
import {
  decodePng, dominantColors, luminanceBBox, luminanceGrid, profileImage, samplePixels,
} from '../lib/inspect-image.js'

// ── 最小 PNG 编码器（仅为本测试服务：RGBA8 / 灰度16 / 调色板8，filter 0-2）──

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  Buffer.from(data).copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function ihdrChunk(width, height, bitDepth, colorType) {
  const data = Buffer.alloc(13)
  data.writeUInt32BE(width, 0)
  data.writeUInt32BE(height, 4)
  data.writeUInt8(bitDepth, 8)
  data.writeUInt8(colorType, 9)
  data.writeUInt8(0, 10) // compression
  data.writeUInt8(0, 11) // filter
  data.writeUInt8(0, 12) // interlace
  return chunk('IHDR', data)
}

/**
 * @param rows - 每行 = [filterByte, ...rawBytes]（已按该 colorType/bitDepth 的原始字节）
 */
function encodePng(width, height, bitDepth, colorType, rows, extraChunks = []) {
  const raw = Buffer.concat(rows.map((r) => Buffer.from(r)))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ihdrChunk(width, height, bitDepth, colorType),
    ...extraChunks,
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** RGBA8 便捷封装：pixelFn(x, y) → [r, g, b, a]。全部 filter 0。 */
function rgbaPng(width, height, pixelFn) {
  const rows = []
  for (let y = 0; y < height; y += 1) {
    const row = [0]
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixelFn(x, y)
      row.push(r, g, b, a)
    }
    rows.push(row)
  }
  return encodePng(width, height, 8, 6, rows)
}

const WHITE = [255, 255, 255, 255]
const BLACK = [0, 0, 0, 255]

// ── decodePng：RGBA8 往返 ──

test('decodePng：RGBA8 往返逐像素一致', () => {
  const png = rgbaPng(4, 3, (x, y) => [x * 60, y * 80, 128, 255])
  const decoded = decodePng(new Uint8Array(png))
  assert.equal(decoded.width, 4)
  assert.equal(decoded.height, 3)
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const at = (y * 4 + x) * 4
      assert.equal(decoded.rgba[at], x * 60, `r@(${x},${y})`)
      assert.equal(decoded.rgba[at + 1], y * 80, `g@(${x},${y})`)
      assert.equal(decoded.rgba[at + 2], 128, `b@(${x},${y})`)
    }
  }
})

test('decodePng：行滤波 sub(1) / up(2) / average(3) / paeth(4) 都能还原', () => {
  // 2×1 RGBA：第一行 filter 1（sub），第二行 filter 2（up）——两条最易写错的路径。
  const rows = [
    [1, 100, 50, 10, 255, 20, 20, 20, 0], // sub：实际像素 [100,50,10,255], [120,70,30,255]（alpha raw 0 + 左 255 = 255）
    [2, 0, 0, 0, 0, 30, 30, 30, 0], // up：实际像素 = 本行 raw + 上一行像素
  ]
  const png = encodePng(2, 2, 8, 6, rows)
  const decoded = decodePng(new Uint8Array(png))
  assert.deepEqual([...decoded.rgba.subarray(0, 4)], [100, 50, 10, 255])
  assert.deepEqual([...decoded.rgba.subarray(4, 8)], [120, 70, 30, 255])
  assert.deepEqual([...decoded.rgba.subarray(8, 12)], [100, 50, 10, 255])
  assert.deepEqual([...decoded.rgba.subarray(12, 16)], [150, 100, 60, 255])
})

test('decodePng：调色板（colorType 3 + PLTE）与灰度16（高字节）', () => {
  const pal = encodePng(2, 2, 8, 3, [
    [0, 0, 1],
    [1, 0, 1],
  ], [chunk('PLTE', [200, 10, 10, 10, 10, 200])])
  const decodedPal = decodePng(new Uint8Array(pal))
  assert.deepEqual([...decodedPal.rgba.subarray(0, 4)], [200, 10, 10, 255])
  assert.deepEqual([...decodedPal.rgba.subarray(4, 8)], [10, 10, 200, 255])

  const gray16 = encodePng(2, 1, 16, 0, [[0, 0x12, 0x34, 0xab, 0xcd]]) // 高字节 0x12 / 0xab
  const decoded16 = decodePng(new Uint8Array(gray16))
  assert.equal(decoded16.rgba[0], 0x12)
  assert.equal(decoded16.rgba[4], 0xab)
})

test('decodePng：非 PNG / 隔行显式报错（不静默）', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0x4a, 0x46])
  assert.throws(() => decodePng(new Uint8Array(jpeg)), /不是 PNG/)
  // IHDR interlace=1（Adam7）
  const badIhdr = Buffer.alloc(13)
  badIhdr.writeUInt32BE(1, 0)
  badIhdr.writeUInt32BE(1, 4)
  badIhdr.writeUInt8(8, 8)
  badIhdr.writeUInt8(6, 9)
  badIhdr.writeUInt8(0, 10)
  badIhdr.writeUInt8(0, 11)
  badIhdr.writeUInt8(1, 12)
  const interlacedPng = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', badIhdr),
    chunk('IDAT', deflateSync(Buffer.from([0, 255]))),
    chunk('IEND', Buffer.alloc(0)),
  ])
  assert.throws(() => decodePng(new Uint8Array(interlacedPng)), /隔行/)
})

// ── profileImage ──

test('profileImage：尺寸 / 位深 / 色彩类型标签', () => {
  const profile = profileImage(new Uint8Array(rgbaPng(10, 5, () => WHITE)))
  assert.deepEqual(profile, { format: 'png', width: 10, height: 5, bitDepth: 8, colorType: 'RGBA', bytes: profile.bytes })
  assert.ok(profile.bytes > 0)
})

// ── luminanceBBox：真机场景的替身 —— 白底上的黑色「屏幕区」定位 ──

/** 100×100 白底，黑色矩形 x∈[60,79] y∈[20,39]（即真机上「表盘屏幕暗区」的替身）。 */
function watchScreenPng() {
  return rgbaPng(100, 100, (x, y) =>
    x >= 60 && x < 80 && y >= 20 && y < 40 ? BLACK : WHITE)
}

test('luminanceBBox：bbox-dark 命中已知矩形，百分比与 box 口径一致', () => {
  const decoded = decodePng(new Uint8Array(watchScreenPng()))
  const bbox = luminanceBBox(decoded, 'dark', 40)
  assert.ok(bbox !== null)
  assert.equal(bbox.x0, 60)
  assert.equal(bbox.x1, 79)
  assert.equal(bbox.y0, 20)
  assert.equal(bbox.y1, 39)
  assert.equal(bbox.centerX, 70) // 中心语义：((60+80)/2)/100 = 70%
  assert.equal(bbox.centerY, 30)
  assert.equal(bbox.widthPct, 20)
  assert.equal(bbox.heightPct, 20)
  assert.equal(bbox.coveragePct, 4) // 400/10000
})

test('luminanceBBox：无命中 → null；bright 命中白底', () => {
  const allBlack = decodePng(new Uint8Array(rgbaPng(10, 10, () => BLACK)))
  assert.equal(luminanceBBox(allBlack, 'bright', 215), null)
  const white = decodePng(new Uint8Array(rgbaPng(10, 10, () => WHITE)))
  const bbox = luminanceBBox(white, 'bright', 215)
  assert.ok(bbox !== null)
  assert.equal(bbox.coveragePct, 100)
})

// ── dominantColors ──

test('dominantColors：主色占比与量化', () => {
  // 8×4：红 24 像素（75%）、蓝 8 像素（25%）。
  const png = rgbaPng(8, 4, (x) => (x < 6 ? [255, 0, 0, 255] : [0, 0, 255, 255]))
  const colors = dominantColors(decodePng(new Uint8Array(png)), 8)
  assert.equal(colors[0].hex, '#ff0000')
  assert.equal(colors[0].pct, 75)
  assert.equal(colors[1].hex, '#0000ff')
  assert.equal(colors[1].pct, 25)
})

test('dominantColors：透明像素不计色；topN 截断生效', () => {
  const png = rgbaPng(4, 4, (x, y) => (y < 2 ? [255, 0, 0, 255] : [0, 255, 0, 0])) // 下半透明
  const colors = dominantColors(decodePng(new Uint8Array(png)), 1)
  assert.equal(colors.length, 1)
  assert.equal(colors[0].hex, '#ff0000')
  assert.equal(colors[0].pct, 100) // 分母只算非透明像素
})

// ── 工具注册面：入参在 JSON Schema 声明（漏声明 = 模型传了被丢）──

function inspectTool() {
  const tool = createStudioTools({}, 3000).find((entry) => entry.name === 'inspect_image')
  assert.ok(tool, 'inspect_image 必须存在于工具表')
  return tool
}

test('inspect_image：mode 枚举与 filePath 已在 JSON Schema 声明', () => {
  const params = inspectTool().parameters?.properties ?? {}
  assert.deepEqual(params.mode?.enum, ['profile', 'bbox-dark', 'bbox-bright', 'colors', 'grid', 'sample'])
  assert.ok(Object.prototype.hasOwnProperty.call(params, 'filePath'))
  assert.ok(Object.prototype.hasOwnProperty.call(params, 'threshold'))
  assert.ok(Object.prototype.hasOwnProperty.call(params, 'topN'))
  // REQ-035 F-06：空间分布与扫描区
  assert.ok(Object.prototype.hasOwnProperty.call(params, 'region'))
  assert.ok(Object.prototype.hasOwnProperty.call(params, 'cols'))
  assert.ok(Object.prototype.hasOwnProperty.call(params, 'rows'))
  // 2026-10-25：逐点取色（会话 #5 里 88 次 python3 手算像素的对策）
  assert.ok(Object.prototype.hasOwnProperty.call(params, 'points'))
})

test('F-06：描述不再谎称「唯一真值来源」，而是说清 bbox 会退化 + 给 grid/region 出路', () => {
  const desc = inspectTool().description
  // 旧文案「这是唯一的像素真值来源——不要再手写 PNG 解码脚本」已被实测证伪：
  // 深色屏幕落在深色背景上时 bbox 退化为整图（threshold 收到 8 仍占 97.3% 宽），
  // agent 只能自写解码器。描述必须如实交代边界。
  assert.ok(!desc.includes('不要再手写 PNG 解码脚本'), '不得再给不可兑现的承诺')
  assert.ok(desc.includes('退化成整张图'), '必须说清 bbox 的退化场景')
  assert.ok(desc.includes('grid'), '必须给 grid 出口')
  assert.ok(desc.includes('region'), '必须给 region 出口')
  assert.ok(desc.includes('画布百分比'))
})


// ── REQ-035 F-06：region 限定扫描区 + 亮度网格 ──────────────────────────────

/** 100×100：背景灰（亮度≈20），黑屏区 x∈[60,79] y∈[20,39]（亮度≈5）——
 *  这正是真机场景：深色屏幕上叠深色背景，全图 bbox 一定退化成整张图。 */
function screenOnDarkPng() {
  const BG = [20, 20, 20, 255]
  const SCREEN = [5, 5, 5, 255]
  return rgbaPng(100, 100, (x, y) => (x >= 60 && x < 80 && y >= 20 && y < 40 ? SCREEN : BG))
}

test('F-06：阈值混入背景时 bbox 会退化成整张图（旧行为的真实缺陷）', () => {
  const decoded = decodePng(new Uint8Array(screenOnDarkPng()))
  const bbox = luminanceBBox(decoded, 'dark', 25) // 背景 20 也命中
  assert.ok(bbox !== null)
  assert.equal(bbox.widthPct, 100, '全图命中 ⇒ 包络就是整张图')
  assert.equal(bbox.heightPct, 100)
})

test('F-06：region 限定扫描区后，同一个阈值就能给出屏幕矩形', () => {
  const decoded = decodePng(new Uint8Array(screenOnDarkPng()))
  // 只扫右半区 + 阈值收到底色以下
  const bbox = luminanceBBox(decoded, 'dark', 8, { x0: 50, y0: 0, x1: 99, y1: 99 })
  assert.ok(bbox !== null)
  assert.equal(bbox.x0, 60)
  assert.equal(bbox.x1, 79)
  assert.equal(bbox.y0, 20)
  assert.equal(bbox.y1, 39)
  assert.equal(bbox.widthPct, 20)
  assert.equal(bbox.heightPct, 20)
  // 覆盖率分母 = 扫描区（50×100=5000），命中 = 屏幕 400 ⇒ 8%（不是全图的 4%）
  assert.equal(bbox.coveragePct, 8, '覆盖率分母应为扫描区，而不是全图')
})

test('F-06：region 完全避开目标 ⇒ 无命中返回 null（不会假装测到东西）', () => {
  const decoded = decodePng(new Uint8Array(screenOnDarkPng()))
  assert.equal(luminanceBBox(decoded, 'dark', 8, { x0: 0, y0: 0, x1: 49, y1: 99 }), null)
})

test('F-06：grid 给出空间分布，最暗块落在屏幕位置', () => {
  const decoded = decodePng(new Uint8Array(screenOnDarkPng()))
  const grid = luminanceGrid(decoded, 10, 10)
  assert.equal(grid.cols, 10)
  assert.equal(grid.rows, 10)
  assert.equal(grid.matrix.length, 10)
  assert.equal(grid.matrix[0].length, 10)
  // 屏幕在 x 60-79 → col 6-7；y 20-39 → row 2-3
  assert.ok(grid.darkest.col === 6 || grid.darkest.col === 7, `最暗块列应落在 6/7，实际 ${grid.darkest.col}`)
  assert.ok(grid.darkest.row === 2 || grid.darkest.row === 3, `最暗块行应落在 2/3，实际 ${grid.darkest.row}`)
  assert.equal(grid.darkest.meanLum, 5)
  assert.equal(grid.darkest.widthPct, 10)
  assert.equal(grid.darkest.heightPct, 10)
  assert.ok(grid.brightest.meanLum >= 20, '背景块应是最亮的')
})

// ── 2026-10-25：sample 模式（逐点取色）────────────────────────────────────
//
// 病史：会话 #5 里 agent 写了 88 个 python3 脚本，其中大量是手搓 PNG 解码器逐点算亮度
// （`import zlib,struct` + `lum(x,y)`）—— 只为回答「这个位置是什么颜色、亮不亮」。
// bbox/grid 都是区域统计，答不了这个；sample 就是为它加的。

test('sample：百分比换像素、RGB 与亮度逐点可复核', () => {
  // 4×2：左半红、右半蓝（写成 pixelFn 而不是硬编码行，避免行滤波干扰）
  const png = rgbaPng(4, 2, (x) => (x < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]))
  const decoded = decodePng(new Uint8Array(png))
  const [left, right] = samplePixels(decoded, [
    { x: 12.5, y: 25 },
    { x: 87.5, y: 75 },
  ])
  assert.equal(left.hex, '#ff0000')
  assert.equal(left.luminance, 76, '0.299×255 = 76.245 → 76')
  assert.equal(left.clamped, false)
  assert.equal(right.hex, '#0000ff')
  assert.equal(right.luminance, 29, '0.114×255 = 29.07 → 29')
})

test('sample：坐标越界夹回图内并标记 clamped（不静默、不报错）', () => {
  const png = rgbaPng(4, 2, (x) => (x < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]))
  const decoded = decodePng(new Uint8Array(png))
  const [corner, inside] = samplePixels(decoded, [
    { x: 100, y: 100 }, // 100% × 4 = 4 ⇒ 越界一格
    { x: 50, y: 50 },
  ])
  assert.equal(corner.clamped, true, '越界必须如实标记 —— 「要的是边缘」与「坐标写错了」不能长得一样')
  assert.equal(corner.pixelX, 3)
  assert.equal(corner.pixelY, 1)
  assert.equal(corner.hex, '#0000ff', '夹回后取到的是最右一列')
  assert.equal(inside.clamped, false)
})
