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
import {
  RENDER_HOST_FIRST_REPORT_WARN_MS,
  lastRenderHostReport,
  renderHostCanTakeOver,
  renderHostHealth,
  resetRenderHostReport,
} from './status.js'

/** 用到的 electron 面（结构性声明，避免把 electron 变成包依赖）。 */
export interface ElectronPowerSaveBlockerLike {
  start(type: 'prevent-app-suspension' | 'prevent-display-sleep'): number
  stop(id: number): void
}

export interface ElectronWebContentsLike {
  setBackgroundThrottling?(allowed: boolean): void
  on(event: string, listener: (...args: unknown[]) => void): void
  send?(channel: string, ...args: unknown[]): void
  /** P0-5：借宿主窗口的 session（与主窗口共用同一套 cookie 存储）时读它。 */
  session?: unknown
  getURL?(): string
  executeJavaScript?(code: string): Promise<unknown>
}

export interface ElectronBrowserWindowLike {
  loadURL(url: string): Promise<void>
  destroy(): void
  isDestroyed(): boolean
  webContents: ElectronWebContentsLike
  on(event: string, listener: (...args: unknown[]) => void): void
}

export interface ElectronBrowserWindowStatics {
  new (options: Record<string, unknown>): ElectronBrowserWindowLike
  /** P0-5：枚举现有窗口 —— 借 session 的唯一入口（不需要知道分区名）。 */
  getAllWindows?(): ElectronBrowserWindowLike[]
}

export interface ElectronModuleLike {
  app?: { getVersion?(): string }
  BrowserWindow?: ElectronBrowserWindowStatics
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
  /** 「建窗后多久仍无自报就报警」的阈值（缺省 `RENDER_HOST_FIRST_REPORT_WARN_MS`）。测试注入短值。 */
  firstReportWarnMs?: number
  log?: (message: string) => void
}

export interface RenderHostHandle {
  window: ElectronBrowserWindowLike
  lifecycle: RenderHostLifecycle
  snapshot(): RenderHostSnapshot
}

let current: { handle: RenderHostHandle; powerId: number | null } | null = null

/**
 * 借宿主现有窗口的 session —— P0-5，本机 34 次 `CS-RENDER-002` 的机制性根因。
 *
 * 为什么不能用默认 session：主窗口用 `persist:dsh-desktop-renderer` 持久分区，隐藏窗口
 * 此前没传 `partition` ⇒ 落到默认内存 session。Electron 里这是**两套彼此不可见的 cookie
 * 存储**（`userData/Cookies` vs `userData/Partitions/dsh-desktop-renderer/Cookies`）。宿主的
 * 浏览器准入靠主窗口那套里的凭证判权，于是隐藏窗口的每个请求 —— **连 HTML 本身都是 403**
 * （本机实测：直连 43120 端口无论什么路径都回 `403 forbidden`）—— 页面脚本从第一行就没机
 * 会跑，自检、心跳、取单全部不发生。这就是「12 次建窗、0 次自报、0 条加载错误」的成因：
 * 403 在 `loadURL` 眼里也算「加载成功」，不产生 `did-fail-load`。
 *
 * 为什么借 session 对象而不是硬写分区名：分区名属于宿主（`dsh-plugin-desktop`），
 * canvas-studio 不能 import 它；借现有窗口的 `webContents.session` 既不需要知道名字，
 * 也不会在宿主改分区策略后失真。显式传入 `partition` 时以调用方为准。
 */
