/**
 * 血缘明度验收台（CV-186）。
 *
 * ## 为什么需要一个台子
 *
 * 这一批的规则是「拖动时按血缘距离分三档压暗」。纯函数能证明**档位算对了**，
 * 但算对了不等于**屏幕上真的暗下去了** —— 中间隔着一整条链：
 * 判定 → `tier` → 类名 `.csNodeNear` / `.csNodeDimmed` → 令牌 → `.csNode` 的
 * 乘法链。这条链任何一环断了，页面都是「看起来正常」的。
 * 所以这里断言的是 `getComputedStyle(card).opacity` —— **浏览器算完的值**。
 *
 * ## 两侧都用真实实现
 *
 * - 档位：`lib/canvas-lineage.js` 的 `canvasSpotlight`（页面上要上的类名就是它的输出）；
 * - 样式：`src/client/styles.ts` 原文（未改一行）；
 * - 令牌：`src/brand.ts` 生成的 CSS。
 * 页内期望值也**从页内解析出的令牌**现算，所以明暗两轨天然各算各的，
 * 不需要脚本里维护两套数字。
 *
 * ## 页内自带对照组
 *
 * 「静止（没在拖）」与「拖动中」并排：前者必须**全部为 1 且一个档位类都不挂**，
 * 后者必须至少有一张 ≠ 1。两态若变得一样，说明「仅拖动触发」这条接线断了 ——
 * 这一组就是台子的分辨力自证（把 tier 恒设为 lit，这里当场红）。
 *
 * 用法：node scripts/preview-spotlight.mjs [输出路径]
 * 主题：?theme=light 切浅色（verify-previews.mjs 会两轨各跑一遍）
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  HOST_TOKENS_DARK,
  HOST_TOKENS_LIGHT,
  brandTokensCss,
  defaultPresetId,
  readStudioStyles,
  renderTokenBlock,
  reportTokenCoverage,
} from './preview-tokens.mjs'
// 档位取**真实判定** —— 页面上挂什么类就是产品拖动时会挂的什么类。
import { canvasSpotlight } from '../lib/canvas-lineage.js'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', '.workbuddy', 'preview')
const outPath = process.argv[2] ?? join(outDir, 'spotlight-preview.html')
await mkdir(outDir, { recursive: true })

const studioStyles = await readStudioStyles()
const brandCss = await brandTokensCss()
const presetId = await defaultPresetId()
await reportTokenCoverage('preview-spotlight', brandCss, HOST_TOKENS_DARK)

const hostCss = `:root {\n${renderTokenBlock(HOST_TOKENS_DARK)}\n}\nhtml[data-light] {\n${renderTokenBlock(HOST_TOKENS_LIGHT)}\n}`

/* ---------------------------------------------------------------- 样例数据
   两组固定样例，形状照抄真实画布（`测试新建` 的链式结构、`验收新建项目` 的托盘）：

   A 链式：角色设定 ← 关键帧 2 ← 镜头 2 ← 成片，另有两张毫无血缘的卡。
   B 托盘：托盘里两张关键帧（其中一张有上游来源），外加一张无关卡。 */

const ART_DARK = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="220">'
  + '<rect width="100%" height="100%" fill="#1A2A4A"/>'
  + '<circle cx="120" cy="96" r="42" fill="#2E4C7A"/></svg>')

const card = (id, title, kind, sourceIds, extra = {}) => ({
  id,
  kind,
  title,
  x: 0,
  y: 0,
  width: kind === 'video' ? 480 : 260,
  height: kind === 'video' ? 318 : 180,
  createdAt: 0,
  origin: 'agent',
  sourceIds,
  ...extra,
})

const FIXTURE_A = [
  card('src', '角色设定', 'image', []),
  card('k1', '关键帧 2', 'image', ['src']),
  card('c1', '镜头 2', 'video', ['k1']),
  card('film', '成片', 'video', ['c1']),
  card('bgm', '配乐', 'audio', []),
  card('ref', '参考图 7', 'image', []),
]

const FIXTURE_B = [
  card('msrc', '角色设定', 'image', []),
  card('tray', '分镜 1 · 素材', 'group', [], { width: 560, height: 240, parentId: undefined }),
  card('m1', '关键帧 1', 'image', ['msrc'], { parentId: 'tray' }),
  card('m2', '关键帧 2', 'image', [], { parentId: 'tray' }),
  card('far', '参考图 3', 'image', []),
]

