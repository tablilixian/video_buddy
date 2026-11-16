/**
 * 几何与换算表（S-3）：**cell → 盒高 → 字号 → 行数**这条推导链的唯一文档。
 *
 * ## 抓的是什么浪费
 *
 * 2026-11-16 真机两轮会话里约 **18 次 bash** 在反推这条链：
 * `content-spec.ts`（cell 投影）+ `recipe-cards.ts`（卡内 box 百分比）+
 * `type-scale.ts`（1080 基准换算）+ `text-fit-plan.ts`（缩号与行数上限）。
 * 用户给的是 `cell h:24`，模型要判断「标题会不会被裁」必须走完四个文件 ——
 * 而这条链**从来没有被写成文档**，它只散落在源码注释里。
 *
 * ## 口径：算例比公式有用
 *
 * 模型真正需要的不是「公式推导」，而是「这个 cell 里能放几个字」。所以本文件的
 * 重点在**第 4 节的实测算例**：每一行的数值都是现调 `planTextFit()` 得来的，
 * 与渲染侧同源（同一个函数），不是手抄的。
 *
 * 漂移由 `tests/spec-geometry-drift.test.mjs` 守：它除了比对生成物，还**硬编码**
 * 四个算例的期望值 —— 常量一变，测试立刻红，逼你确认「这是有意改设计」再重生成。
 *
 * ## 用法
 *
 *   node scripts/gen-spec-geometry.mjs           # 重写生成物
 *   node scripts/gen-spec-geometry.mjs --check   # 只比对
 *
 * ⚠️ import `lib/` ⇒ 必须在 `yarn build` 之后跑。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  planTextFit,
  TITLE_BASE_FONT_PX, TITLE_MAX_LINES, TITLE_LINE_HEIGHT,
  BULLETS_BASE_FONT_PX, BULLETS_MAX_LINES, BULLETS_LINE_HEIGHT, BULLETS_ROW_GAP_PX,
  DATA_CARD_TITLE_FONT_PX,
  TIMECODE_BASE_FONT_PX,
  CAPTION_FONT_RATIO, CAPTION_SOFT_MAX_LINES,
} from '../lib/remotion/text-fit-plan.js'
import { SUBTITLE_BASE_FONT_PX, SUBTITLE_MAX_LINES, SUBTITLE_LINE_HEIGHT } from '../lib/remotion/subtitle-fit.js'
import { DESIGN_CANVAS_HEIGHT, scaleDesignPx } from '../lib/remotion/type-scale.js'
import { planFromSpec } from '../lib/remotion/content-spec.js'
import { validateManifest } from '../lib/remotion/manifest.js'

const here = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = join(here, '..')
export const OUTPUT = join(workspaceRoot, 'skills', 'code-driven-explainer', 'references', 'spec-geometry.generated.md')

/** 四档画布（与 `resolution-tiers.ts` 同源；竖屏单列）。 */
const CANVASES = [
  { name: '480p', width: 864, height: 480 },
  { name: '720p', width: 1376, height: 768 },
  { name: '1080p', width: 1920, height: 1088 },
  { name: '竖屏 1080×1920', width: 1080, height: 1920 },
]

/**
 * 卡内 box 占 cell 的比例（探针实测，不是抄常量）。
 *
 * 为什么要跑一遍而不写死 30%：卡内 box 是各卡自己的百分比（A1 标题 30%、
 * A4 要点 46%），写死一个值会在换卡时变成假信息 —— 而假信息正是本轮信任崩塌的机制。
 */
function cardInnerRatio(cardId, suffix) {
  const cell = { x: 50, y: 50, w: 100, h: 50 }
  const spec = {
    meta: { title: 'geo', width: 1080, height: 1920, fps: 30, durationSec: 6 },
    sections: [{ id: 's1', label: '甲', card: cardId, copy: '示例', cell }],
  }
  const track = planFromSpec(spec, 180).tracks.find((item) => String(item.id).endsWith(suffix))
  if (track === undefined) throw new Error(`gen-spec-geometry：${cardId} 没有 ${suffix} 轨（卡结构变了，本表推导失效）`)
  const ratio = track.box.h / cell.h
  if (!(ratio > 0.05 && ratio < 1)) throw new Error(`gen-spec-geometry：${cardId}${suffix} 内框比例异常（${ratio}）`)
  return ratio
}

/** 卡在给定 cell 下，某条轨的实际投影 box（画布百分比）—— 渲染侧用的就是这个值。 */
function projectedBox(cardId, suffix, cell) {
  const spec = {
    meta: { title: 'geo', width: 1080, height: 1920, fps: 30, durationSec: 6 },
    sections: [{ id: 's1', label: '甲', card: cardId, copy: '示例', cell }],
  }
  const track = planFromSpec(spec, 180).tracks.find((item) => String(item.id).endsWith(suffix))
  if (track === undefined) throw new Error(`gen-spec-geometry：${cardId} 没有 ${suffix} 轨`)
  return track.box
}

