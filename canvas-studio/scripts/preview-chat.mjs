/**
 * 右栏（对话区）整栏验收台（DD-09 / b 可收起 + c 会话头 chip + d 输入区读数带）。
 *
 * ## 为什么需要它
 *
 * `preview-rail.mjs` 覆盖了左栏的三个子块，右栏此前一个都没有。而本批要验的
 * 恰恰是**栅格**：第三列 320~480px ⇄ 56px 的切换、以及两栏同时收起时的组合。
 *
 * ## 它是什么
 *
 * 与 preview-rail.mjs 同一约定：CSS 取 `src/client/styles.ts` 里**产品正在用的
 * 那一份** STUDIO_STYLES，令牌取 `lib/brand.js` 的 `brandCssText()`（真实色值，
 * 不是仿制），再摆一份与 StudioFrame.tsx **同构**的骨架 DOM。页内自带明暗切换与
 * computedStyle 自检，自检结果同时写进页面自检卡和 `#pvVerdict`（后者供
 * `scripts/verify-previews.mjs` 无头读取）。
 *
 * ## 它不是什么
 *
 * - **不覆盖接线**：这里的 `data-chat` 是我自己挂的。R8 出过一次事故 —— styles.ts
 *   的分支写好了、页面上也测通，但 StudioFrame 压根没把 `data-rail` 挂到 DOM 上，
 *   收起后仍是 280px。**CSS 断言只能证明「规则写对了」，证明不了「规则被用上了」**，
 *   那条由 `tests/visual-tokens.test.mjs` 的静态守卫兜（属性选择器必须真的有 .tsx
 *   写它 + 收起态栅格与对话区处理），渲染台不重复。
 * - **不替代桌面验收**：宿主 conversation 真实挂载后的表现（尤其是收起态的滚动
 *   位置是否真的保住了）只能真机看。这里用 computed style 证明「没有 display:none
 *   + 尺寸没被压扁」，那是保住滚动位置的必要条件，不是充分条件。
 * - **c 批的会话头是示意，不是宿主的头**：宿主会话头属于 dsh（CSS Modules），
 *   插件只往它的公开槽 utilities 里加一格。这里那条件是照宿主
 *   ConversationRoot.module.css 的 .headerUtilities 复刻的，用来给 chip 一个真实
 *   量级的落点；验的是 **chip 本体**（产品真样式），不是宿主头部。
 *
 * 用法：`node scripts/preview-chat.mjs [输出路径]`
 *      `?theme=light&preset=ocean-blue` 可切主题与预设。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  loadBrandModule,
  readStudioStyles,
  renderTokenBlock,
  reportTokenCoverage,
  rewriteBrandSelectors,
  HOST_TOKENS_DARK,
  HOST_TOKENS_LIGHT,
} from './preview-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', '.workbuddy', 'preview')
const outPath = process.argv[2] ?? join(outDir, 'chat-preview.html')
await mkdir(outDir, { recursive: true })

const studioStyles = await readStudioStyles()
const brand = await loadBrandModule()
const presetIds = [...brand.BRAND_PRESET_IDS]
const defaultPreset = brand.DEFAULT_BRAND_PRESET
const presetLabels = Object.fromEntries(presetIds.map(id => [id, brand.BRAND_PRESETS[id].label]))

// 四套预设全部注入，靠 html[data-cs-preset] 切换。基块必须命中明暗两轨，
// 否则暗色下非配色令牌整批消失（2026-09-12 的锚点事故，见 preview-tokens.mjs）。
const brandCss = presetIds
  .map(id => rewriteBrandSelectors(brand.brandCssText(id), {
    baseSelector: `html[data-cs-preset="${id}"]`,
    darkSelector: `html:not([data-light])[data-cs-preset="${id}"]`,
  }))
  .join('\n\n')

await reportTokenCoverage(`preview-chat [${defaultPreset}]`, brand.brandCssText(defaultPreset), HOST_TOKENS_DARK)

const hostCss = `:root {\n${renderTokenBlock(HOST_TOKENS_DARK)}\n}\nhtml[data-light] {\n${renderTokenBlock(HOST_TOKENS_LIGHT)}\n}`

/* ------------------------------------------------------------------ DOM 片段 */

