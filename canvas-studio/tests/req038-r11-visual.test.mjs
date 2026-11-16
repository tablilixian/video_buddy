/**
 * R11 · **表现层三件**（2026-11-16）：
 * ① `DAT6` 折线 + 峰谷标注 + 均值虚线；
 * ② `A6` 结论条（卡外独立强调条）；
 * ③ `textCard.highlights` 分段着色（标题同句两色）。
 *
 * 三样都来自同一个真机诉求：复刻小红书财经科普那类片（「继续」橙 /「回来」青、
 * 一条曲线 + 峰谷标注、卡下一句黑底结论条）。此前 56 张卡里一件都做不出来 ——
 * `chart variant:'line'` 与 `callout` 两个原语早就在，但没有任何一张卡用它们。
 *
 * 定向跑：node --test tests/req038-r11-visual.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getCard } from '../lib/remotion/recipe-cards-all.js'
import { chartPointOnCanvas, chartValueY } from '../lib/remotion/chart-layout.js'
import { splitByHighlights } from '../lib/remotion/text-highlights.js'
import { validateManifest } from '../lib/remotion/manifest.js'

/** 造一份最小可渲 manifest（只为跑 validateManifest）。 */
function manifestOf(tracks, durationInFrames = 240) {
  return {
    id: 'comp-visual',
    meta: { title: 'R11 表现层', width: 1080, height: 1920, fps: 30, durationInFrames },
    tracks,
  }
}

function ctxOf(overrides) {
  return {
    segmentId: 's1',
    label: '',
    copy: '',
    startFrame: 0,
    durationInFrames: 240,
    index: 0,
    sectionCount: 1,
    assetSrc: () => undefined,
    accentColor: '#F5A623',
    ...overrides,
  }
}

// ─────────────────────────── ③ 分段着色（纯函数） ───────────────────────────

test('R11-highlights：同一句切成三段，中间那段不带色', () => {
  const segments = splitByHighlights('继续，还是回来', [
    { text: '继续', color: '#F5A623' },
    { text: '回来', color: '#2EE6A8' },
  ])
  assert.deepEqual(segments, [
    { text: '继续', color: '#F5A623' },
    { text: '，还是' },
    { text: '回来', color: '#2EE6A8' },
  ])
  // 拼回去必须与原文逐字符相同 —— 着色不能改文案
  assert.equal(segments.map((segment) => segment.text).join(''), '继续，还是回来')
})

test('R11-highlights：找不到的子串跳过，不是整句变色', () => {
  const segments = splitByHighlights('继续，还是回来', [
    { text: '根本不存在', color: '#FF0000' },
    { text: '回来', color: '#2EE6A8' },
  ])
  assert.deepEqual(segments, [
    { text: '继续，还是' },
    { text: '回来', color: '#2EE6A8' },
  ])
})

test('R11-highlights：区间重叠时先声明的优先（后一项整项跳过）', () => {
  const segments = splitByHighlights('量化基金', [
    { text: '量化基金', color: '#F5A623' },
    { text: '基金', color: '#2EE6A8' },
  ])
  assert.deepEqual(segments, [{ text: '量化基金', color: '#F5A623' }])
})

test('R11-highlights：没有高亮 / 全部无效 ⇒ 单段且不带 color（走老渲染路径）', () => {
  assert.deepEqual(splitByHighlights('继续', undefined), [{ text: '继续' }])
  assert.deepEqual(splitByHighlights('继续', []), [{ text: '继续' }])
  assert.deepEqual(splitByHighlights('继续', [{ text: '找不到', color: '#fff' }]), [{ text: '继续' }])
  // 单段不带 color 是老路径的判据：DOM 必须与加这个能力之前逐字符一致
  assert.equal(splitByHighlights('继续', [{ text: '', color: '#fff' }])[0].color, undefined)
})

test('R11-highlights：spec 的 highlights 真的落到标题轨上', () => {
  const card = getCard('A2')
  const tracks = card.generate(ctxOf({
    copy: '继续，还是回来',
    highlights: [{ text: '继续', color: '#F5A623' }],
  }))
  const title = tracks.find((track) => String(track.id).endsWith('-title'))
  assert.deepEqual(title.highlights, [{ text: '继续', color: '#F5A623' }])
  // 不带 highlights 时字段不该出现（否则老 manifest 的轨形状变了）
  const plain = card.generate(ctxOf({ copy: '继续，还是回来' }))
  const plainTitle = plain.find((track) => String(track.id).endsWith('-title'))
  assert.equal('highlights' in plainTitle, false)
})

// ─────────────────────────── ① DAT6 折线 + 标注 ───────────────────────────

