/**
 * REQ-038 R11-C1 · **分镜切片器**（shot-slice）单测。
 *
 * 五条纪律必须同时成立：
 * ① **活跃集过滤 + 绝对帧号** —— 段 = 帧窗内可见的轨子集，帧号原样保留
 *    （渲染走 frameRange，拼接后与整片逐帧一致）；
 * ② **转场归前段** —— transition [b−T, b) 只出现在前段活跃集（D2）；
 * ③ **跨段轨重复出现** —— bg/carry 在每个覆盖它的段都在（拼接后连续）；
 * ④ **边界三级回退** —— spec 派生（非法即弃）→ transition 末端 → 单段；
 *    MIN_SHOT_FRAMES 消毒把切片噪声挡掉；
 * ⑤ **反向变异必红** —— 切片器退化成恒等/空集，union 守卫与段数断言转红。
 *
 * 直连 Host tsc 编译产物。定向跑：node --test tests/req038-r11-shot-slice.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planFromSpec } from '../lib/remotion/content-spec.js'
import { planStages } from '../lib/remotion/stage-plan.js'
import {
  MIN_SHOT_FRAMES,
  boundariesFromSpec,
  resolveShotBoundaries,
  sliceByShots,
} from '../lib/shot-slice.js'

/** 真机同款三屏 spec（autoStages）→ 编出带 B4 转场的 manifest。 */
function buildManifest() {
  const spec = {
    meta: { title: '切片样例', durationSec: 20, fps: 30, autoStages: true },
    sections: [
      { id: 's1', copy: '开场', card: 'A2' },
      { id: 's2', copy: '数据', units: [
        { card: 'DAT2', copy: '1.2 亿', cell: { x: 28, y: 50, w: 42, h: 44 } },
        { card: 'A4', copy: '要点', cell: { x: 74, y: 50, w: 40, h: 44 }, overlap: true },
      ] },
      { id: 's3', copy: '收尾', card: 'A5' },
    ],
    carry: [{ id: 'panel', box: { x: 50, y: 54, w: 88, h: 46 }, color: '#151c2c', radius: 18 }],
  }
  const plan = planFromSpec(spec, 600)
  // 切片器吃的是 CompositionManifest（有 meta.durationInFrames）——planFromSpec 的返回要包一层
  const manifest = {
    id: 'm-slice',
    meta: { title: spec.meta.title, width: 1920, height: 1080, fps: 30, durationInFrames: 600, backgroundColor: '#0B1220' },
    tracks: plan.tracks,
  }
  return { spec, manifest }
}

test('切片：三段、绝对帧号、转场归前段、跨段轨重复出现', () => {
  const { manifest } = buildManifest()
  const stages = planStages({ totalSeconds: 20, fps: 30 })
  const cuts = stages.stages.slice(1).map((s) => s.startFrame)
  assert.deepEqual(cuts, [200, 400])

  const { segments, boundarySource } = sliceByShots(manifest, cuts)
  assert.equal(boundarySource, 'transition', 'sliceByShots 只按传入 cuts 切，来源标记为 transition 语义')
  assert.equal(segments.length, 3)
  assert.deepEqual(segments.map((s) => [s.startFrame, s.endFrame]), [[0, 200], [200, 400], [400, 600]])

  // 绝对帧号：bg 在每段都是 startFrame 0 / duration 600（不重排）
  for (const seg of segments) {
    const bg = seg.tracks.find((t) => t.id === 'bg')
    assert.ok(bg !== undefined, `段 ${String(seg.index)} 必须含全屏 bg（跨段轨重复出现）`)
    assert.equal(bg.startFrame, 0)
    assert.equal(bg.durationInFrames, 600)
    const panel = seg.tracks.find((t) => t.id === 'panel')
    assert.ok(panel !== undefined, 'carry 在每段都在')
  }

  // 转场归前段：边界 200 处的转场窗 [190, 200) 只在段 0
  const trans = manifest.tracks.filter((t) => t.type === 'transition')
  assert.ok(trans.length >= 2, 'B4 已为两处边界插转场')
  for (const t of trans) {
    const end = t.startFrame + t.durationInFrames
    const owner = segments.find((seg) => t.startFrame < seg.endFrame && t.startFrame + t.durationInFrames > seg.startFrame)
    assert.equal(owner.index, end <= 200 ? 0 : 1, `转场（末端 ${String(end)}）归属其窗所在段`)
    // 且后一段不再含该转场（半开区间）
    const later = segments.filter((seg) => seg.startFrame >= end)
    for (const seg of later) assert.ok(!seg.tracks.includes(t), '转场不得泄入后段')
  }

  // 无丢轨：每条轨至少出现在一个段
  const union = new Set(segments.flatMap((seg) => seg.tracks.map((t) => t.id)))
  for (const t of manifest.tracks) assert.ok(union.has(t.id), `轨 ${String(t.id)} 被切片丢失`)
})

