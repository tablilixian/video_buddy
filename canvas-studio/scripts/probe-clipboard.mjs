/**
 * CV-198 探针：**系统剪贴板到底能不能写**（无头 Chrome，零负载自测）。
 *
 * ## 为什么必须探针
 *
 * 「复制到微信」这条需求里，唯一有失败风险的是**写系统剪贴板**。它有三道门，
 * 每一道都能让它静默失败或者抛 NotAllowedError：
 *
 * 1. **安全上下文** —— `navigator.clipboard` 只在 secure context 暴露。插件跑在
 *    `http://127.0.0.1:<port>`（localhost 算 secure）与 `file://`（也算），但这件
 *    事必须**实测**而不是推断 —— `--http` 模式就是为真实来源准备的。
 * 2. **用户手势 + 文档焦点** —— `write()` / `writeText()` 要求 transient activation。
 *    无头环境没有真实手势，所以这里读到的是「权限 / 手势门」的结果，正好用来
 *    分辨「API 不在」与「API 在但拿不到手势」——前者要降级，后者在真机上点一下就好。
 * 3. **PNG 转码** —— 图片进剪贴板只能走 `ClipboardItem({'image/png': blob})`。
 *    产物可能是 webp / jpeg，必须 canvas 重编码成 PNG。这一步是**纯本地计算**，
 *    无头环境完全可测 —— 也是本探针真正要拿结论的地方。
 *
 * ## 2026-09-17 实测结论（Chrome 无头 · macOS）
 *
 * - `file://` 与 `http://127.0.0.1:<port>` 都是 secure context，`navigator.clipboard`
 *   齐全（`write` / `writeText` / `ClipboardItem` / `createImageBitmap` 全在）。
 * - `permissions.query({name:'clipboard-write'})`、`writeText()`、`write()` **无头下全部
 *   超时**，`userActivation.{isActive,hasBeenActive}` 双 false ⇒ 卡的是**手势门**，
 *   不是 API 缺失。真机上一次真实点击即可通过。
 * - `canvas.toBlob('image/png')` 产出 magic `89 50 4E 47` 的真 PNG（272 B）⇒
 *   **转码这一环可以放心依赖**。
 * - `document.execCommand('copy')` 返回 **false** ⇒ 兜底 API 弱，不能拿它当主路。
 *
 * ## 输出
 *
 * 页内把结论塞进 `<pre id="probeJson">`（JSON）与 `data-probe-fail`（0/1），
 * 外层用 `--dump-dom` 读回来即可，不需要 websocket / CDP。页内**分阶段落盘**，
 * 所以即使卡在 write 上也能拿到半截结论（外层会显式警告「未跑到 DONE」）。
 *
 * 用法：node scripts/probe-clipboard.mjs [输出路径]
 *      CHROME_PATH=/path/to/Chrome node scripts/probe-clipboard.mjs --run
 *      node scripts/probe-clipboard.mjs --run --http   （用 http://127.0.0.1 载入，贴近真实来源）
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', '.workbuddy', 'preview')
// 位置参数只有「输出路径」一个，且必须能与 `--run` 共存 —— 直接把 argv[2] 当路径
// 会让 `--run` 被吃成文件名（Chrome 会去开 file://.../--run，页内脚本根本不跑）。
const outArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'))
const outPath = outArg ?? join(outDir, 'clipboard-probe.html')
await mkdir(outDir, { recursive: true })

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>Canvas Studio · 系统剪贴板探针（CV-198）</title>
<style>
body { margin: 0; padding: 18px; font: 12px/1.7 -apple-system, "PingFang SC", sans-serif; background: #14161d; color: #e8e9ee; }
h1 { font-size: 14px; margin: 0 0 10px; }
pre { white-space: pre-wrap; font-size: 11px; }
</style>
</head>
<body>
<h1>系统剪贴板探针（CV-198）</h1>
<pre id="probeLog">running…</pre>
<pre id="probeJson">{}</pre>

<script>
(function () {
  'use strict'
  var report = {
    secureContext: window.isSecureContext,
    origin: location.origin,
    hasClipboardApi: typeof navigator.clipboard === 'object' && navigator.clipboard !== null,
    hasWrite: typeof (navigator.clipboard || {}).write === 'function',
    hasWriteText: typeof (navigator.clipboard || {}).writeText === 'function',
    hasClipboardItem: typeof window.ClipboardItem === 'function',
    hasCreateImageBitmap: typeof window.createImageBitmap === 'function',
    userActivation: typeof navigator.userActivation === 'object' && navigator.userActivation !== null
      ? { isActive: navigator.userActivation.isActive, hasBeenActive: navigator.userActivation.hasBeenActive }
      : null,
    permission: null,
    writeTextError: null,
    imagePng: null,
    writeImageError: null,
    execCommandText: null,
    phase: null,
  }
  var log = []
  function flush() {
    var el = document.getElementById('probeLog')
    if (el !== null) el.textContent = log.join('\\n')
  }
  function note(line) { log.push(line); flush() }
  // 任何运行时错误都要落到页面上 —— 否则 dump-dom 只会看到初始的「running…」，
  // 分不清「脚本没跑」与「跑到一半挂了」。
  window.addEventListener('error', function (event) {
    note('WINDOW ERROR ' + String(event && event.message))
    document.documentElement.setAttribute('data-probe-fail', '1')
  })

  /**
   * 无头环境里 permissions.query / clipboard.write 都可能**永不 settle**（没有真实手势时
   * 某些内核会挂住）。探针不能因此挂在第一个 await 上 —— 全部包一层虚拟时间超时，
   * 拿不到就当 timeout 记下来（timeout 本身也是结论：真机有手势就会立即返回）。
   */
  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve) {
      var settled = false
      var timer = setTimeout(function () {
        if (settled) return
        settled = true
        resolve({ timedOut: true, label: label })
      }, ms)
      promise.then(function (value) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ value: value })
      }, function (error) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ error: error })
      })
    })
  }
  function errName(error) {
    if (error === null || error === undefined) return 'null'
    return String(error.name) + ': ' + String(error.message)
  }
  /** 硬失败判据只看两件事：剪贴板 API 在不在、PNG 转码通不通。 */
  function failOf() {
    return (report.hasClipboardApi && report.imagePng !== null && report.imagePng.magicOk) ? 0 : 1
  }
  /** 可多次调用：无头环境可能挂在 write 上，所以每个阶段都先落一次盘。 */
  function publish(phase) {
    report.phase = phase
    document.getElementById('probeJson').textContent = JSON.stringify(report, null, 2)
    document.documentElement.setAttribute('data-probe-fail', String(failOf()))
  }

  /** 用 canvas 造一张 64x48 的图，重编码成 PNG —— 与产品里「产物 -> 剪贴板」同一条路。 */
  function encodePng() {
    return new Promise(function (resolve, reject) {
      var canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 48
      var ctx = canvas.getContext('2d')
      ctx.fillStyle = '#7c6cff'
      ctx.fillRect(0, 0, 64, 48)
      ctx.fillStyle = '#35c2a6'
      ctx.fillRect(8, 8, 20, 20)
      canvas.toBlob(function (blob) {
        if (blob === null) { reject(new Error('toBlob 返回 null')); return }
        resolve(blob)
      }, 'image/png')
    })
  }

  function bytesOf(blob, count) {
    return blob.slice(0, count).arrayBuffer().then(function (buf) {
      return Array.prototype.slice.call(new Uint8Array(buf))
    })
  }

  async function run() {
    // ① 权限状态（部分内核不实现 clipboard-write 查询，报错/超时都不致命）。
    var perm = await withTimeout(navigator.permissions.query({ name: 'clipboard-write' }), 800, 'permissions.query')
    if (perm.timedOut) report.permission = 'timeout'
    else if (perm.error) report.permission = 'query-failed: ' + errName(perm.error)
    else report.permission = perm.value.state
    note('① 权限：' + report.permission + ' / secureContext=' + report.secureContext)

    // ② 文本写入。
    var w = await withTimeout(navigator.clipboard.writeText('canvas-studio-probe'), 800, 'writeText')
    if (w.timedOut) report.writeTextError = 'timeout'
    else if (w.error) report.writeTextError = errName(w.error)
    else report.writeTextError = null
    note('② writeText：' + (report.writeTextError === null ? '成功' : report.writeTextError))

    // ③ 图片转码（纯本地计算，无头环境全可测 —— 本探针真正要拿结论的地方）。
    try {
      var blob = await encodePng()
      var head = await bytesOf(blob, 8)
      var magicOk = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47
      report.imagePng = { type: blob.type, size: blob.size, magic: head.join(','), magicOk: magicOk }
      note('③ PNG 转码：type=' + blob.type + ' size=' + blob.size + ' magicOk=' + magicOk)

      // ④ 写入剪贴板（转码失败与写入失败必须分开报，它们是两件事）。
      // 先落一次盘再试写 —— 无头环境里 clipboard.write 有可能把渲染进程挂住
      // （下面 ④ 之后的「半截结论」检测就是为这件事准备的）。
      publish('before-write')
      if (report.hasClipboardItem && typeof navigator.clipboard.write === 'function') {
        note('④ 尝试 write([ClipboardItem]) …')
        var item = new ClipboardItem({ 'image/png': blob })
        note('④ ClipboardItem 构造成功 types=' + item.types.join('|'))
        var iw = await withTimeout(navigator.clipboard.write([item]), 800, 'write')
        if (iw.timedOut) report.writeImageError = 'timeout'
        else if (iw.error) report.writeImageError = errName(iw.error)
        else report.writeImageError = null
      } else {
        report.writeImageError = 'unsupported: ClipboardItem=' + report.hasClipboardItem
      }
      note('④ write([ClipboardItem])：' + (report.writeImageError === null ? '成功' : report.writeImageError))
    } catch (error) {
      report.writeImageError = 'transcode: ' + errName(error)
      note('④ write([ClipboardItem])：' + report.writeImageError)
    }

    // ⑤ 老 API 兜底（writeText 被拒时的退路）。
    try {
      var area = document.createElement('textarea')
      area.value = 'canvas-studio-probe-fallback'
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      report.execCommandText = document.execCommand('copy')
      area.remove()
      note('⑤ execCommand(copy)：' + report.execCommandText)
    } catch (error) {
      report.execCommandText = 'throw: ' + String(error && error.message)
      note('⑤ execCommand(copy)：' + report.execCommandText)
    }

    publish('complete')
    note('DONE')
  }

  run().catch(function (error) {
    document.documentElement.setAttribute('data-probe-fail', '1')
    document.getElementById('probeLog').textContent = 'THROW ' + String(error && error.message)
  })
})()
</script>
</body>
</html>
`

await writeFile(outPath, html, 'utf8')
console.log(`probe written: ${outPath}`)

if (!process.argv.includes('--run')) process.exit(0)

let chrome = null
for (const candidate of CHROME_CANDIDATES) {
  try {
    await execFileAsync('test', ['-x', candidate])
    chrome = candidate
    break
  } catch { /* 试下一个 */ }
}
if (chrome === null) {
  console.log('未找到 Chrome —— 跳过实测（设置 CHROME_PATH 后重试）。')
  process.exit(0)
}

/** 同页同一个 dump —— 唯一差别是来源（file:// vs http://127.0.0.1）。 */
async function dumpDom(target) {
  const { stdout } = await execFileAsync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--virtual-time-budget=20000',
    '--dump-dom',
    target,
  ], { maxBuffer: 32 * 1024 * 1024 })
  return stdout
}

function render(stdout, label) {
  const json = stdout.match(/<pre id="probeJson">([\s\S]*?)<\/pre>/)
  const fail = stdout.match(/data-probe-fail="(\d+)"/)
  const log = stdout.match(/<pre id="probeLog">([\s\S]*?)<\/pre>/)
  const logText = log === null ? '' : log[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  console.log(`--- 页内进度（${label}）---`)
  console.log(logText === '' ? '(空)' : logText)
  console.log(`--- 探针结论（${label}）---`)
  console.log(json === null ? '(没有读到 JSON —— 页内脚本没跑完)' : json[1].replace(/&quot;/g, '"'))
  console.log('data-probe-fail =', fail === null ? 'ABSENT' : fail[1])
  // 半截结论比没有结论更危险：必须显式说出「跑到哪一步就断了」。
  if (!logText.includes('DONE')) {
    console.log('⚠️ 探针未跑到 DONE —— 上面的结论是**半截**的，不可当完整依据。')
  }
}

if (process.argv.includes('--http')) {
  // 产品真实来源是 http://127.0.0.1:<port>（不是 file://），secure context 要单独实测。
  const { createServer } = await import('node:http')
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    render(await dumpDom(`http://127.0.0.1:${port}/`), `http://127.0.0.1:${port}`)
  } finally {
    server.close()
  }
} else {
  render(await dumpDom(`file://${outPath}`), 'file://')
}