function borrowHostSession(
  electron: ElectronModuleLike,
): { session: unknown; from: string } | undefined {
  const windows = electron.BrowserWindow?.getAllWindows?.() ?? []
  for (const win of windows) {
    if (win === undefined || win === null) continue
    if (typeof win.isDestroyed === 'function' && win.isDestroyed()) continue
    const session = win.webContents?.session
    if (session === undefined || session === null) continue
    const url = typeof win.webContents?.getURL === 'function' ? win.webContents.getURL() : ''
    return { session, from: url.length > 0 ? url.slice(0, 80) : 'unknown-window' }
  }
  return undefined
}

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
  // P0-5：显式 partition 优先；否则借宿主窗口的 session（默认 session 拿不到宿主凭证）。
  const borrowed = options.partition === undefined ? borrowHostSession(resolved.electron) : undefined
  if (options.partition !== undefined) {
    log(`[canvas-studio] RenderHost 使用显式分区 ${options.partition}`)
  } else if (borrowed !== undefined) {
    log(`[canvas-studio] RenderHost 复用宿主 session（来源窗口 ${borrowed.from}）`)
  } else {
    log('[canvas-studio] RenderHost 未取到宿主 session，退回默认 session（宿主若按 cookie 判权，本窗口将一律 403）')
  }
  const win = new BrowserWindow({
    show: false,
    // 隐藏窗口不是「省电窗口」：它要满帧跑 rAF，否则渲染会挂死（O-04 Q2）。
    webPreferences: {
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      ...(options.partition === undefined ? {} : { partition: options.partition }),
      ...(borrowed === undefined ? {} : { session: borrowed.session }),
    },
  })
  // webPreferences 已声明，再喊一次是给「运行时被别的插件改回默认」兜底（Electron 43 支持运行时设置）。
  win.webContents.setBackgroundThrottling?.(false)

  let powerId: number | null = null
  const blocker = resolved.electron.powerSaveBlocker
  if (blocker !== undefined) {
    try { powerId = blocker.start('prevent-app-suspension') } catch { powerId = null }
  }

  /**
   * P0-3②：**窗口建好了却一声不响** —— 本机 34 次 `CS-RENDER-002` 的共同签名。
   *
   * 此前这条信息完全不可观测：`已创建` 日志之后就是 8s 冷启超时 + 20s 判死，
   * 中间「页面脚本有没有跑起来」只能靠 `/render-host/status` 事后查（而它本来就是空）。
   * 现在建窗后一整个冷启预算仍无自报 ⇒ 打一行 warn + 一行自查顺序。
   * 每窗只报一次（`firstReportProbe` 一次性），不重试 —— 要不要重建由派单侧决定。
   */
  let firstReportProbe: ReturnType<typeof setTimeout> | null = null

  const lifecycle = new RenderHostLifecycle({
    idleMs: options.idleMs,
    onDispose: (reason) => {
      log(`[canvas-studio] RenderHost 销毁（${reason}）`)
      if (firstReportProbe !== null) {
        clearTimeout(firstReportProbe)
        firstReportProbe = null
      }
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

  /**
   * P0-5：**页面到底加载成了什么**——把「静默白屏」变成一行证据。
   *
   * 为什么 `loadURL` 的 catch 不够：403/404/503 在 Electron 眼里都是「加载成功」，
   * 既不 reject 也不触发 `did-fail-load`。本机那道全局准入闸正是这样把页面挡在门外的：
   * 窗口建好、无异常、无自报。这里在 `did-finish-load` 之后读一次 body 文本，
   * 页面上写着 `forbidden` / `Not Found` 就会原样进日志。
   */
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (isMainFrame === false) return
    log(`[canvas-studio] RenderHost 主框架加载失败 code=${String(errorCode)} ${String(errorDescription)} url=${String(validatedUrl).slice(0, 120)}`)
  })
  win.webContents.on('did-finish-load', () => {
    const read = win.webContents.executeJavaScript
    if (read === undefined) return
    void read.call(
      win.webContents,
      "({ ready: typeof window.__csRenderHost === 'object', text: (document.body && document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 160) })",
    ).then((raw: unknown) => {
      const info = (raw ?? {}) as { ready?: unknown; text?: unknown }
      const ready = info.ready === true
      log(`[canvas-studio] RenderHost 页面已加载：__csRenderHost=${ready ? '已定义' : '未定义'} · 页面文字「${String(info.text ?? '').slice(0, 160)}」`)
    }).catch((error: unknown) => {
      log(`[canvas-studio] RenderHost 页面自检失败：${error instanceof Error ? error.message : String(error)}`)
    })
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
  const warnMs = Math.max(1, options.firstReportWarnMs ?? RENDER_HOST_FIRST_REPORT_WARN_MS)
  firstReportProbe = setTimeout(() => {
    firstReportProbe = null
    if (win.isDestroyed() || current === null) return
    const health = renderHostHealth()
    // 判据用「能不能接管」而不是「心跳是否新鲜」：报 `error` / `unsupported` 的窗口
    // 心跳新鲜但干不了活，拿 alive 当判据会把这种致命状态记成「仍在自报」。
    if (renderHostCanTakeOver()) {
      // 正面的那一行同样重要：真机验收时要能区分「窗口活着但因为忙没接单」和「窗口从来没活」。
      log(`[canvas-studio] RenderHost 建窗 ${warnMs / 1000}s 后仍在自报（state=${health.state}，最近一拍 ${Math.round(health.ageMs / 100) / 10}s 前）`)
      return
    }
    const waited = warnMs / 1000
    // 区分「一声没响」与「报了但报的是 error」：`renderHostHealth()` 在没有自报时也返回
    // `state:'error'`（哨兵值），照抄会把「从未上报」写成「上报了 error」，误导排查方向。
    const last = lastRenderHostReport()
    const why = last === undefined
      ? '从未收到任何自报'
      : `收到过自报但状态是 ${last.state}${last.detail === undefined ? '' : `（${last.detail}）`}`
    log(`[canvas-studio] ⚠ RenderHost 建窗 ${waited}s 后仍不可接管：${why} —— 页面脚本没跑起来，本单回退画布页`)
    log(`[canvas-studio] 自查顺序：① 直接打开 ${options.url} 看状态码（403 = 宿主准入闸拒了，503 = 没构建 bundle）；② 看上一行「页面已加载」里的 body 文字；③ 确认 lib/render-host.js 已由 tsdown 产出`)
  }, warnMs)
  ;(firstReportProbe as unknown as { unref?: () => void }).unref?.()
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