test('R11-DAT6：折线卡出 chart:line + 两条 callout + 均值虚线', () => {
  const card = getCard('DAT6')
  assert.ok(card, 'DAT6 必须注册（没有卡就等于这个能力不存在）')
  const tracks = card.generate(ctxOf({
    label: '波动率 | 高 → 卖 | 低 → 买',
    copy: '1月:2.1; 2月:1.4; 3月:1.0; 4月:1.8; 5月:2.6; 6月:2.2',
  }))
  const chart = tracks.find((track) => track.type === 'chart')
  assert.equal(chart.variant, 'line', 'spec 通道此前只能出柱状（DAT3）')
  const callouts = tracks.filter((track) => track.type === 'callout')
  assert.equal(callouts.length, 2, '峰和谷各一个标注')
  // 标注文案来自 label 的第 2/3 段
  assert.match(String(callouts[0].text), /高 → 卖/)
  assert.match(String(callouts[1].text), /低 → 买/)
  const meanLine = tracks.find((track) => String(track.id).endsWith('-mean-line'))
  assert.deepEqual(meanLine.dash, [8, 7], '长期均值必须是虚线（实线会和曲线抢注意力）')
  assert.ok(meanLine.stroke, 'line 的虚线要靠 stroke 画（color 只作回落）')
  // 整份轨要能过契约
  const check = validateManifest(manifestOf(tracks))
  assert.equal(check.ok, true, check.errors.join(' | '))
})

test('R11-DAT6：标注点落在图表盒内（引线不能指着空白处）', () => {
  const card = getCard('DAT6')
  const tracks = card.generate(ctxOf({
    label: '波动率',
    copy: '1月:2.1; 2月:1.4; 3月:1.0; 4月:1.8; 5月:2.6; 6月:2.2',
  }))
  const chart = tracks.find((track) => track.type === 'chart')
  const { y, h } = chart.box
  for (const callout of tracks.filter((track) => track.type === 'callout')) {
    assert.ok(callout.anchor.y > y - h / 2 && callout.anchor.y < y + h / 2, `anchor.y=${String(callout.anchor.y)} 应落在 ${String(y - h / 2)}~${String(y + h / 2)}`)
    assert.ok(callout.anchor.x > 0 && callout.anchor.x < 100)
    // 标签盒必须给（契约要求），且不能飘出画布
    assert.ok(typeof callout.box?.y === 'number' && callout.box.y > 0 && callout.box.y < 100)
  }
})

test('R11-DAT6：坐标换算按绘图区内边距走（单位不再多除一次 100）', () => {
  const box = { x: 50, y: 57, w: 82, h: 50 }
  // 指数：绘图区 = box 去掉 left 9 / right 8 / top 7 / bottom 12
  const top = 57 - 25 + 50 * 0.07
  const bottom = 57 + 25 - 50 * 0.12
  assert.ok(Math.abs(chartValueY(1, box, false) - top) < 0.01, 'ratio=1 应贴绘图区顶部')
  assert.ok(Math.abs(chartValueY(0, box, false) - bottom) < 0.01, 'ratio=0 应贴绘图区底部')
  const middle = chartValueY(0.5, box, false)
  assert.ok(Math.abs(middle - (top + bottom) / 2) < 0.01, 'ratio=0.5 应在正中')
  // 首末点的 x 落在绘图区内（不是盒子边缘）
  const first = chartPointOnCanvas(0, 2, 0.5, box, false)
  const last = chartPointOnCanvas(1, 2, 0.5, box, false)
  assert.ok(first.x > box.x - box.w / 2 && first.x < box.x)
  assert.ok(last.x > box.x && last.x < box.x + box.w / 2)
})

test('R11-DAT6：少于 3 个点不硬画折线（两点只有一条直线，标不出峰谷）', () => {
  const card = getCard('DAT6')
  const tracks = card.generate(ctxOf({ label: '波动率', copy: '1月:2.1; 2月:1.4' }))
  assert.equal(tracks.some((track) => track.type === 'chart'), false)
  assert.equal(tracks.some((track) => track.type === 'callout'), false)
  // 但也不能出空屏：回落成一张标题卡
  assert.ok(tracks.some((track) => track.type === 'textCard'))
  assert.equal(validateManifest(manifestOf(tracks)).ok, true)
})

test('R11-DAT6：全平序列不画均值线（和曲线重合，画了等于没画）', () => {
  const card = getCard('DAT6')
  const tracks = card.generate(ctxOf({ label: '平稳', copy: '1月:2; 2月:2; 3月:2; 4月:2' }))
  assert.equal(tracks.some((track) => String(track.id).endsWith('-mean-line')), false)
  assert.equal(tracks.filter((track) => track.type === 'callout').length, 0)
  assert.ok(tracks.some((track) => track.type === 'chart'), '曲线本身还是要画')
})

// ─────────────────────────── ② A6 结论条 ───────────────────────────

test('R11-A6：出一条黑底圆角 + 白字，文案就是 copy', () => {
  const card = getCard('A6')
  assert.ok(card, 'A6 必须注册')
  const tracks = card.generate(ctxOf({ label: '工具 ≠ 押注', copy: '工具再复杂，最后输出的还是一个判断' }))
  const bar = tracks.find((track) => String(track.id).endsWith('-bar'))
  const verdict = tracks.find((track) => String(track.id).endsWith('-verdict'))
  assert.ok(bar, '结论条要有底板（否则白字直接压在画面上）')
  assert.equal(bar.type, 'shape')
  assert.ok(typeof bar.radius === 'number' && bar.radius > 0, '圆角是这个版的识别点')
  assert.equal(verdict.text, '工具再复杂，最后输出的还是一个判断')
  // 文字与底条同一个 y —— 错位就是「字飘在条外面」
  assert.equal(verdict.box.y, bar.box.y)
  assert.equal(validateManifest(manifestOf(tracks)).ok, true)
})

