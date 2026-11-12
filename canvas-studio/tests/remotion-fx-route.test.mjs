/**
 * CV-464：真素材音效只读路由（`/canvas-studio/remotion/fx/<name>.mp3`）的 HTTP 行为守卫。
 *
 * 与 `tests/remotion-sfx-route.test.mjs` 同构（同一套最小分发 harness），但锁的是另一套素材：
 *   - 目录是 `assets/audio/sfx/`（CV-371 入库的 Mixkit Free License 素材），不是合成库；
 *   - 只放行 `.mp3`，**不**像 sfx 那样额外精确放行 `manifest.json`；
 *   - Content-Type 走 `ASSET_CONTENT_TYPES` 查表（`.mp3` → `audio/mpeg`），
 *     查表漏项会退化成 `application/octet-stream`，播放器与波形端点都取不到类型。
 *
 * 锁住六组行为：
 *   1. 正常 GET：200 + `audio/mpeg` + 强缓存 + `nosniff`，字节与磁盘**完全一致**；
 *   2. 12 支素材全部可取，且字节数**不是同一个占位**；
 *   3. 合法但不存在 → 404；
 *   4. 非法文件名（`.wav` / 大写 / 下划线 / 子目录 / `..` / `manifest.json`）→ 400，
 *      **在读到磁盘之前**就拒；
 *   5. malformed 百分号编码 → 400；权威伪造 → 403；非 GET → 405；
 *   6. 回归：旧的 `/canvas-studio/remotion/sfx/thud.wav` 仍 200（历史数据兼容，别再拆掉）。
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
const ROUTE = '/canvas-studio/remotion/fx'
const FX_DIR = join(PKG_ROOT, 'assets', 'audio', 'sfx')
const FX_ID = 'click-camera'
const FX_FILE = `${FX_ID}.mp3`
const FX_BYTES = readFileSync(join(FX_DIR, FX_FILE))

/** 契约里登记的全部 12 支（写死：目录里多出文件不该被静默当成「已登记」）。 */
const ALL_FX = [
  'bass-hit-short',
  'camera-autofocus',
  'camera-shutter-hard',
  'click-camera',
  'glitch-electric-small',
  'impact-deep-whoosh',
  'impact-zoom-quick',
  'shimmer-sparkle-sweep',
  'sweep-fast-small',
  'sweep-scifi-fast',
  'transition-snap',
  'whoosh-fast',
]

/** 穿越目标哨兵：`../fonts/README.md` 是 `..` 最容易够到的真实文件。 */
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
    // 按原始路径分发，不经 `new URL()` 归一化 —— 否则 `/a/../b` 会被 harness 自己抹平。
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

async function call(path, { method = 'GET', headers = {} } = {}) {
  const response = await fetch(`http://127.0.0.1:${harness.port}${path}`, {
    method,
    headers: { origin: harness.origin, ...headers },
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  return { status: response.status, headers: response.headers, text: buffer.toString('utf8'), buffer }
}

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

/** mp3 头：ID3v2 标签或 MPEG frame sync（0xFFEx）二者之一。 */
function looksLikeMp3(buffer) {
  if (buffer.length > 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3') return true
  return buffer.length > 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0
}

test('正常 GET：200 + audio/mpeg + 强缓存 + nosniff，且字节与磁盘一致', async () => {
  const response = await call(`${ROUTE}/${FX_FILE}`)
  assert.equal(response.status, 200)
  assert.equal(
    response.headers.get('content-type'),
    'audio/mpeg',
    '.mp3 必须命中 ASSET_CONTENT_TYPES 查表，退化成 octet-stream 会让播放器取不到类型',
  )
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.buffer.length, FX_BYTES.length, '返回字节数与磁盘不一致')
  assert.ok(response.buffer.equals(FX_BYTES), '返回内容与磁盘文件不一致')
  assert.ok(looksLikeMp3(response.buffer), '返回体不像 mp3（既无 ID3 头也无 frame sync）')
})

test('12 支素材全部可取，且不是同一段占位', async () => {
  const sizes = new Set()
  for (const id of ALL_FX) {
    const response = await call(`${ROUTE}/${id}.mp3`)
    assert.equal(response.status, 200, `${id}.mp3 应可读（登记了就必须有文件）`)
    assert.ok(response.buffer.length > 1000, `${id}.mp3 体积过小，疑似空文件或占位`)
    assert.ok(looksLikeMp3(response.buffer), `${id}.mp3 不是合法 mp3`)
    sizes.add(response.buffer.length)
  }
  assert.equal(sizes.size, ALL_FX.length, '12 支的字节数出现重复，素材可能被同一个文件覆盖')
})

test('合法但不存在 → 404', async () => {
  const response = await call(`${ROUTE}/no-such-sound.mp3`)
  assert.equal(response.status, 404)
})

test('非法文件名在读到磁盘之前就 400', async () => {
  const cases = [
    ['sfx-wav-ext', `${ROUTE}/thud.wav`],
    ['uppercase', `${ROUTE}/Thud.mp3`],
    ['underscore', `${ROUTE}/thud_v2.mp3`],
    ['subdir', `${ROUTE}/sub/thud.mp3`],
    ['dotdot', `${ROUTE}/../sfx/thud.wav`],
    ['manifest', `${ROUTE}/manifest.json`],
    ['no-ext', `${ROUTE}/thud`],
  ]
  for (const [name, path] of cases) {
    const response = await rawRequest(path)
    assert.equal(response.status, 400, `${name} 应 400（白名单 ^[a-z0-9-]+\\.mp3$）`)
    assert.ok(!response.buffer.toString('utf8').includes(CANARY), `${name} 泄漏了越权文件内容`)
  }
})

test('malformed 编码 → 400（不能抛 URIError 挂死响应）', async () => {
  const response = await rawRequest(`${ROUTE}/%E0%A4%A.mp3`)
  assert.equal(response.status, 400)
})

test('权威与写方法：伪造 Host → 403、非 GET → 405', async () => {
  const forged = await rawRequest(`${ROUTE}/${FX_FILE}`, { host: 'evil.example.com' })
  assert.equal(forged.status, 403)

  const posted = await call(`${ROUTE}/${FX_FILE}`, { method: 'POST' })
  assert.equal(posted.status, 405)
})

test('回归：旧合成音效路由仍可播（历史数据兼容）', async () => {
  const response = await call('/canvas-studio/remotion/sfx/thud.wav')
  assert.equal(response.status, 200, '旧 /remotion/sfx 路由被拆掉会让历史 canvas.json 全 404')
  assert.equal(response.headers.get('content-type'), 'audio/wav')
})
