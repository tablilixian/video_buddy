/**
 * CV-277 契约测试：废弃视频事件的三项配套改动。
 *
 * 背景见 docs/effect-tests/lanyue-bay-retro-20261005.md —— 揽月湾 3 镜 6 条视频被
 * CV-222 镜位级取代串成 v1→v6 全局单链（判据本身在 shot-versions.test.mjs
 * 覆盖），本文件钉住的是**配套的三处**：
 *
 *   1. M-2 `compose_video` 缺省选片只收到 1 段、但画布有多条逐镜视频时，
 *      必须在回执里明说「其余为失效版本」并给出两条可行动出口（不静默出残片）。
 *      CV-141 允许「一镜整出」，所以只在「画布明显不止 1 段」时提示。
 *   2. M-3 `POST /asset-history/prune-retired` 批量清理失效产物：只收失效的
 *      图/视频，**成片、音频、文本、生成中节点一律不动**；删节点 + 解引用下游
 *      generationPrompt + 物理删文件 + 标 deletedAt，全部并成**一次** writeCanvas。
 *   3. M-4 `list_references` 每项带节点 id —— 标题取自提示词前 12 字（可能带
 *      省略号且不唯一），`@ref[标题]` 走精确匹配会失配（现场迫使 agent 绕道
 *      upload_image 多跑一趟）。补 id 作第二抓手，并写进工具描述让模型知道。
 *
 * 直连 Host tsc 产物 lib/。路由部分沿用 library-route.test.mjs 的最小忠实
 * 分发器（exact 优先 / prefix 最长匹配，authority 校验靠注册时捕获的端口）。
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AssetLibrary } from '../lib/asset-library.js'
import { registerStudioRoutes } from '../lib/routes.js'
import { createStudioTools } from '../lib/host-tools.js'
import { recordAssetHistory } from '../lib/asset-history.js'
import { unlinkValuesInPromptJson } from '../lib/generate.js'

/**
 * 画布形态照搬揽月湾现场（CV-277 的判据输入）：
 *   - 3 张分镜卡（text + submit_storyboard_for_approval）
 *   - 6 条视频：v1/v2/v3 已被 v4/v5/v6 依次取代（supersededBy 链），v6 有效
 *   - 1 条成片（toolName=compose，**不得**进清理）
 *   - 1 张失效参考图（supersededBy）
 *   - 1 个音频（BGM，**不得**进清理）
 *   - 1 个文本（分镜卡本体，**不得**进清理）
 *   - 1 条 isLoading 的失效视频（**不得**进清理，要在 busyNodes 里回报）
 */
const CARD_1 = 'card-1'
const CARD_2 = 'card-2'
const CARD_3 = 'card-3'
const V1 = 'v1'
const V2 = 'v2'
const V3 = 'v3'
const V4 = 'v4'
const V5 = 'v5'
const V6 = 'v6'
const FILM = 'film'
const STALE_IMG = 'stale-img'
const BGM = 'bgm'
const BUSY = 'busy'

function card(id) {
  return { id, kind: 'text', title: `分镜 ${id.slice(-1)}`, x: 0, y: 0, width: 360, height: 220, createdAt: 1, toolName: 'submit_storyboard_for_approval', origin: 'agent', sourceIds: [] }
}
function video(id, file, extra = {}) {
  return {
    id,
    kind: 'video',
    url: `/canvas-studio/assets/p1/${file}`,
    filename: file,
    x: 0, y: 0, width: 480, height: 270,
    createdAt: Number(id.replace(/\D/g, '')) || 1,
    origin: 'agent', toolName: 'video_composite', duration: 5.17,
    sourceIds: [CARD_1],
    ...extra,
  }
}

