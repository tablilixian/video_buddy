/**
 * 左栏（项目栏）整栏静态验收台（DD-08）。
 *
 * ## 为什么需要它
 *
 * 既有三个预览脚本各覆盖左栏的一块（lobby 布局 / 分组 / 用户卡），**没有一处
 * 是「整栏」**——而 DD-08 的绝大多数改动恰恰是「栏内元素之间的关系」：品牌条与
 * 段头的层级、卡片与分组头的层级反转、动作区的主次、收起态与完整态的栅格切换。
 * 分开看每一块都「没问题」，合起来才发现组名比项目名响。
 *
 * ## 它是什么
 *
 * 与 preview-visual.mjs 同一约定：从 `src/client/styles.ts` 抽**产品正在用的那一份**
 * STUDIO_STYLES，配上**真实令牌**（色值全部来自 `lib/brand.js` 的 `brandCssText()`），
 * 再摆一份与 ProjectList.tsx / StudioFrame.tsx **同构**的骨架 DOM。
 *
 * 页内自带两件事：
 * 1. **明暗 + 四预设切换** —— 硬约束「明色主题同样成立」「预设只动 accent 族」
 *    都能当场看。
 * 2. **自检断言**（`computedStyle` 实测）—— 把本批声称的效果从「代码里写了」
 *    变成「浏览器里确实发生了」。结果同时写进页面上的自检卡和 `#pvVerdict`，
 *    后者供 `scripts/verify-previews.mjs` 无头读取。
 *
 * ## 它不是什么
 *
 * - **不是像素级复刻**：DOM 按真实类名与层级摆，交互是静态的（hover 态靠把
 *   `.csProjectItem:hover` 的选择器重写成 `.pvHover` 来呈现，**声明一字未改**）。
 * - **不替代桌面验收**：真机验收仍按 DEV-WORKFLOW 走。这里是预检 + 截图留档。
 *
 * 用法：`node scripts/preview-rail.mjs [输出路径]`
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
const outPath = process.argv[2] ?? join(outDir, 'rail-preview.html')
await mkdir(outDir, { recursive: true })

const studioStyles = await readStudioStyles()
const brand = await loadBrandModule()
const presetIds = [...brand.BRAND_PRESET_IDS]
const defaultPreset = brand.DEFAULT_BRAND_PRESET
const presetLabels = Object.fromEntries(presetIds.map(id => [id, brand.BRAND_PRESETS[id].label]))

// 四套预设的令牌全部注入，靠 html[data-cs-preset] 切换（锚点说明见 preview-tokens.mjs
// 的 rewriteBrandSelectors：基块必须命中明暗两轨，否则暗色下非配色令牌整批消失）。
const brandCss = presetIds
  .map(id => rewriteBrandSelectors(brand.brandCssText(id), {
    baseSelector: `html[data-cs-preset="${id}"]`,
    darkSelector: `html:not([data-light])[data-cs-preset="${id}"]`,
  }))
  .join('\n\n')

await reportTokenCoverage(`preview-rail [${defaultPreset}]`, brand.brandCssText(defaultPreset), HOST_TOKENS_DARK)

/**
 * hover 态的呈现办法：把这两条规则的**选择器**换成 .pvHover，声明一字不改。
 *
 * 为什么不能自己写一条「像 hover 的样式」：那样验收台验的是验收台自己的猜测。
 * 而 `:hover` 没法在静态预览里触发（无头 Chrome 不派发鼠标事件），所以只换
 * 选择器 —— 文本仍来自产品那一份，改了样式预览就跟着变。
 */
const hoverDemoCss = (studioStyles.match(/\.csProjectItem:hover[^{]*\{[^}]*\}/g) ?? [])
  .map(rule => rule.replace(/\.csProjectItem:hover/g, '.csProjectItem.pvHover'))
  .join('\n')

const hostCss = `:root {\n${renderTokenBlock(HOST_TOKENS_DARK)}\n}\nhtml[data-light] {\n${renderTokenBlock(HOST_TOKENS_LIGHT)}\n}`

/* ------------------------------------------------------------------ DOM 片段 */

