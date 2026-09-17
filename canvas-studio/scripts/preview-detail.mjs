/**
 * 节点详情验收台（就近工具条 + 底部抽屉）。
 *
 * ## 这一批改的是「一个东西摆在哪」，而摆在哪恰恰是静态检查最无能的地方
 *
 * 旧详情面板是 `position: fixed; top: 64px; right: 12px; width: 320px` —— 与节点
 * 坐标**毫无关系**：节点在哪它都飘在右上角（用户说「离得远」），还盖住宿主右栏。
 * 新写法把两条都变成几何事实：工具条渲染在 `.csCanvasLayer` **之外**（尺寸不随缩放
 * 变形，位置靠 `nodeActionAnchor` 现算），抽屉挂在 `.csCanvasBody` 里做绝对定位
 * （底边 = 容器底边 = 时间轴顶边、宽度 = 画布宽）。
 *
 * 单测能证明 `nodeActionAnchor` 的算术对，证明不了：
 *   ① 工具条真的没被画布层的 `scale()` 缩到 0.4×（写进层内就会）；
 *   ② 工具条的 z-index 真的压得住相邻节点；
 *   ③ 抽屉的底边真的贴住容器底边、左右真的贴住容器两缘；
 *   ④ 抽屉打开时工具条真的被夹在抽屉**之上**（`bottomInset` 不是装饰）。
 * 这四条只能拿真实样式表 + 真实令牌在浏览器里量。
 *
 * ## 关键设计：每一组都有**反向对照场景**
 *
 * A/B/C 三个场景只差「工具条挂在哪儿」；D 与 A 只差 z-index 与 DOM 次序；E 与 F 只差
 * 画布层的 z-index。对照场景必须**红**（量出被压住 / 被缩放），它同时证明这台子有
 * 分辨力 —— 若哪天对照也「通过」了，说明探针瞎了，那比断言失败更危险。
 *
 * 用法：node scripts/preview-detail.mjs [输出路径]
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
// 锚定几何取**真实实现**（不在这里手算）：与 NodeActionBar 用的是同一个函数。
import { nodeActionAnchor } from '../lib/canvas-view.js'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', '.workbuddy', 'preview')
const outPath = process.argv[2] ?? join(outDir, 'detail-preview.html')
await mkdir(outDir, { recursive: true })

const studioStyles = await readStudioStyles()
const brandCss = await brandTokensCss()
const presetId = await defaultPresetId()
await reportTokenCoverage('preview-detail', brandCss, HOST_TOKENS_DARK)

const hostCss = `:root {\n${renderTokenBlock(HOST_TOKENS_DARK)}\n}\nhtml[data-light] {\n${renderTokenBlock(HOST_TOKENS_LIGHT)}\n}`

/* ------------------------------------------------------------ 舞台与几何 */

const STAGE_W = 720
const STAGE_H = 320
/** 画布可视区 = 舞台尺寸（工具条的锚定与夹取都按它算，不是 window 尺寸）。 */
const SURFACE = { width: STAGE_W, height: STAGE_H }
/**
 * 工具条自身尺寸：**预览台的声明值**。
 *
 * 真机里组件是 `useLayoutEffect` 量完回填的，预览台量不到（生成 HTML 时还没有
 * 浏览器），只能声明。所以页内有一条断言「实测值必须贴近声明值」—— 声明一旦离真
 * 实太远，下面所有锚定算出来的位置就不再代表真机，那时断言必须响。
 */
const BAR = { width: 186, height: 31 }
const DRAWER_H = 220
const VIEW = { x: 0, y: 0, layersOpen: false, minimapVisible: false }

const anchorFor = (box, options = {}) => {
  const { scale = 1, bottomInset = 0 } = options
  return nodeActionAnchor(box, { ...VIEW, scale }, SURFACE, BAR, bottomInset)
}

const BOX = (id, x, y, width, height) => ({ id, x, y, width, height })

const ART = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240">'
  + '<rect width="100%" height="100%" fill="#1A2A4A"/>'
  + '<circle cx="120" cy="78" r="34" fill="#2E4C7A"/></svg>')

