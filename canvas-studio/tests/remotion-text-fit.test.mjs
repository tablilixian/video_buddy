/**
 * 0B（CV-461）：**文本排版计划 / 容量体检 / 静态合同** 的表测。
 *
 * ## 抓的是什么
 *
 * 缺口：`fitTextPolicy` 早就会返回 `overflow`，`TextCard` 也算过，然后四个 variant 分支
 * **全部把它丢掉** ⇒ 文字被 `overflow:hidden` 静默裁掉，而 `validateManifest` 报
 * `ok:true, warnings:[]`（零层拦截）。0B 把「按 variant 决定字号/行数」抽成唯一一份
 * `planTextFit`，组件与体检共用；结果进 `report.textFit` + `warnings`。
 *
 * ## 本文件钉五件事
 *
 * ① **`renderText` 缺省 = 原文**（没缩号时不许用策略的贪心折行替换原文 —— 那会改老片像素）。
 *    这条是**反向变异锚点**：把 `renderText` 改成 `lines.join('\n')` 必须变红。
 * ② 四 variant + caption 的预算与组件逐项对齐（改这里就是改渲染）。
 * ③ `atMinFont` 只在「缩到下限仍溢出」时为真（最严重档）。
 * ④ `auditTextFit` 只审文字轨（textCard / caption），空 manifest 不抛。
 * ⑤ `validateManifest` 的容量静态合同是 **warning 不拒收**（估算无权拒收一份能渲的 manifest）。
 *
 * 直连 Host tsc 产物 `lib/remotion/*.js`（改过 `src/` 必须先 `npx tsc -p tsconfig.json`）。
 * 定向跑：node --test tests/remotion-text-fit.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BULLETS_BASE_FONT_PX,
  BULLETS_MAX_LINES,
  CAPTION_SOFT_MAX_LINES,
  planTextFit,
  suggestedMaxChars,
  TITLE_BASE_FONT_PX,
  TITLE_MAX_LINES,
} from '../lib/remotion/text-fit-plan.js'
import {
  auditTextFit,
  sanitizeTextFitEntries,
  textFitWarnings,
  MAX_TEXT_FIT_WARNINGS,
} from '../lib/remotion/text-fit-audit.js'
import { validateManifest } from '../lib/remotion/manifest.js'
import { asRenderReport } from '../lib/routes.js'
// 等价性对账用：这两个就是 0B 之前组件里的那一套（旧 `fitOrKeep` 的直接依赖）。
import { fitTextPolicy } from '../lib/remotion/timing.js'
import { subtitleFitBudget } from '../lib/remotion/subtitle-fit.js'
import { dataCardDesignHeight, dataCardMetrics } from '../lib/remotion/data-card-metrics.js'

const CANVAS = { canvasWidth: 1920, canvasHeight: 1080 }

/** 24 个汉字：在 1920 宽的 `title` 预算（1728px / 84px ≈ 20.5 字/行）下**刚好折 2 行**。 */
const TITLE_TWO_LINES = '这是一个需要折行的单行标题用来验证原文保留'
/** 90 个汉字：即便缩到字号下限也装不进 2 行 ⇒ 溢出 / atMinFont。 */
const TITLE_OVERFLOW = '文'.repeat(90)

// ── ① renderText 口径（反向变异锚点）────────────────────────────────────

test('0B-1：短文本未缩号 ⇒ renderText === 原文、fontPx === 基准号', () => {
  const plan = planTextFit({ variant: 'title', text: '四季的成因', ...CANVAS })
  assert.equal(plan.overflow, false)
  assert.equal(plan.fontPx, TITLE_BASE_FONT_PX, `未缩号时字号必须正好是基准号，实际 ${plan.fontPx}`)
  assert.equal(plan.renderText, '四季的成因')
  assert.deepEqual(plan.lines, ['四季的成因'])
})

