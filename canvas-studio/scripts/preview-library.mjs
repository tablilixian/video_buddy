/**
 * REQ-001：全局资产库页（csLib* overlay + 右侧详情抽屉 + 入库对话框）静态预览。
 *
 * 直接从 src/client/styles.ts 抽取 STUDIO_STYLES（含本轮新增的 csLib* 类），配一份
 * 最小 --dsw-alias-* / --cs-* 令牌表与骨架 DOM，输出单文件 HTML。用途：不开桌面就能
 * 肉眼验收 资产库全屏页 / 详情抽屉 / 入库对话框 的布局与配色。
 *
 * 页内自检（structural only —— 视觉美感最终判据是人，不做像素 diff）：
 *   1. overlay：position fixed + inset 全屏 + z-index 80（照 csSkillMarket 形态）；
 *   2. 详情抽屉贴 overlay 右缘，且左缘不越过左分类栏右缘（不压导航）；
 *   3. 入库对话框 backdrop (z=10) 盖住抽屉 (z=5) —— elementFromPoint 实测命中；
 *   4. `.csLibPrimary` 的 background 解析为**不透明实色**（防幽灵令牌回落到 transparent）；
 *   5. 卡片网格三张卡 cover 盒有真实高度（aspect-ratio 生效）；
 *   6. 关键 --cs-* 令牌在浏览器里可解析（本页自带自检，**不调 tokenProbe()** ——
 *      它的收尾钩子会覆盖本页判决，preview-create.mjs 头注释有完整说明）。
 *   7. 坏对照（必须失败才算对）：一个故意贴左、z=1 的假抽屉，同一套谓词必须判否 ——
 *      否则说明谓词恒真，比断言失败更危险。
 *
 * 用法：node scripts/preview-library.mjs [输出路径]
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  brandTokensCss,
  defaultPresetId,
  readStudioStyles,
  reportTokenCoverage,
  HOST_TOKENS_DARK,
} from './preview-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', '.workbuddy', 'preview')
const outPath = process.argv[2] ?? join(outDir, 'library-preview.html')
await mkdir(outDir, { recursive: true })

const studioStyles = await readStudioStyles()
const brandCss = await brandTokensCss()
const presetId = await defaultPresetId()
await reportTokenCoverage('preview-library', brandCss, HOST_TOKENS_DARK)

/** 1×1 灰色 PNG 的 data URI（走 <img> 路径，exercise object-fit: cover）。 */
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const card = (name, cat, color, glyph, img) => `
      <button type="button" class="csLibCard" data-card="${name}">
        <span class="csLibCover">
          ${img !== null ? `<img src="${IMG}" alt="${name}" />` : `<span class="csLibCoverGlyph" style="background: color-mix(in srgb, ${color} 26%, transparent)">${glyph}</span>`}
          <span class="csLibCoverBadge">${img !== null ? '3 图' : '1 图'} · 2 锚点</span>
        </span>
        <span class="csLibCardMeta">
          <span class="csLibCardName"><span class="csLibCatDot" style="background:${color}"></span>${name}</span>
          <span class="csLibCardSub">${cat} · 被引用 2 次 · 乌发杏眼，素白常服</span>
        </span>
      </button>`