/* ------------------------------------------------------------ HTML 片段 */

const nodeHtml = (box, cls, title) => `
            <div class="csNode ${cls}" data-node-id="${box.id}"
                 style="left:0;top:0;transform:translate3d(${box.x}px, ${box.y}px, 0);width:${box.width}px;height:${box.height}px">
              <div class="csNodeHead">
                <span class="csNodeHeadKind">关键帧</span>
                <span class="csNodeHeadTitle">${title}</span>
              </div>
              <div class="csNodeMediaBox"><img class="csNodeMedia" src="${ART}" alt=""></div>
              <div class="csNodeFoot"><span class="csNodeFootReadings">16:9 · 1376 × 768</span></div>
            </div>`

/** 与 NodeActionBar 的三个按钮逐字一致；类名组合也照抄（含 Above/Below 后缀）。 */
const barHtml = (box, options = {}) => {
  const { scale = 1, bottomInset = 0, extraStyle = '' } = options
  const anchor = anchorFor(box, { scale, bottomInset })
  const placement = anchor.placement === 'above' ? 'Above' : 'Below'
  return `
            <div class="csNodeActionBar csNodeActionBar${placement}" data-placement="${anchor.placement}"
                 style="left:${anchor.x}px;top:${anchor.y}px${extraStyle}">
              <button type="button" class="csNodeActionBarBtn" title="用当前保存的参数重新生成一版">重试</button>
              <button type="button" class="csNodeActionBarBtn" title="打开详情并编辑提示词">改提示词</button>
              <button type="button" class="csNodeActionBarBtn" title="把该节点作为引用标记插入右侧输入框">引用到对话</button>
            </div>`
}

/**
 * 画布层。`barInside` 是**故意写错**的样子（工具条写进层内 ⇒ 跟着 scale 一起缩），
 * `barBefore` 也是故意写错（工具条排在层**之前**且 z-index:auto ⇒ 被层压住）。
 */
const layerHtml = ({ scale, nodes, barInside = '', layerZ = null }) => `
          <div class="csCanvasLayer" style="transform:scale(${scale});transform-origin:0 0${layerZ === null ? '' : `;z-index:${layerZ}`}">
${nodes.length > 0 ? nodes.join('\n') : ''}
${barInside}
          </div>`

/** 与 NodeDetailDrawer 的骨架同构（grip / head / body 两栏 / foot）。 */
const drawerHtml = () => `
          <aside class="csDetailDrawer" style="height:${DRAWER_H}px" aria-label="节点详情">
            <div class="csDetailDrawerGrip" role="separator" aria-orientation="horizontal" aria-label="拖动调整高度"></div>
            <header class="csDetailDrawerHead">
              <span class="csDetailDrawerKind">图片 · 关键帧</span>
              <button type="button" class="csDetailDrawerTitle" title="点击重命名">镜 02 · 门外有人</button>
              <button type="button" class="csDetailDrawerClose" aria-label="关闭详情">×</button>
            </header>
            <div class="csDetailDrawerBody">
              <section class="csDetailDrawerCol">
                <h3 class="csDetailDrawerColTitle">身份</h3>
                <div class="csDetailRow"><span class="csDetailLabel">工具</span><span class="csDetailValue" title="image_generate">image_generate</span></div>
                <div class="csDetailRow"><span class="csDetailLabel">创建</span><span class="csDetailValue">17:22</span></div>
                <h3 class="csDetailDrawerColTitle">变换</h3>
                <div class="csDetailRow"><span class="csDetailLabel">透明度</span><input type="range" class="csDetailRange" value="100" /><span class="csDetailValue">100%</span></div>
                <div class="csDetailRow"><span class="csDetailLabel">层级</span><button type="button" class="csDetailButton">置顶</button><button type="button" class="csDetailButton">置底</button></div>
              </section>
              <section class="csDetailDrawerCol csDetailDrawerColMain">
                <div class="csDetailBlock">
                  <div class="csPrompt">
                    <div class="csPromptHead">
                      <span class="csPromptLabel">提示词</span>
                      <span class="csPromptCount">96 字</span>
                      <span class="csPromptTools">
                        <button type="button" class="csDetailButton" title="就地编辑（失焦即保存）">编辑</button>
                        <button type="button" class="csDetailButton" title="展开占满右栏编辑">展开</button>
                        <button type="button" class="csDetailButton" title="全屏聚焦编辑（左侧可对照已保存版本）">聚焦</button>
                      </span>
                    </div>
                    <pre class="csPromptText" role="button" tabindex="0" title="点击就地编辑">写实悬疑短剧静帧：雨夜的旧居民楼走廊，女主穿浅灰睡衣站在虚掩的防盗门内，门缝外一只手电光斜切进来，湿润的水泥地面反出冷光，浅景深，16:9 横向构图，电影级打光。</pre>
                    <p class="csPromptHint">改动先落成参数；点「重试」才真的重新生成一版</p>
                  </div>
                </div>
              </section>
            </div>
            <footer class="csDetailDrawerFoot">
              <button type="button" class="csDetailButton csDetailButtonActive">重试</button>
              <button type="button" class="csDetailButton">引用到对话</button>
              <span class="csDetailFootSpacer"></span>
              <button type="button" class="csDetailButton">删除</button>
            </footer>
          </aside>`

