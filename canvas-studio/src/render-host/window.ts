/**
 * REQ-034 · O-05 RenderHost 窗口（**唯一与 electron 交互的点**）。
 *
 * 三条硬约束（方案 §4.1 / §5.1）：
 * 1. **三级退化取 electron**：`createRequire(import.meta.url)` → `process.mainModule.require`
 *    → 注入的 fallback（`ctx.desktopRuntime` 之类）。真机 R1 探针已证前两级都通
 *    （`scripts/probe/electron-resolve.probe.mjs`，Electron 43.4.0 + dsh profile resolver），
 *    但保留退化链是为了「换 Electron 版本/换宿主」时不至于整条渲染线消失。
 * 2. **窗口必须 `show:false` + `backgroundThrottling:false`**：O-04 Q2 实测，最小化的可见窗口
 *    rAF 掉到 3/s（等于停摆），隐藏窗口 + 关节流是 59/s。
 * 3. **绝不在模块顶层 `await app.whenReady()`**：ESM 入口的顶层 await 会阻塞模块求值，
 *    而 Electron 要等入口求值完才 emit ready ⇒ 互相等死（本机实测卡死，探针里踩过）。
 *    宿主进程本身早已 ready，这里只做能力探测，不等待。
 */
import { createRequire } from 'node:module'
import { RenderHostLifecycle, type RenderHostSnapshot } from './lifecycle.js'
import { resetRenderHostReport } from './status.js'

/** 用到的 electron 面（结构性声明，避免把 electron 变成包依赖）。 */
export interface ElectronPowerSaveBlockerLike {
  start(type: 'prevent-app-suspension' | 'prevent-display-sleep'): number
  stop(id: number): void
}

export interface ElectronWebContentsLike {
  setBackgroundThrottling?(allowed: boolean): void
  on(event: string, listener: (...args: unknown[]) => void): void
  send?(channel: string, ...args: unknown[]): void
}

export interface ElectronBrowserWindowLike {
  loadURL(url: string): Promise<void>
  destroy(): void
  isDestroyed(): boolean
  webContents: ElectronWebContentsLike
  on(event: string, listener: (...args: unknown[]) => void): void
}

export interface ElectronModuleLike {
  app?: { getVersion?(): string }
  BrowserWindow?: new (options: Record<string, unknown>) => ElectronBrowserWindowLike
  powerSaveBlocker?: ElectronPowerSaveBlockerLike
}

export interface ResolvedElectron {
  electron: ElectronModuleLike
  /** 哪一级取到的 —— 写进日志，真机上据此判断退化链是否还健康。 */
  via: 'createRequire' | 'mainModule' | 'fallback'
  version?: string | undefined
}

/** 取 electron 的三种方式按优先级排列；导出是为了能在探针/测试里逐个驱动。 */
export function resolveElectron(fallback?: ElectronModuleLike): ResolvedElectron | undefined {
  try {
    const req = createRequire(import.meta.url)
    const mod = req('electron') as ElectronModuleLike | undefined
    if (mod !== undefined && mod !== null) {
      return { electron: mod, via: 'createRequire', version: mod.app?.getVersion?.() }
    }
  } catch { /* 继续退化 */ }

  try {
    const main = (process as unknown as { mainModule?: { require(id: string): unknown } }).mainModule
    if (main !== undefined) {
      const mod = main.require('electron') as ElectronModuleLike | undefined
      if (mod !== undefined && mod !== null) {
        return { electron: mod, via: 'mainModule', version: mod.app?.getVersion?.() }
      }
    }
  } catch { /* 继续退化 */ }

  if (fallback !== undefined) return { electron: fallback, via: 'fallback' }
  return undefined
}

export interface EnsureRenderHostOptions {
  /** 由路由给出的同源地址：`http://127.0.0.1:<port>/canvas-studio/render-host`。 */
  url: string
  /** 与主窗口同分区，避免二次登录/二次资产缓存。 */
  partition?: string
  idleMs?: number | undefined
  /**
   * O-06：窗口「没了」的回调（renderer 崩溃 / 无响应 / 被关 / 加载失败）。
   *
   * 为什么要在主进程侧接这个信号，而不是只靠页面的 1s 心跳：渲染期的页面主线程
   * 可能被编码器按住（`pageResponsiveness: 'disabled'`），心跳会抖；而 renderer
   * 崩溃是**主进程立刻就知道**的事实，没必要等 30s 看门狗。
   */
  onLost?: (reason: string) => void
  /** 注入 electron（测试）；缺省走 `resolveElectron()`。 */
  electron?: ElectronModuleLike
  log?: (message: string) => void
}

export interface RenderHostHandle {
  window: ElectronBrowserWindowLike
  lifecycle: RenderHostLifecycle
  snapshot(): RenderHostSnapshot
}

let current: { handle: RenderHostHandle; powerId: number | null } | null = null

