/**
 * 复刻提效批二：`image_crop` 纯函数层回归。
 *
 * 抓的是什么：拼贴图的**取格算术**（均分余数归最后一格 —— 1280 分 3 列是 426/426/428，
 * 少算一格就裁掉 2px 内容）与**越界判据**（ffmpeg 的 crop 会把超界矩形静默收进画面，
 * 产物「成功」但内容是错的，所以必须在调 ffmpeg 之前严格拒收）。
 *
 * 另含 `summarizeCrop` 自证：模型已能 read_image 直接读图（语义给 read_image），
 * 「裁对了没有」仍以这几个可复算数字为准（CV-435 拍板：数值自检不随能力恢复而删）。
 *
 * 直连 Host tsc 编译产物 `lib/image-crop.js`（先 build 再跑；全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCropArgs,
  gridToRect,
  rectWithin,
  resolveCropSource,
  summarizeCrop,
} from '../lib/image-crop.js'

test('gridToRect：1280×480 六格拼贴（2 行 3 列）逐格取位，余数归最后一列', () => {
  const g = (row, col) => gridToRect({ rows: 2, cols: 3, row, col }, 1280, 480)
  assert.deepEqual(g(1, 1), { x: 0, y: 0, w: 426, h: 240 })
  assert.deepEqual(g(1, 2), { x: 426, y: 0, w: 426, h: 240 })
  // 1280 - 426*2 = 428：最后一列吃掉 2px 余数，保证三列拼起来覆盖整宽
  assert.deepEqual(g(1, 3), { x: 852, y: 0, w: 428, h: 240 })
  assert.deepEqual(g(2, 3), { x: 852, y: 240, w: 428, h: 240 })
  // 覆盖性自检：三列 x+w 必须严格衔接到 1280，不留缝也不越界
  const last = g(1, 3)
  assert.equal(last.x + last.w, 1280)
})

test('gridToRect：越界 / 非法网格显式报错（不静默纠正）', () => {
  assert.throws(() => gridToRect({ rows: 2, cols: 3, row: 3, col: 1 }, 1280, 480), /grid\.row 超出范围/u)
  assert.throws(() => gridToRect({ rows: 2, cols: 3, row: 1, col: 4 }, 1280, 480), /grid\.col 超出范围/u)
  assert.throws(() => gridToRect({ rows: 99, cols: 1, row: 1, col: 1 }, 1280, 480), /上限/u)
  assert.throws(() => gridToRect({ rows: 2, cols: 3, row: 0, col: 1 }, 1280, 480), /必须 ≥ 1/u)
  assert.throws(() => gridToRect({ rows: 2, cols: 3, row: Number.NaN, col: 1 }, 1280, 480), /必须是数字/u)
})

test('rectWithin：超界报错必须带源尺寸与当前 x/y 下的最大可用宽高', () => {
  assert.deepEqual(rectWithin({ x: 10, y: 20, w: 100, h: 50 }, 1280, 480), { x: 10, y: 20, w: 100, h: 50 })
  assert.throws(
    () => rectWithin({ x: 900, y: 0, w: 400, h: 100 }, 1280, 480),
    (error) => {
      assert.match(error.message, /1280×480/u)
      assert.match(error.message, /最大 w=380/u)
      return true
    },
  )
  assert.throws(() => rectWithin({ x: 1280, y: 0, w: 10, h: 10 }, 1280, 480), /左上角/u)
  assert.throws(() => rectWithin({ x: 0, y: 0, w: 0, h: 10 }, 1280, 480), /rect\.w 必须 ≥ 1/u)
})

test('buildCropArgs：crop=w:h:x:y 顺序不可错（ffmpeg 的 w/h 在前）+ 单帧 RGBA', () => {
  const args = buildCropArgs('/tmp/a.png', '/tmp/b.png', { x: 852, y: 240, w: 428, h: 240 })
  assert.equal(args[args.indexOf('-vf') + 1], 'crop=428:240:852:240')
  assert.equal(args[args.indexOf('-pix_fmt') + 1], 'rgba')
  assert.equal(args[args.indexOf('-frames:v') + 1], '1')
  assert.equal(args.at(-1), '/tmp/b.png')
})

test('resolveCropSource：资产 URL / 项目内绝对路径放行，跨项目与项目外一律拒', () => {
  const assetsDir = '/root/projects/p1/assets'
  const registry = {
    registryRoot: '/root/projects',
    assetsDir: () => assetsDir,
  }
  assert.equal(
    resolveCropSource('/canvas-studio/assets/p1/abc.png', registry, 'p1'),
    `${assetsDir}/abc.png`,
  )
  assert.equal(resolveCropSource(`${assetsDir}/abc.png`, registry, 'p1'), `${assetsDir}/abc.png`)
  assert.throws(() => resolveCropSource('/canvas-studio/assets/p2/abc.png', registry, 'p1'), /其它项目/u)
  assert.throws(() => resolveCropSource('/etc/passwd', registry, 'p1'), /项目目录之外/u)
  assert.throws(() => resolveCropSource('abc.png', registry, 'p1'), /绝对路径/u)
  assert.throws(() => resolveCropSource('/canvas-studio/assets/p1/..%2F..%2Fsecret', registry, 'p1'), /不合法/u)
})

/** 直接构造 DecodedPng（绕开 PNG 编解码，只测统计逻辑）。 */
function decoded(width, height, paint) {
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = paint(x, y)
      const at = (y * width + x) * 4
      rgba[at] = r
      rgba[at + 1] = g
      rgba[at + 2] = b
      rgba[at + 3] = a
    }
  }
  return { width, height, rgba, bitDepth: 8, colorType: 6 }
}

test('summarizeCrop：左白右黑的图，四边色与亮度图必须一致指向「左亮右暗」', () => {
  const img = decoded(16, 8, (x) => (x < 8 ? [255, 255, 255, 255] : [0, 0, 0, 255]))
  const p = summarizeCrop(img)
  assert.equal(p.width, 16)
  assert.equal(p.height, 8)
  assert.equal(p.alphaPct, 0, '全不透明')
  assert.equal(p.edges.top, '#808080', '上边跨左右各半 ⇒ 平均中灰')
  assert.equal(p.luminanceRows.length, 4)
  for (const row of p.luminanceRows) {
    assert.equal(row.length, 8, `每行必须 8 列，实测 ${row.length}`)
    const leftHalf = row.slice(0, 4)
    const rightHalf = row.slice(4)
    assert.notEqual(leftHalf[0], rightHalf.at(-1), '左半必须比右半亮（这行就是错裁的检测信号）')
  }
})

test('summarizeCrop：透明区计入 alphaPct，主色只在可见像素里算', () => {
  // 上半全透明、下半全白 —— 抠图产物常见的形态。
  const img = decoded(10, 10, (_x, y) => (y < 5 ? [255, 255, 255, 0] : [255, 255, 255, 255]))
  const p = summarizeCrop(img)
  assert.ok(Math.abs(p.alphaPct - 50) < 1, `透明率应 ≈50%，实测 ${p.alphaPct}`)
  assert.equal(p.topColors[0], '#ffffff(100%)', `主色应只统计不透明像素，实测 ${p.topColors[0]}`)
})