test('0B-1 ★反向变异锚点：能装进 maxLines 但会被算法切开时，renderText 仍必须是原文', () => {
  // 关键场景：字号没降、也没溢出（2 行 ≤ 上限 2），但策略的贪心折行会在第 20 字处插入
  // 硬换行。若组件渲染 `lines.join('\\n')`，浏览器就改按这个断点排版 ⇒ 老片像素漂移。
  const plan = planTextFit({ variant: 'title', text: TITLE_TWO_LINES, ...CANVAS })
  assert.equal(plan.overflow, false)
  assert.equal(plan.fontPx, TITLE_BASE_FONT_PX)
  assert.equal(plan.lines.length, 2, `前提：这段文字确实要折 2 行（实际 ${plan.lines.length}）`)
  assert.equal(plan.renderText, TITLE_TWO_LINES, 'renderText 必须是原文（不是 lines.join）')
  assert.notEqual(plan.lines.join('\n'), plan.renderText, '两者必须不同，否则这条断言没有区分力')
})

test('0B-1：缩了字号 ⇒ renderText 换成策略的行（此时原文本来就会溢出，不存在更好看的旧结果）', () => {
  const plan = planTextFit({ variant: 'title', text: TITLE_OVERFLOW, ...CANVAS })
  assert.equal(plan.overflow, true)
  assert.ok(plan.fontPx < TITLE_BASE_FONT_PX, `缩号必须真的降字号，实际 ${plan.fontPx}`)
  assert.equal(plan.renderText, plan.lines.join('\n'))
})

// ── ①b 等价性对账：重构不许动「本来就没问题」的路径 ─────────────────────────
//
// 0B 把组件的 `fitOrKeep` 搬进 `planTextFit`。**能机器证明的部分先证明**：
// `subtitle`（有没有 box 都算）、无 box 的 `title`、`dataCard` 三条路径的
// 「渲染文本 + 字号」必须与旧实现逐项相同 —— 那就是「老 manifest 逐像素不变」的充分条件
//（DOM 拿到的输入只有 text / fontSize / 容器宽）。
//
// 反过来说：`bullets`（折行宽 900→858、容器宽写死 900→按画布收）与带 box 的 `title`
// （画布 90%→盒宽）是 0B-4 **有意修**的两处，它们不在这张对账表里。

/** 0B 之前组件的 `fitOrKeep`（逐字复刻；只用于对账，不参与生产代码）。 */
function legacyFit(lines, options) {
  const raw = lines.join('\n')
  const fit = fitTextPolicy(raw, options)
  if (fit.fontPx >= options.baseFontPx && !fit.overflow) {
    return { text: raw, fontSize: options.baseFontPx, overflow: false }
  }
  return { text: fit.lines.join('\n'), fontSize: fit.fontPx, overflow: fit.overflow }
}

const EQUIVALENCE_TEXTS = [
  '四季的成因',
  ['四季', '是因为离太阳远近吗？'],
  '这是一个需要折行的单行标题用来验证原文保留',
  '文'.repeat(90),
  '0° Equator',
  ['Direct · 90°', 'Concentrated → warms fast'],
]

test('0B-1 ★等价性：subtitle（含 box）与旧 fitOrKeep 逐项相同', () => {
  for (const text of EQUIVALENCE_TEXTS) {
    for (const box of [undefined, { x: 50, y: 50, w: 16, h: 7 }, { x: 50, y: 50, w: 38, h: 15 }, { x: 50, y: 80, w: 26, h: 8 }]) {
      const budget = subtitleFitBudget({ box: box === undefined ? undefined : { w: box.w, h: box.h }, ...CANVAS })
      const legacy = legacyFit(Array.isArray(text) ? text : [text], {
        maxWidthPx: budget.maxWidthPx,
        baseFontPx: budget.baseFontPx,
        maxLines: budget.maxLines,
      })
      const plan = planTextFit({ variant: 'subtitle', text, ...(box === undefined ? {} : { box }), ...CANVAS })
      const label = `${JSON.stringify(text).slice(0, 24)} @ ${JSON.stringify(box)}`
      assert.equal(plan.renderText, legacy.text, `渲染文本必须逐字相同：${label}`)
      assert.equal(plan.fontPx, legacy.fontSize, `字号必须相同：${label}`)
      assert.equal(plan.overflow, legacy.overflow, `溢出判据必须相同：${label}`)
    }
  }
})

