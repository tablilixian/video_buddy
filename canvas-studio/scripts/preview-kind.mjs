/**
 * CV-197 验收台：**节点类型的色彩身份**（五处表面共用一份判据）。
 *
 * ## 为什么值得单开一组
 *
 * 这一批把「图 / 视频 / 音频」三色从「每种元素各写一遍」收敛成
 * `labels.ts` 的 `KIND_ACCENT` + `styles.ts` 的一组 `.csKind*` 变量，五处表面
 * （画布卡片 / 图层面板 / 时间轴 chip / 参考托盘 / 详情抽屉）各自只消费
 * `--cs-kind`。三类风险只有真机跑才看得见：
 *
 * 1. **类挂上去了但样式没生效**。`.csNodeHeadKind` 的基础规则在本文件更下面，
 *    `.csTlRefChip` 自带金底 —— 新规则若被它们压过，源码里一行不差，页面全无变化。
 * 2. **三色其实在浏览器里解析成同一个色**。`color-mix` 写错百分比、令牌缺失
 *    回落成同一个兜底值，静态检查永远发现不了。
 * 3. **「有彩边 = 有画面」这条扫读规则被非媒体节点污染**。文本 / 便签 / 分组
 *    不该有彩边 —— 这一条只能靠**对照帧**证明。
 *
 * ## 页内自带两处对照（本仓规矩：新守卫必须能红）
 *
 * - **每组第四帧**：不带任何 `.csKind*` 类（文本 / 对照）。三色断言若连它都判成
 *   「有色」，说明判的不是那个类，必须红。
 * - **时间轴 chip 的底色**：金底 = 轨道身份，左缘条 = 类型身份。断言「三帧底色
 *   相同且都不是类型色」—— 若有人图省事把底色换成类型色，这条会红（那等于用
 *   类型色顶掉了更上位的「这条是参考·产物轨」语义）。
 *
 * ## 一条容易被误读的现状（写在这里，免得下次当成漏做）
 *
 * 「图片」牌面与「文本」牌面**同色**：非媒体节点的牌面走 `.csNodeHeadKind` 的
 * 基础规则（accent-soft 底 + accent 字），是本批之前就有的观感，本批不动它。
 * 于是图片与文本靠**卡片描边**分（图片 accent 描边 / 文本中性灰），
 * 图片与视频靠**牌面 + 描边**分 —— 两条断言分别守着这两件事。
 *
 * ## 为什么不调用 `tokenProbe()`
 *
 * 那一族的收尾钩子自带 `#pvVerdict` 并会覆盖本页判决。本仓自定义自检的台子
 * 一律不调它。
 *
 * 用法：node scripts/preview-kind.mjs [输出路径]
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
const outPath = process.argv[2] ?? join(outDir, 'kind-accent-preview.html')
await mkdir(outDir, { recursive: true })

const studioStyles = await readStudioStyles()
const brandCss = await brandTokensCss()
const presetId = await defaultPresetId()
await reportTokenCoverage('preview-kind', brandCss, HOST_TOKENS_DARK)

const hostCss = `:root {\n${renderTokenBlock(HOST_TOKENS_DARK)}\n}\nhtml[data-light] {\n${renderTokenBlock(HOST_TOKENS_LIGHT)}\n}`

/* ---------------------------------------------------------------- DOM 片段 */

/**
 * 四帧的 kind 取值。`none` = **对照帧**：文本节点，一个 `.csKind*` 都不挂。
 * 骨架与真实组件（CanvasNode / LayerPanel / CanvasTimeline / ReferenceTray /
 * NodeDetailDrawer）逐项对齐；差异只有「没有数据」这一层。
 */
const FRAMES = [
  { key: 'image', cls: 'csKindImage', label: '图片' },
  { key: 'video', cls: 'csKindVideo', label: '视频' },
  { key: 'audio', cls: 'csKindAudio', label: '音频' },
  { key: 'none', cls: '', label: '文本（对照：无身份类）' },
]

const cls = frame => frame.cls === '' ? '' : ` ${frame.cls}`

