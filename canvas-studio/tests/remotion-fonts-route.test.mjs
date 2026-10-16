/**
 * REQ-034 · R1：随包字体只读路由（`/canvas-studio/remotion/fonts/<name>.woff2`）的 HTTP 行为守卫。
 *
 * 没有现成 harness，这里照 `tests/library-route.test.mjs` 搭一个最小但**忠实**的分发器：
 * `ctx.webServer.register` 只收集路由（exact 优先、prefix 最长匹配），真 `http.createServer`
 * 按 `new URL(req.url).pathname` 归一化后分派；先 `listen(0)` 拿到端口再注册（`expectedPort`
 * 在注册时被捕获，authority 校验靠它）。分发之外的守卫（authority / 白名单 / 路径穿越）都是被测代码本身。
 *
 * 锁住五组行为：
 *   1. 正常 GET：200 + `font/woff2` + 强缓存 + `nosniff`，且**字节与磁盘完全一致**；
 *   2. 合法但不存在 → 404；
 *   3. 非法文件名（扩展名不符 / 大写 / 下划线 / 子目录 / `..`）→ 400，**在读到磁盘之前**就拒；
 *   4. malformed 百分号编码 → 400（不能抛 URIError 把响应挂死）；
 *   5. 权威与写方法：伪造 Host → 403、`sec-fetch-site: cross-site` → 403、非 GET → 405；
 *      且所有 4xx 响应体**不含**同目录 README 的内容（穿越/越权都不许泄漏文件）。
 *
 * 运行：corepack yarn workspace canvas-studio build && corepack yarn workspace canvas-studio test:smoke
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerStudioRoutes } from '../lib/routes.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = join(HERE, '..')
const FONT = 'noto-sans-sc-400.woff2'
const ROUTE = '/canvas-studio/remotion/fonts'

/** 同目录里的非字体文件内容当哨兵：任何响应带出它都算越权读盘。 */
const CANARY = readFileSync(join(PKG_ROOT, 'assets', 'fonts', 'README.md'), 'utf8').slice(0, 40)
const FONT_BYTES = readFileSync(join(PKG_ROOT, 'assets', 'fonts', FONT))

let harness = null

async function startHarness() {
  const registry = {
    list: async () => [],
    getProject: async () => ({ workflow: { mode: 'auto', state: 'idle' } }),
    assetsDir: () => join(PKG_ROOT, 'assets'),
    readCanvas: async () => ({ version: 4, nodes: [] }),
    writeCanvas: async () => {},
    appendCanvasNode: async () => {},
    // 注册时会 fire-and-forget 跑 draft 清扫，stub 必须提供它触碰的这段面。
    sweepOnceForCurrentRoot: async () => 0,
  }
  const routes = []
  const ctx = {
    webServer: {
      port: 0,
      register: (route) => {
        routes.push(route)
        return () => {}
      },
    },
    logger: { warn() {}, info() {}, error() {} },
  }

  const server = createServer((req, res) => {
    // ⚠️ 按**原始路径**分发，不经过 `new URL()` 归一化 —— 否则 `/a/../b` 会被 harness
    // 自己抹平成 `/b`，穿越用例根本到不了路由，测的就成了 harness 而不是被测守卫。
    const pathname = (req.url ?? '/').split('?')[0]
    const exact = routes.find((entry) => entry.kind === 'exact' && entry.path === pathname)
    let route = exact
    if (route == null) {
      let best = null
      for (const entry of routes) {
        if (entry.kind !== 'prefix') continue
        if (pathname !== entry.path && !pathname.startsWith(`${entry.path}/`)) continue
        if (best == null || entry.path.length > best.path.length) best = entry
      }
      route = best
    }
    if (route == null) {
      res.statusCode = 404
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }
    Promise.resolve(route.handler(req, res)).catch(() => {
      if (!res.writableEnded) {
        res.statusCode = 500
        res.end()
      }
    })
  })
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  ctx.webServer.port = server.address().port
  // library 面在注册期不被触碰（本组只用字体路由），给空对象即可。
  const dispose = registerStudioRoutes(ctx, registry, {})

  return {
    port: ctx.webServer.port,
    origin: `http://127.0.0.1:${ctx.webServer.port}`,
    async close() {
      dispose()
      server.closeIdleConnections?.()
      server.closeAllConnections?.()
      await new Promise((resolve) => { server.close(resolve) })
    },
  }
}

