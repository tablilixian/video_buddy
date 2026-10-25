/**
 * 分组坐标（`groups`）的纯函数守卫：组内百分比 → 画布绝对百分比的展开。
 *
 * 病史（2026-10-25 会话 #5 @143min，用户原话）：
 * 「表盘跟里面的内容做到一起，是不是就不用考虑全局变换坐标了啊？」
 * 他要的是**写的时候**不算全局坐标。所以组是"写作者糖"：宿主侧预展开，渲染器看不到它。
 *
 * 这个文件钉三件事：
 *   1. 换算正确（中心语义、组内 0–100 → 组的实际范围）；
 *   2. 有降级的地方**一定报出来**（未知组名 / 组内轨缺 box）—— 调用方据此拒收，
 *      静默按原样渲会得到"位置对不上但没人报错"；
 *   3. 没写 `groups` 的老 manifest **零变化**（像素不变，性能不变）。
 *
 * 运行：node --test tests/render-groups.test.mjs（需先 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expandGroups } from '../lib/remotion/groups.js'
import { validateManifest } from '../lib/remotion/manifest.js'

function baseManifest(extra = {}) {
  return {
    id: 'g-test',
    meta: { title: '分组', width: 1280, height: 720, fps: 30, durationInFrames: 90, backgroundColor: '#000000' },
    tracks: [
      { id: 'bg', type: 'shape', shape: 'rect', color: '#111827', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: 0, durationInFrames: 90, fadeFrames: 0 },
    ],
    ...extra,
  }
}

test('G·①：组内 0–100 映射到组的实际范围（中心语义）', () => {
  const manifest = baseManifest({
    // 组：中心 (70, 50)、宽 40、高 80 ⇒ 左缘 50、上缘 10
    groups: [{ id: 'dial', box: { x: 70, y: 50, w: 40, h: 80 } }],
    tracks: [
      // 组内中心 (50,50) 宽 100 高 100 ⇒ 正好铺满该组
      { id: 'inner', type: 'shape', shape: 'rect', color: '#fff', group: 'dial', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: 0, durationInFrames: 90, fadeFrames: 0 },
    ],
  })
  const { manifest: out, warnings } = expandGroups(manifest)
  assert.deepEqual(warnings, [])
  const track = out.tracks[0]
  assert.deepEqual(track.box, { x: 70, y: 50, w: 40, h: 80 }, '组内铺满 = 组本身')
  assert.equal(track.group, undefined, '展开后必须抹掉 group —— 渲染器不该看到它')
  assert.equal(out.groups, undefined, 'groups 也要抹掉')
})

test('G·②：组内偏移按比例（组内 x=25 ⇒ 组的 1/4 处）', () => {
  const manifest = baseManifest({
    groups: [{ id: 'dial', box: { x: 50, y: 50, w: 20, h: 20 } }], // 左缘 40、宽 20
    tracks: [
      { id: 'inner', type: 'shape', shape: 'circle', color: '#fff', group: 'dial', box: { x: 25, y: 50, w: 50, h: 50 }, startFrame: 0, durationInFrames: 90, fadeFrames: 0 },
    ],
  })
  const track = expandGroups(manifest).manifest.tracks[0]
  // x: 40 + 25% × 20 = 45；w: 50% × 20 = 10
  assert.deepEqual(track.box, { x: 45, y: 50, w: 10, h: 10 })
})

test('G·③：没写 groups ⇒ 原样返回同一个对象（老 manifest 零变化）', () => {
  const manifest = baseManifest()
  const result = expandGroups(manifest)
  assert.equal(result.manifest, manifest, '必须复用同一对象，不能每次深拷贝')
  assert.deepEqual(result.warnings, [])
})

test('G·④：空 groups 数组与不写等价（不要因为 groups:[] 就失败）', () => {
  const result = expandGroups(baseManifest({ groups: [] }))
  assert.deepEqual(result.warnings, [])
})

test('G·⑤：未知组名 / 组内轨缺 box ⇒ 必须产生 warning（调用方据此拒收）', () => {
  const missingGroup = expandGroups(baseManifest({
    groups: [{ id: 'dial', box: { x: 70, y: 50, w: 40, h: 80 } }],
    tracks: [{ id: 'x', type: 'shape', shape: 'rect', color: '#fff', group: 'nope', box: { x: 50, y: 50, w: 10, h: 10 }, startFrame: 0, durationInFrames: 90, fadeFrames: 0 }],
  }))
  assert.equal(missingGroup.warnings.length, 1)
  assert.match(missingGroup.warnings[0], /不存在的组/u)

  const noBox = expandGroups(baseManifest({
    groups: [{ id: 'dial', box: { x: 70, y: 50, w: 40, h: 80 } }],
    tracks: [{ id: 'img', type: 'image', src: '/canvas-studio/assets/a.png', group: 'dial', startFrame: 0, durationInFrames: 90, fadeFrames: 0 }],
  }))
  assert.equal(noBox.warnings.length, 1)
  assert.match(noBox.warnings[0], /没有合法 box/u)
})

test('G·⑥：展开结果必须仍能过 validateManifest（组字段不污染结构）', () => {
  const manifest = baseManifest({
    groups: [{ id: 'dial', box: { x: 70, y: 50, w: 40, h: 80 } }],
    tracks: [
      { id: 'inner', type: 'shape', shape: 'rect', color: '#fff', group: 'dial', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: 0, durationInFrames: 90, fadeFrames: 0 },
    ],
  })
  const { manifest: out } = expandGroups(manifest)
  const result = validateManifest(out)
  assert.deepEqual(result.errors, [], `展开后结构不合法：${result.errors.join('；')}`)
})
