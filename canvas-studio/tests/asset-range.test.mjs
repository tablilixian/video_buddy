// CV-382 · CR-004 资产交付 Range 行为锁定（T0 —— 先钉现状，再动实现）。
//
// T1 流式改造前把既有 6 组行为钉死在 HTTP 面上（status / 头 / 字节），对
// 「整读」与「流式」两种实现都必须成立 —— 锁的是语义，不是实现：
//   ① 无 Range 头   → 200 全量（accept-ranges / content-type / no-store / nosniff / 逐字节一致）
//   ② bytes=a-b     → 206 单段（content-range + content-length = e-s+1 + 切片字节一致）
//   ③ bytes=-N      → 206 后缀
//   ④ 越界          → 416 + content-range: bytes *加斜杠* size（空体；头同套）
//   ⑤ 畸形 Range    → 回退 200 全量（不 416、不 500；可解析但 start>end 的仍 416）
//   ⑥ .trash 兜底   → 根目录 miss 回源回收站（CV-243 undo 链路），Range 请求同样兜底；双 miss 404
//
// 套路照 library-route.test.mjs：假 ctx 捕获 handler + 真 http server 按
// exact/prefix 最长匹配分发（照 dsh-host-webserver 口径）；分发之外的守卫
// （requestAllowed / 路径穿越 / 错误码）全部是被测代码本身。
//
// 运行：corepack yarn workspace canvas-studio build && corepack yarn workspace canvas-studio test:smoke
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerStudioRoutes } from '../lib/routes.js'

const SIZE = 4096
const seqBytes = Buffer.alloc(SIZE)
for (let i = 0; i < SIZE; i += 1) seqBytes[i] = i & 0xff
const TRASH_BYTES = Buffer.from('ghost-in-trash-bytes')

let harness = null

