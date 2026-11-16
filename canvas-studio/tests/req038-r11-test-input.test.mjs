/**
 * 测试输入守卫：**文档里那份变体 A 的格位必须真的能跑通**。
 *
 * 抓的是什么：2026-11-16 那份「复刻参考片」测试输入自相矛盾（每屏 5 个元素 vs 2 个
 * units + 格位钉死），任何模型都做不出来，两轮真机共 153 分钟零产物。修好之后最危险
 * 的事是**它再次悄悄失效**：改了 `units` 上限、改了格位相交阈值、改了 box 的
 * 「0–1 比例值」启发式，文档里的格位就可能变成一组会被拒收的数字 —— 而文档不会自己红。
 *
 * 所以这里把变体 A 的六屏原样搭出来，断言：
 * 1. `validateContentSpec` 通过（格位不相交、单元数在限内、carry 字段合法）；
 * 2. `validateManifest` 零 error（投影后的轨全部合法 —— 这一步才抓得住
 *    「结论条太矮被 0–1 启发式误判」这类只在校验层出现的问题）；
 * 3. 三块内容真的都在（标题 / 主体 / 结论各有一条 textCard/chart 轨）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateContentSpec, planFromSpec } from '../lib/remotion/content-spec.js'
import { validateManifest } from '../lib/remotion/manifest.js'

/** 变体 A 的三个格位（与 docs/plans/REQ-038-R11-复刻参考片… 的 3.1 节逐字一致）。 */
const TITLE_CELL = { x: 50, y: 22, w: 100, h: 24 }
const BODY_CELL = { x: 50, y: 58, w: 100, h: 44 }
const VERDICT_CELL = { x: 50, y: 89, w: 100, h: 12 }

const unit = (card, copy, cell, extra = {}) => ({ card, copy, cell, ...extra })

const SCREENS = [
  ['两个选项', [
    unit('A1', '量化基金 / 散户', TITLE_CELL),
    unit('B1', '规则先写死:100\n临场决定:37', BODY_CELL),
    unit('A6', '同一套行情，两种活法', VERDICT_CELL),
  ]],
  ['两条路径', [
    unit('A1', '到底，只有两个选项', TITLE_CELL),
    unit('A4', 'A 动量\nB 均值回归', BODY_CELL),
    unit('A6', '选一条，别骑墙', VERDICT_CELL),
  ]],
  ['买卖之间', [
    unit('A1', '99 买 / 101 卖', TITLE_CELL),
    unit('DAT3', '买入:99\n卖出:101', BODY_CELL),
    unit('A6', '价格只是一半', VERDICT_CELL),
  ]],
  ['波动率', [
    unit('A1', '波动率也会回归', TITLE_CELL, { highlights: [{ text: '回归', color: '#F5A623' }] }),
    unit('DAT6', '1月:2.1\n2月:1.4\n3月:1.0\n4月:1.8\n5月:2.6\n6月:2.2', BODY_CELL, { label: '波动率 | 高→卖 | 低→买' }),
    unit('A6', '高的时候别追', VERDICT_CELL),
  ]],
  ['判断分叉', [
    unit('A1', '继续，还是回来', TITLE_CELL, { highlights: [{ text: '继续', color: '#F5A623' }, { text: '回来', color: '#2EE6A8' }] }),
    unit('A4', '继续：加仓\n回来：减仓', BODY_CELL),
    unit('A6', '先看你的成本', VERDICT_CELL),
  ]],
  ['三个问题', [
    unit('A1', '先问三件事', TITLE_CELL),
    unit('A4', '规则写死了吗\n能扛几次回撤\n什么时候停手', BODY_CELL),
    unit('A6', '答不上就别下手', VERDICT_CELL),
  ]],
]

const TOTAL_FRAMES = 40 * 30

function variantA(carry = []) {
  const sections = SCREENS.map(([label, items], index) => ({
    id: `s${index + 1}`,
    label,
    units: items.map((item, unitIndex) => ({ id: `u${unitIndex + 1}`, ...item })),
  }))
  return {
    meta: { title: '竖屏科普', durationSec: 40, fps: 30, width: 1080, height: 1920, theme: 'neon-data' },
    sections,
    ...(carry.length === 0 ? {} : { carry }),
  }
}

test('变体 A · spec 校验通过（6 屏 × 3 单元，格位按文档给的区间）', () => {
  const check = validateContentSpec(variantA())
  assert.deepEqual(check.errors, [], `变体 A 的格位过不了 spec 校验（文档里的数字要跟着改）：\n${check.errors.join('\n')}`)
})

test('变体 A · 投影后的 manifest 零 error（抓「结论条太矮被 0–1 启发式误判」这类问题）', () => {
  const plan = planFromSpec(variantA(), TOTAL_FRAMES)
  const manifest = {
    id: 'variant-a',
    meta: { title: '竖屏科普', width: 1080, height: 1920, fps: 30, durationInFrames: TOTAL_FRAMES },
    tracks: plan.tracks,
  }
  const check = validateManifest(manifest)
  assert.deepEqual(check.errors, [], `变体 A 出片会被拒：\n${check.errors.join('\n')}`)
  assert.ok(plan.tracks.length > 100, `轨数只有 ${plan.tracks.length}，六屏三单元不该这么少`)
})

test('变体 A · 每屏三块内容都在（标题 / 主体 / 结论各有一轨）', () => {
  const plan = planFromSpec(variantA(), TOTAL_FRAMES)
  for (let index = 1; index <= SCREENS.length; index += 1) {
    const ids = plan.tracks.map((track) => String(track.id))
    // 轨 id 形态：`u<单元下标 0 基>-s<屏序号 1 基>-u<单元 1 基>-<部件>`
    const ofScreen = (suffix) => ids.filter((id) => id.includes(`-s${index}-u`) && id.endsWith(suffix))
    assert.ok(ofScreen('-title').length > 0, `第 ${index} 屏缺标题轨`)
    assert.ok(
      ['-chart', '-data', '-bullets'].some((suffix) => ofScreen(suffix).length > 0),
      `第 ${index} 屏缺主体轨（chart / data / bullets）`,
    )
    assert.ok(ofScreen('-verdict').length > 0, `第 ${index} 屏缺结论条轨`)
  }
})

test('变体 A + carry 文字（S-5）：常驻层铺满全片且只出一条', () => {
  const carry = [{
    id: 'kicker',
    box: { x: 26, y: 9, w: 52, h: 5 },
    color: '#8fa3c4',
    text: '所有策略，只有两个选项',
    textColor: '#8fa3c4',
    letterSpacingEm: 0.1,
  }]
  const spec = variantA(carry)
  assert.deepEqual(validateContentSpec(spec).errors, [], '变体 A + carry 过不了 spec 校验')
  const plan = planFromSpec(spec, TOTAL_FRAMES)
  const kickers = plan.tracks.filter((track) => track.id === 'kicker')
  assert.equal(kickers.length, 1, 'carry 应只出一条（不是每屏一条）')
  assert.equal(kickers[0].type, 'textCard')
  assert.equal(kickers[0].durationInFrames, TOTAL_FRAMES, '常驻层应铺满全片')
  const manifest = {
    id: 'variant-a-carry',
    meta: { title: '竖屏科普', width: 1080, height: 1920, fps: 30, durationInFrames: TOTAL_FRAMES },
    tracks: plan.tracks,
  }
  assert.deepEqual(validateManifest(manifest).errors, [], '带 carry 文字后出片被拒了')
})
