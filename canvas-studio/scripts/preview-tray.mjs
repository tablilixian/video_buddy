/**
 * 托盘层叠验收台（CV-183）。
 *
 * ## 为什么需要一个台子
 *
 * 真机现象：**拖动画布上的托盘时，里面的图片会消失，松手又回来**。
 * 成因链三段：
 *   ① `.csNodePrimary.csNodeSelected { z-index: 3 }` —— 给「被拖动的普通卡」
 *      置顶用（免得被别的选中卡的外光晕压住），本身没错；
 *   ② 托盘是**容器**：成员是画布层的兄弟节点，常态下靠 compareNodes 把托盘
 *      排在 zIndex 最低一位、画在托盘之上；
 *   ③ 托盘卡身不透明（--cs-node）→ 一旦被抬到 3，整张成员图当场被盖住。
 *
 * 静态守卫（tests/group-tray.test.mjs 的 CV-183）能锁住「规则在不在、类挂没挂」，
 * 但锁不住**层叠结果**：DOM 顺序反了、选择器被更高特异度压过、卡身被改成半透明，
 * 这些在源码里全都「看着对」。所以这里把真实 styles.ts + 真实品牌令牌喂给浏览器，
 * 用 `elementFromPoint` 直接问一句「成员图上那一点，最上面是谁」。
 *
 * ## 关键设计：同一页里放一组**未修复对照**
 *
 * 场景 B 故意用修复前的类组合（有 csNodePrimary、没有 csNodeTray）。它必须红
 * （命中托盘）。若哪天 B 也变成「命中成员」，说明这台子失去了分辨力（比如
 * elementFromPoint 取错了坐标），那比断言失败更危险 —— 所以 B 的反向期望本身
 * 也是一条断言。
 *
 * 用法：node scripts/preview-tray.mjs [输出路径]
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
// 托盘几何取**真实实现**（不在这里手算）：盒子和产品里是同一个 groupBoxOf。
import { groupBoxOf } from '../lib/canvas-view.js'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', '.workbuddy', 'preview')
const outPath = process.argv[2] ?? join(outDir, 'tray-preview.html')
await mkdir(outDir, { recursive: true })

const studioStyles = await readStudioStyles()
const brandCss = await brandTokensCss()
const presetId = await defaultPresetId()
await reportTokenCoverage('preview-tray', brandCss, HOST_TOKENS_DARK)

const hostCss = `:root {\n${renderTokenBlock(HOST_TOKENS_DARK)}\n}\nhtml[data-light] {\n${renderTokenBlock(HOST_TOKENS_LIGHT)}\n}`

/* ---------------------------------------------------------------- 场景数据 */

const ART = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="280">'
  + '<rect width="100%" height="100%" fill="#1A2A4A"/>'
  + '<circle cx="110" cy="80" r="38" fill="#2E4C7A"/></svg>')

const member = (id, x, title) => ({
  id, kind: 'image', title, x, y: 72, width: 200, height: 140,
  createdAt: 10, sourceIds: [], url: ART,
})

/** 托盘节点：盒子由真实 groupBoxOf 给出（成员包围盒 + 12 padding + 24 抓取带）。 */
const trayOf = (id, members) => ({
  id, kind: 'group', title: '凌晨三点的门外人', ...groupBoxOf(members), createdAt: 1, sourceIds: [],
})

const nodeHtml = (node, cls, inner) => `
      <div class="csNode ${cls}" data-node-id="${node.id}"
           style="left:0;top:0;transform:translate3d(${node.x}px, ${node.y}px, 0);width:${node.width}px;height:${node.height}px">
        ${inner}
      </div>`

/**
 * 托盘内部骨架与 CanvasNode.tsx 的 group 分支逐项对齐：
 * 外层是 .csNode（+ 状态类），内层那个布局 div 才叫 .csNodeGroup。
 * ⚠️ 别把状态类挂到内层：CSS 选的是外层，挂错就等于没挂（CV-183 的豁免规则会死）。
 */
const trayInner = count => `
        <div class="csNodeGroup">
          <div class="csGroupHead">
            <span class="csNodeKind">凌晨三点的门外人</span>
            <span class="csGroupCount">${count} 张</span>
          </div>
        </div>`

const memberInner = title => `
        <div class="csNodeHead">
          <span class="csNodeHeadKind">关键帧</span>
          <span class="csNodeHeadTitle">${title}</span>
        </div>
        <div class="csNodeMediaBox"><img class="csNodeMedia" src="${ART}" alt=""></div>
        <div class="csNodeFoot"><span class="csNodeFootReadings">16:9 · 1920 × 1080</span></div>`