/** 卡片：头（类型牌 + 标题）+ 媒体框 + 脚。 */
const cardHtml = frame => `
        <div class="csNode${cls(frame)}" id="pvCard-${frame.key}" style="position:relative;left:auto;top:auto;width:180px;height:132px;transform:none">
          <div class="csNodeHead">
            <span class="csNodeHeadKind">${frame.key === 'video' ? '<span class="csNodeHeadKindMark" aria-hidden>\u25b6</span>' : ''}${frame.label}</span>
            <span class="csNodeHeadTitle">关键帧</span>
          </div>
          <div class="csNodeMediaBox pvKindMediaBox"></div>
          <div class="csNodeFoot"><span class="csNodeFootReadings">16:9</span></div>
          <span class="pvKindProbe" id="pvProbe-${frame.key}" aria-hidden></span>
        </div>`

/** 图层面板行：缩略块 + 标题（骨架对齐 LayerPanel.renderRow）。 */
const layerRowHtml = frame => `
        <div class="csLayerRow${cls(frame)}" id="pvLayer-${frame.key}" style="padding-left:6px">
          <span class="csLayerThumb"><span class="csLayerThumbKind">${frame.label}</span></span>
          <span class="csLayerTitle">${frame.label}节点</span>
        </div>`

/** 时间轴「参考·产物」轨的 chip（骨架对齐 CanvasTimeline 的 csTlRefChip）。 */
const chipHtml = frame => `
        <span class="csTlRefChip${cls(frame)}" id="pvChip-${frame.key}">${frame.label} · 林晚</span>`

/** 参考托盘项（骨架对齐 ReferenceTray 的 csReferenceItem）。 */
const refItemHtml = frame => `
        <div class="csReferenceItem${cls(frame)}" id="pvRef-${frame.key}">
          <span class="csReferenceThumb"></span>
          <div class="csReferenceMeta">
            <div class="csReferenceTitleRow"><span class="csReferenceTitle">${frame.label}</span></div>
          </div>
        </div>`

/** 详情抽屉：只需要头（类型牌 + 标题）+ 一个体区撑高度。 */
const drawerHtml = frame => `
        <div class="csDetailDrawer${cls(frame)}" id="pvDrawer-${frame.key}" style="position:static;height:64px">
          <header class="csDetailDrawerHead">
            <span class="csDetailDrawerKind">${frame.label} · 关键帧</span>
            <span class="csDetailDrawerTitle">关键帧</span>
          </header>
        </div>`

const framesHtml = (render) => FRAMES
  .map(frame => `    <div class="pvCell"><b>${frame.label}</b>${render(frame)}</div>`)
  .join('\n')

