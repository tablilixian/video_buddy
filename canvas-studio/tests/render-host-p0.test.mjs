/**
 * P0 渲染护栏（2026-10-28）：**失败时模型与人都得看见真证据**。
 *
 * 守的四条，全部来自真机取证（4 个会话 55 次 render_composition / 34 次 CS-RENDER-002）：
 *
 *   P0-1 诊断进正文：工单诊断拼进 `message`，不再是「请重试」一句话；
 *   P0-2 分档文案：「从未取单」与「取单后没动」必须是两句话（修法相反）；
 *   P0-3 窗口自证：派单理由进日志；页面内联自举脚本的 CSP 哈希必须与内容一致；
 *   P0-4 阈值耦合：窗口不可用时判死阈值放宽（否则被后台节流的健康页面必被杀）。
 *
 * 反向变异（见文件末尾注释）：拆任一条，对应断言必须变红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CLIENT_CLAIM_STALL_MS,
  CLIENT_CLAIM_STALL_NO_HOST_MS,
  activeRenderJobCount,
  cancelRenderJob,
  commitRenderJob,
  failRenderHostJobs,
  listRenderJobViews,
  pendingRenderJobFor,
  reportRenderJobProgress,
  runRenderJob,
} from '../lib/remotion/render-job.js'
import { resetRenderHostDispatch, setRenderHostLogger } from '../lib/render-host/dispatch.js'
import { recordRenderHostReport, resetRenderHostReport } from '../lib/render-host/status.js'
import { RENDER_HOST_BOOTSTRAP, renderHostHtml } from '../lib/render-host/page.js'
import { ProjectRegistry } from '../lib/projects.js'
import '../lib/errors/catalog.js'

function minimalManifest() {
  return {
    id: 'm-p0',
    meta: { title: 'P0 文案', width: 640, height: 360, fps: 30, durationInFrames: 60 },
    tracks: [
      { id: 't1', type: 'textCard', variant: 'title', text: '标题卡', startFrame: 0, durationInFrames: 60 },
    ],
  }
}

async function withProject(run) {
  const dir = await mkdtemp(join(tmpdir(), 'cs-p0-'))
  try {
    const registry = new ProjectRegistry(dir)
    const project = await registry.create('P0 文案')
    await run({ registry, project })
  } finally {
    resetRenderHostReport()
    resetRenderHostDispatch()
    await rm(dir, { recursive: true, force: true })
  }
}

/** 起一张单并按预期失败，返回错误对象（顺带保证工单出表，避免悬挂句柄）。 */
function rejectingJob(options) {
  const job = runRenderJob(options)
  const settled = job.then((v) => v, (e) => e)
  return settled
}

/**
 * 最新一张单的 id。
 *
 * ⚠️ 不能用 `listRenderJobViews(projectId)[0]`：`render-queue` 的 entries **保留已结算**的单
 * （按 seq 升序），同一项目跑第二张单时 `[0]` 拿到的是上一张的 id，撤单会打空 ⇒ 测试白等超时。
 */
function newestJobId(projectId) {
  const views = listRenderJobViews(projectId)
  assert.ok(views.length > 0, '工单必须同步入表')
  return views[views.length - 1].jobId
}

// ───────────────────────── P0-1：诊断进正文 ─────────────────────────

test('P0-1：看门狗结算的 CS-RENDER-002 把工单诊断写进**模型可见**的正文', async () => {
  resetRenderHostReport()
  resetRenderHostDispatch()
  await withProject(async ({ project }) => {
    const err = await rejectingJob({
      projectId: project.id,
      manifest: minimalManifest(),
      timeoutMs: 10_000,
      clientClaimStallMs: 60,
      clientClaimStallNoHostMs: 60,
    })
    assert.equal(err.code, 'CS-RENDER-002')
    // 正文必须自带「工单：」那一行 —— 它此前只活在 devMessage 里，而 devMode=false 时
    // routeError 只交 userMessage ⇒ 模型 34 次都只看到「请重试」。
    assert.match(err.message, /工单：/u, `正文必须携带工单诊断，实际：${err.message}`)
    assert.match(err.message, /从未取走这张工单/u, '诊断要说清是「没人取单」还是「取了没动」')
    // 诊断必须是**换行追加**的（正文前段仍是人话，模型先读结论再读证据）。
    assert.match(err.message, /\n工单：/u, `诊断要单独一行追加：${err.message}`)
    assert.ok(err.params?.job, '结构化 job 快照仍要带（供客户端/日志用）')
    assert.equal(err.params.job.claimedAt, null)
  })
})

