/**
 * 实扣回填（generationId → 真实消耗）：Host 解析 + 接线纪律（2026-11-24）。
 *
 * 锁的是**「这一笔到底花了多少，只能来自账本」**：
 *   1. 金额从 `credits/ledger` 的 `commit` 条目取（绝对值）；`hold` 是冻结、`release`
 *      是退回，都不能当消耗；
 *   2. 查不到就是 `unknown`（不是 0），登记过但服务端还没结算才是 `pending`；
 *   3. 非 UUID 的 id（legacy 的 ComfyUI 产物名 / fal 请求基址）**不发请求**；
 *   4. 节点只存 `generationId`，**不存金额**（第二本账必然与退款后的账本漂移）；
 *      并且 client 保存画布时不能把它冲掉（否则拖一下画布消耗就消失）。
 *
 * 运行：corepack yarn build && corepack yarn test:smoke
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerStudioRoutes } from '../lib/routes.js'
import { installAccountState, notifyAuthCleared, markGenerationSpendPending } from '../lib/account-state.js'
import { setAuthSession, clearAuthSession } from '../lib/auth-session.js'
import { ProjectRegistry } from '../lib/projects.js'

const SPEND_PATH = '/canvas-studio/account/spend'
const GEN = 'ff2da005-32a5-42ec-b17d-6dc7f8421f36'
const GEN_HOLD_ONLY = '0b9e6f3a-1c2d-4e5f-8a9b-0c1d2e3f4a5b'

let harness = null
let fetchCalls = []
/** 服务端返回的流水页（每个 test 可改写）。 */
let ledgerPage = { entries: [], next_cursor: null }

const commitEntry = (id, entryType, amount, generationId) => ({
  id,
  entry_type: entryType,
  amount,
  lot_id: 'lot-1',
  ...(generationId === undefined ? {} : { generation_id: generationId }),
  lot_balance_after: 798.9729,
  created_at: '2026-11-24T11:18:46.716+08:00',
})