const round = (value) => Math.round(value * 10) / 10

/** 一个算例 → 一行（数值全部来自现跑 planTextFit，box 取卡的真实投影）。 */
function sizingCase({ cardId, suffix, cell, canvas, variant, text }) {
  const box = projectedBox(cardId, suffix, cell)
  const plan = planTextFit({ variant, text, box, canvasWidth: canvas.width, canvasHeight: canvas.height })
  return {
    px: plan.fontPx,
    base: plan.baseFontPx,
    boxHeightPx: plan.boxHeightPx,
    lines: plan.lines.length,
    maxLines: plan.maxLines,
    overflow: plan.overflow,
    heightLimited: plan.heightLimited === true,
  }
}

/**
 * 最小可用 `cell.h`：再小就会被 `box` 的「0–1 比例值」启发式误判。
 *
 * 卡内小元素（A6 的结论文字占卡高 10%、眉标占 6%）投影进很矮的 cell 时，
 * 绝对百分比会掉到 ≤1 —— 而这条启发式把 `h ≤ 1` 当成「有人写了 0–1 比例」直接拒收。
 * 这个坑无法从文档数字上看出（回执只说「疑似 0–1 比例值」，看起来像自己写错了单位），
 * 所以在这里**搜出阈值写进表里**。
 */
function minUsableCellH(cardId, copy) {
  for (let h = 4; h <= 60; h += 1) {
    const spec = {
      meta: { title: 'geo', width: 1080, height: 1920, fps: 30, durationSec: 6 },
      sections: [{ id: 's1', label: '甲', card: cardId, copy, cell: { x: 50, y: 50, w: 100, h } }],
    }
    const plan = planFromSpec(spec, 180)
    const manifest = {
      id: 'probe',
      meta: { title: 'geo', width: 1080, height: 1920, fps: 30, durationInFrames: 180 },
      tracks: plan.tracks,
    }
    const check = validateManifest(manifest)
    if (!check.errors.some((message) => message.includes('0–1 比例值'))) return h
  }
  throw new Error(`gen-spec-geometry：${cardId} 在 cell.h 60 以内都过不了 box 校验`)
}