const scene = ({ id, title, note, surface, body }) => `
  <figure class="pvScene" id="${id}">
    <figcaption><b>${title}</b><span>${note}</span></figcaption>
    <div class="pvStage">
      <div class="csCanvasBody">
${surface}
${body ?? ''}
      </div>
    </div>
  </figure>`

/* ------------------------------------------------------------ 场景定义 */

/** 工具条场景的节点：N1 是**盖住工具条位置的相邻节点**（用来问「最上面是谁」）。 */
const N1 = BOX('N1', 150, 50, 260, 90)
const M1 = BOX('M1', 180, 150, 200, 140)
const BAR_NODES = [nodeHtml(N1, '', '镜 01 · 她醒了'), nodeHtml(M1, 'csNodeSelected csNodePrimary', '镜 02 · 门外有人')]

/**
 * 参数错位（比如把缩放比当第一个参数塞进来）**不会报错**，只会安安静静渲染出一张
 * 少了一条工具条的静态图 —— 症状会伪装成「工具条不见了」，而断言是在浏览器里跑的，
 * 排查要绕一大圈。所以在生成期就挡住。
 */
const surfaceHtml = (layerInner, barSibling, barBefore = false) => {
  if (typeof layerInner !== 'string' || !layerInner.includes('csCanvasLayer')) {
    throw new Error('surfaceHtml 第 1 个参数必须是 .csCanvasLayer 片段')
  }
  if (typeof barSibling !== 'string') {
    throw new Error('surfaceHtml 第 2 个参数必须是工具条片段（不放就给空串）')
  }
  return `
        <div class="csCanvasSurface">
${barBefore ? barSibling : ''}
${layerInner}
${barBefore ? '' : barSibling}
        </div>`
}

const openSurface = `
        <div class="csCanvasSurface">
${layerHtml({ scale: 1, nodes: [nodeHtml(M1, 'csNodeSelected csNodePrimary', '镜 02 · 门外有人')] })}
        </div>`

