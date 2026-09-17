/**
 * CV-198 验收台：**复制到系统剪贴板**（把产品源码喂进真 Chromium 跑）。
 *
 * ## 为什么只登记「真时间跑法」
 *
 * 本页在 `--virtual-time-budget` 下**连素材都造不出来**（`canvas.toBlob` 时好时坏），
 * 所以 `verify-previews.mjs` 只把它登记成**自带跑法**目标（`selfRun`）：
 * `node scripts/preview-clipboard.mjs --realtime` 自己起 HTTP 服务、自己开
 * **不带虚拟时间**的 headless，跑完覆盖：
 *
 * - 真实来源（http://127.0.0.1，即产品实际来源）下的能力判定 `available()` 与
 *   `ClipboardItem` / `createImageBitmap` 门；
 * - 取资产成功与**真 404** 失败的归类；
 * - 编排：谁被调用、各调几次、交给剪贴板的是什么类型（webp 编码一次 / png 原样透传）；
 * - 文字载荷逐字节；视频 / 音频不参与（保留「下载资产」）；
 * - **完整转码链**：`取资产 → createImageBitmap → canvas.toBlob(PNG) → 落笔`，
 *   并量出转码后的**魔数与分辨率**（证明转码没裁切、没缩放）。
 *
 * ## ⚠️ 为什么必须分两种跑法（踩了一整轮，别再踩）
 *
 * `--virtual-time-budget` 下 **canvas 编码是不可靠的**：同一段代码有时 0ms 返回、
 * 有时**永久不触发回调**（`--disable-accelerated-2d-canvas`、`--use-gl=swiftshader`、
 * 把虚拟预算加到 120000 都救不回来）。真时间下同一段代码 **11ms** 返回 ——
 * 是虚拟时间与 canvas 光栅化抢时序，**不是被测代码的问题**，所以别去改产品代码
 * 「绕开」它。
 *
 * 真时间跑法的关键在于**拖住 load 事件**：页面里挂一个指向 `/__hold` 的 1×1 图片
 * （服务端收到就**先不回**），自检跑完再 `fetch('/__done')`，服务端这才放开
 * `/__hold` ⇒ load 事件触发 ⇒ 不带虚拟时间的 `--dump-dom` 把带判决的 DOM 吐回来。
 *
 * ## 页内不用替身重写实现
 *
 * 生成时把 `src/client/canvas/clipboard-env.ts` 的类型注解按一张**显式转换表**
 * 剥成纯 JS（表里每条都要求命中 ≥1 次，命中不了就让生成失败），再用 `new Function`
 * 让 V8 亲口确认能解析，然后页内调用**产品函数本体**；判定与文案来自
 * `lib/clipboard-copy.js` 的编译产物。
 *
 * ## 无头环境测不到的那一件事（诚实声明）
 *
 * 真机上 `clipboard.write()` / `writeText()` 还需要**用户手势**（transient
 * activation）。无头 Chrome 没有手势，而实测（`scripts/probe-clipboard.mjs`）显示
 * 此时这两个 API 会**挂住不 settle**。所以本台子把「落笔」这一步换成打桩记录：
 *
 * - 被验证的：判定、取资产、**转码**、交给剪贴板的是什么字节、失败怎么归类；
 * - 不被验证的：Chrome 的权限 / 手势门 —— 必须由**真机一次真实点击**验收。
 *
 * ## 反向对照（本仓规矩：新守卫必须能红）
 *
 * `?oracle=broken`（或 `--realtime --oracle=broken`）把「期望的 PNG 魔数」换成 JPEG
 * 的 —— 断言若真在读产出的字节，这一组必红。
 *
 * 用法：node scripts/preview-clipboard.mjs [输出路径]
 *      node scripts/preview-clipboard.mjs --realtime [--oracle=broken]
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = join(root, '.workbuddy', 'preview')
const outPath = join(outDir, 'clipboard-copy-preview.html')
await mkdir(outDir, { recursive: true })

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

/* --------------------------------------------------- 一、把产品源码变成页内可跑的 JS */

/**
 * `clipboard-env.ts` 的类型注解剥离表。
 *
 * 为什么用手写表而不是「通用正则去类型」：通用规则会咬到对象字面量
 * （`{ 'image/png': png }` 里的 `: png` 长得就像类型注解），一咬就把载荷吃掉，
 * 而那种坏法是**静默**的。手写表每条都要求命中，咬不动的地方会当场报错。
 */
