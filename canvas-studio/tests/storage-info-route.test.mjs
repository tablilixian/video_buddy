/**
 * storage-info 只读诊断路由的 HTTP 面契约（REQ-021 R001 后续·方案 B）。
 *
 * 锁住四组行为：
 *   1. 响应形状：`{ root, projectsDir, drafts: { total, empty, nonEmpty }, projects: [{ name, dirBasename }] }`；
 *   2. draft 统计口径：已认领铸名目录（= 正式项目目录）归非空侧；未认领 + 全空
 *      才是「空」（清扫可回收候选）；`.draft-` 前缀之外的常规项目目录不进统计；
 *   3. 目录缺失降级：projects 目录不存在按「零堆积」收场（诊断面不致命）；
 *   4. 权威 / 方法守卫：跨站 403、POST 405（只读 ⇒ requestAllowed 即可）。
 *
 * 运行：corepack yarn build && corepack yarn test:smoke
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerStudioRoutes } from '../lib/routes.js'

const PATH = '/canvas-studio/storage-info'

let harness = null

async function startHarness({ createProjectsDir = true } = {}) {
  const harnessRoot = await mkdtemp(join(tmpdir(), 'cs-storage-info-'))
  const projectsDir = join(harnessRoot, 'projects')
  if (createProjectsDir) {
    await mkdir(projectsDir, { recursive: true })
    // 两个已认领项目（铸名目录 + 常规名目录各一）+ 一个空的未认领 draft + 一个有残留的未认领 draft。
    const claimedDraft = join(projectsDir, '.draft-202610-04221026')
    const claimedRegular = join(projectsDir, '揽月湾日出咖啡')
    const emptyDraft = join(projectsDir, '.draft-202610-05180701')
    const residueDraft = join(projectsDir, '.draft-202609-2')
    for (const dir of [claimedDraft, claimedRegular, emptyDraft, residueDraft]) await mkdir(dir, { recursive: true })
    await mkdir(join(claimedRegular, 'assets'), { recursive: true })
    // 有残留的未认领 draft：真放一个文件，否则它就是「空」侧的了。
    await writeFile(join(residueDraft, 'canvas.json'), '{}')
  }
  const projects = [
    { id: 'p-claimed', name: '揽月湾日出咖啡', dir: join(projectsDir, '.draft-202610-04221026') },
    { id: 'p-regular', name: '共工祝融', dir: join(projectsDir, '揽月湾日出咖啡') },
  ]
  const routes = []
  let port = 0
  const ctx = {
    webServer: { port, register: (route) => { routes.push(route); return () => {} } },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  }
  const registry = {
    registryRoot: harnessRoot,
    projectsRoot: projectsDir,
    async list() { return projects },
    // routes 注册时会 fire-and-forget 一次启动清扫（REQ-005 v1.3）—— 假 registry 也要接住。
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
  return {
    server, port, dispose, root: harnessRoot, projectsDir,
    claimedDraftBasename: '.draft-202610-04221026',
    claimedRegularBasename: '揽月湾日出咖啡',
  }
}

function call(method, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port: harness.port,
      method,
      path: PATH,
      agent: false,
      headers: {
        host: `127.0.0.1:${harness.port}`,
        origin: `http://127.0.0.1:${harness.port}`,
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
    req.end()
  })
}

async function stopHarness(instance) {
  instance.dispose()
  instance.server.closeIdleConnections()
  instance.server.closeAllConnections()
  await new Promise((resolve) => instance.server.close(resolve))
  await rm(instance.root, { recursive: true, force: true })
}

before(async () => { harness = await startHarness() })
after(async () => { await stopHarness(harness) })

test('storage-info：响应形状与 draft 统计口径（已认领归非空、未认领空目录才算空）', async () => {
  const res = await call('GET')
  assert.equal(res.status, 200)
  assert.equal(res.body.root, harness.root)
  assert.equal(res.body.projectsDir, harness.projectsDir)
  assert.deepEqual(res.body.drafts, { total: 3, empty: 1, nonEmpty: 2 },
    'draft 统计 = 2 个已认领铸名目录（非空侧）+ 1 个未认领空目录；有残留的未认领目录也是非空侧')
  assert.deepEqual(res.body.projects, [
    { name: '揽月湾日出咖啡', dirBasename: '.draft-202610-04221026' },
    { name: '共工祝融', dirBasename: '揽月湾日出咖啡' },
  ], '项目对照 = registry 记录的名称 → 目录 basename（认领不改名的可见化）')
})

test('storage-info：方法与权威守卫（POST 405 / 跨站 403）', async () => {
  const post = await call('POST')
  assert.equal(post.status, 405)

  const crossSite = await call('GET', { 'sec-fetch-site': 'cross-site' })
  assert.equal(crossSite.status, 403)
})

test('storage-info：projects 目录缺失按零堆积收场（诊断面不致命）', async () => {
  const alt = await startHarness({ createProjectsDir: false })
  try {
    // 替换 harness 指针复用 call()：请求打到缺失目录的实例上。
    const main = harness
    harness = alt
    try {
      const res = await call('GET')
      assert.equal(res.status, 200, '目录缺失也必须 200（诊断面降级，不抛错）')
      assert.deepEqual(res.body.drafts, { total: 0, empty: 0, nonEmpty: 0 })
      assert.deepEqual(res.body.projects, [
        { name: '揽月湾日出咖啡', dirBasename: alt.claimedDraftBasename },
        { name: '共工祝融', dirBasename: alt.claimedRegularBasename },
      ], 'registry 记录照常返回（登记与磁盘现状解耦）')
    } finally {
      harness = main
    }
  } finally {
    await stopHarness(alt)
  }
})
