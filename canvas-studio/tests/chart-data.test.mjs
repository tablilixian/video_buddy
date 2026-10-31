/**
 * A2（2026-10-31）：chart 轨 `source:'timeline'` 数据推导纯函数单测。
 *
 * 口径：镜头 = video 轨按 startFrame 升序；values = ffprobe 校正后的每镜时长（秒）；
 * dual 的 lineValues = 累计时长；labels = 镜1..镜n；单位固定秒。
 * 直连 Host tsc 编译产物 `lib/remotion/chart-data.js`。
 * 定向跑：node --test tests/chart-data.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chartDataFromTimeline } from '../lib/remotion/chart-data.js'

function manifest(videos) {
  return {
    id: 'comp-tl',
    meta: { title: 't', width: 1280, height: 720, fps: 30, durationInFrames: 600, lint: 'off' },
    tracks: videos,
  }
}

const shot = (id, startFrame, durationInFrames) => ({
  id, type: 'video', src: `/canvas-studio/assets/p1/${id}.mp4`, startFrame, durationInFrames,
})

test('timeline 推导：按 startFrame 排序、值 = 时长秒数、折线 = 累计', () => {
  const d = chartDataFromTimeline(manifest([
    shot('b', 240, 218), // 乱序给入（时间线顺序 b 在前）
    shot('a', 0, 240),
    shot('c', 458, 142),
  ]), { id: 'c1', type: 'chart', variant: 'dual', startFrame: 0, durationInFrames: 600 })
  assert.deepEqual(d.labels, ['镜1', '镜2', '镜3'], '按时间线顺序重排')
  assert.deepEqual(d.values, [8, 7.27, 4.73], '值 = durationInFrames / fps（秒）')
  assert.deepEqual(d.lineValues, [8, 15.27, 20], '折线 = 累计时长')
  assert.equal(d.unit, 's')
  assert.equal(d.lineUnit, 's')
})

test('timeline 推导：无 video 轨 ⇒ null（校验层会先拒收，这是组件侧兜底）', () => {
  const d = chartDataFromTimeline(manifest([
    { id: 't', type: 'textCard', variant: 'title', text: 'x', startFrame: 0, durationInFrames: 100 },
  ]), { id: 'c1', type: 'chart', variant: 'bars', startFrame: 0, durationInFrames: 100 })
  assert.equal(d, null)
})

test('timeline 推导：确定性 —— 同输入两次全等', () => {
  const m = manifest([shot('a', 0, 240), shot('b', 240, 218)])
  const t = { id: 'c1', type: 'chart', variant: 'dual', startFrame: 0, durationInFrames: 460 }
  assert.deepEqual(chartDataFromTimeline(m, t), chartDataFromTimeline(m, t))
})