test('0B-1 ★等价性：无 box 的 title 与旧 fitOrKeep 逐项相同', () => {
  for (const text of EQUIVALENCE_TEXTS) {
    const legacy = legacyFit(Array.isArray(text) ? text : [text], {
      maxWidthPx: Math.max(240, CANVAS.canvasWidth * 0.9),
      baseFontPx: 84,
      maxLines: 2,
    })
    const plan = planTextFit({ variant: 'title', text, ...CANVAS })
    assert.equal(plan.renderText, legacy.text, `渲染文本：${JSON.stringify(text).slice(0, 24)}`)
    assert.equal(plan.fontPx, legacy.fontSize, `字号：${JSON.stringify(text).slice(0, 24)}`)
    assert.equal(plan.overflow, legacy.overflow)
  }
})

test('0B-1 ★等价性：dataCard 的标题文本与字号与旧组件相同（不缩号）', () => {
  for (const text of EQUIVALENCE_TEXTS) {
    for (const dataRows of [0, 3]) {
      const lines = Array.isArray(text) ? text : [text]
      const designHeight = dataCardDesignHeight({ titleLines: lines.length, dataRows })
      const metric = dataCardMetrics(undefined, CANVAS.canvasWidth, { canvasHeight: CANVAS.canvasHeight, designHeight })
      const plan = planTextFit({ variant: 'dataCard', text, dataRows, ...CANVAS })
      assert.equal(plan.renderText, lines.join(' '), '标题按空格拼接（旧组件口径）')
      assert.equal(plan.fontPx, Math.round(40 * metric.scale), '字号 = round(40 × 缩放系数)')
    }
  }
})

// ── ② 四个 variant 的预算 ───────────────────────────────────────────────

test('0B-1：title 超长文本 ⇒ overflow=true，字号落在 [0.55×基准, 基准] 区间', () => {
  const plan = planTextFit({ variant: 'title', text: TITLE_OVERFLOW, ...CANVAS })
  assert.equal(plan.overflow, true)
  assert.ok(plan.fontPx <= TITLE_BASE_FONT_PX, `fontPx ${plan.fontPx} 不得大于基准号`)
  assert.ok(plan.fontPx >= Math.floor(TITLE_BASE_FONT_PX * 0.55), `fontPx ${plan.fontPx} 不得低于下限`)
  assert.equal(plan.maxLines, TITLE_MAX_LINES)
})

test('0B-1 / 0B-4：title 带 box ⇒ 可用宽按**盒宽**（旧实现只看画布 90%）', () => {
  const withBox = planTextFit({ variant: 'title', text: '窄盒子里的标题', box: { x: 50, y: 50, w: 20, h: 10 }, ...CANVAS })
  const withoutBox = planTextFit({ variant: 'title', text: '窄盒子里的标题', ...CANVAS })
  assert.equal(Math.round(withBox.maxWidthPx), Math.round(1920 * 0.2), `盒宽 20% ⇒ 384px，实际 ${withBox.maxWidthPx}`)
  assert.equal(Math.round(withoutBox.maxWidthPx), Math.round(1920 * 0.9))
  assert.ok(withBox.maxWidthPx < withoutBox.maxWidthPx, '带窄 box 的可用宽必须更小')
})

