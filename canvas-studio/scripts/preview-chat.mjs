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
 * 阶段胶囊本体 —— 与 `StageChip.tsx` 的 DOM 同构，类是**产品真样式** `.csStageChip`。
 *
 * 它现在有两个用处：① 落在输入区读数带右端（CV-179 起的现状）；② 落在会话头的
 * **对照组**里（差分实验要用「修复前」那一版，才证明得了「修复后标题不再被截」
 * 不是空转）。
 */
const chipMarkup = ({ pending = false, label, progress, mode }) => `<span class="csStageChip${pending ? ' csStageChipPending' : ''}" title="制作阶段：${label}（${progress}）· ${mode}"><span class="csStageChipDot"></span><span class="csStageChipLabel">${label}</span><span class="csStageChipProgress">${progress}</span><span class="csStageChipMode">${mode}</span></span>`

/** 指定实例的阶段形态：常态（剧本 1/6）、放手跑（分镜 2/6）、待拍板（gold）。 */
const STAGE_BY_INSTANCE = {
  'f-full': { label: '剧本', progress: '1/6', mode: '逐步确认' },
  'f-chatstrip': { label: '分镜', progress: '2/6', mode: '放手跑' },
  'f-both': { pending: true, label: '关键帧', progress: '4/6', mode: '逐步确认' },
}

/**
 * 用户 2026-09-14 截图里实测的那一枚（`镜头 5/6 逐步确认`，占 131px）。
 * 对照组的会话头用它 —— 差分断言的被测量正是它的宽度。
 */
const MEASURED_CHIP = { label: '镜头', progress: '5/6', mode: '逐步确认' }

/**
 * 会话标题：宿主为这条会话自动生成的**真文本**（14 字，取自会话转录的
 * `title` 字段，`titleProvider: session-title-first-prompt-llm`）。它长到会被截，
 * 正是本批的起因 —— 用真文本而不是「示例标题」，这条断言才验的是真问题。
 */
const CRUMB_TEXT = '创作演唱会MV及简单女声歌曲'

/**
 * 会话头模型（CV-179）。
 *
 * 诚实边界：**宿主头部本身是它的**（CSS Modules，插件选不中也改不了）。这里按
 * `ConversationRoot.module.css` 的骨架复刻出来，只为一件事 —— 量「标题能不能显示全」：
 *
 *   `.titleRow`(flex / center)
 *     ├ `.titleCluster`(flex:1 / min-width:0 / gap:10)
 *     │   ├ `.crumb`(max-width:220 / overflow:hidden / ellipsis / 14px)  ← 会话标题
 *     │   └ `.headerActions`(flex:none / gap:8)  ← 宿主的「标准模式」（agent preset 名）
 *     └ `.headerUtilities`(flex:none / gap:8 / margin-left:20)  ← 宿主的 Session log
 *                                                                 （修复前还有我们的胶囊）
 *
 * 两个宿主 chip 用**固定宽度**（76 / 94px，取自用户截图的 OCR 实测）而不是真文本：
 * 这条差分断言的前提是「除我们那一枚之外全相同」，宽度被字体渲染带跑就复现不了。
 *
 * 每帧渲染**两个**头：`pvHeaderBefore` 挂着阶段胶囊（修复前），`pvHeaderFixed` 没挂
 * （现状）—— 同页对照，两行只差我们那一枚，所以「被截 / 不被截」的差别只可能来自它。
 * 标签放在头**外面**（`.pvHeaderTag`）：塞进那一行会自己吃掉宽度，把实验污染掉。
 */
const headerPart = ({ withOurChip }) => `            <div class="pvHeaderTag">${withOurChip ? '修复前：阶段胶囊挂在会话头 utilities 里' : '现状：插件不再往会话头注册任何元素'}</div>
            <div class="pvHostHeader ${withOurChip ? 'pvHeaderBefore' : 'pvHeaderFixed'}">
              <div class="pvHostCluster">
                <span class="pvHostCrumb" title="${CRUMB_TEXT}">${CRUMB_TEXT}</span>
                <div class="pvHostActions"><span class="pvHostChip pvHostChipPreset">标准模式</span></div>
              </div>
              <div class="pvHostUtilities">${withOurChip ? `${chipMarkup(MEASURED_CHIP)}\n                ` : ''}<span class="pvHostChip pvHostChipLog">Session log</span></div>
            </div>`

