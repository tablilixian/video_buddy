/**
 * 能力探针 · Electron 外壳（capability-bench/env）
 *
 * 只做三件事：
 *   1. 按 PROBE_WINDOW / PROBE_THROTTLE 建窗口，打开 PROBE_URL（必须是 http://127.0.0.1，
 *      WebCodecs / WebGPU 都要求 secure context，about:blank 与 data: 不算）；
 *   2. 注入 page.js 并调用 __probe()，把结果与 Electron 侧的 GPU 自报一起打成一行
 *      `__PROBE_JSON__<json>` 输出到 stdout（driver 用行匹配取）；
 *   3. 报完即 app.exit(0)，不做任何渲染。
 *
 * 窗口档位（对应 §5.4 的四档，这里只用前两档做环境判定）：
 *   PROBE_WINDOW=hidden|visible     默认 hidden（= RenderHost 隐藏窗口的真实形态）
 *   PROBE_THROTTLE=1                默认 0；=1 时开 backgroundThrottling（旧配置，会退化）
 *
 * run.js 会 `child.kill()` 自己 spawn 的这个进程；**不要手动 kill 任何 Electron**。
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const url = process.env.PROBE_URL
const mode = process.env.PROBE_WINDOW === 'visible' ? 'visible' : 'hidden'
const throttling = process.env.PROBE_THROTTLE === '1'

if (!url) {
  console.error('[env] 缺少 PROBE_URL')
  app.exit(2)
}

if (process.env.CSR_NO_SANDBOX === '1') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}

// 试探性开关（Q13 用）：PROBE_FEATURES=CanvasDrawElement；PROBE_SWITCH=enable-canvas-draw-element
const features = (process.env.PROBE_FEATURES || '').split(',').map((s) => s.trim()).filter(Boolean)
if (features.length > 0) app.commandLine.appendSwitch('enable-features', features.join(','))
const extraSwitches = (process.env.PROBE_SWITCH || '').split(',').map((s) => s.trim()).filter(Boolean)
for (const name of extraSwitches) app.commandLine.appendSwitch(name)

// 与 RenderHost 一致：关后台降频（探针要测的正是"有没有被降频"）。
if (!throttling) {
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-background-timer-throttling')
}

const emit = (payload) => {
  console.log('__PROBE_JSON__' + JSON.stringify(payload))
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    show: mode === 'visible',
    webPreferences: {
      backgroundThrottling: throttling,
      offscreen: false,
    },
  })

  win.webContents.on('console-message', (...args) => {
    const details = args[1]
    const message = details && typeof details === 'object' ? details.message : args[2]
    console.log('[page] ' + String(message))
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.log('[page] render-process-gone ' + JSON.stringify(details))
  })

  let pageResult = null
  let pageError = null
  try {
    await win.loadURL(url)
    const src = readFileSync(join(__dirname, 'page.js'), 'utf8')
    await win.webContents.executeJavaScript(src)
    pageResult = await win.webContents.executeJavaScript('__probe()')
  } catch (error) {
    pageError = error && error.message ? error.message : String(error)
  }

  let featureStatus = null
  let gpuInfo = null
  try {
    featureStatus = app.getGPUFeatureStatus()
    gpuInfo = await app.getGPUInfo('basic')
  } catch (error) {
    gpuInfo = { error: error && error.message ? error.message : String(error) }
  }

  emit({
    mode,
    throttling,
    visible: win.isVisible(),
    app: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      v8: process.versions.v8,
      platform: process.platform + ' ' + process.arch,
      argv: process.argv.filter((a) => a.startsWith('--')),
    },
    gpuFeatureStatus: featureStatus,
    gpuInfo,
    page: pageResult,
    pageError,
  })

  setTimeout(() => app.exit(0), 120)
})

app.on('window-all-closed', () => app.exit(0))
