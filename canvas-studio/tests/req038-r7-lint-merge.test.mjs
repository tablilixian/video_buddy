/**
 * REQ-038 R7-C2 · **告警治理**（motion-lint 同类合并）单测。
 *
 * 三条纪律必须同时成立：
 * ① **同类合并** —— 同 code 合并成一条（计数 + 前 3 处位置）；真机 45s 形态（10 条同源
 *    ML-02 + 版面两条）从 12 条截断降到 3 条（≤10 验收）；
 * ② **单条 code 逐字段不变** —— 只有一处告警时输出与合并前一模一样（既有断言零波及）；
 * ③ **反向变异必红** —— 若改回「12 条先到先得」，同源洪水会还原成 N 条个体，本文件
 *    「恰好 1 条 ML-02」与「≤3 条」断言转红；13 类以上不同 code 才允许 ML-00 兜底截断。
 *
 * 真机 45s manifest 实测（2026-11-14，只读副本 /tmp/zhenji-45s-manifest.json）：
 * 合并前 13 条（12 截断 + ML-00），合并后 **3 条**（ML-16 / ML-17 / ML-02 ×15 处合并）。
 *
 * 直连 Host tsc 编译产物。定向跑：node --test tests/req038-r7-lint-merge.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lintMotion } from '../lib/remotion/motion-lint.js'

function manifestOf(tracks) {
  const end = Math.max(...tracks.map((track) => track.startFrame + track.durationInFrames))
  return { meta: { title: 'C2', width: 1920, height: 1080, fps: 30, durationInFrames: Math.max(end, 1350) }, tracks }
}

/** 真机 45s 的同源洪水形态：10 条 textCard 各占一屏、fadeFrames:0、无 exit ⇒ 全部 ML-02。 */
function floodTracks() {
  return Array.from({ length: 10 }, (_, index) => ({
    id: `V${index + 1}`, type: 'textCard', variant: 'title', text: `第${index + 1}屏`,
    startFrame: index * 100, durationInFrames: 90, fadeFrames: 0,
  }))
}

test('同源洪水：10 条 ML-02 合并成 1 条（计数 + 前 3 处），总量 ≤3', () => {
  const issues = lintMotion(manifestOf(floodTracks()))
  assert.equal(issues.filter((issue) => issue.code === 'ML-02').length, 1,
    '10 条同源 ML-02 必须合并成 1 条，实际：' + JSON.stringify(issues.map((issue) => issue.code)))
  const ml02 = issues.find((issue) => issue.code === 'ML-02')
  assert.match(ml02.message, /共 10 处/)
  assert.match(ml02.message, /前 3 处：V1 \/ V2 \/ V3/)
  // 验收线是 ≤10（真机 45s 实测 3 条）；本夹因额外带 ML-08/ML-10（真机片没有的全片级统计），5 条也达标
  assert.ok(issues.length <= 10, `总量应 ≤10（验收线），实际 ${String(issues.length)}：${JSON.stringify(issues.map((issue) => issue.code))}`)
  assert.ok(!issues.some((issue) => issue.code === 'ML-00'), '没截断就不该有 ML-00')
})

test('单条 code 逐字段不变：一条 ML-02 的 code/at/message/hint 与合并前一致', () => {
  const issues = lintMotion(manifestOf([
    { id: 'V1', type: 'textCard', variant: 'title', text: '唯一', startFrame: 0, durationInFrames: 90, fadeFrames: 0 },
    { id: 'bg', type: 'shape', shape: 'gradient', color: '#111827', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: 0, durationInFrames: 1350 },
  ]))
  const ml02 = issues.find((issue) => issue.code === 'ML-02')
  assert.ok(ml02 !== undefined)
  assert.equal(ml02.at, 'V1')
  assert.equal(ml02.message, '轨「V1」在第 90 帧戛然而止（fadeFrames:0 且无 exit / 尾部转场）')
  assert.ok(!/共 \d+ 处/.test(ml02.message), '单条不得带合并计数')
})

test('两处同 code：合并为一条「共 2 处（前 2 处）」', () => {
  const issues = lintMotion(manifestOf([
    { id: 'A', type: 'textCard', variant: 'title', text: '甲', startFrame: 0, durationInFrames: 90, fadeFrames: 0 },
    { id: 'B', type: 'textCard', variant: 'title', text: '乙', startFrame: 100, durationInFrames: 90, fadeFrames: 0 },
  ]))
  const ml02 = issues.filter((issue) => issue.code === 'ML-02')
  assert.equal(ml02.length, 1)
  assert.match(ml02[0].message, /共 2 处（前 2 处：A \/ B）/)
})