function installFetchStub() {
  const original = globalThis.fetch
  globalThis.fetch = async (url) => {
    const href = String(url)
    fetchCalls.push(href)
    if (href.includes('/v1/credits/ledger')) {
      return new Response(JSON.stringify(ledgerPage), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
  }
  return () => { globalThis.fetch = original }
}

function resetAll() {
  clearAuthSession()
  notifyAuthCleared()
  fetchCalls = []
  ledgerPage = { entries: [], next_cursor: null }
}

async function startHarness() {
  const root = await mkdtemp(join(tmpdir(), 'cs-gen-spend-'))
  const routes = []
  const ctx = {
    webServer: { port: 0, register: (route) => { routes.push(route); return () => {} } },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  }
  const registry = {
    registryRoot: root,
    projectsRoot: join(root, 'projects'),
    async list() { return [] },
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
  const port = server.address().port
  ctx.webServer.port = port
  const dispose = registerStudioRoutes(ctx, registry, {})
  return { server, port, dispose, root }
}

function call(method, { path = SPEND_PATH, body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body)
    const req = httpRequest({
      host: '127.0.0.1',
      port: harness.port,
      method,
      path,
      agent: false,
      headers: {
        host: `127.0.0.1:${harness.port}`,
        origin: `http://127.0.0.1:${harness.port}`,
        'sec-fetch-site': 'same-origin',
        ...(payload === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }),
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
    if (payload !== null) req.write(payload)
    req.end()
  })
}

function installDeps() {
  installAccountState({
    enabled: () => true,
    businessApiBase: () => 'http://business.test',
    device: { deviceId: () => 'dev-1', platform: () => 'darwin', appVersion: () => '1.0.0' },
    log: { info() {}, warn() {} },
    onSessionToken: () => {},
    onCatalogChanged: () => {},
  })
}

const signIn = () => setAuthSession({ accessToken: 'tok-1', expiresAt: null, userId: 'u-1', email: null })

before(async () => { harness = await startHarness() })

after(async () => {
  harness.dispose()
  harness.server.closeIdleConnections()
  harness.server.closeAllConnections()
  await new Promise((resolve) => harness.server.close(resolve))
  await rm(harness.root, { recursive: true, force: true })
})

test('spend：commit 的绝对值就是实扣（hold 同 id 但不算消耗）', async () => {
  resetAll()
  const restore = installFetchStub()
  installDeps()
  try {
    signIn()
    ledgerPage = {
      entries: [
        commitEntry(42310, 'commit', -21.1354, GEN),
        commitEntry(42309, 'hold', -21.1354, GEN),
      ],
      next_cursor: null,
    }
    const res = await call('POST', { body: { ids: [GEN] } })
    assert.equal(res.status, 200)
    assert.equal(res.body.credits[GEN], 21.1354, 'commit 是负数，展示口径取绝对值')
    assert.deepEqual(res.body.pending, [], '对上了就不是 pending')
    assert.equal(res.body.error, null)
  } finally {
    restore()
    resetAll()
  }
})

test('spend：只有 hold 时是 pending（不是 0，也不是 unknown）', async () => {
  resetAll()
  const restore = installFetchStub()
  installDeps()
  try {
    signIn()
    // 登记过（生成刚结束）才会被判成 pending —— 没登记过的同形 id 是 unknown。
    markGenerationSpendPending(GEN_HOLD_ONLY)
    ledgerPage = { entries: [commitEntry(42311, 'hold', -30, GEN_HOLD_ONLY)], next_cursor: null }
    const res = await call('POST', { body: { ids: [GEN_HOLD_ONLY] } })
    assert.equal(res.status, 200)
    assert.equal(res.body.credits[GEN_HOLD_ONLY], undefined, '冻结不是消耗，绝不能给一个数字')
    assert.deepEqual(res.body.pending, [GEN_HOLD_ONLY], 'UI 要能显示「结算中」而不是「—」')
  } finally {
    restore()
    resetAll()
  }
})

test('spend：release 不算消耗（任务失败退回后不该留一个金额）', async () => {
  resetAll()
  const restore = installFetchStub()
  installDeps()
  try {
    signIn()
    ledgerPage = {
      entries: [
        commitEntry(42312, 'release', 0, GEN),
        commitEntry(42311, 'hold', -30, GEN),
      ],
      next_cursor: null,
    }
    const res = await call('POST', { body: { ids: [GEN] } })
    assert.equal(res.body.credits[GEN], undefined, 'release 是退回，credits 里不能出现这个 id')
  } finally {
    restore()
    resetAll()
  }
})

test('spend：同 id 多条 commit 取绝对值最大（不求和，避免重复条目翻倍）', async () => {
  resetAll()
  const restore = installFetchStub()
  installDeps()
  try {
    signIn()
    ledgerPage = {
      entries: [
        commitEntry(42320, 'commit', -21.1354, GEN),
        commitEntry(42319, 'commit', -21.1354, GEN),
      ],
      next_cursor: null,
    }
    const res = await call('POST', { body: { ids: [GEN] } })
    assert.equal(res.body.credits[GEN], 21.1354, '两条相同 commit 是重复记账，不是 42.27')
  } finally {
    restore()
    resetAll()
  }
})

test('spend：非 UUID 的 id 一个请求都不发（legacy 产物名不是 generation id）', async () => {
  resetAll()
  const restore = installFetchStub()
  installDeps()
  try {
    signIn()
    const res = await call('POST', { body: { ids: ['MiniMax_H3_20261124.mp4', 'ref-abc123', ''] } })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.credits, {})
    assert.equal(fetchCalls.length, 0, '流水里永远匹配不到这些值，发请求是白花一次往返')
  } finally {
    restore()
    resetAll()
  }
})

test('spend：未登录回 200 + 空（零请求，UI 不显示数字）', async () => {
  resetAll()
  const restore = installFetchStub()
  installDeps()
  try {
    const res = await call('POST', { body: { ids: [GEN] } })
    assert.equal(res.status, 200)
    assert.equal(res.body.signedIn, false)
    assert.deepEqual(res.body.credits, {})
    assert.equal(fetchCalls.length, 0)
  } finally {
    restore()
    resetAll()
  }
})

test('spend：缺 ids 400 / GET 405 / 跨站 403（守卫拦下的不打业务接口）', async () => {
  resetAll()
  const restore = installFetchStub()
  installDeps()
  signIn()
  try {
    assert.equal((await call('POST', { body: {} })).status, 400, '没有 ids 是调用方搞错接口')
    assert.equal((await call('POST', { body: { ids: 'x' } })).status, 400, 'ids 必须是数组')
    assert.equal((await call('GET')).status, 405)
    const crossSite = await call('POST', { body: { ids: [GEN] }, headers: { 'sec-fetch-site': 'cross-site' } })
    assert.equal(crossSite.status, 403)
    assert.equal(fetchCalls.length, 0)
  } finally {
    restore()
    resetAll()
  }
})

test('spend：流水读取失败也回 200（查不到是常态，不是异常）', async () => {
  resetAll()
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response('{"error":{"code":"internal"}}', {
    status: 500,
    headers: { 'content-type': 'application/json' },
  })
  installDeps()
  try {
    signIn()
    const res = await call('POST', { body: { ids: [GEN] } })
    assert.equal(res.status, 200, '账务面故障不该让画布上的角标变成错误')
    assert.deepEqual(res.body.credits, {})
    assert.notEqual(res.body.error, null, '失败要带出来，UI 才知道这是「读不到」不是「没花钱」')
  } finally {
    globalThis.fetch = original
    resetAll()
  }
})

// ── 接线纪律（源码断言：这几条一旦被改回去，上面的行为测试都还是绿的）─────────

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8')

test('接线：节点只存 generationId，不存金额（金额必须每次从账本派生）', async () => {
  const contract = await read('src/contracts/canvas.ts')
  assert.match(contract, /generationId\?: string/, '节点契约要有 generationId')
  assert.doesNotMatch(contract, /^\s{2}credits\?: number/m, '节点不得存金额：退款后它不会跟着归零')
  const generate = await read('src/generate.ts')
  assert.match(generate, /generationId = outcome\.generationId/, '图片/视频链路要取业务 API 的生成 id')
  assert.match(generate, /\.\.\.\(generationId !== undefined \? \{ generationId \} : \{\}\)/, '新节点要落 generationId')
  assert.match(generate, /generationId: sheet\.generationId/, '角色四视图（固定价 30）同样要落 id')
  assert.match(generate, /musicGenerationId = final\.id/, '音乐取**成功那次**的 id（重试期间 500 的那几次没有产物）')
  assert.match(generate, /generationId: final\.id,/, '配音（固定价）同样要落 id')
})

test('接线（行为）：client 保存画布不冲掉 Host 写的 generationId', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-gen-spend-canvas-'))
  try {
    const registry = new ProjectRegistry(root)
    const project = await registry.create('实扣保护')
    const hostNode = {
      id: 'n1',
      kind: 'image',
      url: '/canvas-studio/assets/x/n1.png',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      createdAt: 1,
      origin: 'agent',
      sourceIds: [],
      generationId: GEN,
    }
    await registry.writeCanvas(project.id, [hostNode])
    // client 侧内存副本**不认识**这个字段（渲染层没有它的读写路径），拖一下画布
    // 回写时自然就不带它 —— 这正是要防的那一步。
    const { generationId: _dropped, ...clientNode } = hostNode
    await registry.writeCanvas(project.id, [clientNode], undefined, undefined, { author: 'client' })
    const back = (await registry.readCanvas(project.id)).nodes
    assert.equal(back.length, 1)
    assert.equal(back[0].generationId, GEN, '拖一下画布不该把实扣的唯一索引键冲掉')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('接线：卡面角标与详情行都读 same 一份 spend-store（不各写一套）', async () => {
  const card = await read('src/client/canvas/CanvasNode.tsx')
  const drawer = await read('src/client/canvas/NodeDetailDrawer.tsx')
  assert.match(card, /useGenerationSpend\(node\.generationId\)/, '卡面角标要按 generationId 读实扣')
  assert.match(drawer, /useGenerationSpend\(node\.generationId\)/, '详情面板同一份读法')
  assert.match(drawer, /结算中…/, 'pending 必须说出来（不能显示成 0 或 —）')
  const store = await read('src/client/spend-store.ts')
  assert.match(store, /MERGE_WINDOW_MS/, '必须合并批量请求（一屏几十个节点各发一次就是几十次往返）')
})

test('接线：生成结果文本拿到实扣要改写，拿不到保留预估', async () => {
  const generate = await read('src/generate.ts')
  const settle = await read('src/credit-settle.ts')
  assert.match(generate, /noteGenerationSettled\(/, '生成成功后要按流水改写「预估消耗」那句')
  assert.match(generate, /estimateCreditNote\(estimated\)/, '提交时只能写「预估」（这一刻服务端还没结算）')
  assert.match(settle, /本次生成实际消耗 \$\{round\(spent\)\}/, '实扣文案要明说「实际」')
  assert.match(settle, /SPEND_LOOKUP_TIMEOUT_MS/, '查账要有上限：不能让它拖慢一次已经成功的生成')
  // 替换而不是追加：同一笔钱在结果文本里只该有一句陈述。
  assert.match(settle, /warnings\[index\] = /, '必须就地替换那条 warning，不能两条并存')
})

test('接线：账务页有积分流水段（金额 4 位小数，不取整）', async () => {
  const page = await read('src/client/BillingPage.tsx')
  assert.match(page, /积分流水/, '订阅与积分页要有流水段')
  assert.match(page, /ENTRY_LABELS/, '条目类型要翻译成中文，未知类型原样显示')
  assert.match(page, /toFixed\(4\)/, '账本金额不能取整（−21.1354 显示成 −21 就对不上余额）')
  assert.match(page, /refreshLedger\(false, true\)/, '要有「加载更早的记录」')
})
