/**
 * CV-182 / DD-10 验收台：**新建项目对话框** + **首屏（lobby-pending）**。
 *
 * ## 为什么值得单开一组
 *
 * 这两处的题面都是「好看不好看」，而 CSS 断言恰恰对观感最无能：
 * `styles.ts` 里写着 `background-color: var(--cs-canvas-bg-l1)` 完全可能一个字都
 * 不生效（选择器锚点错、被更高特异度压过、令牌解析成空），静态检查全绿而页面上
 * 是白盒子 —— 本仓 2026-09-12 的基块锚点 bug 就是这么藏的。所以这里把
 * `styles.ts` 的**原文**与 `brand.ts` 的**令牌文本**一起丢进真实浏览器，读
 * `getComputedStyle` 判「到底发生了什么」。
 *
 * ## 这一页回答的两个问题
 *
 * 1. **对话框**：标题栏是否真的画出来了（它是 df8ad3b2b5 关掉、CV-182 复归的
 *    那一处）；分组下拉是否收进字段盒（原生箭头关掉、箭头自绘）；两行 chip 组
 *    是否一行放得下、选中是不是 accent。
 * 2. **首屏**：对话卡的底色是否与品牌条（`.csLobbyHero`）**相等** —— 题目里的
 *    「不和谐」正是「品牌条已铺画布材质、卡片还是白盒子」；以及它是否仍
 *    ≠ 最深画布底（DD-02 硬约束）；开拍前条是否嵌在 `.csCanvas` 里、规格与
 *    阶段是否真的排在两端。
 *
 * ## 明暗两轨都要跑
 *
 * `--cs-accent-soft` 光晕在浅色下是「亮纱」而暗色下是「余晖」，卡片的可读性
 * 判定在两轨下不同 —— 只跑暗色会漏掉浅色那一半（DD-03 的 `--cs-glow-accent`
 * 就曾整条只在暗色块里定义）。故 verify-previews 里本组配 `?theme=dark|light`。
 *
 * ## 为什么**不**调用 `tokenProbe()`
 *
 * 那一族的收尾钩子自带一个 `<pre id="pvVerdict">`，并会 `setAttribute(
 * 'data-pv-fail', …)` —— 它跑在本页自检之后，会**覆盖**本页的判决（getElementById
 * 拿到的是先出现的那个）。本仓已有自定义自检的 `preview-rail.mjs` 同样不调用它。
 * 令牌可解析性已并入下面自检的第一条断言，覆盖面只多不少。
 *
 * 用法：node scripts/preview-create.mjs [输出路径]
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

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', '.workbuddy', 'preview')
const outPath = process.argv[2] ?? join(outDir, 'create-modal-preview.html')
await mkdir(outDir, { recursive: true })

// 与其它预览同一套取法：样式取 styles.ts 原文，令牌取 brand.ts 产物 —— 手抄一份
// 就会随源码漂移，预览会安静地显示残缺效果（比脚本报错贵得多）。
const studioStyles = await readStudioStyles()
const brandCss = await brandTokensCss()
const presetId = await defaultPresetId()
await reportTokenCoverage('preview-create', brandCss, HOST_TOKENS_DARK)

const hostCss = `:root {\n${renderTokenBlock(HOST_TOKENS_DARK)}\n}\nhtml[data-light] {\n${renderTokenBlock(HOST_TOKENS_LIGHT)}\n}`

/* ---------------------------------------------------------------- DOM 片段 */

/** chip 组：两行结构（主词 + 副词），与 ProjectList.tsx 的 ASPECT_OPTIONS 同构。 */
const chips = (options, pressed) => options
  .map(([main, sub, value]) => `          <button type="button" class="csChoice" aria-pressed="${value === pressed}">
            <span class="csChoiceMain">${main}</span>
            <span class="csChoiceSub">${sub}</span>
          </button>`)
  .join('\n')

const FIELD_BOX_ICON = `<svg class="csSelectIcon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.6 4.1c0-.7.6-1.3 1.3-1.3h2.3c.4 0 .7.2.9.4l.9 1h6.1c.7 0 1.3.6 1.3 1.3v6.4c0 .7-.6 1.3-1.3 1.3H2.9c-.7 0-1.3-.6-1.3-1.3V4.1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>`
const FIELD_BOX_CHEV = `<svg class="csSelectChev" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6.5 8 10.5l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>`