/** 项目卡的骨架（与 ProjectList.tsx 的 renderRows 同构）。 */
const projectCard = ({
  name, initial, tone, stage, plan, time, cls = '', menuOpen = false,
}) => {
  const segments = [
    `<span class="csProjectStage">${stage}</span>`,
    plan === null ? '' : `<span class="csProjectSubText">${plan}</span>`,
    time === null ? '' : `<span class="csProjectSubText">${time}</span>`,
  ].filter(Boolean)
  return `
        <div class="csProjectItem${cls === '' ? '' : ` ${cls}`}">
          <span class="csProjectCover csCoverTone${tone}" aria-hidden="true">${initial}</span>
          <span class="csProjectMeta">
            <span class="csProjectName">${name}</span>
            <span class="csProjectSub">${segments
    .map((segment, index) => (index > 0 ? '<span class="csProjectSubSep">·</span>' : '') + segment)
    .join('')}</span>
          </span>
          <span class="csProjectRowActions">
            <button type="button" class="csProjectMenuBtn">⋯</button>
          </span>
        </div>${menuOpen
    ? `
        <div class="csContextMenu pvMenuStatic" role="menu">
          <span class="csMenuLabel">移动到分组</span>
          <button type="button" class="csMenuAction csMenuActionActive"><span>未分组</span><span class="csMenuActionMark">✓</span></button>
          <button type="button" class="csMenuAction"><span>品牌宣传片</span></button>
          <button type="button" class="csMenuAction"><span>实验</span></button>
          <button type="button" class="csMenuAction csMenuActionDanger"><span>删除项目</span></button>
        </div>`
    : ''}`
}

/** 分组头骨架（与 ProjectList.tsx 的 renderSection 同构）。 */
const groupHeader = (name, count, expanded = true) => `
          <div class="csProjectGroupHeader">
            <button type="button" class="csProjectGroupToggle" aria-expanded="${expanded}">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.6 4.4 6 7.8l3.4-3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <span class="csProjectGroupName">${name}</span>
            <span class="csProjectGroupCount">${count}</span>
            <span class="csProjectGroupActions">
              <button type="button" class="csProjectGroupAdd">+</button>
              <button type="button" class="csProjectGroupDelete">×</button>
            </span>
          </div>`

/** 整栏骨架（品牌条 → 段头 → 列表 → 用户卡）。 */
const railFull = () => `
      <aside class="csProjects">
        <div class="csBrandHeader">
          <span class="csLogoMark" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 32 32" fill="none"><rect x="2" y="2" width="28" height="28" rx="8" fill="var(--cs-accent, #7C6CFF)"/><rect x="7" y="13" width="18" height="4" fill="var(--cs-shell, #15171E)"/></svg>
          </span>
          <div class="csBrandMeta">
            <span class="csBrandName">Canvas Studio</span>
            <span class="csBrandSub">创意工厂</span>
          </div>
          <button type="button" class="csBrandCollapse" title="收起项目栏" aria-label="收起项目栏">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.5 4.5 6 8l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M2.5 3.5v9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div class="csProjectsScroll">
          <header class="csProjectsHeader">
            <span class="csProjectsHeaderTitle">项目</span>
            <span class="csProjectsHeaderActions"><button type="button">刷新</button></span>
          </header>
          <div class="csProjectList">
            <div class="csProjectListActions">
              <button type="button" class="csProjectNew">+ 新建项目</button>
              <button type="button" class="csProjectNewIcon" title="新建分组" aria-label="新建分组">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.6 4.2A1.6 1.6 0 0 1 3.2 2.6h3l1.4 1.7h5.2a1.6 1.6 0 0 1 1.6 1.6v6a1.6 1.6 0 0 1-1.6 1.6H3.2a1.6 1.6 0 0 1-1.6-1.6V4.2Z" stroke="currentColor" strokeWidth="1.3"/><path d="M8 7.2v4M6 9.2h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              </button>
            </div>
            <div class="csProjectGroup">
${groupHeader('品牌宣传片', 2)}
${projectCard({ name: '赛博朋克 30s', initial: '赛', tone: 1, stage: '关键帧', plan: '16:9 · 30s', time: '3 小时前', cls: 'csProjectItemActive' })}
${projectCard({ name: '春节贺岁短片', initial: '春', tone: 2, stage: '分镜', plan: '9:16 · 60s', time: '昨天', cls: 'pvHover', menuOpen: true })}
            </div>
            <div class="csProjectGroup">
${groupHeader('实验', 1)}
${projectCard({ name: '测试 A', initial: '测', tone: 4, stage: '剧本', plan: null, time: '5 天前' })}
            </div>
            <div class="csProjectGroup">
${groupHeader('未分组', 1)}
${projectCard({ name: '老项目-草稿', initial: '老', tone: 6, stage: '成片', plan: '16:9 · 15s', time: '09/01' })}
            </div>
            <div class="csProjectGroup">
${groupHeader('归档', 3, false)}
            </div>
          </div>
        </div>
        <div class="csUser">
          <button type="button" class="csUserBar" aria-expanded="false">
            <svg class="csUserAvatar" width="30" height="30" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="18" fill="var(--cs-accent, #6c5ce7)"/><text x="18" y="24" textAnchor="middle" fontSize="16" fontWeight="600" fill="#fff">林</text></svg>
            <span class="csUserBarMeta">
              <span class="csUserBarName">林小满</span>
              <span class="csUserBarSub">个人账号</span>
            </span>
          </button>
        </div>
      </aside>`