test('P0-1：三条非看门狗路径也带工单诊断（窗口失联 / 未知工单 / 画布页撤单）', async () => {
  resetRenderHostReport()
  resetRenderHostDispatch()
  await withProject(async ({ registry, project }) => {
    // ① 窗口失联（failRenderHostJobs）
    recordRenderHostReport({ state: 'idle' })
    const lostJob = rejectingJob({ projectId: project.id, manifest: minimalManifest(), timeoutMs: 10_000, executor: 'render-host' })
    // 等建单入表（同步入表，故当拍可见）。
    assert.equal(listRenderJobViews(project.id).length, 1)
    failRenderHostJobs('test: renderer gone')
    const lost = await lostJob
    assert.equal(lost.code, 'CS-RENDER-002')
    assert.match(lost.message, /\n工单：/u, `窗口失联的正文也要带诊断，实际：${lost.message}`)

    // ② 未知工单（commit 落到已结算的 id 上）
    const unknown = await commitRenderJob(registry, 'rj-does-not-exist', { bytes: new Uint8Array([1, 2, 3]) })
      .then((v) => v, (e) => e)
    assert.equal(unknown.code, 'CS-RENDER-002')
    assert.ok(!unknown.message.includes('工单：'), '没有工单可诊断时不该凭空补一行（信息为假比没有更坏）')

    // ③ 画布页撤单（failed=1）
    const cancelledJob = rejectingJob({ projectId: project.id, manifest: minimalManifest(), timeoutMs: 10_000 })
    cancelRenderJob(newestJobId(project.id), { failed: true, reason: '浏览器不支持 h264' })
    const cancelled = await cancelledJob
    assert.equal(cancelled.code, 'CS-RENDER-002')
    assert.match(cancelled.message, /\n工单：/u, `撤单正文也要带诊断，实际：${cancelled.message}`)
    assert.equal(activeRenderJobCount(), 0)
  })
})

// ───────────────────────── P0-2：分档文案 ─────────────────────────

test('P0-2：「从未取单」与「取单后没动」必须是两句不同的话', async () => {
  resetRenderHostReport()
  resetRenderHostDispatch()
  await withProject(async ({ project }) => {
    // 档 1：没人取
    const never = await rejectingJob({
      projectId: project.id,
      manifest: minimalManifest(),
      timeoutMs: 10_000,
      clientClaimStallMs: 50,
      clientClaimStallNoHostMs: 50,
    })
    // 档 2：取走了但一帧没动（先 claim，再不报进度）
    const claimedJob = rejectingJob({
      projectId: project.id,
      manifest: minimalManifest(),
      timeoutMs: 10_000,
      clientClaimStallMs: 50,
      clientClaimStallNoHostMs: 50,
    })
    assert.ok(pendingRenderJobFor(project.id) !== null, '必须能取到单（打点 clientClaimedAt）')
    await new Promise((r) => setTimeout(r, 30))
    reportRenderJobProgress(newestJobId(project.id), 0) // 报活但不产生进度
    const claimed = await claimedJob

    assert.notEqual(never.message, claimed.message, '两档必须给不同文案，否则模型分不清该怎么救')
    assert.match(never.message, /从未取走/u)
    assert.match(claimed.message, /已取走这张单/u)
    // 两条都要点出「谁没能兜底」，否则排障只能猜窗口在不在。
    for (const message of [never.message, claimed.message]) {
      assert.match(message, /无法接管/u, `要说清兜底为什么没生效：${message}`)
    }
  })
})

