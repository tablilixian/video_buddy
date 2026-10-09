/**
 * REQ-003 Step 1：`POST /canvas-studio/resolve-refs` 的 HTTP 面契约。
 *
 * 这条端点存在的唯一理由：UI 的「添加参考图」不能直接拿 `node.filename` ——
 * 生成产物节点上存的是后端**产物名**（img_*），当参考传回去约 0.1s 内 500（CV-155）；
 * 可用句柄必须由 Host 的解析链（惰性提升 + 回写源节点）现造。
 *
 * 锁住四组行为：
 *   1. 成功项：已经是可用句柄的节点**原样返回**（不重复上传）；
 *   2. 逐项失败：未知引用给 `error`，**不影响同一批里的成功项**（一次选多张不该整批失败）；
 *   3. 权威 / 方法 / 入参守卫：跨站 403、GET 405、缺字段 400；
 *   4. 响应形状：`{ items: [{ ref, handle } | { ref, error: { code, message } }] }`。
 *
 * 逐项失败不整批失败这条**必须在 HTTP 层验**：纯函数层看不到"一次请求里既有成功又有失败"。
 *
 * 运行：corepack yarn build && corepack yarn test:smoke
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { registerStudioRoutes } from '../lib/routes.js'

const PATH = '/canvas-studio/resolve-refs'

let harness = null

/** 已经是可用句柄的节点（解析链会原样返回，零 IO）。 */
const NODES = [
  { id: 'n-ready', title: '男主 · 定妆', kind: 'image', url: 'http://127.0.0.1:9/asset/proj/a.png', filename: 'ref-7516d08b.png' },
  { id: 'n-plain', title: '竹林 · 场景', kind: 'image', url: 'http://127.0.0.1:9/asset/proj/b.png', filename: 'ref-a1b2c3d4.png' },
]

async function startHarness() {
  const routes = []
  let port = 0
  const ctx = {
    // 真 register 返回一个 disposer（registerStudioRoutes 收集的就是它）——假实现也要给。
    webServer: { port, register: (route) => { routes.push(route); return () => {} } },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  }
  const registry = {
    async readCanvas() { return { nodes: NODES } },
    async writeCanvas() {},
    // routes 注册时会 fire-and-forget 一次启动清扫（REQ-005 v1.3；CV-292 改走按根
    // 去重的 sweepOnceForCurrentRoot）—— 假 registry 也要接住。
    async sweepOnceForCurrentRoot() { return 0 },
  }
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    const route = routes.find((candidate) => candidate.kind === 'exact' && candidate.path === path)
    if (route === undefined) {
      res.statusCode = 404
      res.end('{"error":"no route"}')
      return
    }
    void route.handler(req, res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = server.address().port
  ctx.webServer.port = port
  const dispose = registerStudioRoutes(ctx, registry, {})
  return { server, port, dispose }
}

function call(method, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const req = httpRequest({
      host: '127.0.0.1',
      port: harness.port,
      method,
      path: PATH,
      agent: false,          // 一次性连接：不依赖全局 agent 的 keep-alive 行为

      headers: {
        'content-type': 'application/json',
        ...(payload === undefined ? {} : { 'content-length': Buffer.byteLength(payload) }),
        // node 的原生 request 不自动带 origin / sec-fetch-site，同源判定靠显式给。
        origin: `http://127.0.0.1:${harness.port}`,
        host: `127.0.0.1:${harness.port}`,
        'sec-fetch-site': 'same-origin',
        ...headers,
      },
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        let parsed = null
        try { parsed = data === '' ? null : JSON.parse(data) } catch { parsed = { raw: data } }
        resolve({ status: res.statusCode, body: parsed })
      })
    })
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

before(async () => { harness = await startHarness() })
after(async () => {
  harness?.dispose()
  // 踩过的坑（CV-255 记账）：Node 的全局 agent 默认 keep-alive，只调 close() 会
  // 因为残留的 idle 连接永不返回 —— 必须先把连接清掉再 close。
  harness.server.closeIdleConnections()
  harness.server.closeAllConnections()
  await new Promise((resolve) => harness.server.close(resolve))
})

test('REQ-003 resolve-refs：可用句柄原样返回，逐项成功', async () => {
  const res = await call('POST', { projectId: 'proj', refs: ['n-ready', 'n-plain'] })
  assert.equal(res.status, 200)
  assert.equal(res.body.items.length, 2)
  assert.deepEqual(res.body.items[0], { ref: 'n-ready', handle: 'ref-7516d08b.png' })
  assert.deepEqual(res.body.items[1], { ref: 'n-plain', handle: 'ref-a1b2c3d4.png' })
})

test('REQ-003 resolve-refs：逐项失败 —— 一项坏了不影响同一批的成功项', async () => {
  const res = await call('POST', { projectId: 'proj', refs: ['n-ready', 'no-such-node', 'n-plain'] })
  assert.equal(res.status, 200, '有失败项也不是整体 4xx/5xx')
  const [first, second, third] = res.body.items
  assert.equal(first.handle, 'ref-7516d08b.png', '成功项必须照常返回')
  assert.equal(second.ref, 'no-such-node')
  assert.equal(typeof second.error?.code, 'string')
  assert.equal(typeof second.error?.message, 'string')
  assert.ok(second.error.message.length > 0, '失败必须带用户可读理由')
  assert.equal(third.handle, 'ref-a1b2c3d4.png', '失败项后面的成功项不能被吞掉')
})

test('REQ-003 resolve-refs：失败项的 message 不含开发者细节（路径 / detail）', async () => {
  const res = await call('POST', { projectId: 'proj', refs: ['no-such-node'] })
  const message = res.body.items[0].error.message
  assert.equal(message.includes('detail'), false, 'detail 是开发者字段，不该出现在用户文案里')
  assert.equal(/[A-Za-z]:\\|\/Users\/|\.ts\b/.test(message), false, `用户文案不该含路径/文件：${message}`)
})

test('REQ-003 resolve-refs：入参守卫（缺 projectId / refs 非数组 / 空 refs）', async () => {
  const bad = [
    {},
    { projectId: 'proj' },
    { projectId: 'proj', refs: 'n-ready' },
    { refs: ['n-ready'] },
    { projectId: '', refs: ['n-ready'] },
  ]
  for (const body of bad) {
    const res = await call('POST', body)
    assert.equal(res.status, 400, `入参 ${JSON.stringify(body)} 必须 400`)
  }
  // refs 里的非字符串项被忽略（而不是整批 400）—— UI 传错一格不该让整批失败。
  const res = await call('POST', { projectId: 'proj', refs: ['n-ready', 42, null, ''] })
  assert.equal(res.status, 200)
  assert.equal(res.body.items.length, 1)
  assert.equal(res.body.items[0].handle, 'ref-7516d08b.png')
})

test('REQ-003 resolve-refs：方法与权威守卫（GET 405 / 跨站 403）', async () => {
  const get = await call('GET', undefined)
  assert.equal(get.status, 405)

  const crossSite = await call('POST', { projectId: 'proj', refs: ['n-ready'] }, { origin: 'https://evil.example' })
  assert.equal(crossSite.status, 403)

  const noOrigin = await call('POST', { projectId: 'proj', refs: ['n-ready'] }, { origin: '' })
  assert.equal(noOrigin.status, 403, '缺 Origin 的同源写操作也必须拒')

  const noStore = await call('POST', { projectId: 'proj', refs: ['n-ready'] }, { 'sec-fetch-site': 'cross-site' })
  assert.equal(noStore.status, 403)
})