/** 收起态骨架（与 RailStrip.tsx 同构）。 */
const railStrip = () => {
  const chips = [
    ['赛博朋克 30s', '赛', 1, 'csRailChipActive'],
    ['春节贺岁短片', '春', 2, ''],
    ['测试 A', '测', 4, ''],
    ['老项目-草稿', '老', 6, ''],
  ]
  return `
      <aside class="csProjects">
        <div class="csRailStrip">
          <button type="button" class="csRailStripBrand" title="展开项目栏">
            <svg width="20" height="20" viewBox="0 0 32 32" fill="none"><rect x="2" y="2" width="28" height="28" rx="8" fill="var(--cs-accent, #7C6CFF)"/><rect x="7" y="13" width="18" height="4" fill="var(--cs-shell, #15171E)"/></svg>
          </button>
          <div class="csRailStripList">
${chips.map(([name, initial, tone, cls]) => `            <button type="button" class="csRailChip${cls === '' ? '' : ` ${cls}`}" title="${name}"><span class="csRailChipFace csCoverTone${tone}">${initial}</span></button>`).join('\n')}
          </div>
          <button type="button" class="csRailStripUser" title="展开项目栏">
            <svg class="csUserAvatar" width="26" height="26" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="18" fill="var(--cs-accent, #6c5ce7)"/><text x="18" y="24" textAnchor="middle" fontSize="16" fontWeight="600" fill="#fff">林</text></svg>
          </button>
        </div>
      </aside>`
}

/* ------------------------------------------------------------------ 页面 */