/** 生成整份文档。 */
export function renderSpecGeometry() {
  const innerTitle = cardInnerRatio('A1', '-title')
  const innerBullets = cardInnerRatio('A4', '-bullets')
  const lines = [
    '<!-- 机器生成：node scripts/gen-spec-geometry.mjs；请勿手改（改常量后重跑，门禁 tests/spec-geometry-drift.test.mjs 会红） -->',
    '',
    '# 几何与换算（cell → 盒高 → 字号 → 行数）',
    '',
    '> **要判断「这个 cell 里能放多少字」只看本文件**，不要去读 `cell-projection.ts` /',
    '> `type-scale.ts` / `text-fit-plan.ts` —— 这条链横跨三个文件，反推一次要 18 次读源码。',
    '> 第 4 节的算例是**现调 `planTextFit()` 算出来的**，与成片同源。',
    '',
    '## 1. 三段换算（公式）',
    '',
    '```',
    '① cell 百分比 → 画布像素：  px = cell.h% / 100 × 画布高',
    '② 卡内 box 再按卡自己的比例缩一次：  盒高 = px × 卡内比例（A1 标题 = ' + (innerTitle * 100).toFixed(0) + '%，A4 要点 = ' + (innerBullets * 100).toFixed(0) + '%）',
    '③ 字号 = 设计 px × (画布高 / ' + DESIGN_CANVAS_HEIGHT + ')     ← 设计基准是 1080 高',
    '```',
    '',
    '**行高与字号一起被缩放**，所以「一行高多少像素」= 字号 × 行高系数。',
    '判定溢出：`行数 × 字号 × 行高系数 > 盒高` ⇒ 触发缩号（内容不丢，只变小）。',
    '',
    '## 2. ' + DESIGN_CANVAS_HEIGHT + ' 基准换算表（同一设计值在四档画布上的实际像素）',
    '',
    '| 画布 | 缩放系数 | title ' + TITLE_BASE_FONT_PX + 'px → | bullets ' + BULLETS_BASE_FONT_PX + 'px → | subtitle ' + SUBTITLE_BASE_FONT_PX + 'px → |',
    '|---|---|---|---|---|',
    ...CANVASES.map((canvas) => {
      const scale = scaleDesignPx(100, canvas.height) / 100
      return `| ${canvas.name} | ×${scale.toFixed(2)} | ${Math.round(scaleDesignPx(TITLE_BASE_FONT_PX, canvas.height))}px | ${Math.round(scaleDesignPx(BULLETS_BASE_FONT_PX, canvas.height))}px | ${Math.round(scaleDesignPx(SUBTITLE_BASE_FONT_PX, canvas.height))}px |`
    }),
    '',
    '> 竖屏（1080×1920）按**高度**换算，所以字号被放大到 ×1.78 —— 这也是「竖屏标题特别容易裁」的原因：',
    '> 字号放大了，但卡内 box 的百分比没变，cell 一矮就装不下。',
    '',
    '## 3. 各 variant 的排版规则',
    '',
    '| variant | 基准号（设计 px） | 行高系数 | 行数上限 | 缩号下限 |',
    '|---|---|---|---|---|',
    `| title | ${TITLE_BASE_FONT_PX} | ${TITLE_LINE_HEIGHT} | ${TITLE_MAX_LINES} | 基准 ×0.55 |`,
    `| bullets | ${BULLETS_BASE_FONT_PX}（行间距另有 ${BULLETS_ROW_GAP_PX}px 固定值） | ${BULLETS_LINE_HEIGHT} | ${BULLETS_MAX_LINES} | 基准 ×0.55 |`,
    `| subtitle | ${SUBTITLE_BASE_FONT_PX} | ${SUBTITLE_LINE_HEIGHT} | ${SUBTITLE_MAX_LINES} | 基准 ×0.55 |`,
    `| dataCard | ${DATA_CARD_TITLE_FONT_PX}（标题；有显式字号，**不缩号**） | 固定行高 | 按卡片设计 | 不缩 |`,
    `| caption | 画布高 × ${CAPTION_FONT_RATIO} | 固定 | ${CAPTION_SOFT_MAX_LINES}（软上限） | 不缩 |`,
    `| timecode | ${TIMECODE_BASE_FONT_PX} | 1.2 | 按标签行数 | 不缩 |`,
    '',
    '## 4. 实测算例（数值来自 `planTextFit()`，与成片同源）',
    '',
    '| 场景 | cell（h = 高%） | 盒高 | 基准号 | 实际号 | 行数 | 结论 |',
    '|---|---|---|---|---|---|---|',
  ]

  const cases = [
    {
      title: '竖屏 title · 盒被压扁（真机 h:24）',
      cardId: 'A1', suffix: '-title',
      cell: { x: 50, y: 22, w: 100, h: 24 },
      canvas: CANVASES[3],
      variant: 'title',
      text: '量化基金 散户',
      note: (row) => (row.heightLimited ? `字号 ${row.base} → ${row.px}，**不裁字**（想要更大字号就加 cell.h，满号阈值见下面那行）` : '未触发高度限制'),
    },
    {
      title: '竖屏 title · 给足高度（h:30）',
      cardId: 'A1', suffix: '-title',
      cell: { x: 50, y: 22, w: 100, h: 30 },
      canvas: CANVASES[3],
      variant: 'title',
      text: '量化基金 散户',
      note: (row) => (row.heightLimited ? `仍被压到 ${row.px}：盒高还不够，继续加 cell.h` : `满号 ${row.px}，一行不裁`),
    },
    {
      title: '竖屏 bullets · 四条要点（h:56）',
      cardId: 'A4', suffix: '-bullets',
      cell: { x: 50, y: 62, w: 100, h: 56 },
      canvas: CANVASES[3],
      variant: 'bullets',
      text: ['量化基金：规则先写死', '按信号执行', '散户：临场决定', '看心情执行'],
      note: (row) => (row.overflow ? `超出 ${row.maxLines} 行上限，会裁` : `${row.lines} 条全在${row.heightLimited ? `（字号 ${row.base} → ${row.px}）` : ''}`),
    },
    {
      title: '竖屏 title · 满号需要多高的 cell（自动搜索）',
      cardId: 'A1', suffix: '-title',
      // 满号阈值由下面的搜索算出来，这里给个占位（会被覆盖）
      cell: { x: 50, y: 22, w: 100, h: 24 },
      canvas: CANVASES[3],
      variant: 'title',
      text: '量化基金 散户',
      searchFullSize: true,
      note: (row, cellH) => `字号回到满号 ${row.px} 需要 cell.h ≈ ${cellH}（会挤掉主体卡的空间 —— 竖屏标题建议 5–9 字并接受 115–125px）`,
    },
    {
      title: '1080p title · 标准版式（h:30）',
      cardId: 'A1', suffix: '-title',
      cell: { x: 50, y: 46, w: 76, h: 30 },
      canvas: CANVASES[2],
      variant: 'title',
      text: '量化基金 散户',
      note: (row) => (row.heightLimited ? `被压到 ${row.px}` : `${row.px}px / ${row.lines} 行，零变化`),
    },
  ]

  for (const item of cases) {
    if (item.searchFullSize === true) {
      // 「满号需要多高」只能搜出来：宽度也会触发折行，手算必错（我先前把 30 当成够用，实测 30 只得 123px）
      let found
      for (let h = 12; h <= 80; h += 1) {
        const probe = sizingCase({ ...item, cell: { ...item.cell, h } })
        if (probe.px >= probe.base) {
          found = { h, probe }
          break
        }
      }
      if (found === undefined) throw new Error('gen-spec-geometry：搜不到满号阈值（cell.h 给到 80 仍被压号）—— 文案太长或宽度限制太紧')
      item.cell = { ...item.cell, h: found.h }
    }
    const row = sizingCase(item)
    lines.push(`| ${item.title} | ${item.cell.w}×${round(item.cell.h)} | ${row.boxHeightPx === undefined ? '—' : `${row.boxHeightPx}px`} | ${row.base}px | ${row.px}px | ${row.lines}/${row.maxLines} | ${item.note(row, round(item.cell.h))} |`)
  }

  lines.push('')
  lines.push('## 5. 怎么用（三步）')
  lines.push('')
  lines.push('1. **定 cell**：一屏 1–4 个单元，`w` 一般给 100（卡自己的 `box.w` 还要再乘一次 cell 宽，给 88 会把 76% 宽的标题压到 66%）。')
  lines.push('2. **查本表第 4 节**：找到和你 cell 最接近的算例，看「实际号 / 行数 / 结论」。')
  lines.push('3. **要更大字号就给更高的 cell**（不是更大字号参数 —— spec 没有字号字段）；要更多行就给更高或更宽的 cell。')
  lines.push('')
  lines.push('> **报错怎么读**：回执里「会被裁掉」= 缩到下限仍放不下，必须改文案或加大 cell；')
  lines.push('> 「盒高只有 Npx：字号从 A 压到 B」= 不裁字但字变小了，加高 cell 就能回到 A。')
  lines.push('')
  lines.push('## 6. 最小可用 `cell.h`（小了会被「0–1 比例值」误判拒收）')
  lines.push('')
  lines.push('卡内小元素（结论条文字占卡高 10%、眉标占 6%）投影进很矮的 cell 时，绝对百分比会掉到 ≤1，')
  lines.push('而校验把 `h ≤ 1` 当成「有人写了 0–1 比例值」直接拒收 —— 回执看起来像自己写错单位，其实是格位太矮。')
  lines.push('')
  lines.push('| 卡 | 最小可用 cell.h（竖屏 1080×1920） | 说明 |')
  lines.push('|---|---|---|')
  for (const [cardId, copy, note] of [
    ['A1', '示例标题', '标题卡，眉标占 6%'],
    ['A4', '第一条\n第二条\n第三条', '要点卡'],
    ['A6', '一句结论', '结论条：verdict 只占卡高 10%，最容易踩'],
  ]) {
    lines.push(`| ${cardId} | ${minUsableCellH(cardId, copy)} | ${note} |`)
  }
  lines.push('')
  lines.push('> 一屏多单元时，**非首单元**的屏级 chrome（眉标等）会被裁掉，所以实际门槛比单单元更低；')
  lines.push('> 但首单元、以及"一屏只有一个卡"的场景按上表取值。')
  lines.push('')
  return lines.join('\n')
}

const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith('gen-spec-geometry.mjs')
if (invokedDirectly) {
  const generated = renderSpecGeometry()
  if (process.argv.includes('--check')) {
    let current = ''
    try {
      current = readFileSync(OUTPUT, 'utf8')
    } catch {
      console.error(`gen-spec-geometry: 生成物不存在（${OUTPUT}）—— 先跑 node scripts/gen-spec-geometry.mjs 并提交。`)
      process.exit(1)
    }
    if (current !== generated) {
      console.error('gen-spec-geometry: 几何表与现跑结果不一致（改了排版常量 / 卡内 box 但没重跑本脚本）。')
      console.error('修法：yarn build && node scripts/gen-spec-geometry.mjs 后连同生成物一起提交。')
      process.exit(1)
    }
    console.log('gen-spec-geometry: 一致 ✓')
  } else {
    writeFileSync(OUTPUT, generated, 'utf8')
    console.log(`gen-spec-geometry: 已写入 ${OUTPUT}（${Buffer.byteLength(generated)} 字节）`)
  }
}