/**
 * 输入卡片下方的读数带（DD-09 / d，CV-179 升级为「场记板横条」）。
 *
 * 诚实边界与上面相同：**宿主输入条的骨架是它的**，这里只示意
 * `conversation.composer.dock` 在输入卡下方那条读数带里的位置与同族对齐关系。
 * 外壳 `.pvHostComposer*` 照宿主 `InputBar.module.css` 的 `.root`（flex column +
 * align-items center + 侧边距）与 `StatsLine.module.css`（同宽列 / 同内边距 / 12px）复刻，
 * 用来给上下文条一个真实量级的落点；**上下文条本体用的是产品真样式 `.csContextBar`**。
 *
 * 那条 stats 行是**仿制品**：它存在的唯一目的是量「两条读数是否等宽同轴」——
 * 真 stats 行在宿主里（CSS Modules），本仓拿不到它的类名。
 */
const composerPart = (id) => `            <div class="pvHostComposer">
              <div class="pvHostComposerDock">
                <div class="csContextBar" title="当前项目：验收右侧边栏 · 16:9 · 75s · 建议 12 镜"><span class="csContextBarName">验收右侧边栏</span><span class="csContextBarSep" aria-hidden>·</span><span class="csContextBarSpec">16:9 · 75s</span><span class="csContextBarSep" aria-hidden>·</span><span class="csContextBarSpec">≈12 镜</span>${chipMarkup(STAGE_BY_INSTANCE[id])}</div>
                <div class="pvHostStatsLine">3 轮 · 5 步 | 12.3K 输入 · 2.1K 输出</div>
              </div>
            </div>`

/**
 * 对话区槽。真实运行时里面是 dsh 的 conversation（宿主渲染），这里用同样的
 * class 链占位 —— 本批要验的是**容器**行为（裁切 / 保留尺寸）、CV-179 的会话头
 * 差分实验（标题被挤的根因）与升级后的输入区读数带。
 */