const html = `<!doctype html>
<html lang="zh-CN" data-cs-preset="${presetId}">
<head>
<meta charset="utf-8" />
<title>Canvas Studio · 节点类型色彩身份验收台（CV-197）</title>
<style>
${hostCss}

${brandCss}

/* ---- 真实产品样式（从 styles.ts 抽取，未改动一行） ---- */
${studioStyles}

/* ---- 本页舞台样式：只负责摆放与探针，不参与任何被断言的外观 ---- */
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
/* 卡片在真实产品里由 translate3d 定位；静态台里让它就位显示。 */
.pvKindMediaBox { background: linear-gradient(135deg, #2b2f3a, #4a5162); }
.csReferenceThumb { display: block; background: #3a3f4c; }
/* 令牌参考色板：把 var() 解析成 computed color（三色判据的「标准答案」）。 */
.pvKindSwatch { display: inline-block; width: 46px; height: 16px; border-radius: 4px;
  border: 1px solid var(--dsw-alias-border-l2); background: currentColor; vertical-align: middle; }
/* 变量探针：卡片内一枚不可见 span，只为读 --cs-kind 解析后的色值。
   它不参与任何观感断言之外的东西 —— 尺寸 0 也不影响卡片几何。 */
.pvKindProbe { display: block; width: 0; height: 0; color: var(--cs-kind); }
.pvCheck { margin-top: 20px; padding: 12px 14px; font-size: 12px; line-height: 1.7;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; white-space: pre-wrap; }
#pvVerdict { display: none; }
</style>
</head>
<body>
<h1>节点类型色彩身份验收台</h1>
<p class="pvHint">
  样式取自 <code>src/client/styles.ts</code> 原文（非仿制）。每组四帧：图 / 视频 /
  音频 + **对照帧（文本，不带身份类）**。判据标准答案 = 三枚令牌色板
  <span class="pvKindSwatch" id="pvSwatchImage" style="color: var(--cs-accent)"></span>
  <span class="pvKindSwatch" id="pvSwatchVideo" style="color: var(--cs-teal)"></span>
  <span class="pvKindSwatch" id="pvSwatchAudio" style="color: var(--cs-gold)"></span>
</p>

<div class="pvSection">
  <h2>A · 画布卡片：染色描边 + 类型牌（不改几何）</h2>
  <div class="pvRow">
${framesHtml(cardHtml)}
  </div>
</div>

<div class="pvSection">
  <h2>B · 图层面板行：左缘 3px 色条 + 缩略块牌面</h2>
  <div class="pvRow">
${framesHtml(layerRowHtml)}
  </div>
</div>

<div class="pvSection">
  <h2>C · 时间轴 chip：金底 = 轨道身份，左缘条 = 类型身份（两个正交信号）</h2>
  <div class="pvRow">
${framesHtml(chipHtml)}
  </div>
</div>

<div class="pvSection">
  <h2>D · 参考托盘项：左缘 3px 色条</h2>
  <div class="pvRow">
${framesHtml(refItemHtml)}
  </div>
</div>

<div class="pvSection">
  <h2>E · 详情抽屉头：类型牌染成身份色</h2>
  <div class="pvRow">
${framesHtml(drawerHtml)}
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

  // 四帧的 key（图 / 视频 / 音频 / 对照）由生成器注入 —— 台子与断言共用同一份，
  // 免得改名时一边改一边忘。
  var FRAME_KEYS = ${JSON.stringify(FRAMES.map(frame => frame.key))}

  var lines = []
  var fail = 0
  function check(label, ok, detail) {
    lines.push((ok ? '\\u2705 ' : '\\u274c ') + label + (detail ? '  \\u2192 ' + detail : ''))
    if (!ok) fail += 1
  }
  function el(selector) {
    var node = document.querySelector(selector)
    if (node === null) throw new Error('选择器没匹配到元素：' + selector)
    return node
  }
  function cs(selector, prop) {
    return getComputedStyle(el(selector)).getPropertyValue(prop).trim()
  }
  /** 从 box-shadow 里抠出第一个颜色（inset 左缘条就是这么读的）。 */
  function shadowColor(selector) {
    var raw = cs(selector, 'box-shadow')
    var match = raw.match(/rgba?\\([^)]+\\)/)
    return match === null ? raw : match[0]
  }
  var COLOR_RE = /^rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)/

  try {
    /* ---- 标准答案：三枚令牌在浏览器里真的解析出了三种颜色 ---- */
    var token = {
      image: cs('#pvSwatchImage', 'color'),
      video: cs('#pvSwatchVideo', 'color'),
      audio: cs('#pvSwatchAudio', 'color'),
    }
    var tokenValues = [token.image, token.video, token.audio]
    check('三枚令牌（accent / teal / gold）在浏览器里都解析出了非空色值',
      tokenValues.every(function (value) { return COLOR_RE.test(value) }),
      tokenValues.join(' | '))
    check('三枚令牌互不相同 —— 否则「三色区分」从标准答案起就不成立',
      new Set(tokenValues).size === 3,
      tokenValues.join(' | '))

    /* ---- 每一组：三帧挂类、第四帧不挂 ---- */
    var GROUPS = [
      { name: 'A 画布卡片', prefix: '#pvCard-', read: function (key) { return cs('#pvCard-' + key, 'border-top-color') } },
      { name: 'B 图层面板行', prefix: '#pvLayer-', read: function (key) { return shadowColor('#pvLayer-' + key) } },
      { name: 'C 时间轴 chip', prefix: '#pvChip-', read: function (key) { return shadowColor('#pvChip-' + key) } },
      { name: 'D 参考托盘项', prefix: '#pvRef-', read: function (key) { return shadowColor('#pvRef-' + key) } },
      { name: 'E 详情抽屉牌', prefix: '#pvDrawer-', read: function (key) { return cs('#pvDrawer-' + key + ' .csDetailDrawerKind', 'color') } },
    ]

    GROUPS.forEach(function (group) {
      var classes = ['csKindImage', 'csKindVideo', 'csKindAudio']
      var classOk = FRAME_KEYS.every(function (key, index) {
        var node = document.querySelector(group.prefix + key)
        if (node === null) return false
        var want = index < 3 ? classes[index] : null
        return want === null
          ? !node.classList.contains('csKindImage') && !node.classList.contains('csKindVideo') && !node.classList.contains('csKindAudio')
          : node.classList.contains(want)
      })
      check(group.name + '：前三帧各挂一个身份类、对照帧一个都不挂',
        classOk,
        FRAME_KEYS.join(' / '))

      var imageColor = group.read('image')
      var videoColor = group.read('video')
      var audioColor = group.read('audio')
      var noneColor = group.read('none')

      check(group.name + '：三色互不相同（图 ≠ 视频 ≠ 音频）',
        new Set([imageColor, videoColor, audioColor]).size === 3,
        [imageColor, videoColor, audioColor].join(' | '))

      // 列表类表面（B/C/D）与抽屉牌（E）用的是**原令牌**，可以逐字节比；
      // A 卡片走 color-mix（混了描边灰），只比「互不相同 + ≠ 对照」。
      if (group.name !== 'A 画布卡片') {
        check(group.name + '：三色逐字节等于对应令牌（不是随手挑的三个色）',
          imageColor === token.image && videoColor === token.video && audioColor === token.audio,
          [imageColor, videoColor, audioColor].join(' | '))
      } else {
        check(group.name + '：三张卡的描边两两不同（color-mix 之后仍是三种颜色）',
          imageColor !== videoColor && videoColor !== audioColor && imageColor !== audioColor,
          [imageColor, videoColor, audioColor].join(' | '))
      }

      // 反向对照：不带类的那一帧必须与三色都不同 —— 否则上面判的不是那个类。
      check(group.name + '：对照帧（不带身份类）与三色都不同 —— 证明上面判的是那个类',
        noneColor !== imageColor && noneColor !== videoColor && noneColor !== audioColor,
        noneColor)
    })

    /* ---- 卡片的变量探针：类把 --cs-kind 设成了哪个令牌 ---- */
    check('卡片：.csKindImage 把 --cs-kind 设成了 accent',
      cs('#pvProbe-image', 'color') === token.image, cs('#pvProbe-image', 'color'))
    check('卡片：.csKindVideo 把 --cs-kind 设成了 teal',
      cs('#pvProbe-video', 'color') === token.video, cs('#pvProbe-video', 'color'))
    check('卡片：.csKindAudio 把 --cs-kind 设成了 gold',
      cs('#pvProbe-audio', 'color') === token.audio, cs('#pvProbe-audio', 'color'))

    /* ---- 类型牌：三色牌面互不相同（卡片头 / 图层缩略块 / 抽屉牌）---- */
    var pillImage = cs('#pvCard-image .csNodeHeadKind', 'color')
    var pillVideo = cs('#pvCard-video .csNodeHeadKind', 'color')
    var pillAudio = cs('#pvCard-audio .csNodeHeadKind', 'color')
    check('卡片类型牌：三色字色 = 三枚令牌',
      pillImage === token.image && pillVideo === token.video && pillAudio === token.audio,
      [pillImage, pillVideo, pillAudio].join(' | '))
    // ⚠️ 这里刻意**不**断言「对照帧牌面是灰色」：非媒体节点的牌面走的是
    // .csNodeHeadKind 的**基础规则**（accent-soft 底 + accent 字），那是本次
    // 改动之前就有的观感，本批不动它。于是「图片」与「文本」的牌面同色 ——
    // 它们靠**卡片描边**分（图片有 accent 描边，文本走中性灰线，见 A 组那条），
    // 而「图片 vs 视频」两张牌面一眼可分。这条断言要守的是**不外溢**：
    // 类型类只准影响挂了类的那一帧，别把相邻的对照帧也染色。
    check('卡片类型牌：对照帧（文本）落回基础牌面，与视频 / 音频的牌面都不同 —— 类型类不外溢',
      cs('#pvCard-none .csNodeHeadKind', 'color') !== pillVideo
      && cs('#pvCard-none .csNodeHeadKind', 'color') !== pillAudio,
      cs('#pvCard-none .csNodeHeadKind', 'color') + ' vs 视频 ' + pillVideo + ' / 音频 ' + pillAudio)
    check('卡片描边：图片与文本确实不同（图片 accent 描边 vs 文本中性灰）—— 牌面同色不影响区分',
      cs('#pvCard-image', 'border-top-color') !== cs('#pvCard-none', 'border-top-color'),
      cs('#pvCard-image', 'border-top-color') + ' vs ' + cs('#pvCard-none', 'border-top-color'))

    /* ---- 视频的形态标记：常驻 ▶ 只在视频帧出现 ---- */
    check('卡片：常驻 ▶ 只出现在视频帧（静止时也认得出是视频）',
      document.querySelectorAll('#pvCard-video .csNodeHeadKindMark').length === 1
      && document.querySelectorAll('#pvCard-image .csNodeHeadKindMark').length === 0
      && document.querySelectorAll('#pvCard-none .csNodeHeadKindMark').length === 0,
      'video=' + document.querySelectorAll('#pvCard-video .csNodeHeadKindMark').length
      + ' image=' + document.querySelectorAll('#pvCard-image .csNodeHeadKindMark').length)

    /* ---- 时间轴 chip：底色仍是金（轨道身份），不被类型色顶掉 ---- */
    var chipBgImage = cs('#pvChip-image', 'background-color')
    var chipBgVideo = cs('#pvChip-video', 'background-color')
    var chipBgAudio = cs('#pvChip-audio', 'background-color')
    check('时间轴 chip：三帧底色相同（金底 = 轨道身份，不随类型变）',
      chipBgImage === chipBgVideo && chipBgVideo === chipBgAudio,
      [chipBgImage, chipBgVideo, chipBgAudio].join(' | '))
    check('时间轴 chip：底色不是任何一种类型色 —— 两个信号正交，不是互相顶替',
      chipBgImage !== token.image && chipBgImage !== token.video && chipBgImage !== token.audio,
      chipBgImage)

    /* ---- 主题分轨：换主题不掉色 ---- */
    check((theme === 'light' ? '浅色' : '暗色') + '：明暗两轨下三色依然互不相同',
      new Set([token.image, token.video, token.audio]).size === 3
      && cs('#pvLayer-image', 'box-shadow') !== cs('#pvLayer-video', 'box-shadow'),
      [token.image, token.video, token.audio].join(' | '))

    /* ---- 几何账：类型身份不许改动任何盒模型尺寸 ---- */
    var cardBox = el('#pvCard-video').getBoundingClientRect()
    var cardBoxNone = el('#pvCard-none').getBoundingClientRect()
    check('卡片：挂了身份类之后宽高与对照帧一致（染色描边不动几何）',
      Math.abs(cardBox.width - cardBoxNone.width) <= 0.5 && Math.abs(cardBox.height - cardBoxNone.height) <= 0.5,
      Math.round(cardBox.width) + '×' + Math.round(cardBox.height) + ' vs '
      + Math.round(cardBoxNone.width) + '×' + Math.round(cardBoxNone.height))
    var rowBox = el('#pvLayer-video').getBoundingClientRect()
    var rowBoxNone = el('#pvLayer-none').getBoundingClientRect()
    check('图层行：左缘条走 inset 内阴影，行高与对照帧一致（不改盒模型）',
      Math.abs(rowBox.height - rowBoxNone.height) <= 0.5,
      Math.round(rowBox.height) + ' vs ' + Math.round(rowBoxNone.height))
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
