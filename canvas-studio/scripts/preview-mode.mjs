/**
 * CV-196 验收台：**执行模式开关的两套外观** + **切到放手跑的确认弹窗**。
 *
 * ## 为什么值得单开一组
 *
 * 这一批把「逐步确认 / 放手跑」从一个内联在 `StudioFrame` 里的 JSX 片段抽成了
 * `ModeSwitch`（两处外观共用一份判定与文案），并新造了一个 `ConfirmDialog`。
 * 两类风险都只有真机跑才看得见：
 *
 * 1. **两套外观的行为是不是真的一致**。`bar` 用 `.csActive` 类、`choice` 用
 *    `aria-pressed` 属性 —— 两种机制分头写的，抽成一个组件正是为了让它们不能分叉；
 *    但「组件抽对了」与「两处渲染出来都真的选中了」是两件事。
 * 2. **新弹窗的宽度是不是真的收窄了**。`.csConfirmModal { width: min(400px,100%) }`
 *    与 `.csModal { width: min(440px,100%) }` **特异度相同**，只有**顺序**决定谁赢。
 *    这类「规则写了但被压过」的失效，静态检查永远全绿。
 *
 * ## 页内自带三处对照（本仓规矩：新守卫必须能红）
 *
 * - **A 组第三帧**：两枚按钮**都不带** `.csActive`。断言「激活态底色 ≠ 未激活」如果
 *   连这一帧也判成不等，就说明它判的不是那个类（而是按钮位置 / 天生有色），必须红。
 * - **C 组对照弹窗**：一个不带 `.csConfirmModal` 的常规弹窗。「确认弹窗更窄 / 正文更紧」
 *   两条断言在它身上必须**不成立** —— 否则那两条只是恒真。
 * - **B 组两帧**：分别选中 confirm 与 auto。选中态若写死在第一枚上（而不是读
 *   `aria-pressed`），第二帧会红。
 *
 * ## 为什么**不**调用 `tokenProbe()`
 *
 * 那一族的收尾钩子自带一个 `<pre id="pvVerdict">` 并会覆盖本页的判决
 * （`getElementById` 拿到先出现的那个）。本仓自定义自检的台子（preview-rail /
 * preview-chat / preview-create / preview-detail）一律不调它。
 *
 * 用法：node scripts/preview-mode.mjs [输出路径]
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
const outPath = process.argv[2] ?? join(outDir, 'mode-switch-preview.html')
await mkdir(outDir, { recursive: true })

// 与其它预览同一套取法：样式取 styles.ts 原文、令牌取 brand.ts 产物。
const studioStyles = await readStudioStyles()
const brandCss = await brandTokensCss()
const presetId = await defaultPresetId()
await reportTokenCoverage('preview-mode', brandCss, HOST_TOKENS_DARK)

const hostCss = `:root {\n${renderTokenBlock(HOST_TOKENS_DARK)}\n}\nhtml[data-light] {\n${renderTokenBlock(HOST_TOKENS_LIGHT)}\n}`

/* ---------------------------------------------------------------- DOM 片段 */

/** chip 组的两行结构（与 ModeSwitch.tsx 的 variant="choice" 同构）。 */
const chips = (options, pressed) => options
  .map(([main, sub, value]) => `            <button type="button" class="csChoice" aria-pressed="${value === pressed}">
              <span class="csChoiceMain">${main}</span>
              <span class="csChoiceSub">${sub}</span>
            </button>`)
  .join('\n')

/**
 * 画布顶部模式分段（骨架与 ModeSwitch.tsx 的 variant="bar" 逐项对齐）。
 * `active` 传 null 时两枚都不带 `.csActive` —— 这是 A 组的**对照帧**。
 */
