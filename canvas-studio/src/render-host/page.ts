/**
 * REQ-034 · O-05 RenderHost 那**一个** HTML（无外部依赖，纯字符串）。
 *
 * 只做三件事：加载同源 bundle、显示当前状态（真机手动 loadURL 时能一眼看出「idle」）、
 * 把 `window.__csRenderHost` 暴露给宿主调试。**不内联业务逻辑** —— 逻辑全在 `main.ts`。
 */

/** 渲染窗口的自报状态（宿主侧日志/调试用）。 */
export interface RenderHostPageOptions {
  /** bundle 的同源路径，默认 `/canvas-studio/render-host.js`。 */
  scriptSrc?: string
}

export function renderHostHtml(options: RenderHostPageOptions = {}): string {
  const scriptSrc = options.scriptSrc ?? '/canvas-studio/render-host.js'
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Canvas Studio · 渲染窗口</title>
<!-- 隐藏窗口：不允许被嵌入，也不允许跳走（子资源只走同源）。 -->
<meta http-equiv="Content-Security-Policy" content="default-src 'self' blob: data:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob: data:; connect-src 'self'">
<style>
  html, body { margin: 0; height: 100%; background: #0b1020; color: #e5e7eb;
    font: 13px/1.5 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  #boot { display: grid; place-items: center; height: 100%; }
  #boot .card { padding: 16px 20px; border: 1px solid #1f2937; border-radius: 10px; background: #111827; }
  #state { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #34d399; }
  #detail { margin-top: 6px; color: #9ca3af; white-space: pre-wrap; }
</style>
</head>
<body>
<div id="boot"><div class="card">
  <div>Canvas Studio 渲染窗口 <span id="state">booting</span></div>
  <div id="detail">等待宿主派单…</div>
</div></div>
<script type="module" src="${scriptSrc}"></script>
</body>
</html>`
}