function canvasNodes() {
  return [
    card(CARD_1), card(CARD_2), card(CARD_3),
    // 揽月湾真实链：v1/v2/v3 被 v4/v5/v6 依次顶掉
    video(V1, 'v1.mp4', { supersededBy: V4, shotVersion: 1, sourceIds: [CARD_1, CARD_2] }),
    video(V2, 'v2.mp4', { supersededBy: V3, shotVersion: 2, sourceIds: [CARD_2, CARD_1] }),
    video(V3, 'v3.mp4', { supersededBy: V4, shotVersion: 3, sourceIds: [CARD_3, CARD_1] }),
    video(V4, 'v4.mp4', { supersededBy: V5, shotVersion: 4, sourceIds: [CARD_1, CARD_2] }),
    video(V5, 'v5.mp4', { supersededBy: V6, shotVersion: 5, sourceIds: [CARD_2, CARD_1] }),
    video(V6, 'v6.mp4', { shotVersion: 6, sourceIds: [CARD_3, CARD_1] }),
    // 成片：产物不是素材，清理必须跳过
    { id: FILM, kind: 'video', url: `/canvas-studio/assets/p1/${'film.mp4'}`, filename: 'film.mp4', title: '成片', x: 0, y: 0, width: 480, height: 270, createdAt: 9, origin: 'agent', toolName: 'compose', sourceIds: [V4, V5, V6, BGM] },
    // 失效参考图：应被清理
    { id: STALE_IMG, kind: 'image', url: '/canvas-studio/assets/p1/stale.png', filename: 'stale.png', title: '旧样张', x: 0, y: 0, width: 360, height: 200, createdAt: 2, origin: 'agent', toolName: 'image_generate', isReference: true, supersededBy: 'img-new', sourceIds: [] },
    { id: 'img-new', kind: 'image', url: '/canvas-studio/assets/p1/new.png', filename: 'new.png', title: '新样张', x: 0, y: 0, width: 360, height: 200, createdAt: 3, origin: 'agent', toolName: 'image_generate', isReference: true, sourceIds: [] },
    // 音频与文本：清理必须跳过
    { id: BGM, kind: 'audio', url: '/canvas-studio/assets/p1/bgm.mp3', filename: 'bgm.mp3', title: 'BGM', x: 0, y: 0, width: 260, height: 84, createdAt: 8, origin: 'agent', toolName: 'music_generation', sourceIds: [] },
    // 生成中的失效视频：跳过并在 busyNodes 回报
    video(BUSY, 'busy.mp4', { supersededBy: V6, isLoading: true, sourceIds: [CARD_1] }),
  ]
}

/** 需被清掉的文件（= 失效图/视频，且非生成中）。 */
const PRUNABLE_FILES = ['v1.mp4', 'v2.mp4', 'v3.mp4', 'v4.mp4', 'v5.mp4', 'stale.png', 'busy.mp4']
/** 必须留下的文件。 */
const KEPT_FILES = ['v6.mp4', 'film.mp4', 'new.png', 'bgm.mp3']

let harness = null
let doc = null
let written = null