const html = `<!doctype html>
<html lang="zh-CN" data-cs-preset="${presetId}">
<head>
<meta charset="utf-8" />
<title>Canvas Studio · 资产库页预览（REQ-001）</title>
<style>
  /* 宿主令牌（宿主契约，插件只读；预览给一份可用的值） */
  :root {
    --dsw-alias-bg-base: #14151a;
    --dsw-alias-bg-layer-1: #1b1d24;
    --dsw-alias-bg-layer-2: #23252e;
    --dsw-alias-bg-layer-3: #2c2f3a;
    --dsw-alias-border-l1: rgba(255,255,255,.06);
    --dsw-alias-border-l2: #34363f;
    --dsw-alias-border-l3: #454855;
    --dsw-alias-label-primary: #e8e9ee;
    --dsw-alias-label-secondary: #a2a5b4;
    --dsw-alias-label-tertiary: #777b8c;
    --dsw-alias-interactive-bg-hover: #262933;
    --dsw-alias-bg-hover: #262933;
    --dsw-alias-state-error-primary: #ff6b6b;
  }
  html[data-light] {
    --dsw-alias-bg-base: #ffffff;
    --dsw-alias-bg-layer-1: #f7f8fa;
    --dsw-alias-bg-layer-2: #eef0f4;
    --dsw-alias-bg-layer-3: #e4e7ee;
    --dsw-alias-border-l1: rgba(0,0,0,.06);
    --dsw-alias-border-l2: #dcdfe6;
    --dsw-alias-border-l3: #c8ccd6;
    --dsw-alias-label-primary: #17181d;
    --dsw-alias-label-secondary: #5b6070;
    --dsw-alias-label-tertiary: #8a8f9e;
    --dsw-alias-interactive-bg-hover: #eceef3;
    --dsw-alias-bg-hover: #eceef3;
  }
  html, body { height: 100%; margin: 0; }
  body {
    font: 13px/1.5 -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
    background: var(--dsw-alias-bg-base);
    color: var(--dsw-alias-label-primary);
  }
  .pvBar {
    display: flex; align-items: center; gap: 10px; padding: 8px 14px;
    border-bottom: 1px solid var(--dsw-alias-border-l2);
    background: var(--dsw-alias-bg-layer-1);
  }
  .pvBar strong { font-size: 13px; }
  .pvBar span { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
  /* 预览台自身的外壳：给 overlay 一个有界的舞台（overlay 是 fixed，占满视口）。 */
  .pvStage { position: relative; height: calc(100vh - 41px); }
</style>
<style>
/* 真实 --cs-* 令牌：派生自 lib/brand.js（产品里注入的就是这一份），不手抄。 */
${brandCss}

${studioStyles}
</style>
</head>
<body>
<div class="pvBar">
  <strong>Canvas Studio · 资产库页预览</strong>
  <span>REQ-001（overlay + 详情抽屉 + 入库对话框）· 页尾自检 = 结构断言，非像素验收</span>
</div>
<div class="pvStage">

<div class="csLibOverlay" id="pvOverlay" role="dialog" aria-modal="true" aria-label="资产库">
  <header class="csLibBar">
    <button type="button" class="csSkillMarketBack">← 返回</button>
    <h2 class="csSkillMarketTitle">资产库</h2>
    <span class="csSkillMarketCount">3 个资产 · 跨项目共用</span>
    <span class="csSkillMarketSpacer"></span>
    <input type="search" class="csSkillSearch" placeholder="搜索名称 / 别名 / 标签…" />
    <button type="button" class="csLibPrimary" id="pvPrimary">+ 上传图片</button>
  </header>
  <div class="csSkillMarketBody">
    <nav class="csSkillRail" aria-label="资产分类" id="pvRail">
      <button type="button" class="csSkillRailItem csSkillRailActive"><span>全部资产</span><span class="csSkillRailCount">3</span></button>
      <button type="button" class="csSkillRailItem"><span class="csLibCatDot" style="background:#35C2A6"></span><span>角色</span><span class="csSkillRailCount">1</span></button>
      <button type="button" class="csSkillRailItem"><span class="csLibCatDot" style="background:#4D9FFF"></span><span>场景</span><span class="csSkillRailCount">1</span></button>
      <button type="button" class="csSkillRailItem"><span class="csLibCatDot" style="background:#F5A742"></span><span>物件</span><span class="csSkillRailCount">1</span></button>
      <button type="button" class="csSkillRailItem"><span class="csLibCatDot" style="background:#9C6CFF"></span><span>群像</span><span class="csSkillRailCount">0</span></button>
      <p class="csLibRailHint">在画布节点右键「加入资产库」，或点右上角上传图片。</p>
    </nav>
    <div class="csLibContent">
      <div class="csLibFilterRow">
        <button type="button" class="csLibSortChip csLibSortActive">最近更新</button>
        <button type="button" class="csLibSortChip">被引用最多</button>
        <span class="csSkillMarketCount">3 条结果</span>
      </div>
      <div class="csLibGrid" id="pvGrid">${card('女主 Luna', '角色', '#35C2A6', '女主', IMG)}${card('雨夜巷弄', '场景', '#4D9FFF', '雨夜', null)}${card('青铜古剑', '物件', '#F5A742', '古剑', null)}</div>
    </div>
    <aside class="csLibDrawer" id="pvDrawer">
      <div class="csLibDrawerHead">
        <span>资产详情</span>
        <button type="button" class="csHistClose">✕</button>
      </div>
      <div class="csLibDrawerBody">
        <img class="csLibPreview" src="${IMG}" alt="女主 Luna" />
        <div class="csLibThumbs">
          <button type="button" class="csLibThumb csLibThumbOn">1</button>
          <button type="button" class="csLibThumb">2</button>
          <button type="button" class="csLibThumb">3</button>
        </div>
        <h3 class="csLibDrawerTitle">
          <span class="csLibCatDot" style="background:#35C2A6"></span>
          女主 Luna
          <span class="csLibPill" style="color:#35C2A6;border-color:#35C2A6">角色</span>
        </h3>
        <div class="csLibRow"><b>别名</b><span>Luna、女主</span></div>
        <div class="csLibRow"><b>描述</b><span>乌发杏眼，素白常服，左眉尾小痣</span></div>
        <div class="csLibRow"><b>标签</b><span>#主角 #古装</span></div>
        <div class="csLibRow"><b>引用</b><span>被 5 处使用</span></div>
        <div class="csLibRow"><b>句柄</b><code class="csLibHandle">@ref[lib:8f3a21]</code></div>
        <p class="csLibLocked">SAME: 20岁女性，乌黑长发束半髻，杏眼，素白交领常服。</p>
      </div>
      <div class="csLibDrawerActs">
        <button type="button" class="csLibPrimary">引用到对话</button>
        <button type="button" class="csSkillMarketBack">编辑</button>
        <button type="button" class="csLibDangerGhost">删除</button>
      </div>
    </aside>
  </div>
  <div class="csLibDialogBackdrop" id="pvDialogBackdrop">
    <div class="csLibDialog" role="dialog" aria-modal="true" aria-label="加入资产库" id="pvDialog">
      <h3 class="csLibDialogTitle">加入资产库</h3>
      <div class="csLibField">
        <span class="csLibFieldLabel">分类</span>
        <span class="csLibCategoryRow">
          <button type="button" class="csLibSortChip csLibSortActive"><span class="csLibCatDot" style="background:#35C2A6"></span>角色</button>
          <button type="button" class="csLibSortChip"><span class="csLibCatDot" style="background:#4D9FFF"></span>场景</button>
          <button type="button" class="csLibSortChip"><span class="csLibCatDot" style="background:#F5A742"></span>物件</button>
          <button type="button" class="csLibSortChip"><span class="csLibCatDot" style="background:#9C6CFF"></span>群像</button>
        </span>
      </div>
      <div class="csLibField"><span class="csLibFieldLabel">名称</span><input class="csLibInput" value="女主 Luna" /></div>
      <div class="csLibDrawerActs">
        <button type="button" class="csLibPrimary">入库</button>
        <button type="button" class="csSkillMarketBack">取消</button>
      </div>
    </div>
  </div>
</div>

<!-- 坏对照：抽屉故意贴左 + z=1 —— 上面的「抽屉贴右」谓词在它身上必须判否。 -->
<div class="csLibOverlay" id="pvBadOverlay" style="top: 100vh; height: 100px;">
  <aside class="csLibDrawer" id="pvBadDrawer" style="left: 0; right: auto; width: 200px;"></aside>
</div>

</div>
<script>
  // ?theme=light 切浅色轨（与 verify-previews 的 variants 约定一致）。
  var params = new URLSearchParams(location.search)
  document.documentElement.toggleAttribute('data-light', params.get('theme') === 'light')
</script>
<script>
(function () {
  var checks = []
  var push = function (name, ok, detail) { checks.push({ name: name, ok: ok, detail: detail || '' }) }
  try {
    var overlay = document.getElementById('pvOverlay')
    var overlayCs = getComputedStyle(overlay)
    var oRect = overlay.getBoundingClientRect()
    push('overlay position:fixed 且全屏', overlayCs.position === 'fixed'
      && Math.abs(oRect.width - innerWidth) < 2 && Math.abs(oRect.height - innerHeight) < 2,
      'position=' + overlayCs.position)
    push('overlay z-index=80（照 csSkillMarket）', Number(overlayCs.zIndex) === 80, 'z=' + overlayCs.zIndex)

    var rail = document.getElementById('pvRail')
    var drawer = document.getElementById('pvDrawer')
    var dRect = drawer.getBoundingClientRect()
    var rRect = rail.getBoundingClientRect()
    push('详情抽屉贴 overlay 右缘', Math.abs(dRect.right - oRect.right) < 2,
      'drawer.right=' + Math.round(dRect.right) + ' overlay.right=' + Math.round(oRect.right))
    push('抽屉不压左分类栏（drawer.left ≥ rail.right）', dRect.left >= rRect.right - 1,
      'drawer.left=' + Math.round(dRect.left) + ' rail.right=' + Math.round(rRect.right))

    // 对话框盖住抽屉：elementFromPoint 实测（z: backdrop 10 > drawer 5）。
    var backdrop = document.getElementById('pvDialogBackdrop')
    var probe = document.elementFromPoint((dRect.left + dRect.right) / 2, (dRect.top + dRect.bottom) / 2)
    push('入库对话框盖住抽屉（elementFromPoint 命中 backdrop/dialog 内）',
      probe !== null && (backdrop.contains(probe) || probe === backdrop),
      probe === null ? 'null' : probe.className)

    var primary = document.getElementById('pvPrimary')
    var bg = getComputedStyle(primary).backgroundColor
    push('主按钮底色为不透明实色（防幽灵令牌回落）',
      bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent', 'bg=' + bg)

    var bodyCs = getComputedStyle(document.body)
    var accent = bodyCs.getPropertyValue('--cs-accent').trim()
    push('关键令牌 --cs-accent 在浏览器里可解析', accent.length > 0, 'value=' + (accent || '(empty)'))

    var covers = Array.prototype.map.call(document.querySelectorAll('#pvGrid .csLibCover'), function (el) {
      return el.getBoundingClientRect().height
    })
    push('卡片 cover 盒 aspect-ratio 生效（三张都有高度）',
      covers.length === 3 && covers.every(function (h) { return h > 80 }), 'heights=' + covers.join(','))

    // 坏对照：贴左 + z=1 的假抽屉，同一谓词必须判否（否则谓词恒真）。
    var bad = document.getElementById('pvBadDrawer')
    var badRect = bad.getBoundingClientRect()
    var badOverlayRect = document.getElementById('pvBadOverlay').getBoundingClientRect()
    var badOnRight = Math.abs(badRect.right - badOverlayRect.right) < 2
    push('坏对照（贴左抽屉被「贴右」谓词判否）', !badOnRight, 'bad.right=' + Math.round(badRect.right))
  } catch (err) {
    push('自检自身抛错', false, 'THROW ' + (err && err.message ? err.message : 'unknown'))
  }

  var failed = checks.filter(function (c) { return !c.ok })
  var text = (failed.length === 0 ? '\\u2705 ' : '\\u274c ') + (checks.length - failed.length) + ' / ' + checks.length + ' 结构断言通过'
  for (var i = 0; i < failed.length; i++) text += '\\nFAIL ' + failed[i].name + (failed[i].detail ? '  (' + failed[i].detail + ')' : '')
  var pre = document.getElementById('pvVerdict')
  if (pre) pre.textContent = text
  document.documentElement.setAttribute('data-pv-fail', String(failed.length))
})()
</script>
</body>
</html>
`

await writeFile(outPath, html, 'utf8')
console.log(`preview written: ${outPath}`)
