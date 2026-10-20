/**
 * REQ-034 · O-06 执行者切换 / 心跳判活 / 超时口径 —— 守卫。
 *
 * 这一层的核心不变量只有一条：**一张单归谁渲，建单时定死，之后谁都不能抢**。
 * 抢单的后果不是报错，而是「客户端把已经渲了一半的单从头再来一遍」——用户看到
 * 进度条归零，且宿主侧已经落了一半的抽帧变成孤儿。
 *
 * 反向变红的口径写在每个用例的注释里，别改成永远为真的断言。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

const {
  activeRenderJobCount,
  cancelRenderJob,
  claimRenderJobFor,
  failRenderHostJobs,
  renderHostJobCount,
  runRenderJob,
} = await import('../lib/remotion/render-job.js')
const { recordRenderHostReport, renderHostReady, resetRenderHostReport } = await import('../lib/render-host/status.js')
const { resetRenderHostDispatch, setRenderHostLauncher } = await import('../lib/render-host/dispatch.js')

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

/** 最小可用 manifest（工单桥只读 meta.durationInFrames / meta.fps 与 tracks）。 */
const manifest = (frames = 600) => ({
  meta: { title: 't', width: 1280, height: 720, fps: 30, durationInFrames: frames, backgroundColor: '#000000' },
  tracks: [],
})

/** 起一张单并等它落表（`runRenderJob` 在冷启等待时可能晚于第一拍建单）。 */
async function startJob(options) {
  const pending = runRenderJob({ manifest: manifest(), timeoutMs: 30_000, ...options })
  const guarded = pending.then((value) => value, (error) => error)
  await sleep(20)
  return { pending, guarded }
}

/** 轮询取单直到取到（冷启等待期间工单表还是空的）。 */
async function waitForClaim(projectId, owner, budgetMs = 1500) {
  const deadline = Date.now() + budgetMs
  for (;;) {
    const job = claimRenderJobFor(projectId, owner)
    if (job !== null) return job
    if (Date.now() >= deadline) return null
    await sleep(20)
  }
}

/** 收工：撤单并等结算，避免模块级工单表串到下一个用例。 */
async function abortJob(jobId, guarded) {
  cancelRenderJob(jobId, { reason: 'test cleanup' })
  await guarded
}

// ───────────────────────── 心跳判活（纯函数） ─────────────────────────

test('O-06 判活：只有活着且 idle/rendering 才算「能接单」', () => {
  resetRenderHostReport()
  assert.equal(renderHostReady(), false, '从未上报 ⇒ 不能接单')

  recordRenderHostReport({ state: 'unsupported' })
  assert.equal(renderHostReady(), false, '不支持 WebCodecs 的窗口活着也不能接单')

  recordRenderHostReport({ state: 'booting' })
  assert.equal(renderHostReady(), false, '刚起来还没自检完 ⇒ 不赌')

  recordRenderHostReport({ state: 'idle' })
  assert.equal(renderHostReady(), true, 'idle ⇒ 接单')

  recordRenderHostReport({ state: 'rendering' })
  assert.equal(renderHostReady(), true, '忙时也算接单（宿主队列会排队，不能把片子甩回可能不可见的画布页）')

  // 心跳过期：把这一拍的时间戳挪到 31s 前
  recordRenderHostReport({ state: 'idle' }, Date.now() - 31_000)
  assert.equal(renderHostReady(), false, '超过 30s 没上报 ⇒ 判失联（反向变红：把阈值改成 Infinity 这条就绿）')
  resetRenderHostReport()
})

// ───────────────────────── 派单归属 ─────────────────────────

test('O-06 派单：归隐藏窗口的单，画布页取不到（否则两条 1s 轮询会互相偷单）', async () => {
  resetRenderHostReport()
  resetRenderHostDispatch()
  recordRenderHostReport({ state: 'idle' })
  const projectId = 'proj-owner-host'
  const { guarded } = await startJob({ projectId, executor: 'render-host' })

  assert.equal(claimRenderJobFor(projectId, 'client'), null, '客户端不该看见归隐藏窗口的单')
  const claimed = claimRenderJobFor(null, 'render-host')
  assert.ok(claimed !== null, '隐藏窗口不带 projectId 也应取到（它不绑画布页）')
  assert.equal(claimed.projectId, projectId)
  assert.equal(renderHostJobCount(), 1)

  await abortJob(claimed.jobId, guarded)
  assert.equal(activeRenderJobCount(), 0, '撤单后表要清干净')
})

test('O-06 派单：归画布页的单，隐藏窗口取不到（老路径不被抢）', async () => {
  resetRenderHostReport()
  resetRenderHostDispatch()
  const projectId = 'proj-owner-client'
  const { guarded } = await startJob({ projectId, executor: 'client' })

  assert.equal(claimRenderJobFor(null, 'render-host'), null, '隐藏窗口不该抢客户端执行者的单')
  const claimed = claimRenderJobFor(projectId, 'client')
  assert.ok(claimed !== null, '画布页按 projectId 取到自己的单')
  assert.equal(renderHostJobCount(), 0)

  await abortJob(claimed.jobId, guarded)
})