const conversationPart = (id) => `          <section class="csConversation">
${headerPart({ withOurChip: true })}
${headerPart({ withOurChip: false })}
            <div class="pvConvFill">宿主 conversation 占位</div>
${composerPart(id)}
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
/* 宿主会话头的**示意骨架**（CV-179）：照 ConversationRoot.module.css 复刻 ——
   .titleRow(flex / center / min-height 32) + .titleCluster(flex:1 / min-width:0 / gap 10)
   + .crumb(max-width 220 / overflow hidden / ellipsis / 14px / 20px)
   + .headerActions(flex:none / gap 8) + .headerUtilities(flex:none / gap 8 / margin-left 20)。
   水平内边距取宿主 .header 的「左 20 / 右 28」—— 那 48px 也是标题能不能放下的一部分。
   头部本身是宿主的，这里做的是「标题显示得全吗」这台差分实验。 */
.pvHeaderTag { padding: 6px 20px 0; font-size: 10px; opacity: .5; }
.pvHostHeader { display: flex; align-items: center; min-height: 32px;
  padding: 0 28px 0 20px; border-bottom: 1px solid rgba(128,128,128,.25); }
.pvHostCluster { display: flex; flex: 1; align-items: center; gap: 10px; min-width: 0; }
/* 宿主 .crumb 是 <button>，这里用 <span> 是刻意的：**button 的 scrollWidth 在部分
   引擎下不反映溢出文本**，而这台实验的全部意义就是读 scrollWidth 与 clientWidth 的
   关系。外形与成因逐条对齐（max-width 220 / overflow hidden / ellipsis / nowrap /
   padding 4 8 / 14px·20px），让宽度被挤的机制也完全相同：flex 子项 + overflow 非
   visible → min-width:auto 解析为 0，所以它会缩、而不是把整行撑破。 */
.pvHostCrumb { max-width: 220px; overflow: hidden; padding: 4px 8px; border: none;
  border-radius: 12px; background: transparent; font: inherit; font-size: 14px;
  line-height: 20px; text-align: left; color: var(--dsw-alias-label-tertiary);
  text-overflow: ellipsis; white-space: nowrap; cursor: default; }
.pvHostActions { display: flex; flex: none; align-items: center; gap: 8px; }
.pvHostUtilities { display: flex; flex: none; align-items: center; gap: 8px; margin-left: 20px; }
/* 两个宿主 chip 的替身：宽度**写死**（76 / 94px），取自用户截图的 OCR 实测。
   用固定宽度而不是真文本，因为差分断言的前提是「除我们那一枚之外全相同」——
   宽度被字体渲染带跑就复现不了。 */
.pvHostChip { display: inline-flex; flex: none; align-items: center; justify-content: center;
  height: 22px; box-sizing: border-box; border: 1px solid rgba(128,128,128,.35);
  border-radius: 999px; font-size: 11px; line-height: 1; white-space: nowrap; }
.pvHostChipPreset { width: 76px; }
.pvHostChipLog { width: 94px; }
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
  <h1>右栏整栏验收台 · DD-09 / b + c + d（CV-179：会话头让位 + 场记板横条）</h1>
  <button type="button" id="pvTheme" aria-pressed="false">明暗</button>
  <span id="pvPresets"></span>
</div>
<p class="pvHint">主题切换后页面会重载（自检读 computedStyle，必须重跑）。三种形态并排，宽度都按 1240px 真实测量 —— 「画布真的变宽」是本批的核心目的。<br>
<b>CV-179 的两台实验</b>：① 每个实例的会话头都渲染**两行**（修复前挂着阶段胶囊 / 现状没挂），同页对照 —— 「标题被截 / 不被截」的差别只可能来自我们那一枚，这条差分断言顺带自证不是在空转；② 输入卡片下方那条读数带升级成场记板横条（accent 立柱 + 名字 13px/600 + 等宽数字规格），阶段胶囊住在它右端。<br>
诚实边界：会话头与输入条的**骨架**都归宿主（CSS Modules，插件改不了），这里按 ui-conversation 的 module.css 复刻出来只是给插件元素一个真实量级与真实挤压条件的落点；两个宿主 chip 用固定宽度（取自用户截图 OCR 实测）以保差分可复现。插件元素本体（.csStageChip / .csContextBar）用的都是**产品真样式**。</p>

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

    /* ---- CV-179：会话标题不再被挤没（差分实验） ----
       同一帧里放两个只差一件事的会话头：pvHeaderBefore 挂着阶段胶囊（修复前）、
       pvHeaderFixed 没挂（现状）。差分断言比绝对值断言硬得多 —— 它证明那 139px
       真的是我们让出来的，同时自证这条断言不是在空转：对照组必须真的被截，
       否则「不截」可能只是因为模型里压根没挤。 */
    var crumbBefore = document.getElementById('f-full').querySelector('.pvHeaderBefore .pvHostCrumb')
    var crumbFixed = document.getElementById('f-full').querySelector('.pvHeaderFixed .pvHostCrumb')
    check('H 现状：会话头里没有插件元素了（撤销注册真的生效）',
      document.getElementById('f-full').querySelector('.pvHeaderFixed .csStageChip') === null)
    check('H 现状：会话标题显示完整（scrollWidth ≤ clientWidth）',
      crumbFixed.scrollWidth <= crumbFixed.clientWidth + 1,
      crumbFixed.scrollWidth + ' vs ' + crumbFixed.clientWidth
        + '（标题 ' + crumbFixed.textContent.length + ' 字）')
    check('H 对照（修复前）：同一个标题确实被截 —— 所以上面那条不是在空转',
      crumbBefore.scrollWidth > crumbBefore.clientWidth,
      crumbBefore.scrollWidth + ' vs ' + crumbBefore.clientWidth)

    /* ---- DD-09 / d：输入区项目上下文条（CV-179 升级为场记板横条）----
       与宿主的 stats 行同住 composer.dock，所以核心断言仍是**同族对齐**（等宽、同左边界）
       与「令牌真的解析出值」。本批新增两件事：① 场记板立柱真的生成了（源码里写了 ::before
       但漏 content 就没有，只有 computedStyle 看得出来）；② 阶段胶囊搬进来了 ——
       选择器一律走 .csContextBar > .csStageChip，否则会命中会话头**对照组**里那一枚。
       样式对了但没接上宿主槽这一层由 tests/visual-tokens.test.mjs 的静态守卫兜，渲染台不重复。 */
    check('④ 上下文条落在输入条读数带里',
      document.getElementById('f-full').querySelector('.pvHostComposerDock > .csContextBar') !== null)
    check('④ 读数条排成一行（flex：立柱 + 名字 + 规格 + 胶囊）',
      cs('f-full', '.csContextBar', 'display') === 'flex',
      cs('f-full', '.csContextBar', 'display'))
    check('④ 宽列令牌解析出宿主值 748px（不是「声明躺在文件里」）',
      cs('f-full', '.csContextBar', 'max-width') === '748px',
      cs('f-full', '.csContextBar', 'max-width'))
    check('④ 与同族的 stats 读数行等宽同轴',
      width('f-full', '.csContextBar') === width('f-full', '.pvHostStatsLine')
      && Math.round(pick('f-full', '.csContextBar').getBoundingClientRect().left)
        === Math.round(pick('f-full', '.pvHostStatsLine').getBoundingClientRect().left),
      width('f-full', '.csContextBar') + 'px vs ' + width('f-full', '.pvHostStatsLine') + 'px')
    /* 场记板立柱：高度取 12px 是刻意的 —— 压满 20px 行高会与右侧胶囊打架。 */
    var barBefore = getComputedStyle(pick('f-full', '.csContextBar'), '::before')
    check('④ 场记板立柱：2×12 的竖线真的生成了',
      barBefore.width === '2px' && barBefore.height === '12px',
      barBefore.width + '×' + barBefore.height)
    check('④ 场记板立柱是 accent 色（不是透明装饰）',
      barBefore.backgroundColor !== 'rgba(0, 0, 0, 0)', barBefore.backgroundColor)
    check('④ 项目名 13px / 600 —— 一行里唯一的强项',
      cs('f-full', '.csContextBarName', 'font-size') === '13px'
      && cs('f-full', '.csContextBarName', 'font-weight') === '600',
      cs('f-full', '.csContextBarName', 'font-size') + ' / '
        + cs('f-full', '.csContextBarName', 'font-weight'))
    check('④ 项目名自带省略号契约（flex 子项默认不缩，必须 min-width:0）',
      cs('f-full', '.csContextBarName', 'min-width') === '0px'
      && cs('f-full', '.csContextBarName', 'text-overflow') === 'ellipsis',
      cs('f-full', '.csContextBarName', 'min-width') + ' / '
        + cs('f-full', '.csContextBarName', 'text-overflow'))
    check('④ 规格走等宽数字（换项目 / 换时长时整行不跳）',
      cs('f-full', '.csContextBarSpec', 'font-variant-numeric').includes('tabular-nums'),
      cs('f-full', '.csContextBarSpec', 'font-variant-numeric'))
    var ctxNameColor = cs('f-full', '.csContextBarName', 'color')
    var ctxSpecColor = cs('f-full', '.csContextBarSpec', 'color')
    check('④ 一行里只有一个强项：项目名比规格强（明暗两轨同判）', ctxNameColor !== ctxSpecColor,
      (isLight ? 'light ' : 'dark ') + ctxNameColor + ' vs ' + ctxSpecColor)
    check('④ 读数条两段都不透明（浅色下不得消失）',
      ctxNameColor !== 'rgba(0, 0, 0, 0)' && ctxSpecColor !== 'rgba(0, 0, 0, 0)',
      ctxNameColor + ' / ' + ctxSpecColor)

    /* ---- 阶段胶囊：搬家之后仍要是一枚像样的胶囊（原来在会话头验的那几条搬过来）---- */
    check('④ 阶段胶囊落在读数带里（撤出会话头后的唯一出口）',
      document.getElementById('f-full').querySelector('.csContextBar > .csStageChip') !== null)
    check('④ 胶囊高 22px（与读数行其它元素同一量级）',
      Math.round(pick('f-full', '.csContextBar > .csStageChip').getBoundingClientRect().height) === 22,
      pick('f-full', '.csContextBar > .csStageChip').getBoundingClientRect().height + 'px')
    check('④ 胶囊是胶囊（圆角 ≥ 高度一半）',
      parseFloat(cs('f-full', '.csContextBar > .csStageChip', 'border-radius')) >= 11,
      cs('f-full', '.csContextBar > .csStageChip', 'border-radius'))
    check('④ 胶囊底色非透明（明暗两轨都要有底）',
      cs('f-full', '.csContextBar > .csStageChip', 'background-color') !== 'rgba(0, 0, 0, 0)',
      cs('f-full', '.csContextBar > .csStageChip', 'background-color'))
    check('④ 当前段圆点非透明（accent 生效）',
      cs('f-full', '.csContextBar > .csStageChip .csStageChipDot', 'background-color') !== 'rgba(0, 0, 0, 0)',
      cs('f-full', '.csContextBar > .csStageChip .csStageChipDot', 'background-color'))
    check('④ 胶囊进度走等宽数字（2/6 → 3/6 胶囊宽度不跳）',
      cs('f-full', '.csContextBar > .csStageChip .csStageChipProgress', 'font-variant-numeric').includes('tabular-nums'),
      cs('f-full', '.csContextBar > .csStageChip .csStageChipProgress', 'font-variant-numeric'))
    /* 待拍板态：整条变 gold —— 与常态必须在**底色**上就分得开，不能只差一个描边
       （浅色下细描边几乎读不出来）。 */
    var chipIdleBg = cs('f-full', '.csContextBar > .csStageChip', 'background-color')
    var chipPendingBg = cs('f-both', '.csContextBar > .csStageChipPending', 'background-color')
    check('④ 待拍板态底色与常态不同（gold 真生效）', chipPendingBg !== chipIdleBg,
      chipPendingBg + ' vs ' + chipIdleBg)
    check('④ 待拍板态仍是胶囊、尺寸不跳',
      Math.round(pick('f-both', '.csContextBar > .csStageChipPending').getBoundingClientRect().height) === 22,
      pick('f-both', '.csContextBar > .csStageChipPending').getBoundingClientRect().height + 'px')
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