test('R11-A6：没有 label 时不出标题位（并进多单元屏的下半格用）', () => {
  const card = getCard('A6')
  const withTitle = card.generate(ctxOf({ label: '标题位', copy: '一句话' }))
  const without = card.generate(ctxOf({ copy: '一句话' }))
  assert.ok(withTitle.some((track) => String(track.id).endsWith('-kicker')))
  assert.equal(without.some((track) => String(track.id).endsWith('-kicker')), false)
  // 没有标题时结论条要上移，否则屏幕下半截是空的
  const barWith = withTitle.find((track) => String(track.id).endsWith('-bar'))
  const barWithout = without.find((track) => String(track.id).endsWith('-bar'))
  assert.ok(barWithout.box.y < barWith.box.y, '无标题时结论条应上移补空')
})

// ─────────────────────── 契约：highlights 与 line+dash ───────────────────────

test('R11-契约：合法的 highlights 必须放行（白名单真的加进去了）', () => {
  // 只有「非法拒收」是不够的：把字段从白名单里删掉时，非法样本照样被拒（因为变成了
  // 「未知字段」）—— 测试会假绿。这一条才是白名单的判据。
  const manifest = {
    id: 'x',
    meta: { title: 't', width: 1080, height: 1920, fps: 30, durationInFrames: 240 },
    tracks: [{
      id: 'a', type: 'textCard', variant: 'title', text: '继续，还是回来',
      highlights: [{ text: '继续', color: '#F5A623' }, { text: '回来', color: '#2EE6A8' }],
      startFrame: 0, durationInFrames: 120,
    }],
  }
  const check = validateManifest(manifest)
  assert.equal(check.ok, true, check.errors.join(' | '))
  // 契约外字段扫描**只告警不阻断** ⇒ 判据必须看 warnings：
  // 把 'highlights' 从白名单里删掉时，这里会出现一条「契约外字段」告警。
  assert.equal(
    check.warnings.some((warning) => warning.includes('highlights')),
    false,
    `highlights 必须是已登记字段：${check.warnings.join(' | ')}`,
  )
  assert.equal(check.errors.some((error) => error.includes('highlights')), false)
})

test('R11-契约：highlights 形态非法即拒收（字符串 / 空数组 / 超 6 项）', () => {
  const base = {
    id: 'x',
    meta: { title: 't', width: 1080, height: 1920, fps: 30, durationInFrames: 240 },
    tracks: [{ id: 'a', type: 'textCard', variant: 'title', text: '继续，还是回来', startFrame: 0, durationInFrames: 120 }],
  }
  for (const bad of ['继续', [], Array.from({ length: 7 }, (_, i) => ({ text: `w${String(i)}`, color: '#fff' }))]) {
    const manifest = structuredClone(base)
    manifest.tracks[0].highlights = bad
    assert.equal(validateManifest(manifest).ok, false, `${JSON.stringify(bad).slice(0, 20)} 应被拒收`)
  }
})

test('R11-契约：子串在 text 里找不到时给 warning（不是静默失效）', () => {
  const manifest = {
    id: 'x',
    meta: { title: 't', width: 1080, height: 1920, fps: 30, durationInFrames: 240 },
    tracks: [{
      id: 'a', type: 'textCard', variant: 'title', text: '继续，还是回来',
      highlights: [{ text: '不存在', color: '#fff' }],
      startFrame: 0, durationInFrames: 120,
    }],
  }
  const check = validateManifest(manifest)
  assert.equal(check.ok, true, '找不到不阻断（文案可能还要再改一轮）')
  assert.ok(check.warnings.some((warning) => warning.includes('找不到')), check.warnings.join(' | '))
})

test('R11-契约：shape:line 支持 stroke + dash（参考均值虚线的原语缺口）', () => {
  const manifest = {
    id: 'x',
    meta: { title: 't', width: 1080, height: 1920, fps: 30, durationInFrames: 240 },
    tracks: [{
      id: 'l', type: 'shape', shape: 'line', color: 'transparent',
      stroke: 'rgba(255,255,255,0.4)', dash: [8, 7],
      box: { x: 50, y: 50, w: 60, h: 0.3 },
      startFrame: 0, durationInFrames: 120,
    }],
  }
  const check = validateManifest(manifest)
  assert.equal(check.ok, true, check.errors.join(' | '))
  assert.equal(
    check.warnings.some((warning) => warning.includes('dash 但没写 stroke')),
    false,
    'line 的 stroke 缺省回落 color，不该报「漏写 stroke」',
  )
})
