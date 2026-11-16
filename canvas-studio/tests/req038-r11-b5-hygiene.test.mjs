/**
 * R11 · O-8/O-9/O-10（B5，2026-11-16）· **卫生与内容质量**
 *
 * 锁四件事：
 * ① 密度体检能真的报出「一屏一句话」（40 字 / 20s = 2 字/秒），密的时候闭嘴；
 * ② 多单元屏共用一块底板与一个眉标（P2-9 的双底板双眉标）；
 * ③ `cornerMark` 不再把整行标题文案在左下角重复一遍；
 * ④ `dataSource` 能从 spec 一路到数据轨；`generatedBy` 白名单认 `spec:` / `recipe:` / `template:`。
 *
 * 反向变异（改回旧行为必须红）：
 * - 删掉 `auditSpecDensity` 的 charsPerSec 分支 ⇒ ①红；
 * - `dropRepeatedUnitChrome` 直接返回原数组 ⇒ ②红；
 * - `cornerMark` 改回 `text: ctx.copy` ⇒ ③红（copy 在 textCard 里出现两次）；
 * - `isMarkedGeneratedBy` 只认 `manifest-builder` ⇒ ④红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DENSITY_CHARS_PER_SEC_FLOOR,
  DENSITY_POINTS_PER_SCREEN_FLOOR,
  auditSpecDensity,
} from '../lib/remotion/density-audit.js'
import { dropRepeatedUnitChrome, planFromSpec, validateContentSpec } from '../lib/remotion/content-spec.js'
import { getCard } from '../lib/remotion/recipe-cards-all.js'
import { isMarkedGeneratedBy } from '../lib/remotion/render-report.js'

/** 真机会话的形态：3 屏、每屏一句话（全片 ~30 字 / 20s）。 */
function thinSpec() {
  return {
    meta: { title: '冷芯', fps: 30, durationSec: 20, autoStages: true },
    sections: [
      { id: 's1', card: 'A2', copy: '−60°C 的冰芯' },
      { id: 's2', card: 'A2', copy: '它来自南极' },
      { id: 's3', card: 'A5', copy: '关注我' },
    ],
  }
}

/** 够密 + 有一屏多单元：三个判据都过。 */
function denseSpec() {
  return {
    meta: { title: '冷芯', fps: 30, durationSec: 20, autoStages: true },
    sections: [
      { id: 's1', card: 'A4', copy: '冰芯是冰盖的年轮；每年一层；层里封着当年的空气与尘埃' },
      {
        id: 's2',
        units: [
          { card: 'B1', copy: '真实温度:−60°C；芯径:1.2mm；钻取深度:3200m', cell: { x: 26, y: 50, w: 44, h: 60 } },
          { card: 'A4', copy: '越冷越慢；−60°C 是临界点；再冷冰会变脆', cell: { x: 74, y: 50, w: 40, h: 60 } },
        ],
      },
      { id: 's3', card: 'A4', copy: '一层冰一年；一米冰一千年；深冰就是远古大气' },
    ],
  }
}

test('B5-①：一屏一句话会被点名（字/秒 + 屏均信息点）', () => {
  const audit = auditSpecDensity(thinSpec(), 600, 30)
  assert.equal(audit.screens, 3)
  assert.equal(Math.round(audit.seconds), 20)
  assert.ok(audit.charsPerSec < DENSITY_CHARS_PER_SEC_FLOOR, `实测 ${String(audit.charsPerSec)} 字/秒`)
  assert.ok(audit.pointsPerScreen < DENSITY_POINTS_PER_SCREEN_FLOOR)
  const joined = audit.warnings.join('\n')
  assert.match(joined, /内容密度：/)
  assert.match(joined, /字\/秒/)
  assert.match(joined, /信息点/)
  assert.match(joined, /版面：全片没有一屏用到多单元/, '要指出「一屏单元素」这个版面成因')
  assert.ok(audit.warnings.some((line) => line.includes('targetStageSec')), '要给出可执行的密度手段')
})

test('B5-①：够密的时候闭嘴（不制造噪声）', () => {
  const audit = auditSpecDensity(denseSpec(), 600, 30)
  assert.ok(audit.charsPerSec >= DENSITY_CHARS_PER_SEC_FLOOR, `实测 ${String(audit.charsPerSec)} 字/秒`)
  assert.ok(audit.pointsPerScreen >= DENSITY_POINTS_PER_SCREEN_FLOOR, `实测 ${String(audit.pointsPerScreen)} 点/屏`)
  assert.deepEqual(audit.warnings, [], '密度没问题就不该有告警')
})

test('B5-①：多单元屏的每个单元至少算一个信息点', () => {
  const audit = auditSpecDensity({
    meta: { title: 'x', fps: 30, durationSec: 20 },
    sections: [{
      id: 's1',
      units: [
        { card: 'B1', copy: '只有一个词', cell: { x: 26, y: 50, w: 44, h: 60 } },
        { card: 'A4', copy: '也只有一个词', cell: { x: 74, y: 50, w: 40, h: 60 } },
      ],
    }],
  }, 600, 30)
  assert.equal(audit.perScreen[0]?.units, 2)
  assert.equal(audit.perScreen[0]?.points, 2, '单元分区本身就是两处独立信息')
})

