/**
 * 渲染器 A/B 对照探针 · bundle 入口（SSR / CSR 共用同一份 bundle）
 *
 * 两条路线都渲染 id='probe' 这一个 composition：
 *   - SSR：`@remotion/renderer` 直接 selectComposition('probe') → renderMedia
 *   - CSR：`@remotion/web-renderer` 的 renderMediaOnWeb（页面内自渲染）→ POST /save
 *
 * 为什么 CSR 要在页面里自己触发：web-renderer 的 API 只有浏览器里有，
 * 不能像 SSR 那样从 Node 侧调用 —— 这本身就是两条路线的一处结构性差异。
 */
import React from 'react'
import { Composition, registerRoot } from 'remotion'
import { Probe } from './probe.js'

const Root: React.FC = () => (
  <Composition id="probe" component={Probe} durationInFrames={30} fps={30} width={1920} height={1080} />
)
registerRoot(Root)

/** CSR 模式：URL 带 ?csr=1 时自渲染并把字节回传宿主。 */
async function runCsr(): Promise<void> {
  const { renderMediaOnWeb } = await import('@remotion/web-renderer')
  const params = new URLSearchParams(window.location.search)
  // allowHtmlInCanvas=1 ⇒ 走 Chromium 实验性 drawElementImage（绕过 built-in DOM composer 的 CSS 白名单）
  const allowHtmlInCanvas = params.get('html') === '1'
  const report = (payload: Record<string, unknown>): void => {
    // 复用 capability-bench 的 Electron 启动器 —— 它只认 `[bench] ` 前缀的事件行
    console.log('[bench] ' + JSON.stringify(payload))
  }
  try {
    const started = performance.now()
    const result = await renderMediaOnWeb({
      composition: {
        id: 'probe',
        component: Probe,
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 30,
        defaultProps: {},
        calculateMetadata: null,
      },
      inputProps: {},
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: null,
      outputTarget: 'arraybuffer',
      allowHtmlInCanvas,
      licenseKey: 'free-license',
    })
    const blob = await result.getBlob()
    const bytes = new Uint8Array(await blob.arrayBuffer())
    report({ step: 'csr-render-done', bytes: bytes.byteLength, ms: Math.round(performance.now() - started), allowHtmlInCanvas })
    const res = await fetch('/save?name=' + encodeURIComponent(params.get('name') ?? 'csr.mp4'), { method: 'POST', body: bytes })
    report({ step: 'csr-saved', status: res.status })
    report({ step: 'finished', totalMs: Math.round(performance.now() - started) })
  } catch (error) {
    report({ step: 'error', message: String((error as Error)?.message ?? error) })
  }
}

if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('csr') === '1') {
  void runCsr()
}
