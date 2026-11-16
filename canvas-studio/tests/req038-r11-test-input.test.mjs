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
import { planTextFit } from '../lib/remotion/text-fit-plan.js'

/** 变体 A 的三个格位（与 docs/plans/REQ-038-R11-复刻参考片… 的 3.1 节逐字一致）。 */
const TITLE_CELL = { x: 50, y: 22, w: 100, h: 24 }
const BODY_CELL = { x: 50, y: 58, w: 100, h: 44 }
/**
 * 结论条的格位。`h:14` 而不是 12，是因为结论条用 **A1**（标题卡）承载：
 * 它的标题盒占 cell 高 30% ⇒ 14 × 30% = 4.2% = 81px，才装得下 82px 的字。
 * 用 A6 的话同一格位下 `verdict` 只有 17px 且会把 `label` 以 82px 再打一遍
 * （见本文件最后那条对比断言）。
 */
const VERDICT_CELL = { x: 50, y: 87, w: 100, h: 14 }

const unit = (card, copy, cell, extra = {}) => ({ card, copy, cell, ...extra })

const SCREENS = [
  ['两个选项', [
    unit('A1', '量化基金 / 散户', TITLE_CELL),
    unit('B1', '规则先写死:100\n临场决定:37', BODY_CELL),
    unit('A1', '同一套行情，两种活法', VERDICT_CELL),
  ]],
  ['两条路径', [
    unit('A1', '到底，只有两个选项', TITLE_CELL),
    unit('A4', 'A 动量\nB 均值回归', BODY_CELL),
    unit('A1', '选一条，别骑墙', VERDICT_CELL),
  ]],
  ['买卖之间', [
    unit('A1', '99 买 / 101 卖', TITLE_CELL),
    unit('DAT3', '买入:99\n卖出:101', BODY_CELL),
    unit('A1', '价格只是一半', VERDICT_CELL),
  ]],
  ['波动率', [
    unit('A1', '波动率也会回归', TITLE_CELL, { highlights: [{ text: '回归', color: '#F5A623' }] }),
    unit('DAT6', '1月:2.1\n2月:1.4\n3月:1.0\n4月:1.8\n5月:2.6\n6月:2.2', BODY_CELL, { label: '波动率 | 高→卖 | 低→买' }),
    unit('A1', '高的时候别追', VERDICT_CELL),
  ]],
  ['判断分叉', [
    unit('A1', '继续，还是回来', TITLE_CELL, { highlights: [{ text: '继续', color: '#F5A623' }, { text: '回来', color: '#2EE6A8' }] }),
    unit('A4', '继续：加仓\n回来：减仓', BODY_CELL),
    unit('A1', '先看你的成本', VERDICT_CELL),
  ]],
  ['三个问题', [
    unit('A1', '先问三件事', TITLE_CELL),
    unit('A4', '规则写死了吗\n能扛几次回撤\n什么时候停手', BODY_CELL),
    unit('A1', '答不上就别下手', VERDICT_CELL),
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
    // 结论条也用 A1（标题卡）⇒ 每屏应有 **两条** title 轨：顶部大标题 + 底部结论条
    assert.ok(ofScreen('-title').length >= 2, `第 ${index} 屏缺结论条轨（应有两张标题卡：上标题 + 下结论）`)
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

/**
 * §4「实测过的格位数值」那张表的闸。
 *
 * 抓的是什么：那张表是**手写**的（生成物只管公式与四档画幅，管不到具体格位），
 * 一旦有人改了卡的内部 box 比例、`planTextFit` 的缩号策略或 subtitle 基数，
 * 表里的 138px / 108px / 562×473 就会静默变成假信息 —— 而假信息正是本轮信任
 * 崩塌的机制（模型一对不上就回源码，45 分钟不回来）。所以把表里的数字钉在这里。
 */
test('变体 A · §4 实测数值与现跑一致（138px / 108px / 562×473 / 82px）', () => {
  const plan = planFromSpec(variantA(), TOTAL_FRAMES)
  const W = 1080
  const H = 1920
  const px = (percent, total) => Math.round((percent / 100) * total)
  const ofScreen = (screen, suffix) => plan.tracks.filter(
    (item) => String(item.id).includes(`-s${screen}-u`) && String(item.id).endsWith(suffix),
  )
  const one = (screen, suffix) => {
    const found = ofScreen(screen, suffix)
    assert.equal(found.length, 1, `第 ${screen} 屏应恰好一条 ${suffix} 轨（实际 ${found.length} 条）`)
    return found[0]
  }
  const fit = (track) => planTextFit({
    variant: track.variant,
    text: Array.isArray(track.text) ? track.text : String(track.text ?? ''),
    box: track.box,
    canvasWidth: W,
    canvasHeight: H,
  })

  // 大标题：cell.h 24 → 盒高 138px（这是格位决定的，稳定）
  const topTitle = (screen) => ofScreen(screen, '-title').sort((a, b) => a.box.y - b.box.y)[0]
  const title = topTitle(1)
  assert.equal(px(title.box.h, H), 138, '标题盒高变了（§4 表第 1 行）')
  assert.equal(fit(title).lines.length, 1, '标题应一行不裁')

  // 但**字号会随字数浮动**：同一格位实测 88 / 108 / 115 都出现过，写死单一数字就是假信息
  const titleFontOf = (screen) => fit(topTitle(screen)).fontPx
  assert.equal(titleFontOf(1), 108, '9 字含「/」的标题字号变了（§4 表第 1 行）')
  assert.equal(titleFontOf(2), 88, '9 字含「，」的标题字号变了（§4 表第 1 行）')
  assert.equal(titleFontOf(4), 115, '7 字标题的字号变了（§4 表第 1 行）')

  // 主体 B1：数据块 562×473，copy 的两行必须真的落进 data[]（不是只吃 label）
  const data = one(1, '-data')
  assert.equal(px(data.box.w, W), 562, 'B1 数据块宽度变了（§4 表第 2 行）')
  assert.equal(px(data.box.h, H), 473, 'B1 数据块高度变了（§4 表第 2 行）')
  assert.deepEqual(
    data.data.map((pair) => [pair.k, pair.v]),
    [['规则先写死', '100'], ['临场决定', '37']],
    'B1 的 `键:值` copy 没进 data[]（文档教的写法会白写）',
  )

  // 主体 DAT3：图表 821×439
  const chart = one(3, '-chart')
  assert.equal(px(chart.box.w, W), 821, 'DAT3 图表宽度变了（§4 表第 3 行）')
  assert.equal(px(chart.box.h, H), 439, 'DAT3 图表高度变了（§4 表第 3 行）')

  // 主体 A4：要点框 691×389、字号 85px（2–3 行）
  const bullets = one(2, '-bullets')
  assert.equal(px(bullets.box.w, W), 691, 'A4 要点框宽度变了（§4 表第 4 行）')
  assert.equal(px(bullets.box.h, H), 389, 'A4 要点框高度变了（§4 表第 4 行）')
  assert.equal(fit(bullets).fontPx, 85, 'A4 要点字号变了（§4 表第 4 行）')

  // 结论条（A1 承载）：盒 821×81、字号 82px、一行
  const verdict = ofScreen(1, '-title').sort((a, b) => b.box.y - a.box.y)[0]
  assert.equal(px(verdict.box.w, W), 821, '结论条宽度变了（§4 表第 5 行）')
  assert.equal(px(verdict.box.h, H), 81, '结论条高度变了（§4 表第 5 行）')
  assert.equal(Math.round(fit(verdict).fontPx), 82, '结论条字号变了（§4 表第 5 行）')
  assert.equal(fit(verdict).lines.length, 1, '结论条应一行')
})

/**
 * 为什么结论条**不用 A6**（它是名字上最像的那张卡）。
 *
 * 实测：A6 的 `verdict` 只占卡高 10%、字号恒 17px，而它的 `kicker` 会把
 * `section.label` 用 82px 再打一遍 —— 同一屏里分组名出现两次（眉标 + 结论条），
 * 结论本身却只有一行小字。这条断言把这个理由钉住，免得后人「顺手」改回 A6。
 */
test('结论条不用 A6 的依据：verdict 恒 17px + kicker 把 label 打成 82px', () => {
  const spec = {
    meta: { title: '竖屏科普', durationSec: 10, fps: 30, width: 1080, height: 1920, theme: 'neon-data' },
    sections: [{
      id: 's1',
      label: '买卖之间',
      units: [
        { id: 'u1', card: 'A1', copy: '99 买 / 101 卖', cell: TITLE_CELL },
        { id: 'u2', card: 'DAT3', copy: '买入:99\n卖出:101', cell: BODY_CELL },
        { id: 'u3', card: 'A6', copy: '价格只是一半', cell: VERDICT_CELL },
      ],
    }],
  }
  const plan = planFromSpec(spec, 300)
  const kicker = plan.tracks.find((track) => String(track.id).endsWith('-kicker'))
  const verdict = plan.tracks.find((track) => String(track.id).endsWith('-verdict'))
  assert.ok(kicker !== undefined && verdict !== undefined, 'A6 的 kicker / verdict 轨结构变了（换卡结论要重估）')
  assert.equal(kicker.text, '买卖之间', 'A6 的 kicker 应显示 section.label（这就是「分组名打两遍」的根因）')
  assert.equal(verdict.text, '价格只是一半', 'A6 的 verdict 才是 copy')
  assert.equal(Math.round((verdict.box.h / 100) * 1920), 27, 'A6 verdict 盒高变了（同一个 cell.h:14 下只有 27px）')
  assert.equal(
    planTextFit({ variant: verdict.variant, text: String(verdict.text), box: verdict.box, canvasWidth: 1080, canvasHeight: 1920 }).fontPx,
    17,
    'A6 verdict 字号不再恒 17px 了？「换 A1」的依据要重估',
  )
})