const TYPE_TRANSFORMS = [
  [/^import .*$/gm, ''],
  [/^export /gm, ''],
  [/const BROWSER_ENV: ClipboardEnv =/g, 'const BROWSER_ENV ='],
  [/function clipboardEnv\(\): ClipboardEnv \{/g, 'function clipboardEnv() {'],
  [/\(node: StudioCanvasNode\)/g, '(node)'],
  [/\(bitmap: ImageBitmap\)/g, '(bitmap)'],
  [/\(blob: Blob\)/g, '(blob)'],
  [/\(text: string\)/g, '(text)'],
  [/\(png: Blob\)/g, '(png)'],
  [/\): Promise<Blob>/g, ')'],
  [/\): Promise<void>/g, ')'],
  [/\): boolean \{/g, ') {'],
]

/** 实现里必须有这几处 —— 少了说明转换把实现弄丢了，不能拿空模块去测绿。 */
const ENV_NEEDLES = [
  'new ClipboardItem',
  'createImageBitmap(',
  'canvas.toBlob(',
  'bitmap.close()',
  'response.ok',
  'typeof navigator.clipboard.writeText',
]

const envTs = await readFile(join(root, 'src', 'client', 'canvas', 'clipboard-env.ts'), 'utf8')
let envJs = envTs
for (const [pattern, replacement] of TYPE_TRANSFORMS) {
  if (!pattern.test(envJs)) {
    console.error(`✗ clipboard-env.ts 里没有命中 ${pattern} —— 类型注解转换表过期了，请补一条再跑。`)
    process.exit(1)
  }
  envJs = envJs.replace(pattern, replacement)
}
for (const needle of ENV_NEEDLES) {
  if (!envJs.includes(needle)) {
    console.error(`✗ 转换后的 clipboard-env 少了实现片段 ${needle} —— 不能拿它去测。`)
    process.exit(1)
  }
}
try {
  // eslint-disable-next-line no-new-func -- 有意为之：让 V8 解析这段转换结果。
  new Function(envJs)
} catch (error) {
  console.error(`✗ 转换后的 clipboard-env.js 无法解析：${error.message}`)
  process.exit(1)
}

/** 纯模块直接吃 `tsc` 产物（本来就是 JS），只剥 `export `。 */
const pureJs = (await readFile(join(root, 'lib', 'clipboard-copy.js'), 'utf8')).replace(/^export /gm, '')
try {
  // eslint-disable-next-line no-new-func -- 同上。
  new Function(pureJs)
} catch (error) {
  console.error(`✗ lib/clipboard-copy.js 无法解析（先跑 tsc -p tsconfig.json）：${error.message}`)
  process.exit(1)
}