/**
 * 保证隐藏渲染窗口存在（幂等）。
 * @returns 窗口句柄；取不到 electron（例如纯 CLI 宿主）时返回 undefined —— 调用方应回退到
 *          现有客户端轮询（方案 O-06「保底」）。
 */
export function ensureRenderHost(options: EnsureRenderHostOptions): RenderHostHandle | undefined {
  if (current !== null) {
    current.handle.lifecycle.acquire()
    return current.handle
  }

  const resolved = options.electron !== undefined
    ? { electron: options.electron, via: 'fallback' as const, version: options.electron.app?.getVersion?.() }
    : resolveElectron()
  const log = options.log ?? (() => {})
  /** O-06：窗口失联只通知一次 —— 崩溃与 close 往往前后脚到，重复通知会打两遍日志。 */
  let lostReported = false
  const notifyLost = (reason: string): void => {
    if (lostReported) return
    lostReported = true
    try { options.onLost?.(reason) } catch { /* 回调异常不能拖住窗口回收 */ }
  }

  if (resolved === undefined || resolved.electron.BrowserWindow === undefined) {
    log('[canvas-studio] RenderHost 不可用：取不到 electron，回退客户端渲染')
    return undefined
  }
  // 真机自证：日志里带出版本与取用路径，R1 的结论不必再靠外部探针复读。
  if (process.env.CANVAS_STUDIO_ELECTRON_PROBE === '1') {
    log(`[canvas-studio] RenderHost electron=${resolved.version ?? 'unknown'} via=${resolved.via}`)
  }

  const BrowserWindow = resolved.electron.BrowserWindow
  const win = new BrowserWindow({
    show: false,
    // 隐藏窗口不是「省电窗口」：它要满帧跑 rAF，否则渲染会挂死（O-04 Q2）。
    webPreferences: {
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      ...(options.partition === undefined ? {} : { partition: options.partition }),
    },
  })
  // webPreferences 已声明，再喊一次是给「运行时被别的插件改回默认」兜底（Electron 43 支持运行时设置）。
  win.webContents.setBackgroundThrottling?.(false)

  let powerId: number | null = null
  const blocker = resolved.electron.powerSaveBlocker
  if (blocker !== undefined) {
    try { powerId = blocker.start('prevent-app-suspension') } catch { powerId = null }
  }

  const lifecycle = new RenderHostLifecycle({
    idleMs: options.idleMs,
    onDispose: (reason) => {
      log(`[canvas-studio] RenderHost 销毁（${reason}）`)
      // 窗口没了 ⇒ 上一份自报立即作废，否则 30s 内 `renderHostReady()` 会把新单派给空气。
      resetRenderHostReport()
      notifyLost(reason)
      if (!win.isDestroyed()) win.destroy()
      if (powerId !== null && blocker !== undefined) {
        try { blocker.stop(powerId) } catch { /* 进程正在退出时忽略 */ }
      }
      current = null
    },
  })

  win.on('closed', () => {
    // 用户/系统把窗口关了：状态机必须同步复位，否则下次 acquire 会以为窗口还在。
    notifyLost('window-closed')
    if (current !== null) current.handle.lifecycle.dispose('window-closed')
  })

  // O-06 心跳的两条旁路（主进程侧，不依赖页面定时器）。
  win.webContents.on('render-process-gone', (_event, details) => {
    log(`[canvas-studio] RenderHost renderer 退出：${JSON.stringify(details)}`)
    notifyLost('renderer-gone')
  })
  win.webContents.on('unresponsive', () => {
    log('[canvas-studio] RenderHost 无响应')
    notifyLost('unresponsive')
  })

  void win.loadURL(options.url).catch((error: unknown) => {
    log(`[canvas-studio] RenderHost 加载失败：${error instanceof Error ? error.message : String(error)}`)
    notifyLost('load-failed')
    lifecycle.dispose('load-failed')
  })

  const handle: RenderHostHandle = {
    window: win,
    lifecycle,
    snapshot: () => lifecycle.snapshot(),
  }
  current = { handle, powerId }
  lifecycle.acquire()
  log('[canvas-studio] RenderHost 已创建（隐藏窗口，背景节流关闭）')
  return handle
}

/** 主动销毁（插件卸载 / App 退出）。幂等。 */
export function disposeRenderHost(reason = 'manual'): void {
  current?.handle.lifecycle.dispose(reason)
}

/**
 * 渲染窗口每来一次请求就调一次（自报状态、心跳、取单都算）。
 *
 * 单独导出而不是让路由自己拿 handle：路由不该知道「有没有窗口」——
 * 没有窗口时这是空操作，调用方不必分支。
 */
export function touchRenderHost(): void {
  current?.handle.lifecycle.touch()
}

/** 是否有活着的渲染窗口（路由与工具用它决定走哪条执行者）。 */
export function renderHostSnapshot(): RenderHostSnapshot | undefined {
  return current?.handle.snapshot()
}
