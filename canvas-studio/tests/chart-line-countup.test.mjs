/**
 * P2'（2026-11-03）：chart `line` 独立折线 variant + dataCard `countUp` 数位滚动。
 *
 * 直连 Host tsc 编译产物 lib/remotion/manifest.js 与 lib/remotion/count-up.js。
 * 定向跑：node --test tests/chart-line-countup.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COUNT_UP_DURATION_FRAMES, countUpTextAt } from '../lib/remotion/count-up.js'
import { validateManifest } from '../lib/remotion/manifest.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8')

function manifestWith(tracks) {
  return {
    id: 'comp-p2prime',
    meta: { title: 'P2prime', width: 1376, height: 768, fps: 30, durationInFrames: 120 },
    tracks,
  }
}

const lineChart = { id: 'c1', type: 'chart', variant: 'line', labels: ['一', '二', '三'], values: [2, 5, 9], startFrame: 0, durationInFrames: 120 }
const dataCard = (extra = {}) => ({
  id: 'd1', type: 'textCard', variant: 'dataCard', text: '关键指标',
  data: [{ k: '占比', v: '16%' }], startFrame: 0, durationInFrames: 120, ...extra,
})

// ── countUpTextAt 纯函数 ──

test('countUpTextAt：起点 0、终点精确收敛、端点不漂', () => {
  assert.equal(countUpTextAt('16%', 0), '0%')
  assert.equal(countUpTextAt('16%', COUNT_UP_DURATION_FRAMES), '16%')
  assert.equal(countUpTextAt('16%', COUNT_UP_DURATION_FRAMES + 90), '16%')
})

test('countUpTextAt：前后缀保留、小数位与目标对齐、负数可滚', () => {
  assert.equal(countUpTextAt('¥3.2', 0), '¥0.0')
  assert.equal(countUpTextAt('¥3.2', COUNT_UP_DURATION_FRAMES), '¥3.2')
  assert.equal(countUpTextAt('45.1亿', 0), '0.0亿')
  assert.equal(countUpTextAt('-12', COUNT_UP_DURATION_FRAMES), '-12')
  assert.equal(countUpTextAt('-12', 0), '0')
})

test('countUpTextAt：中段单调递增且不超过目标（easeOutCubic）', () => {
  let prev = -1
  for (let f = 0; f <= COUNT_UP_DURATION_FRAMES; f += 5) {
    const value = Number.parseFloat(countUpTextAt('80', f))
    assert.ok(value >= prev, `frame ${f}: ${value} < ${prev}`)
    assert.ok(value <= 80, `frame ${f}: ${value} > 80`)
    prev = value
  }
})

test('countUpTextAt：不可解析的 v 原样返回（多段数字 / 纯文案容错）', () => {
  assert.equal(countUpTextAt('12abc34', 10), '12abc34')
  assert.equal(countUpTextAt('凌晨三点', 10), '凌晨三点')
  assert.equal(countUpTextAt('', 10), '')
})

// ── 校验层 ──

test('校验：variant line 合法且无契约告警', () => {
  const result = validateManifest(manifestWith([lineChart]))
  assert.equal(result.ok, true, result.errors.join('；'))
  assert.deepEqual(result.warnings.filter((w) => !w.startsWith('[编排体检 ')), [], result.warnings.join('；'))
})

test('校验：非法 variant 报错并列出全部合法值（守卫可反向变红；4.1 起 pie 合法，样本换 treemap）', () => {
  const result = validateManifest(manifestWith([{ ...lineChart, variant: 'treemap' }]))
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((e) => e.includes('bars / dual / line / pie / donut / gauge')), result.errors.join('；'))
})

test('校验：line 变体写 lineValues → warning 不生效；dual 缺 lineValues → 报错', () => {
  const warned = validateManifest(manifestWith([{ ...lineChart, lineValues: [1, 2, 3] }]))
  assert.equal(warned.ok, true)
  assert.ok(warned.warnings.some((w) => w.includes('lineValues 只在')), warned.warnings.join('；'))

  const dualMissing = validateManifest(manifestWith([{ ...lineChart, variant: 'dual' }]))
  assert.equal(dualMissing.ok, false)
  assert.ok(dualMissing.errors.some((e) => e.includes('必须提供 lineValues')), dualMissing.errors.join('；'))
})

test('校验：countUp 布尔合法、非布尔报错、非 dataCard 只告警', () => {
  const ok = validateManifest(manifestWith([dataCard({ countUp: true })]))
  assert.equal(ok.ok, true, ok.errors.join('；'))
  assert.deepEqual(ok.warnings.filter((w) => !w.startsWith('[编排体检 ')), [], ok.warnings.join('；'))

  const badType = validateManifest(manifestWith([dataCard({ countUp: 'yes' })]))
  assert.equal(badType.ok, false)
  assert.ok(badType.errors.some((e) => e.includes('.countUp 必须是布尔值')), badType.errors.join('；'))

  const wrongVariant = validateManifest(manifestWith([
    { id: 't1', type: 'textCard', variant: 'subtitle', text: '字幕', countUp: true, startFrame: 0, durationInFrames: 120 },
  ]))
  assert.equal(wrongVariant.ok, true)
  assert.ok(wrongVariant.warnings.some((w) => w.includes("countUp 只在 variant:'dataCard' 下生效")), wrongVariant.warnings.join('；'))
})

// ── 文档对码 ──

test('文档对码：契约 / SKILL / 缺口清单三处都记录了 line 与 countUp', () => {
  const contract = read('skills/code-driven-explainer/references/manifest-contract.md')
  assert.ok(contract.includes('`line`（P2\' · 独立折线）'), 'contract 缺 line 说明')
  assert.ok(contract.includes('`countUp`（P2\' · 数位滚动，仅 `dataCard`）'), 'contract 缺 countUp 说明')

  const skill = read('skills/code-driven-explainer/SKILL.md')
  assert.ok(skill.includes('柱状/双轴/折线'), 'SKILL.md 图表清单未更新')
  assert.ok(skill.includes('countUp'), 'SKILL.md 未提 countUp')

  const cards = read('skills/code-driven-explainer/references/shot-cards.md')
  assert.ok(cards.includes('2026-11-03 解锁'), 'shot-cards 缺口清单未标记 DigitRoll 解锁')
})