before(async () => { harness = await startHarness() })
after(async () => { await harness?.close() })

/** 发一次请求（默认带同源 Origin + Host）并读回二进制。 */
async function call(path, { method = 'GET', headers = {} } = {}) {
  const response = await fetch(`http://127.0.0.1:${harness.port}${path}`, {
    method,
    headers: { origin: harness.origin, ...headers },
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  return { status: response.status, headers: response.headers, text: buffer.toString('utf8'), buffer }
}

/** 可自定义 Host 头的原生请求（authority 伪造用例）。 */
function rawRequest(path, { method = 'GET', host } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port: harness.port,
      path,
      method,
      headers: { ...(host === undefined ? {} : { host }) },
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, buffer: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.end()
  })
}

test('正常 GET：200 + font/woff2 + 强缓存 + nosniff，且字节与磁盘一致', async () => {
  const response = await call(`${ROUTE}/${FONT}`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'font/woff2')
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.buffer.length, FONT_BYTES.length, '返回字节数与磁盘不一致')
  assert.ok(response.buffer.equals(FONT_BYTES), '返回内容与磁盘文件不一致')
  assert.equal(response.buffer.subarray(0, 4).toString('ascii'), 'wOF2')
})

test('合法但不存在 → 404', async () => {
  const response = await call(`${ROUTE}/noto-sans-sc-900.woff2`)
  assert.equal(response.status, 404)
})

test('非法文件名在读到磁盘之前就 400（扩展名 / 大小写 / 子目录 / 穿越 / 同目录其它文件）', async () => {
  const illegal = [
    'README.md',
    'noto-sans-sc-400.woff2.bak',
    'NotoSansSC-400.woff2',
    'noto_sans_sc_400.woff2',
    'sub/noto-sans-sc-400.woff2',
    '../README.md',
    '..%2Fstyle-demos%2Fwhatever.gif',
    '%2E%2E%2FREADME.md',
    '',
  ]
  for (const name of illegal) {
    // ⚠️ 必须走原生请求：`fetch` 会先把 `../` 归一化掉，请求根本到不了路由，
    // 那样测的是客户端而不是守卫。原生请求把字面路径原样发给服务端。
    const response = await rawRequest(`${ROUTE}/${name}`)
    const text = response.buffer.toString('utf8')
    assert.equal(response.status, 400, `「${name}」应被白名单拒（实得 ${response.status}）`)
    assert.ok(!text.includes(CANARY), `「${name}」的响应体泄漏了同目录文件内容`)
  }
})

test('malformed 百分号编码 → 400（不抛 URIError、响应不悬空）', async () => {
  const response = await call(`${ROUTE}/%E0%A4%A.woff2`)
  assert.equal(response.status, 400)
  assert.ok(!response.text.includes(CANARY))
})

test('权威守卫：伪造 Host / 跨站 sec-fetch-site 一律 403', async () => {
  const forged = await rawRequest(`${ROUTE}/${FONT}`, { host: `evil.example.com:${harness.port}` })
  assert.equal(forged.status, 403, '伪造 Host 必须被拒')
  assert.ok(!forged.buffer.includes(FONT_BYTES.subarray(0, 32)))

  const wrongPort = await rawRequest(`${ROUTE}/${FONT}`, { host: '127.0.0.1:1' })
  assert.equal(wrongPort.status, 403, '端口不符必须被拒')

  const crossSite = await call(`${ROUTE}/${FONT}`, { headers: { 'sec-fetch-site': 'cross-site' } })
  assert.equal(crossSite.status, 403, 'cross-site 必须被拒')
  assert.ok(!crossSite.text.includes(CANARY))
})

test('非 GET → 405（字体是只读面）', async () => {
  const response = await call(`${ROUTE}/${FONT}`, { method: 'POST' })
  assert.equal(response.status, 405)
})
