/**
 * 视觉升维静态验收台（DD-01~DD-06）—— 输出单文件 HTML，不开桌面就能看
 * 「画布空间 / 节点卡片 / 时间轴 / 审批条」四块的真实令牌效果。
 *
 * ## 它是什么
 *
 * 与既有 `preview-lobby.mjs`（CV-064 起）同一约定：从 `src/client/styles.ts`
 * 抽**产品正在用的那一份** STUDIO_STYLES，配上**真实令牌**（色值全部来自
 * `lib/brand.js` 的 `brandCssText()`，见 `preview-tokens.mjs`），
 * 再摆一份骨架 DOM，输出单文件 HTML。
 *
 * 页内自带两件东西：
 * 1. **亮/暗 + 四预设切换** —— 硬约束 7「明色主题同样成立」与「预设只动 accent 族」
 *    都能当场看，不必来回改代码。
 * 2. **自检断言**（`computedStyle` 实测）—— 把各批次声称的效果从「代码里写了」
 *    变成「浏览器里确实发生了」。暗色 31 条 / 浅色 30 条（暗色专属的三档单调性
 *    一条在浅色下不适用）。结果同时写进页面上的自检卡和 `#pvVerdict`，后者供
 *    `scripts/verify-previews.mjs` 无头读取。
 *
 * ## 它不是什么
 *
 * - **不是像素级复刻**：DOM 结构按产品真实类名与层级摆，但节点内容是占位图，
 *   交互是静态的。判「观感对不对」够用，判「布局有没有 3px 偏差」不够用。
 * - **不替代桌面验收**：真机验收仍按 DEV-WORKFLOW 走。这里是**预检 + 截图留档**。
 *
 * 用法：`node scripts/preview-visual.mjs [输出路径]`
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  brandTokensCss,
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
const outPath = process.argv[2] ?? join(outDir, 'visual-direction-preview.html')
await mkdir(outDir, { recursive: true })

const studioStyles = await readStudioStyles()
const brand = await loadBrandModule()
const presetIds = [...brand.BRAND_PRESET_IDS]
const defaultPreset = brand.DEFAULT_BRAND_PRESET
const presetLabels = Object.fromEntries(presetIds.map(id => [id, brand.BRAND_PRESETS[id].label]))

// 四套预设的令牌全部注入，靠 `html[data-cs-preset]` 切换 —— 这样「换预设是否只动
// accent 族」不必改代码就能验。
//
// ⚠️ 锚点必须让**基块命中明暗两轨**：基块里装着 `--cs-gold/--cs-teal/--cs-dim/
// --cs-fs-*/--cs-space-*/--cs-shadow-*` 等（详见 preview-tokens.mjs 的
// rewriteBrandSelectors 注释）。把基块错锚成「仅浅色」会让暗色下这批令牌整批消失，
// 而 styles.ts 的 `var(--cs-teal, #35C2A6)` 兜底值又让界面看着「差不多对」。
const brandCss = presetIds
  .map(id => rewriteBrandSelectors(brand.brandCssText(id), {
    baseSelector: `html[data-cs-preset="${id}"]`,
    darkSelector: `html:not([data-light])[data-cs-preset="${id}"]`,
  }))
  .join('\n\n')

await reportTokenCoverage(`preview-visual [${defaultPreset}]`, brand.brandCssText(defaultPreset), HOST_TOKENS_DARK)

/* ------------------------------------------------------------------ 占位素材 */

/** 内联 SVG 占位图（零外部请求，无头环境下也能出图）。 */
const art = (label, from, to) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">'
  + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/>`
  + `<stop offset="1" stop-color="${to}"/></linearGradient></defs>`
  + '<rect width="320" height="200" fill="url(#g)"/>'
  + '<circle cx="256" cy="44" r="42" fill="rgba(255,255,255,.06)"/>'
  + '<text x="160" y="108" font-family="-apple-system,Helvetica,sans-serif" font-size="17" '
  + 'fill="rgba(255,255,255,.78)" text-anchor="middle">' + label + '</text></svg>',
)

const ART = {
  shot1: art('#01 卧室惊醒', '#243046', '#0E131C'),
  shot2: art('#02 门缝光影', '#1E2C42', '#0B0F16'),
  shot3: art('#03 走廊尽头', '#2A2A46', '#101018'),
  char: art('角色 · 林晚 三视图', '#2C3550', '#131722'),
  scene: art('场景 · 卧室 / 走廊', '#20303A', '#0F1519'),
  clip1: art('#01 片段 3.2s', '#1D2A3C', '#0C1119'),
  clip2: art('#02 片段 5.1s', '#26303F', '#0D1218'),
  film: art('成片 · 10.7s', '#12352E', '#0A1A18'),
  retired: art('旧版关键帧（已取代）', '#2A2A2E', '#131316'),
}

/* ------------------------------------------------------------------ DOM 片段 */

/**
 * 卡片几何 —— 必须与 src/canvas-aspect.ts 的 chrome 常量对齐。
 * H = 画面 180 + 头 26 + 脚 22 = 228。
 *
 * 这三个数字**故意写死，不从常量 import**：预览骨架是「拿真实 CSS 摆真实尺寸」的
 * 独立参照物。样式那一侧（`STUDIO_STYLES`）走的是 `readStudioStyles()`，它会把
 * `${NODE_HEAD_HEIGHT}` 解析成常量值 —— 也就是产品构建产出的同一份文本。两侧
 * 来源独立，所以常量被改动时，这里量出来就不再是 26 / 22 / 228，断言会红。
 * 若这里也去 import 常量，两边会一起漂成「自洽」，断言全绿而几何已经错了。
 */
const W = 260
const H = 228
const TEXT_H = 188
/** 行距 = 卡片高 + 24 间隙。 */
const ROW = 252

/**
 * 头部 / 脚部骨架 —— 与 CanvasNode.tsx 的 DOM **同构**。
 * 骨架不同构时，「头脚会不会压住画面 / 标题会不会把 chips 挤出去」这类几何断言
 * 测的就是骨架而不是产品，那正是这批要防的静默失败。
 */
const head = (kind, title, chips = '', alertText = '') => `
        <div class="csNodeHead">
          <span class="csNodeHeadKind">${kind}</span>${alertText !== ''
    ? `
          <button type="button" class="csNodeHeadAlert">${alertText}</button>`
    : title !== ''
      ? `
          <span class="csNodeHeadTitle">${title}</span>`
      : ''}
          <div class="csNodeHeadChips">${chips}</div>
        </div>`

const foot = (readings = '', role = '') => `
        <div class="csNodeFoot">
          <span class="csNodeFootReadings">${readings}</span>${role !== '' ? `
          ${role}` : ''}
        </div>`

/** 节点骨架。位置用 `transform: translate3d()` —— 与 CanvasNode 的真实写法一致。 */
const node = ({
  id, x, y, w = W, h = H, cls = '', dimmed = false, lit = true, style = '',
  kind, title = '', chips = '', alertText = '', body, readings = '', role = '',
}) => `
      <div class="csNode ${cls}${dimmed ? ' csNodeDimmed' : ''}" data-node-id="${id}" data-lit="${lit ? 1 : 0}"
           style="left:0;top:0;transform:translate3d(${x}px,${y}px,0);width:${w}px;height:${h}px;${style}">
        ${head(kind, title, chips, alertText)}
        ${body}
        ${foot(readings, role)}
      </div>`

const media = label => `
        <div class="csNodeMediaBox">
          <img class="csNodeMedia" src="${label}" alt="" />
        </div>`

const dims = (w, h) => `<span class="csNodeMediaDims">${w} × ${h}</span>`
const dur = t => `<span class="csNodeDuration">${t}</span>`
const chars = n => `<span class="csNodeChars">${n} 字</span>`
const roleBadge = (role, text) =>
  `<span class="csNodeRefBadge" data-role="${role}"><span class="csNodeRefDot"></span>参考 · ${text}</span>`
const mix = (audio, text) => `<span class="csNodeAudioMix" data-audio="${audio}">${text}</span>`
/** C2：镜号 chip —— 与底部时间轴同号。 */
const shotIdx = n => `<span class="csNodeBadge csNodeShotIdx">#${n}</span>`
const ver = n => `<span class="csNodeBadge csNodeBadgeVersion">v${n}</span>`
const lock = '<span class="csNodeBadge csNodeBadgeLock">🔒</span>'

const canvasNodes = [
  node({
    id: '#01 关键帧', x: 24, y: 24, lit: false, dimmed: true,
    kind: '关键帧', title: '分镜 1', chips: ver(1),
    body: media(ART.shot1),
    readings: dims(1920, 1080), role: roleBadge('image', '构图'),
  }),
  // 身份 chips 压力位：镜号 + 版本 + 锁同处头部右端 —— C2 之前 lock 与 version 会重叠 30×22px。
  node({
    id: '#02 关键帧 · 选中', x: 308, y: 24, cls: 'csNodeSelected', lit: true,
    kind: '关键帧', title: '分镜 2', chips: shotIdx(2) + ver(3) + lock,
    body: media(ART.shot2),
    readings: dims(1920, 1080),
  }),
  // 长标题压力位：标题必须自己省略，不许把身份 chips 挤出头部的右边界。
  node({
    id: '#03 关键帧 · 长标题', x: 592, y: 24, lit: false, dimmed: true,
    kind: '关键帧',
    title: '分镜 3 · 一个特别长特别长的标题用来验证省略号与 chips 的边界',
    chips: ver(1),
    body: media(ART.shot3),
    readings: dims(1920, 1080),
  }),
  node({
    id: '角色 · 林晚', x: 24, y: 24 + ROW, lit: true,
    kind: '角色', title: '林晚', chips: ver(1),
    body: media(ART.char),
    readings: dims(1920, 1080), role: roleBadge('character', '角色'),
  }),
  node({
    id: '场景 · 卧室/走廊', x: 308, y: 24 + ROW, lit: true,
    kind: '场景', title: '卧室 / 走廊', chips: ver(1), cls: 'csNodeHit',
    body: media(ART.scene),
    readings: dims(1920, 1080), role: roleBadge('style', '风格'),
  }),
  // 读数压力位：音轨构成 + 时长 + 分辨率同在脚部读数行 —— C2 之前它们互相压住。
  node({
    id: '#02 片段 · 视频', x: 592, y: 24 + ROW, lit: true,
    kind: '片段', title: '分镜 2', chips: shotIdx(2) + ver(1),
    body: media(ART.clip2),
    readings: mix('native+bgm', '环境声 + BGM') + dur('0:05') + dims(1920, 1080),
  }),
  node({
    id: '#01 片段 · 视频', x: 24, y: 24 + ROW * 2, lit: false, dimmed: true,
    kind: '片段', title: '分镜 1', chips: shotIdx(1),
    body: media(ART.clip1),
    readings: dur('0:03') + dims(1920, 1080),
  }),
  node({
    id: '成片 · 青色描边', x: 308, y: 24 + ROW * 2, cls: 'csNodeFilm', lit: false, dimmed: true,
    kind: '成片', title: '凌晨三点的门外人', chips: ver(1),
    body: media(ART.film),
    readings: mix('none', '无声') + dur('0:11') + dims(1920, 1080),
  }),
  node({
    id: '失效版本 · 灰显 0.45', x: 592, y: 24 + ROW * 2, cls: 'csNodeRetired', lit: false, dimmed: true,
    kind: '关键帧', title: '分镜 3',
    chips: '<span class="csNodeBadge csNodeBadgeRetired">已取代 · v2</span>',
    body: media(ART.retired),
    readings: dims(1920, 1080),
  }),
  node({
    id: '剧本节点', x: 24, y: 24 + ROW * 3, w: 260, h: TEXT_H, lit: false, dimmed: true,
    kind: '剧本', title: '创意',
    body: '<div class="csNodeText">'
      + '<p class="csNodeBody">凌晨三点，门外站着一个知道她名字的人。</p></div>',
    readings: chars(21),
  }),
  // 脚部为空的压力位：分镜卡还没有声明时长时，脚部那一行也必须稳住高度（不能塌）。
  node({
    id: '分镜卡 · 空读数', x: 308, y: 24 + ROW * 3, w: 260, h: TEXT_H, lit: false, dimmed: true,
    kind: '分镜', title: '3 · 中近景',
    body: '<div class="csNodeText">'
      + '<p class="csNodeBody">【镜 3】中近景 · 推 · 3.2s<br>画面：他停在门口，手悬在半空。</p></div>',
    readings: dur('3.2s'),
  }),
  node({
    id: '生成中 · 显影扫描', x: 592, y: 24 + ROW * 3, w: 260, h: TEXT_H, cls: 'csNodeLoading', lit: false, dimmed: true,
    kind: '关键帧', title: '分镜 4',
    body: media(ART.shot2)
      + '<div class="csNodeOverlay"><span class="csNodeOverlayLabel">生成中</span>'
      + '<span class="csNodeProgress"><span class="csNodeProgressBar"></span></span>'
      + '<span class="csNodeOverlayHint">耗时较久，可在详情面板或右键菜单打断</span></div>',
  }),
  // 失败卡：告警占住**标题那一格**（不是浮在画面上），且必须可点。
  node({
    id: '失败重试 · 锁定', x: 24, y: 24 + ROW * 4, w: 260, h: 228, cls: 'csNodeLocked', lit: false, dimmed: true,
    kind: '片段', alertText: '生成失败 · 点击重试', chips: lock,
    body: media(ART.shot1),
    readings: dims(1920, 1080),
  }),
].join('\n')

/* ---- 时间轴：片段宽度 = 真实 duration 比例（rulerMax 12s，与 timeline-layout 同口径） ---- */
const RULER_MAX = 12
const pct = v => (v / RULER_MAX) * 100
const clips = [
  { n: 1, label: '卧室惊醒', from: 0, dur: 3.2, art: ART.clip1, sel: false, excluded: false },
  { n: 2, label: '门缝光影', from: 3.2, dur: 5.1, art: ART.clip2, sel: true, excluded: false },
  { n: 3, label: '走廊尽头', from: 8.3, dur: 2.4, art: ART.shot3, sel: false, excluded: true },
]
const tickHtml = []
for (let t = 0; t <= RULER_MAX; t += 2) {
  tickHtml.push(`<span class="csTlTick" style="left:${(t / RULER_MAX) * 100}%">${t}s</span>`)
}

const clipHtml = clips.map(c => `
                  <div class="csTlClipWrap" style="left:${pct(c.from)}%;width:calc(${pct(c.dur)}% - 3px)">
                    <div class="csTlClip${c.sel ? ' csTlClipSel' : ''}${c.excluded ? ' csTlClipExcluded' : ''}">
                      <span class="csTlClipArt"><img src="${c.art}" alt="" /></span>
                      <span class="csTlClipLbl">${c.n} · ${c.dur.toFixed(1)}s</span>
                      <span class="csTlClipCut"></span>
                    </div>
                    <button type="button" class="csTlCheck${c.excluded ? ' csTlCheckOff' : ''}" title="${c.excluded ? '已排除出合成 —— 点按重新纳入' : '将参与合成 —— 点按排除'}">${c.excluded ? '' : '✓'}</button>
                  </div>`).join('\n')

const playheadLeft = `calc(64px + (100% - 64px) * ${pct(3.2) / 100})`

/* ------------------------------------------------------------------ 自检脚本 */

// ⚠️ 下面的 selfCheck 是**嵌在外层模板字面量里**的字符串。正文（含注释）里
// **绝不能出现反引号** —— 它会把外层模板提前闭合，报的错还是「Unexpected
// identifier」这种跟真正原因毫无关系的语法错。2026-09-12 连踩两次，故立此警告。
// 需要引用类名/选择器时用单引号或直接裸写。
const selfCheck = `
<script>
(function () {
  var lines = []
  var pass = 0, fail = 0
  function ok(name, cond, detail) {
    if (cond) { pass++; lines.push('PASS  ' + name) }
    else { fail++; lines.push('FAIL  ' + name + (detail ? '  → ' + detail : '')) }
  }
  function cs(el, pseudo) { return getComputedStyle(el, pseudo || null) }
  function tok(n) { return getComputedStyle(document.body).getPropertyValue(n).trim() }

  // 把令牌解析成浏览器认的实际值（色值可能是 #hex / rgba() / color-mix()）
  var probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px'
  document.body.appendChild(probe)
  function resolveColor(n) { probe.style.background = ''; probe.style.background = 'var(' + n + ')'; return cs(probe).backgroundColor }
  function resolveShadow(n) { probe.style.boxShadow = ''; probe.style.boxShadow = 'var(' + n + ')'; return cs(probe).boxShadow }
  // Chrome 把解析后的颜色序列化成两种形态：legacy 形态 / 与 color-mix、宽色域走的
  // srgb 浮点形态（分量是 0-1 浮点，不是 0-255）。只按数字抠会把 0.09 当成极深色，
  // 明暗判断静默错位。两种都要认。
  function rgba(c) {
    var s = String(c)
    var m = s.match(/^color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*\\/\\s*([\\d.]+%?))?\\)/)
    if (m) {
      return { r: +m[1] * 255, g: +m[2] * 255, b: +m[3] * 255,
        a: m[4] === undefined ? 1 : (m[4].indexOf('%') >= 0 ? parseFloat(m[4]) / 100 : +m[4]) }
    }
    m = s.match(/^rgba?\\(([^)]+)\\)/)
    if (!m) return null
    var p = m[1].split(/[,/]/).map(function (x) { return x.trim() })
    function chan(x) { return x.indexOf('%') >= 0 ? parseFloat(x) / 100 * 255 : parseFloat(x) }
    return { r: chan(p[0]), g: chan(p[1]), b: chan(p[2]),
      a: p.length >= 4 ? (p[3].indexOf('%') >= 0 ? parseFloat(p[3]) / 100 : parseFloat(p[3])) : 1 }
  }
  function lum(c) {
    var v = rgba(c)
    return v ? 0.2126 * v.r + 0.7152 * v.g + 0.0722 * v.b : NaN
  }
  function alphaOf(c) {
    var s = String(c)
    // color-mix 的序列化形态随**源色空间**变：srgb 源走 color(srgb … / a)，
    // oklch 源（ocean-blue 预设的 accent）走 oklab(… / a)。legacy rgba 是逗号
    // 语法、没有斜杠，不会误入这个分支。抠「尾部 / alpha」对三种形态都成立。
    var m = s.match(/\\/\\s*([\\d.]+%?)\\s*\\)$/)
    if (m) return m[1].indexOf('%') >= 0 ? parseFloat(m[1]) / 100 : parseFloat(m[1])
    var v = rgba(c)
    return v ? v.a : 1
  }
  function near(a, b, t) { return Math.abs(a - b) <= (t == null ? 0.01 : t) }
  function q(s) { return document.querySelector(s) }

  // 自检只有在「跑到底」时才有意义。任何未捕获异常都必须变成一个 FAIL ——
  // 否则页面会永远停在「自检运行中…」，看起来像没跑，实际是断了（静默失败最难查）。
  var done = false
  function finalize() {
    if (done) return
    done = true
    var ctx = '[' + (document.documentElement.hasAttribute('data-light') ? '浅色' : '暗色')
      + ' · ' + (document.documentElement.getAttribute('data-cs-preset') || '-') + '] '
    var head = ctx + (fail === 0 ? '\\u2705 ' : '\\u274c ') + pass + ' / ' + (pass + fail) + ' \\u901a\\u8fc7'
    var text = head + '\\n' + lines.join('\\n')
    var pre = document.getElementById('pvVerdict')
    if (pre) pre.textContent = text
    var card = document.getElementById('pvCheck')
    if (card) {
      card.className = 'pvCheck ' + (fail === 0 ? 'pvCheckOk' : 'pvCheckFail')
      card.textContent = text
    }
    document.documentElement.setAttribute('data-pv-fail', String(fail))
  }
  window.addEventListener('error', function (e) {
    fail++
    lines.push('THROW 自检中断 \\u2192 ' + (e && e.message ? e.message : 'unknown'))
    finalize()
  })

  // N1 教训：headless --virtual-time-budget 不推进 CSS 动画时钟，入场动画（csDevelopIn，
  // fill both）会冻在 scale(0.94) 首帧，几何断言量到的是被缩放的盒子（头 26→24、脚 22→21，
  // 且头/体/脚互相越界）。自检量测前把有限动画全部 finish 到末帧（transform 归位，
  // animationName 依旧可读）；无限动画（脉冲类）finish 会抛，逐个吞掉。
  try {
    document.getAnimations().forEach(function (a) { try { a.finish() } catch (err) {} })
  } catch (err) {}

  var TOKENS = ['--cs-shell','--cs-shell-2','--cs-node','--cs-node-hi','--cs-float','--cs-line','--cs-line-hi',
    '--cs-gate','--cs-scrim','--cs-dim','--cs-glow-accent','--cs-gold','--cs-teal','--cs-canvas-bg',
    '--cs-canvas-grid','--cs-canvas-grid-major','--cs-fs-xs','--cs-fs-2xl','--cs-space-4','--cs-shadow-3','--cs-ease']
  var empty = TOKENS.filter(function (n) { return !tok(n) })
  ok('令牌无空值（抽查 ' + TOKENS.length + ' 个）', empty.length === 0, empty.join(' '))

  // 未知名（?preset= / localStorage 漂移）会让每个 --cs-* 都解析成空值，而兜底色
  // 让页面看着差不多对。这里把它变成一条明确的 FAIL，而不是让它伪装成「令牌坏了」。
  var badPreset = document.documentElement.getAttribute('data-pv-preset-bad')
  ok('预设名有效（未知预设会静默丢掉全部令牌）', badPreset === null, badPreset || '')

  // 空间三档：画布最暗、壳居中、节点更亮、浮层最亮（浅色允许相等，不允许倒挂）
  var dark = !document.documentElement.hasAttribute('data-light')
  var Lcanvas = lum(cs(q('.csCanvasSurface')).backgroundColor)
  var Lshell = lum(cs(q('.csFrame')).backgroundColor)
  var Lnode = lum(cs(q('.csNode')).backgroundColor)
  var Lfloat = lum(cs(q('.csDetailPanel')).backgroundColor)
  ok('空间三档不倒挂：画布 ≤ 壳 ≤ 节点 ≤ 浮层',
    Lcanvas <= Lshell + 0.5 && Lshell <= Lnode + 0.5 && Lnode <= Lfloat + 0.5,
    [Lcanvas, Lshell, Lnode, Lfloat].map(function (v) { return v.toFixed(1) }).join(' / '))
  if (dark) {
    ok('暗色下三档严格单调且可辨（ΔL ≥ 6）',
      Lcanvas < Lshell && Lshell < Lnode && Lnode < Lfloat && (Lnode - Lcanvas) >= 6,
      [Lcanvas, Lshell, Lnode, Lfloat].map(function (v) { return v.toFixed(1) }).join(' / '))
  }

  // 点阵双层网格（退休 CV-035 的直角线 workaround）
  var surf = cs(q('.csCanvasSurface'))
  ok('网格为点阵双层 120px + 24px',
    (surf.backgroundImage.match(/radial-gradient/g) || []).length === 2
    && surf.backgroundSize.indexOf('120px') >= 0 && surf.backgroundSize.indexOf('24px') >= 0,
    surf.backgroundSize)

  // 节点：片门 / 选中光晕 / 血缘压暗 / 失效灰显 / 乘法链 / 成片青边 / 扫描动效
  var gate = cs(q('.csNodeMediaBox'))
  ok('片门：媒体区上下 2px 且色值 = --cs-gate',
    gate.borderTopWidth === '2px' && gate.borderBottomWidth === '2px'
    && gate.borderTopColor === resolveColor('--cs-gate'),
    gate.borderTopWidth + ' / ' + gate.borderTopColor + ' vs ' + resolveColor('--cs-gate'))
  ok('媒体窗底 = 画布档（.csNodeMedia，styles.ts:1356）',
    cs(q('.csNodeMedia')).backgroundColor === resolveColor('--cs-canvas-bg'),
    cs(q('.csNodeMedia')).backgroundColor + ' vs ' + resolveColor('--cs-canvas-bg'))
  // 光晕判「可见」而非判「等于 accent」：accent 可能经 color-mix 派生，直接比色值会假失败。
  // 真正要守的是「非 none 且 alpha > 0」——CV-16x 之前浅色轨曾整条丢光晕。
  var glow = cs(q('.csNodeSelected')).boxShadow
  ok('选中光晕可见（box-shadow ≠ none 且 alpha > 0）',
    glow !== 'none' && alphaOf(glow) > 0, glow.slice(0, 56))
  // 成片描边在 styles.ts 是 color-mix(teal 38%, --cs-line)，**不等于** --cs-teal。
  // 要守的是「明显偏青、与普通节点的中性描边可区分」—— 这才是 DD-03 的意图。
  var filmEdge = rgba(cs(q('.csNodeFilm')).borderTopColor)
  var plainEdge = rgba(cs(q('.csNode')).borderTopColor)
  var filmTeal = filmEdge ? filmEdge.g - filmEdge.r : NaN
  var plainTeal = plainEdge ? plainEdge.g - plainEdge.r : NaN
  ok('成片青边偏青且与普通描边可区分',
    filmTeal >= 20 && (filmTeal - plainTeal) >= 12,
    'film g-r=' + filmTeal.toFixed(1) + ' / plain g-r=' + plainTeal.toFixed(1))
  var bar = cs(q('.csNodeProgressBar'))
  ok('生成中走显影扫描（csDevelop）', bar.animationName === 'csDevelop', bar.animationName)

  // 用探针量状态类，避免依赖页面上的演示开关
  function probeNode(cls, style) {
    var el = document.createElement('div')
    el.className = 'csNode ' + cls
    el.style.cssText = 'position:absolute;top:0;left:0;width:' + ${W} + 'px;height:' + ${H} + 'px;' + (style || '')
    q('.csCanvasLayer').appendChild(el)
    var v = { opacity: cs(el).opacity, filter: cs(el).filter }
    el.remove()
    return v
  }
  var dimmed = probeNode('csNodeDimmed')
  ok('血缘压暗 = --cs-dim', near(+dimmed.opacity, +tok('--cs-dim')),
    dimmed.opacity + ' vs ' + tok('--cs-dim'))
  var retired = probeNode('csNodeRetired')
  ok('失效版本真的灰下去（0.45 + grayscale）',
    near(+retired.opacity, 0.45) && retired.filter.indexOf('grayscale') >= 0,
    retired.opacity + ' / ' + retired.filter)
  var chain = probeNode('csNodeLocked', '--cs-node-opacity:0.9')
  ok('不透明度走乘法链 0.9 × 0.75 = 0.675', near(+chain.opacity, 0.675), chain.opacity)

  // C10：镜头条（头 / 脚两行）—— 这批改的是**布局结构**，所以断言必须量真实 rect，
  // 不能只查「规则在不在」。三条独立的结构性主张：
  //   ① 头 / 脚是**真实布局行**：头在体区之上、脚在体区之下，三者纵向不重叠。
  //      负向对照（?card=legacy）会把头/脚改回绝对定位 —— 那时它们压在画面上，
  //      卡片高度之和立刻对不上，这条必红。
  //   ② **纵向就三段**：卡片外框高 = 头 + 体 + 脚 + 卡片边框。C2 的浮动角标是
  //      零高度代价，C10 换来的信息密度**由卡片变高支付**，不是从画面里扣 ——
  //      所以体区高度应当等于「卡高 − chrome − 边框」，而不是被谁悄悄吃掉几像素。
  //   ③ 长标题只能自己省略，不许把身份 chips 挤出头部的右边界。
  var canvasNodeEls = document.querySelectorAll('.csCanvasLayer .csNode')
  var chromeMismatch = []
  var rowOverlap = []
  var overflowed = []
  var insideViolations = []
  var checkedCards = 0
  for (var ni = 0; ni < canvasNodeEls.length; ni++) {
    var nel = canvasNodeEls[ni]
    var nr = nel.getBoundingClientRect()
    var nhead = nel.querySelector('.csNodeHead')
    var nfoot = nel.querySelector('.csNodeFoot')
    var nbody = nel.querySelector('.csNodeMediaBox') || nel.querySelector('.csNodeText')
    // 分组卡没有头/脚 —— 骨架里目前没有分组卡，所以「缺失」就是结构没搭上。
    if (!nhead || !nfoot || !nbody) { insideViolations.push((nel.getAttribute('data-node-id') || '?') + ' 缺头/脚/体区'); continue }
    var hr = nhead.getBoundingClientRect()
    var fr = nfoot.getBoundingClientRect()
    var br = nbody.getBoundingClientRect()
    checkedCards++
    // ① 纵向顺序：头底 ≤ 体顶，体底 ≤ 脚顶（容差 1px 给亚像素舍入）。
    if (hr.bottom > br.top + 1 || br.bottom > fr.top + 1) {
      rowOverlap.push((nel.getAttribute('data-node-id') || '?') + ' 头/体/脚纵向交叠')
    }
    // ② 卡片外框高 = 头 + 体 + 脚 + 卡片自身边框（±1px）。即「纵向就这么三段，
    //    没有第四样东西占高度」—— 谁要是再加一条浮动的角标带，这里立刻对不上。
    //    （卡片是 content-box，inline height 说的是内容区，1px 上下边框在它之外。）
    var ncs = cs(nel)
    var cardBorder = parseFloat(ncs.borderTopWidth) + parseFloat(ncs.borderBottomWidth)
    // 详情把三段都列出来 —— 只说「和不对」时，下一个人的第一反应会去猜是
    // box-sizing 还是边框（2026-09-12 真猜错过，真凶在别处）。
    var sum = hr.height + br.height + fr.height
    if (Math.abs(sum + cardBorder - nr.height) > 1) {
      chromeMismatch.push((nel.getAttribute('data-node-id') || '?')
        + ' 头' + Math.round(hr.height) + '+体' + Math.round(br.height) + '+脚' + Math.round(fr.height)
        + '+' + cardBorder + ' = ' + Math.round(sum + cardBorder) + ' ≠ 卡 ' + Math.round(nr.height))
    }
    // ③ 头部内部不越界：title 与 chips 都必须在头的矩形内。
    var headParts = nhead.querySelectorAll('.csNodeHeadKind, .csNodeHeadTitle, .csNodeHeadAlert, .csNodeHeadChips')
    for (var hi = 0; hi < headParts.length; hi++) {
      var pr = headParts[hi].getBoundingClientRect()
      if (pr.right > hr.right + 0.5 || pr.left < hr.left - 0.5) {
        overflowed.push((nel.getAttribute('data-node-id') || '?') + ' → ' + headParts[hi].className)
      }
    }
  }
  // 失败详情要能读。全量倒出来会把终端冲垮，反而看不出「是哪一个先坏的」——
  // 只报前 3 条 + 总数，够定位，不淹没。
  function brief(list) {
    return list.slice(0, 3).join(' | ') + (list.length > 3 ? ' … 共 ' + list.length + ' 项' : '')
  }
  ok('镜头条骨架齐全：' + checkedCards + ' 张卡都有头 / 体 / 脚',
    checkedCards >= 12 && insideViolations.length === 0, brief(insideViolations))
  ok('头 / 体 / 脚是真实布局行，纵向不交叠（不浮在画面上）',
    rowOverlap.length === 0, brief(rowOverlap))
  ok('卡片纵向只有头 / 体 / 脚三段（chrome 是加在卡片上的，不从画面里扣）',
    chromeMismatch.length === 0, brief(chromeMismatch))
  ok('长标题自己省略，不把身份 chips 挤出头部的左右边界',
    overflowed.length === 0, brief(overflowed))
  // chrome 高度必须与常量一致：量出来的头 + 脚 = 48（头 26 + 脚 22）。
  // 单独取第一张卡的头/脚，不依赖上面循环的循环变量 —— 那种隐式依赖会在
  // 「循环体被改」时静默换成另一张卡，断言看着还在其实换了对象。
  var headEl = q('.csCanvasLayer .csNode .csNodeHead')
  var footEl = q('.csCanvasLayer .csNode .csNodeFoot')
  var headH = headEl ? Math.round(headEl.getBoundingClientRect().height) : 0
  var footH = footEl ? Math.round(footEl.getBoundingClientRect().height) : 0
  ok('头 + 脚 = 48px（与 canvas-aspect 的 NODE_CHROME_HEIGHT 同源）',
    headH + footH === 48, headH + ' + ' + footH)
  // 镜号 chip 与时间轴同号：预览里 #02 片段卡上应显示 #2（时间轴第 2 段）。
  var idxChip = q('.csCanvasLayer .csNodeShotIdx')
  ok('镜号 chip 存在且编号与时间轴同号',
    idxChip !== null && idxChip.textContent === '#2',
    idxChip ? idxChip.textContent : '缺失')
  // 头部整条是拖拽面（浮动角标时代必须 pointer-events: none 让出起手区，实底之后不必）；
  // 可点的失败告警是 <button>，必须自己保持 pointer 光标。
  var retryBtn = q('.csNodeHeadAlert')
  ok('头部可拖拽，可点的失败告警保持 pointer 光标',
    cs(q('.csNodeHead')).cursor === 'grab'
    && retryBtn !== null && retryBtn.tagName === 'BUTTON' && cs(retryBtn).cursor === 'pointer',
    cs(q('.csNodeHead')).cursor + ' / ' + (retryBtn ? retryBtn.tagName + ' ' + cs(retryBtn).cursor : '缺失'))

  // C6：框选命中预览 —— 命中节点轻 accent 描边（accent 不透明，混 transparent 后
  // alpha 恒 0.6，四套预设都一样，正好当判据）；marquee 矩形用 accent 虚线。
  var hitNode = q('.csCanvasLayer .csNode.csNodeHit')
  ok('框选命中预览：命中节点描边 = accent 60% 透明轻描边',
    hitNode !== null && near(alphaOf(cs(hitNode).borderColor), 0.6),
    hitNode === null ? '缺 csNodeHit 样例卡' : cs(hitNode).borderColor)
  var mq = q('.csCanvasLayer .csMarquee')
  ok('框选矩形：accent 虚线 + 半透明蒙层（与命中预览同一族色）',
    mq !== null && cs(mq).borderStyle === 'dashed' && near(alphaOf(cs(mq).backgroundColor), 0.14),
    mq === null ? '缺 csMarquee 样例' : cs(mq).borderStyle + ' / ' + cs(mq).backgroundColor)

  // 时间轴：播放头公式 + 片段宽度 = 真实时长比例
  var ph = q('.csTlPlayhead')
  ok('播放头 left 保持 calc(64px + …) 公式',
    ph !== null && (ph.getAttribute('style') || '').indexOf('calc(64px') >= 0,
    ph ? ph.getAttribute('style') : '缺失')
  // 视频轨用 .csTlLaneTall 定位。**不要**用 .csTlTrack:first-of-type ——
  // :first-of-type 判的是「同类型元素中的第一个」，而 .csTlRuler 也是 div 且排在前面，
  // 结果匹配空集 → clipEls[0] 为 undefined → 抛错 → 自检静默中断（2026-09-12 踩过）。
  var lane = q('.csTlLaneTall')
  var clipEls = lane ? lane.querySelectorAll('.csTlClip') : []
  ok('视频轨 3 个片段（.csTlLaneTall > .csTlClipWrap > .csTlClip 结构与产品一致）',
    clipEls.length === 3, 'count=' + clipEls.length)
  if (clipEls.length >= 2) {
    var wraps = lane.querySelectorAll('.csTlClipWrap')
    var laneW = lane.getBoundingClientRect().width
    var w1 = wraps[0].getBoundingClientRect().width
    var w2 = wraps[1].getBoundingClientRect().width
    ok('片段宽度比例 = 真实 duration 比例（3.2 : 5.1）',
      near(w1 / w2, 3.2 / 5.1, 0.05), (w1 / w2).toFixed(3) + ' vs ' + (3.2 / 5.1).toFixed(3))
    // 与产品同口径：width = calc(widthPct% - 3px)（CanvasTimeline.tsx:260），不能只验比例。
    var exp1 = laneW * (3.2 / ${RULER_MAX}) - 3
    var exp2 = laneW * (5.1 / ${RULER_MAX}) - 3
    ok('片段宽度吻合 calc(pct% - 3px) 公式（±1.5px）',
      Math.abs(w1 - exp1) <= 1.5 && Math.abs(w2 - exp2) <= 1.5,
      [w1.toFixed(1), exp1.toFixed(1), w2.toFixed(1), exp2.toFixed(1)].join(' / '))
  }

  // 场记板审批条（DD-05）
  var apv = q('.csWorkflowApproval')
  var apvCs = cs(apv)
  ok('场记板：左缘 3px gold 拍板条 + 顶缘打板斜纹',
    apvCs.borderLeftWidth === '3px' && apvCs.borderLeftColor === resolveColor('--cs-gold')
    && cs(apv, '::before').backgroundImage.indexOf('repeating-linear-gradient') >= 0,
    apvCs.borderLeftWidth + ' / ' + apvCs.borderLeftColor)
  ok('批准按钮 = gold 实底',
    cs(q('.csWorkflowApproval button.csPrimary')).backgroundColor === resolveColor('--cs-gold'),
    cs(q('.csWorkflowApproval button.csPrimary')).backgroundColor)
  // C5：动效词汇补齐 —— 三个新动画必须在浏览器里真的挂在消费者上
  // （规则写了但选择器没接上，是这一批最容易出的静默失败）。
  ok('C5 动效：审批条入场 rise（让位）+ 场记板打板（显影）',
    apvCs.animationName === 'csYieldRise'
    && cs(q('.csWorkflowClap')).animationName === 'csDevelopClapHit',
    apvCs.animationName + ' / ' + cs(q('.csWorkflowClap')).animationName)
  ok('C5 动效：浮层出现 pop（让位）—— 详情面板与图层浮层同一词汇',
    cs(q('.csDetailPanel')).animationName === 'csYieldPop',
    cs(q('.csDetailPanel')).animationName)
  // N 批次（对齐清单 §8.3）：入场显影 / 产出计数 / 播放按钮 —— 骨架里各给一个样本。
  ok('N1 动效：节点入场走 csDevelopIn（显影语义，动独立 scale 不碰定位 transform）',
    cs(q('.csNode')).animationName === 'csDevelopIn',
    cs(q('.csNode')).animationName)
  // N1 真机事故回归断言：入场动画若错用 transform（fill both 永久套 to 帧），
  // 所有卡会被锁死堆在画布原点 —— 量绝对位置，两张卡 x 必须不同。
  var posA = q('[data-node-id]') !== null ? q('[data-node-id]').getBoundingClientRect() : null
  var posB = document.querySelectorAll('[data-node-id]')[1]
    ? document.querySelectorAll('[data-node-id]')[1].getBoundingClientRect() : null
  ok('N1 定位：卡片按数据坐标分布，不堆叠在原点（fill 动画不得覆盖 translate3d）',
    posA !== null && posB !== null && Math.abs(posA.left - posB.left) > 4,
    posA === null || posB === null ? '骨架卡不足两张' : 'x 差 ' + Math.abs(posA.left - posB.left).toFixed(0) + 'px')
  ok('N4 计数：右上产出计数为 tabular-nums 弱化文字（审批态在产品里隐藏）',
    (function () { var el = q('.csWorkflowTime'); return el !== null && cs(el).fontVariantNumeric === 'tabular-nums' })(),
    (function () { var el = q('.csWorkflowTime'); return el === null ? '缺 csWorkflowTime 样本' : cs(el).fontVariantNumeric })())
  ok('N3 播放：时间轴工具栏首位是播放按钮（可点、pointer 光标）',
    (function () { var el = q('.csTimelinePlay'); return el !== null && cs(el).cursor === 'pointer' })(),
    (function () { var el = q('.csTimelinePlay'); return el === null ? '缺 csTimelinePlay 样本' : cs(el).cursor })())
  // C8：空态「预演」幽灵流水线 + 错误三级视觉分级。
  ok('C8 预演：幽灵流水线 4 站 3 连，站点虚线胶囊、终点实线收束',
    document.querySelectorAll('.csGhostPipeline .csGhostNode').length === 4
    && document.querySelectorAll('.csGhostPipeline .csGhostLink').length === 3
    && cs(q('.csGhostPipeline .csGhostNode')).borderStyle.indexOf('dashed') >= 0
    && cs(q('.csGhostNodeFinal')).borderStyle.indexOf('dashed') < 0,
    document.querySelectorAll('.csGhostPipeline .csGhostNode').length + ' 站 / '
    + document.querySelectorAll('.csGhostPipeline .csGhostLink').length + ' 连 / '
    + cs(q('.csGhostPipeline .csGhostNode')).borderStyle)
  ok('C8 分级：三级错误卡左缘色 = accent / gold / 宿主错误色（互不相同）',
    (function () {
      var c1 = cs(q('.csErrorKindRetryable')).borderLeftColor
      var c2 = cs(q('.csErrorKindConfig')).borderLeftColor
      var c3 = cs(q('.csErrorKindUnreachable')).borderLeftColor
      return c1 === resolveColor('--cs-accent')
        && c2 === resolveColor('--cs-gold')
        && c3 === resolveColor('--dsw-alias-state-error-primary')
        && c1 !== c2 && c2 !== c3
    })(),
    cs(q('.csErrorKindRetryable')).borderLeftColor + ' / ' + cs(q('.csErrorKindConfig')).borderLeftColor
    + ' / ' + cs(q('.csErrorKindUnreachable')).borderLeftColor)
  ok('C8 分级：缺配置的主行动是「打开设置」（实底），重试降为次按钮',
    (function () {
      var primary = q('.csErrorKindConfig .csErrorActionPrimary')
      return primary !== null && primary.textContent === '打开设置'
        && q('.csErrorKindConfig .csErrorAction') !== null
    })(),
    q('.csErrorKindConfig .csErrorActionPrimary') ? q('.csErrorKindConfig .csErrorActionPrimary').textContent : '缺主按钮')
  ok('C8 入场：错误卡出现走浮层词汇 pop',
    cs(q('.csErrorCard')).animationName === 'csYieldPop',
    cs(q('.csErrorCard')).animationName)
  // C9：窄窗降级 —— 栅格规则字面量必须弹性三列、脆弱两行可换行。
  // 注意不能量 .csFrame 的 computedStyle：骨架给它写了内联 grid-template-columns:1fr
  // （预览版式用），computed 被内联覆盖。走 CSSOM 抓规则原字面量（minmax 保留）。
  ok('C9 窄窗：栅格规则为弹性三列（minmax）、审批条与时间轴工具栏可换行',
    (function () {
      var cols = ''
      var sheets = document.styleSheets
      for (var i = 0; i < sheets.length; i++) {
        var rules = sheets[i].cssRules || []
        for (var j = 0; j < rules.length; j++) {
          if (rules[j].selectorText === '.csFrame') { cols = rules[j].style.gridTemplateColumns; break }
        }
      }
      return (cols.match(/minmax/g) || []).length === 3
    })()
    && cs(q('.csWorkflowApproval')).flexWrap === 'wrap'
    && cs(q('.csTimelineToolbar')).flexWrap === 'wrap',
    cs(q('.csWorkflowApproval')).flexWrap + ' / ' + cs(q('.csTimelineToolbar')).flexWrap)
  // C1：六段轨道 —— 当前段 accent + 脉冲（csAdvancePulse，行进语义），已完成段青点，
  // 无产物的未来段必须 :disabled + default 光标（不许出现「能点但没动作」的假按钮）。
  var nowDot = cs(q('.csWorkflowStage.csStageNow i'))
  ok('阶段行进：当前段点 = accent 且走 csAdvancePulse',
    nowDot.backgroundColor === resolveColor('--cs-accent') && nowDot.animationName === 'csAdvancePulse',
    nowDot.backgroundColor + ' / ' + nowDot.animationName)
  ok('已完成段点 = --cs-teal',
    cs(q('.csWorkflowStage.csStageDone i')).backgroundColor === resolveColor('--cs-teal'),
    cs(q('.csWorkflowStage.csStageDone i')).backgroundColor)
  // 注意取 :not(.csStageLinkDone) —— 第一条连接线（剧本→分镜）本身就是已完成的，
  // 直接 q('.csStageLink') 会拿到已完成那条，两边同色 → 假失败。
  var linkTodo = cs(q('.csStageLink:not(.csStageLinkDone)'))
  var linkDone = cs(q('.csStageLink.csStageLinkDone'))
  ok('段间连接线：已完成段变青，与未完成段不同色',
    linkTodo.backgroundColor !== linkDone.backgroundColor,
    linkTodo.backgroundColor + ' → ' + linkDone.backgroundColor)
  ok('六段轴里有 6 个段、5 条连接线（不是 5 段的旧轨道）',
    document.querySelectorAll('.csWorkflowStage').length === 6
    && document.querySelectorAll('.csStageLink').length === 5,
    document.querySelectorAll('.csWorkflowStage').length + ' / ' + document.querySelectorAll('.csStageLink').length)
  ok('无产物的未来段不可点：disabled 走 default 光标，可点段走 pointer',
    q('.csWorkflowStage:disabled') !== null
    && cs(q('.csWorkflowStage:disabled')).cursor === 'default'
    && cs(q('.csWorkflowStage:not(:disabled)')).cursor === 'pointer',
    cs(q('.csWorkflowStage:disabled')).cursor + ' / ' + cs(q('.csWorkflowStage:not(:disabled)')).cursor)

  // 浮层：DD-02 计划里浮层走 --cs-float；C4 起详情面板 + 图层浮层玻璃化
  // （Q3 拍板：这两处给，minimap 不给）。
  var dp = cs(q('.csDetailPanel'))
  var dpAlpha = alphaOf(dp.backgroundColor)
  ok('详情面板玻璃化：有模糊 + 底色半透明（假玻璃 = 只透明不模糊）',
    dp.backdropFilter !== 'none' && dpAlpha < 1,
    dp.backdropFilter + ' / alpha=' + dpAlpha)
  ok('浮层阴影 = --cs-shadow-2（.csDetailPanel 用的就是 2 档，不是 3 档）',
    dp.boxShadow === resolveShadow('--cs-shadow-2'),
    dp.boxShadow.slice(0, 40) + ' vs ' + resolveShadow('--cs-shadow-2').slice(0, 40))

  probe.remove()
  finalize()
})()
</script>`

/* ------------------------------------------------------------------ 页面 */

const html = `<!doctype html>
<html lang="zh-CN"${` data-cs-preset="${defaultPreset}"`}>
<head>
<meta charset="utf-8" />
<title>Canvas Studio · 视觉升维验收台（DD-01~DD-06）</title>
<style>
${studioStyles}

/* ---- 真实令牌：色值全部来自 lib/brand.js，不手抄（见 preview-tokens.mjs） ---- */
${brandCss}

/* ---- 宿主令牌（宿主契约，插件只读；预览里给一份可用的值） ---- */
:root {
${renderTokenBlock(HOST_TOKENS_DARK)}
}
html[data-light] {
${renderTokenBlock(HOST_TOKENS_LIGHT)}
}

/* ---- 预览自有脚手架（pv* 命名空间，绝不与 cs* / dsw* 混用） ---- */
html, body { margin: 0; }
body {
  background: #0b0c10;
  color: var(--dsw-alias-label-primary);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
  font-size: 13px;
}
html[data-light] body { background: #e9e9ee; }
.pvBar {
  position: sticky; top: 0; z-index: 99; display: flex; flex-wrap: wrap;
  align-items: center; gap: 8px; padding: 8px 12px;
  background: var(--cs-shell, #15171e); border-bottom: 1px solid var(--cs-line, rgba(255,255,255,.08));
}
.pvBar strong { font-weight: 500; margin-right: 4px; }
.pvBar button, .pvBar select {
  padding: 4px 10px; font-size: 12px; border-radius: 6px;
  border: 1px solid var(--cs-line, rgba(255,255,255,.12));
  background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer;
}
.pvBar button.pvOn { background: var(--cs-accent); border-color: var(--cs-accent); color: #fff; }
.pvHint { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.pvCheck {
  margin: 8px 12px 0; padding: 10px 12px; border-radius: 8px; white-space: pre-wrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; line-height: 1.6;
  background: rgba(255,255,255,.03); border: 1px solid var(--cs-line, rgba(255,255,255,.1));
  color: var(--dsw-alias-label-secondary);
}
.pvCheckOk { border-color: color-mix(in srgb, var(--cs-teal) 45%, transparent); }
.pvCheckFail { border-color: color-mix(in srgb, #e5484d 55%, transparent); }
.pvStage { height: 830px; }
.pvLabel {
  position: absolute; right: 12px; top: 12px; z-index: 20; padding: 3px 9px;
  border-radius: 999px; font-size: 11px; background: rgba(255,255,255,.06);
  color: var(--dsw-alias-label-tertiary);
}
#pvVerdict { display: none; }
/* D1 截图基线模式（URL ?screenshot=1）：入场动画全部禁掉 —— headless
   --virtual-time-budget 不推进 CSS 动画时钟，fill both 的入场（csDevelopIn 等）
   会冻在 scale(0.94) 首帧，基线会截到缩着的节点。禁动画 = 回到终态布局，
   基线才能跨批次可比。 */
[data-pv-static] .csNode,
[data-pv-static] .csNodeProgressBar,
[data-pv-static] .csWorkflowApproval,
[data-pv-static] .csWorkflowClap,
[data-pv-static] .csDetailPanel,
[data-pv-static] .csCanvasLayers,
[data-pv-static] .csErrorCard { animation: none !important; }
</style>
</head>
<body>

<div class="pvBar">
  <strong>视觉升维验收台</strong>
  <button type="button" id="pvTheme">切到浅色</button>
  <select id="pvPreset">
${presetIds.map(id => `    <option value="${id}">预设 · ${presetLabels[id]}</option>`).join('\n')}
  </select>
  <button type="button" id="pvLineage">显示血缘聚光</button>
  <span class="pvHint">四预设 × 明暗双轨 · 页内自检见下方卡片（页首刷新即为当前主题，自检会跟着重跑）</span>
</div>
<pre id="pvVerdict"></pre>
<div class="pvCheck" id="pvCheck">自检运行中…</div>

<div class="csFrame" style="grid-template-columns:1fr;height:auto;padding:0">
  <div style="display:flex;flex-direction:column;min-height:0">

    <!-- ===== 工作流条 + 场记板审批条（DD-05） ===== -->
    <div class="csWorkflowBar" id="pvBaselineApproval">
      <span class="csWorkflowMode">
        <button type="button">逐步确认</button>
        <button type="button" class="csActive">放手跑</button>
      </span>
      <span class="csWorkflowState">分镜待批准</span>
      <div class="csWorkflowStages" role="group" aria-label="制作阶段" title="制作阶段：定妆">
        <button type="button" class="csWorkflowStage csStageDone"><i></i>剧本</button>
        <span class="csStageLink csStageLinkDone"></span>
        <button type="button" class="csWorkflowStage csStageDone"><i></i>分镜</button>
        <span class="csStageLink csStageLinkDone"></span>
        <button type="button" class="csWorkflowStage csStageNow"><i></i>定妆</button>
        <span class="csStageLink"></span>
        <button type="button" class="csWorkflowStage" disabled><i></i>关键帧</button>
        <span class="csStageLink"></span>
        <button type="button" class="csWorkflowStage" disabled><i></i>镜头</button>
        <span class="csStageLink"></span>
        <button type="button" class="csWorkflowStage" disabled><i></i>成片</button>
      </div>
      <div class="csWorkflowApproval">
        <span class="csWorkflowClap" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 32 32" fill="none"><rect x="3" y="15" width="26" height="13" rx="3" fill="currentColor" opacity="0.92"/><rect x="3" y="6" width="26" height="7" rx="2" fill="currentColor" transform="rotate(-12 16 9)"/></svg></span>
        <span class="csWorkflowMessage">分镜表已提交到画布，请确认后批准</span>
        <input type="text" class="csRejectInput" placeholder="不满意哪里？（可选，随驳回转给 AI）" />
        <button type="button" class="csPrimary">批准并开始制作</button>
        <button type="button">驳回，继续修改</button>
        <span class="csWorkflowState">批准后自动恢复流程</span>
      </div>
      <!-- N4：右上角产出计数（审批态在产品里隐藏，这里作为独立样本验证样式）。 -->
      <span class="csWorkflowTime" title="画布上已产出的制作节点数（便签等手工件不计）">已产出 7 个节点 · 阶段 3</span>
    </div>

    <!-- ===== 画布（DD-02 空间 / DD-03 节点卡片） ===== -->
    <div class="csCanvas" id="pvBaselineCanvas" style="height:830px">
      <div class="csCanvasBody">
        <div class="csCanvasSurface">
          <span class="pvLabel">画布 · 点阵双层网格 · 空间三档</span>
          <div class="csCanvasLayer">
${canvasNodes}
            <!-- C6：框选进行中 —— 矩形 + 命中预览（场景卡带 csNodeHit）。
                 骨架里是静态快照，验的是「框选中的画面长什么样」。 -->
            <div class="csMarquee" style="left:296px;top:264px;width:190px;height:156px"
                 title="框选进行中：与矩形相交的节点实时亮描边"></div>
          </div>
        </div>
        <div class="csDetailPanel" style="position:absolute;right:16px;top:16px;width:250px">
          <div class="csDetailPanelHeader"><span>#02 关键帧</span></div>
          <div class="csDetailPanelBody">
            <span>浮层底色走 --cs-float、阴影走 --cs-shadow-3（DD-02 空间三档的第四档）。</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== 时间轴（DD-04a 真时间轴） ===== -->
    <div class="csTimeline" id="pvBaselineTimeline">
      <div class="csTimelineToolbar">
        <button type="button" class="csTimelinePlay" title="预览播放：0.1s 步进推进播放头，到终点自动停">▶ 播放</button>
        <span class="csTimelineCount" title="参与合成的逐镜片段数">视频片段 3</span>
        <span class="csTimelineEst" title="Σ 有效片段真值时长">预计成片 10.7s</span>
        <label class="csTimelineBgm">BGM
          <select><option>不使用</option><option selected>雨夜氛围 · 42s</option></select>
        </label>
        <label class="csTimelineToggleAll"><input type="checkbox" /> 显示全部</label>
        <button type="button" class="csPrimary">合成导出成片</button>
      </div>
      <div class="csTlBody">
        <div class="csTlLanes">
          <div class="csTlRuler">
${tickHtml.map(t => '            ' + t).join('\n')}
          </div>

          <div class="csTlTrack">
            <span class="csTlTrkLabel">视频轨</span>
            <div class="csTlLane csTlLaneTall">
${clipHtml}
            </div>
          </div>

          <div class="csTlTrack">
            <span class="csTlTrkLabel">BGM</span>
            <div class="csTlLane">
              <div class="csTlClip csTlClipBgm csTlClipSel" style="left:0%;width:calc(100% - 3px)" title="雨夜氛围 · 42.0s · 已选用，点按取消">
                <span class="csTlClipLbl">♪ 雨夜氛围 · 42.0s</span>
              </div>
            </div>
          </div>

          <div class="csTlTrack">
            <span class="csTlTrkLabel">参考·产物</span>
            <div class="csTlLane">
              <div class="csTlRefRow">
                <span class="csTlRefChip">角色 · 林晚</span>
                <span class="csTlRefChip">场景 · 卧室</span>
                <span class="csTlRefChip csTlRefChipFilm">成片 · 10.7s</span>
                <span class="csTlRefChip csTlRefChipRetired">旧版关键帧</span>
              </div>
            </div>
          </div>

          <div class="csTlPlayhead" style="left:${playheadLeft}" title="播放头 3.2s · 拖动标尺擦洗">
            <span class="csTlPhGrip"></span>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== C8：空态「预演」幽灵流水线 + 错误三级视觉分级（样本区） ===== -->
    <div class="pvSamples" style="position:relative;padding:20px var(--cs-space-6, 32px);display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
      <span class="pvLabel" style="position:absolute;left:32px;top:2px">C8 · 空态预演 + 错误三级（越严重越往错误色靠）</span>
      <div class="csCanvasEmptyHint" style="position:static;transform:none;width:340px;flex:0 0 auto;text-align:left">
        <p class="csCanvasEmptyHintTitle">从一句话创意开始</p>
        <p class="csCanvasEmptyHintText">描述创意后，画布上会依次长出分镜、定妆、场景与镜头节点。</p>
        <div class="csGhostPipeline" aria-hidden="true">
          <span class="csGhostNode">分镜</span><span class="csGhostLink"></span><span class="csGhostNode">定妆</span><span class="csGhostLink"></span><span class="csGhostNode">镜头</span><span class="csGhostLink"></span><span class="csGhostNode csGhostNodeFinal">成片</span>
        </div>
      </div>
      <div class="csErrorCard csErrorKindRetryable" role="alert" style="flex:1 1 220px">
        <p class="csErrorTitle">出错了，重试一次？</p>
        <p class="csErrorMessage">生成请求被拒（示例消息：参数 shot_index 越界）</p>
        <p class="csErrorHint"></p>
        <div class="csErrorActions">
          <button type="button" class="csErrorAction csErrorActionPrimary">重试</button>
        </div>
      </div>
      <div class="csErrorCard csErrorKindConfig" role="alert" style="flex:1 1 220px">
        <p class="csErrorTitle">配置缺失</p>
        <p class="csErrorMessage">示例消息：Drama API base 未配置</p>
        <p class="csErrorHint">请到设置里检查 Drama API 基址与密钥。</p>
        <div class="csErrorActions">
          <button type="button" class="csErrorAction csErrorActionPrimary">打开设置</button>
          <button type="button" class="csErrorAction">重试</button>
        </div>
      </div>
      <div class="csErrorCard csErrorKindUnreachable" role="alert" style="flex:1 1 220px">
        <p class="csErrorTitle">服务不可达</p>
        <p class="csErrorMessage">示例消息：fetch failed: ECONNREFUSED</p>
        <p class="csErrorHint">生成服务没有响应，请确认 Drama 后端已启动后重试。</p>
        <div class="csErrorActions">
          <button type="button" class="csErrorAction csErrorActionPrimary">重试</button>
        </div>
      </div>
    </div>

  </div>
</div>

<script>
(function () {
  var query = new URLSearchParams(location.search)
  function stored(key) { try { return localStorage.getItem(key) } catch (e) { return null } }
  function remember(key, value) { try { localStorage.setItem(key, value) } catch (e) { /* 无 storage：仅本次会话生效 */ } }

  // 主题与预设**必须在自检之前**落到 DOM 上（自检读 computedStyle）。
  // 优先级：URL 查询串 > localStorage > 生成时的默认值。
  // URL 优先是为了无头双主题/双预设验收（file://…?theme=light&preset=…）—— 无头没有 localStorage。
  var theme = query.get('theme') || stored('pvTheme') || 'dark'
  if (theme === 'light') document.documentElement.setAttribute('data-light', '')
  // D1 截图基线模式：?screenshot=1 → 禁全部入场动画（见样式块 [data-pv-static]），
  // headless --screenshot 截到的是稳定终态，跨批次可比。
  if (query.get('screenshot') === '1') document.documentElement.setAttribute('data-pv-static', '')
  // ?view=canvas|timeline|approval：只渲染目标区（capture-baselines.mjs 用）。
  // 不用滚动/fragment —— headless --screenshot 对滚动后画面不重合成，会截到纯底色。
  var view = query.get('view')
  if (view !== null && view.length > 0) {
    var HIDE_BY_VIEW = {
      canvas: ['.csTimeline', '.pvSamples', '.pvBar', '.pvHint', '.pvCheck'],
      timeline: ['.csWorkflowBar', '.csCanvas', '.pvSamples', '.pvBar', '.pvHint', '.pvCheck'],
      approval: ['.csCanvas', '.csTimeline', '.pvSamples', '.pvBar', '.pvHint', '.pvCheck'],
    }
    var hideSelectors = HIDE_BY_VIEW[view] || []
    hideSelectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) { el.style.display = 'none' })
    })
  }

  var preset = query.get('preset') || stored('pvPreset')
    || document.documentElement.getAttribute('data-cs-preset')
  if (preset) {
    document.documentElement.setAttribute('data-cs-preset', preset)
    remember('pvPreset', preset)
  }

  var themeBtn = document.getElementById('pvTheme')
  themeBtn.textContent = theme === 'light' ? '切到暗色' : '切到浅色'
  themeBtn.addEventListener('click', function () {
    remember('pvTheme', theme === 'light' ? 'dark' : 'light')
    // 重载一次：让页内自检在切换后的主题下重跑（自检读 computedStyle，必须重跑）。
    location.reload()
  })

  var presetSel = document.getElementById('pvPreset')
  presetSel.value = preset
  if (presetSel.value !== preset) {
    // 未知预设名：选择器匹配空集 → 令牌整批消失，而 styles.ts 的兜底色会让页面
    // 「看着还行」。静默失败，必须吵。这里回退到首个预设保证可看，但把错误名挂在
    // html 上让自检判 FAIL（见自检里的 preset 有效性断言）。
    // 注意：赋值失败时 selectedIndex 是 -1，options[-1] 为 undefined，不能拿它兜底。
    document.documentElement.setAttribute('data-pv-preset-bad', String(preset))
    preset = presetSel.options[0].value
    presetSel.value = preset
    document.documentElement.setAttribute('data-cs-preset', preset)
  }
  presetSel.addEventListener('change', function () {
    // 必须先存下来再重载 —— 重载会重新读取文件里的 data-cs-preset，不存就白切。
    remember('pvPreset', this.value)
    location.reload()
  })

  // C10 负向对照：?card=legacy 把头/脚还原成「浮在卡片上的绝对定位条」——
  // 也就是 C2 角标带的状态（角标压在画面上、卡片一点没变高）。它存在的唯一目的
  // 是**证明**「头/体/脚是真实布局行」「卡高 = 三者之和」这两条结构断言真的会变红：
  // 一条永远不会红的断言不算断言。verify-previews.mjs 用它做 expectFail 用例，
  // 每次全量验收都会跑一遍。
  if (query.get('card') === 'legacy') {
    var legacyStyle = document.createElement('style')
    legacyStyle.textContent =
      '.csNode{display:block!important}'
      + '.csNodeHead{position:absolute!important;top:0!important;left:0!important;right:0!important}'
      + '.csNodeFoot{position:absolute!important;bottom:0!important;left:0!important;right:0!important}'
      + '.csNodeMediaBox,.csNodeText{height:100%!important;flex:none!important}'
    document.head.appendChild(legacyStyle)
  }

  // 「血缘聚光」是选中相关态：默认不压暗（首要任务是看清卡片本身），
  // 点开才把非血缘节点压到 --cs-dim，用来单独验这一个语义。
  document.getElementById('pvLineage').addEventListener('click', function () {
    var on = this.classList.toggle('pvOn')
    this.textContent = on ? '关闭血缘聚光' : '显示血缘聚光'
    var nodes = document.querySelectorAll('.csCanvasLayer .csNode')
    Array.prototype.forEach.call(nodes, function (el) {
      var lit = el.getAttribute('data-lit') === '1'
      el.classList.toggle('csNodeDimmed', on && !lit)
    })
  })
})()
</script>
${selfCheck}
</body>
</html>`

await writeFile(outPath, html)
console.log(`visual preview written: ${outPath}`)