test('O-06 冷启：没有窗口时先拉起再等一拍，等到了就归隐藏窗口', async () => {
  resetRenderHostReport()
  resetRenderHostDispatch()
  let launched = 0
  // 假的拉起器：模拟「窗口 100ms 内自报 idle」。
  setRenderHostLauncher(() => {
    launched += 1
    setTimeout(() => { recordRenderHostReport({ state: 'idle' }) }, 100)
    return true
  })

  const projectId = 'proj-warmup'
  const { guarded } = await startJob({ projectId, hostWarmupMs: 1500 })
  assert.equal(launched, 1, '冷启必须真的去拉窗口')
  const claimed = await waitForClaim(null, 'render-host')
  if (claimed === null) {
    // 失败也要把单收干净，否则它会挂到 30s 超时、污染后面用例的 activeRenderJobCount。
    failRenderHostJobs('test cleanup')
    await guarded
  }
  assert.ok(claimed !== null, '窗口自报后就该归它（反向变红：把 hostWarmupMs 当 0 处理 ⇒ 这张单归客户端，此断言红）')

  await abortJob(claimed.jobId, guarded)
  resetRenderHostDispatch()
})

test('O-06 保底：没有拉起器的宿主（纯 CLI / 单测）零等待直接走客户端', async () => {
  resetRenderHostReport()
  resetRenderHostDispatch()
  const startedAt = Date.now()
  const projectId = 'proj-no-launcher'
  const { guarded } = await startJob({ projectId, hostWarmupMs: 5000 })

  assert.ok(Date.now() - startedAt < 1000, `不该白等 hostWarmupMs（实测 ${Date.now() - startedAt}ms）`)
  const claimed = claimRenderJobFor(projectId, 'client')
  assert.ok(claimed !== null, '没有渲染窗口的宿主必须回退到客户端，不能把渲染能力关掉')

  await abortJob(claimed.jobId, guarded)
})

// ───────────────────────── 心跳看门狗 ─────────────────────────

test('O-06 看门狗：隐藏窗口无心跳即中止工单（文案要对用户可读）', async () => {
  resetRenderHostReport()
  resetRenderHostDispatch()
  recordRenderHostReport({ state: 'rendering' })
  const projectId = 'proj-watchdog'
  // 把 30s 压到 120ms：判据是「距最近一次生命迹象」，与具体阈值无关。
  const { guarded } = await startJob({ projectId, executor: 'render-host', heartbeatStaleMs: 120 })
  const claimed = claimRenderJobFor(projectId, 'render-host')
  assert.ok(claimed !== null)

  const error = await guarded
  assert.equal(error?.code, 'CS-RENDER-002', `应结算为 CS-RENDER-002，实际：${String(error?.code)}`)
  assert.match(error.message, /渲染窗口异常/, '文案要说明是渲染窗口的问题，否则用户会以为是片子内容有错')
  assert.equal(activeRenderJobCount(), 0, '结算后工单必须出表（否则槽位永远占着）')
  resetRenderHostReport()
})

test('O-06 看门狗：窗口崩溃时比 30s 更早结算（failRenderHostJobs 立即生效）', async () => {
  resetRenderHostReport()
  resetRenderHostDispatch()
  recordRenderHostReport({ state: 'idle' })
  const projectId = 'proj-crash'
  const { guarded } = await startJob({ projectId, executor: 'render-host' })

  const failed = failRenderHostJobs('renderer-gone')
  assert.equal(failed, 1, '在飞的隐藏窗口单必须被立刻结算')
  const error = await guarded
  assert.equal(error?.code, 'CS-RENDER-002')
  assert.match(error.message, /渲染窗口异常/)
  assert.equal(activeRenderJobCount(), 0)
  resetRenderHostReport()
})

// ───────────────────────── 接线（源码约定） ─────────────────────────

test('O-06 接线：pending 路由按 owner 分派、状态路由心跳不算活动', () => {
  const routes = read('src/routes.ts')
  assert.match(routes, /owner.*=== 'host' \? 'render-host' : 'client'/s, 'pending 必须解析 owner 参数')
  assert.match(routes, /claimRenderJobFor\(/, 'pending 必须走 claimRenderJobFor（不能再用旧的 pendingRenderJobFor）')
  // 心跳 ≠ 活动：每拍都 touch 会让空闲回收永远不触发。
  const statusAt = routes.indexOf('path: ROUTE_RENDER_HOST_STATUS')
  assert.ok(statusAt > 0, '状态路由必须注册')
  assert.match(
    routes.slice(statusAt, statusAt + 2500),
    /if \(report\.state === 'rendering'\) touchRenderHost\(\)/,
    '只有「正在渲」才算活动，否则窗口永不回收',
  )
})

test('O-06 接线：窗口失联有四条主进程侧旁路（不依赖页面定时器）', () => {
  const src = read('src/render-host/window.ts')
  for (const event of ['render-process-gone', 'unresponsive', 'closed', 'load-failed']) {
    assert.ok(src.includes(event), `必须处理 ${event}（否则崩溃后要等 30s 看门狗）`)
  }
  assert.match(src, /resetRenderHostReport\(\)/, '窗口销毁必须让上一份自报作废')
})

test('O-06 接线：工具描述写明「关掉整个 App 会中断渲染」（不许承诺做不到的事）', async () => {
  const { createStudioTools } = await import('../lib/host-tools.js')
  const tool = createStudioTools({}, 3000).find((entry) => entry.name === 'render_composition')
  assert.ok(tool !== undefined)
  assert.match(tool.description, /关掉整个 App 会中断渲染/, '这条边界必须进工具描述')
  assert.match(tool.description, /隐藏渲染窗口/, '执行者换了就要说清楚，否则模型还会教用户「切到前台」')
})