/**
 * 一个场景 = 一个真实的 .csCanvasSurface > .csCanvasLayer，节点按 **compareNodes
 * 的渲染序**摆放：托盘 zIndex 比成员低 1 → 先渲染（画在下面）。
 */
const scene = ({ id, title, note, trayCls, members, titles }) => {
  const tray = trayOf('G', members)
  return `
  <figure class="pvScene" id="${id}">
    <figcaption><b>${title}</b><span>${note}</span></figcaption>
    <div class="pvStage">
      <div class="csCanvasSurface">
        <div class="csCanvasLayer">
          ${nodeHtml(tray, trayCls, trayInner(members.length))}
          ${members.map((m, i) => nodeHtml(m, '', memberInner(titles[i]))).join('\n')}
        </div>
      </div>
    </div>
  </figure>`
}

const one = [member('M1', 24, '镜 01 · 她醒了')]
const two = [member('M1', 24, '镜 01 · 她醒了'), member('M2', 236, '镜 02 · 门外有人')]

const scenes = [
  scene({
    id: 'pvA', title: 'A · 常态（托盘已选中，未按住）',
    note: '基线：成员画在托盘之上，托盘 z-index = auto',
    trayCls: 'csNodeSelected', members: one, titles: ['镜 01 · 她醒了'],
  }),
  scene({
    id: 'pvB', title: 'B · 未修复对照（按住托盘，无 csNodeTray）',
    note: '故意保留修复前的类组合 —— 它必须命中托盘，否则说明这台子没有分辨力',
    trayCls: 'csNodeSelected csNodePrimary', members: one, titles: ['镜 01 · 她醒了'],
  }),
  scene({
    id: 'pvC', title: 'C · 修复后（按住托盘 + csNodeTray）',
    note: '应与 A 完全等价；拖动描边仍在（豁免只管层叠）',
    trayCls: 'csNodeSelected csNodePrimary csNodeTray', members: one, titles: ['镜 01 · 她醒了'],
  }),
  scene({
    id: 'pvD', title: 'D · 修复后 · 多成员托盘（按住）',
    note: '两张成员都要在托盘之上 —— 单张能过不代表多张能过',
    trayCls: 'csNodeSelected csNodePrimary csNodeTray', members: two,
    titles: ['镜 01 · 她醒了', '镜 02 · 门外有人'],
  }),
]

/* ---------------------------------------------------------------- 页面 */