/** 左栏：只在你需要看「三栏比例」时出现，内容取最简形态。 */
const railPart = (strip) => (strip
  ? `        <aside class="csProjects">
          <div class="csRailStrip">
            <button type="button" class="csRailStripBrand" title="展开项目栏" aria-label="展开项目栏">
              <svg width="20" height="20" viewBox="0 0 32 32" fill="none"><rect x="2" y="2" width="28" height="28" rx="8" fill="var(--cs-accent, #7C6CFF)"/></svg>
            </button>
          </div>
        </aside>`
  : `        <aside class="csProjects">
          <div class="csBrandHeader">
            <span class="csLogoMark" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 32 32" fill="none"><rect x="2" y="2" width="28" height="28" rx="8" fill="var(--cs-accent, #7C6CFF)"/></svg>
            </span>
            <div class="csBrandMeta">
              <span class="csBrandName">Canvas Studio</span>
              <span class="csBrandSub">创意工厂</span>
            </div>
            <button type="button" class="csBrandCollapse" title="收起项目栏" aria-label="收起项目栏">‹</button>
          </div>
        </aside>`)

const canvasPart = `        <main class="csCanvas"><span class="pvCanvasTag">画布（占位）</span></main>`

/**
 * 会话头「制作阶段」chip（DD-09 / c）。
 *
 * 诚实标注：**宿主头部本身是它自己的**（CSS Modules，插件选不中也不该改），这里
 * 只示意 chip 落在右栏会话头右侧的位置与相对量级。外面那条 `.pvHostHeader` 的
 * 行距 / 对齐是照宿主 `ConversationRoot.module.css` 的 `.headerUtilities`
 * （`display:flex; align-items:center; gap:8px; margin-left:20px`）复刻的，
 * chip 本体用的是**产品真样式** `.csStageChip`（不是仿制）。
 *
 * 「未选项目时不渲染」在渲染台上验不了（`:empty` 折叠是宿主的规则，这里写一遍等于
 * 自己给自己出题）—— 那条由 `tests/visual-tokens.test.mjs` 的静态守卫兜。
 */
const chipPart = ({ pending = false, label, progress, mode }) => `          <div class="pvHostHeader">
            <span class="pvHostTitle">会话头（宿主区域，示意）</span>
            <div class="pvHostUtilities">
              <span class="csStageChip${pending ? ' csStageChipPending' : ''}" title="制作阶段：${label}（${progress}）· ${mode}"><span class="csStageChipDot"></span><span class="csStageChipLabel">${label}</span><span class="csStageChipProgress">${progress}</span><span class="csStageChipMode">${mode}</span></span>
            </div>
          </div>`

/** 指定实例的 chip 形态：常态（剧本 1/6）、放手跑（分镜 2/6）、待拍板（gold）。 */
const CHIP_BY_INSTANCE = {
  'f-full': { label: '剧本', progress: '1/6', mode: '逐步确认' },
  'f-chatstrip': { label: '分镜', progress: '2/6', mode: '放手跑' },
  'f-both': { pending: true, label: '关键帧', progress: '4/6', mode: '逐步确认' },
}

/**
 * 输入卡片下方的读数带（DD-09 / d）。
 *
 * 诚实边界与 chip 那条相同：**宿主输入条的骨架是它的**，这里只示意
 * `conversation.composer.dock` 在输入卡下方那条读数带里的位置与同族对齐关系。
 * 外壳 `.pvHostComposer*` 照宿主 `InputBar.module.css` 的 `.root`（flex column +
 * align-items center + 侧边距）与 `StatsLine.module.css`（同宽列 / 同内边距 / 12px）复刻，
 * 用来给上下文条一个真实量级的落点；**上下文条本体用的是产品真样式 `.csContextBar`**。
 *
 * 那条 stats 行是**仿制品**：它存在的唯一目的是量「两条读数是否等宽同轴」——
 * 真 stats 行在宿主里（CSS Modules），本仓拿不到它的类名。
 */
const composerPart = () => `            <div class="pvHostComposer">
              <div class="pvHostComposerDock">
                <div class="csContextBar" title="当前项目：验收右侧边栏 · 16:9 · 75s · 建议 12 镜"><span class="csContextBarName">验收右侧边栏</span><span class="csContextBarSep" aria-hidden>·</span><span class="csContextBarSpec">16:9 · 75s</span><span class="csContextBarSep" aria-hidden>·</span><span class="csContextBarSpec">≈12 镜</span></div>
                <div class="pvHostStatsLine">3 轮 · 5 步 | 12.3K 输入 · 2.1K 输出</div>
              </div>
            </div>`