/** 新建项目对话框（骨架与 ProjectList.tsx 的 createModalOpen 分支逐项对齐）。 */
const dialogHtml = `
    <div class="csModalBackdrop pvStaticBackdrop">
      <div class="csModal csCreateModal">
        <header class="csCreateHead">
          <div class="csCreateHeadText">
            <h2>新建项目</h2>
            <p class="csCreateSub">三项都可以留空 —— AI 会在对话里跟你确认画幅与时长。</p>
          </div>
          <button type="button" class="csCreateClose" aria-label="关闭">×</button>
        </header>
        <div class="csModalBody csCreateForm">
          <div class="csField">
            <label class="csFieldLabel" for="pvName">名称</label>
            <input id="pvName" class="csFieldInput" value="凌晨三点的门外人" placeholder="输入名称">
          </div>
          <div class="csField">
            <label class="csFieldLabel" for="pvGroup">所属分组</label>
            <div class="csSelectBox">
              ${FIELD_BOX_ICON}
              <select id="pvGroup" class="csFieldSelect">
                <option>未分组</option>
                <option>品牌宣传片</option>
                <option>实验</option>
              </select>
              ${FIELD_BOX_CHEV}
            </div>
          </div>
          <div class="csField">
            <span class="csFieldLabel" id="pvAspectLabel">画幅</span>
            <div class="csChoiceRow" role="group" aria-labelledby="pvAspectLabel">
${chips([['不锁定', 'AI 确认', ''], ['16:9', '横屏', '16:9'], ['9:16', '竖屏', '9:16'], ['1:1', '方形', '1:1']], '16:9')}
            </div>
          </div>
          <div class="csField">
            <span class="csFieldLabel" id="pvDurationLabel">目标时长</span>
            <div class="csChoiceRow" role="group" aria-labelledby="pvDurationLabel">
${chips([['不锁定', 'AI 确认', ''], ['15', '秒', '15'], ['30', '秒', '30'], ['60', '秒', '60'], ['自定义', '手填', 'custom']], '30')}
            </div>
          </div>
        </div>
        <footer class="csModalFooter">
          <button type="button" class="csModalBtnSecondary">取消</button>
          <button type="button" class="csModalBtnPrimary">创建</button>
        </footer>
      </div>
    </div>`

/** 品牌条（骨架与 LobbyHero.tsx 逐项对齐：品牌块 + 三行文字 + 动作区）。 */
const heroHtml = `
        <div class="csLobbyHero">
          <div class="csLobbyBrand">
            <span class="csLobbyMark" aria-hidden="true">◈</span>
            <div class="csLobbyBrandMeta">
              <h1 class="csLobbyTitle">Canvas Studio<span class="csLobbyNameZh">画布工场</span></h1>
              <p class="csLobbyGreet">你好，创作者，探索未至之境。</p>
              <p class="csLobbyTagline">未开拍的现场 —— 从创意到成片</p>
              <p class="csLobbyHint">选一个项目，或新建一个。</p>
            </div>
          </div>
          <div class="csLobbyActions">
            <div class="csLobbyButtons">
              <button type="button" class="csPrimary">+ 新建项目</button>
              <button type="button" class="csWelcomeSample" disabled>从示例开始</button>
            </div>
            <p class="csLobbySampleHint">示例项目含完整六段产物</p>
          </div>
        </div>`

/** 开拍前条（骨架与 SlateBar.tsx 逐项对齐：状态词 + 项目名 + 规格 + 弹性 + 胶囊）。 */
const slateHtml = `
        <section class="csSlateBar" title="待开拍项目：凌晨三点的门外人 · 16:9 · 75s · 建议 8 镜">
          <span class="csSlateTag">待开拍</span>
          <span class="csSlateName" id="pvSlateName">凌晨三点的门外人 · 导演剪辑版 · 修复重制 · 4K 杜比视界 · 第二季第十二集 · 最终定稿 v7 · 送审版 · 配音合成终版</span>
          <span class="csSlateSep" aria-hidden="true">·</span>
          <span class="csSlateSpec">16:9 · 75s</span>
          <span class="csSlateSep" aria-hidden="true">·</span>
          <span class="csSlateSpec">≈8 镜</span>
          <span class="csSlateSpacer"></span>
          <span class="csStageChip" id="pvStageChip">
            <span class="csStageChipDot" aria-hidden="true"></span>
            <span class="csStageChipLabel">成片</span>
            <span class="csStageChipProgress">6/6</span>
            <span class="csStageChipMode">确认</span>
          </span>
        </section>`