const scenes = [
  scene({
    id: 'pvA',
    title: 'A · 工具条 · 常态（1× 缩放，相邻节点就压在它下面）',
    note: '基线：尺寸不随缩放变、压在节点之上、贴在所属节点上缘之外',
    surface: surfaceHtml(
      layerHtml({ scale: 1, nodes: BAR_NODES }),
      barHtml(M1),
    ),
  }),
  scene({
    id: 'pvB',
    title: 'B · 工具条 · 缩到 0.4×（真机缩小后的样子）',
    note: '尺寸必须与 A 逐像素相同 —— 这正是它渲染在画布层之外的全部理由',
    surface: surfaceHtml(
      layerHtml({ scale: 0.4, nodes: BAR_NODES }),
      barHtml(M1, { scale: 0.4 }),
    ),
  }),
  scene({
    id: 'pvC',
    title: 'C · 反向对照（工具条被写进画布层之内）',
    note: '故意写错：写进层内后尺寸被 scale 拉着走 —— 它必须比 A 明显小，否则说明「尺寸」这个量看不出架构错误',
    surface: surfaceHtml(
      layerHtml({ scale: 0.4, nodes: BAR_NODES, barInside: barHtml(M1, { scale: 0.4 }) }),
      '',
    ),
  }),
  scene({
    id: 'pvD',
    title: 'D · 反向对照（工具条排在画布层之前 + z-index:auto）',
    note: '故意写错：DOM 次序在后、z-index 又不抬，工具条会被层整体压住 —— 它必须命中 N1',
    surface: surfaceHtml(
      layerHtml({ scale: 1, nodes: BAR_NODES }),
      barHtml(M1, { extraStyle: ';z-index:auto' }),
      true,
    ),
  }),
  scene({
    id: 'pvE',
    title: 'E · 抽屉 · 常态（节点就压在抽屉中央）',
    note: '底边贴容器底边、左右贴容器两缘；elementFromPoint 必须命中抽屉',
    surface: openSurface,
    body: drawerHtml(),
  }),
  scene({
    id: 'pvF',
    title: 'F · 反向对照（画布层被抬到抽屉之上）',
    note: '故意写错：层 z-index:40 压过抽屉的 30，抽屉中心会命中节点 —— 证明上一条的命中探针有分辨力',
    surface: `
        <div class="csCanvasSurface">
${layerHtml({ scale: 1, nodes: [nodeHtml(M1, 'csNodeSelected csNodePrimary', '镜 02 · 门外有人')], layerZ: 40 })}
        </div>`,
    body: drawerHtml(),
  }),
  scene({
    id: 'pvG',
    title: 'G · 工具条 · 节点贴顶（上方装不下）',
    note: '必须翻到节点下缘之外，缩放原点跟着翻到上缘（.csNodeActionBarBelow）',
    surface: surfaceHtml(
      layerHtml({ scale: 1, nodes: [nodeHtml(BOX('M1', 260, 4, 200, 140), 'csNodeSelected csNodePrimary', '镜 02 · 门外有人')] }),
      barHtml(BOX('M1', 260, 4, 200, 140)),
    ),
  }),
  scene({
    id: 'pvH',
    title: 'H · 让位 · 抽屉打开（bottomInset = 抽屉高）',
    note: '工具条必须被夹在抽屉之上 —— 抽屉一开就把按钮埋掉，用户会以为按钮失灵',
    surface: surfaceHtml(
      layerHtml({ scale: 1, nodes: [nodeHtml(BOX('M1', 260, 210, 200, 80), 'csNodeSelected csNodePrimary', '镜 02 · 门外有人')] }),
      barHtml(BOX('M1', 260, 210, 200, 80), { bottomInset: DRAWER_H }),
    ),
    body: drawerHtml(),
  }),
  scene({
    id: 'pvI',
    title: 'I · 反向对照（bottomInset = 0）',
    note: '故意写错：不让位时工具条整条落进抽屉里、被抽屉盖住点不到 —— 证明「让位」不是装饰',
    surface: surfaceHtml(
      layerHtml({ scale: 1, nodes: [nodeHtml(BOX('M1', 260, 210, 200, 80), 'csNodeSelected csNodePrimary', '镜 02 · 门外有人')] }),
      barHtml(BOX('M1', 260, 210, 200, 80)),
    ),
    body: drawerHtml(),
  }),
]

/* ---------------------------------------------------------------- 页面 */