/* -------------------------------------------------- 面板（期望值来自真实判定）*/

/**
 * 单张卡的档位。**不启动 = 全部亮档**（这正是安全阀的语义：没有直接血缘可看时
 * 一格都不压暗）—— 漏掉这一支会把每个节点都判成压暗档，台子第一版就栽在这里。
 * 产品侧同一支在 CanvasSurface 的 spotlightTierOf（`active === false → undefined`）。
 */
const tierOf = (spot, id) => (!spot.active
  ? 'lit'
  : spot.lit.has(id) ? 'lit' : spot.near.has(id) ? 'near' : 'dim')

const PANELS = [
  {
    id: 'pvIdle',
    title: '静止 · 没在拖动',
    note: '对照组：压暗只在拖动中发生 —— 这里必须全部留在亮档',
    fixture: FIXTURE_A,
    dragging: [],
  },
  {
    id: 'pvDrag',
    title: '拖动「关键帧 2」',
    note: '直接血缘（角色设定 / 镜头 2）留亮 · 隔一层的成片降中间档 · 无关的配乐与参考图压暗',
    fixture: FIXTURE_A,
    dragging: ['k1'],
  },
  {
    id: 'pvTray',
    title: '拖动托盘里的「关键帧 1」',
    note: '托盘与成员同档（取最亮）—— 不允许「亮托盘里套着灰成员」',
    fixture: FIXTURE_B,
    dragging: ['m1'],
  },
].map((panel) => {
  const spot = canvasSpotlight(panel.fixture, panel.dragging)
  return {
    ...panel,
    active: spot.active,
    cards: panel.fixture.map((node) => ({ id: node.id, tier: tierOf(spot, node.id), state: 1 })),
  }
})

/**
 * 乘法链面板：压暗与数据层/状态层**相乘**而不是互相覆盖。
 * 数字全部由页内令牌现算，这里只声明「谁跟谁相乘」。
 */
const CHAIN = [
  { id: 'cDim', label: '压暗档', classes: 'csNodeDimmed', tier: 'dim', state: 1 },
  { id: 'cNear', label: '中间档', classes: 'csNodeNear', tier: 'near', state: 1 },
  { id: 'cLit', label: '亮档', classes: '', tier: 'lit', state: 1 },
  { id: 'cRetired', label: '失效版本（0.45）', classes: 'csNodeRetired', tier: 'lit', state: 0.45 },
  { id: 'cRetiredDim', label: '失效版本 × 压暗', classes: 'csNodeRetired csNodeDimmed', tier: 'dim', state: 0.45 },
  { id: 'cLockedDim', label: '锁定（0.75）× 压暗', classes: 'csNodeLocked csNodeDimmed', tier: 'dim', state: 0.75 },
]

/* ---------------------------------------------------------------- 渲染工具 */

const LAYOUT = { columns: 4, gapX: 40, gapY: 40, origin: 20 }
const innerOf = (node) => {
  if (node.kind === 'group') {
    return `<div class="csNodeGroup"><div class="csGroupHead">`
      + `<span class="csNodeHeadKind">素材</span><span class="csNodeHeadTitle">${node.title}</span>`
      + `</div></div>`
  }
  const kindLabel = node.kind === 'image' ? '关键帧' : node.kind === 'video' ? '成片' : node.kind === 'audio' ? '配乐' : '参考'
  return `<div class="csNodeHead"><span class="csNodeHeadKind">${kindLabel}</span>`
    + `<span class="csNodeHeadTitle">${node.title}</span></div>`
    + `<div class="csNodeMediaBox"><img class="csNodeMedia" src="${ART_DARK}" alt=""></div>`
    + `<div class="csNodeFoot"><span class="csNodeFootReadings">${node.width} × ${node.height}</span></div>`
}

const place = (index) => ({
  x: LAYOUT.origin + (index % LAYOUT.columns) * (320 + LAYOUT.gapX),
  y: LAYOUT.origin + Math.floor(index / LAYOUT.columns) * (200 + LAYOUT.gapY),
})

