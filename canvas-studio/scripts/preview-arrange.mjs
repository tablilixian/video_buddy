/**
 * 整理布局验收台（CV-185）。
 *
 * ## 为什么需要一个台子
 *
 * 单测能证明「算出来的坐标对」，但不能证明**排完摆到屏幕上是什么样**，
 * 更不能证明「装不下时用户看到的东西没被缩成一片糊」。而这一批改的正是
 * 「屏幕上装得下多少」：真实画布 `测试音乐` 的 23 个单元排出来是
 * **768×6452 的一根细长条**，适配比例被压到缩放下限 0.1（canvas.json 里存的就是
 * 0.1）—— 打开项目就是一片看不清的缩略图，从画布上完全看不出「这是 23 张卡」。
 *
 * ## 页内自带**对照组**（这一批的差分比绝对值更说明问题）
 *
 * 同一页里并排放「整理前（画布上原有的坐标）」与「整理后（真实
 * `computeArrangeLayout` 的结果）」，两侧都用真实 `computeFitView` 算出的视图摆放。
 * 若哪天两侧一样了（比如视口没传进去、搜索没生效），说明这台子失去了分辨力 ——
 * 所以「整理后必须比整理前更大/更能装」本身就是一条断言。
 *
 * 用法：node scripts/preview-arrange.mjs [输出路径]
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
// 排布与适配都取**真实实现**（不在这里手算）：页面上的坐标就是产品点下去会得到的坐标。
import { computeArrangeLayout, computeFitView } from '../lib/canvas-view.js'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', '.workbuddy', 'preview')
const outPath = process.argv[2] ?? join(outDir, 'arrange-preview.html')
await mkdir(outDir, { recursive: true })

const studioStyles = await readStudioStyles()
const brandCss = await brandTokensCss()
const presetId = await defaultPresetId()
await reportTokenCoverage('preview-arrange', brandCss, HOST_TOKENS_DARK)

const hostCss = `:root {\n${renderTokenBlock(HOST_TOKENS_DARK)}\n}\nhtml[data-light] {\n${renderTokenBlock(HOST_TOKENS_LIGHT)}\n}`

/* ---------------------------------------------------------------- 样例数据
   两组固定样例（尺寸照抄真实画布里的节点，坐标是「整理前」的实际值）：
   A = 23 张同层分镜卡（真实画布 `测试音乐` 的形态：一个深度堆 23 行）
   B = 多层链条 + 一张 996 宽的托盘（覆盖「列宽按列自适应」与「组随行」） */

const ART = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="220">'
  + '<rect width="100%" height="100%" fill="#1A2A4A"/>'
  + '<circle cx="120" cy="96" r="42" fill="#2E4C7A"/></svg>')

const shot = (index, x, y) => ({
  id: `s${index}`, kind: 'text', title: `镜 ${String(index + 1).padStart(2, '0')}`,
  x, y, width: 360, height: 220, createdAt: index + 1, sourceIds: [],
})

/** A：全部同层，按「一个深度一条不限高的列」排出来就是一根 768×6452 的细长条。 */
const FIXTURE_A = Array.from({ length: 23 }, (_, index) => shot(index, 40, 40 + index * 268))

/** B：depth 0 的源图 → depth 1 的关键帧 → depth 2 的托盘；坐标是用户拖过之后的乱状。 */
const FIXTURE_B = (() => {
  const sources = Array.from({ length: 6 }, (_, index) => ({
    ...shot(index, 120 + (index % 3) * 420, 900 + Math.floor(index / 3) * 300),
    kind: 'image', width: 270, height: 528, title: `源图 ${index + 1}`,
  }))
  const keyframes = sources.map((source, index) => ({
    id: `k${index}`, kind: 'image', title: `关键帧 ${index + 1}`,
    x: 1800 + index * 90, y: 200 + index * 240, width: 270, height: 528,
    createdAt: 100 + index, sourceIds: [source.id],
  }))
  const tray = {
    id: 'tray', kind: 'group', title: '分镜 1 · 素材', x: 200, y: 180,
    width: 996, height: 366, createdAt: 200, sourceIds: [keyframes[0].id],
  }
  const finalClip = {
    id: 'out', kind: 'video', title: '成片', x: 3200, y: 2600,
    width: 480, height: 318, createdAt: 300, sourceIds: [tray.id],
  }
  return [...sources, ...keyframes, tray, finalClip]
})()

