/**
 * 能力基准 · Electron 渲染进程外壳。
 *
 * 只做三件事：开窗、加载 BENCH_URL、把页面 console 转发到终端（白屏排查全靠它）。
 * 开关经环境变量传入：BENCH_WINDOW=visible|hidden、BENCH_FLAGS=逗号分隔的 Chromium feature。
 */

const { app, BrowserWindow } = require('electron')

const url = process.env.BENCH_URL
if (!url) {
  console.error('[bench] 缺少 BENCH_URL')
  app.exit(2)
}

// 沙箱里 Chromium 的 sandbox 初始化会失败（GPU 进程 exit_code=6）⇒ 需要时整体关掉。
if (process.env.CSR_NO_SANDBOX === '1') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}

// 渲染在渲染进程里跑：关掉节流，避免失焦/后台被拖慢。
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

// 能力开关（例：CanvasDrawElement ⇒ 打通 drawElementImage 四件套，见文档 §10.2）
const flags = (process.env.BENCH_FLAGS || '').split(',').map((s) => s.trim()).filter(Boolean)
if (flags.length > 0) app.commandLine.appendSwitch('enable-features', flags.join(','))

const hidden = process.env.BENCH_WINDOW === 'hidden'

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: !hidden,
    webPreferences: {
      backgroundThrottling: false,
      // 素材来自 127.0.0.1 同源；不涉及远程内容。
      webSecurity: true,
    },
  })

  win.webContents.on('console-message', (...args) => {
    const details = args[1]
    const message = details && typeof details === 'object' ? details.message : args[2]
    console.log('[page]', String(message))
  })
  win.webContents.on('render-process-gone', (_event, info) => {
    console.log('[bench] {"step":"gone","detail":' + JSON.stringify(info) + '}')
  })
  win.webContents.on('did-fail-load', (_event, code, description, failedUrl) => {
    console.log('[bench] {"step":"load-failed","code":' + code + ',"detail":"' + description + '","url":"' + failedUrl + '"}')
  })

  win.loadURL(url).catch((error) => {
    console.log('[bench] {"step":"load-error","detail":"' + String(error && error.message) + '"}')
  })
})

app.on('window-all-closed', () => app.quit())