test('0B-1：subtitle 带 box ⇒ 按盒宽高算预算（不是画布 86%）', () => {
  const plan = planTextFit({ variant: 'subtitle', text: '0° Equator', box: { x: 50, y: 50, w: 16, h: 4 }, ...CANVAS })
  // subtitle-fit：带 box 时 padX = 16 ⇒ 可用宽 = 盒宽 − 32。
  assert.equal(Math.round(plan.maxWidthPx), Math.round(1920 * 0.16 - 32))
  assert.ok(plan.baseFontPx < 44, `盒高 4%（43.2px）⇒ 基准号必须被高度压下来，实际 ${plan.baseFontPx}`)
})

test('0B-1：subtitle 无 box ⇒ 走老参数（老 manifest 逐像素不变）', () => {
  const plan = planTextFit({ variant: 'subtitle', text: '一句字幕', ...CANVAS })
  assert.equal(Math.round(plan.maxWidthPx), Math.round(1920 * 0.86 - 64))
  assert.equal(plan.baseFontPx, 44)
  assert.equal(plan.maxLines, 3)
  assert.equal(plan.renderText, '一句字幕')
})

test('0B-1 / 0B-4：bullets ⇒ 48px / 6 行；容器宽 min(900, 90%)、文字宽再扣 42px 圆点', () => {
  const plan = planTextFit({ variant: 'bullets', text: ['第一条', '第二条'], ...CANVAS })
  assert.equal(plan.baseFontPx, BULLETS_BASE_FONT_PX)
  assert.equal(plan.maxLines, BULLETS_MAX_LINES)
  assert.equal(plan.containerWidthPx, 900)
  assert.equal(plan.maxWidthPx, 900 - 42, `文字可用宽必须扣掉 42px 圆点，实际 ${plan.maxWidthPx}`)
  // 480p 画布（864）：旧实现容器写死 900 ⇒ 直接溢出画面。
  const small = planTextFit({ variant: 'bullets', text: ['第一条'], canvasWidth: 864, canvasHeight: 480 })
  assert.ok(small.containerWidthPx < 864, `480p 下容器宽必须收进画布，实际 ${small.containerWidthPx}`)
  assert.equal(Math.round(small.containerWidthPx), Math.round(Math.max(300, 864 * 0.9)))
})

test('0B-1：dataCard 不缩字号（字号由 dataCardMetrics 的缩放系数决定）', () => {
  const plan = planTextFit({ variant: 'dataCard', text: '太阳直射点往返范围', dataRows: 3, ...CANVAS })
  assert.equal(plan.fontPx, plan.baseFontPx, 'dataCard 不做自动缩号：fontPx 必须等于基准号')
  assert.equal(plan.renderText, '太阳直射点往返范围')
  // 标题折行数超过「设计高度按几行算」⇒ 会被盒子上下一刀裁掉。
  // 30 字：940px 可用宽 / 40px ⇒ 23.5 字一行 ⇒ 折 2 行，而设计高度只按 1 行算。
  const long = planTextFit({ variant: 'dataCard', text: '这是一段很长的数据卡标题需要折成两行才能放得下全部内容', dataRows: 2, ...CANVAS })
  assert.equal(long.overflow, true, '折行数超过设计行数必须判溢出')
  assert.equal(long.fontPx, long.baseFontPx, '即便溢出也不许改字号')
})

test('0B-1：caption 用自身 fontSize / widthPercent，行数超过软上限才提示', () => {
  const plan = planTextFit({
    variant: 'caption',
    text: '这句话折成好几行都放不下',
    canvasWidth: 1920,
    canvasHeight: 1080,
    caption: { fontSize: 120, widthPercent: 50 },
  })
  assert.equal(plan.baseFontPx, 120)
  assert.equal(Math.round(plan.maxWidthPx), 960)
  assert.equal(plan.maxLines, CAPTION_SOFT_MAX_LINES)
})

// ── ③ 严重档 ───────────────────────────────────────────────────────────