const html = `<!DOCTYPE html>
<html lang="zh-CN" data-cs-preset="${defaultPreset}">
<head>
<meta charset="utf-8">
<title>左栏整栏验收台（DD-08）</title>
<style>
${hostCss}

${brandCss}

/* ---- 真实产品样式（从 styles.ts 抽取，未改动一行） ---- */
${studioStyles}

/* ---- hover 演示：只换了选择器，声明一字未改（见脚本注释） ---- */
${hoverDemoCss}

/* ---- 本页的舞台样式（只负责摆放，不参与任何被断言的外观） ---- */
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 20px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
}
.pvBar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 16px; }
.pvBar h1 { font-size: 15px; margin: 0 12px 0 0; font-weight: 600; }
.pvBar button {
  font: inherit; font-size: 12px; padding: 5px 10px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-primary);
}
.pvBar button[aria-pressed="true"] { border-color: var(--cs-accent, #7C6CFF); color: var(--cs-accent, #7C6CFF); }
.pvHint { font-size: 12px; color: var(--dsw-alias-label-tertiary); margin: 0 0 20px; }
.pvRow { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 28px; }
.pvTones { display: flex; align-items: center; gap: 8px; }
.pvItem { display: flex; flex-direction: column; gap: 8px; }
.pvItem > .pvLabel { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
/* 三栏容器：给足宽度让 grid-template-columns 的取值在真实条件下被测量。 */
.pvViewport { width: 1100px; height: 700px; }
.pvViewportStrip { width: 1100px; height: 380px; }
/* 只做排版占位。**不能设 background** —— 画布底色是「三档空间」里被断言的一档，
   本页自己设一次就等于把断言的目标换成了本页样式。 */
.pvCanvasPlaceholder {
  display: grid; place-items: center; font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}
/* 菜单在真实产品里是 fixed + 内联坐标；静态预览里让它贴着卡片显示。 */
.pvMenuStatic { position: static !important; margin: 4px 0 0 42px; }
.pvCheck {
  margin-top: 24px; padding: 12px 14px; font-size: 12px; line-height: 1.7;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
#pvVerdict { display: none; }
</style>
</head>
<body>
<div class="pvBar">
  <h1>左栏整栏验收台 · DD-08</h1>
  <button type="button" id="pvTheme" aria-pressed="false">明暗</button>
  <span id="pvPresets"></span>
</div>
<p class="pvHint">主题与预设切换后页面会重载（自检读 computedStyle，必须重跑）。hover 态用选择器重写呈现，声明与产品同源。</p>

<div class="pvRow">
  <div class="pvItem">
    <span class="pvLabel">完整态（280px，三栏栅格真实测量）</span>
    <div class="pvViewport">
      <div class="csFrame" data-mode="work" data-rail="full">
${railFull()}
        <main class="csCanvas pvCanvasPlaceholder">画布（占位）</main>
      </div>
    </div>
  </div>
  <div class="pvItem">
    <span class="pvLabel">收起态（56px 缩略条）</span>
    <div class="pvViewportStrip">
      <div class="csFrame" data-mode="work" data-rail="strip">
${railStrip()}
        <main class="csCanvas pvCanvasPlaceholder">画布（占位）</main>
      </div>
    </div>
  </div>
</div>

<div class="pvRow" style="margin-top: 20px">
  <div class="pvItem">
    <span class="pvLabel">封面六档底色（--cs-cover-1..6，值从品牌色现场混出，随预设与明暗自动变）</span>
    <div class="pvTones">
${[1, 2, 3, 4, 5, 6].map(tone => `      <span class="csProjectCover csCoverTone${tone}" aria-hidden="true">${tone}</span>`).join('\n')}
    </div>
  </div>
  <div class="pvItem">
    <span class="pvLabel">动作区主次（实底主按钮 vs 透明图标按钮）</span>
    <div class="pvTones">
      <button type="button" class="csProjectNew" style="flex: 0 0 auto; width: 130px">+ 新建项目</button>
      <button type="button" class="csProjectNewIcon" title="新建分组" aria-label="新建分组">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.6 4.2A1.6 1.6 0 0 1 3.2 2.6h3l1.4 1.7h5.2a1.6 1.6 0 0 1 1.6 1.6v6a1.6 1.6 0 0 1-1.6 1.6H3.2a1.6 1.6 0 0 1-1.6-1.6V4.2Z" stroke="currentColor" strokeWidth="1.3"/><path d="M8 7.2v4M6 9.2h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
      </button>
    </div>
  </div>
</div>


<div class="pvCheck" id="pvCheck">自检运行中…</div>
<pre id="pvVerdict"></pre>

<script>
(function () {
  'use strict'
  // 主题必须**先**落到 DOM 上，自检才读得到（自检读的是 computedStyle）。这一步
  // 此前在页面尾部的按钮脚本里，于是浅色变体的自检跑的是**暗色**的 DOM ——
  // 变体矩阵里标着「浅色」的那组实际上一直在测暗色，通过与否都无意义。
  var params = new URLSearchParams(location.search)
  var theme = params.get('theme') === 'light' ? 'light' : 'dark'
  document.documentElement.toggleAttribute('data-light', theme === 'light')

  // 自检的失败也必须是一个 FAIL —— 未捕获异常若只留在控制台，页面会永远停在
  // 「自检运行中…」，看起来像没跑（静默失败最难查）。
  var lines = []
  var fail = 0
  function check(label, ok, detail) {
    lines.push((ok ? '\\u2705 ' : '\\u274c ') + label + (detail ? '  \\u2192 ' + detail : ''))
    if (!ok) fail += 1
  }
  function cs(selector, prop) {
    var el = document.querySelector(selector)
    if (el === null) throw new Error('选择器匹配空集：' + selector)
    return getComputedStyle(el).getPropertyValue(prop).trim()
  }

  try {
    /* ---- 令牌必须真的解析出值（「声明躺在文件里」与「页面上生效」是两件事） ---- */
    var tokenNames = [
      '--cs-shell', '--cs-shell-2', '--cs-float', '--cs-line', '--cs-accent',
      '--cs-accent-soft', '--cs-glow-accent', '--cs-fs-xs', '--cs-fs-sm', '--cs-fs-md',
      '--cs-space-1', '--cs-radius-sm', '--cs-radius-md', '--cs-radius-lg',
      '--cs-duration-fast', '--cs-ease', '--cs-cover-1', '--cs-cover-6', '--cs-canvas-bg',
    ]
    var bodyStyle = getComputedStyle(document.body)
    var emptyTokens = tokenNames.filter(function (name) { return bodyStyle.getPropertyValue(name).trim() === '' })
    check('关键令牌在浏览器里全部可解析', emptyTokens.length === 0, emptyTokens.join(' '))

    /* ---- R8：两种栅格形态是真实测量的，不是覆盖出来的 ---- */
    var fullCols = cs('.csFrame[data-rail="full"]', 'grid-template-columns')
    check('完整态第一列 = 280px', fullCols.split(' ')[0] === '280px', fullCols)

    var stripCols = cs('.csFrame[data-rail="strip"]', 'grid-template-columns')
    check('收起态第一列 = 56px', stripCols.split(' ')[0] === '56px', stripCols)

    var stripMin = cs('.csFrame[data-rail="strip"]', 'min-width')
    check('收起态 min-width 下移到 696px（否则收起反而多出横向滚动条）', stripMin === '696px', stripMin)

    /* ---- R1：层级反转 —— 容器不得比内容响 ---- */
    var groupSize = parseFloat(cs('.csProjectGroupName', 'font-size'))
    var projSize = parseFloat(cs('.csProjectName', 'font-size'))
    check('分组名字号 < 项目名字号（层级反转）', groupSize < projSize, groupSize + 'px vs ' + projSize + 'px')

    var groupColor = cs('.csProjectGroupName', 'color')
    var projColor = cs('.csProjectName', 'color')
    check('分组名与项目名不同色（次级色生效）', groupColor !== projColor, groupColor + ' vs ' + projColor)

    /* ---- R1：令牌收口 ----
       壳层 / 浮层的「可区分性」判定在文件末尾的「主题敏感」段里分主题写
       （暗色靠明度档，浅色靠描边 + 投影）—— 这里只取色值供后续复用。 */
    var shellBg = cs('.csProjects', 'background-color')
    var menuBg = cs('.csContextMenu', 'background-color')

    var hoverBg = cs('.csProjectItem.pvHover', 'background-color')
    check('hover 行底色 ≠ 壳色（--cs-shell-2 生效）', hoverBg !== shellBg, hoverBg)

    /* ---- R3：封面六档真的有六个颜色，且方阵是 34px ---- */
    var coverBox = document.querySelector('.csProjectCover')
    var coverW = coverBox.getBoundingClientRect().width
    check('封面 34px 方阵', Math.round(coverW) === 34, String(Math.round(coverW)))

    var tones = []
    for (var i = 1; i <= 6; i += 1) tones.push(cs('.csCoverTone' + i, 'background-color'))
    var allOpaque = tones.every(function (value) { return value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent' })
    check('六档封面底色都非透明', allOpaque, tones.join(' | '))
    var unique = {}
    tones.forEach(function (value) { unique[value] = true })
    check('六档封面底色互不相同', Object.keys(unique).length === 6, Object.keys(unique).length + '/6')

    /* ---- R2：kebab 默认隐藏、hover 显现；行内 select 已不存在 ----
       注意 idle 行的选择器要排除 Active（选中行的 kebab 是常驻可见的，这是
       CV-070 的既有决定）与 pvHover（演示行），否则这条断言在测别的规则。 */
    var idleRow = '.csProjectItem:not(.csProjectItemActive):not(.pvHover)'
    check('kebab 默认 opacity 0', cs(idleRow + ' .csProjectMenuBtn', 'opacity') === '0')
    check('hover 行里 kebab 显现', cs('.csProjectItem.pvHover .csProjectMenuBtn', 'opacity') === '1')
    check('选中行的 kebab 常驻可见', cs('.csProjectItemActive .csProjectMenuBtn', 'opacity') === '1')
    check('行内原生 select 已移除', document.querySelector('.csProjectMove') === null)

    var activeBorder = cs('.csProjectItemActive', 'border-left-color')
    var idleBorder = cs(idleRow, 'border-left-color')
    check('选中行左缘是 accent 边线（≠ 空行的透明边）',
      activeBorder !== idleBorder && activeBorder !== 'rgba(0, 0, 0, 0)', activeBorder)

    /* ---- R4：箭头旋转 + 计数独立成列 ---- */
    var expandFalse = document.querySelector('.csProjectGroupToggle[aria-expanded="false"]')
    check('折叠态箭头被旋转（transform ≠ none）',
      expandFalse !== null && getComputedStyle(expandFalse.querySelector('svg')).transform !== 'none')
    var countFloat = cs('.csProjectGroupCount', 'text-align')
    check('分组计数右对齐', countFloat === 'right', countFloat)

    /* ---- R5：主次对比 —— 主按钮实底、图标按钮透明底 ---- */
    var primaryBg = cs('.csProjectNew', 'background-color')
    var iconBg = cs('.csProjectNewIcon', 'background-color')
    check('主按钮是实底', primaryBg !== 'rgba(0, 0, 0, 0)' && primaryBg !== 'transparent', primaryBg)
    check('图标按钮是透明底（不与主按钮抢）', iconBg === 'rgba(0, 0, 0, 0)', iconBg)

    /* ---- R6：用户卡副行 ---- */
    check('用户条名 13px', parseFloat(cs('.csUserBarName', 'font-size')) === 13)
    check('用户条副行 11px', parseFloat(cs('.csUserBarSub', 'font-size')) === 11)

    /* ---- 副行三段：某一段为空时不留悬空分隔符 ----
       「测试 A」在骨架里 plan 为空（未锁定规格），所以它的副行只能有一个分隔符。
       断言总数没有判别力（改一行数据就变），断言这一行才有。 */
    var planlessRow = null
    var rows = document.querySelectorAll('.csProjectItem')
    for (var r = 0; r < rows.length; r += 1) {
      if (rows[r].textContent.indexOf('测试 A') >= 0) planlessRow = rows[r]
    }
    check('规格为空的行只剩 1 个分隔符（空段不留悬空符）',
      planlessRow !== null && planlessRow.querySelectorAll('.csProjectSubSep').length === 1,
      planlessRow === null ? '找不到测试行' : String(planlessRow.querySelectorAll('.csProjectSubSep').length))

    /* ---- 收起态：色块方阵尺寸 ---- */
    var chip = document.querySelector('.csRailChip')
    check('缩略色块 40×40', Math.round(chip.getBoundingClientRect().width) === 40 && Math.round(chip.getBoundingClientRect().height) === 40)
    check('收起态首尾分别是品牌标与用户头像',
      document.querySelector('.csRailStripBrand') !== null && document.querySelector('.csRailStripUser') !== null)

    /* ---- 主题敏感：三档空间的判定必须**分主题**写 ----
       浅色下 --cs-shell 与 --cs-float 都是 #FFFFFF（同一支白），「浮层 ≠ 壳」在浅色
       本来就不成立 —— 它靠描边与投影区分。把「三档互不相同」写成一条不分主题的
       断言，会得到一个只在暗色为真、一切浅色就假红的守卫。
       真正该守的是「**浮层必须能与壳区分**」，两种主题各用自己的手段实现。 */
    var isLight = document.documentElement.hasAttribute('data-light')
    var canvasBg = cs('.csCanvas', 'background-color')
    check('画布与壳不同档（画布必须最深）', canvasBg !== shellBg, canvasBg + ' vs ' + shellBg)
    check('浮层有投影（浅色下与壳同白，靠它区分）', cs('.csContextMenu', 'box-shadow') !== 'none')
    check('浮层可区分于壳：暗色比壳亮一档 / 浅色与壳同白但带投影',
      isLight ? menuBg === shellBg && cs('.csContextMenu', 'box-shadow') !== 'none' : menuBg !== shellBg,
      (isLight ? 'light ' : 'dark ') + menuBg + ' vs ' + shellBg)
  } catch (e) {
    fail += 1
    lines.push('THROW 自检中断 \\u2192 ' + (e && e.message ? e.message : 'unknown'))
  }

  var verdict = '# 左栏整栏验收台 \\
' + '预设=' + document.documentElement.getAttribute('data-cs-preset') + ' 主题=' +
    (document.documentElement.hasAttribute('data-light') ? 'light' : 'dark') + ' \\
' + lines.join('\\
')
  var pre = document.getElementById('pvVerdict')
  if (pre) pre.textContent = verdict
  document.documentElement.setAttribute('data-pv-fail', String(fail))
  var card = document.getElementById('pvCheck')
  if (card) card.textContent = (fail === 0 ? '\\u2705 全部通过' : '\\u274c ' + fail + ' 条失败') + '\\
\\
' + lines.join('\\
')
})()
</script>

<script>
(function () {
  'use strict'
  // 主题**不在这里应用** —— 它在自检脚本开头（必须在自检读 computedStyle 之前）。
  // 这里只负责按钮的呈现与跳转。
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
console.log(`✓ ${outPath}`)