/**
 * 对话区槽。真实运行时里面是 dsh 的 conversation（宿主渲染），这里用同样的
 * class 链占位 —— 本批要验的是**容器**行为（裁切 / 保留尺寸）、c 批的会话头 chip
 * 与 d 批的输入区读数带。
 */
const conversationPart = (id) => `          <section class="csConversation">
${chipPart(CHIP_BY_INSTANCE[id])}
            <div class="pvConvFill">宿主 conversation 占位</div>
${composerPart()}
          </section>`

const chatFull = (id) => `        <aside class="csChat">
          <button type="button" class="csChatCollapse" title="收起对话区" aria-label="收起对话区">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.5 4.5 10 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M13.5 3.5v9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
${conversationPart(id)}
        </aside>`

const chatStrip = (id) => `        <aside class="csChat">
${conversationPart(id)}
          <div class="csChatStrip">
            <button type="button" class="csChatStripExpand" title="展开对话区" aria-label="展开对话区">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.5 4.5 6 8l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M2.5 3.5v9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
            <div class="csChatStripStages" title="制作阶段：镜头">
${Array.from({ length: 6 }, (_, i) => `              <span class="csChatStripDot${
  i < 2 ? ' csChatStripDotDone' : i === 2 ? ' csChatStripDotNow' : ''}"></span>`).join('\n')}
            </div>
          </div>
        </aside>`

/** 单个 .csFrame 实例。与 StudioFrame.tsx 同构：aside.csProjects → main.csCanvas → aside.csChat。 */
const frame = (id, { rail = 'full', chat = 'full' }) => `      <div class="csFrame" id="${id}" data-mode="work" data-rail="${rail}" data-chat="${chat}">
${railPart(rail === 'strip')}
${canvasPart}
${chat === 'strip' ? chatStrip(id) : chatFull(id)}
      </div>`

const html = `<!doctype html>
<html lang="zh-CN" data-cs-preset="${defaultPreset}">
<head>
<meta charset="utf-8">
<title>右栏整栏验收台 · DD-09 / b + c + d</title>
<style>
${hostCss}
${brandCss}
${studioStyles}

/* ---- 验收台外壳（不是产品样式） ---- */
body { margin: 0; padding: 16px 20px 28px; background: #0d0f14; color: #e6e8ee;
  font: 13px/1.5 -apple-system, "PingFang SC", "Helvetica Neue", Arial, sans-serif; }
