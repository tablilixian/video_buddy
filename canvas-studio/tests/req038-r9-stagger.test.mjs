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
 * 2026-11-16（R11-B5 / P2-9）更新：多单元屏的**屏级 chrome**（底板/眉标/点阵/光晕/暗角）
 * 改为「整屏一份、只由首个单元出且不投影进格位」。所以断言从「两个单元的 base 都在」
 * 改成「两个单元的**内容轨**都在 + 只有一块整屏底板」—— 原断言正好是把双底板钉死的
 * 那条，必须跟着产品行为一起改，否则测试在保护一个已知缺陷。
 *
 * 直连 Host tsc 编译产物。定向跑：node --test tests/req038-r9-stagger.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { UNIT_ENTRANCE_STAGGER_FRAMES, planFromSpec } from '../lib/remotion/content-spec.js'
import { lintMotion } from '../lib/remotion/motion-lint.js'

/** 同卡双单元：内容轨同型（`-bullets`）才能一对一比较错峰（chrome 已不再是每单元一份）。 */
function twoUnitSpec() {
  return {
    meta: { title: '错峰', durationSec: 12, fps: 30 },
    sections: [
      { id: 's1', copy: '一屏两单元', units: [
        { card: 'A4', copy: '一；二；三', cell: { x: 28, y: 50, w: 42, h: 44 } },
        { card: 'A4', copy: '四；五；六', cell: { x: 74, y: 50, w: 40, h: 44 } },
      ] },
    ],
  }
}

test('错峰：后续单元轨入场 +4 帧、末端不动（时长同步减）', () => {
  const plan = planFromSpec(twoUnitSpec(), 360)
  const u0 = plan.tracks.find((track) => track.id === 'u0-s1-u0-bullets')
  const u1 = plan.tracks.find((track) => track.id === 'u1-s1-u1-bullets')
  assert.ok(u0 !== undefined && u1 !== undefined, '两个单元的内容轨必须都在')
  const d0 = u0.startFrame + u0.durationInFrames
  const d1 = u1.startFrame + u1.durationInFrames
  assert.equal(u1.startFrame - u0.startFrame, UNIT_ENTRANCE_STAGGER_FRAMES, `错峰应恰好 ${String(UNIT_ENTRANCE_STAGGER_FRAMES)} 帧`)
  assert.equal(d1, d0, '末端必须不动（脱离转场覆盖 = ML-02 回归）')
})

test('P2-9：多单元共用一块整屏底板与一个眉标（不是每单元一份）', () => {
  const plan = planFromSpec(twoUnitSpec(), 360)
  const bases = plan.tracks.filter((track) => String(track.id).endsWith('-base'))
  const eyebrows = plan.tracks.filter((track) => String(track.id).endsWith('-eyebrow'))
  assert.equal(bases.length, 1, '一屏只应有一块底板（双底板是 P2-9 的原始缺陷）')
  assert.equal(eyebrows.length, 1, '一屏只应有一个眉标')
  assert.deepEqual(bases[0]?.box, { x: 50, y: 50, w: 100, h: 100 }, '底板必须仍是整屏 —— 裁掉不投影会让另一半漏底')
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
        { card: 'A4', copy: '一；二', cell: { x: 28, y: 50, w: 42, h: 44 } },
        { card: 'A4', copy: '三；四', cell: { x: 74, y: 50, w: 40, h: 44 } },
      ] },
      { id: 's2', copy: '乙', units: [
        { card: 'A4', copy: '五；六', cell: { x: 28, y: 50, w: 42, h: 44 } },
        { card: 'A4', copy: '七；八', cell: { x: 74, y: 50, w: 40, h: 44 } },
      ] },
    ],
  }
  const plan = planFromSpec(spec, 390)  // 13s × 30fps —— 必须与 meta.durationSec 一致
  const s2Start = plan.timeline[1].startFrame
  const u0s2 = plan.tracks.find((track) => track.id === 'u0-s2-u0-bullets')
  const u1s2 = plan.tracks.find((track) => track.id === 'u1-s2-u1-bullets')
  assert.ok(u0s2 !== undefined && u1s2 !== undefined)
  // B4：to 侧整体左移 10 帧 ⇒ 185；A4 的 bullets 在段起点 +6 入场（卡内部节拍，随轨平移）。
  assert.equal(u0s2.startFrame, s2Start - 10 + 6)
  // P2-14：unit1 再 +4 —— 与 B4 的屏移互不干扰（两个常数各管一件事）。
  assert.equal(u1s2.startFrame - u0s2.startFrame, UNIT_ENTRANCE_STAGGER_FRAMES)
})

test('lint 回归：错峰修正后样例整片体检仍为 0（末端不动纪律的回归守卫）', () => {
  // 39s 六屏双单元样例（真渲过的那份）——若有人把「末端不动」改回「只移起点」，
  // ML-02 会在此转红（实现踩过一次的坑，钉死它）。
  const spec = JSON.parse(readFileSync(new URL('../skills/code-driven-explainer/assets/screen-plan-example.json', import.meta.url), 'utf8'))
  const plan = planFromSpec(spec, 1170)
  const manifest = { id: 'x', meta: { title: 'x', width: 1920, height: 1080, fps: 30, durationInFrames: 1170, backgroundColor: '#0B1220' }, tracks: plan.tracks }
  assert.equal(lintMotion(manifest).length, 0)
})