const barHtml = (active) => `
        <div class="csWorkflowBar pvBarFrame">
          <div class="csWorkflowMode" role="group" aria-label="执行模式">
            <button type="button" class="${active === 'confirm' ? 'csActive' : ''}" ${active === 'confirm' ? 'disabled' : ''}>逐步确认</button>
            <button type="button" class="${active === 'auto' ? 'csActive' : ''}" ${active === 'auto' ? 'disabled' : ''}>放手跑</button>
          </div>
        </div>`

/**
 * S 组：**收缩探针**。真实上下文里挤扁模式组的不是别的，正是同一行里
 * 带 `margin-left:auto` 的 `.csWorkflowApproval`（见 styles.ts:344）。
 * 这里就用真结构 + 一个 240px 窄条复现：正常帧不许收缩，对照帧给模式组
 * 强行加 `.pvShrinkOverride { flex: 1 1 auto }` —— 那一帧**必须**被挤窄，
 * 否则「不收缩」这条断言只是恒真。
 *
 * 注：`.csWorkflowMode button` 是 `white-space: nowrap`，所以被挤扁的表现是
 * **宽度变窄 / 文字被 overflow:hidden 裁掉**，不是折行 —— 判据按宽度量。
 */
const squeezeRowHtml = (shrinkable) => `
        <div class="csWorkflowBar pvSqueezeRow">
          <div class="csWorkflowMode${shrinkable ? ' pvShrinkOverride' : ''}" role="group" aria-label="执行模式">
            <button type="button" class="csActive" disabled>逐步确认</button>
            <button type="button">放手跑</button>
          </div>
          <div class="csWorkflowApproval"><div class="pvEater"></div></div>
        </div>`

/** 新建弹窗里的 chip 版（骨架与 ModeSwitch.tsx 的 variant="choice" 逐项对齐）。 */
const chipFrameHtml = (mode) => `
        <div class="csField pvChipFrame">
          <div class="csChoiceRow" role="group" aria-label="执行模式">
${chips([['逐步确认', '每步确认', 'confirm'], ['放手跑', '一路到成片', 'auto']], mode)}
          </div>
        </div>`

const CONFIRM_BODY = `<p>放手跑下 AI 不再向你提问：剧本、分镜、关键帧都不再等你确认，澄清问题也直接按默认规格取值。</p>
            <p>它会一路做到成片，中途不停。已产出的内容不会被删，但这个过程可能持续十几分钟。</p>`

/** 真实确认弹窗（骨架与 ConfirmDialog.tsx 逐项对齐）。 */
const confirmHtml = `
        <div class="csModalBackdrop pvStaticBackdrop">
          <div class="csModal csConfirmModal" id="pvConfirmCard">
            <header class="csModalHeader">
              <div class="csModalHeaderText"><h2>切到放手跑？</h2></div>
            </header>
            <div class="csModalBody csConfirmBody" id="pvConfirmBody">${CONFIRM_BODY}</div>
            <footer class="csModalFooter">
              <button type="button" class="csModalBtnSecondary" id="pvConfirmCancel" autofocus>取消</button>
              <button type="button" class="csModalBtnPrimary" id="pvConfirmOk">切到放手跑</button>
            </footer>
          </div>
        </div>`

/**
 * 对照：**不带** `.csConfirmModal` 的常规弹窗。
 * C 组的「更窄 / 正文更紧」两条必须在它身上不成立。
 */
const plainModalHtml = `
        <div class="csModalBackdrop pvStaticBackdrop">
          <div class="csModal" id="pvPlainCard">
            <header class="csModalHeader">
              <div class="csModalHeaderText"><h2>常规弹窗（对照）</h2></div>
            </header>
            <div class="csModalBody" id="pvPlainBody">${CONFIRM_BODY}</div>
            <footer class="csModalFooter">
              <button type="button" class="csModalBtnSecondary">取消</button>
              <button type="button" class="csModalBtnPrimary">确定</button>
            </footer>
          </div>
        </div>`