// ───────────────────────── P0-4：阈值与兜底能力耦合 ─────────────────────────

test('P0-4：窗口不可用时判死阈值放宽（60s 档），可用时仍是 20s 档', async () => {
  assert.equal(CLIENT_CLAIM_STALL_MS, 20_000)
  assert.equal(CLIENT_CLAIM_STALL_NO_HOST_MS, 60_000, '放宽档必须是 60s（盖住一次被节流的轮询）')

  resetRenderHostReport()
  resetRenderHostDispatch()
  await withProject(async ({ project }) => {
    // 无窗口 + 注入两档阈值（短档 60ms / 放宽档 3s）。
    // 看门狗 tick 是 1s ⇒ 等 1.5s 正好跨过「只有短档」时必死的那一刻：
    //   · 修复前（阈值=短档）⇒ 1s 就结算，此刻工单已出表 ⇒ 下面第 1 条断言变红；
    //   · 修复后（阈值=放宽档）⇒ 仍活着，命交给「画布页也许只是被节流」。
    const job = runRenderJob({
      projectId: project.id,
      manifest: minimalManifest(),
      timeoutMs: 10_000,
      clientClaimStallMs: 60,
      clientClaimStallNoHostMs: 3_000,
    })
    const settled = job.then((v) => v, (e) => e)
    await new Promise((r) => setTimeout(r, 1_500))
    assert.equal(activeRenderJobCount(), 1, '窗口不可用 ⇒ 必须按放宽档等，不能在 60ms 就判死一个可能只是被节流的页面')
    // 收尾：主动撤单（不是失败），避免拖满 3s。
    cancelRenderJob(newestJobId(project.id), { reason: '测试收尾' })
    const err = await settled
    assert.equal(err.code, 'CS-GEN-207', '撤单收场，说明它确实是被我们主动结束的')
  })
})

// ───────────────────────── P0-3：窗口自证 ─────────────────────────

test('P0-3①：派单回退到画布页时，日志里必须写明「为什么没给隐藏窗口」', async () => {
  resetRenderHostReport()
  resetRenderHostDispatch()
  const lines = []
  setRenderHostLogger((message) => { lines.push(message) })
  await withProject(async ({ project }) => {
    // 没有拉起器（纯 CLI / 单测宿主）⇒ 一定回退画布页
    await rejectingJob({
      projectId: project.id,
      manifest: minimalManifest(),
      timeoutMs: 10_000,
      clientClaimStallMs: 50,
      clientClaimStallNoHostMs: 50,
    })
    const fellBack = lines.filter((line) => line.includes('交给画布页'))
    assert.equal(fellBack.length, 1, `必须且只打一行派单理由，实际：${JSON.stringify(lines)}`)
    assert.match(fellBack[0], /没有隐藏渲染窗口/u, '理由要可操作：是哪一种「没给窗口」')
  })
})

