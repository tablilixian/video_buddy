/**
 * R11-B2（2026-11-16）· **段产物规划层**（纯函数）
 *
 * 锁四件事：
 * ① 段 id 采信 `meta.segments[].id`，但**必须整表帧窗对齐**才采信 —— 对不齐退回
 *    `seg-N`（把 s2 的名字挂到第三段上，比没有名字更误导）；
 * ② id 直接进文件名 ⇒ 必须无路径语义（`../` 之类的穿越串要吃掉）；
 * ③ 同批 id 冲突按出现顺序加后缀，绝不静默覆盖前一段产物；
 * ④ 段级抽帧取**段中点**（段首是转场叠化起点，拍到的是过渡帧）。
 *
 * 反向变异（改回旧行为必须红）：
 * - 去掉 `declaredTableAligned` 的帧窗比对（只判段数）⇒ 「段表错位不采信」用例红；
 * - `segmentArtifactId` 不折非法字符 ⇒ 「路径穿越」用例红；
 * - `segmentSampleFrame` 改成取段首 ⇒ 「中点」用例红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  planSegmentArtifacts,
  segmentArtifactId,
  segmentArtifactRelPath,
  segmentPointers,
  segmentReceiptLine,
  segmentSampleFrame,
} from '../lib/segment-artifacts.js'

/** 三段段表（s2/s3 已左移 10 帧的预卷口径）。 */
const SEGMENTS = [
  { index: 0, startFrame: 0, endFrame: 190 },
  { index: 1, startFrame: 190, endFrame: 390 },
  { index: 2, startFrame: 390, endFrame: 600 },
]

const DECLARED = [
  { id: 's1', startFrame: 0, frames: 190 },
  { id: 's2', startFrame: 190, frames: 200 },
  { id: 's3', startFrame: 390, frames: 210 },
]

test('id 来源：段表帧窗完全对齐 ⇒ 采信 spec 的段 id（s1/s2/s3）', () => {
  const artifacts = planSegmentArtifacts({ segments: SEGMENTS, declared: DECLARED, fps: 30 })
  assert.deepEqual(artifacts.map((a) => a.id), ['s1', 's2', 's3'])
  assert.deepEqual(artifacts.map((a) => a.frames), [190, 200, 210])
})

test('id 来源：段表起点错位（190→200，等于没修预卷的旧表）⇒ 整表不采信，退回 seg-N', () => {
  const stale = [
    { id: 's1', startFrame: 0, frames: 200 },
    { id: 's2', startFrame: 200, frames: 200 },
    { id: 's3', startFrame: 400, frames: 200 },
  ]
  const artifacts = planSegmentArtifacts({ segments: SEGMENTS, declared: stale, fps: 30 })
  assert.deepEqual(artifacts.map((a) => a.id), ['seg-1', 'seg-2', 'seg-3'])
})

test('id 来源：段数不一致 ⇒ 整表不采信', () => {
  const artifacts = planSegmentArtifacts({ segments: SEGMENTS, declared: DECLARED.slice(0, 2), fps: 30 })
  assert.deepEqual(artifacts.map((a) => a.id), ['seg-1', 'seg-2', 'seg-3'])
})

test('id 清洗：路径穿越与非法字符必须被吃掉（id 直接进文件名）', () => {
  for (const raw of ['../../etc/passwd', 'a/b\\c', '..', '  s 2  ', '第1屏']) {
    const id = segmentArtifactId(raw, 0)
    assert.match(id, /^[A-Za-z0-9_-]+$/, `清洗后只允许白名单字符：${raw} ⇒ ${id}`)
    assert.ok(!id.includes('..'), `不允许残留 ..：${raw} ⇒ ${id}`)
  }
  assert.equal(segmentArtifactId('', 2), 'seg-3', '空串退回 seg-<index+1>')
  assert.equal(segmentArtifactId(undefined, 1), 'seg-2', '非字符串退回 seg-<index+1>')
})

