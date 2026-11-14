/**
 * REQ-038 R9-P2a（#14，D6 拍板）· **多单元入场错峰默认**单测。
 *
 * 四条纪律必须同时成立：
 * ① **错峰** —— 同屏后续单元的轨入场延后 k×4 帧（UNIT_ENTRANCE_STAGGER_FRAMES）；
 * ② **末端不动** —— 起点延后多少、时长就减多少（末端越过屏边界会脱离段间转场的
 *    渐隐覆盖，ML-02 会回归——这是实现里踩过一次的真坑）；
 * ③ **零波及** —— 单卡 section（无 units）不动；timeline 不动；
 * ④ **与 B4 共存** —— autoStages + 转场 + 错峰三者叠加时关系可复算。
 *
 * 直连 Host tsc 编译产物。定向跑：node --test tests/req038-r9-stagger.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { UNIT_ENTRANCE_STAGGER_FRAMES, planFromSpec } from '../lib/remotion/content-spec.js'
import { lintMotion } from '../lib/remotion/motion-lint.js'

function twoUnitSpec() {
  return {
    meta: { title: '错峰', durationSec: 12, fps: 30 },
    sections: [
      { id: 's1', copy: '一屏两单元', units: [
        { card: 'DAT2', copy: '1.2 亿', cell: { x: 28, y: 50, w: 42, h: 44 } },
        { card: 'A4', copy: '三条产品线全部转正', cell: { x: 74, y: 50, w: 40, h: 44 }, overlap: true },
      ] },
    ],
  }
}

test('错峰：后续单元轨入场 +4 帧、末端不动（时长同步减）', () => {
  const plan = planFromSpec(twoUnitSpec(), 360)
  const u0 = plan.tracks.find((track) => track.id === 'u0-s1-u0-bg')
  const u1 = plan.tracks.find((track) => track.id === 'u1-s1-u1-base')
  assert.ok(u0 !== undefined && u1 !== undefined, '两个单元的基底轨必须都在')
  const d0 = u0.startFrame + u0.durationInFrames
  const d1 = u1.startFrame + u1.durationInFrames
  assert.equal(u1.startFrame - u0.startFrame, UNIT_ENTRANCE_STAGGER_FRAMES, `错峰应恰好 ${String(UNIT_ENTRANCE_STAGGER_FRAMES)} 帧`)
  assert.equal(d1, d0, '末端必须不动（脱离转场覆盖 = ML-02 回归）')
})

test('单卡 section（无 units）零波及：timeline 与卡轨起点都不动', () => {
  const spec = {
    meta: { title: '单卡', durationSec: 12, fps: 30 },
    sections: [
      { id: 's1', copy: '开场', card: 'A2' },
      { id: 's2', copy: '收尾', card: 'A5' },
    ],
  }
  const plan = planFromSpec(spec, 360)
  const slot2 = plan.timeline[1]
  assert.equal(slot2.startFrame, 180, 'timeline 不受错峰影响')
  const cardTrack = plan.tracks.find((track) => track.id === 's2-base')
  if (cardTrack !== undefined) {
    // 180 是屏起点；B4 把 to 侧（s2）整体左移 10 帧造叠化窗 → 170。错峰不参与（单卡）。
    assert.equal(cardTrack.startFrame, 180 - 10, '单卡零波及（只吃 B4 的屏移）')
  }
})

test('与 B4 共存：autoStages + 转场 + 错峰三者关系可复算', () => {
  const spec = {
    // 13s → round(13/6.5) = 2 屏，与 2 段对齐（20s 会算出 3 屏被 autoStages 正确拒收）
    meta: { title: '共存', durationSec: 13, fps: 30, autoStages: true },
    sections: [
      { id: 's1', copy: '甲', units: [
        { card: 'DAT2', copy: '1.2 亿', cell: { x: 28, y: 50, w: 42, h: 44 } },
        { card: 'A4', copy: '要点', cell: { x: 74, y: 50, w: 40, h: 44 }, overlap: true },
      ] },
      { id: 's2', copy: '乙', units: [
        { card: 'DAT2', copy: '2.4 亿', cell: { x: 28, y: 50, w: 42, h: 44 } },
        { card: 'A4', copy: '要点二', cell: { x: 74, y: 50, w: 40, h: 44 }, overlap: true },
      ] },
    ],
  }
  const plan = planFromSpec(spec, 390)  // 13s × 30fps —— 必须与 meta.durationSec 一致
  const s2Start = plan.timeline[1].startFrame
  const u1s2 = plan.tracks.find((track) => track.id === 'u1-s2-u1-base')
  assert.ok(u1s2 !== undefined)
  // B4：to 侧整体左移 10 帧；P2-14：unit1 再 +4 → s2Start - 10 + 4
  assert.equal(u1s2.startFrame, s2Start - 10 + UNIT_ENTRANCE_STAGGER_FRAMES)
})

test('lint 回归：错峰修正后样例整片体检仍为 0（末端不动纪律的回归守卫）', () => {
  // 39s 六屏双单元样例（真渲过的那份）——若有人把「末端不动」改回「只移起点」，
  // ML-02 会在此转红（实现踩过一次的坑，钉死它）。
  const spec = JSON.parse(readFileSync(new URL('../skills/code-driven-explainer/assets/screen-plan-example.json', import.meta.url), 'utf8'))
  const plan = planFromSpec(spec, 1170)
  const manifest = { id: 'x', meta: { title: 'x', width: 1920, height: 1080, fps: 30, durationInFrames: 1170, backgroundColor: '#0B1220' }, tracks: plan.tracks }
  assert.equal(lintMotion(manifest).length, 0)
})