async function startHarness() {
  const root = await mkdtemp(join(tmpdir(), 'cs-assetrange-'))
  const assetsDir = join(root, 'assets')
  await mkdir(join(assetsDir, '.trash'), { recursive: true })
  await writeFile(join(assetsDir, 'seq.png'), seqBytes)
  await writeFile(join(assetsDir, '.trash', 'ghost.png'), TRASH_BYTES)

  const registry = {
    list: async () => [{ id: 'p1', name: 'P1', dir: root, createdAt: 1 }],
    getProject: async () => ({ workflow: { mode: 'auto', state: 'idle' } }),
    assetsDir: () => assetsDir,
    readCanvas: async () => ({ version: 4, nodes: [] }),
    writeCanvas: async () => {},
    appendCanvasNode: async () => {},
    // registerStudioRoutes 启动时 fire-and-forget 跑 draft 清扫，stub 必须有这一手。
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
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    let route = null
    for (const entry of routes) {
      if (entry.kind !== 'prefix') continue
      if (pathname !== entry.path && !pathname.startsWith(`${entry.path}/`)) continue
      if (route == null || entry.path.length > route.path.length) route = entry
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
    root,
    port: ctx.webServer.port,
    async close() {
      dispose()
      // undici 复用 keep-alive 连接；不先掐掉 server.close 会一直等。
      server.closeIdleConnections?.()
      server.closeAllConnections?.()
      await new Promise((resolve) => { server.close(resolve) })
      await rm(root, { recursive: true, force: true })
    },
  }
}

/** 发一次 GET 并读回 status / 头 / 原始字节。 */
async function call(path, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${harness.port}${path}`, { headers })
  const buffer = Buffer.from(await response.arrayBuffer())
  return { status: response.status, headers: response.headers, buffer }
}

before(async () => {
  harness = await startHarness()
})

after(async () => {
  if (harness != null) await harness.close()
})

test('CR-004 锁①：无 Range 头 → 200 全量（头齐全 + 逐字节一致）', async () => {
  const r = await call('/canvas-studio/assets/p1/seq.png')
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-type'), 'image/png')
  assert.equal(r.headers.get('cache-control'), 'no-store', 'D-02：no-store 与 undo/.trash 回源耦合，不许动')
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(r.headers.get('accept-ranges'), 'bytes')
  assert.equal(r.headers.get('content-length'), String(SIZE))
  assert.ok(r.buffer.equals(seqBytes), '200 全量字节应与磁盘文件逐字节一致')
})

test('CR-004 锁②：bytes=a-b → 206 单段（content-range / content-length / 切片一致）', async () => {
  const r = await call('/canvas-studio/assets/p1/seq.png', { range: 'bytes=100-199' })
  assert.equal(r.status, 206)
  assert.equal(r.headers.get('content-type'), 'image/png')
  assert.equal(r.headers.get('accept-ranges'), 'bytes')
  assert.equal(r.headers.get('content-range'), `bytes 100-199/${SIZE}`)
  assert.equal(r.headers.get('content-length'), '100', 'content-length 必须 = e-s+1（反向变异 #1 打这里）')
  assert.ok(r.buffer.equals(seqBytes.subarray(100, 200)), '206 切片字节应与文件 [100,200) 一致')
})

test('CR-004 锁③：bytes=-N → 206 后缀', async () => {
  const r = await call('/canvas-studio/assets/p1/seq.png', { range: 'bytes=-10' })
  assert.equal(r.status, 206)
  assert.equal(r.headers.get('content-range'), `bytes ${SIZE - 10}-${SIZE - 1}/${SIZE}`)
  assert.equal(r.headers.get('content-length'), '10')
  assert.ok(r.buffer.equals(seqBytes.subarray(SIZE - 10)), '后缀 206 应返回文件末 10 字节')
})

test('CR-004 锁④：越界 Range → 416（content-range: bytes *斜杠 size，空体）', async () => {
  const beyond = await call('/canvas-studio/assets/p1/seq.png', { range: `bytes=${SIZE}-` })
  assert.equal(beyond.status, 416)
  assert.equal(beyond.headers.get('content-range'), `bytes */${SIZE}`)
  assert.equal(beyond.buffer.length, 0, '416 响应体应为空')
  assert.equal(beyond.headers.get('cache-control'), 'no-store', '416 与 200/206 同一套基础头（现行为）')

  const inverted = await call('/canvas-studio/assets/p1/seq.png', { range: 'bytes=200-100' })
  assert.equal(inverted.status, 416, '可解析但 start>end 也是 unsatisfiable → 416')
})

test('CR-004 锁⑤：畸形 Range 头 → 回退 200 全量（不 416、不 500）', async () => {
  for (const range of ['bytes=abc', 'bytes=-', 'chars=0-10']) {
    const r = await call('/canvas-studio/assets/p1/seq.png', { range })
    assert.equal(r.status, 200, `畸形 Range「${range}」应回退 200 全量`)
    assert.ok(r.buffer.equals(seqBytes), `畸形 Range「${range}」应回全量字节`)
  }
})

test('CR-004 锁⑥：.trash 兜底回源（含 Range）+ 双 miss 404', async () => {
  const ghost = await call('/canvas-studio/assets/p1/ghost.png')
  assert.equal(ghost.status, 200, '根目录 miss 应回源 .trash/（CV-243：undo 恢复节点不断链）')
  assert.equal(ghost.headers.get('accept-ranges'), 'bytes')
  assert.ok(ghost.buffer.equals(TRASH_BYTES), '.trash 兜底字节应与回收站文件一致')

  const ghostRange = await call('/canvas-studio/assets/p1/ghost.png', { range: 'bytes=6-9' })
  assert.equal(ghostRange.status, 206, '.trash 兜底也要支持 Range（流式后走 createReadStream）')
  assert.equal(ghostRange.headers.get('content-range'), `bytes 6-9/${TRASH_BYTES.length}`)
  assert.ok(ghostRange.buffer.equals(TRASH_BYTES.subarray(6, 10)))

  const absent = await call('/canvas-studio/assets/p1/absent.png')
  assert.equal(absent.status, 404)
  assert.equal(JSON.parse(absent.buffer.toString('utf8')).error, 'asset not found', '双 miss 404 文案不变')
})