const html = `<!doctype html>
<html lang="zh-CN" data-cs-preset="${presetId}">
<head>
<meta charset="utf-8" />
<title>Canvas Studio · 节点详情验收台（就近工具条 + 底部抽屉）</title>
<style>
${hostCss}

${brandCss}

/* ---- 真实产品样式（从 styles.ts 抽取，未改动一行） ---- */
${studioStyles}

/* ---- 本页舞台样式：只负责摆放，不参与任何被断言的外观 ---- */
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 20px 20px 40px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
}
h1 { font-size: 15px; margin: 0 0 6px; }
.pvHint { font-size: 12px; color: var(--dsw-alias-label-tertiary); margin: 0 0 18px; line-height: 1.7; }
.pvScenes { display: flex; flex-direction: column; gap: 18px; }
.pvScene { margin: 0; }
.pvScene figcaption { font-size: 12px; margin: 0 0 8px; display: flex; gap: 10px; align-items: baseline; }
.pvScene figcaption span { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
/* ⚠️ 舞台必须是 flex 容器：.csCanvasBody 的尺寸契约是 flex:1 + min-height:0，
   放进普通 block 会塌成 0 高、节点全被裁掉（preview-tray 踩过同一个坑）。 */
.pvStage { position: relative; display: flex; width: ${STAGE_W}px; height: ${STAGE_H}px; }
.pvCheck { margin-top: 20px; padding: 12px 14px; font-size: 12px; line-height: 1.7;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; white-space: pre-wrap; }
#pvVerdict { display: none; }
</style>
</head>
<body>
<h1>节点详情验收台</h1>
<p class="pvHint">
  样式取自 <code>src/client/styles.ts</code>、令牌取自 <code>lib/brand.js</code>、工具条坐标取自
  <code>nodeActionAnchor</code>（都是真实实现，非仿制）。判定分两类：几何用
  <code>getBoundingClientRect</code>，层叠用 <code>elementFromPoint</code> 直接问「那一点最上面是谁」。
  A / B / C 只差「工具条挂在哪儿」，D 与 A 只差 z-index 与 DOM 次序，E 与 F 只差画布层 z-index ——
  反向对照场景必须红。
</p>

<div class="pvScenes">
${scenes.join('\n')}
</div>

<div class="pvCheck" id="pvCheck">自检运行中…</div>
<pre id="pvVerdict"></pre>

<script>
(function () {
  'use strict'
  var params = new URLSearchParams(location.search)
  var theme = params.get('theme') === 'light' ? 'light' : 'dark'
  document.documentElement.toggleAttribute('data-light', theme === 'light')

  // 入场动画（csYieldPop）带 fill both：动画没跑完时 rect 量到的是缩放中间态，
  // 几何断言会整批量歪。先把所有动画推到终态再开始量（preview-visual 同法）。
  try {
    document.getAnimations().forEach(function (a) { try { a.finish() } catch (err) {} })
  } catch (err) {}

  var DECLARED_BAR_W = ${BAR.width}
  var DECLARED_BAR_H = ${BAR.height}
  var DRAWER_H = ${DRAWER_H}

  var lines = []
  var fail = 0
  function check(label, ok, detail) {
    lines.push((ok ? '\\u2705 ' : '\\u274c ') + label + (detail ? '  \\u2192 ' + detail : ''))
    if (!ok) fail += 1
  }
  /** 场景根：所有选择器都必须在场景内取 —— M1 这类 id 在九个场景里重复出现。 */
  function stage(id) {
    var el = document.querySelector('#' + id + ' .pvStage')
    if (el === null) throw new Error('缺场景：' + id)
    return el
  }
  function csOf(el, prop) { return getComputedStyle(el).getPropertyValue(prop).trim() }
  /** 颜色的 alpha（rgb / rgba / color(srgb ... / a) 三种写法都要认）。 */
  function alphaOf(color) {
    var m = /^rgba?\\(([^)]+)\\)$/.exec(color)
    if (m !== null) {
      var parts = m[1].split(/[,\\/]/).map(Number)
      return parts.length > 3 ? parts[3] : 1
    }
    m = /^color\\([^)]*\\/\\s*([\\d.]+)\\s*\\)$/.exec(color)
    return m === null ? 1 : parseFloat(m[1])
  }
  /** 滚进视口再量 —— 元素在视口外时 elementFromPoint 一律返回 null，会退化成假绿。 */
  function rectsIn(id, selectors) {
    var root = stage(id)
    root.scrollIntoView({ block: 'center' })
    var out = {}
    for (var i = 0; i < selectors.length; i++) {
      var el = root.querySelector(selectors[i])
      out[selectors[i]] = el === null ? null : el.getBoundingClientRect()
    }
    return out
  }
  function rectIn(id, selector) { return rectsIn(id, [selector])[selector] }
  /**
   * 在元素 \`selector\` 内的相对点 (dx, dy) 上，鼠标实际会打中谁。
   * 返回 'BAR' / 'DRAWER' / 节点 id / 'OTHER:类名' —— 这一问就是真机上
   * 「按钮点不动」「面板被盖住」的那一问。
   */
  function hitIn(id, selector, dx, dy) {
    var root = stage(id)
    root.scrollIntoView({ block: 'center' })
    var el = root.querySelector(selector)
    if (el === null) return 'MISSING:' + selector
    var r = el.getBoundingClientRect()
    var x = r.left + r.width * (dx === undefined ? 0.5 : dx)
    var y = r.top + r.height * (dy === undefined ? 0.5 : dy)
    var hit = document.elementFromPoint(Math.round(x), Math.round(y))
    if (hit === null) return 'NULL(视口外?)'
    if (hit.closest('.csNodeActionBar') !== null) return 'BAR'
    if (hit.closest('.csDetailDrawer') !== null) return 'DRAWER'
    var owner = hit.closest('[data-node-id]')
    return owner === null ? 'OTHER:' + hit.className : owner.getAttribute('data-node-id')
  }
  function originY(id, selector) {
    var value = csOf(stage(id).querySelector(selector), 'transform-origin')
    return parseFloat(value.split(' ')[1])
  }

  try {
    /* ---- 前提：令牌真的解析出值（「躺在文件里」与「页面上生效」是两件事） ---- */
    var rootStyle = getComputedStyle(document.documentElement)
    var emptyTokens = ['--cs-float', '--cs-line-hi', '--cs-shadow-2', '--cs-fs-xs'].filter(function (name) {
      return rootStyle.getPropertyValue(name).trim() === ''
    })
    check('关键令牌在浏览器里全部可解析', emptyTokens.length === 0, emptyTokens.join(' '))

    /* ---- 工具条：尺寸不随画布缩放变形 ---- */
    var rA = rectsIn('pvA', ['.csNodeActionBar', '[data-node-id="M1"]'])
    var wA = rA['.csNodeActionBar'].width
    var hA = rA['.csNodeActionBar'].height
    check('工具条真的量出了尺寸（否则下面几条退化成恒真）',
      wA > 40 && hA > 12, wA.toFixed(1) + ' × ' + hA.toFixed(1))
    check('预览台的声明尺寸贴近实测（声明离真实太远，锚定位置就不代表真机）',
      Math.abs(wA - DECLARED_BAR_W) <= 8 && Math.abs(hA - DECLARED_BAR_H) <= 6,
      '实测 ' + wA.toFixed(1) + '×' + hA.toFixed(1) + ' vs 声明 ' + DECLARED_BAR_W + '×' + DECLARED_BAR_H)
    var wB = rectIn('pvB', '.csNodeActionBar').width
    check('1× 与 0.4× 下工具条尺寸逐像素相同（渲染在画布层之外 ⇒ 不随缩放变形）',
      Math.abs(wA - wB) <= 0.5, wA.toFixed(2) + ' vs ' + wB.toFixed(2))
    var wC = rectIn('pvC', '.csNodeActionBar').width
    check('反向对照：写进画布层内后尺寸被缩到 ~0.4× —— 证明上一行的「尺寸」量真有分辨力',
      wC > 0 && wC < wA * 0.6, wC.toFixed(2) + ' vs ' + wA.toFixed(2))

    /* ---- 工具条：层叠（相邻节点就压在它下面） ---- */
    var hitA = hitIn('pvA', '.csNodeActionBar')
    check('工具条压在相邻节点之上（elementFromPoint 命中工具条本身）', hitA === 'BAR', hitA)
    var hitD = hitIn('pvD', '.csNodeActionBar')
    check('反向对照：排在画布层之前且 z-index:auto 时被节点压住 —— 证明命中探针有分辨力',
      hitD === 'N1', hitD)
    // ⚠️ 这一条是**反向探针逼出来的**：把 .csNodeActionBar 的 z-index 改成 auto 时，
    // 上面那条命中断言照样绿 —— 因为工具条在 DOM 次序上排在画布层之后，auto 对 auto
    // 靠次序也能压住。也就是说「压住节点」这件事当前有一半靠次序兜底，而次序是最容易
    // 被下一次重排动到的东西。这里把「显式抬层」本身变成断言，不再靠巧合。
    var barZ = csOf(stage('pvA').querySelector('.csNodeActionBar'), 'z-index')
    check('工具条显式抬层（z-index 是数字，不靠 DOM 次序兜底）—— 层序一动就会被节点压住',
      /^[0-9]+$/.test(barZ), barZ)

    /* ---- 工具条：贴节点上缘之外、不盖住节点 ---- */
    check('工具条贴在所属节点上缘之外（不盖住它操作的那张卡）',
      rA['.csNodeActionBar'].bottom <= rA['[data-node-id="M1"]'].top + 2,
      rA['.csNodeActionBar'].bottom.toFixed(1) + ' vs 节点 top ' + rA['[data-node-id="M1"]'].top.toFixed(1))
    check('贴上方时缩放原点钉在下缘（读成「从节点边缘往上长出」）',
      Math.abs(originY('pvA', '.csNodeActionBar') - hA) <= 1.5, originY('pvA', '.csNodeActionBar'))

    /* ---- 工具条：上方装不下就翻到下方 ---- */
    var rG = rectsIn('pvG', ['.csNodeActionBar', '[data-node-id="M1"]'])
    check('节点贴顶时翻到节点下缘之外',
      rG['.csNodeActionBar'].top >= rG['[data-node-id="M1"]'].bottom - 1,
      rG['.csNodeActionBar'].top.toFixed(1) + ' vs 节点 bottom ' + rG['[data-node-id="M1"]'].bottom.toFixed(1))
    check('翻到下方后缩放原点跟着翻到上缘（.csNodeActionBarBelow 真的挂上了）',
      originY('pvG', '.csNodeActionBar') <= 1.5, originY('pvG', '.csNodeActionBar'))

    /* ---- 工具条：实底（刻意不玻璃）+ 动效接线 ---- */
    var barEl = stage('pvA').querySelector('.csNodeActionBar')
    check('工具条实底不玻璃（走 --cs-float；Q3 拍板只给抽屉与图层浮层玻璃）',
      alphaOf(csOf(barEl, 'background-color')) === 1, csOf(barEl, 'background-color'))
    check('工具条出现走浮层词汇 pop（csYieldPop）',
      csOf(barEl, 'animation-name') === 'csYieldPop', csOf(barEl, 'animation-name'))

    /* ---- 抽屉：几何（只占画布宽、底边贴时间轴顶边） ---- */
    var rE = rectsIn('pvE', ['.csDetailDrawer', '.csCanvasBody'])
    var drawerBox = rE['.csDetailDrawer']
    var bodyBox = rE['.csCanvasBody']
    check('抽屉底边贴容器底边（= 时间轴顶边），差 ≤ 1px',
      Math.abs(drawerBox.bottom - bodyBox.bottom) <= 1,
      drawerBox.bottom.toFixed(1) + ' vs ' + bodyBox.bottom.toFixed(1))
    check('抽屉左右贴容器两缘（只占画布宽，不压宿主右栏）',
      Math.abs(drawerBox.left - bodyBox.left) <= 1 && Math.abs(drawerBox.right - bodyBox.right) <= 1,
      drawerBox.left.toFixed(1) + '~' + drawerBox.right.toFixed(1) + ' vs ' + bodyBox.left.toFixed(1) + '~' + bodyBox.right.toFixed(1))
    check('抽屉高度 = 传入的可拖高度（不是 CSS 写死的）',
      Math.abs(drawerBox.height - DRAWER_H) <= 1,
      drawerBox.height.toFixed(1) + ' vs ' + DRAWER_H)

    /* ---- 抽屉：层叠 ---- */
    // 取样点钉在**节点中心**（它天然属于那张卡），问「这一点最上面是谁」。
    // 比钉抽屉中心更准：抽屉中心会随抽屉自身尺寸漂移（改宽度就换位置），节点中心不会 ——
    // 反向探针里那条 320px 宽度的变异正是靠这一点把两个对照同时点着的。
    var hitE = hitIn('pvE', '[data-node-id="M1"]')
    check('抽屉压在节点之上（在节点中心那一点上，最上面的是抽屉）', hitE === 'DRAWER', hitE)
    var hitF = hitIn('pvF', '[data-node-id="M1"]')
    check('反向对照：画布层被抬到抽屉之上后，同一点命中节点 —— 证明上一条有分辨力',
      hitF === 'M1', hitF)

    /* ---- 抽屉：抓取带 / 玻璃 / 两栏 / 提示词可读性 ---- */
    var drawerEl = stage('pvE').querySelector('.csDetailDrawer')
    var grip = stage('pvE').querySelector('.csDetailDrawerGrip')
    check('上缘 6px 抓取带 + ns-resize（可拖高，且不会「想点 × 却把抽屉拉高」）',
      Math.abs(parseFloat(csOf(grip, 'height')) - 6) <= 0.5 && csOf(grip, 'cursor') === 'ns-resize',
      csOf(grip, 'height') + ' / ' + csOf(grip, 'cursor'))
    check('抽屉玻璃化（有模糊 + 底色半透明 —— 假玻璃 = 只透明不模糊）',
      csOf(drawerEl, 'backdrop-filter') !== 'none' && alphaOf(csOf(drawerEl, 'background-color')) < 1,
      csOf(drawerEl, 'backdrop-filter') + ' / alpha=' + alphaOf(csOf(drawerEl, 'background-color')).toFixed(2))
    check('抽屉出现走浮层词汇 pop（与图层浮层同一词汇）',
      csOf(drawerEl, 'animation-name') === 'csYieldPop', csOf(drawerEl, 'animation-name'))
    var cols = csOf(stage('pvE').querySelector('.csDetailDrawerBody'), 'grid-template-columns').split(/\\s+/)
    check('主体两栏：左「身份」≤280px、右「内容」更宽（提示词要的是尽量宽）',
      cols.length === 2 && parseFloat(cols[0]) >= 200 && parseFloat(cols[0]) <= 281
      && parseFloat(cols[1]) > parseFloat(cols[0]),
      cols.join(' / '))
    var promptEl = stage('pvE').querySelector('.csPromptText')
    var promptBox = rectIn('pvE', '.csPromptText')
    check('提示词只读态：≥12px + overflow-wrap:anywhere（不劈英文词）+ 宽 > 300px（不再挤在 label 后 ~180px 的单行里）',
      parseFloat(csOf(promptEl, 'font-size')) >= 12
      && csOf(promptEl, 'word-break') !== 'break-all'
      && csOf(promptEl, 'overflow-wrap') === 'anywhere'
      && promptBox.width > 300,
      csOf(promptEl, 'font-size') + ' / word-break:' + csOf(promptEl, 'word-break')
      + ' / ' + csOf(promptEl, 'overflow-wrap') + ' / 宽 ' + promptBox.width.toFixed(0))

    /* ---- 抽屉让位：工具条不得落进抽屉 ---- */
    var rH = rectsIn('pvH', ['.csNodeActionBar', '.csDetailDrawer'])
    check('抽屉打开时工具条被夹在抽屉之上（bottomInset 生效）',
      rH['.csNodeActionBar'].bottom <= rH['.csDetailDrawer'].top + 1,
      rH['.csNodeActionBar'].bottom.toFixed(1) + ' vs 抽屉 top ' + rH['.csDetailDrawer'].top.toFixed(1))
    var rI = rectsIn('pvI', ['.csNodeActionBar', '.csDetailDrawer'])
    check('反向对照：bottomInset=0 时工具条整条落进抽屉里',
      rI['.csNodeActionBar'].top > rI['.csDetailDrawer'].top,
      rI['.csNodeActionBar'].top.toFixed(1) + ' vs 抽屉 top ' + rI['.csDetailDrawer'].top.toFixed(1))
    var hitI = hitIn('pvI', '.csNodeActionBar')
    check('反向对照：落进抽屉的工具条被抽屉盖住、点不到 —— 证明「让位」不是装饰',
      hitI === 'DRAWER', hitI)
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
