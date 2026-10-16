/**
 * REQ-034 · S10 验证器：Electron 外壳。
 *
 * 只做两件事：
 *   1. 打开 `S10_URL`（本地静态服务托管的 Remotion bundle 页面）——该页面在渲染进程里
 *      跑 `renderMediaOnWeb`（CSR / route B）。
 *   2. **把渲染进程的 console / 异常转发到终端** —— 白屏排查全靠它（spike 血泪）。
 *
 * ⚠️ Electron 把「目录」当 app 启动时必须有本目录的 `package.json`（含 `main`），
 *    只放 main.js 会静默起不来（spike 踩过）。
 * ⚠️ 沙箱/无 GPU 环境用 `CSR_NO_SANDBOX=1` 追加 `--no-sandbox`（正常终端不需要）。
 */

const { app, BrowserWindow } = require('electron')

if (process.env.CSR_NO_SANDBOX === '1') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}

const url = process.env.S10_URL
if (!url) {
  console.error('[electron] 缺少 S10_URL 环境变量')
  app.exit(2)
}

// 关掉后台节流，避免窗口失焦时渲染被拖慢（route B 在渲染进程里跑，前台更稳）。
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1024,
    height: 700,
    show: true,
    webPreferences: { backgroundThrottling: false },
  })

  // Electron 不同版本 console-message 签名不同：新签名 (event, details)，旧签名 (event, level, message)。
  win.webContents.on('console-message', (...args) => {
    const details = args[1]
    const message = details && typeof details === 'object' ? details.message : args[2]
    console.log('[page]', String(message))
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    console.log('[page] render-process-gone', JSON.stringify(details))
  })
  win.webContents.on('did-fail-load', (_event, code, description, validatedURL) => {
    console.log('[page] did-fail-load', code, description, validatedURL)
  })

  win.loadURL(url).catch((error) => {
    console.log('[page] loadURL error', error && error.message)
  })
})

app.on('window-all-closed', () => app.quit())
