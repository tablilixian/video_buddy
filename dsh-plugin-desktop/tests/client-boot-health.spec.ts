import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RENDERER_BOOT_REPORT_PATH,
  rendererBootReport,
  sendRendererBootReport,
  startRendererBootReporter,
} from '../src/client/boot-health.ts'

afterEach(() => { vi.useRealTimers() })

describe('desktop renderer boot health', () => {
  it('reports the plugin whose Loader fiber failed', async () => {
    const awaitLoader = vi.fn(async () => {})
    const loader = {
      await: awaitLoader,
      * entries() {
        yield { options: { name: 'dsh-plugin-desktop' }, fiber: { state: 2 } }
        yield { options: { name: 'dsh-vision-router' }, fiber: { state: 3 } }
      },
    }

    await expect(rendererBootReport(loader)).resolves.toEqual({
      status: 'failed',
      plugins: ['dsh-vision-router'],
    })
    expect(awaitLoader).toHaveBeenCalledOnce()
  })

  it('preserves the Loader apply error that caused renderer boot to reject', async () => {
    const error = new Error(
      'failed to apply loader entry d455f565 (dsh-vision-router): '
      + 'keyed slot "tool.call.toolview" already has an entry for key "vision_crop" at priority 0',
    )
    const loader = {
      await: vi.fn(async () => { throw error }),
      * entries() {
        yield { options: { name: 'dsh-plugin-desktop' }, fiber: { state: 2 } }
        yield { options: { name: 'dsh-vision-router' }, fiber: { state: 3 } }
      },
    }

    await expect(rendererBootReport(loader)).resolves.toEqual({
      status: 'failed',
      plugins: ['dsh-vision-router'],
      error: error.message,
    })
  })

  it('posts the terminal boot report to the same-origin desktop Host', async () => {
    const loader = {
      await: vi.fn(async () => {}),
      * entries() {
        yield { options: { name: 'dsh-plugin-desktop' }, fiber: { state: 2 } }
      },
    }
    const request = vi.fn(async () => new Response(null, { status: 204 }))

    await expect(sendRendererBootReport(loader, request)).resolves.toEqual({ status: 'healthy' })
    expect(request).toHaveBeenCalledWith(RENDERER_BOOT_REPORT_PATH, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'healthy' }),
    })
  })

  it('defers Loader settlement until the desktop client apply has returned', async () => {
    vi.useFakeTimers()
    const loader = {
      await: vi.fn(async () => {}),
      * entries() {
        yield { options: { name: 'dsh-plugin-desktop' }, fiber: { state: 2 } }
      },
    }
    const request = vi.fn(async () => new Response(null, { status: 204 }))

    const dispose = startRendererBootReporter(loader, request)
    expect(loader.await).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()
    expect(loader.await).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledOnce()
    dispose()
  })

  /**
   * 回归：inject 凑不齐时 `loader.await()` 永不 resolve。
   * 修复前这条路径一个上报都发不出去，宿主只能按 30s 超时合成
   * `plugins: []`，恢复窗口上显示 `Unknown client plugin`（看不出是谁）。
   * 修复后必须在宿主门限之前发出报告，并点名卡住的插件。
   */
  it('names the stuck plugins when the Loader never settles', async () => {
    vi.useFakeTimers()
    const loader = {
      await: vi.fn(() => new Promise<void>(() => {})),
      * entries() {
        yield { options: { name: 'dsh-plugin-desktop' }, fiber: { state: 0 } }
        yield { options: { name: 'canvas-studio' }, fiber: { state: 2 } }
      },
    }

    const report = rendererBootReport(loader)
    await vi.advanceTimersByTimeAsync(20_000)

    await expect(report).resolves.toEqual({
      status: 'failed',
      plugins: ['dsh-plugin-desktop'],
      error: 'The client Loader did not settle within 20000ms; the plugins below never reached the active state.',
    })
  })

  it('does not send a late report after the renderer generation is disposed', async () => {    vi.useFakeTimers()
    let settle!: () => void
    const loader = {
      await: vi.fn(() => new Promise<void>((resolve) => { settle = resolve })),
      * entries() {
        yield { options: { name: 'dsh-plugin-desktop' }, fiber: { state: 2 } }
      },
    }
    const request = vi.fn(async () => new Response(null, { status: 204 }))

    const dispose = startRendererBootReporter(loader, request)
    await vi.advanceTimersByTimeAsync(0)
    expect(loader.await).toHaveBeenCalledOnce()
    dispose()
    settle()
    await Promise.resolve()
    await Promise.resolve()

    expect(request).not.toHaveBeenCalled()
  })
})