test('B5-②：多单元只让首个单元出屏级 chrome', () => {
  const tracks = [
    { id: 's2-u1-base', type: 'shape' },
    { id: 's2-u1-eyebrow', type: 'textCard' },
    { id: 's2-u1-dots', type: 'shape' },
    { id: 's2-u1-glow', type: 'shape' },
    { id: 's2-u1-vignette', type: 'shape' },
    { id: 's2-u1-data', type: 'textCard' },
    { id: 's2-u1-accent', type: 'shape' },
  ]
  const first = dropRepeatedUnitChrome(tracks, 0)
  assert.equal(first.length, tracks.length, '首个单元必须原样保留屏级 chrome')
  assert.notEqual(first[0], tracks[0], '要返回副本：随后会原地平移 startFrame，不能改到卡生成器的原对象')

  const second = dropRepeatedUnitChrome(tracks, 1)
  assert.deepEqual(second.map((track) => track.id), ['s2-u1-data', 's2-u1-accent'], '后续单元只留自己的内容轨')
})

test('B5-③：cornerMark 不再重复整行文案（copy 在 textCard 中只出现一次）', () => {
  const copy = '−60°C 的冰芯'
  const ctx = {
    segmentId: 's1',
    label: '冷芯',
    copy,
    startFrame: 0,
    durationInFrames: 200,
    index: 0,
    sectionCount: 3,
    assetSrc: () => undefined,
    accentColor: '#4f9cf9',
  }
  for (const cardId of ['A1', 'A2', 'A5']) {
    const card = getCard(cardId)
    assert.ok(card, `${cardId} 必须已注册`)
    const tracks = card.generate(ctx)
    const copyTracks = tracks.filter((track) => track.type === 'textCard' && track.text === copy)
    assert.equal(copyTracks.length, 1, `${cardId}：标题文案只能出现一次（角标此前又放了一遍）`)
    const corner = tracks.find((track) => String(track.id).endsWith('-corner'))
    assert.ok(corner, `${cardId} 仍要有角落刻度`)
    assert.equal(corner.type, 'shape', `${cardId} 的角标应是视觉刻度，不是第二处文案`)
  }
})

test('B5-④：dataSource 从 spec 透传到数据轨', () => {
  const card = getCard('B1')
  assert.ok(card)
  const tracks = card.generate({
    segmentId: 's2',
    label: '冰芯',
    copy: '真实温度:−60°C；芯径:1.2mm',
    startFrame: 0,
    durationInFrames: 200,
    index: 1,
    sectionCount: 3,
    assetSrc: () => undefined,
    accentColor: '#4f9cf9',
    dataSource: 'NASA GISTEMP v4, https://data.giss.nasa.gov/gistemp/',
  })
  const data = tracks.find((track) => track.id === 's2-data')
  assert.ok(data)
  assert.match(String(data.dataSource), /NASA GISTEMP/)

  // 不给就不写：诚实（没来源就是没来源，渲染侧照旧告警）。
  const plain = card.generate({
    segmentId: 's3',
    label: 'x',
    copy: 'a:1',
    startFrame: 0,
    durationInFrames: 200,
    index: 2,
    sectionCount: 3,
    assetSrc: () => undefined,
    accentColor: '#4f9cf9',
  })
  assert.equal(plain.find((track) => track.id === 's3-data')?.dataSource, undefined)
})

test('B5-④：generatedBy 白名单（spec / recipe / template 都算走正路）', () => {
  assert.equal(isMarkedGeneratedBy('manifest-builder'), true)
  assert.equal(isMarkedGeneratedBy('spec:content-spec'), true, 'spec 通道此前每片都带一条假告警')
  assert.equal(isMarkedGeneratedBy('recipe:explainer-cards'), true)
  assert.equal(isMarkedGeneratedBy('template:family/id'), true)
  assert.equal(isMarkedGeneratedBy(''), false)
  assert.equal(isMarkedGeneratedBy(undefined), false)
  assert.equal(isMarkedGeneratedBy('handwritten'), false, '裸标记仍要告警（手写绕过 builder）')
})

test('B5-O8：targetStageSec 让知识型片更密（20s ⇒ 5 屏），且两处算法同参数', () => {
  const five = {
    meta: { title: '冷芯', fps: 30, durationSec: 20, autoStages: true, targetStageSec: 4 },
    sections: [
      { id: 's1', card: 'A4', copy: '一；二；三' },
      { id: 's2', card: 'A4', copy: '一；二；三' },
      { id: 's3', card: 'A4', copy: '一；二；三' },
      { id: 's4', card: 'A4', copy: '一；二；三' },
      { id: 's5', card: 'A4', copy: '一；二；三' },
    ],
  }
  assert.equal(validateContentSpec(five).ok, true, validateContentSpec(five).errors.join('；'))
  const plan = planFromSpec(five, 600)
  assert.equal(plan.segments.length, 5, '4s/屏 ⇒ 20s 算 5 屏')
  assert.equal(plan.segments.reduce((sum, segment) => sum + segment.frames, 0), 600)
})

test('B5-O8：屏数与段数不符时把「改 4s 会算几屏」算给模型', () => {
  // 模型写了 5 段（想更密）但仍按 6.5s/屏算 ⇒ 3 屏。此时必须直接给出「4s ⇒ 5 屏」。
  const fiveSections = [
    ...thinSpec().sections,
    { id: 's4', card: 'A4', copy: '四' },
    { id: 's5', card: 'A4', copy: '五' },
  ]
  const check = validateContentSpec({ ...thinSpec(), sections: fiveSections })
  assert.equal(check.ok, false)
  const joined = check.errors.join('\n')
  assert.match(joined, /但 sections 写了 5 段/)
  assert.match(joined, /targetStageSec: 4 ⇒ 5 屏/, '这一步模型自己算不准，必须直接给答案')
})

test('B5-O8：targetStageSec 越界即拒收（不给「写了不生效」留口子）', () => {
  const check = validateContentSpec({ ...thinSpec(), meta: { ...thinSpec().meta, targetStageSec: 3 } })
  assert.equal(check.ok, false)
  assert.match(check.errors.join('\n'), /targetStageSec 必须是 4–20/)
})
