import {
  RENDERER_BOOT_REPORT_PATH,
  type RendererBootReport,
} from '../renderer-boot-contract.ts'

export { RENDERER_BOOT_REPORT_PATH } from '../renderer-boot-contract.ts'
export type { RendererBootReport } from '../renderer-boot-contract.ts'

/** Browser Loader state needed to decide whether one desktop generation is healthy. */
export interface RendererBootLoader {
  await(): Promise<void>
  entries(): Iterable<{
    options: { name: string }
    fiber?: { state: number }
  }>
}

const ACTIVE_FIBER_STATE = 2

/**
 * 上限：等 Loader settle 的最长时间。
 *
 * Loader 的 `await()` 只会在**全部** entry 都落定后 resolve；只要有一个插件的
 * fiber 因为 inject 永远凑不齐而停在 INACTIVE，它就永不 resolve。此前这条路径
 * 完全没有超时 ⇒ 本函数永不返回 ⇒ `startRendererBootReporter` 从不 POST ⇒
 * 主进程只能按 30s 超时合成一个 `plugins: []` 的报告，恢复窗口上只显示
 * 「Unknown client plugin」，完全看不出是哪个插件卡住（2026-10-21 实测）。
 *
 * 这里给一个**小于宿主 30s 门限**的上限：超时后照样发报告，`plugins` 由各
 * entry 的 fiber 状态推出来 —— 卡住的那几个会被点名，判定仍然是 failed（健康门
 * 不变严格，只是错误信息变得可诊断）。
 */
const LOADER_SETTLE_CAP_MS = 20_000

/** 等 Loader settle，返回失败原因；返回 `undefined` 表示全部落定。 */
async function settleLoader(loader: RendererBootLoader): Promise<string | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<'deadline'>(resolve => {
    timer = setTimeout(() => { resolve('deadline') }, LOADER_SETTLE_CAP_MS)
  })
  try {
    const outcome = await Promise.race([
      loader.await().then(() => 'settled' as const),
      deadline,
    ])
    return outcome === 'deadline'
      ? `The client Loader did not settle within ${String(LOADER_SETTLE_CAP_MS)}ms; the plugins below never reached the active state.`
      : undefined
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Wait for client Loader settlement and summarize entries that did not activate. */
export async function rendererBootReport(loader: RendererBootLoader): Promise<RendererBootReport> {
  const error = await settleLoader(loader)
  const plugins = [...loader.entries()]
    .filter(entry => entry.fiber?.state !== ACTIVE_FIBER_STATE)
    .map(entry => entry.options.name)
  return error === undefined && plugins.length === 0
    ? { status: 'healthy' }
    : { status: 'failed', plugins, ...(error === undefined ? {} : { error }) }
}

/** Send the settled client Loader outcome to the same-origin desktop Host. */
export async function sendRendererBootReport(
  loader: RendererBootLoader,
  request: typeof globalThis.fetch = globalThis.fetch,
): Promise<RendererBootReport> {
  const report = await rendererBootReport(loader)
  await postRendererBootReport(report, request)
  return report
}

async function postRendererBootReport(
  report: RendererBootReport,
  request: typeof globalThis.fetch,
): Promise<void> {
  const response = await request(RENDERER_BOOT_REPORT_PATH, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report),
  })
  if (!response.ok) {
    throw new Error(`dsh-plugin-desktop: renderer boot report failed with HTTP ${String(response.status)}`)
  }
}

/** Defer health reporting until the current client plugin activation has completed. */
export function startRendererBootReporter(
  loader: RendererBootLoader,
  request: typeof globalThis.fetch = globalThis.fetch,
): () => void {
  let active = true
  const timer = setTimeout(() => {
    void rendererBootReport(loader)
      .then(async (report) => {
        if (active) await postRendererBootReport(report, request)
      })
      .catch((cause: unknown) => {
        console.error('dsh-plugin-desktop: failed to report renderer boot health', cause)
      })
  }, 0)
  return () => {
    active = false
    clearTimeout(timer)
  }
}
