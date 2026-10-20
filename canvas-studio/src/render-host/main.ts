/**
 * REQ-034 · O-05 RenderHost 页面入口（**浏览器侧，只跑在隐藏窗口里**）。
 *
 * 职责边界（S1 骨架）：
 * 1. 开机自检：WebCodecs 编码器是否可用（不可用 ⇒ 直接自报 `unsupported`，别等派单才炸）；
 * 2. 自报状态给宿主（`POST /canvas-studio/render-host/status`），宿主日志/调试可见；
 * 3. **按需**加载重依赖：`@remotion/web-renderer` + `mediabunny` 只有在真要渲染时才 import——
 *    否则一个空闲窗口白吃几十 MB 堆；S2 派单时直接复用 `loadRenderer()`。
 *
 * 明确不做（S1）：取单、渲染、回写。那些是 O-06 的事，这里只留一个稳定的挂载点。
 */

type RenderModule = typeof import('../client/remotion-render.js')

const STATUS_ENDPOINT = '/canvas-studio/render-host/status'

export type RenderHostState = 'booting' | 'idle' | 'unsupported' | 'error'

export interface RenderHostSelfCheck {
  webCodecs: boolean
  videoEncoder: boolean
  videoDecoder: boolean
  hardwareConcurrency: number
}

interface RenderHostStatusBody {
  state: RenderHostState
  detail?: string
  selfCheck?: RenderHostSelfCheck
}

const stateEl = (): HTMLElement | null => document.getElementById('state')
const detailEl = (): HTMLElement | null => document.getElementById('detail')

function paint(state: RenderHostState, detail: string): void {
  const s = stateEl()
  if (s !== null) s.textContent = state
  const d = detailEl()
  if (d !== null) d.textContent = detail
}

async function reportStatus(body: RenderHostStatusBody): Promise<void> {
  try {
    await fetch(STATUS_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    // 宿主还没起来 / 正在重启：状态上报失败不影响窗口存活，下一拍会重报。
  }
}

/** 一次性自检：真机上「编码器能用吗」决定这条执行者是否可用。 */
export function selfCheck(): RenderHostSelfCheck {
  const scope = globalThis as unknown as {
    VideoEncoder?: unknown
    VideoDecoder?: unknown
    navigator?: { hardwareConcurrency?: number }
  }
  return {
    webCodecs: typeof scope.VideoEncoder === 'function',
    videoEncoder: typeof scope.VideoEncoder === 'function',
    videoDecoder: typeof scope.VideoDecoder === 'function',
    hardwareConcurrency: scope.navigator?.hardwareConcurrency ?? 0,
  }
}

let rendererPromise: Promise<RenderModule> | undefined

/**
 * 重依赖按需加载（S2 派单时调）。
 *
 * 用函数而不是顶层 import：空闲窗口不必为「可能永远不会来的工单」付 3MB 解析 + 几十 MB 堆。
 */
export function loadRenderer(): Promise<RenderModule> {
  rendererPromise ??= import('../client/remotion-render.js')
  return rendererPromise
}

async function boot(): Promise<void> {
  paint('booting', '自检中…')
  const check = selfCheck()

  if (!check.webCodecs) {
    paint('unsupported', '本机不支持 WebCodecs，无法承担渲染')
    await reportStatus({ state: 'unsupported', detail: 'no-webcodecs', selfCheck: check })
    return
  }

  paint('idle', `就绪 · WebCodecs 可用 · 并发 ${String(check.hardwareConcurrency)}`)
  await reportStatus({ state: 'idle', selfCheck: check })
}

// 便于宿主/后续 S2 在真机上直接驱动，不必再塞一个调试入口。
;(globalThis as unknown as { __csRenderHost?: unknown }).__csRenderHost = {
  boot,
  loadRenderer,
  selfCheck,
}

void boot().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  paint('error', message)
  await reportStatus({ state: 'error', detail: message })
})
