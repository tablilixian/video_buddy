/**
 * 渲染取证台 · Electron 外壳
 *
 * 一个开关决定四档窗口环境，其余一切相同 —— 这样"窗口可见性/背景节流是否影响渲染"
 * 才是可归因的（会话里这件事全靠猜）。
 *
 * RF_WINDOW:
 *   hidden            隐藏窗口 + backgroundThrottling:false + 两条关节流 switch
 *                     （= 产品 src/render-host/window.ts 的现状，应有尽有）
 *   hidden-throttled  隐藏窗口 + 保留 Electron 默认节流（对照组）
 *   visible           可见窗口 + 关节流
 *   occluded          可见窗口，但被一个置顶透明窗口盖住（模拟"用户切到别的应用"）
 */
const { app, BrowserWindow } = require('electron')

const url = process.env.RF_URL
const mode = process.env.RF_WINDOW || 'hidden'
if (!url) {
  console.error('[rf-electron] 缺少 RF_URL')
  app.exit(2)
}

const throttled = mode === 'hidden-throttled'

if (!throttled) {
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-background-timer-throttling')
}
if (process.env.RF_NO_SANDBOX === '1') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}
if (process.env.RF_SW_GPU === '1') {
  app.commandLine.appendSwitch('disable-gpu')
}

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: mode === 'visible' || mode === 'occluded',
    title: `RF ${mode}`,
    webPreferences: {
      backgroundThrottling: !throttled,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  if (typeof win.webContents.setBackgroundThrottling === 'function') {
    win.webContents.setBackgroundThrottling(!throttled)
  }

  if (mode === 'occluded') {
    const cover = new BrowserWindow({ width: 1400, height: 900, show: true, alwaysOnTop: true, frame: false, transparent: true })
    cover.setIgnoreMouseEvents(true)
    cover.loadURL('data:text/html,<body style="background:rgba(0,0,0,0.01)"></body>')
  }

  win.webContents.on('console-message', (...args) => {
    const details = args[1]
    const message = details && typeof details === 'object' ? details.message : args[2]
    if (typeof message === 'string' && message.startsWith('[rf]')) console.log(message)
  })
  win.webContents.on('render-process-gone', (_e, d) => console.log('[rf-electron] render-process-gone ' + JSON.stringify(d)))
  win.webContents.on('did-fail-load', (_e, code, desc) => console.log(`[rf-electron] did-fail-load ${code} ${desc}`))

  console.log(`[rf-electron] mode=${mode} electron=${process.versions.electron} chrome=${process.versions.chrome}`)
  win.loadURL(url)
})

app.on('window-all-closed', () => {
  // 由 Node 侧收尾，这里不主动退出（否则最后一份报告可能来不及回写）
})