/** 三态各一帧：lobby（品牌条 + 卡）/ lobby-pending（开拍前条 + 卡）/ work 占位（只为读最深画布底）。 */
const frame = (mode, topRow) => `
      <div class="csFrame" data-mode="${mode}">
        <aside class="csProjects pvAside">项目栏（占位）</aside>
        <main class="csCanvas">
${topRow}
        </main>
        <aside class="csChat">
          <div class="pvChatInner">对话卡（宿主对话区在这张卡里）</div>
        </aside>
        <section class="csLobbyTail" ${mode === 'work' ? 'hidden' : ''}>
          <header class="csLobbyTailHead">推荐技能</header>
          <div class="pvTailBody">技能横滚（占位）</div>
        </section>
      </div>`

const html = `<!doctype html>
<html lang="zh-CN" data-cs-preset="${presetId}">
<head>
<meta charset="utf-8" />
<title>Canvas Studio · 新建对话框 + 首屏验收台（CV-182 / DD-10）</title>
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
.pvSection { margin: 0 0 26px; }
.pvSection > h2 { font-size: 13px; margin: 0 0 10px; font-weight: 600; }
/* 弹窗在真实产品里是 fixed + 遮罩居中；静态台里让它就位显示。
   只改定位，不动任何被断言的观感属性。 */
.pvStaticBackdrop {
  position: static !important;
  display: block !important;
  padding: 0 !important;
  background: transparent !important;
  inset: auto !important;
}
.pvStaticBackdrop .csModal { margin: 0; }
/* 三栏容器：给足宽度让 grid-template-columns 与卡片尺寸在真实条件下被测量。 */
.pvViewport { width: 1100px; height: 560px; margin-bottom: 18px; }
.pvAside, .pvTailBody, .pvChatInner {
  display: grid; place-items: center; font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}
/* 占位块**不能设 background** —— 画布/壳层的底色正是被断言的对象，
   本页自己设一次就等于把断言目标换成了本页样式。 */
.pvChatInner { height: 100%; }
/* 四个色板：把令牌解析成 computed color 拿来比较（令牌文本本身无法与
   background-color 直接比 —— 一边可能是 color-mix、一边是 rgb）。 */
.pvSwatches { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 10px; font-size: 11px; }
.pvSwatch { width: 90px; height: 40px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; }
.pvSwatchL1 { background-color: var(--cs-canvas-bg-l1); }
.pvSwatchCanvas { background-color: var(--cs-canvas-bg); }
.pvSwatchLayer1 { background-color: var(--dsw-alias-bg-layer-1); }
.pvSwatchShell2 { background-color: var(--cs-shell-2); }
.pvCheck { margin-top: 20px; padding: 12px 14px; font-size: 12px; line-height: 1.7;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; white-space: pre-wrap; }
#pvVerdict { display: none; }
</style>
</head>
<body>
<h1>新建对话框 + 首屏验收台</h1>
<p class="pvHint">
  样式与令牌都直接取自 <code>src/client/styles.ts</code> 与 <code>lib/brand.js</code>（非仿制）。
  断言读的是浏览器实测的 computedStyle —— 选择器锚点写错、令牌被更高特异度压过，这里会红。
</p>

<div class="pvSection">
  <h2>A · 新建项目对话框（CV-182）</h2>
${dialogHtml}
</div>

<div class="pvSection">
  <h2>B · 首屏 lobby-pending（DD-10）：品牌条同款材质的对话卡 + 中栏「开拍前条」</h2>
  <div class="pvViewport" id="pvPendingFrame">
${frame('lobby-pending', slateHtml)}
  </div>
  <h2>C · 对照：lobby 态的品牌条（材质基准，卡片应与它同底）</h2>
  <div class="pvViewport" id="pvLobbyFrame">
${frame('lobby', heroHtml)}
  </div>
  <div class="pvSwatches">
    <span class="pvSwatch pvSwatchL1" id="pvSwatchL1" title="--cs-canvas-bg-l1"></span>
    <span class="pvSwatch pvSwatchCanvas" id="pvSwatchCanvas" title="--cs-canvas-bg"></span>
    <span class="pvSwatch pvSwatchLayer1" id="pvSwatchLayer1" title="--dsw-alias-bg-layer-1"></span>
    <span class="pvSwatch pvSwatchShell2" id="pvSwatchShell2" title="--cs-shell-2"></span>
    <span>
      ① --cs-canvas-bg-l1（卡片该用它）&nbsp;
      ② --cs-canvas-bg（画布本体，必须最深）&nbsp;
      ③ 宿主 bg-layer-1（旧的白盒子底色）&nbsp;
      ④ --cs-shell-2（壳层第二档）
    </span>
  </div>
</div>

<div class="pvCheck" id="pvCheck">自检运行中…</div>
<pre id="pvVerdict"></pre>

<script>
(function () {
  'use strict'
  // 主题必须**先**落到 DOM 上，自检才读得到（自检读的是 computedStyle）。
  var params = new URLSearchParams(location.search)
  var theme = params.get('theme') === 'light' ? 'light' : 'dark'
  document.documentElement.toggleAttribute('data-light', theme === 'light')

  // 自检自身的失败也必须是一条 FAIL：未捕获异常若只留在控制台，页面会永远停在
  // 「自检运行中…」，看起来像没跑（静默失败最难查）。
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
  function cs(selector, prop, pseudo) {
    return getComputedStyle(el(selector), pseudo).getPropertyValue(prop).trim()
  }
  function num(selector, prop, pseudo) {
    return parseFloat(cs(selector, prop, pseudo))
  }

  try {
    /* ---- 令牌必须真的解析出值（「声明躺在文件里」与「页面上生效」是两件事） ---- */
    var tokenNames = [
      '--cs-line', '--cs-line-hi', '--cs-accent', '--cs-accent-soft', '--cs-canvas-bg',
      '--cs-canvas-bg-l1', '--cs-canvas-grid', '--cs-canvas-grid-major', '--cs-shell-2',
      '--cs-radius-md', '--cs-radius-pill', '--cs-fs-xs', '--cs-fs-md', '--cs-shadow-2',
    ]
    var rootStyle = getComputedStyle(document.documentElement)
    var emptyTokens = tokenNames.filter(function (name) {
      return rootStyle.getPropertyValue(name).trim() === ''
    })
    check('关键令牌在浏览器里全部可解析', emptyTokens.length === 0, emptyTokens.join(' '))

    /* ================= A. 新建项目对话框 ================= */

    /* ---- 标题栏：df8ad3b2b5 把它关成 display:none，CV-182 复归 ---- */
    check('对话框标题栏可见（display:flex）', cs('.csCreateHead', 'display') === 'flex',
      cs('.csCreateHead', 'display'))
    check('标题栏高度 > 30px（真实布局行，不是塌掉的空壳）', num('.csCreateHead', 'height') > 30,
      num('.csCreateHead', 'height') + 'px')
    check('标题栏立柱是 2px 且有色（与输入区读数带同款）',
      cs('.csCreateHead', 'width', '::before') === '2px'
      && cs('.csCreateHead', 'background-color', '::before') !== 'rgba(0, 0, 0, 0)',
      cs('.csCreateHead', 'width', '::before') + ' / ' + cs('.csCreateHead', 'background-color', '::before'))
    var headlineSize = num('.csCreateHeadText h2', 'font-size')
    var subSize = num('.csCreateSub', 'font-size')
    check('副行字号 < 标题（层级不倒挂）', subSize < headlineSize, subSize + 'px vs ' + headlineSize + 'px')
    check('副行是三级色（比标题弱一档）',
      cs('.csCreateSub', 'color') !== cs('.csCreateHeadText h2', 'color'),
      cs('.csCreateSub', 'color') + ' vs ' + cs('.csCreateHeadText h2', 'color'))

    /* ---- 关闭键：三个播放弹窗曾因同一个全局类一起失去它 ---- */
    var closeBox = el('.csCreateClose').getBoundingClientRect()
    check('关闭键 28x28 且真的占位（offsetParent 不为空、宽高 > 20）',
      Math.round(closeBox.width) === 28 && Math.round(closeBox.height) === 28
      && el('.csCreateClose').offsetParent !== null,
      Math.round(closeBox.width) + 'x' + Math.round(closeBox.height))
    check('关闭键是透明底（不与主按钮抢）', cs('.csCreateClose', 'background-color') === 'rgba(0, 0, 0, 0)',
      cs('.csCreateClose', 'background-color'))

    /* ---- 字段盒：图标 / 控件 / 箭头三段 ---- */
    check('分组下拉关掉了原生外观（appearance:none）', cs('#pvGroup', 'appearance') === 'none',
      cs('#pvGroup', 'appearance'))
    var boxRect = el('.csSelectBox').getBoundingClientRect()
    var iconRect = el('.csSelectIcon').getBoundingClientRect()
    var chevRect = el('.csSelectChev').getBoundingClientRect()
    check('字段盒内三段都在（图标在左 / 箭头在右 / 控件在中间）',
      iconRect.left < boxRect.left + 24 && chevRect.right > boxRect.right - 24
      && iconRect.left < chevRect.left,
      'icon ' + Math.round(iconRect.left) + ' / chev ' + Math.round(chevRect.right)
      + ' / box ' + Math.round(boxRect.left) + '-' + Math.round(boxRect.right))
    check('字段盒与文本输入框等高（三个字段的盒对齐）',
      Math.abs(boxRect.height - el('.csFieldInput').getBoundingClientRect().height) <= 1,
      Math.round(boxRect.height) + ' vs ' + Math.round(el('.csFieldInput').getBoundingClientRect().height))
    check('字段盒有描边（不是裸 select）', num('.csSelectBox', 'border-top-width') === 1,
      cs('.csSelectBox', 'border-top-width'))

    /* ---- chip 组：两行各 5 枚，必须一行放得下 ---- */
    var rows = document.querySelectorAll('.csChoiceRow')
    check('画幅与目标时长各是一行 chip 组（共 2 行）', rows.length === 2, String(rows.length))
    var aspectChips = rows[0].querySelectorAll('.csChoice')
    var durationChips = rows[1].querySelectorAll('.csChoice')
    check('画幅 4 枚 / 时长 5 枚（与 ProjectList.tsx 的 ASPECT_OPTIONS / DURATION_PRESETS 一致）',
      aspectChips.length === 4 && durationChips.length === 5,
      aspectChips.length + ' / ' + durationChips.length)

    var rowRect = rows[1].getBoundingClientRect()
    var rowGap = parseFloat(cs('.csChoiceRow', 'column-gap'))
    var tops = Array.prototype.map.call(durationChips, function (c) { return Math.round(c.getBoundingClientRect().top) })
    var oneLine = tops.every(function (t) { return t === tops[0] })
    check('5 枚 chip 在同一行（没有换行把 chip 组拆散）', oneLine, tops.join(','))
    var widths = Array.prototype.map.call(durationChips, function (c) { return c.getBoundingClientRect().width })
    var minW = Math.min.apply(null, widths)
    var maxW = Math.max.apply(null, widths)
    check('5 枚 chip 等宽（flex:1 1 0 生效）', maxW - minW <= 1,
      Math.round(minW) + '-' + Math.round(maxW) + 'px')
    check('每枚 chip 宽度 >= 72px（再窄副词会被压到换行）', minW >= 72, Math.round(minW) + 'px')
    check('chip 行占满字段宽度（不居中留白）',
      Math.abs(maxW * 5 + rowGap * 4 - rowRect.width) <= 2,
      Math.round(maxW * 5 + rowGap * 4) + ' vs ' + Math.round(rowRect.width) + '（gap ' + rowGap + '）')

    var pressedChip = rows[1].querySelector(".csChoice[aria-pressed='true']")
    var idleChip = rows[1].querySelector(".csChoice[aria-pressed='false']")
    check("选中态读 aria-pressed 而不是自定义类（页内真的有一枚 pressed）", pressedChip !== null,
      pressedChip === null ? '一枚都没有' : pressedChip.textContent.trim())
    check('选中 chip 的描边 = accent（与未选不同色）',
      getComputedStyle(pressedChip).borderTopColor !== getComputedStyle(idleChip).borderTopColor,
      getComputedStyle(pressedChip).borderTopColor + ' vs ' + getComputedStyle(idleChip).borderTopColor)
    check('选中 chip 的底色 ≠ 未选（不是只描边变了一下）',
      getComputedStyle(pressedChip).backgroundColor !== getComputedStyle(idleChip).backgroundColor,
      getComputedStyle(pressedChip).backgroundColor + ' vs ' + getComputedStyle(idleChip).backgroundColor)
    check('chip 主词是等宽数字（15/30/60 横比不跳）',
      cs('.csChoiceMain', 'font-variant-numeric').indexOf('tabular-nums') >= 0,
      cs('.csChoiceMain', 'font-variant-numeric'))

    /* ---- 作用域：字段材料收敛在 csCreateForm 之下（不下沉到共享的 .csField*） ---- */
    var labelSize = num('.csCreateForm .csFieldLabel', 'font-size')
    var inputSize = num('.csCreateForm .csFieldInput', 'font-size')
    check('字段标签 < 字段值（层级不倒挂）', labelSize < inputSize, labelSize + 'px vs ' + inputSize + 'px')
    check('表单字段间距 18px（比其它弹窗松一档）', cs('.csCreateForm', 'row-gap') === '18px',
      cs('.csCreateForm', 'row-gap'))
    check('主按钮是实底 accent（这张表的落点）',
      cs('.csModalBtnPrimary', 'background-color') !== 'rgba(0, 0, 0, 0)',
      cs('.csModalBtnPrimary', 'background-color'))
    var footerBg = cs('.csModalFooter', 'background-color')
    check('底部操作区底色 = 壳层第二档（与正文分开，不只是靠那根分隔线）',
      footerBg === cs('#pvSwatchShell2', 'background-color'),
      footerBg + ' vs 壳层二档 ' + cs('#pvSwatchShell2', 'background-color'))

    /* ================= B. 首屏：卡片材质必须与品牌条一致 ================= */

    var pendingChat = cs('.csFrame[data-mode="lobby-pending"] .csChat', 'background-color')
    var lobbyChat = cs('.csFrame[data-mode="lobby"] .csChat', 'background-color')
    var heroBg = cs('.csFrame[data-mode="lobby"] .csLobbyHero', 'background-color')
    var slateBg = cs('.csSlateBar', 'background-color')
    var l1 = cs('#pvSwatchL1', 'background-color')
    var deepest = cs('#pvSwatchCanvas', 'background-color')
    var hostLayer1 = cs('#pvSwatchLayer1', 'background-color')

    check('两态的对话卡同底（lobby == lobby-pending）', pendingChat === lobbyChat,
      pendingChat + ' vs ' + lobbyChat)
    check('对话卡底色 == 品牌条底色（这就是「跟正式画布和谐」那条）', lobbyChat === heroBg,
      lobbyChat + ' vs ' + heroBg)
    check('对话卡不再是白盒子（≠ 宿主 bg-layer-1）', lobbyChat !== hostLayer1,
      lobbyChat + ' vs 宿主 layer-1 ' + hostLayer1)
    check('对话卡底色 = --cs-canvas-bg-l1（画布内容面那一档）', lobbyChat === l1,
      lobbyChat + ' vs ' + l1)
    check('对话卡底色 ≠ --cs-canvas-bg（画布本体必须是最深一档）', lobbyChat !== deepest,
      lobbyChat + ' vs ' + deepest)
    check('开拍前条与品牌条同底（中栏顶部两态连续）', slateBg === heroBg, slateBg + ' vs ' + heroBg)

    var chatSize = cs('.csFrame[data-mode="lobby-pending"] .csChat', 'background-size')
    check('点阵尺寸与画布同参数（100% 100%, 120px 120px, 24px 24px）',
      chatSize === '100% 100%, 120px 120px, 24px 24px', chatSize)
    var chatImage = cs('.csFrame[data-mode="lobby-pending"] .csChat', 'background-image')
    check('光晕 + 双层点阵三张图都在（缺一层就是材质残了）',
      (chatImage.match(/radial-gradient/g) || []).length === 3,
      String((chatImage.match(/radial-gradient/g) || []).length) + ' 张')
    check('卡片描边 = 开拍前条的描边（两处都走 --cs-line，不是宿主 border 令牌）',
      cs('.csFrame[data-mode="lobby-pending"] .csChat', 'border-top-color') === cs('.csSlateBar', 'border-bottom-color')
      && num('.csFrame[data-mode="lobby-pending"] .csChat', 'border-top-width') === 1,
      cs('.csFrame[data-mode="lobby-pending"] .csChat', 'border-top-color') + ' vs '
      + cs('.csSlateBar', 'border-bottom-color'))
    check('卡片有浮起投影（浅色下与壳同白，靠它区分）',
      cs('.csFrame[data-mode="lobby-pending"] .csChat', 'box-shadow') !== 'none',
      cs('.csFrame[data-mode="lobby-pending"] .csChat', 'box-shadow'))

    /* ================= C. 开拍前条 ================= */

    check('开拍前条嵌在 .csCanvas 里（中栏第一行那一格）',
      el('.csSlateBar').closest('.csCanvas') !== null)
    var slateRect = el('.csSlateBar').getBoundingClientRect()
    var chatRect = el('.csFrame[data-mode="lobby-pending"] .csChat').getBoundingClientRect()
    check('开拍前条在对话卡之上且留出间隙（不许压住上一行）',
      chatRect.top - slateRect.bottom >= 8,
      'bar bottom ' + Math.round(slateRect.bottom) + ' → card top ' + Math.round(chatRect.top))
    check('开拍前条高度 > 24px（真实读数带，不是塌陷的空条）', num('.csSlateBar', 'height') > 24,
      num('.csSlateBar', 'height') + 'px')
    check('开拍前条不可拖选（纯读数带）', cs('.csSlateBar', 'user-select') === 'none',
      cs('.csSlateBar', 'user-select'))
    check('状态词是小圆胶囊（border-radius 999px）', cs('.csSlateTag', 'border-radius') === '999px',
      cs('.csSlateTag', 'border-radius'))
    check('状态词有底色（accent-soft 生效，不是裸文字）',
      cs('.csSlateTag', 'background-color') !== 'rgba(0, 0, 0, 0)', cs('.csSlateTag', 'background-color'))
    check('项目名比规格强一档（一级色 vs 三级色）',
      cs('.csSlateName', 'color') !== cs('.csSlateSpec', 'color'),
      cs('.csSlateName', 'color') + ' vs ' + cs('.csSlateSpec', 'color'))
    check('项目名可省略（min-width:0 生效，scrollWidth > clientWidth + ellipsis）',
      el('.csSlateName').scrollWidth > el('.csSlateName').clientWidth
      && cs('.csSlateName', 'text-overflow') === 'ellipsis',
      el('.csSlateName').scrollWidth + ' > ' + el('.csSlateName').clientWidth)
    check('规格是等宽数字（换项目/时长时数位不跳）',
      cs('.csSlateSpec', 'font-variant-numeric').indexOf('tabular-nums') >= 0,
      cs('.csSlateSpec', 'font-variant-numeric'))
    check('弹性占位把胶囊推到右端（flex-grow=1）', cs('.csSlateSpacer', 'flex-grow') === '1',
      cs('.csSlateSpacer', 'flex-grow'))
    var barRect = el('.csSlateBar').getBoundingClientRect()
    var chipRect = el('#pvStageChip').getBoundingClientRect()
    check('阶段胶囊落在右半区（左「我是谁/锁了什么」右「走到哪一步」）',
      chipRect.right > barRect.left + barRect.width * 0.75,
      Math.round(chipRect.right) + ' / bar ' + Math.round(barRect.left) + '-' + Math.round(barRect.right))

    /* ---- 主题敏感：两轨下都必须可读（DD-03 的 --cs-glow-accent 曾在浅色下整条缺失） ---- */
    var dark = theme !== 'light'
    if (dark) {
      check('暗色：正文色比底色亮（可读）',
        cs('.csSlateBar', 'color') !== slateBg, cs('.csSlateBar', 'color') + ' vs ' + slateBg)
    } else {
      check('浅色：卡片底色比宿主 layer-1 不更暗（浅色下不能变成黑板）',
        l1 !== deepest, l1 + ' vs ' + deepest)
      check('浅色：状态词底色不是深色块（亮纱而不是黑板）',
        getComputedStyle(el('.csSlateTag')).backgroundColor !== 'rgba(0, 0, 0, 0)',
        cs('.csSlateTag', 'background-color'))
    }
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