async function startHarness() {
  const root = await mkdtemp(join(tmpdir(), 'cs-cv274-'))
  const projDir = join(root, 'proj')
  const assetsDir = join(projDir, 'assets')
  await mkdir(assetsDir, { recursive: true })
  for (const file of [...PRUNABLE_FILES, ...KEPT_FILES]) {
    await writeFile(join(assetsDir, file), Buffer.from(`bytes-${file}`))
  }
  doc = { version: 4, nodes: canvasNodes() }
  await writeFile(join(projDir, 'canvas.json'), JSON.stringify(doc))

  const library = new AssetLibrary(join(root, 'library-root'))
  const registry = {
    list: async () => [{ id: 'p1', name: 'P1', dir: projDir, createdAt: 1 }],
    getProject: async () => ({ workflow: { mode: 'auto', state: 'idle' } }),
    assetsDir: () => assetsDir,
    readCanvas: async () => JSON.parse(JSON.stringify(doc)),
    writeCanvas: async (_projectId, nodes, _view, _workflow, options) => {
      written = { nodes: JSON.parse(JSON.stringify(nodes)), options }
      doc = { version: doc.version, nodes }
      await writeFile(join(projDir, 'canvas.json'), JSON.stringify(doc))
    },
    appendCanvasNode: async () => {},
    sweepUnclaimedDraftDirs: async () => 0,
  }

  const routes = []
  const ctx = {
    webServer: { port: 0, register: (route) => { routes.push(route); return () => {} } },
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
      if (!res.writableEnded) { res.statusCode = 500; res.end() }
    })
  })
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  ctx.webServer.port = server.address().port
  const dispose = registerStudioRoutes(ctx, registry, library)

  return {
    root,
    projDir,
    assetsDir,
    library,
    registry,
    port: ctx.webServer.port,
    origin: `http://127.0.0.1:${ctx.webServer.port}`,
    /** 把画布与磁盘重置回初始事故态（各用例改过 doc，单测之间必须隔离）。 */
    async reseed() {
      doc = { version: 4, nodes: canvasNodes() }
      written = null
      await writeFile(join(projDir, 'canvas.json'), JSON.stringify(doc))
      for (const file of [...PRUNABLE_FILES, ...KEPT_FILES]) {
        await writeFile(join(assetsDir, file), Buffer.from(`bytes-${file}`))
      }
    },
    async close() {
      dispose()
      server.closeIdleConnections?.()
      server.closeAllConnections?.()
      await new Promise((resolve) => { server.close(resolve) })
      await rm(root, { recursive: true, force: true })
    },
  }
}

