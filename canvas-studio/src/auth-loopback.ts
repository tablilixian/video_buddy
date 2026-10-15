/**
 * P1 登录闭环：Supabase OAuth PKCE 的 loopback 回调服务（Host 进程内）。
 *
 * 移植自 reelsbuddy-auth 的 `StartLoopback`（app.go:126-178，见
 * reelsbuddy-auth/docs/electron-login-migration.md §3.1），三处有意差异：
 * - 跑在 canvas-studio Host（Node/Cordis 插件）而非 Electron 主进程 —— 不需要
 *   BrowserWindow 推送，回调投递改为 client 主动轮询（见 routes.ts 的
 *   `GET /canvas-studio/auth/pending`），因此「ready 推送 / 未 ready 缓存」双路径
 *   收敛为「缓存 + 轮询」单路径（语义等价：缓存兜住了页面未就绪的窗口期）。
 * - 幂等：重复 start 返回同一地址（对应 app.go:136-143）。
 * - 回调只消费一次（取走即清），防重放；服务随插件 dispose 关闭。
 *
 * 铁律（参考文档 §0）：只做 loopback，不做深链；授权页必须走系统浏览器
 * （client 侧 window.open → Electron setWindowOpenHandler 白名单放行）。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/** 回调落地页（对应 app.go:180-200 loopbackDonePage）：告知用户可关闭浏览器标签。 */
const LOOPBACK_DONE_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>登录完成</title>
<style>
  body { font-family: -apple-system, "PingFang SC", sans-serif; display: flex;
         align-items: center; justify-content: center; height: 100vh; margin: 0;
         background: #f6f5f2; color: #2c2c2a; }
  .card { text-align: center; }
  h1 { font-size: 20px; font-weight: 500; }
  p { font-size: 14px; color: #5f5e5a; }
</style>
</head>
<body>
<div class="card">
  <h1>登录完成</h1>
  <p>授权成功，请回到应用继续使用；本页面可以关闭。</p>
</div>
</body>
</html>
`

/** 回调 URL 待取状态：一次性（consume 后清空）。 */
let pendingCallback: string | null = null
let server: Server | null = null
let callbackURL = ''

/**
 * 起一个只监听 127.0.0.1 的 http 服务，端口交给系统随机分配，返回
 * `http://127.0.0.1:<port>/callback` 作为 OAuth `redirectTo`。幂等。
 */
export function startLoopback(): Promise<string> {
  if (server !== null) return Promise.resolve(callbackURL)
  return new Promise((resolve, reject) => {
    const created = createServer((req, res) => {
      handleCallbackRequest(req, res)
    })
    created.on('error', (cause: unknown) => {
      // 端口分配 / 监听失败：抛回调用方（参考文档 §4 坑 9），由路由转可读错误。
      if (server === null) {
        reject(cause instanceof Error ? cause : new Error(String(cause)))
      }
    })
    created.listen(0, '127.0.0.1', () => {
      server = created
      const address = created.address() as AddressInfo
      callbackURL = `http://127.0.0.1:${String(address.port)}/callback`
      resolve(callbackURL)
    })
  })
}

/** `/callback` handler：只认本服务的 authority 上的该路径；缓存完整 URL 并回落地页。 */
function handleCallbackRequest(req: IncomingMessage, res: ServerResponse): void {
  const host = req.headers.host ?? ''
  const url = new URL(req.url ?? '/', `http://${host}`)
  if (url.pathname !== '/callback') {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'not found' }))
    return
  }
  // 完整回调 URL（含 query；Supabase 会 302 到这里并带上 ?code=… 或 ?error=…）。
  pendingCallback = `http://${host}/callback${url.search}`
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(LOOPBACK_DONE_PAGE)
}

/** 取走待处理的回调 URL（一次性）；无则 null。client 轮询消费。 */
export function consumePendingCallback(): string | null {
  const value = pendingCallback
  pendingCallback = null
  return value
}

/** 是否有正在监听的 loopback 服务（client 轮询前的存在性检查用）。 */
export function loopbackActive(): boolean {
  return server !== null
}

/** 关闭服务并清状态（插件 dispose / 登录流程结束）。幂等。 */
export function stopLoopback(): void {
  const closing = server
  server = null
  callbackURL = ''
  pendingCallback = null
  if (closing !== null) closing.close()
}
