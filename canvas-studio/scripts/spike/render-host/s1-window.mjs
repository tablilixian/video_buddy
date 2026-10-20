/**
 * REQ-034 · O-05 S1 验收探针：隐藏窗口能不能真的把页面跑起来并自报 idle。
 *
 * 与 O-04 的 `main.mjs` 分开：那条验的是「渲染能力」，这条验的是「窗口 + 路由 + 自报」这条
 * 产品链路 —— 起一个最小同源服务（页面 / bundle / 状态三条路由），再用 `lib/render-host/window.js`
 * 真正建窗口，等页面把 `idle` 报回来。
 *
 * 跑法（仓库根）：
 *   node canvas-studio/scripts/spike/render-host/tsdown.config.ts 构建略
 *   先 `npx tsdown && npx tsc -p tsconfig.json`（产出 lib/render-host.js 与 lib/render-host/window.js）
 *   env -u ELECTRON_RUN_AS_NODE ELECTRON_DISABLE_SANDBOX=1 \
 *     dsh-plugin-desktop/node_modules/electron/cli.js \
 *     canvas-studio/scripts/spike/render-host/s1-window.mjs
 *
 * 退出码：窗口没起 / 30s 内没收到 idle / WebCodecs 不可用 ⇒ 1。
 * 报告：/tmp/cs-s1-host/report.json
 */
import { app } from 'electron'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..', '..')
const outDir = '/tmp/cs-s1-host'
const report = { steps: [], status: [], ok: false }

const step = (tag, extra) => report.steps.push(extra === undefined ? tag : { tag, extra })

async function main() {
  const { renderHostHtml } = await import(pathToFileURL(join(root, 'lib', 'render-host', 'page.js')).href)
  const { ensureRenderHost, disposeRenderHost, renderHostSnapshot } = await import(
    pathToFileURL(join(root, 'lib', 'render-host', 'window.js')).href
  )
  const bundle = readFileSync(join(root, 'lib', 'render-host.js'))

  let resolveStatus
  const statusSeen = new Promise((resolve) => { resolveStatus = resolve })

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/canvas-studio/render-host') {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end(renderHostHtml())
      return
    }
    if (url.pathname === '/canvas-studio/render-host.js') {
      res.setHeader('content-type', 'text/javascript; charset=utf-8')
      res.end(bundle)
      return
    }
    if (url.pathname === '/canvas-studio/render-host/status' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        let parsed = {}
        try { parsed = JSON.parse(body) } catch { /* 忽略脏包 */ }
        report.status.push(parsed)
        step('status:post', parsed.state)
        res.setHeader('content-type', 'application/json')
        res.end('{"ok":true}')
        resolveStatus(parsed)
      })
      return
    }
    res.statusCode = 404
    res.end('not found')
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  step('server:listening', { port })

  const handle = ensureRenderHost({
    url: `http://127.0.0.1:${String(port)}/canvas-studio/render-host`,
    idleMs: 0,
    log: (message) => step('host:log', message),
  })
  if (handle === undefined) {
    step('host:missing')
    report.ok = false
  } else {
    // 隐藏窗口里 console/加载失败默认看不见 —— 验收探针必须把它们抓出来，
    // 否则「页面没跑起来」只能看到一句 timeout。
    const wc = handle.window.webContents
    wc.on('console-message', (_event, level, message) => step('console', { level, message: String(message).slice(0, 300) }))
    wc.on('did-fail-load', (_event, code, description, url) => step('did-fail-load', { code, description, url }))
    wc.on('did-finish-load', () => step('did-finish-load'))
    wc.on('render-process-gone', (_event, details) => step('render-process-gone', details))
    handle.lifecycle.setBusy(true)
    const timeout = new Promise((resolve) => setTimeout(() => resolve({ state: 'timeout' }), 30_000))
    const first = await Promise.race([statusSeen, timeout])
    step('first-status', first)
    // 直接问页面：DOM 里显示的是什么、全局挂载点有没有出现。
    try {
      report.dom = await wc.executeJavaScript(
        '({ state: document.getElementById("state")?.textContent, detail: document.getElementById("detail")?.textContent,'
        + ' hook: typeof globalThis.__csRenderHost, ready: document.readyState, url: location.href })',
      )
      step('dom', report.dom)
    } catch (error) {
      step('dom:error', String(error?.message ?? error).slice(0, 200))
    }
    report.snapshot = handle.snapshot()
    report.ok = first?.state === 'idle' && first?.selfCheck?.webCodecs === true
    disposeRenderHost('probe-done')
    handle.lifecycle.setBusy(false)
  }

  await new Promise((resolve) => server.close(resolve))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8')

  console.log('=== O-05 S1：隐藏窗口自报 ===')
  for (const s of report.steps) console.log(JSON.stringify(s))
  console.log('snapshot:', JSON.stringify(report.snapshot))
  console.log(report.ok ? 'PASS' : 'FAIL', '→', join(outDir, 'report.json'))
  app.exit(report.ok ? 0 : 1)
}

app.whenReady().then(main).catch((error) => {
  console.error(error)
  app.exit(1)
})