test('id 冲突：两张屏都叫 s1 ⇒ 第二个加 -2 后缀，不覆盖前一段产物', () => {
  const declared = [
    { id: 's1', startFrame: 0, frames: 190 },
    { id: 's1', startFrame: 190, frames: 200 },
    { id: 's3', startFrame: 390, frames: 210 },
  ]
  const artifacts = planSegmentArtifacts({ segments: SEGMENTS, declared, fps: 30 })
  assert.deepEqual(artifacts.map((a) => a.id), ['s1', 's1-2', 's3'])
})

test('抽帧帧号：段中点（段首是转场叠化起点，不能取）', () => {
  assert.equal(segmentSampleFrame(0, 190), 94, '0 + floor(189/2)')
  assert.equal(segmentSampleFrame(190, 200), 289, '190 + floor(199/2)')
  assert.equal(segmentSampleFrame(390, 210), 494, '390 + floor(209/2)')
  assert.equal(segmentSampleFrame(0, 1), 0, '单帧段取唯一帧')
  const artifacts = planSegmentArtifacts({ segments: SEGMENTS, declared: DECLARED, fps: 30 })
  assert.deepEqual(artifacts.map((a) => a.sampleFrame), [94, 289, 494])
})

test('交付指针：相对路径 + 3 位小数时长（卡要能跟项目搬，不写绝对路径）', () => {
  const artifacts = planSegmentArtifacts({ segments: SEGMENTS, declared: DECLARED, fps: 30 })
  const pointers = segmentPointers(artifacts, 30)
  assert.deepEqual(pointers.map((p) => p.file), [
    'deliver/segments/s1.mp4',
    'deliver/segments/s2.mp4',
    'deliver/segments/s3.mp4',
  ])
  assert.equal(pointers[1].durationSec, 6.667, '200 / 30 = 6.667')
  assert.equal(pointers[0].startFrame, 0)
  assert.equal(pointers[2].frames, 210)
  assert.equal(segmentArtifactRelPath('s2'), 'deliver/segments/s2.mp4')
})

test('REQ-041 指针：段表对齐时 ref = spec 原文 id（不是清洗后的产物 id），资产副本名确定性', () => {
  // 中文 id：产物名被清洗成 seg-1，但 ref 必须保留原文，卡上才知道是哪一屏。
  const declared = [
    { id: '第一屏', startFrame: 0, frames: 190 },
    { id: 's.2', startFrame: 190, frames: 200 },
    { id: 's3', startFrame: 390, frames: 210 },
  ]
  const artifacts = planSegmentArtifacts({ segments: SEGMENTS, declared, fps: 30 })
  assert.deepEqual(artifacts.map((a) => a.id), ['seg-1', 's-2', 's3'])
  const pointers = segmentPointers(artifacts, 30)
  assert.deepEqual(pointers.map((p) => p.ref), ['spec:第一屏', 'spec:s.2', 'spec:s3'])
  assert.deepEqual(pointers.map((p) => p.assetFile), ['seg-seg-1.mp4', 'seg-s-2.mp4', 'seg-s3.mp4'])
})

test('REQ-041 指针：段表不对齐 ⇒ 不给 ref（诚实失败，禁止按序号瞎配）', () => {
  const stale = [
    { id: 's1', startFrame: 0, frames: 200 },
    { id: 's2', startFrame: 200, frames: 200 },
    { id: 's3', startFrame: 400, frames: 200 },
  ]
  const pointers = segmentPointers(planSegmentArtifacts({ segments: SEGMENTS, declared: stale, fps: 30 }), 30)
  assert.ok(pointers.every((p) => p.ref === undefined), '段表错位时不得回 ref')
  assert.ok(pointers.every((p) => p.assetFile !== undefined), '资产副本名仍要给（与 ref 无关）')
})

test('回执：段清单有内容才出行（空数组不吐空行）', () => {
  assert.equal(segmentReceiptLine([]), '')
  const line = segmentReceiptLine(segmentPointers(planSegmentArtifacts({ segments: SEGMENTS, declared: DECLARED, fps: 30 }), 30))
  assert.ok(line.includes('deliver/segments/s1.mp4'), line)
  assert.ok(line.includes('s3'), line)
})
