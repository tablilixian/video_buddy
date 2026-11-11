/**
 * ≥95% 对齐 S3（2026-11-11）：**cardWall 构件容器化**。
 *
 * 旧实现「每卡自带透视、一卡一 shape 轨」被推翻：#14 实证容器包 62 张平面子卡
 * = 1 个 WebGL 层、统一灭点。本文件钉住容器化契约 —— 改坏任何一条，分数与
 * 观感会一起退化，但这里必须先红。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { expandFurniture, FURNITURE_DEFAULTS } from '../lib/remotion/furniture.js'

const CTX = { canvasWidth: 1920, canvasHeight: 1080, fps: 60, totalFrames: 1440 }
const RANGE = { startFrame: 0, endFrame: 336 }

function expand(params = {}) {
  const out = expandFurniture({ id: 'cardWall', params, ...RANGE }, CTX)
  assert.equal(out.length, 1, '容器化后整面墙 = 1 条 group 轨（一卡一轨是旧世界）')
  return out[0]
}

test('S3 ★容器化：1 条 group 轨 + 62 张平面子卡 + 24 条条纹', () => {
  const wall = expand()
  assert.equal(wall.type, 'group')
  assert.equal(wall.id, 'fx-card-wall')
  const cards = wall.children.filter((c) => c.id.startsWith('fx-card-'))
  const stripes = wall.children.filter((c) => c.id.startsWith('fx-stripe-'))
  assert.equal(cards.length, FURNITURE_DEFAULTS.cardWall.count, '62 张卡（计划 U1 的口径）')
  assert.equal(stripes.length, 24, '8 张特征卡 × 3 条条纹')
  for (const child of wall.children) {
    assert.equal(child.type, 'shape', '子卡必须是平面 shape（子轨 3D 会被校验层 warning）')
    assert.ok(!child.transform, '子卡不许自带 3D 姿势 —— 3D 只属于容器')
    assert.ok(child.startFrame >= 0 && child.startFrame < wall.durationInFrames, '子轨窗口在组内')
  }
  // 子轨 id 全量唯一（S1-B 校验也会查，这里失败信息更直接）
  const ids = new Set(wall.children.map((c) => c.id))
  assert.equal(ids.size, wall.children.length)
})

test('S3 ★容器 3D：静态角度 + 推近 animate（linear 全程）+ 段边界 1 帧退场', () => {
  const wall = expand()
  assert.deepEqual(wall.transform, { perspective: 1100, rotateX: 14, rotateY: -8 })
  assert.equal(Array.isArray(wall.animate), true)
  const push = wall.animate[0]
  assert.equal(push.easing, 'linear', '推近必须匀速（连续帧差是运动峰值的来源）')
  assert.equal(push.durationInFrames, 336)
  assert.ok(push.from.scale < 1 && push.to.scale > 1, '推近 = 由远及近（scale 递增）')
  assert.deepEqual(wall.exit, { to: { opacity: 0 }, durationInFrames: 1 }, 'ML-02：fadeFrames:0 的墙必须有退场')
})

test('S3 ★批次节奏：首批 16 张落在 0 帧，批距 37 帧（对齐参考片 0.6s 运动峰值间隔）', () => {
  const wall = expand()
  const cardStarts = new Map()
  for (const c of wall.children) {
    if (!c.id.startsWith('fx-card-')) continue
    cardStarts.set(c.id, c.startFrame)
  }
  const frames = [...new Set(cardStarts.values())].sort((a, b) => a - b)
  assert.equal(frames[0], 0, '首批 0 帧（ref@0s 墙已亮起，luma 0.15）')
  for (let i = 1; i < frames.length; i += 1) {
    assert.equal(frames[i] - frames[i - 1], 37, '批距恒定（确定性节奏；37 帧 = 峰值采样落点对齐）')
  }
  const firstBatch = [...cardStarts.values()].filter((f) => f === 0).length
  assert.equal(firstBatch, 16, '首批 16 张大块亮起（参考片开场整批出现的亮度事件）')
  assert.equal(cardStarts.size, FURNITURE_DEFAULTS.cardWall.count)
})

test('S4 ★辉光脉冲：9 条 glow 子轨（colorShift 亮→暗 + exit），子轨总数 ≤96', () => {
  const wall = expand()
  const glows = wall.children.filter((c) => c.id.startsWith('fx-glow-'))
  assert.equal(glows.length, 9, '每批次一条辉光（9 批次）')
  for (const g of glows) {
    assert.equal(g.type, 'shape')
    assert.ok(g.colorShift, '辉光必须带 colorShift（亮→暗衰减）')
    assert.equal(g.colorShift.easing, 'easeIn', 'easeIn = 先 hold 住亮、后段快衰减（采样落点抓得住）')
    assert.ok(g.exit, 'fadeFrames:0 的辉光子轨必须有 exit（ML-02）')
  }
  assert.ok(wall.children.length <= 96, 'S1-B 子轨硬上限 96')
  assert.equal(wall.children.filter((c) => c.id.startsWith('fx-card-')).length, 62)
  assert.equal(wall.children.filter((c) => c.id.startsWith('fx-stripe-')).length, 24)
})

test('S3 ★确定性：同参数逐字节同结果；网格越界格位合法', () => {
  const a = JSON.stringify(expand())
  const b = JSON.stringify(expand())
  assert.equal(a, b)
  const wall = expand()
  for (const c of wall.children) {
    // 墙面网格故意越出画布（推近时边缘卡才在画面里）；但必须是有界实数
    assert.ok(Number.isFinite(c.box.x) && Math.abs(c.box.x) < 200, '格位是有界百分比')
  }
})

test('S3 ★参数守卫：count 超容量 / perspective 过小 / 尺寸非法 → 抛错不静默', () => {
  assert.throws(() => expand({ count: 700 }), /超过网格容量/)
  assert.throws(() => expand({ perspective: 100 }), /≥ 200px/)
  assert.throws(() => expand({ cardW: 0 }), /必须 > 0/)
  assert.throws(() => expand({ count: 64 }), /超过网格容量/, '64 > 9×7=63，超容量必须拒收')
})