const html = `<!doctype html>
<html lang="zh-CN" data-cs-preset="${presetId}">
<head>
<meta charset="utf-8" />
<title>Canvas Studio · 托盘层叠验收台（CV-183）</title>
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
.pvHint { font-size: 12px; color: var(--dsw-alias-label-tertiary); margin: 0 0 18px; }
.pvScenes { display: flex; flex-direction: column; gap: 18px; }
.pvScene { margin: 0; }
.pvScene figcaption { font-size: 12px; margin: 0 0 8px; display: flex; gap: 10px; align-items: baseline; }
.pvScene figcaption span { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
/* ⚠️ 舞台必须是 flex 容器：.csCanvasSurface 的尺寸契约是 flex:1 + min-height:0，
   放进普通 block 会塌成 0 高、节点全被裁掉（drive.mjs 踩过同一个坑）。 */
.pvStage { position: relative; display: flex; width: 520px; height: 300px; }
.pvCheck { margin-top: 20px; padding: 12px 14px; font-size: 12px; line-height: 1.7;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; white-space: pre-wrap; }
#pvVerdict { display: none; }
</style>
</head>
<body>
<h1>托盘层叠验收台</h1>
<p class="pvHint">
  样式取自 <code>src/client/styles.ts</code>、令牌取自 <code>lib/brand.js</code>、托盘盒子取自
  <code>groupBoxOf</code>（都是真实实现，非仿制）。判定用 <code>elementFromPoint</code> 直接问
  「成员图上那一点，最上面是谁」—— 这正是真机上「图片消失」的那一问。
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
  function cs(selector, prop) {
    return getComputedStyle(el(selector)).getPropertyValue(prop).trim()
  }
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
  /**
   * 点 (x, y) 上鼠标实际会打中哪个带 data-node-id 的卡（没有就返回类名/NULL）。
   * 坐标是**视口坐标**：元素在视口外时 elementFromPoint 一律返回 null，那会
   * 退化成「全都命中不了」的假绿，所以每次测量前先把它滚进视口。
   */
  function hitAtPoint(x, y) {
    var hit = document.elementFromPoint(Math.round(x), Math.round(y))
    if (hit === null) return 'NULL(视口外?)'
    var owner = hit.closest('[data-node-id]')
    return owner === null ? hit.className : owner.getAttribute('data-node-id')
  }
  /** 场景 id 必须带前缀限定：M1 这类节点 id 在四个场景里重复出现。 */
  function scoped(sceneId, nodeId) {
    return '#' + sceneId + ' [data-node-id="' + nodeId + '"]'
  }
  function boxOf(sceneId, nodeId) {
    var target = document.querySelector(scoped(sceneId, nodeId))
    if (target === null) return null
    target.scrollIntoView({ block: 'center' })
    return target.getBoundingClientRect()
  }
  /** 卡**中心**命中了谁 —— 成员图的中心是最有代表性的一点。 */
  function centerHit(sceneId, nodeId) {
    var box = boxOf(sceneId, nodeId)
    if (box === null) return 'MISSING:' + nodeId
    return hitAtPoint(box.left + box.width / 2, box.top + box.height / 2)
  }
  /** 托盘**抓取带**中心命中了谁（拖动把手必须真的在托盘上）。 */
  function trayHeadHit(sceneId) {
    var band = boxOf(sceneId, 'G')
    if (band === null) return 'MISSING:G'
    var head = document.querySelector('#' + sceneId + ' .csGroupHead')
    var lead = head === null ? 12 : head.getBoundingClientRect().height / 2
    return hitAtPoint(band.left + band.width / 2, band.top + lead)
  }
  function zIndexOf(sceneId) {
    return getComputedStyle(el(scoped(sceneId, 'G'))).zIndex
  }

  try {
    /* ---- 令牌必须真的解析出值（「躺在文件里」与「页面上生效」是两件事） ---- */
    var tokenNames = ['--cs-node', '--cs-accent', '--cs-accent-soft', '--cs-glow-accent', '--cs-line']
    var rootStyle = getComputedStyle(document.documentElement)
    var emptyTokens = tokenNames.filter(function (name) {
      return rootStyle.getPropertyValue(name).trim() === ''
    })
    check('关键令牌在浏览器里全部可解析', emptyTokens.length === 0, emptyTokens.join(' '))

    /* ---- 前提：卡身不透明。「遮挡 = 图片消失」全靠这一条 ---- */
    check('托盘卡身不透明（否则遮挡只是蒙一层纱，本台子的判定前提就不成立）',
      alphaOf(cs(scoped('pvC', 'G'), 'background-color')) === 1,
      cs(scoped('pvC', 'G'), 'background-color'))

    /* ---- A 基线：未按住 ---- */
    check('A 常态：托盘 z-index = auto', zIndexOf('pvA') === 'auto', zIndexOf('pvA'))
    check('A 常态：成员图中心命中成员本身（图片可见）',
      centerHit('pvA', 'M1') === 'M1', centerHit('pvA', 'M1'))

    /* ---- B 未修复对照：必须红（这条同时证明台子有分辨力） ---- */
    check('B 未修复对照：托盘 z-index 被抬到 3', zIndexOf('pvB') === '3', zIndexOf('pvB'))
    check('B 未修复对照：成员图中心命中**托盘**（这就是用户看到的「图片消失」）',
      centerHit('pvB', 'M1') === 'G', centerHit('pvB', 'M1'))

    /* ---- C 修复后：与 A 等价，且描边/把手都还在 ---- */
    check('C 修复后：托盘 z-index 退回 auto', zIndexOf('pvC') === 'auto', zIndexOf('pvC'))
    check('C 修复后：成员图中心命中成员（图片回来了）',
      centerHit('pvC', 'M1') === 'M1', centerHit('pvC', 'M1'))
    var glow = cs(scoped('pvC', 'G'), 'box-shadow')
    check('C 修复后：拖动描边仍在（豁免只管层叠，不抹掉拖动反馈）',
      glow.indexOf('2px') >= 0 && glow !== 'none', glow)
    check('C 修复后：抓取带仍命中托盘（拖动把手没被自己的成员抢走）',
      trayHeadHit('pvC') === 'G', trayHeadHit('pvC'))

    /* ---- D 多成员：一张能过不代表多张能过 ---- */
    check('D 多成员：托盘 z-index = auto', zIndexOf('pvD') === 'auto', zIndexOf('pvD'))
    check('D 多成员：第一张成员命中成员', centerHit('pvD', 'M1') === 'M1', centerHit('pvD', 'M1'))
    check('D 多成员：第二张成员命中成员', centerHit('pvD', 'M2') === 'M2', centerHit('pvD', 'M2'))
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