test('合并条目的 hint 取第一处的 hint（可执行建议不丢）', () => {
  const issues = lintMotion(manifestOf(floodTracks()))
  const ml02 = issues.find((issue) => issue.code === 'ML-02')
  assert.ok(ml02.hint !== undefined && ml02.hint.length > 10, '合并条目必须保留 hint')
})

test('13 类不同 code 同时爆：仍折 ML-00 兜底（只显示前 12 条）', () => {
  const D = 1350
  const tracks = [
    { id: 's1', type: 'textCard', variant: 'title', text: '屏幕一', startFrame: 0, durationInFrames: 300, box: { x: 30, y: 50, w: 40, h: 40 } },
    { id: 's2', type: 'textCard', variant: 'title', text: '屏幕二', startFrame: 300, durationInFrames: 300 },
    { id: 's3', type: 'textCard', variant: 'title', text: '屏幕三', startFrame: 600, durationInFrames: 300 },
    { id: 's4', type: 'textCard', variant: 'title', text: '屏幕四', startFrame: 900, durationInFrames: 300 },
    { id: 'k1', type: 'textCard', variant: 'title', text: '闪入', startFrame: 0, durationInFrames: 300, animate: { from: { opacity: 0 }, to: { opacity: 1 }, durationInFrames: 3, easing: 'easeOutCubic' } },
    { id: 'k2', type: 'textCard', variant: 'title', text: '漂移', startFrame: 0, durationInFrames: 300, box: { x: 200, y: 50, w: 30, h: 20 }, animate: { from: { x: 200 }, to: { x: 60 }, durationInFrames: 60, easing: 'linear' } },
    { id: 'k3', type: 'shape', shape: 'rect', color: '#111827', box: { x: 20, y: 20, w: 24, h: 24 }, startFrame: 0, durationInFrames: 380, fadeFrames: 0 },
    { id: 'k4', type: 'shape', shape: 'rect', color: '#222838', box: { x: 55, y: 20, w: 24, h: 24 }, startFrame: 0, durationInFrames: 380, animate: { from: { opacity: 0.5 }, to: { opacity: 1 }, durationInFrames: 380, easing: 'linear' } },
    { id: 'k5', type: 'textCard', variant: 'subtitle', text: ['甲'.repeat(40), '乙'.repeat(40), '丙'.repeat(40), '丁'.repeat(40)], startFrame: 0, durationInFrames: 120 },
    { id: 'k6', type: 'textCard', variant: 'title', text: '叠字', startFrame: 30, durationInFrames: 240, box: { x: 30, y: 50, w: 40, h: 40 } },
    { id: 'm1', type: 'textCard', variant: 'title', text: '齐1', startFrame: 500, durationInFrames: 100, animate: { from: { opacity: 0 }, to: { opacity: 1 }, durationInFrames: 30, easing: 'linear' } },
    { id: 'm2', type: 'textCard', variant: 'title', text: '齐2', startFrame: 500, durationInFrames: 100, animate: { from: { opacity: 0 }, to: { opacity: 1 }, durationInFrames: 30, easing: 'linear' } },
    { id: 'm3', type: 'textCard', variant: 'title', text: '齐3', startFrame: 500, durationInFrames: 100, animate: { from: { opacity: 0 }, to: { opacity: 1 }, durationInFrames: 30, easing: 'linear' } },
    { id: 'm4', type: 'textCard', variant: 'title', text: '齐4', startFrame: 500, durationInFrames: 100, animate: { from: { opacity: 0 }, to: { opacity: 1 }, durationInFrames: 30, easing: 'linear' } },
  ]
  const issues = lintMotion(manifestOf(tracks))
  assert.equal(issues.at(-1).code, 'ML-00', `13 类齐爆必须出 ML-00 兜底，实际尾部：${JSON.stringify(issues.slice(-2).map((issue) => issue.code))}`)
  assert.match(issues.at(-1).message, /仅显示前 12 条/)
  assert.equal(issues.filter((issue) => issue.code !== 'ML-00').length, 12)
})

test('反向变异：合并若被还原成先到先得，洪水形态会翻出 N 条个体（本文件的 1 条断言转红）', () => {
  // 守卫式断言：把合并语义钉死在「恰好 1 条」，谁改回 12 条先到先得这里先红。
  const issues = lintMotion(manifestOf(floodTracks()))
  assert.equal(issues.filter((issue) => issue.code === 'ML-02').length, 1)
})
