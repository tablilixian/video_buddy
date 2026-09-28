/**
 * REQ-001 Step 3：全局资产库 HTTP 面契约测试（方案 §6.2「library-route」清单）。
 *
 * 没有现成的 HTTP 路由测试 harness，这里搭一个最小但**忠实**的分发器：
 *   - `ctx.webServer.register` 只收集路由（kind exact/prefix），
 *   - 真 `http.createServer` 按 `new URL(req.url).pathname` 归一化后做
 *     exact 优先、prefix 最长匹配（照 `dsh-host-webserver` 的分发口径），
 *   - 先 `listen(0)` 取到端口再设 `ctx.webServer.port` 后 `registerStudioRoutes`
 *     （`expectedPort` 在注册时捕获，authority 校验靠它）。
 * 分发之外的守卫（requestAllowed / mutationAllowed / 路径穿越 / 错误码出站）
 * 全部是被测代码本身。
 *
 * 锁住四组行为：
 *   1. CRUD：列表过滤、新建 201、重名 400+CS-LIB-002、详情 404+CS-LIB-001、
 *      PATCH 改名、DELETE 后详情 404、DELETE 缺 JSON 体 400；
 *   2. 锚点入库：节点缺失 → 400+CS-LIB-003；合法锚点 → 201 且媒体拷入；
 *   3. 权威守卫：跨站 / 伪造 Host / 无 Origin / 非同源 Origin 一律 403，
 *      且 403 响应体不泄漏库内容；
 *   4. 路径穿越与畸形编码：在**读到磁盘文档之前**就 4xx，响应体不含库文档内容。
 *
 * 运行：corepack yarn workspace canvas-studio build && corepack yarn workspace canvas-studio test:smoke
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AssetLibrary } from '../lib/asset-library.js'
import { registerStudioRoutes } from '../lib/routes.js'

/** 库文档里的哨兵串；任何穿越响应都不该把它带出来。 */
const CANARY = 'CANARY-穿越会露馅'

let harness = null

