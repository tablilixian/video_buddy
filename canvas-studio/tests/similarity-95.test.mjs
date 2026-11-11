/**
 * S0 · `≥95% 对齐`验收尺子的自测。
 *
 * 尺子本身错了比没有尺子更坏：这里钉住 ① 纯函数的边界 ② 完美一致必须 100 分
 * ③ 单维塌了必须判不达标（防「靠黑底把总分堆上去」）④ 模板元素检测不许把
 * progressBar 冒充波形 / 圆点冒充绿勾（判据收紧的反向锚点）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WEIGHTS,
  REFERENCE_ELEMENTS,
  clamp01,
  closeness,
  frameStats,
  loudnessCloseness,
  motionPeaks,
  parseCuts,
  parseLoudness,
  perSecondStats,
  round4,
  scoreSimilarity,
  templateElements,
} from '../scripts/probe/similarity-95.probe.mjs'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'templates', 'tech', 'kinetic-promo')

const W = 96
const H = 54
const FRAME = W * H * 3

function flatFrame(r, g, b) {
  const buf = Buffer.alloc(FRAME)
  for (let i = 0; i < FRAME; i += 3) { buf[i] = r; buf[i + 1] = g; buf[i + 2] = b }
  return buf
}

const perSecond = Array.from({ length: 24 }, () => ({
  dark: 0.7, luma: 0.1, blue: 0.02, amber: 0.01,
  hue: new Array(12).fill(round4(1 / 12)),
  grid: new Array(9).fill(0.1),
}))
const cuts = Array.from({ length: 37 }, (_, i) => round4(0.5 + i * 0.6))
const peaks = cuts.slice(0, 18)
const baseline = { perSecond, cuts, motion: { count: 18, mean: 0.02, peaks, diffs: [] }, loudness: -17 }
const perfect = { ...baseline, segmentHits: 1, elements: [...REFERENCE_ELEMENTS] }

test('S0：纯函数边界（clamp / round / closeness / 响度曲线）', () => {
  assert.equal(round4(1.23456789), 1.2346)
  assert.equal(clamp01(-3), 0)
  assert.equal(clamp01(9), 1)
  assert.equal(clamp01(Number.NaN), 0)
  assert.equal(closeness(1, 1, 0.5), 1)
  assert.equal(closeness(1, 1.5, 0.5), 0)
  assert.equal(loudnessCloseness(-17, -17.8), 1, '±1 LU 内满分')
  assert.equal(loudnessCloseness(-17, -24.4), round4(1 - (7.4 - 1) / 11), '实测 7.4 LU 差按曲线衰减')
  assert.equal(loudnessCloseness(-17, -40), 0, '差 12 LU 以上归零')
})

test('S0：frameStats 对纯色帧给出正确统计', () => {
  const black = frameStats(flatFrame(0, 0, 0), 0)
  assert.equal(black.dark, 1)
  assert.equal(black.luma, 0)
  assert.equal(black.blue, 0)
  const blue = frameStats(flatFrame(10, 20, 200), 0)
  assert.equal(blue.blue, 1)
  const amber = frameStats(flatFrame(220, 150, 30), 0)
  assert.equal(amber.amber, 1)
  assert.equal(black.hue.length, 12)
  assert.equal(black.grid.length, 9)
})

test('S0：perSecondStats 截成 24 秒，残缺帧不崩', () => {
  const raw = Buffer.concat(Array.from({ length: 24 }, () => flatFrame(5, 6, 7)))
  assert.equal(perSecondStats(raw).length, 24)
  assert.equal(perSecondStats(raw.subarray(0, FRAME * 3)).length, 3)
})

test('S0：motionPeaks 静止片 0 峰、跳变片有峰', () => {
  const still = Buffer.concat(Array.from({ length: 30 }, () => Buffer.alloc(W * H, 20)))
  assert.equal(motionPeaks(still).count, 0)
  const frames = Array.from({ length: 30 }, (_, i) => Buffer.alloc(W * H, i % 6 === 0 ? 220 : 20))
  assert.ok(motionPeaks(Buffer.concat(frames)).count > 0)
})

test('S0：ffmpeg 输出解析（切点 / 响度）', () => {
  assert.deepEqual(parseCuts('frame:0 pts_time:0.567\nframe:1 pts_time:8.000\n'), [0.567, 8])
  assert.deepEqual(parseCuts('pts_time:0 pts_time:30 pts_time:abc'), [], '0 / 越界 / 非数字都要过滤')
  assert.equal(parseLoudness('  Integrated loudness:\n    I:         -17.0 LUFS\n'), -17)
  assert.equal(parseLoudness('nothing'), null)
})

test('S0 ★完美一致 ⇒ 100 分且 pass', () => {
  const v = scoreSimilarity(baseline, perfect)
  assert.equal(v.total, 100)
  assert.equal(v.pass, true)
  assert.equal(v.elementCoverage, 1)
  assert.deepEqual(v.missingElements, [])
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 100, '权重必须和为 100')
})

test('S0 ★单项塌了不许靠其它维度堆过线（防偏科）', () => {
  const v = scoreSimilarity(baseline, { ...perfect, motion: { count: 0, mean: 0, peaks: [], diffs: [] } })
  assert.equal(v.dims.motion, 0)
  assert.equal(v.pass, false, '总分即使 >95 也要判不达标')
  assert.equal(v.weakest.name, 'motion')
})

test('S3 ★接线锚点：波形来自 s0-wave、卡墙容器化 62 张 + 推近真声明（furniture 参数）', () => {
  const elements = templateElements()
  const skeleton = JSON.parse(readFileSync(join(TEMPLATE_DIR, 'manifest.template.json'), 'utf8'))
  assert.ok(skeleton.tracks.some((t) => /^s0-wave-\d+$/.test(String(t.id))), '波形元素必须由 s0-wave 杠阵列提供（S2 真接线）')
  assert.ok(elements.includes('cardWall'), '构件确实声明了 cardWall')
  assert.ok(elements.includes('waveform'), 'S2 接线后有真波形杠阵列（progressBar 从来不算）')
  assert.ok(elements.includes('greenChecks'), 'S2 接线：s11-checkmark-* 绿勾圆标')
  assert.ok(elements.includes('presenterPortrait'), 'S2 接线：程序生成剪影占位的人像端口')
  assert.ok(elements.includes('bigNumberMetal'), 'S2 接线：s2-number fx:metal')
  // S3：推近已真接线 —— 判据从「furniture 声明 pushFrom/pushTo 且 pushTo > pushFrom」
  // 读出（容器 animate scale 递增），不是按轨 id 套词。
  assert.ok(elements.includes('pushIn'), 'S3 卡墙容器化后推近必须真声明（虚接仍会缺失此元素）')
  const furniture = JSON.parse(readFileSync(join(TEMPLATE_DIR, 'furniture.json'), 'utf8'))
  const wall = furniture.find((f) => f.id === 'cardWall')
  assert.ok(Number(wall?.params?.count) === 62, '卡墙 62 张（U1 口径）')
  assert.ok(Number(wall?.params?.pushTo) > Number(wall?.params?.pushFrom), '推近参数必须是递增方向')
})

test('S3：接线后元素全覆盖，样片分数仍必须低于 95（基线探针不是摆设）', () => {
  const v = scoreSimilarity(baseline, {
    ...baseline,
    cuts: [],
    motion: { count: 12, mean: 0.01, peaks: [], diffs: [] },
    loudness: -24.4,
    segmentHits: 1,
    elements: templateElements(),
  })
  assert.equal(v.pass, false)
  assert.equal(v.dims.timeline, 50, '切点 0/37 + 段边界全中 ⇒ 50')
  assert.ok(v.total < 95)
  assert.deepEqual(v.missingElements, [], 'S3 接线后 37 项元素全覆盖（coverage 100%）')
})