test('P0-3③：渲染页的内联自举脚本必须被 CSP 放行（哈希与内容一致）', () => {
  const html = renderHostHtml()
  const inline = /<script>([\s\S]*?)<\/script>/u.exec(html)
  assert.ok(inline !== null, '页面必须带内联自举脚本（它是唯一能报告「模块脚本没执行」的通道）')
  const content = inline[1]
  assert.equal(content, RENDER_HOST_BOOTSTRAP, '写进 HTML 的字节必须与导出常量一致')
  // 三件事都得在：资源加载失败（捕获阶段）、未处理拒绝、bundle 未执行。
  assert.match(content, /addEventListener\('error'/u)
  assert.match(content, /unhandledrejection/u)
  assert.match(content, /__csRenderHost/u, '8s 后仍未定义 ⇒ 说明 bundle 没执行')

  const expected = `sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}`
  assert.ok(html.includes(`script-src 'self' '${expected}'`), `CSP 必须放行这一段内联脚本（哈希不匹配会静默白屏）：期望 ${expected}`)
  assert.ok(!/script-src[^;]*'unsafe-inline'/u.test(html), '不要用 unsafe-inline 换方便')
})

/**
 * 在最小假 DOM 里跑自举脚本（`node:vm`）：只要它能自己跑通一段行为，就说明这条
 * 「页面脚本到底跑起来没有」的判据是**行为**，而不是「源码里有这行字」。
 */
function runBootstrap() {
  const posted = []
  const handlers = new Map()
  const intervals = []
  const timeouts = []
  const win = {
    __csRenderHost: undefined,
    addEventListener: (type, fn) => { handlers.set(type, fn) },
  }
  const context = {
    window: win,
    setTimeout: (fn) => { timeouts.push(fn); return 1 },
    setInterval: (fn) => { intervals.push(fn); return 1 },
    clearInterval: () => {},
    fetch: (_url, init) => { posted.push(JSON.parse(init.body)); return Promise.resolve() },
  }
  runInNewContext(RENDER_HOST_BOOTSTRAP, context)
  return { posted, handlers, intervals, timeouts, win }
}

test('P0-3③：bundle 未求值前的故障必须报 error（这是 34 次静默失败的唯一证物）', () => {
  const boot = runBootstrap()
  boot.handlers.get('unhandledrejection')({ reason: { message: 'Failed to fetch' } })
  assert.equal(boot.posted.length, 1, '未处理拒绝要上报')
  assert.equal(boot.posted[0].state, 'error')
  // 资源加载失败（捕获阶段）也要报，且指出是哪个标签。
  boot.handlers.get('error')({ target: { tagName: 'SCRIPT', src: '/canvas-studio/render-host.js' } })
  assert.equal(boot.posted.length, 2)
  assert.match(String(boot.posted[1].detail), /SCRIPT/u)
  // 8s 哨兵：bundle 始终没定义 ⇒ 报「未执行」。
  boot.timeouts.forEach((fn) => { fn() })
  assert.equal(boot.posted.length, 3)
  assert.match(String(boot.posted[2].detail), /bundle 未执行/u)
})

test('P0-3③：bundle 求值后必须闭嘴 —— 瞬时网络抖动不能把健康窗口判成 error', () => {
  const boot = runBootstrap()
  // bundle 起来了：轮询把 live 置位，页面从此自己按 1s 心跳自报。
  boot.win.__csRenderHost = { probe: true }
  boot.intervals.forEach((fn) => { fn() })
  boot.handlers.get('unhandledrejection')({ reason: { message: 'Failed to fetch' } })
  boot.handlers.get('error')({ message: 'boom' })
  boot.timeouts.forEach((fn) => { fn() })
  assert.deepEqual(boot.posted, [], `页面已在自报后，自举脚本再报 error 会让派单闸 30s 内为假（工单被推回画布页）：${JSON.stringify(boot.posted)}`)
})

/**
 * 反向变异（改完代码手工验一遍，全部必须变红）：
 * 1. 删 `diagHint` 调用 ⇒ P0-1 两条红（正文没有「工单：」）；
 * 2. `silenceOf` 两档合并成同一句 ⇒ P0-2 红（两句话相等）；
 * 3. `claimStallLimitOf` 直接返回 `job.claimStallMs` ⇒ P0-4 红（60ms 就判死）；
 * 4. 去掉 `logRenderHost` 调用 ⇒ P0-3① 红（0 行派单理由）；
 * 5. `renderHostHtml` 用 `'unsafe-inline'` 取代哈希 ⇒ P0-3③ 第一条红；
 * 6. `RENDER_HOST_BOOTSTRAP` 去掉 `live` 闸（`if(live||sent[key])` → `if(sent[key])`）
 *    ⇒ P0-3③ 第二条红（bundle 起来后仍报 3 条 error）。
 */
