/**
 * REQ-038 R7-B4（D1 方案②）· **段间转场**单测。
 *
 * 四条纪律必须同时成立：
 * ① **compose 层造叠化窗** —— to 侧左移 T 帧、from 侧右延到边界帧，transition 轨窗口
 *    = [b-T, b]（边界帧 = 叠化中点）；bg / carry（全片轨）不参与；
 * ② **卡生成器零改动** —— 本文件只经 planFromSpec / applyStageTransitions 断言产物，
 *    不碰 recipe-cards；git diff 是 commit 层佐证（§11.5）；
 * ③ **ML-02 归零**（spec 通道）—— 组合出的 manifest 不再有「戛然而止」；
 * ④ **反向变异必红** —— 摘掉转场（或 ML-02 豁免一般化）后，硬切告警回潮，③的断言转红。
 *
 * 真机样例实测（39s · 6 屏 · autoStages）：64 → 130 轨（+65 转场），lint **0 条**。
 * SSR 抽帧回读（叠化确证）见 docs/archive/2026-11-14-r7-b4-boundary/（D5 准验收）。
 *
 * 直连 Host tsc 编译产物。定向跑：node --test tests/req038-r7-stage-transition.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyStageTransitions, STAGE_TRANSITION_FRAMES } from '../lib/remotion/stage-transition.js'
import { planFromSpec } from '../lib/remotion/content-spec.js'
import { lintMotion } from '../lib/remotion/motion-lint.js'

const T = STAGE_TRANSITION_FRAMES

// —— applyStageTransitions 纯函数 ——

test('叠化窗：to 侧左移 T 帧（末端不变）、from 侧右延到边界帧', () => {
  const prev = [
    { id: 'p1', type: 'textCard', startFrame: 0, durationInFrames: 100, fadeFrames: 0 },
    // 内部偏移轨：末端提前 6 帧（卡内 chart/summary 的常态）
    { id: 'p2', type: 'chart', startFrame: 0, durationInFrames: 94, fadeFrames: 0 },
  ]
  const cur = [{ id: 'c1', type: 'textCard', startFrame: 100, durationInFrames: 100, fadeFrames: 0 }]
  const transitions = applyStageTransitions({ screens: [prev, cur], boundaryFrames: [0, 100], filmEndFrame: 200 })
  assert.equal(transitions.length, 2, 'max(2,1)=2 条转场（from 侧全覆盖）')
  for (const transition of transitions) {
    assert.equal(transition.type, 'transition')
    assert.equal(transition.effect, 'fade')
    assert.equal(transition.startFrame, 100 - T)
    assert.equal(transition.durationInFrames, T)
  }
  assert.deepEqual(transitions.map((transition) => transition.fromTrackId), ['p1', 'p2'])
  assert.equal(cur[0].startFrame, 100 - T, 'to 侧左移')
  assert.equal(cur[0].durationInFrames, 100 + T, 'to 侧末端不变')
  assert.equal(prev[1].durationInFrames, 100, 'from 侧内部偏移轨右延到边界帧（94+6）')
})

test('末屏右延到片尾：内部轨末端不再在片尾前硬切', () => {
  const last = [{ id: 'l1', type: 'textCard', startFrame: 900, durationInFrames: 264, fadeFrames: 0 }]
  applyStageTransitions({ screens: [[{ id: 'x', startFrame: 0, durationInFrames: 900 }], last], boundaryFrames: [0, 900], filmEndFrame: 1200 })
  assert.equal(last[0].durationInFrames, 310, 'to 侧先移窗（264+10）再右延到片尾（+36）= 310，持到 1200')
})

test('配对轮转：from 少 to 多时 to 全覆盖；from 多 to 少时 from 全覆盖', () => {
  const prev = [{ id: 'p1', startFrame: 0, durationInFrames: 100 }]
  const cur = Array.from({ length: 3 }, (_, i) => ({ id: `c${i}`, startFrame: 100, durationInFrames: 100 }))
  const transitions = applyStageTransitions({ screens: [prev, cur], boundaryFrames: [0, 100] })
  assert.equal(transitions.length, 3)
  assert.deepEqual(transitions.map((transition) => transition.toTrackId), ['c0', 'c1', 'c2'], 'to 全覆盖')
  const prev2 = Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, startFrame: 0, durationInFrames: 100 }))
  const cur2 = [{ id: 'c0', startFrame: 100, durationInFrames: 100 }]
  const transitions2 = applyStageTransitions({ screens: [prev2, cur2], boundaryFrames: [0, 100] })
  assert.equal(transitions2.length, 3)
  assert.deepEqual(transitions2.map((transition) => transition.fromTrackId), ['p0', 'p1', 'p2'], 'from 全覆盖')
})

test('边界帧不足 T 或空屏：该边界跳过（不造负窗 / 不造指空引用）', () => {
  const transitions = applyStageTransitions({
    screens: [[{ id: 'p', startFrame: 0, durationInFrames: 3 }], [{ id: 'c', startFrame: 3, durationInFrames: 100 }]],
    boundaryFrames: [0, 3],
  })
  assert.deepEqual(transitions, [], '3 帧边界装不下 10 帧叠化窗，跳过')
  const empty = applyStageTransitions({
    screens: [[{ id: 'p', startFrame: 0, durationInFrames: 100 }], []],
    boundaryFrames: [0, 100],
  })
  assert.deepEqual(empty, [], '空屏没有可引用的轨')
})

test('非法入参抛 StageTransitionError（帧数非正整数 / 桶数不齐）', () => {
  assert.throws(() => applyStageTransitions({ screens: [[], []], boundaryFrames: [0, 100], transitionFrames: 0 }), /正整数/)
  assert.throws(() => applyStageTransitions({ screens: [[], []], boundaryFrames: [0, 100], transitionFrames: 2.5 }), /正整数/)
  assert.throws(() => applyStageTransitions({ screens: [[], [], []], boundaryFrames: [0, 100] }), /数量不一致/)
})

// —— planFromSpec 集成 ——

function twoScreenSpec() {
  return {
    meta: { title: 'B4', durationSec: 8, fps: 30 },
    sections: [
      { id: 's1', copy: '第一屏', card: 'A2' },
      { id: 's2', copy: '第二屏', card: 'B1' },
    ],
  }
}

function composed(spec) {
  const plan = planFromSpec(spec, Math.round(spec.meta.durationSec * spec.meta.fps))
  return {
    plan,
    manifest: {
      id: 'x',
      meta: { title: spec.meta.title, width: 1920, height: 1080, fps: spec.meta.fps, durationInFrames: Math.round(spec.meta.durationSec * spec.meta.fps), backgroundColor: '#0B1220' },
      tracks: plan.tracks,
    },
  }
}

test('2 屏 spec：边界恰有一组转场，bg / carry 不参与', () => {
  const { plan, manifest } = composed(twoScreenSpec())
  const transitions = plan.tracks.filter((track) => track.type === 'transition')
  assert.ok(transitions.length >= 1, '边界必须有转场')
  const s2Start = plan.timeline[1].startFrame
  for (const transition of transitions) {
    assert.equal(transition.startFrame, s2Start - T)
    assert.equal(transition.durationInFrames, T)
    const from = plan.tracks.find((track) => track.id === transition.fromTrackId)
    const to = plan.tracks.find((track) => track.id === transition.toTrackId)
    assert.ok(from !== undefined && to !== undefined, 'from/to 引用必须存在（validateManifest rule 3）')
    assert.notEqual(transition.fromTrackId, transition.toTrackId)
    assert.ok(!['bg', 'panel'].includes(String(transition.fromTrackId)) && !['bg', 'panel'].includes(String(transition.toTrackId)), 'bg / carry 是全片轨，不参与转场')
  }
  assert.equal(manifest.meta.durationInFrames, 240, '总帧不受转场影响')
})

test('ML-02 归零：2 屏组合产物无「戛然而止」（对照：摘掉转场即回潮）', () => {
  const { manifest } = composed(twoScreenSpec())
  const issues = lintMotion(manifest)
  assert.equal(issues.some((issue) => issue.code === 'ML-02'), false,
    '组合出的屏轨必须被转场尾随豁免，实际：' + JSON.stringify(issues.map((issue) => issue.code + '|' + issue.at)))
  // 反向变异守卫：把转场轨摘掉重 lint —— ML-02 必须回潮（证明豁免不是判据放宽而是机制对齐）。
  const noTransition = { ...manifest, tracks: manifest.tracks.filter((track) => track.type !== 'transition') }
  const issues2 = lintMotion(noTransition)
  assert.ok(issues2.some((issue) => issue.code === 'ML-02'), '摘掉转场后 ML-02 必须回潮（硬切是真的）')
})

test('39s 六屏样例：65 条转场、lint 0 条（真机样例验收线）', () => {
  const spec = JSON.parse(readFileSync(new URL('../skills/code-driven-explainer/assets/screen-plan-example.json', import.meta.url), 'utf8'))
  const { plan, manifest } = composed(spec)
  const transitions = plan.tracks.filter((track) => track.type === 'transition')
  // 5 边界 × 13 配对 - 3 条晚偏移 to 轨（δ≥T 不参与边界切变，由卡内部入场节拍管）
  assert.equal(transitions.length, 62, '64 → 126 轨')
  assert.equal(lintMotion(manifest).length, 0, '整份 manifest 体检零告警')
})