test('0B-1：极长文本 ⇒ atMinFont=true（缩到下限仍溢出）', () => {
  const plan = planTextFit({ variant: 'title', text: '文'.repeat(400), ...CANVAS })
  assert.equal(plan.overflow, true)
  assert.equal(plan.atMinFont, true)
})

test('0B-1：suggestedMaxChars 按汉字全角宽反算（≥1，且短于溢出文本长度）', () => {
  const plan = planTextFit({ variant: 'title', text: TITLE_OVERFLOW, ...CANVAS })
  const chars = suggestedMaxChars(plan)
  assert.ok(chars >= 1)
  assert.ok(chars < TITLE_OVERFLOW.length, `建议字数 ${chars} 必须真的比原文短`)
})

// ── ④ 体检（auditTextFit）─────────────────────────────────────────────

/** 一份含多种轨的 manifest（体检只该看见文字轨）。 */
function mixedManifest() {
  return {
    id: 'comp-0b',
    meta: { title: '0B 体检', width: 1920, height: 1080, fps: 30, durationInFrames: 300 },
    tracks: [
      { id: 'vid', type: 'video', src: '/canvas-studio/assets/p/clip.mp4', startFrame: 0, durationInFrames: 300 },
      { id: 'title-1', type: 'textCard', variant: 'title', text: '四季的成因', startFrame: 0, durationInFrames: 60 },
      { id: 'sub-1', type: 'textCard', variant: 'subtitle', text: '因为地轴倾斜', startFrame: 60, durationInFrames: 60 },
      { id: 'chart-1', type: 'chart', variant: 'bars', labels: ['a'], values: [1], startFrame: 120, durationInFrames: 60 },
      { id: 'shape-1', type: 'shape', shape: 'rect', color: '#fff', startFrame: 120, durationInFrames: 60 },
      { id: 'cap-1', type: 'caption', src: '/canvas-studio/assets/p/v.mp3', text: '一句旁白', startFrame: 180, durationInFrames: 60 },
    ],
  }
}

test('0B-3：auditTextFit 只审文字轨（textCard / caption），video·chart·shape 不进', () => {
  const entries = auditTextFit(mixedManifest())
  assert.deepEqual(entries.map((entry) => entry.id), ['title-1', 'sub-1', 'cap-1'])
  for (const entry of entries) {
    for (const key of ['id', 'variant', 'fontPx', 'baseFontPx', 'maxLines', 'lines', 'overflow', 'atMinFont', 'maxWidthPx']) {
      assert.ok(Object.prototype.hasOwnProperty.call(entry, key), `条目缺字段 ${key}`)
    }
  }
})

test('0B-3：auditTextFit 空 manifest / 无文字轨 ⇒ [] 且不抛', () => {
  assert.deepEqual(auditTextFit({ meta: { width: 1920, height: 1080 }, tracks: [] }), [])
  assert.deepEqual(auditTextFit({ meta: {}, tracks: [] }), [])
})

test('0B-3：注射测量器 ⇒ 度量口径可换（体检与组件用同一份，不各算一套）', () => {
  const text = '这是三十个汉字的标题用来看度量口径能不能换掉估算'
  const manifest = {
    meta: { width: 1920, height: 1080 },
    tracks: [{ id: 'title-1', type: 'textCard', variant: 'title', text, startFrame: 0, durationInFrames: 60 }],
  }
  // 估算口径（汉字 1em）：30 字 × 84px = 2520px ⇒ 2 行，刚好装进 maxLines=2 ⇒ 不溢出。
  const estimated = auditTextFit(manifest, 1920, 1080, () => 0)
  assert.equal(estimated[0].overflow, false, '估算口径下不溢出（前提）')
  // 换「每字 200px」的度量：1728px ⇒ 8 字/行 ⇒ 4 行 > 2 ⇒ 必须判溢出并降字号。
  const fat = (value) => [...value].length * 200
  const measured = auditTextFit(manifest, 1920, 1080, fat)
  assert.equal(measured[0].overflow, true, '按 200px/字的度量必须判溢出')
  assert.ok(measured[0].fontPx < TITLE_BASE_FONT_PX)
})