const sectionOf = (panel) => {
  const spot = canvasSpotlight(panel.fixture, panel.dragging)
  const cells = panel.fixture.map((node, index) => {
    const cell = place(index)
    const tier = tierOf(spot, node.id)
    const cls = ['csNode', tier === 'near' ? 'csNodeNear' : tier === 'dim' ? 'csNodeDimmed' : '']
      .filter(Boolean).join(' ')
    return `<div class="${cls}" data-node-id="${node.id}" data-tier="${tier}"`
      + ` style="left:${spot.x}px;top:${spot.y}px;width:${node.width}px;height:${node.height}px">`
      + innerOf(node) + '</div>'
  })

  const rows = Math.ceil(panel.fixture.length / LAYOUT.columns)
  const width = LAYOUT.origin * 2 + LAYOUT.columns * 320 + (LAYOUT.columns - 1) * LAYOUT.gapX
  const height = LAYOUT.origin * 2 + rows * 200 + (rows - 1) * LAYOUT.gapY

  return `
  <section class="pvPanel" id="${panel.id}" data-active="${panel.active}">
    <h2>${panel.title}</h2>
    <p class="pvHint">${panel.note}</p>
    <div class="pvStage" style="width:${width}px;height:${height}px">
${cells.map((cell) => '      ' + cell).join('\n')}
    </div>
  </section>`
}

const chainSection = `
  <section class="pvPanel" id="pvChain">
    <h2>乘法链 · 压暗与状态层相乘（不互相覆盖）</h2>
    <p class="pvHint">压暗是**乘数**不是 opacity 写法：与数据层、状态层叠乘。失效版本 × 压暗 = 0.45 × 0.42。</p>
    <div class="pvStage" style="width:${LAYOUT.origin * 2 + 3 * 320 + 2 * LAYOUT.gapX}px;height:${LAYOUT.origin * 2 + 2 * 200 + LAYOUT.gapY}px">
${CHAIN.map((entry, index) => {
  const spot = place(index)
  return `      <div class="csNode ${entry.classes}" data-node-id="${entry.id}" data-tier="${entry.tier}"`
    + ` data-state="${entry.state}" style="left:${spot.x}px;top:${spot.y}px;width:260px;height:180px">`
    + `<div class="csNodeHead"><span class="csNodeHeadKind">${entry.label}</span></div>`
    + `<div class="csNodeMediaBox"><img class="csNodeMedia" src="${ART_DARK}" alt=""></div></div>`
}).join('\n')}
    </div>
  </section>`

/** 传给页内自检的**结构**期望：面板有哪些卡、是否该启动。
 *  档位本身**不从这里传** —— 页内另有一张独立预期表（见 ORACLE），
 *  否则「判定算错」时脚本与页面会一起错、断言照样全绿（空绿）。 */
const EXPECT = {
  panels: PANELS.map((panel) => ({
    id: panel.id,
    active: panel.active,
    count: panel.fixture.length,
  })),
  chain: CHAIN.map((entry) => ({ id: entry.id, tier: entry.tier, state: entry.state })),
}

/* ---------------------------------------------------------------- 页面 */