html[data-light] body { background: #f4f5f8; color: #1b1d23; }
.pvBar { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.pvBar h1 { font-size: 15px; margin: 0; font-weight: 600; }
.pvBar button { font: inherit; padding: 3px 10px; border-radius: 6px; cursor: pointer;
  border: 1px solid rgba(128,128,128,.4); background: transparent; color: inherit; }
.pvBar button[aria-pressed="true"] { background: rgba(124,108,255,.18); border-color: rgba(124,108,255,.55); }
#pvPresets { display: inline-flex; gap: 4px; margin-left: 6px; }
.pvHint { margin: 0 0 16px; opacity: .7; font-size: 12px; }
.pvRow { display: flex; flex-wrap: wrap; gap: 18px; }
.pvItem { display: block; }
.pvLabel { display: block; margin-bottom: 6px; font-size: 12px; opacity: .75; }
/* 三栏栅格要按真实宽度测（min-width 与 1fr 都得有地方可算）。 */
.pvViewport { width: 1240px; max-width: 100%; height: 380px; overflow: hidden;
  border: 1px solid rgba(128,128,128,.35); border-radius: 8px; }
.pvCanvasTag { display: grid; place-items: center; height: 100%; font-size: 12px; opacity: .5; }
.pvConvFill { padding: 12px; font-size: 12px; opacity: .6; }
/* 宿主会话头的**示意条**：.pvHostUtilities 的行距与对齐照宿主
   ConversationRoot.module.css 的 .headerUtilities 复刻（flex / center / gap 8 /
   margin-left 20）—— 头部本身是宿主的，这里只是给 chip 一个真实量级的落点。 */
.pvHostHeader { display: flex; align-items: center; padding: 8px 10px;
  border-bottom: 1px solid rgba(128,128,128,.25); }
.pvHostTitle { font-size: 12px; opacity: .5; }
.pvHostUtilities { display: flex; flex: none; align-items: center; gap: 8px; margin-left: 20px; }
/* 宿主输入条的**示意骨架**（InputBar .root：flex column + align-items center +
   侧边距走 --dsh-composer-side-clearance）。composer.dock 就在这个列里、卡片下方。 */
.pvHostComposer { display: flex; flex-direction: column; align-items: center;
  padding: 0 var(--dsh-composer-side-clearance) 8px; margin-top: 8px; }
.pvHostComposerDock { display: flex; flex-direction: column; width: 100%; }
/* 宿主 stats 行的**仿制品**（StatsLine.module.css 的几何：同宽列 + 同内边距 +
   12px/20px + 居中）。只用来量两条读数是否等宽同轴，不代表宿主真身。 */
.pvHostStatsLine { display: block; box-sizing: border-box; width: 100%;
  max-width: var(--dsh-chat-content-width); margin: 0 auto;
  padding: 4px calc(var(--dsh-composer-side-clearance) + 16px) 0;
  text-align: center; font-size: 12px; line-height: 20px;
  color: var(--dsw-alias-label-tertiary); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.pvCheck { margin-top: 18px; padding: 10px 12px; border-radius: 8px;
  border: 1px solid rgba(128,128,128,.35); white-space: pre-wrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; max-width: 1100px; }
#pvVerdict { display: none; }
</style>
</head>
<body>
<div class="pvBar">
  <h1>右栏整栏验收台 · DD-09 / b + c + d</h1>
  <button type="button" id="pvTheme" aria-pressed="false">明暗</button>
  <span id="pvPresets"></span>
</div>
<p class="pvHint">主题切换后页面会重载（自检读 computedStyle，必须重跑）。三种形态并排，宽度都按 1240px 真实测量 —— 「画布真的变宽」是本批的核心目的。会话头那条与输入区那条都是**示意**：头部与输入条骨架归宿主（CSS Modules，插件改不了），验的是插件自己那两个元素的本体（真样式 .csStageChip / .csContextBar）落在宿主槽里之后的量级、对齐与明暗可读性。</p>

<div class="pvRow">
  <div class="pvItem">
    <span class="pvLabel">① 都不收（左 280 / 右 480）</span>
    <div class="pvViewport">
${frame('f-full', {})}
    </div>
  </div>
</div>

<div class="pvRow" style="margin-top: 16px">
  <div class="pvItem">
    <span class="pvLabel">② 只收右栏（左 280 / 右 56）</span>
    <div class="pvViewport">
${frame('f-chatstrip', { chat: 'strip' })}
    </div>
  </div>
</div>

<div class="pvRow" style="margin-top: 16px">
  <div class="pvItem">
    <span class="pvLabel">③ 两栏都收（左 56 / 右 56）</span>
    <div class="pvViewport">
${frame('f-both', { rail: 'strip', chat: 'strip' })}
    </div>
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
  var isLight = theme === 'light'

  var lines = []
  var fail = 0
  function check(label, ok, detail) {
    lines.push((ok ? '\\u2705 ' : '\\u274c ') + label + (detail ? '  \\u2192 ' + detail : ''))
    if (!ok) fail += 1
  }
  // 实例 id 挂在 .csFrame 自己身上，而 querySelector 只查**后代** —— 查 .csFrame
  // 会匹配空集（实测当场 THROW，自检整段中断）。先试自身再查后代。
  function pick(id, selector) {
    var host = document.getElementById(id)
    if (host === null) throw new Error('找不到实例：' + id)
    if (host.matches(selector)) return host
    var el = host.querySelector(selector)
    if (el === null) throw new Error('选择器匹配空集：' + id + ' ' + selector)
    return el
  }
  function cs(id, selector, prop) {
    return getComputedStyle(pick(id, selector)).getPropertyValue(prop).trim()
  }
  function width(id, selector) {
    return Math.round(pick(id, selector).getBoundingClientRect().width)
  }

  try {
    /* ---- 令牌必须真的解析出值（「声明躺在文件里」与「页面上生效」是两件事） ---- */
    var tokenNames = [
      '--cs-shell', '--cs-line', '--cs-accent', '--cs-accent-soft',
      '--cs-radius-pill', '--cs-radius-md', '--cs-radius-sm',
      '--cs-space-1', '--cs-space-2', '--cs-duration-fast', '--cs-ease',
    ]
    var bodyStyle = getComputedStyle(document.body)
    var emptyTokens = tokenNames.filter(function (name) { return bodyStyle.getPropertyValue(name).trim() === '' })
    check('关键令牌在浏览器里全部可解析', emptyTokens.length === 0, emptyTokens.join(' '))

    /* ---- 栅格：三种形态都是真实测量出来的，不是覆盖出来的 ---- */
    var colsFull = cs('f-full', '.csFrame', 'grid-template-columns').split(' ')
    check('① 都不收：第三列 = 480px', colsFull[2] === '480px', colsFull.join(' '))
    check('① 都不收：第一列 = 280px', colsFull[0] === '280px', colsFull.join(' '))

    var colsChat = cs('f-chatstrip', '.csFrame', 'grid-template-columns').split(' ')
    check('② 只收右栏：第三列 = 56px', colsChat[2] === '56px', colsChat.join(' '))
    check('② 只收右栏：第一列保持 280px（不牵连左栏）', colsChat[0] === '280px', colsChat.join(' '))

    var colsBoth = cs('f-both', '.csFrame', 'grid-template-columns').split(' ')
    check('③ 两栏都收：56 / 1fr / 56', colsBoth[0] === '56px' && colsBoth[2] === '56px', colsBoth.join(' '))

    /* ---- min-width 必须同步下移，否则收起反而多出横向滚动条（R8 踩过） ---- */
    check('② min-width 下移到 576px', cs('f-chatstrip', '.csFrame', 'min-width') === '576px',
      cs('f-chatstrip', '.csFrame', 'min-width'))
    check('③ min-width 下移到 432px', cs('f-both', '.csFrame', 'min-width') === '432px',
      cs('f-both', '.csFrame', 'min-width'))

    /* ---- 本批的目的：画布真的变宽（只藏内容不改栅格 = 白收） ---- */
    var wFull = width('f-full', '.csCanvas')
    var wChat = width('f-chatstrip', '.csCanvas')
    var wBoth = width('f-both', '.csCanvas')
    check('② 收起右栏后画布真的变宽', wChat > wFull, wFull + 'px \\u2192 ' + wChat + 'px')
    check('③ 两栏都收时画布最宽', wBoth > wChat && wBoth > wFull,
      wFull + ' / ' + wChat + ' / ' + wBoth + ' px')

    /* ---- 收起态的对话区：保留尺寸与布局，只做不可见 ---- */
    check('② 收起态对话区不可见（visibility）', cs('f-chatstrip', '.csConversation', 'visibility') === 'hidden',
      cs('f-chatstrip', '.csConversation', 'visibility'))
    check('② 收起态对话区**没有** display:none（离开布局会让滚动位置归零）',
      cs('f-chatstrip', '.csConversation', 'display') !== 'none',
      cs('f-chatstrip', '.csConversation', 'display'))
    check('② 收起态对话区仍保留 480px 自身宽度（内部布局不重排）',
      width('f-chatstrip', '.csConversation') === 480, width('f-chatstrip', '.csConversation') + 'px')
    check('② 收起态对话区脱离文档流（position:absolute）',
      cs('f-chatstrip', '.csConversation', 'position') === 'absolute',
      cs('f-chatstrip', '.csConversation', 'position'))

    /* ---- 收起态的竖条：有落点、有进度、不是一片死白 ---- */
    check('② 竖条可见（visibility/opacity）',
      cs('f-chatstrip', '.csChatStrip', 'visibility') === 'visible'
      && cs('f-chatstrip', '.csChatStrip', 'opacity') === '1')

    var stages = document.getElementById('f-chatstrip').querySelectorAll('.csChatStripDot')
    check('② 竖条上有六段轨道的点', stages.length === 6, stages.length + '/6')
    var nowDots = document.getElementById('f-chatstrip').querySelectorAll('.csChatStripDotNow')
    check('② 当前段恰好一个高亮点', nowDots.length === 1, String(nowDots.length))
    check('② 当前段点不是透明（accent 生效）',
      cs('f-chatstrip', '.csChatStripDotNow', 'background-color') !== 'rgba(0, 0, 0, 0)',
      cs('f-chatstrip', '.csChatStripDotNow', 'background-color'))
    check('② 展开按钮存在且可点', document.getElementById('f-chatstrip').querySelector('.csChatStripExpand') !== null)

    /* ---- 展开态才有收起按钮（否则两侧同时出现两个「收起」） ---- */
    check('① 展开态有收起按钮',
      document.getElementById('f-full').querySelector('.csChatCollapse') !== null)
    check('② 收起态不再渲染收起按钮',
      document.getElementById('f-chatstrip').querySelector('.csChatCollapse') === null)
    check('② 收起态也不渲染竖条以外的东西（对话区仍是挂载的，只是不可见）',
      document.getElementById('f-chatstrip').querySelector('.csConversation') !== null)

    /* ---- 分主题：竖条材料在明暗两轨都要读得出来 ----
       浅色下最容易出的问题是「拿暗色的底/字硬套」—— 两轨都要求非透明 + 当前段
       与未来段可区分，把「只在暗色成立」当场暴露。 */
    var dotNow = cs('f-chatstrip', '.csChatStripDotNow', 'background-color')
    var dotIdle = cs('f-chatstrip', '.csChatStripDot', 'background-color')
    check('阶段点：当前段与未来段颜色不同（明暗两轨同判）', dotNow !== dotIdle,
      (isLight ? 'light ' : 'dark ') + dotNow + ' vs ' + dotIdle)
    check('阶段点：未来段也不透明（否则浅色下完全看不见）', dotIdle !== 'rgba(0, 0, 0, 0)', dotIdle)

    /* ---- DD-09 / c：会话头 chip ----
       注意诚实边界：宿主头部本身是它的（CSS Modules），这里验的是 **chip 本体**的
       真样式 + 它落在宿主 utilities 行里的位置。静态接线（inject 有没有做、空项目
       时是否 return null）在 tests/visual-tokens.test.mjs 里，渲染台不重复。 */
    check('③ chip 落在宿主 utilities 行里',
      document.getElementById('f-full').querySelector('.pvHostUtilities > .csStageChip') !== null)
    check('③ chip 高 22px（与宿主头部按钮同量级）',
      Math.round(pick('f-full', '.csStageChip').getBoundingClientRect().height) === 22,
      pick('f-full', '.csStageChip').getBoundingClientRect().height + 'px')
    check('③ chip 是胶囊（圆角 ≥ 高度一半）',
      parseFloat(cs('f-full', '.csStageChip', 'border-radius')) >= 11,
      cs('f-full', '.csStageChip', 'border-radius'))
    check('③ chip 底色非透明（明暗两轨都要有底）',
      cs('f-full', '.csStageChip', 'background-color') !== 'rgba(0, 0, 0, 0)',
      cs('f-full', '.csStageChip', 'background-color'))
    check('③ 当前段圆点非透明（accent 生效）',
      cs('f-full', '.csStageChipDot', 'background-color') !== 'rgba(0, 0, 0, 0)',
      cs('f-full', '.csStageChipDot', 'background-color'))
    check('③ 进度走等宽数字（2/6 → 3/6 胶囊宽度不跳）',
      cs('f-full', '.csStageChipProgress', 'font-variant-numeric').includes('tabular-nums'),
      cs('f-full', '.csStageChipProgress', 'font-variant-numeric'))
    /* 待拍板态：整条变 gold —— 与常态必须在**底色**上就分得开，不能只差一个描边
       （浅色下细描边几乎读不出来）。 */
    var chipIdleBg = cs('f-full', '.csStageChip', 'background-color')
    var chipPendingBg = cs('f-both', '.csStageChipPending', 'background-color')
    check('③ 待拍板态底色与常态不同（gold 真生效）', chipPendingBg !== chipIdleBg,
      chipPendingBg + ' vs ' + chipIdleBg)
    check('③ 待拍板态仍是胶囊、尺寸不跳',
      Math.round(pick('f-both', '.csStageChipPending').getBoundingClientRect().height) === 22,
      pick('f-both', '.csStageChipPending').getBoundingClientRect().height + 'px')

    /* ---- DD-09 / d：输入区项目上下文条 ----
       与宿主的 stats 行同住 composer.dock，所以本批的核心断言是**同族对齐**（等宽、
       同左边界）与「令牌真的解析出值」。样式对了但没接上宿主槽这一层由
       tests/visual-tokens.test.mjs 的静态守卫兜，渲染台不重复。 */
    check('④ 上下文条落在输入条读数带里',
      document.getElementById('f-full').querySelector('.pvHostComposerDock > .csContextBar') !== null)
    check('④ 读数条是块级（text-overflow 只对块的行内内容生效）',
      cs('f-full', '.csContextBar', 'display') === 'block',
      cs('f-full', '.csContextBar', 'display'))
    check('④ 读数条不换行（单行读数）',
      cs('f-full', '.csContextBar', 'white-space') === 'nowrap',
      cs('f-full', '.csContextBar', 'white-space'))
    check('④ 宽列令牌解析出宿主值 748px（不是「声明躺在文件里」）',
      cs('f-full', '.csContextBar', 'max-width') === '748px',
      cs('f-full', '.csContextBar', 'max-width'))
    check('④ 与同族的 stats 读数行等宽同轴',
      width('f-full', '.csContextBar') === width('f-full', '.pvHostStatsLine')
      && Math.round(pick('f-full', '.csContextBar').getBoundingClientRect().left)
        === Math.round(pick('f-full', '.pvHostStatsLine').getBoundingClientRect().left),
      width('f-full', '.csContextBar') + 'px vs ' + width('f-full', '.pvHostStatsLine') + 'px')
    var ctxNameColor = cs('f-full', '.csContextBarName', 'color')
    var ctxSpecColor = cs('f-full', '.csContextBarSpec', 'color')
    check('④ 一行里只有一个强项：项目名比规格强（明暗两轨同判）', ctxNameColor !== ctxSpecColor,
      (isLight ? 'light ' : 'dark ') + ctxNameColor + ' vs ' + ctxSpecColor)
    check('④ 读数条两段都不透明（浅色下不得消失）',
      ctxNameColor !== 'rgba(0, 0, 0, 0)' && ctxSpecColor !== 'rgba(0, 0, 0, 0)',
      ctxNameColor + ' / ' + ctxSpecColor)
  } catch (e) {
    fail += 1
    lines.push('THROW 自检中断 \\u2192 ' + (e && e.message ? e.message : 'unknown'))
  }

  var verdict = '# 右栏整栏验收台 \\u2014 ' + fail + ' 条失败 / ' + lines.length + ' 条断言\\n'
    + lines.join('\\n')
  var pre = document.getElementById('pvVerdict')
  if (pre) pre.textContent = verdict
  document.documentElement.setAttribute('data-pv-fail', String(fail))
  var card = document.getElementById('pvCheck')
  if (card) card.textContent = (fail === 0 ? '\\u2705 全部通过' : '\\u274c ' + fail + ' 条失败') + '\\n\\n' + lines.join('\\n')
})()

;(function () {
  'use strict'
  // 主题**不在这里应用** —— 它在自检脚本开头（必须在自检读 computedStyle 之前）。
  var params = new URLSearchParams(location.search)
  var theme = document.documentElement.hasAttribute('data-light') ? 'light' : 'dark'
  var themeBtn = document.getElementById('pvTheme')
  themeBtn.setAttribute('aria-pressed', String(theme === 'light'))
  themeBtn.textContent = theme === 'light' ? '浅色' : '深色'
  themeBtn.addEventListener('click', function () {
    params.set('theme', theme === 'light' ? 'dark' : 'light')
    location.search = params.toString()
  })

  var PRESETS = ${JSON.stringify(presetLabels)}
  var active = params.get('preset') ?? '${defaultPreset}'
  var host = document.getElementById('pvPresets')
  Object.keys(PRESETS).forEach(function (id) {
    var button = document.createElement('button')
    button.type = 'button'
    button.textContent = PRESETS[id]
    button.setAttribute('aria-pressed', String(id === active))
    button.addEventListener('click', function () {
      params.set('preset', id)
      location.search = params.toString()
    })
    host.appendChild(button)
  })
})()
</script>
</body>
</html>
`

await writeFile(outPath, html, 'utf8')
console.log(`preview-chat: 已写出 ${outPath}`)