test('0B-3：textFitWarnings 只对溢出项出文案，且文案带可执行建议', () => {
  const entries = [
    { id: 'a', variant: 'title', fontPx: 84, baseFontPx: 84, maxLines: 2, lines: ['x'.repeat(60)], overflow: true, atMinFont: false, maxWidthPx: 1728 },
    { id: 'b', variant: 'title', fontPx: 84, baseFontPx: 84, maxLines: 2, lines: ['ok'], overflow: false, atMinFont: false, maxWidthPx: 1728 },
  ]
  const warnings = textFitWarnings(entries)
  assert.equal(warnings.length, 1, `只有溢出项才出告警，实际 ${JSON.stringify(warnings)}`)
  assert.ok(warnings[0].includes('《a》'))
  assert.match(warnings[0], /\d+ 字以内/, '必须给「改短到 N 字」的可执行建议')
})

test('0B-3：溢出条目过多时折叠成计数（逐条措辞不吃上下文预算）', () => {
  const entries = Array.from({ length: MAX_TEXT_FIT_WARNINGS + 3 }, (_unused, index) => ({
    id: `t${index}`, variant: 'title', fontPx: 84, baseFontPx: 84, maxLines: 2,
    lines: ['x'.repeat(60)], overflow: true, atMinFont: false, maxWidthPx: 1728,
  }))
  const warnings = textFitWarnings(entries)
  assert.equal(warnings.length, MAX_TEXT_FIT_WARNINGS + 1)
  assert.match(warnings[warnings.length - 1], /另有 3 条/)
})

// ── 宿主收口（/remotion/commit 的 query 通道）────────────────────────────

test('0B-3：sanitizeTextFitEntries 洗掉非法条目但保留合法项（不为报告 400）', () => {
  const raw = [
    { id: 'ok', variant: 'title', fontPx: 84, baseFontPx: 84, maxLines: 2, lines: ['a'], overflow: false, atMinFont: false, maxWidthPx: 1728 },
    { id: 'bad-variant', variant: 'nope', fontPx: 84, baseFontPx: 84, maxLines: 2, lines: ['a'], overflow: false, atMinFont: false, maxWidthPx: 1728 },
    { id: 'bad-number', variant: 'title', fontPx: 'x', baseFontPx: 84, maxLines: 2, lines: ['a'], overflow: false, atMinFont: false, maxWidthPx: 1728 },
    null,
    'nope',
  ]
  const clean = sanitizeTextFitEntries(raw)
  assert.equal(clean.length, 1)
  assert.equal(clean[0].id, 'ok')
  assert.equal(sanitizeTextFitEntries('nope'), undefined)
  assert.equal(sanitizeTextFitEntries([{ id: 'x' }]).length, 0)
})

// ── ④b 上报通道（/remotion/commit 的 metrics 收口）──────────────────────

test('0B-3 ★上报通道：/remotion/commit 的 metrics 收口必须留住 textFit（漏了就是静默丢弃）', () => {
  // 防的是「代码里写对了、报告里没有」：`asRenderReport` 原本只认数值白名单，
  // 数组不在里面 —— 不显式收口，体检结果就在这一步蒸发（CV-146 的同类事故）。
  const metrics = JSON.stringify({
    frames: 300,
    renderMs: 1234,
    quality: 'standard',
    textFit: [
      { id: 'title-1', variant: 'title', fontPx: 60, baseFontPx: 84, maxLines: 2, lines: ['一', '二', '三'], overflow: true, atMinFont: false, maxWidthPx: 384 },
    ],
  })
  const report = asRenderReport(metrics)
  assert.ok(report, '合法 metrics 必须能解析')
  assert.equal(report.frames, 300)
  assert.ok(Array.isArray(report.textFit), `textFit 必须被留住，实际 ${JSON.stringify(report.textFit)}`)
  assert.equal(report.textFit.length, 1)
  assert.equal(report.textFit[0].overflow, true)
  // 形状不符 / 非数组 ⇒ 丢掉这一项，报告其余部分照常（观测信息不值得 400）
  const partial = asRenderReport(JSON.stringify({ frames: 10, textFit: 'nope' }))
  assert.equal(partial.frames, 10)
  assert.equal(partial.textFit, undefined)
  assert.equal(asRenderReport(null), undefined)
})