const html = `<!doctype html>
<html lang="zh-CN" data-cs-preset="${presetId}">
<head>
<meta charset="utf-8" />
<title>Canvas Studio · 执行模式开关 + 确认弹窗验收台（CV-196）</title>
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
.pvRow { display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start; }
.pvCell { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.pvCell > b { display: block; font-weight: 600; margin-bottom: 6px; color: var(--dsw-alias-label-secondary); }
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
.pvChipFrame { width: 380px; }
/* chip 版的两个字段要放得下：给足宽度让 flex:1 1 0 在真实条件下被测量。 */
.pvBarFrame { width: 420px; }
/* 色板：把令牌解析成 computed color（令牌文本可能与 background-color 不可直接比）。 */
.pvSwatchAccent { display: inline-block; width: 64px; height: 18px; border-radius: 4px;
  border: 1px solid var(--dsw-alias-border-l2); background-color: var(--cs-accent); vertical-align: middle; }
/* S 组：窄条 + 真实挤占者。对照帧的 override 只改 flex（唯一的被断言属性），
   写在 studioStyles 之后靠源码顺序取胜，与产品侧同规则冲突同机制。
   .pvEater 是**刚性**占位（flex 0 0 150px，盒内没有可换行的文字），
   保证「挤压力真的存在」不依赖文字换行这种模棱两可的东西。 */
.pvSqueezeRow { width: 240px; }
.pvSqueezeRow .csWorkflowApproval { padding: 5px 10px 5px 12px; }
.pvEater { flex: 0 0 150px; height: 18px; border-radius: 3px; background: var(--dsw-alias-fill-tertiary, rgba(127,127,127,.2)); }
.pvShrinkOverride { flex: 1 1 auto; }
.pvCheck { margin-top: 20px; padding: 12px 14px; font-size: 12px; line-height: 1.7;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; white-space: pre-wrap; }
#pvVerdict { display: none; }
</style>
</head>
<body>
<h1>执行模式开关 + 确认弹窗验收台</h1>
<p class="pvHint">
  样式取自 <code>src/client/styles.ts</code> 原文（非仿制）。A/B/C 三组各带一处**对照**，
  对照帧必须让对应断言不成立 —— 否则说明那条断言恒真。accent 参考色板
  <span class="pvSwatchAccent" id="pvSwatchAccent" title="--cs-accent"></span>
</p>

<div class="pvSection">
  <h2>A · 画布顶部 bar 分段（ModeSwitch variant="bar"）：激活在左 / 激活在右 / 对照（都无 csActive）</h2>
  <div class="pvRow">
    <div class="pvCell"><b>① 逐步确认激活</b>${barHtml('confirm')}</div>
    <div class="pvCell"><b>② 放手跑激活</b>${barHtml('auto')}</div>
    <div class="pvCell"><b>③ 对照：都不带 csActive</b>${barHtml(null)}</div>
  </div>
</div>

<div class="pvSection">
  <h2>S · 窄条下的收缩行为：正常（不许收缩）/ 对照（强行可收缩，必须被挤窄）</h2>
  <div class="pvRow">
    <div class="pvCell" id="pvSqueezeNormal"><b>① 正常：flex 0 0 auto</b>${squeezeRowHtml(false)}</div>
    <div class="pvCell" id="pvSqueezeShrunk"><b>② 对照：flex 1 1 auto</b>${squeezeRowHtml(true)}</div>
  </div>
</div>

<div class="pvSection">
  <h2>B · 新建弹窗里的 chip 版（ModeSwitch variant="choice"）：两帧各选一枚</h2>
  <div class="pvRow">
    <div class="pvCell" id="pvChipConfirm"><b>① 逐步确认选中</b>${chipFrameHtml('confirm')}</div>
    <div class="pvCell" id="pvChipAuto"><b>② 放手跑选中</b>${chipFrameHtml('auto')}</div>
  </div>
</div>

<div class="pvSection">
  <h2>C · 确认弹窗（ConfirmDialog）：真实弹窗 vs 对照用的常规弹窗</h2>
  <div class="pvRow">
    <div class="pvCell"><b>① 切到放手跑的确认（csConfirmModal）</b>${confirmHtml}</div>
    <div class="pvCell"><b>② 对照：常规弹窗（无 csConfirmModal）</b>${plainModalHtml}</div>
  </div>
</div>

<div class="pvCheck" id="pvCheck">自检运行中…</div>
<pre id="pvVerdict"></pre>

<script>
(function () {
  'use strict'
  // 主题必须**先**落到 DOM 上，自检才读得到（读的是 computedStyle）。
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
  function cs(selector, prop, pseudo) {
    return getComputedStyle(el(selector), pseudo).getPropertyValue(prop).trim()
  }
  function num(selector, prop) {
    return parseFloat(cs(selector, prop))
  }
  var TRANSPARENT = 'rgba(0, 0, 0, 0)'

  try {
    /* ---- 令牌先得真的解析出值（「声明躺在文件里」与「页面上生效」是两件事） ---- */
    var tokenNames = [
      '--cs-accent', '--cs-line', '--cs-line-hi', '--cs-shell-2', '--cs-radius-md',
      '--cs-fs-md', '--cs-space-2',
    ]
    var rootStyle = getComputedStyle(document.documentElement)
    var emptyTokens = tokenNames.filter(function (name) {
      return rootStyle.getPropertyValue(name).trim() === ''
    })
    check('关键令牌在浏览器里全部可解析', emptyTokens.length === 0, emptyTokens.join(' '))

    /* ================= A. bar 分段 ================= */

    var bars = document.querySelectorAll('.csWorkflowBar:not(.pvSqueezeRow)')
    check('A 组三帧都在（激活在左 / 激活在右 / 对照）', bars.length === 3, String(bars.length))
    var buttonsOfFrame = function (index) { return bars[index].querySelectorAll('.csWorkflowMode button') }
    check('每帧都是两枚按钮（逐步确认 / 放手跑 —— 与 ModeSwitch 的 MODES 一致）',
      Array.prototype.every.call(bars, function (bar) {
        return bar.querySelectorAll('.csWorkflowMode button').length === 2
      }),
      Array.prototype.map.call(bars, function (bar) {
        return bar.querySelectorAll('.csWorkflowMode button').length
      }).join(','))

    // 帧①：第一枚激活
    var activeLeft = buttonsOfFrame(0)[0]
    var idleLeft = buttonsOfFrame(0)[1]
    check('帧①：激活的是第一枚（逐步确认），且带 csActive',
      activeLeft.classList.contains('csActive') && !idleLeft.classList.contains('csActive'),
      activeLeft.textContent.trim() + ' / ' + idleLeft.textContent.trim())
    check('帧①：激活态底色 = 壳层第三档（不是透明 —— 透明就等于没选中）',
      getComputedStyle(activeLeft).backgroundColor !== TRANSPARENT,
      getComputedStyle(activeLeft).backgroundColor)
    check('帧①：未激活那枚是透明底（只有激活项有底）',
      getComputedStyle(idleLeft).backgroundColor === TRANSPARENT,
      getComputedStyle(idleLeft).backgroundColor)
    check('帧①：激活那枚字色更亮（label-primary ≠ label-secondary）',
      getComputedStyle(activeLeft).color !== getComputedStyle(idleLeft).color,
      getComputedStyle(activeLeft).color + ' vs ' + getComputedStyle(idleLeft).color)
    check('帧①：激活那枚禁用（当前项点了没有动作，禁用比「点了没反应」诚实）',
      activeLeft.disabled === true && idleLeft.disabled === false,
      activeLeft.disabled + ' / ' + idleLeft.disabled)

    // 帧②：第二枚激活 —— 证明「激活」不是写死在位置上
    var idleRight = buttonsOfFrame(1)[0]
    var activeRight = buttonsOfFrame(1)[1]
    check('帧②：激活的是第二枚（放手跑）—— 激活态跟着状态走，不是写死在第一枚',
      !idleRight.classList.contains('csActive') && activeRight.classList.contains('csActive'),
      idleRight.textContent.trim() + ' / ' + activeRight.textContent.trim())
    check('帧②：第二枚有底、第一枚透明（与帧①正好相反）',
      getComputedStyle(activeRight).backgroundColor !== TRANSPARENT
      && getComputedStyle(idleRight).backgroundColor === TRANSPARENT,
      getComputedStyle(activeRight).backgroundColor + ' / ' + getComputedStyle(idleRight).backgroundColor)

    /* ---- 对照帧：两枚都不带 csActive。上面三条「底色不同」的判据必须在这里失败 ---- */
    var controlA = buttonsOfFrame(2)[0]
    var controlB = buttonsOfFrame(2)[1]
    check('反向对照：都不带 csActive 时两枚底色必须相同 —— 证明上面判的是那个类，而不是按钮天生有色',
      getComputedStyle(controlA).backgroundColor === getComputedStyle(controlB).backgroundColor
      && getComputedStyle(controlA).backgroundColor === TRANSPARENT,
      getComputedStyle(controlA).backgroundColor + ' vs ' + getComputedStyle(controlB).backgroundColor)

    // 分段整体几何（既有实现，本次只是换了个渲染入口，不能被改坏）
    //
    // display 这里不能断言 inline-flex：模式组是 .csWorkflowBar（display:flex）
    // 的 flex 子项，按 CSS Display 规范子项会被 blockify，computed 值就是 flex。
    // 想验的是「它自己是个不折行的 flex 容器」，故接受 blockify 后的 flex。
    // 「不参与收缩」也不按 shorthand flex 的 computed 字符串判（各内核序列化不一致），
    // 改为读三条 longhand + S 组量真实宽度。
    var modeDisplay = cs('.csWorkflowMode', 'display')
    check('分段是个不折行的 flex 容器（blockify 后 display 为 flex / inline-flex）',
      (modeDisplay === 'flex' || modeDisplay === 'inline-flex') && cs('.csWorkflowMode button', 'white-space') === 'nowrap',
      modeDisplay + ' / ' + cs('.csWorkflowMode button', 'white-space'))
    check('分段声明 flex:0 0 auto（三条 longhand 齐全 —— 0 0 auto）',
      cs('.csWorkflowMode', 'flex-grow') === '0'
      && cs('.csWorkflowMode', 'flex-shrink') === '0'
      && cs('.csWorkflowMode', 'flex-basis') === 'auto',
      cs('.csWorkflowMode', 'flex-grow') + ' ' + cs('.csWorkflowMode', 'flex-shrink') + ' ' + cs('.csWorkflowMode', 'flex-basis'))
    check('分段有 1px 描边 + 圆角 + 裁剪（按钮贴边不留缝）',
      num('.csWorkflowMode', 'border-top-width') === 1
      && parseFloat(cs('.csWorkflowMode', 'border-top-left-radius')) > 0
      && cs('.csWorkflowMode', 'overflow') === 'hidden',
      cs('.csWorkflowMode', 'border-top-width') + ' / ' + cs('.csWorkflowMode', 'overflow'))
    var boxA = buttonsOfFrame(0)[0].getBoundingClientRect()
    var boxB = buttonsOfFrame(0)[1].getBoundingClientRect()
    check('两枚按钮等高（同一行，没有一枚被文字挤成两行）',
      Math.abs(boxA.height - boxB.height) <= 1 && boxA.height > 14,
      Math.round(boxA.height) + ' vs ' + Math.round(boxB.height))
    check('两枚按钮之间有分隔线（button + button 的左描边）',
      num('.csWorkflowMode button + button', 'border-left-width') === 1,
      cs('.csWorkflowMode button + button', 'border-left-width'))

    /* ===== S. 窄条下真的不收缩（上面那条 longhand 断言只证明「声明在」，这里证明「生效」）===== */
    var squeezeFrames = document.querySelectorAll('.csWorkflowBar.pvSqueezeRow')
    check('S 组两帧都在（正常 / 对照）', squeezeFrames.length === 2, String(squeezeFrames.length))
    var modeNormal = squeezeFrames[0].querySelector('.csWorkflowMode')
    var modeShrunk = squeezeFrames[1].querySelector('.csWorkflowMode')
    var widthNormal = modeNormal.getBoundingClientRect().width
    var widthShrunk = modeShrunk.getBoundingClientRect().width
    var btnNormal = squeezeFrames[0].querySelectorAll('button')[0].getBoundingClientRect()

    // 正常帧：模式组不被挤扁 —— 宽度不小于内容所需宽度
    var barNormal = squeezeFrames[0]
    check('S 组场景确实是过约束的（窄条被撑溢出）—— 否则「不收缩」只是没压力可缩',
      barNormal.scrollWidth > barNormal.clientWidth,
      'scrollWidth ' + barNormal.scrollWidth + ' vs clientWidth ' + barNormal.clientWidth)
    check('窄条 + 刚性挤占者（margin-left:auto 的审批块）下，模式组宽度不被压缩',
      widthNormal >= modeNormal.scrollWidth - 1 && Math.abs(btnNormal.height - boxA.height) <= 1,
      Math.round(widthNormal) + ' vs scrollWidth ' + modeNormal.scrollWidth
      + ' / 按钮高 ' + Math.round(btnNormal.height) + ' vs 宽条 ' + Math.round(boxA.height))

    // 对照帧：把 flex 换成 1 1 auto 后必须真的被挤窄 —— 证明上面那条不是恒真
    check('反向对照：对照帧改成 flex:1 1 auto 后确实被挤窄（差值 > 4px）—— 证明上面那条判得出收缩',
      widthShrunk < widthNormal - 4,
      Math.round(widthNormal) + ' → ' + Math.round(widthShrunk))

    /* ================= B. chip 版 ================= */

    var confirmFrame = el('#pvChipConfirm .csChoiceRow')
    var autoFrame = el('#pvChipAuto .csChoiceRow')
    var pressed1 = confirmFrame.querySelector(".csChoice[aria-pressed='true']")
    var pressed2 = autoFrame.querySelector(".csChoice[aria-pressed='true']")
    check('两帧都各只有一枚 pressed（两枚按钮里必有一枚在用）',
      pressed1 !== null && pressed2 !== null
      && confirmFrame.querySelectorAll(".csChoice[aria-pressed='true']").length === 1
      && autoFrame.querySelectorAll(".csChoice[aria-pressed='true']").length === 1,
      (pressed1 ? pressed1.textContent.trim() : '无') + ' / ' + (pressed2 ? pressed2.textContent.trim() : '无'))
    check('两帧选中的不是同一枚 —— 选中态读 aria-pressed 而不是写死在第一枚',
      pressed1.textContent !== pressed2.textContent,
      pressed1.textContent.trim() + ' vs ' + pressed2.textContent.trim())

    var accentColor = cs('#pvSwatchAccent', 'background-color')
    var chipIdle = confirmFrame.querySelector(".csChoice[aria-pressed='false']")
    check('选中 chip 的描边 = --cs-accent（与色板逐字节相同）',
      getComputedStyle(pressed1).borderTopColor === accentColor,
      getComputedStyle(pressed1).borderTopColor + ' vs ' + accentColor)
    check('未选 chip 的描边 ≠ accent（否则「选中」没有视觉落点）',
      getComputedStyle(chipIdle).borderTopColor !== accentColor,
      getComputedStyle(chipIdle).borderTopColor)
    check('两帧的 chip 等宽（flex:1 1 0 生效，切换选中不引起重排）',
      Math.abs(confirmFrame.querySelectorAll('.csChoice')[0].getBoundingClientRect().width
        - autoFrame.querySelectorAll('.csChoice')[0].getBoundingClientRect().width) <= 1,
      Math.round(confirmFrame.querySelectorAll('.csChoice')[0].getBoundingClientRect().width)
      + ' vs ' + Math.round(autoFrame.querySelectorAll('.csChoice')[0].getBoundingClientRect().width))

    /* ================= C. 确认弹窗 ================= */

    var confirmCard = el('#pvConfirmCard')
    var plainCard = el('#pvPlainCard')
    var confirmWidth = confirmCard.getBoundingClientRect().width
    var plainWidth = plainCard.getBoundingClientRect().width
    check('确认弹窗宽 400px（三条决策的窄版）', Math.round(confirmWidth) === 400, Math.round(confirmWidth) + 'px')
    check('确认弹窗比常规弹窗窄 —— 证明 .csConfirmModal 的 width 真的生效（两者特异度相同，只有顺序决定谁赢）',
      confirmWidth < plainWidth,
      Math.round(confirmWidth) + 'px vs ' + Math.round(plainWidth) + 'px')
    check('对照弹窗用的是常规宽度 440px（否则上一条的分辨力无处可来）',
      Math.round(plainWidth) === 440, Math.round(plainWidth) + 'px')

    var confirmGap = parseFloat(cs('#pvConfirmBody', 'row-gap'))
    var plainGap = parseFloat(cs('#pvPlainBody', 'row-gap'))
    check('确认弹窗正文更紧（10px < 常规 18px）—— 两段话是同一件事的连续陈述',
      confirmGap === 10 && plainGap === 18, confirmGap + 'px vs ' + plainGap + 'px')

    var cancelBox = el('#pvConfirmCancel').getBoundingClientRect()
    var okBox = el('#pvConfirmOk').getBoundingClientRect()
    check('取消键在确认键左边（安全的一侧在顺手位，回车误触不会直接确认）',
      cancelBox.left < okBox.left,
      Math.round(cancelBox.left) + ' / ' + Math.round(okBox.left))
    check('取消键是次要样式（透明底），确认键是实底',
      getComputedStyle(el('#pvConfirmCancel')).backgroundColor === TRANSPARENT
      && getComputedStyle(el('#pvConfirmOk')).backgroundColor !== TRANSPARENT,
      getComputedStyle(el('#pvConfirmCancel')).backgroundColor + ' / ' + getComputedStyle(el('#pvConfirmOk')).backgroundColor)
    check('确认键走 accent 而不是红 —— 切放手跑不是破坏性动作，红色会误导成「删除」',
      getComputedStyle(el('#pvConfirmOk')).backgroundColor === accentColor,
      getComputedStyle(el('#pvConfirmOk')).backgroundColor + ' vs ' + accentColor)
    check('确认弹窗标题是主字色（不是弱化过的三级色）',
      cs('#pvConfirmCard .csModalHeaderText h2', 'color') === cs('body', 'color'),
      cs('#pvConfirmCard .csModalHeaderText h2', 'color') + ' vs ' + cs('body', 'color'))

    /* ---- 主题分轨：明暗两轨下「实底 vs 透明」的判定不同，各说一句 ---- */
    if (theme === 'light') {
      check('浅色：激活态分段底色不是深色块（读得出是「按下了」而不是「反色」）',
        getComputedStyle(activeLeft).backgroundColor !== getComputedStyle(el('#pvConfirmOk')).backgroundColor,
        getComputedStyle(activeLeft).backgroundColor)
    } else {
      check('暗色：激活态分段底色比壳层底亮（暗色下靠提亮表达选中）',
        getComputedStyle(activeLeft).backgroundColor !== cs('.csWorkflowBar', 'background-color'),
        getComputedStyle(activeLeft).backgroundColor + ' vs 条底 ' + cs('.csWorkflowBar', 'background-color'))
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