const html = `<!doctype html>
<html lang="zh-CN" data-cs-preset="${presetId}">
<head>
<meta charset="utf-8" />
<title>Canvas Studio · 血缘明度验收台（CV-186）</title>
<style>
${hostCss}

${brandCss}

/* ---- 真实产品样式（从 styles.ts 抽取，未改动一行） ---- */
${studioStyles}

/* ---- 本页舞台样式：只负责摆放，不参与任何被断言的外观 ---- */
* { box-sizing: border-box; }
body {
  margin: 0; padding: 20px 20px 40px;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
}
h1 { font-size: 15px; margin: 0 0 6px; }
h2 { font-size: 13px; margin: 0 0 4px; }
.pvHint { font-size: 12px; color: var(--dsw-alias-label-tertiary); margin: 0 0 10px; max-width: 900px; line-height: 1.7; }
.pvPanel { margin: 0 0 26px; }
/* 舞台底色取画布档 —— 压暗的对比只能在「工作台面」上读，不能在页面底色上读。 */
.pvStage { position: relative; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  background: var(--cs-canvas-bg-l1, var(--dsw-alias-bg-base)); overflow: hidden; }
.pvCheck { margin-top: 20px; padding: 12px 14px; font-size: 12px; line-height: 1.7;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; white-space: pre-wrap; }
#pvVerdict { display: none; }
</style>
</head>
<body>
<h1>血缘明度验收台</h1>
<p class="pvHint">
  档位来自真实判定 <code>canvasSpotlight</code>，样式取自 <code>src/client/styles.ts</code>，令牌取自 <code>src/brand.ts</code>。
  断言读的是 <code>getComputedStyle(card).opacity</code> —— 浏览器算完的值，不是样式表里的字面量。
</p>

${PANELS.map(sectionOf).join('\n')}
${chainSection}

<div class="pvCheck" id="pvCheck">自检运行中…</div>
<pre id="pvVerdict"></pre>

<script>
(function () {
  'use strict'
  var EXPECT = ${JSON.stringify(EXPECT)}
  /**
   * 页面侧**独立预期表**：每张卡该落在哪一档。
   *
   * 为什么要另写一份：档位（data-tier）与类名都由脚本里的真实 canvasSpotlight
   * 生成，若判定被改坏，脚本与断言会**一起变** —— 断言照样全绿。这张表是页面侧
   * 的第二双眼睛，专治那种「两边一起错」的空绿（判定回归另由
   * tests/canvas-lineage.test.mjs 覆盖，两边互为对照）。
   */
  var ORACLE = {
    pvIdle: { src: 'lit', k1: 'lit', c1: 'lit', film: 'lit', bgm: 'lit', ref: 'lit' },
    pvDrag: { src: 'lit', k1: 'lit', c1: 'lit', film: 'near', bgm: 'dim', ref: 'dim' },
    pvTray: { msrc: 'lit', tray: 'lit', m1: 'lit', m2: 'lit', far: 'dim' }
  }
  var params = new URLSearchParams(location.search)
  var theme = params.get('theme') === 'light' ? 'light' : 'dark'
  document.documentElement.toggleAttribute('data-light', theme === 'light')

  var lines = []
  var fail = 0
  function check(label, ok, detail) {
    lines.push((ok ? '\\u2705 ' : '\\u274c ') + label + (detail ? '  \\u2192 ' + detail : ''))
    if (!ok) fail += 1
  }
  function el(selector) {
    var node = document.querySelector(selector)
    if (node === null) throw new Error('选择器匹配空集：' + selector)
    return node
  }
  function cardsOf(panelId) {
    return Array.prototype.slice.call(document.querySelectorAll('#' + panelId + ' [data-node-id]'))
  }
  function opacityOf(card) { return Number(getComputedStyle(card).opacity) }
  function classesOf(card) { return card.className.split(/\\s+/).filter(Boolean) }
  function near(a, b) { return Math.abs(a - b) < 0.005 }

  try {
    /* ---- 令牌必须先解析出数字：档位缺失时 var() 会退到 fallback，页面照样「正常」 ---- */
    var rootStyle = getComputedStyle(document.documentElement)
    var dimToken = Number(rootStyle.getPropertyValue('--cs-dim').trim())
    var nearToken = Number(rootStyle.getPropertyValue('--cs-dim-near').trim())
    check('令牌 --cs-dim / --cs-dim-near 都能解析出数字',
      dimToken > 0 && nearToken > 0, dimToken + ' / ' + nearToken)
    check('三档顺序成立：压暗 < 中间 < 1（否则中间档没有意义）',
      dimToken < nearToken && nearToken < 1, dimToken + ' < ' + nearToken + ' < 1')

    var multiplierOf = function (tier) {
      return tier === 'dim' ? dimToken : tier === 'near' ? nearToken : 1
    }

    EXPECT.panels.forEach(function (panel) {
      var cards = cardsOf(panel.id)
      check(panel.id + '：卡片全部渲染（' + panel.count + ' 张）',
        cards.length === panel.count, String(cards.length))

      var oracle = ORACLE[panel.id]
      var mismatches = []
      Object.keys(oracle).forEach(function (id) {
        var card = cards.filter(function (candidate) { return candidate.getAttribute('data-node-id') === id })[0]
        if (card === undefined) { mismatches.push(id + ' 缺卡'); return }
        var want = oracle[id]
        if (card.getAttribute('data-tier') !== want) {
          mismatches.push(id + ' 档位 ' + card.getAttribute('data-tier') + ' ≠ ' + want)
          return
        }
        // 期望 = 页内令牌现算的档位乘数 × 状态乘数（状态在台子上恒为 1）。
        var wantOpacity = multiplierOf(want)
        if (!near(opacityOf(card), wantOpacity)) {
          mismatches.push(id + ' 不透明度 ' + opacityOf(card) + ' ≠ ' + wantOpacity)
        }
        var wantClass = want === 'dim' ? 'csNodeDimmed' : want === 'near' ? 'csNodeNear' : null
        var classes = classesOf(card)
        if (wantClass !== null && classes.indexOf(wantClass) === -1) {
          mismatches.push(id + ' 缺类 ' + wantClass)
        }
        if (wantClass === null && (classes.indexOf('csNodeNear') !== -1 || classes.indexOf('csNodeDimmed') !== -1)) {
          mismatches.push(id + ' 亮档不该挂档位类')
        }
      })
      check(panel.id + '：每张卡的档位与类名、计算后不透明度都符合预期', mismatches.length === 0, mismatches.join('；'))

      /* 对照组：静止面板必须一张档位类都不挂、全部为 1 —— 「仅拖动触发」的接线自证。 */
      if (!panel.active) {
        var tagged = cards.filter(function (card) {
          var classes = classesOf(card)
          return classes.indexOf('csNodeNear') !== -1 || classes.indexOf('csNodeDimmed') !== -1
        })
        check(panel.id + '：没拖动就不该有任何节点降档（对照必须干净）',
          tagged.length === 0, tagged.length + ' 张挂了档位类')
        check(panel.id + '：没拖动时全部节点为满亮',
          cards.every(function (card) { return near(opacityOf(card), 1) }), '')
      } else {
        var dimmed = cards.filter(function (card) { return !near(opacityOf(card), 1) })
        check(panel.id + '：拖动中确实有节点降档（台子有分辨力）',
          dimmed.length > 0, dimmed.length + ' / ' + cards.length)
      }
    })

    /* ---- 拖动面板：三档必须真的分开（亮 > 中间 > 压暗） ---- */
    var dragCards = cardsOf('pvDrag')
    var opacityByTier = {}
    dragCards.forEach(function (card) {
      opacityByTier[card.getAttribute('data-tier')] = opacityOf(card)
    })
    check('三个档位在屏幕上彼此可分（lit > near > dim）',
      opacityByTier.lit > opacityByTier.near && opacityByTier.near > opacityByTier.dim,
      opacityByTier.lit + ' > ' + opacityByTier.near + ' > ' + opacityByTier.dim)

    /* ---- 托盘：托盘与成员同档（断裂会在这里红） ---- */
    var trayCards = cardsOf('pvTray').filter(function (card) {
      return ['tray', 'm1', 'm2'].indexOf(card.getAttribute('data-node-id')) !== -1
    })
    var trayValues = trayCards.map(opacityOf)
    check('托盘与它的成员「计算后不透明度」完全一致（不断裂）',
      trayValues.length === 3 && trayValues.every(function (value) { return near(value, trayValues[0]) }),
      trayValues.join(' / '))

    /* ---- 乘法链：压暗与状态层相乘而不是互相覆盖 ---- */
    EXPECT.chain.forEach(function (entry) {
      var card = cardsOf('pvChain').filter(function (candidate) {
        return candidate.getAttribute('data-node-id') === entry.id
      })[0]
      if (card === undefined) { check('乘法链 ' + entry.id + '：卡片存在', false, '缺卡'); return }
      var want = multiplierOf(entry.tier) * entry.state
      check('乘法链 ' + entry.id + '：实测 ' + opacityOf(card).toFixed(3) + ' = ' + want.toFixed(3),
        near(opacityOf(card), want), '')
    })
  } catch (error) {
    check('自检未抛异常', false, String(error && error.message ? error.message : error))
  }

  var pre = document.getElementById('pvVerdict')
  document.documentElement.setAttribute('data-pv-fail', String(fail))
  pre.textContent = '# ' + (fail === 0 ? '全部通过' : fail + ' 条失败') + ' / ' + lines.length + ' 条断言'
    + '\\n' + lines.join('\\n')
  document.getElementById('pvCheck').textContent =
    (fail === 0 ? '\\u2705 ' : '\\u274c ') + (fail === 0 ? '全部通过' : fail + ' 条失败')
    + ' / ' + lines.length + ' 条断言\\n' + lines.join('\\n')
})()
</script>
</body>
</html>
`

await writeFile(outPath, html, 'utf8')
console.log(`preview written: ${outPath}`)