// ── ⑤ 静态合同（validateManifest 层，warning 不拒收）──────────────────────

function manifestWithTextCard(track) {
  return {
    id: 'comp-0b',
    meta: { title: '0B 静态合同', width: 1920, height: 1080, fps: 30, durationInFrames: 120 },
    tracks: [{ id: 'title-1', type: 'textCard', variant: 'title', startFrame: 0, durationInFrames: 120, ...track }],
  }
}

test('0B-4：textCard.text 是数组且长度 5 > title 的 maxLines 2 ⇒ 告警（不是拒收）', () => {
  const result = validateManifest(manifestWithTextCard({ text: ['一', '二', '三', '四', '五'] }))
  assert.equal(result.ok, true, '溢出是观感问题：不许拒收（拒收会打断渲染流水线）')
  const notes = result.warnings.filter((warning) => warning.includes('title-1') && warning.includes('行'))
  assert.equal(notes.length, 1, `应有一条容量告警，实际：${result.warnings.join(' / ')}`)
  assert.match(notes[0], /字以内|加大|box/, '文案必须可执行')
})

test('0B-4：textCard.text 是字符串且 \\n 行数超过 maxLines ⇒ 告警', () => {
  const result = validateManifest(manifestWithTextCard({ text: '第一行\n第二行\n第三行' }))
  assert.equal(result.ok, true)
  assert.ok(result.warnings.some((warning) => warning.includes('title-1')), result.warnings.join(' / '))
})

test('0B-4：合规 manifest 不出容量告警（0 噪音）', () => {
  const result = validateManifest(manifestWithTextCard({ text: ['四季', '是因为离太阳远近吗？'] }))
  assert.equal(result.ok, true)
  assert.deepEqual(result.errors, [])
  assert.equal(result.warnings.filter((warning) => warning.includes('title-1')).length, 0, result.warnings.join(' / '))
})

test('0B-4：subtitle 的容量判据跟盒子走（同一句话，大盒不告警、小盒告警）', () => {
  // 30 字：小盒（10%×4%）缩到字号下限也只有 14 字/行 ⇒ 仍 3 行 > 上限 1 行。
  const text = '因为地轴倾斜所以四季分明而地轴倾斜的角度几乎不变这就造成了太阳直射点的往返移动'
  const big = validateManifest({
    id: 'c', meta: { title: 't', width: 1920, height: 1080, fps: 30, durationInFrames: 120 },
    tracks: [{ id: 's', type: 'textCard', variant: 'subtitle', text, box: { x: 50, y: 80, w: 60, h: 12 }, startFrame: 0, durationInFrames: 120 }],
  })
  const small = validateManifest({
    id: 'c', meta: { title: 't', width: 1920, height: 1080, fps: 30, durationInFrames: 120 },
    tracks: [{ id: 's', type: 'textCard', variant: 'subtitle', text, box: { x: 50, y: 80, w: 10, h: 4 }, startFrame: 0, durationInFrames: 120 }],
  })
  assert.equal(big.warnings.filter((warning) => warning.includes('《s》')).length, 0, big.warnings.join(' / '))
  assert.ok(small.warnings.some((warning) => warning.includes('《s》')), `小盒子必须告警，实际：${small.warnings.join(' / ')}`)
  assert.equal(small.ok, true)
})