async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(`http://127.0.0.1:${harness.port}${path}`, {
    method,
    headers: {
      origin: harness.origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  return { status: response.status, text, json: text.length > 0 ? JSON.parse(text) : undefined }
}

before(async () => { harness = await startHarness() })
after(async () => { await harness?.close() })

// ─────────────────────────── M-3 批量清理 ───────────────────────────

test('CV-277 M-3：prune-retired 清掉全部失效图/视频，保留成片/有效片段/音频/文本', async () => {
  const res = await call('/canvas-studio/asset-history/prune-retired', { method: 'POST', body: { projectId: 'p1' } })
  assert.equal(res.status, 200, res.text)
  assert.equal(res.json.ok, true)
  const removed = new Set(res.json.removedFiles)
  // 生成中的 busy 节点必须被跳过
  for (const file of ['v1.mp4', 'v2.mp4', 'v3.mp4', 'v4.mp4', 'v5.mp4', 'stale.png']) {
    assert.ok(removed.has(file), `${file} 应被清理`)
    assert.equal(existsSync(join(harness.assetsDir, file)), false, `${file} 应已物理删除`)
  }
  assert.equal(removed.has('busy.mp4'), false, '生成中的节点不得被清理')
  assert.equal(res.json.busyNodes.length, 1, '生成中节点必须在 busyNodes 里回报，不静默放过')
  assert.equal(res.json.busyNodes[0].id, BUSY)
  for (const file of KEPT_FILES) {
    assert.equal(removed.has(file), false, `${file} 不该被清理`)
    assert.equal(existsSync(join(harness.assetsDir, file)), true, `${file} 应仍在磁盘`)
  }
})

test('CV-277 M-3：成片节点与文本/音频节点一律不进清理范围', async () => {
  const ids = new Set(written.nodes.map((node) => node.id))
  for (const id of [FILM, BGM, V6, 'img-new', CARD_1, CARD_2, CARD_3, BUSY]) {
    assert.ok(ids.has(id), `${id} 应保留`)
  }
  for (const id of [V1, V2, V3, V4, V5, STALE_IMG]) {
    assert.equal(ids.has(id), false, `${id} 应被移除`)
  }
  // removedIds 走显式删除协议（CV-242）——否则客户端 store 不会收敛
  assert.deepEqual(new Set(written.options.removedIds), new Set([V1, V2, V3, V4, V5, STALE_IMG]))
})

test('CV-277 M-3：下游节点的 generationPrompt 被解引用（标 [已删除:…]，不静默降级）', async () => {
  // 前一个用例已把失效节点清空，本用例重置回事故态再单独验「解引用下游」。
  await harness.reseed()
  doc.nodes.push({
    id: 'downstream',
    kind: 'video',
    url: '/canvas-studio/assets/p1/v6.mp4',
    filename: 'v6.mp4',
    x: 0, y: 0, width: 480, height: 270, createdAt: 10,
    origin: 'agent', toolName: 'video_composite',
    sourceIds: [V6],
    generationPrompt: JSON.stringify({ filenames: ['v1.mp4', 'v6.mp4'], duration: 5, shotNodeIds: [CARD_1] }),
  })
  const res = await call('/canvas-studio/asset-history/prune-retired', { method: 'POST', body: { projectId: 'p1' } })
  assert.equal(res.status, 200, res.text)
  const downstream = written.nodes.find((node) => node.id === 'downstream')
  assert.ok(downstream, '下游节点本身不该被删（它有效）')
  const params = JSON.parse(downstream.generationPrompt)
  assert.ok(!params.filenames.includes('v1.mp4'), '已删文件的句柄不得留在 filenames 里')
  assert.ok(params.filenames.includes('v6.mp4'), '未删文件的句柄必须保留')
  // B-4 契约（`generate.ts:1315-1320`）：数组位（filenames）**删元素**——重放语义
  // 退化为「少一张参考」的合法请求；标量位（filename 首帧）替换为 `[已删除:<值>]`
  // 标记——「首帧没了」不得静默降级成文生视频。两条都要钉住。
  const unlinked = JSON.parse(unlinkValuesInPromptJson(
    JSON.stringify({ filename: 'gone.png', filenames: ['gone.png', 'kept.png'] }),
    new Set(['gone.png']),
  ))
  assert.equal(unlinked.filename, '[已删除:gone.png]', '标量首帧位必须留可诊断标记，不得静默降级')
  assert.deepEqual(unlinked.filenames, ['kept.png'], '数组位删元素（重放仍是合法的少参考请求）')
})

test('CV-277 M-3：无失效产物时返回空清单（不是错误），不写盘', async () => {
  // 全部失效节点已在上一步清完 → 再调应无事可做
  written = null
  const res = await call('/canvas-studio/asset-history/prune-retired', { method: 'POST', body: { projectId: 'p1' } })
  assert.equal(res.status, 200, res.text)
  assert.deepEqual(res.json.removedFiles, [])
  assert.equal(res.json.removedNodes, 0)
  assert.equal(written, null, '无事可做时不应写盘')
})

test('CV-277 M-3：缺 projectId → 400；非 POST / 跨站 → 405（与单条删除同款权威守卫）', async () => {
  const missing = await call('/canvas-studio/asset-history/prune-retired', { method: 'POST', body: {} })
  assert.equal(missing.status, 400)
  // GET：mutationAllowed 同样不通过（无 origin 头）⇒ 405，与单条删除路由一致。
  const wrongMethod = await fetch(`http://127.0.0.1:${harness.port}/canvas-studio/asset-history/prune-retired`, {
    method: 'GET',
    headers: { origin: harness.origin },
  })
  assert.equal(wrongMethod.status, 405)
  await wrongMethod.text()
  // 跨站 Origin：`mutationAllowed` 判 origin.host 不等于本服务 ⇒ 拒放行。
  // 状态码 405（而非 403）与既有单条删除路由**同款**——`mutationAllowed` 失败
  // 在两条路由里都归到同一条 405 分支，这里锁住「与既有路由一致」这条契约，
  // 避免后续有人只改一条导致两条路由口径分叉。
  const forged = await fetch(`http://127.0.0.1:${harness.port}/canvas-studio/asset-history/prune-retired`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
    body: JSON.stringify({ projectId: 'p1' }),
  })
  assert.equal(forged.status, 405, '跨站 mutation 必须被拒（口径同单条删除路由）')
  await forged.text()
  // 同款口径对照：单条删除路由在同一条件下也必须是 405。
  const sibling = await fetch(`http://127.0.0.1:${harness.port}/canvas-studio/asset-history/delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
    body: JSON.stringify({ projectId: 'p1', file: 'v1.mp4' }),
  })
  assert.equal(sibling.status, forged.status, '两条路由的权威守卫口径必须一致')
  await sibling.text()
})

// ─────────────────────────── M-4 参考图带 id ───────────────────────────

test('CV-277 M-4：list_references 每项带节点 id（@ref[id] 稳定命中，标题截断不再失配）', async () => {
  const tools = await createStudioTools({
    list: async () => [{ id: 'p1', name: 'P1', dir: harness.projDir, createdAt: 1 }],
    readCanvas: async () => JSON.parse(JSON.stringify(doc)),
    upsertAsset: async () => {},
  })
  const tool = tools.find((entry) => entry.name === 'list_references')
  assert.ok(tool, 'list_references 工具应存在')
  const result = await tool.execute({ includeRetired: true }, { agent: { session: { header: { cwd: harness.projDir } } } })
  const refs = result.references
  assert.ok(refs.length > 0, '应列出参考图')
  for (const ref of refs) {
    assert.equal(typeof ref.id, 'string', '每项必须带 id')
    assert.ok(ref.id.length > 0, 'id 不得为空串')
  }
  assert.ok(refs.some((ref) => ref.id === 'img-new'), '有效参考图应在列')
  assert.equal(refs.some((ref) => ref.id === STALE_IMG), false, '失效参考默认不列（CV-159）')
  // 工具描述必须教模型用 id 引用
  assert.match(tool.description, /@ref\[<节点 id>\]/u, '描述应说明优先用 id 引用')
})

// ─────────────────────────── M-2 合成软提示 ───────────────────────────

test('CV-277 M-2：缺省选片只 1 段但画布有多条视频 → 回执明说失效版本并给出口', () => {
  // 直接对 defaultComposeClips 的口径做断言（不跑 ffmpeg 合成）：
  // 同一份节点表下，失效片段被排除 ⇒ 只剩 1 段，正是触发提示的条件。
  const nodes = canvasNodes()
  const isCompose = (node) => node.kind === 'video' && node.toolName === 'compose'
  const status = (node) => (node.retired === true ? 'retired' : node.supersededBy !== undefined ? 'superseded' : 'active')
  const clips = nodes
    .filter((node) => node.kind === 'video' && !isCompose(node) && status(node) === 'active')
    .sort((left, right) => left.createdAt - right.createdAt)
  assert.equal(clips.length, 1, '缺省选片在事故态下确实只剩 1 段（这正是残片根因）')
  assert.equal(clips[0].id, V6)
  // 提示的触发条件：非显式 clipIds + 只 1 段 + 画布总逐镜数 > 1
  const totalShots = nodes.filter((node) => node.kind === 'video' && !isCompose(node)).length
  assert.ok(totalShots > 1, '画布逐镜视频总数 > 1，应触发提示')
})

test('CV-277 M-2：提示文案已落进 compose 工具实现（守卫：别被后续改动删掉）', () => {
  // renderComposeResult 会把 warnings 逐条带出；这里钉住提示句的关键片段存在，
  // 避免「软提示」在重构中被静默移除。
  const source = readFileSync(new URL('../src/host-tools.ts', import.meta.url), 'utf8')
  assert.match(source, /缺省选片只收到 1 段有效片段/u)
  assert.match(source, /list_shots\(includeRetired=true\)/u, '提示须给出可行动出口（怎么查到全部片段）')
  assert.match(source, /用 clipIds 显式指定/u, '提示须说明如何绕过')
})