test('边界来源：spec autoStages 派生 / 非法 spec 落 transition / 全缺回退单段', () => {
  const { spec, manifest } = buildManifest()
  const fromSpec = boundariesFromSpec(spec, 600, 30)
  assert.deepEqual(fromSpec, [200, 400], 'autoStages 派生 = planStages 屏起点')
  const r1 = resolveShotBoundaries(manifest, fromSpec)
  assert.deepEqual(r1.cuts, [200, 400])
  assert.equal(r1.source, 'spec')

  // spec 与 manifest 时长不一致（过期 spec）→ 弃用 → transition 末端
  const r2 = resolveShotBoundaries(manifest, boundariesFromSpec({ ...spec, meta: { ...spec.meta, durationSec: 45 } }, 600, 30))
  assert.equal(r2.source, 'transition')
  assert.ok(r2.cuts.length >= 2, `B4 转场末端作边界：${JSON.stringify(r2.cuts)}`)

  // 无 spec 无转场 → 回退单段
  const bare = { ...manifest, tracks: manifest.tracks.filter((t) => t.type !== 'transition') }
  const r3 = resolveShotBoundaries(bare, null)
  assert.equal(r3.source, 'fallback-single')
  assert.deepEqual(r3.cuts, [])
  const sliced = sliceByShots(bare, r3.cuts)
  assert.equal(sliced.segments.length, 1)
  assert.equal(sliced.segments[0].tracks.length, bare.tracks.length, '单段 = 全部轨（与不切片等价）')
})

test('非 autoStages spec：权重切分派生（复刻 planRecipe 口径）', () => {
  const spec = {
    meta: { title: '权重', durationSec: 20, fps: 30 },
    sections: [
      { id: 'a', copy: '甲', weight: 3 },
      { id: 'b', copy: '乙', weight: 1 },
    ],
  }
  // weight 3:1 → 前 1 段 round(3/4*600)=450
  assert.deepEqual(boundariesFromSpec(spec, 600, 30), [450])
})

test('MIN_SHOT_FRAMES 消毒：过近/越界边界被丢弃（切片噪声不上桌）', () => {
  const manifest = buildManifest().manifest
  // 40 与 45 只差 5 帧 < 30 → 45 被丢；40 距 0 ≥ 30、距 600 ≥ 30 → 保留
  const r = resolveShotBoundaries(manifest, [40, 45])
  assert.deepEqual(r.cuts, [40])
  // 越界（> totalFrames）丢弃
  const r2 = resolveShotBoundaries(manifest, [200, 700])
  assert.deepEqual(r2.cuts, [200])
  assert.equal(MIN_SHOT_FRAMES, 30)
})

test('切片确定性：同入参两次调用逐字段相等', () => {
  const { manifest } = buildManifest()
  const a = JSON.stringify(sliceByShots(manifest, [200, 400]))
  const b = JSON.stringify(sliceByShots(manifest, [200, 400]))
  assert.equal(a, b)
})

test('反向变异：切片器退化成单段恒等，段数与跨段断言转红', () => {
  const { manifest } = buildManifest()
  const sliced = sliceByShots(manifest, [200, 400])
  assert.ok(sliced.segments.length >= 2, '两处边界必须切出 ≥2 段——退化恒等这条先红')
})
