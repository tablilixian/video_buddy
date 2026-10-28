/**
 * REQ-034 · O-05 RenderHost 那**一个** HTML（无外部依赖，纯字符串）。
 *
 * 只做三件事：加载同源 bundle、显示当前状态（真机手动 loadURL 时能一眼看出「idle」）、
 * 把 `window.__csRenderHost` 暴露给宿主调试。**不内联业务逻辑** —— 逻辑全在 `main.ts`。
 *
 * ## P0-3③（2026-10-28）：为什么这里仍要有一段内联脚本
 *
 * 本机取证：4 个会话 34 次 `CS-RENDER-002`，日志里 12 次「RenderHost 已创建」，
 * 但**自报 0 次**、加载失败 0 次 —— 也就是说窗口建好了，页面脚本却没跑到第一拍。
 * 这种故障有个要命的特点：**它自己的错误处理器还没装上就已经失败了**
 * （bundle 404 / MIME 不对 / 模块解析失败 / 依赖 CSP 拒绝），所以任何写在
 * `main.ts` 里的 `window.onerror` 都收不到它。唯一能看见它的是**先于 bundle 求值**
 * 的那段代码 ⇒ 内联自举。
 *
 * 它做四件事，全部只走 `POST /render-host/status`（`state: 'error'`）：
 * 1. 捕获阶段的 `error` 事件：既管脚本运行异常，也管**资源加载失败**（`<script>` 标签
 *    的 error 不冒泡到 `onerror`，只有捕获阶段能拿到）；
 * 2. `unhandledrejection`（模块顶层 await / 动态 import 失败）；
 * 3. 8s 后 `window.__csRenderHost` 仍未定义 ⇒ bundle 完全没执行（这条是主证据）；
 * 4. 每类故障各报一次，不刷屏。
 *
 * ## 为什么 bundle 一旦求值就必须**停手**（`live` 闸，2026-10-28 端到端探针抓到的自伤）
 *
 * 自报通道是**单槽 last-write-wins**：`recordRenderHostReport` 存的是最后一拍。
 * 于是任何一拍 `state: 'error'` 都会让 `renderHostReady()` / `renderHostCanTakeOver()`
 * 在接下来 30s（`RENDER_HOST_STALE_MS`）内为假 —— 派单闸随即把工单推回画布页。
 * 而探针实测：页面**健康**（能自报 idle、能取单出片）时也会冒一次
 * `unhandledrejection: Failed to fetch`（某个轮询请求的瞬时失败），自举脚本把它如实
 * 报成 `error`，结果宿主 8s 后打出「本单回退画布页」，把一次完全正常的渲染说成故障。
 *
 * ⇒ 判据回到本脚本唯一要回答的问题：**页面脚本到底跑起来没有**。`__csRenderHost`
 * 一旦出现（250ms 轮询）就说明 bundle 求值成功、后续由页面自己自报，自举从此闭嘴。
 * 这样「从未跑起来」照旧被点亮，而「跑起来了但中途抖一下」交还给 1s 心跳去覆盖。
 *
 * ⚠️ CSP 不再用 `'unsafe-inline'` —— 而是**渲染时现算 sha256** 并把哈希写进
 * `script-src`。这样内联脚本仍然被放行，而「给别人开一个内联口子」的代价没有扩散
 * （这个窗口加载的 HTML 是宿主自己拼的，没有用户内容，但也没有理由为此放宽策略）。
 */
import { createHash } from 'node:crypto'

/** 渲染窗口的自报状态（宿主侧日志/调试用）。 */
export interface RenderHostPageOptions {
  /** bundle 的同源路径，默认 `/canvas-studio/render-host.js`。 */
  scriptSrc?: string
}

/**
 * 自举脚本源码（**必须与写进 HTML 的字节完全一致** —— CSP 哈希按它现算）。
 *
 * 写作纪律：只用单引号与字符串拼接 —— 外层是模板串，内层再出现反引号会把
 * `${}` 提前展开（本项目已知的踩坑点，见 `.workbuddy/memory` 的源文件约束）。
 */
export const RENDER_HOST_BOOTSTRAP = [
  '(function(){',
  "var EP='/canvas-studio/render-host/status';",
  'var sent={},live=0;',
  'function send(key,detail){',
  'if(live||sent[key])return;sent[key]=1;',
  'try{',
  "void fetch(EP,{method:'POST',headers:{'content-type':'application/json'},",
  "body:JSON.stringify({state:'error',detail:String(detail).slice(0,240)}),keepalive:true});",
  '}catch(e){}',
  '}',
  'var poll=setInterval(function(){if(window.__csRenderHost){live=1;clearInterval(poll);}},250);',
  "window.addEventListener('error',function(e){",
  'var t=e&&e.target;',
  "if(t&&t.tagName){send('res','资源加载失败 '+t.tagName+' '+(t.src||t.href||''));return;}",
  "send('js','页面脚本异常 '+(e&&e.message?e.message:e));",
  '},true);',
  "window.addEventListener('unhandledrejection',function(e){",
  'var r=e&&e.reason;',
  "send('rej','未处理的 Promise 拒绝 '+(r&&r.message?r.message:r));",
  '});',
  'setTimeout(function(){',
  'if(window.__csRenderHost)return;',
  "send('boot','bundle 未执行：8s 后 __csRenderHost 仍未定义（404 / MIME / 模块解析 / CSP）');",
  '},8000);',
  '})();',
].join('\n')

function sha256Of(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('base64')
}

export function renderHostHtml(options: RenderHostPageOptions = {}): string {
  const scriptSrc = options.scriptSrc ?? '/canvas-studio/render-host.js'
  const bootstrapHash = sha256Of(RENDER_HOST_BOOTSTRAP)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Canvas Studio · 渲染窗口</title>
<!-- 隐藏窗口：不允许被嵌入，也不允许跳走（子资源只走同源）。内联自举脚本按 sha256 白名单放行。 -->
<meta http-equiv="Content-Security-Policy" content="default-src 'self' blob: data:; script-src 'self' 'sha256-${bootstrapHash}'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob: data:; connect-src 'self'">
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
<script>${RENDER_HOST_BOOTSTRAP}</script>
<script type="module" src="${scriptSrc}"></script>
</body>
</html>`
}
