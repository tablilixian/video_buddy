// P0-5 探针：**在真 Electron 里**证明「隐藏渲染窗口借宿主 session」这件事真的生效。
//
// 为什么非要有这个探针：`tests/render-host-window.test.mjs` 只能证明「我们往
// `webPreferences.session` 里塞了个对象」——它塞的是 fake electron，永远绿。
// 而本机 34 次 `CS-RENDER-002` 的机制性根因是 **Electron 的两套 cookie 存储彼此不可见**：
// 主窗口在 `persist:dsh-desktop-renderer`，隐藏窗口落默认 session，于是宿主的浏览器
// 准入闸对隐藏窗口的**每一个请求（连 HTML 本身）都回 403**；`loadURL` 把 403 当加载成功，
// 页面白屏、脚本不执行、自报 0 次，28s 后判死。这条链只有在真 Electron 里跑才会露出来。
//
// 探针做的是 A/B 对照（同一个假宿主、同一个 URL，只差 session）：
//   A 组（负对照）：默认 session 开窗 → 宿主回 403 `forbidden`
//   B 组（修复后）：宿主窗口先种 cookie，再 ensureRenderHost() → 复用宿主 session → 200
//   C：断言 B 的窗口 session **就是**宿主窗口那个对象（不是同分区名，是同一个）
//
// 运行（Electron main 里跑，不是 node）：
//   env -u ELECTRON_RUN_AS_NODE ELECTRON_DISABLE_SANDBOX=1 \
//     ../dsh-plugin-desktop/node_modules/.bin/electron scripts/probe/render-host-session.probe.mjs
//
// 退出码：任一断言失败 / A 组没被 403 ⇒ 1。

import { app, BrowserWindow } from 'electron'
import { createServer } from 'node:http'
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const stepLog = '/tmp/cs-session-probe-steps.log'
const step = (tag, extra) => {
  try {
    appendFileSync(stepLog, `${new Date().toISOString()} ${tag}${extra === undefined ? '' : ' ' + JSON.stringify(extra)}\n`)
  } catch { /* 日志失败不影响判定 */ }
}
step('boot', { electron: process.versions.electron, type: process.type ?? null })

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')
const outDir = '/tmp/cs-session-probe'
// 隔离 userData：分区 cookie 写在 userData/Partitions 下，绝不能碰真机 App 的数据。
const userDataDir = join(outDir, 'userData')
try { rmSync(userDataDir, { recursive: true, force: true }) } catch { /* 首次不存在 */ }
mkdirSync(userDataDir, { recursive: true })
app.setPath('userData', userDataDir)

// 探针自己决定何时退出：Electron 缺省在「最后一个窗口关闭」时直接 quit，
// 而本探针要先关掉负对照窗口再开宿主窗口 —— 不接这个事件，进程会在 A:done 处静默退出。
app.on('window-all-closed', () => {})

const COOKIE_NAME = 'cs_probe_credential'

/** 假宿主：准入闸按 cookie 判权 —— 与真宿主 `mutationAllowed` 同构（缺凭证一律 403）。 */
function startFakeHost() {
  const state = { statusReports: [], rejected: 0, served: 0 }
  const server = createServer((req, res) => {
    const cookie = req.headers.cookie ?? ''
    const authorized = cookie.includes(`${COOKIE_NAME}=ok`)
    if (!authorized) {
      state.rejected += 1
      res.writeHead(403, { 'content-type': 'text/html; charset=utf-8' })
      res.end('forbidden')
      return
    }
    if (req.method === 'POST' && req.url.startsWith('/canvas-studio/render-host/status')) {
      state.statusReports.push({ at: Date.now(), origin: req.headers.origin ?? null })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
      return
    }
    state.served += 1
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><html><body><div id="who">render-host-ok</div>'
      + '<script>window.__csRenderHost={probe:true};</script></body></html>')
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, state, port, base: `http://127.0.0.1:${port}` })
    })
  })
}

