/**
 * 0A · CV-460：随包音效只读路由（`/canvas-studio/remotion/sfx/<name>.wav`）的 HTTP 行为守卫。
 *
 * 与 `tests/remotion-fonts-route.test.mjs` 同构（同一套最小分发 harness），因为两条路由
 * 共用同一组守卫形状：loopback authority → 单段文件名白名单 → join/startsWith 兜底。
 * 差异只有两处，也正是本文件要额外锁住的：
 *   - 放行的**不是**单一后缀名，额外精确放行 `manifest.json`（且只放这一个名字）；
 *   - Content-Type 走 `ASSET_CONTENT_TYPES` 查表（`.wav` → `audio/wav`），
 *     而不是字体那样硬写死 —— 查表漏项会退化成 `application/octet-stream`，播放器取不到类型。
 *
 * 锁住六组行为：
 *   1. 正常 GET：200 + `audio/wav` + 强缓存 + `nosniff`，字节与磁盘**完全一致**；
 *   2. `manifest.json` 精确放行：200 + `application/json`，但 `manifest.JSON` / `x-manifest.json` 仍 400；
 *   3. 合法但不存在 → 404；
 *   4. 非法文件名（扩展名 / 大小写 / 下划线 / 子目录 / `..` / 同目录其它后缀）→ 400，
 *      **在读到磁盘之前**就拒；
 *   5. malformed 百分号编码 → 400（不能抛 URIError 把响应挂死）；
 *   6. 权威与写方法：伪造 Host / 跨站 sec-fetch-site → 403、非 GET → 405；
 *      且所有 4xx 响应体**不含**穿越目标的文件内容（越权不许泄漏）。
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
const ROUTE = '/canvas-studio/remotion/sfx'
const SFX_ID = 'thud'
const SFX_FILE = `${SFX_ID}.wav`
const SFX_BYTES = readFileSync(join(PKG_ROOT, 'assets', 'sfx', SFX_FILE))
const MANIFEST_BYTES = readFileSync(join(PKG_ROOT, 'assets', 'sfx', 'manifest.json'))

/**
 * 穿越目标用 fonts 目录的 README 当哨兵 —— 它就在 `../fonts/` 下，是 `..` 类路径
 * 最容易够到的真实文件；任何响应带出它的内容都算越权读盘。
 */
const CANARY = readFileSync(join(PKG_ROOT, 'assets', 'fonts', 'README.md'), 'utf8').slice(0, 40)

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

/** 可自定义 Host 头的原生请求（authority 伪造 / 字面穿越路径用例）。 */
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

test('正常 GET：200 + audio/wav + 强缓存 + nosniff，且字节与磁盘一致', async () => {
  const response = await call(`${ROUTE}/${SFX_FILE}`)
  assert.equal(response.status, 200)
  assert.equal(
    response.headers.get('content-type'),
    'audio/wav',
    '.wav 必须命中 ASSET_CONTENT_TYPES 查表，退化成 octet-stream 会让播放器取不到类型',
  )
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.buffer.length, SFX_BYTES.length, '返回字节数与磁盘不一致')
  assert.ok(response.buffer.equals(SFX_BYTES), '返回内容与磁盘文件不一致')
  // RIFF/WAVE 头：确定性渲染依赖的正是这份字节，头不对说明不是 build-sfx 的产物。
  assert.equal(response.buffer.subarray(0, 4).toString('ascii'), 'RIFF')
  assert.equal(response.buffer.subarray(8, 12).toString('ascii'), 'WAVE')
})

test('五支随包音效全部可取，且互不相同', async () => {
  const seen = new Set()
  for (const id of ['thud', 'write', 'swoosh', 'card', 'swipe']) {
    const response = await call(`${ROUTE}/${id}.wav`)
    assert.equal(response.status, 200, `${id}.wav 应可读`)
    assert.ok(response.buffer.length > 44, `${id}.wav 只有头没有采样数据`)
    seen.add(response.buffer.length)
  }
  assert.ok(seen.size >= 3, `五支音效的字节数过于雷同（${[...seen].join(',')}），可能都是同一段占位`)
})

test('manifest.json 精确放行；形近名一律 400', async () => {
  const ok = await call(`${ROUTE}/manifest.json`)
  assert.equal(ok.status, 200)
  assert.equal(ok.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.ok(ok.buffer.equals(MANIFEST_BYTES), '清单内容与磁盘不一致')

  for (const name of ['Manifest.json', 'manifest.JSON', 'x-manifest.json', 'manifest.json.bak', 'manifest']) {
    const bad = await rawRequest(`${ROUTE}/${name}`)
    assert.equal(bad.status, 400, `「${name}」应被白名单拒（实得 ${bad.status}）`)
  }
})

test('合法但不存在 → 404', async () => {
  const response = await call(`${ROUTE}/nope.wav`)
  assert.equal(response.status, 404)
})

test('非法文件名在读到磁盘之前就 400（扩展名 / 大小写 / 子目录 / 穿越 / 同目录其它文件）', async () => {
  const illegal = [
    'README.md',
    'thud.wav.bak',
    'THUD.wav',
    'thud_big.wav',
    'sub/thud.wav',
    '../fonts/README.md',
    '..%2Ffonts%2FREADME.md',
    '%2E%2E%2Ffonts%2FREADME.md',
    '',
  ]
  for (const name of illegal) {
    // ⚠️ 必须走原生请求：`fetch` 会先把 `../` 归一化掉，请求根本到不了路由，
    // 那样测的是客户端而不是守卫。原生请求把字面路径原样发给服务端。
    const response = await rawRequest(`${ROUTE}/${name}`)
    const text = response.buffer.toString('utf8')
    assert.equal(response.status, 400, `「${name}」应被白名单拒（实得 ${response.status}）`)
    assert.ok(!text.includes(CANARY), `「${name}」的响应体泄漏了穿越目标的文件内容`)
  }
})

test('malformed 百分号编码 → 400（不抛 URIError、响应不悬空）', async () => {
  const response = await call(`${ROUTE}/%E0%A4%A.wav`)
  assert.equal(response.status, 400)
  assert.ok(!response.text.includes(CANARY))
})

test('权威守卫：伪造 Host / 端口不符 / 跨站 sec-fetch-site 一律 403', async () => {
  const forged = await rawRequest(`${ROUTE}/${SFX_FILE}`, { host: `evil.example.com:${harness.port}` })
  assert.equal(forged.status, 403, '伪造 Host 必须被拒')
  assert.ok(!forged.buffer.includes(SFX_BYTES.subarray(0, 32)))

  const wrongPort = await rawRequest(`${ROUTE}/${SFX_FILE}`, { host: '127.0.0.1:1' })
  assert.equal(wrongPort.status, 403, '端口不符必须被拒')

  const crossSite = await call(`${ROUTE}/${SFX_FILE}`, { headers: { 'sec-fetch-site': 'cross-site' } })
  assert.equal(crossSite.status, 403, 'cross-site 必须被拒')
  assert.ok(!crossSite.text.includes(CANARY))
})

test('非 GET → 405（音效是只读面）', async () => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const response = await call(`${ROUTE}/${SFX_FILE}`, { method })
    assert.equal(response.status, 405, `${method} 必须被拒`)
  }
})