async function startHarness() {
  const root = await mkdtemp(join(tmpdir(), 'cs-libroute-'))
  const projDir = join(root, 'proj')
  const assetsDir = join(projDir, 'assets')
  const sourceDir = join(root, 'sources')
  await mkdir(assetsDir, { recursive: true })
  await mkdir(sourceDir, { recursive: true })
  const nodeFile = 'node-a.png'
  await writeFile(join(assetsDir, nodeFile), Buffer.from('node-png-bytes'))
  const sourcePath = join(sourceDir, 'front.png')
  await writeFile(sourcePath, Buffer.from('library-png-bytes'))

  const library = new AssetLibrary(join(root, 'library-root'))
  const seeded = await library.create({
    category: 'character',
    name: CANARY,
    media: [{ sourcePath, label: '正视图' }],
  })

  const registry = {
    list: async () => [{ id: 'p1', name: 'P1', dir: projDir, createdAt: 1 }],
    getProject: async () => ({ workflow: { mode: 'auto', state: 'idle' } }),
    assetsDir: () => assetsDir,
    readCanvas: async () => ({
      version: 4,
      nodes: [{
        id: 'node-a',
        kind: 'image',
        title: '正面特写',
        url: `/canvas-studio/assets/p1/${nodeFile}`,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        createdAt: 1,
        origin: 'manual',
        sourceIds: [],
      }],
    }),
    writeCanvas: async () => {},
    appendCanvasNode: async () => {},
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
  const dispose = registerStudioRoutes(ctx, registry, library)

  return {
    root,
    library,
    seeded,
    port: ctx.webServer.port,
    origin: `http://127.0.0.1:${ctx.webServer.port}`,
    async close() {
      dispose()
      // undici 会复用 keep-alive 连接；不先掐掉的话 server.close 会一直等它们。
      server.closeIdleConnections?.()
      server.closeAllConnections?.()
      await new Promise((resolve) => { server.close(resolve) })
      await rm(root, { recursive: true, force: true })
    },
  }
}

/** 发一次请求并读回 status / headers / 文本 / 解析后的 JSON（二进制也留一份）。 */
async function call(path, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(`http://127.0.0.1:${harness.port}${path}`, {
    method,
    headers: { ...headers },
    ...(body !== undefined
      ? { body: typeof body === 'string' ? body : JSON.stringify(body) }
      : {}),
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  const text = buffer.toString('utf8')
  let json = null
  try { json = JSON.parse(text) } catch { json = null }
  return { status: response.status, headers: response.headers, text, json, buffer }
}

/** 同上，但可自定义 Host 头（authority 伪造用例走原生 http.request）。 */
function rawRequest(path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port: harness.port,
      path,
      method,
      headers,
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const buffer = Buffer.concat(chunks)
        const text = buffer.toString('utf8')
        let json = null
        try { json = JSON.parse(text) } catch { json = null }
        resolve({ status: res.statusCode, headers: res.headers, text, json, buffer })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

before(async () => {
  harness = await startHarness()
})

after(async () => {
  if (harness != null) await harness.close()
})

// ---------------------------------------------------------------------------
// 1. CRUD
// ---------------------------------------------------------------------------
test('REQ-001 库路由：列表过滤（category/q）与非法分类 400', async () => {
  const empty = await call('/canvas-studio/library')
  assert.equal(empty.status, 200)
  assert.deepEqual(empty.json.assets.map((entry) => entry.name), [CANARY])

  const created = await call('/canvas-studio/library', {
    method: 'POST',
    headers: { origin: harness.origin },
    body: { category: 'scene', name: '雨夜巷弄', aliases: ['巷子'], description: '湿漉漉的霓虹' },
  })
  assert.equal(created.status, 201, created.text)
  assert.equal(created.json.asset.name, '雨夜巷弄')
  assert.ok(created.json.asset.id.length > 0)

  const onlyScene = await call('/canvas-studio/library?category=scene')
  assert.deepEqual(onlyScene.json.assets.map((entry) => entry.name), ['雨夜巷弄'])

  const onlyCharacter = await call('/canvas-studio/library?category=character')
  assert.deepEqual(onlyCharacter.json.assets.map((entry) => entry.name), [CANARY])

  const search = await call(`/canvas-studio/library?q=${encodeURIComponent('霓虹')}`)
  assert.deepEqual(search.json.assets.map((entry) => entry.name), ['雨夜巷弄'])

  const noHit = await call(`/canvas-studio/library?q=${encodeURIComponent('不存在的名字')}`)
  assert.deepEqual(noHit.json.assets, [])

  const badCategory = await call('/canvas-studio/library?category=bogus')
  assert.equal(badCategory.status, 400)
  assert.match(badCategory.json.error, /分类/u)
})

test('REQ-001 库路由：重名 400+CS-LIB-002，非法分类 / 缺名称 400', async () => {
  const duplicate = await call('/canvas-studio/library', {
    method: 'POST',
    headers: { origin: harness.origin },
    body: { category: 'character', name: CANARY },
  })
  assert.equal(duplicate.status, 400)
  assert.equal(duplicate.json.code, 'CS-LIB-002')
  assert.match(duplicate.json.error, /已有同名资产/u)

  const badCategory = await call('/canvas-studio/library', {
    method: 'POST',
    headers: { origin: harness.origin },
    body: { category: 'bogus', name: '新资产' },
  })
  assert.equal(badCategory.status, 400)
  assert.equal(badCategory.json.code, undefined, '形状类校验用 CS-USER-ERR 走 {error}，不占错误码')

  const noName = await call('/canvas-studio/library', {
    method: 'POST',
    headers: { origin: harness.origin },
    body: { category: 'prop' },
  })
  assert.equal(noName.status, 400)
  assert.match(noName.json.error, /名称/u)
})

test('REQ-001 库路由：详情 / 改名 / 删除 与未知 id 404+CS-LIB-001', async () => {
  const created = await call('/canvas-studio/library', {
    method: 'POST',
    headers: { origin: harness.origin },
    body: { category: 'group', name: '路人甲乙' },
  })
  assert.equal(created.status, 201, created.text)
  const id = created.json.asset.id

  const detail = await call(`/canvas-studio/library/${id}`)
  assert.equal(detail.status, 200)
  assert.equal(detail.json.asset.name, '路人甲乙')

  const patched = await call(`/canvas-studio/library/${id}`, {
    method: 'PATCH',
    headers: { origin: harness.origin },
    body: { name: '围观群众', aliases: ['路人'] },
  })
  assert.equal(patched.status, 200, patched.text)
  assert.equal(patched.json.asset.name, '围观群众')
  assert.deepEqual(patched.json.asset.aliases, ['路人'])
  assert.ok(patched.json.asset.updatedAt >= detail.json.asset.updatedAt, 'updatedAt 应前进')

  const badPatch = await call(`/canvas-studio/library/${id}`, {
    method: 'PATCH',
    headers: { origin: harness.origin },
    body: { category: 'bogus' },
  })
  assert.equal(badPatch.status, 400)

  const deleted = await call(`/canvas-studio/library/${id}`, {
    method: 'DELETE',
    headers: { origin: harness.origin },
    body: {},
  })
  assert.equal(deleted.status, 200, deleted.text)
  assert.deepEqual(deleted.json, { ok: true })

  const afterDelete = await call(`/canvas-studio/library/${id}`)
  assert.equal(afterDelete.status, 404)
  assert.equal(afterDelete.json.code, 'CS-LIB-001')

  const unknown = await call('/canvas-studio/library/00000000-0000-0000-0000-000000000000')
  assert.equal(unknown.status, 404)
  assert.equal(unknown.json.code, 'CS-LIB-001')
  assert.equal(unknown.json.error, '该资产不存在或已被删除。', 'user 受众错误出站要用 catalog 文案')
})

test('REQ-001 库路由：DELETE 缺 JSON 体 400（不静默当成功）', async () => {
  const created = await call('/canvas-studio/library', {
    method: 'POST',
    headers: { origin: harness.origin },
    body: { category: 'prop', name: '待删物件' },
  })
  assert.equal(created.status, 201)
  const id = created.json.asset.id

  const bare = await call(`/canvas-studio/library/${id}`, {
    method: 'DELETE',
    headers: { origin: harness.origin },
  })
  assert.equal(bare.status, 400, 'readJson 空体应判 invalid json')

  const stillThere = await call(`/canvas-studio/library/${id}`)
  assert.equal(stillThere.status, 200, '没删成，条目必须还在')
})

// ---------------------------------------------------------------------------
// 2. 锚点入库
// ---------------------------------------------------------------------------
test('REQ-001 库路由：锚点入库（合法 201 + 媒体拷入；节点缺失 400+CS-LIB-003）', async () => {
  const good = await call('/canvas-studio/library', {
    method: 'POST',
    headers: { origin: harness.origin },
    body: {
      category: 'character',
      name: '锚点入库角色',
      aliases: ['锚点'],
      anchors: [{ projectId: 'p1', nodeId: 'node-a' }],
    },
  })
  assert.equal(good.status, 201, good.text)
  assert.deepEqual(good.json.asset.anchors, [{ projectId: 'p1', nodeId: 'node-a' }])
  assert.equal(good.json.asset.media.length, 1, '锚点媒体应被拷入库')
  assert.equal(good.json.asset.media[0].kind, 'image')

  const mediaBytes = await call(`/canvas-studio/library/${good.json.asset.id}/${good.json.asset.media[0].file}`)
  assert.equal(mediaBytes.status, 200)
  assert.match(mediaBytes.headers.get('content-type'), /image\/png/u)
  assert.equal(mediaBytes.buffer.toString('utf8'), 'node-png-bytes', '媒体字节应等于锚点节点的本地资产')

  const seededMedia = await call(`/canvas-studio/library/${harness.seeded.id}/${harness.seeded.media[0].file}`)
  assert.equal(seededMedia.status, 200)
  assert.equal(seededMedia.buffer.toString('utf8'), 'library-png-bytes', '手工入库的媒体字节应与源文件一致')

  const missingNode = await call('/canvas-studio/library', {
    method: 'POST',
    headers: { origin: harness.origin },
    body: { category: 'scene', name: '坏锚点场景', anchors: [{ projectId: 'p1', nodeId: 'nope' }] },
  })
  assert.equal(missingNode.status, 400)
  assert.equal(missingNode.json.code, 'CS-LIB-003')

  const appendMissing = await call(`/canvas-studio/library/${good.json.asset.id}/anchors`, {
    method: 'POST',
    headers: { origin: harness.origin },
    body: { projectId: 'p1', nodeId: 'nope' },
  })
  assert.equal(appendMissing.status, 400)
  assert.equal(appendMissing.json.code, 'CS-LIB-003')

  const badAnchor = await call(`/canvas-studio/library/${good.json.asset.id}/anchors`, {
    method: 'POST',
    headers: { origin: harness.origin },
    body: { projectId: 'p1' },
  })
  assert.equal(badAnchor.status, 400)
  assert.match(badAnchor.json.error, /projectId/u)
})

test('REQ-001 库路由：媒体端点未知文件 / 未知资产 404', async () => {
  const missingFile = await call(`/canvas-studio/library/${harness.seeded.id}/not-here.png`)
  assert.equal(missingFile.status, 404)

  const missingAsset = await call('/canvas-studio/library/00000000-0000-0000-0000-000000000000/m_0.png')
  assert.equal(missingAsset.status, 404)
})

// ---------------------------------------------------------------------------
// 3. 权威守卫
// ---------------------------------------------------------------------------
test('REQ-001 库路由：跨站 / 伪造 Host / 无 Origin / 非同源 Origin 一律 403', async () => {
  const crossSite = await call('/canvas-studio/library', { headers: { 'sec-fetch-site': 'cross-site' } })
  assert.equal(crossSite.status, 403)
  assert.ok(!crossSite.text.includes(CANARY), '403 不许带出库内容')

  const forgedHost = await rawRequest('/canvas-studio/library', { headers: { host: 'evil.example' } })
  assert.equal(forgedHost.status, 403)
  assert.ok(!forgedHost.text.includes(CANARY))

  const noOrigin = await call('/canvas-studio/library', {
    method: 'POST',
    body: { category: 'prop', name: '越权新建' },
  })
  assert.equal(noOrigin.status, 403)
  assert.match(noOrigin.json.error, /same-origin/u)

  const evilOrigin = await call('/canvas-studio/library', {
    method: 'POST',
    headers: { origin: 'http://evil.example' },
    body: { category: 'prop', name: '越权新建' },
  })
  assert.equal(evilOrigin.status, 403)

  const httpsOrigin = await call('/canvas-studio/library', {
    method: 'POST',
    headers: { origin: `https://127.0.0.1:${harness.port}` },
    body: { category: 'prop', name: '越权新建' },
  })
  assert.equal(httpsOrigin.status, 403, 'Origin 协议必须是 http:')

  const forbidden = await call(`/canvas-studio/library?q=${encodeURIComponent(CANARY)}`, {
    headers: { 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(forbidden.status, 403)

  const list = await call('/canvas-studio/library')
  assert.ok(
    !list.json.assets.some((entry) => entry.name === '越权新建'),
    '被 403 的写请求不应落库',
  )
})

// ---------------------------------------------------------------------------
// 4. 路径穿越 / 畸形编码 / 方法不匹配
// ---------------------------------------------------------------------------
test('REQ-001 库路由：路径穿越在读盘之前 4xx，响应体不含库文档内容', async () => {
  const guarded = async (path) => {
    const response = await call(path)
    assert.ok(!response.text.includes(CANARY), `穿越 ${path} 不得带出库文档`)
    assert.ok(!response.text.includes('assets-library'), `穿越 ${path} 不得带出注册表文件`)
    return response
  }

  // 能真正到达库路由的穿越形态（`..%2F` 不是 URL 层的 double-dot 段，原样透传）：
  // decode 后 parts=['..','<file>'] → 字符集守卫先 400，绝不进读盘分支。
  const nested = await guarded('/canvas-studio/library/..%2Fassets-library.json')
  assert.equal(nested.status, 400, nested.text)
  assert.match(nested.json.error, /非法的媒体路径/u)

  // 三段 / 四段：不落进任何已知分支 → 404，也不进详情/媒体读盘。
  const three = await guarded(`/canvas-studio/library/${harness.seeded.id}/..%2Fassets-library.json`)
  assert.equal(three.status, 404, three.text)
  const climb = await guarded('/canvas-studio/library/..%2F..%2Fassets-library.json')
  assert.equal(climb.status, 404, climb.text)

  // 畸形百分号编码：decodeURIComponent 抛 → 400，且不把 URIError 原文外泄。
  const malformed = await guarded('/canvas-studio/library/%E0%A4%A')
  assert.equal(malformed.status, 400, malformed.text)
  assert.match(malformed.json.error, /malformed library path/u)

  // 点文件 / 点段 id（能到达详情分支的形态）：字符集守卫 400。
  const dotted = await guarded('/canvas-studio/library/...')
  assert.equal(dotted.status, 400, dotted.text)
  assert.match(dotted.json.error, /非法的资产 id/u)
  const hidden = await guarded('/canvas-studio/library/.hidden')
  assert.equal(hidden.status, 400, hidden.text)

  // `.` / `..` / `%2e%2e` 属 URL 层 double-dot 段，请求到达前就被归一化出 prefix
  // → 根本不进库路由（也就读不到库文档）。
  for (const path of [
    '/canvas-studio/library/.%2e',
    '/canvas-studio/library/%2e%2e',
    '/canvas-studio/library/../assets-library.json',
  ]) {
    const response = await guarded(path)
    assert.notEqual(response.status, 200, `${path} 不应读到库文档`)
  }

  // 相对上级目录不是前缀子路径，任何形态都不该命中库路由。
  const notAPrefixChild = await guarded('/canvas-studio/libraryfoo')
  assert.equal(notAPrefixChild.status, 404, notAPrefixChild.text)
})

test('REQ-001 库路由：方法/路径不匹配 405', async () => {
  const patchList = await call('/canvas-studio/library', {
    method: 'PATCH',
    headers: { origin: harness.origin },
    body: { name: 'x' },
  })
  assert.equal(patchList.status, 405, patchList.text)

  const deleteList = await call('/canvas-studio/library', {
    method: 'DELETE',
    headers: { origin: harness.origin },
    body: {},
  })
  assert.equal(deleteList.status, 405, deleteList.text)

  const patchDeep = await call(`/canvas-studio/library/${harness.seeded.id}/extra`, {
    method: 'PATCH',
    headers: { origin: harness.origin },
    body: { name: 'x' },
  })
  assert.equal(patchDeep.status, 405, patchDeep.text)
})

test('REQ-001 库路由：媒体文件确实落在库目录（磁盘真相核对）', async () => {
  const onDisk = await readFile(
    join(harness.root, 'library-root', 'library', harness.seeded.id, 'm_0.png'),
    'utf8',
  )
  assert.equal(onDisk, 'library-png-bytes')
})