const VIEWPORT = { width: 1160, height: 700 }
/** 页面上把一个 1160×700 的可视区缩到 560×338 摆放（两侧同比例，故比较公平）。 */
const PAGE_SCALE = 560 / VIEWPORT.width

const depthOf = (nodes, node) => {
  const byId = new Map(nodes.map((candidate) => [candidate.id, candidate]))
  let max = 0
  const seen = new Set([node.id])
  const queue = [...node.sourceIds, ...(node.parentId !== undefined ? [node.parentId] : [])].map((id) => ({ id, depth: 1 }))
  while (queue.length > 0) {
    const current = queue.shift()
    if (seen.has(current.id)) continue
    seen.add(current.id)
    max = Math.max(max, current.depth)
    const parent = byId.get(current.id)
    if (parent === undefined) continue
    for (const next of [...parent.sourceIds, ...(parent.parentId !== undefined ? [parent.parentId] : [])]) {
      queue.push({ id: next, depth: current.depth + 1 })
    }
  }
  return max
}

const boxOfNodes = (nodes) => {
  const minX = Math.min(...nodes.map((node) => node.x))
  const minY = Math.min(...nodes.map((node) => node.y))
  const maxX = Math.max(...nodes.map((node) => node.x + node.width))
  const maxY = Math.max(...nodes.map((node) => node.y + node.height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

const applyPositions = (nodes, positions) => nodes.map((node) => {
  const next = positions.get(node.id)
  return next === undefined ? node : { ...node, x: next.x, y: next.y }
})

const innerOf = (node) => {
  if (node.kind === 'group') {
    return `<div class="csNodeGroup"><div class="csGroupHead"><span class="csNodeKind">${node.title}</span></div></div>`
  }
  const kindLabel = node.kind === 'image' ? '关键帧' : node.kind === 'video' ? '成片' : '分镜'
  return `<div class="csNodeHead"><span class="csNodeHeadKind">${kindLabel}</span>`
    + `<span class="csNodeHeadTitle">${node.title}</span></div>`
    + `<div class="csNodeMediaBox"><img class="csNodeMedia" src="${ART}" alt=""></div>`
    + `<div class="csNodeFoot"><span class="csNodeFootReadings">${node.width} × ${node.height}</span></div>`
}

/** 一侧视图：按 fit 结果把节点摆到 560×338 的舞台里（等于用户在 1160×700 里看到的画面）。 */
const panelOf = ({ id, title, note, nodes, fit, depths }) => {
  const items = nodes.map((node) => {
    const left = node.x * fit.scale + fit.x
    const top = node.y * fit.scale + fit.y
    const width = node.width * fit.scale
    const height = node.height * fit.scale
    const depth = depths.get(node.id) ?? 0
    return `<div class="csNode" data-node-id="${node.id}" data-depth="${depth}"`
      + ` data-parent="${node.parentId ?? ''}"`
      + ` style="left:${left.toFixed(2)}px;top:${top.toFixed(2)}px;width:${width.toFixed(2)}px;height:${height.toFixed(2)}px">`
      + innerOf(node) + '</div>'
  }).join('\n')

  return `
  <figure class="pvScene" id="${id}" data-scale="${fit.scale.toFixed(4)}" data-clamped="${fit.clamped}">
    <figcaption><b>${title}</b><span>${note}</span></figcaption>
    <div class="pvViewport">
      <div class="pvWorld" style="transform:scale(${PAGE_SCALE})">
${items}
      </div>
    </div>
  </figure>`
}

const scenarios = [
  { key: 'A', label: 'A · 23 张同层分镜卡', nodes: FIXTURE_A, noteBefore: '画布上的实际坐标：一个深度一条不限高的列' },
  { key: 'B', label: 'B · 多层链条 + 996 宽托盘', nodes: FIXTURE_B, noteBefore: '画布上的实际坐标：手动拖过之后的乱状' },
].map((scenario) => {
  const depths = new Map(scenario.nodes.map((node) => [node.id, depthOf(scenario.nodes, node)]))
  const arranged = applyPositions(scenario.nodes, computeArrangeLayout(scenario.nodes, VIEWPORT))
  const fitBefore = computeFitView(boxOfNodes(scenario.nodes), VIEWPORT)
  const fitAfter = computeFitView(boxOfNodes(arranged), VIEWPORT)
  return {
    ...scenario,
    depths,
    arranged,
    fitBefore,
    fitAfter,
    boxBefore: boxOfNodes(scenario.nodes),
    boxAfter: boxOfNodes(arranged),
  }
})

const panels = scenarios.map((scenario) => `
  <section class="pvPair">
    <h2>${scenario.label}</h2>
${panelOf({
    id: `pv${scenario.key}Before`, title: '整理前', note: scenario.noteBefore,
    nodes: scenario.nodes, fit: scenario.fitBefore, depths: scenario.depths,
  })}
${panelOf({
    id: `pv${scenario.key}After`, title: '点「整理布局」之后', note: '真实 computeArrangeLayout + computeFitView 的结果',
    nodes: scenario.arranged, fit: scenario.fitAfter, depths: scenario.depths,
  })}
  </section>`).join('\n')

/** 传给页内自检的期望值（避免脚本里再抄一遍数字）。 */
const EXPECT = scenarios.map((scenario) => ({
  key: scenario.key,
  count: scenario.nodes.length,
  scaleBefore: scenario.fitBefore.scale,
  scaleAfter: scenario.fitAfter.scale,
  clampedBefore: scenario.fitBefore.clamped,
  clampedAfter: scenario.fitAfter.clamped,
}))

/* ---------------------------------------------------------------- 页面 */

const html = `<!doctype html>
<html lang="zh-CN" data-cs-preset="${presetId}">
<head>
<meta charset="utf-8" />
<title>Canvas Studio · 整理布局验收台（CV-185）</title>
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
h2 { font-size: 13px; margin: 22px 0 8px; }
.pvHint { font-size: 12px; color: var(--dsw-alias-label-tertiary); margin: 0 0 6px; max-width: 900px; line-height: 1.7; }
.pvPairs { display: flex; flex-direction: column; }
.pvPair { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
.pvPair h2 { flex: 0 0 100%; }
.pvScene { margin: 0; }
.pvScene figcaption { font-size: 12px; margin: 0 0 8px; display: flex; gap: 10px; align-items: baseline; }
.pvScene figcaption span { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
/* 舞台 = 一个 1160×700 可视区的等比缩影（overflow:hidden 与真实画布一致）。 */
.pvViewport { position: relative; width: 560px; height: 338px; overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--cs-canvas-bg-l1, var(--dsw-alias-bg-base)); }
.pvWorld { position: absolute; left: 0; top: 0; width: 1160px; height: 700px; transform-origin: 0 0; }
.pvWorld .csNode { position: absolute; }
.pvCheck { margin-top: 20px; padding: 12px 14px; font-size: 12px; line-height: 1.7;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; white-space: pre-wrap; }
#pvVerdict { display: none; }
</style>
</head>
<body>
<h1>整理布局验收台</h1>
<p class="pvHint">
  两侧都用**真实实现**摆放：样式取自 <code>src/client/styles.ts</code>、令牌取自 <code>lib/brand.js</code>、
  坐标取自 <code>computeArrangeLayout</code>、视图取自 <code>computeFitView</code>（非仿制）。
  左 = 画布上原有的坐标；右 = 点「整理布局」之后。舞台是一个 1160×700 可视区的等比缩影。
</p>
<p class="pvHint">视角差异就是答案：整理前那些「细长条 / 大段空白」在真实屏上会被缩到看不清。</p>

<div class="pvPairs">
${panels}
</div>

<div class="pvCheck" id="pvCheck">自检运行中…</div>
<pre id="pvVerdict"></pre>

<script>
(function () {
  'use strict'
  var EXPECT = ${JSON.stringify(EXPECT)}
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
  function rectOf(card) {
    var box = card.getBoundingClientRect()
    return { id: card.getAttribute('data-node-id'), parent: card.getAttribute('data-parent'),
      depth: Number(card.getAttribute('data-depth')), left: box.left, top: box.top,
      right: box.right, bottom: box.bottom }
  }
  function overlaps(a, b) {
    return a.left < b.right - 0.5 && b.left < a.right - 0.5
      && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5
  }
  /** 无关节点之间的重叠数（父与子本来就该叠：组框包住成员）。 */
  function unrelatedOverlaps(rects) {
    var count = 0
    for (var i = 0; i < rects.length; i += 1) {
      for (var j = i + 1; j < rects.length; j += 1) {
        if (rects[i].parent === rects[j].id || rects[j].parent === rects[i].id) continue
        if (overlaps(rects[i], rects[j])) count += 1
      }
    }
    return count
  }
  function spanOf(rects) {
    var left = Math.min.apply(null, rects.map(function (r) { return r.left }))
    var top = Math.min.apply(null, rects.map(function (r) { return r.top }))
    var right = Math.max.apply(null, rects.map(function (r) { return r.right }))
    var bottom = Math.max.apply(null, rects.map(function (r) { return r.bottom }))
    return { width: right - left, height: bottom - top }
  }
  function scaleOf(panelId) { return Number(el('#' + panelId).getAttribute('data-scale')) }
  function clampedOf(panelId) { return el('#' + panelId).getAttribute('data-clamped') === 'true' }

  try {
    /* ---- 令牌必须真的解析出值（「躺在文件里」与「页面上生效」是两件事） ---- */
    var rootStyle = getComputedStyle(document.documentElement)
    var emptyTokens = ['--cs-node', '--cs-accent', '--cs-line'].filter(function (name) {
      return rootStyle.getPropertyValue(name).trim() === ''
    })
    check('关键令牌在浏览器里全部可解析', emptyTokens.length === 0, emptyTokens.join(' '))

    EXPECT.forEach(function (expected) {
      var key = expected.key
      var beforeId = 'pv' + key + 'Before'
      var afterId = 'pv' + key + 'After'
      var before = cardsOf(beforeId).map(rectOf)
      var after = cardsOf(afterId).map(rectOf)

      check('场景 ' + key + '：两侧都渲染出全部节点（' + expected.count + ' 个）',
        before.length === expected.count && after.length === expected.count,
        before.length + ' / ' + after.length)

      check('场景 ' + key + '：整理后没有「无关节点」重叠',
        unrelatedOverlaps(after) === 0, unrelatedOverlaps(after) + ' 处')

      /* 深度顺序：深度小的一定在左（子列不跨深度混排）。只查顶层单元。 */
      var tops = after.filter(function (card) { return card.parent === '' || card.parent === null })
      var violations = 0
      tops.forEach(function (a) {
        tops.forEach(function (b) {
          if (a.id === b.id) return
          if (a.depth < b.depth && a.left >= b.left) violations += 1
        })
      })
      check('场景 ' + key + '：深度顺序在**屏幕上**仍严格左→右', violations === 0, violations + ' 处违例')

      /* 差分对照：整理后必须更能装（两侧一样 = 台子没有分辨力）。 */
      check('场景 ' + key + '：整理后的适配比例大于整理前',
        scaleOf(afterId) > scaleOf(beforeId) + 1e-6,
        scaleOf(beforeId).toFixed(3) + ' → ' + scaleOf(afterId).toFixed(3))
      check('场景 ' + key + '：缩放被可读下限挡住的状态与真实实现一致',
        clampedOf(beforeId) === expected.clampedBefore && clampedOf(afterId) === expected.clampedAfter,
        'before=' + clampedOf(beforeId) + ' after=' + clampedOf(afterId))

      /* 排完之后**每张卡**在屏幕上更大 —— 这是用户唯一看得见的效果。
         ⚠️ 别拿「包围盒面积」比：整理前那种排法被缩放下限压到 0.3 时反而溢出舞台、
         包围盒更大（场景 B 实测 512×394 vs 462×276），拿面积比会把好排法判成更差。 */
      var minCardBefore = Math.min.apply(null, before.map(function (r) { return r.right - r.left }))
      var minCardAfter = Math.min.apply(null, after.map(function (r) { return r.right - r.left }))
      check('场景 ' + key + '：整理后每张卡在屏幕上更大',
        minCardAfter > minCardBefore + 0.5,
        Math.round(minCardBefore) + 'px → ' + Math.round(minCardAfter) + 'px')

      var spanAfter = spanOf(after)
      check('场景 ' + key + '：整理后不再溢出舞台（不再有节点被裁在框外）',
        spanAfter.width <= 560 + 1 && spanAfter.height <= 338 + 1,
        Math.round(spanAfter.width) + '×' + Math.round(spanAfter.height))
    })

    /* ---- 对照组必须「红」：整理前那种排法在真实屏上就是装不下 ---- */
    check('对照：场景 A 整理前确实撞到缩放下限（否则这组样例证明不了任何事）',
      clampedOf('pvABefore') === true, String(clampedOf('pvABefore')))
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