/* ------------------------------------------------------------------------ 二、页面 */

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>Canvas Studio · CV-198 复制到系统剪贴板</title>
<style>
:root { --pv-bg: #14161d; --pv-fg: #e8e9ee; --pv-muted: #9aa0b4; --pv-line: #2b2f3d; }
html[data-light] { --pv-bg: #f6f7fb; --pv-fg: #1b1e28; --pv-muted: #5b6274; --pv-line: #dfe3ee; }
body { margin: 0; padding: 22px; background: var(--pv-bg); color: var(--pv-fg); font: 12px/1.75 -apple-system, "PingFang SC", sans-serif; }
h1 { font-size: 15px; margin: 0 0 4px; }
h2 { font-size: 12px; margin: 18px 0 6px; color: var(--pv-muted); font-weight: 600; }
.pvSection { border-top: 1px solid var(--pv-line); padding-top: 4px; }
.pvCheck { margin-top: 16px; padding: 10px 12px; border: 1px solid var(--pv-line); border-radius: 8px; white-space: pre-wrap; font-family: ui-monospace, Menlo, monospace; font-size: 11px; }
pre { white-space: pre-wrap; font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: var(--pv-muted); }
.pvManual { margin-top: 14px; padding: 10px 12px; border-left: 3px solid var(--pv-muted); color: var(--pv-muted); }
table { border-collapse: collapse; font-size: 11px; }
td, th { border: 1px solid var(--pv-line); padding: 3px 8px; text-align: left; }
</style>
</head>
<body>
<h1>CV-198 · 节点内容 → 系统剪贴板</h1>
<p style="color:var(--pv-muted);margin:0">页面调用的 <code>clipboardEnv()</code> / <code>loadBlob</code> / <code>toPng</code> / <code>available</code>
是 <code>src/client/canvas/clipboard-env.ts</code> 的**产品源码**（生成时剥掉类型注解后注入），
判定与文案来自 <code>lib/clipboard-copy.js</code> 的编译产物。</p>

<div class="pvSection">
  <h2>A · 环境能力（真实 Chromium）</h2>
  <table id="pvEnvTable"><tbody></tbody></table>
</div>

<div class="pvManual">
  <strong>两件在这里测不到的事（写在页面上，免得看到全绿就以为万事大吉）：</strong>
  <ul style="margin:6px 0 0 16px">
    <li>真机上 <code>clipboard.write()</code> / <code>writeText()</code> 还需要**用户手势** —— 无头没有手势时这两个 API 会挂住不返回
      （见 <code>scripts/probe-clipboard.mjs</code>），所以本台子把「落笔」换成打桩记录，等你在真机上点一次验收。</li>
    <li>canvas 编码在**虚拟时间**下不可靠（时而 0ms、时而永久不回调），所以默认跑法跳过编码段，
      由 <code>node scripts/preview-clipboard.mjs --realtime</code> 在**真时间**下补跑（见脚本头注释）。</li>
  </ul>
</div>

<div class="pvCheck" id="pvCheck">自检运行中…</div>
<pre id="pvVerdict"></pre>

<script>
var PURE_SRC = ${JSON.stringify(pureJs)}
var ENV_SRC = ${JSON.stringify(envJs)}

var pure = null
/** 把一段模块源码变成它的导出对象（Node 侧已用 new Function 验过可解析）。 */
function makeModule(source, names) {
  var factory = new Function('__pure', source + '\\nreturn { ' + names.join(', ') + ' }')
  return factory(pure)
}

pure = makeModule(PURE_SRC, ['clipboardPlanOf', 'pngTranscodeNeeded', 'copyNodeToClipboard', 'copyTextToClipboard', 'clipboardResultMessage'])
var envModule = makeModule('var pngTranscodeNeeded = __pure.pngTranscodeNeeded\\n' + ENV_SRC, ['clipboardEnv', 'loadBlob', 'toPng'])

;(async function () {
  'use strict'
  var params = new URLSearchParams(location.search)
  var theme = params.get('theme') === 'light' ? 'light' : 'dark'
  document.documentElement.toggleAttribute('data-light', theme === 'light')
  // 反向对照：把期望的 PNG 魔数换成 JPEG 的。断言若真的在读产出的字节，这一组必红。
  var BROKEN = params.get('oracle') === 'broken'
  var EXPECT_MAGIC = BROKEN ? [0xff, 0xd8, 0xff, 0xe0] : [0x89, 0x50, 0x4e, 0x47]
  // 注意：本页**只适合真时间**跑（虚拟时间下 canvas 编码不可靠，连素材都造不出来）。
  var OVER_HTTP = location.protocol === 'http:'

  // 真时间跑法要拖住 load 事件：这个请求服务端先不回，自检跑完再放开。
  if (OVER_HTTP) {
    var hold = document.createElement('img')
    hold.width = 1
    hold.height = 1
    hold.alt = ''
    hold.src = '/__hold'
    document.body.appendChild(hold)
  }

  var lines = []
  var fail = 0
  function flush(extra) {
    var box = document.getElementById('pvCheck')
    if (box !== null) box.textContent = '自检进行中（' + lines.length + ' 条）\\n' + lines.join('\\n') + (extra ? '\\n… ' + extra : '')
  }
  function check(label, ok, detail) {
    lines.push((ok ? '\\u2705 ' : '\\u274c ') + label + (detail ? '  \\u2192 ' + detail : ''))
    if (!ok) fail += 1
    flush()
  }
  /** 异步段之前先落一句话：无头下万一挂住，页面上要看得到挂在哪一段。 */
  function stage(name) { flush(name) }

  function makeCanvasBlob(type, width, height) {
    return new Promise(function (resolve, reject) {
      var canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      var ctx = canvas.getContext('2d')
      ctx.fillStyle = '#7c6cff'
      ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = '#35c2a6'
      ctx.fillRect(4, 4, width - 8, height - 8)
      canvas.toBlob(function (blob) {
        if (blob === null) { reject(new Error('toBlob 返回 null')); return }
        resolve(blob)
      }, type)
    })
  }
  async function magicOf(blob) {
    var bytes = new Uint8Array(await blob.slice(0, 4).arrayBuffer())
    return Array.prototype.slice.call(bytes)
  }
  function sameBytes(a, b) {
    if (a === null || b === null || a.length !== b.length) return false
    for (var i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
    return true
  }
  function nodeOf(kind, url, extra) {
    return Object.assign({ id: 'n-' + kind, kind: kind, url: url, x: 0, y: 0, width: 10, height: 10, createdAt: 0, origin: 'agent', sourceIds: [] }, extra || {})
  }

  try {
    var real = envModule.clipboardEnv()

    /* ---- A 环境能力 ---- */
    var rows = [
      ['location.origin', String(location.origin)],
      ['isSecureContext', String(window.isSecureContext)],
      ['available()', String(real.available())],
      ['navigator.clipboard.write', typeof (navigator.clipboard || {}).write],
      ['navigator.clipboard.writeText', typeof (navigator.clipboard || {}).writeText],
      ['ClipboardItem', typeof window.ClipboardItem],
      ['createImageBitmap', typeof window.createImageBitmap],
    ]
    var tbody = document.querySelector('#pvEnvTable tbody')
    rows.forEach(function (row) {
      var tr = document.createElement('tr')
      var th = document.createElement('th')
      th.textContent = row[0]
      var td = document.createElement('td')
      td.textContent = row[1]
      tr.appendChild(th)
      tr.appendChild(td)
      tbody.appendChild(tr)
    })
    check('available() 判 true（安全上下文 + ClipboardItem + write/writeText 全在）', real.available() === true, String(real.available()))
    check('环境能力表里五项都齐全（write / writeText / ClipboardItem / createImageBitmap 都是 function）',
      rows.slice(3).every(function (row) { return row[1] === 'function' }),
      rows.slice(3).map(function (row) { return row[0] + '=' + row[1] }).join(' | '))

    /* ---- 打桩：只换「落笔」这一步，其余全是产品实现 ---- */
    var counters = { writeText: 0, writeImage: 0, loadBlob: 0, toPng: 0 }
    var written = null
    var writtenText = null
    /** 造一个环境；overrides 用来把某一步换成固定输入。 */
    function makeEnv(overrides) {
      counters = { writeText: 0, writeImage: 0, loadBlob: 0, toPng: 0 }
      written = null
      writtenText = null
      var base = {
        available: function () { return real.available() },
        writeText: function (text) { counters.writeText += 1; writtenText = text; return Promise.resolve() },
        writeImage: function (png) { counters.writeImage += 1; written = png; return Promise.resolve() },
        loadBlob: function (node) { counters.loadBlob += 1; return real.loadBlob(node) },
        toPng: function (blob) { counters.toPng += 1; return real.toPng(blob) },
      }
      return Object.assign(base, overrides || {})
    }

    /* ---- B 取资产：成功与失败 ---- */
    stage('B · 造素材')
    var W = 40
    var H = 24
    var webp = await makeCanvasBlob('image/webp', W, H)
    var png = await makeCanvasBlob('image/png', W, H)
    check('前置：canvas 能造出 webp 与 png 两种素材（否则下面的分支测不到）',
      webp.type === 'image/webp' && png.type === 'image/png',
      webp.type + ' ' + webp.size + ' B | ' + png.type + ' ' + png.size + ' B')

    stage('B · loadBlob(blob:)')
    var webpNode = nodeOf('image', URL.createObjectURL(webp))
    var fetched = await real.loadBlob(webpNode)
    check('loadBlob 取回的字节数与 type 与源一致（真实 fetch）',
      fetched.type === webp.type && fetched.size === webp.size, fetched.type + ' / ' + fetched.size + ' B')

    stage('B · loadBlob(不存在的地址)')
    // http 跑法必须打**真 404**（服务端若把首页 HTML 当资源返回，失败会落在 decode 而不是 fetch）。
    var missingUrl = OVER_HTTP ? '/__does-not-exist.png' : location.href + '.does-not-exist.png'
    var missingResult = await pure.copyNodeToClipboard(nodeOf('image', missingUrl), makeEnv())
    check('取资产失败：归类 fetch，且没有走到写入',
      missingResult.ok === false && missingResult.failure === 'fetch' && counters.writeImage === 0,
      JSON.stringify(missingResult) + ' writeImage=' + counters.writeImage)
    check('取资产失败：文案给了下一步（指回「下载资产」）',
      /下载资产/.test(pure.clipboardResultMessage(missingResult)), pure.clipboardResultMessage(missingResult))

    /* ---- C 编排：谁被调用、交给剪贴板的是什么类型 ---- */
    stage('C · webp 走编码')
    var encodeEnv = makeEnv({ loadBlob: function () { counters.loadBlob += 1; return Promise.resolve(webp) } })
    var imageResult = await pure.copyNodeToClipboard(webpNode, encodeEnv)
    check('webp 节点：判定成功且载荷是 image', imageResult.ok === true && imageResult.payload === 'image', JSON.stringify(imageResult))
    check('webp 节点：取资产 → 编码 → 落笔 各一次（顺序与次数都要对）',
      counters.loadBlob === 1 && counters.toPng === 1 && counters.writeImage === 1,
      'loadBlob=' + counters.loadBlob + ' toPng=' + counters.toPng + ' writeImage=' + counters.writeImage)
    check('webp 节点：交给剪贴板的 Blob 声明为 image/png（剪贴板只收 PNG）',
      written !== null && written.type === 'image/png', written === null ? '没有产出' : written.type)

    stage('C · png 原样透传')
    var pngNode = nodeOf('image', URL.createObjectURL(png))
    var pngEnv = makeEnv({ loadBlob: function () { counters.loadBlob += 1; return Promise.resolve(png) } })
    var passthrough = await pure.copyNodeToClipboard(pngNode, pngEnv)
    check('PNG 节点：成功且**没有**重复编码（toPng 0 次）',
      passthrough.ok === true && counters.toPng === 0, 'ok=' + passthrough.ok + ' toPng=' + counters.toPng)
    check('PNG 节点：交给剪贴板的字节数 = 源字节数（原样透传）',
      written !== null && written.type === 'image/png' && written.size === png.size,
      written === null ? '没有产出' : written.type + ' / ' + written.size + ' B vs 源 ' + png.size + ' B')

    /* ---- D 文字 / 视频 ---- */
    stage('D · 文字与视频')
    var textNode = nodeOf('sticky', undefined, { text: '  正文原样\\n  第二行  ' })
    var textResult = await pure.copyNodeToClipboard(textNode, makeEnv())
    check('文字节点：写出去的正文逐字节等于节点正文（含换行与缩进）',
      textResult.ok === true && writtenText === textNode.text && counters.writeImage === 0, JSON.stringify(writtenText))

    var videoResult = await pure.copyNodeToClipboard(nodeOf('video', 'blob:whatever'), makeEnv())
    check('视频节点：判 empty 且一个环境调用都不发（保留「下载资产」这条路）',
      videoResult.ok === false && videoResult.failure === 'empty'
      && counters.writeImage === 0 && counters.writeText === 0 && counters.loadBlob === 0, JSON.stringify(videoResult))

    /* ---- E 完整转码链 ---- */
    {
      stage('E · 取资产 → 解码 → 编码 → 落笔')
      var fullResult = await pure.copyNodeToClipboard(webpNode, makeEnv())
      check('完整链路：webp 节点从真实 fetch 一路走到落笔，判定成功',
        fullResult.ok === true && fullResult.payload === 'image', JSON.stringify(fullResult))
      var magic = written === null ? null : await magicOf(written)
      check('完整链路：交给剪贴板的是真 PNG（魔数 89 50 4E 47 —— 本组反向对照就改这一条）',
        sameBytes(magic, EXPECT_MAGIC), magic === null ? '没有产出' : magic.join(','))
      var bitmap = written === null ? null : await createImageBitmap(written)
      check('完整链路：转码后分辨率与源一致（没有裁切 / 缩放）',
        bitmap !== null && bitmap.width === W && bitmap.height === H,
        bitmap === null ? '没有产出' : bitmap.width + '×' + bitmap.height + ' vs 源 ' + W + '×' + H)
      if (bitmap !== null) bitmap.close()
      check('完整链路：走了编码（toPng 恰好 1 次）', counters.toPng === 1, 'toPng=' + counters.toPng)
    }

    /* ---- F 反向对照声明 ---- */
    check('反向对照开关：' + (BROKEN ? '已打开（期望魔数是 JPEG，本组应当变红）' : '未打开（期望魔数是 PNG）'),
      true, BROKEN ? 'oracle=broken' : 'oracle=ok')
  } catch (error) {
    check('自检未抛异常', false, 'THROW ' + String(error && error.message ? error.message : error))
  }

  var pre = document.getElementById('pvVerdict')
  document.documentElement.setAttribute('data-pv-fail', String(fail))
  pre.textContent = '# ' + (fail === 0 ? '全部通过' : fail + ' 条失败') + ' / ' + lines.length + ' 条断言'
    + '\\n' + lines.join('\\n')
  document.getElementById('pvCheck').textContent =
    (fail === 0 ? '\\u2705 ' : '\\u274c ') + (fail === 0 ? '全部通过' : fail + ' 条失败')
    + ' / ' + lines.length + ' 条断言\\n' + lines.join('\\n')
  // 放开拖住 load 事件的那个请求（真时间跑法专用）。
  if (OVER_HTTP) { try { await fetch('/__done') } catch (error) { /* 服务端不在也不影响判决 */ } }
})()
</script>
</body>
</html>
`

await writeFile(outPath, html, 'utf8')
console.log(`preview written: ${outPath}`)

/* -------------------------------------------------- 三、真时间跑法（--realtime，可选） */

if (!process.argv.includes('--realtime')) process.exit(0)

let chrome = null
for (const candidate of CHROME_CANDIDATES) {
  try {
    await execFileAsync('test', ['-x', candidate])
    chrome = candidate
    break
  } catch { /* 试下一个 */ }
}
if (chrome === null) {
  console.log('未找到 Chrome —— 跳过真时间实测（设置 CHROME_PATH 后重试）。')
  process.exit(0)
}

const brokenOracle = process.argv.includes('--oracle=broken')
const VERDICT_RE = /<pre id="pvVerdict">([\s\S]*?)<\/pre>/
const FAIL_RE = /data-pv-fail="(\d+)"/

let releaseHold = null
let holdArmed = false
const server = createServer((req, res) => {
  const url = req.url ?? '/'
  if (url.startsWith('/__hold')) {
    holdArmed = true
    // 保险：万一页面在收尾前抛错，20s 后也要放开，免得 Chrome 一直等 load 事件。
    const timer = setTimeout(() => { if (releaseHold !== null) releaseHold() }, 20000)
    let released = false
    releaseHold = () => {
      // 只能放一次：兜底定时器与正常收尾都会调它（重复 writeHead 会直接崩进程）。
      if (released) return
      released = true
      clearTimeout(timer)
      res.writeHead(200, { 'content-type': 'image/gif' })
      res.end()
    }
    return
  }
  if (url.startsWith('/__done')) {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
    setTimeout(() => { if (releaseHold !== null) releaseHold() }, 50)
    return
  }
  if (url === '/' || url.startsWith('/?')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html)
    return
  }
  // 其余路径一律真 404 —— 页面的「取资产失败」用例靠它。
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const target = `http://127.0.0.1:${port}/?theme=dark&full=1${brokenOracle ? '&oracle=broken' : ''}`

console.log('── 复制到系统剪贴板（真时间 · http://127.0.0.1）')
let dom = ''
try {
  // 注意：**不带** --virtual-time-budget —— 这正是本跑法的意义所在。
  const { stdout } = await execFileAsync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--use-gl=swiftshader',
    '--hide-scrollbars',
    '--dump-dom',
    target,
  ], { maxBuffer: 64 * 1024 * 1024, timeout: 40000 })
  dom = stdout
} catch (error) {
  console.log(`   ❌ 真时间跑法调用 Chrome 失败：${error.message}`)
  if (releaseHold !== null) releaseHold()
  server.close()
  process.exit(1)
}
if (releaseHold !== null) releaseHold()
server.close()

const verdict = dom.match(VERDICT_RE)
const failAttr = dom.match(FAIL_RE)
if (failAttr === null) {
  console.log(`   ❌ 自检未跑到收尾（多半是页面脚本抛错，或 load 事件没被放开；hold 收到=${holdArmed}）`)
  process.exit(1)
}
const text = verdict === null ? '' : verdict[1].replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
console.log(`   ${Number(failAttr[1]) === 0 ? '✅' : '❌'} ${text.split('\n')[0] || '(空判决)'}`)
for (const line of text.split('\n').slice(1).filter((l) => l.startsWith('❌'))) console.log(`        ${line}`)
process.exit(Number(failAttr[1]) === 0 ? 0 : 1)