/** 读 page 正文（不做业务逻辑，只当「页面到底加载成了什么」的证物）。 */
function readBody(win) {
  return win.webContents.executeJavaScript(
    "({ text: (document.body && document.body.innerText || '').replace(/\\s+/g, ' ').trim(), cookie: document.cookie })",
  )
}

async function main() {
  step('whenReady:done')
  const checks = {}
  let failures = 0
  const check = (name, ok, detail) => {
    checks[name] = { ok, detail }
    if (!ok) failures += 1
    console.log(`${ok ? '✅' : '❌'} ${name}${detail === undefined ? '' : ' · ' + JSON.stringify(detail)}`)
  }

  const host = await startFakeHost()
  step('host:listening', { port: host.port })
  const url = `${host.base}/canvas-studio/render-host`

  // ── A 组：负对照 —— 默认 session 开窗，宿主按缺凭证拒掉 ──
  const plain = new BrowserWindow({ show: false })
  await plain.loadURL(url)
  const plainBody = await readBody(plain)
  check(
    'A-negative-control',
    plainBody.text === 'forbidden' && host.state.rejected >= 1,
    { text: plainBody.text.slice(0, 60), rejected: host.state.rejected },
  )
  const plainSession = plain.webContents.session
  plain.destroy()
  step('A:done')

  // ── 宿主窗口：它才是凭证的持有者（真机对应主窗口 persist:dsh-desktop-renderer）──
  const hostWin = new BrowserWindow({ show: false, webPreferences: { partition: 'persist:probe-host' } })
  // 不 loadURL：session 在窗口创建时就已经定下，探针要的是它，不是页面。
  const hostSession = hostWin.webContents.session
  await hostSession.cookies.set({ url: host.base, name: COOKIE_NAME, value: 'ok', httpOnly: false })
  const seeded = await hostSession.cookies.get({ url: host.base })
  check('B0-host-session-seeded', seeded.some((c) => c.name === COOKIE_NAME), { count: seeded.length })
  step('B0:done')

  // ── B 组：ensureRenderHost 不传 partition ⇒ 应借宿主 session ──
  const logs = []
  const windowModule = await import(pathToFileURL(join(repoRoot, 'lib', 'render-host', 'window.js')).href
    + '?t=' + Date.now())
  const handle = windowModule.ensureRenderHost({ url, log: (m) => { logs.push(m); console.log('   log:', m) } })
  check('B1-handle-created', handle !== undefined)
  if (handle === undefined) {
    console.log('   ⇒ 取不到 electron，探针无法继续')
  } else {
    const loaded = new Promise((resolve) => {
      handle.window.webContents.on('did-finish-load', () => { resolve(true) })
      setTimeout(() => { resolve(false) }, 15_000)
    })
    const fin = await loaded
    const body = await readBody(handle.window)
    step('B2:loaded', { fin, text: body.text.slice(0, 60) })
    check('B2-page-authorized', body.text.includes('render-host-ok'), { text: body.text.slice(0, 60) })
    check('B3-cookie-visible-to-page', String(body.cookie).includes(`${COOKIE_NAME}=ok`), { cookie: String(body.cookie).slice(0, 80) })
    // C：不是「同名分区」，是**同一个 session 对象**
    const same = handle.window.webContents.session === hostSession
    check('C-same-session-object', same, { same })
    check('B4-log-says-borrowed', logs.some((m) => m.includes('复用宿主 session')), { logs: logs.length })
    windowModule.disposeRenderHost('probe-done')
  }

  hostWin.destroy()
  host.server.close()

  const report = { env: { electron: process.versions.electron, chrome: process.versions.chrome }, checks, host: host.state }
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
  console.log(`\n== P0-5 探针：${failures === 0 ? '通过' : `${failures} 条失败`} ==`)
  console.log('report →', join(outDir, 'report.json'))
  step('done', { failures })
  app.exit(failures === 0 ? 0 : 1)
}

app.whenReady().then(main).catch((error) => {
  step('fatal', { message: String(error?.message ?? error).slice(0, 300) })
  console.error(error)
  app.exit(1)
})
