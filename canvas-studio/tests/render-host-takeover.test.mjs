/**
 * REQ-035 · Phase 1（F-02a..e）契约测试：认领 / 改派 / 看门狗的状态机。
 *
 * 守的是 2026-10-24 事故暴露的五个结构性缺陷（见
 * `docs/plans/REQ-035-Phase0-取证报告-20261024.md` §三）：
 *
 *   F-02a 派单闸与改派闸解耦 —— 窗口 `booting` 也允许接管，`error/unsupported` 不允许；
 *   F-02b 「claim 过就永不改派」改为「claim 后无进度可改派」；
 *   F-02c client 单也装看门狗 —— 取单后不出活要在阈值内结算，而不是干等工具超时；
 *   F-02d 冷启预算 3s → 8s；
 *   F-02e 工单载荷带 `deadlineAt`（页面据此自 abort；这里只验载荷字段存在且已定）。
 *
 * 全部用假时钟驱动 `claimRenderJobFor({ now })`，不启浏览器、不真等待。
 * 从 `../lib/*.js` 导入 —— 先 build 再跑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CLIENT_CLAIM_STALL_MS,
  CLIENT_PROGRESS_STALL_MS,
  RENDER_HOST_TAKEOVER_GRACE_MS,
  RENDER_HOST_WARMUP_MS,
  activeRenderJobCount,
  cancelRenderJob,
  claimRenderJobFor,
  listRenderJobViews,
  pendingRenderJobFor,
  reportRenderJobProgress,
  runRenderJob,
} from '../lib/remotion/render-job.js'
import { recordRenderHostReport, renderHostCanTakeOver, resetRenderHostReport } from '../lib/render-host/status.js'
import { ProjectRegistry } from '../lib/projects.js'
import '../lib/errors/catalog.js'

/** 校验必过的最小 Manifest（纯呈现轨，不依赖素材）。 */
function minimalManifest() {
  return {
    id: 'm-takeover',
    meta: { title: '改派测试', width: 1280, height: 720, fps: 30, durationInFrames: 60 },
    tracks: [
      { id: 't-title', type: 'textCard', variant: 'title', text: '标题卡', startFrame: 0, durationInFrames: 60 },
    ],
  }
}

async function withProject(run) {
  const dir = await mkdtemp(join(tmpdir(), 'cs-takeover-'))
  try {
    const registry = new ProjectRegistry(dir)
    const project = await registry.create('改派测试')
    await run({ registry, project })
  } finally {
    resetRenderHostReport()
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * 起一张 client 单，并在收尾时确保它被结算（避免 node:test 因悬挂句柄不退出）。
 *
 * 刻意**不**自动以 client 身份取单：`pendingRenderJobFor()` 会给
 * `clientClaimedAt` 打点，那样就测不到「无人认领」那一档了。
 */
async function withClientJob(run) {
  await withProject(async (ctx) => {
    const job = runRenderJob({ projectId: ctx.project.id, manifest: minimalManifest(), timeoutMs: 30_000 })
    // 立即挂 onRejected，避免「取消」被当成未处理拒绝。
    const settled = job.then(() => 'resolved', () => 'rejected')
    const listed = listRenderJobViews(ctx.project.id)
    assert.equal(listed.length, 1, '建单必须同步可见')
    const jobId = listed[0].jobId
    try {
      await run({
        ...ctx,
        jobId,
        /** 以画布页身份取单（会打点 `clientClaimedAt`）。 */
        claim: () => pendingRenderJobFor(ctx.project.id),
      })
    } finally {
      cancelRenderJob(jobId, { failed: true, reason: '测试收尾' })
      await settled
    }
  })
}

test('F-02d：冷启等待预算已从 3s 提到 8s', () => {
  assert.equal(RENDER_HOST_WARMUP_MS, 8_000)
})

test('F-02a：改派闸与派单闸解耦 —— booting 可接管，error/unsupported 不可', () => {
  const t = Date.now()
  resetRenderHostReport()
  assert.equal(renderHostCanTakeOver(t), false, '没有自报就不该接管')

  for (const state of ['booting', 'idle', 'rendering']) {
    recordRenderHostReport({ state }, t)
    assert.equal(renderHostCanTakeOver(t), true, `${state} 应允许接管（原实现只认 idle/rendering）`)
  }
  for (const state of ['error', 'unsupported']) {
    recordRenderHostReport({ state }, t)
    assert.equal(renderHostCanTakeOver(t), false, `${state} 明确干不了，不该接管`)
  }
  // 自报过期：窗口失联后同样不允许接管（避免把单交给不存在的窗口）
  recordRenderHostReport({ state: 'idle' }, t)
  assert.equal(renderHostCanTakeOver(t + 31_000), false, '超过 30s 未自报 ⇒ 视为失联')
})

test('F-02b：宽限期内无人认领 ⇒ 改派（原逻辑回归）', async () => {
  const t = Date.now()
  recordRenderHostReport({ state: 'idle' }, t)
  await withClientJob(async ({ jobId }) => {
    const reasons = []
    const taken = claimRenderJobFor(null, 'render-host', {
      now: t + RENDER_HOST_TAKEOVER_GRACE_MS + 5_000,
      onTakeover: (id, reason) => reasons.push({ id, reason }),
    })
    assert.equal(taken?.jobId, jobId)
    assert.equal(reasons.length, 1)
    assert.match(reasons[0].reason, /未认领/u)
  })
})

test('F-02b：画布页认领后 20s 一帧没动 ⇒ 允许改派（本次事故的核心）', async () => {
  const t = Date.now()
  recordRenderHostReport({ state: 'idle' }, t)
  await withClientJob(async ({ jobId, claim }) => {
    // 画布页取单（打点 clientClaimedAt），但从不报进度
    claim()

    const tooEarly = claimRenderJobFor(null, 'render-host', { now: t + 5_000 })
    assert.equal(tooEarly, null, '5s 还不够，不能抢"正在路上"的客户端')

    const reasons = []
    const taken = claimRenderJobFor(null, 'render-host', {
      now: t + CLIENT_CLAIM_STALL_MS + 2_000,
      onTakeover: (_id, reason) => reasons.push(reason),
    })
    assert.equal(taken?.jobId, jobId, '认领后长时间无进度必须能被接管')
    assert.match(reasons[0], /无任何进度/u)
  })
})

test('F-02b：已开渲且进度新鲜 ⇒ 不得改派（防止抢掉正在渲的片子）', async () => {
  const t = Date.now()
  recordRenderHostReport({ state: 'idle' }, t)
  await withClientJob(async ({ jobId, claim }) => {
    claim()
    assert.equal(reportRenderJobProgress(jobId, 0.4), true)

    const taken = claimRenderJobFor(null, 'render-host', { now: t + 10_000 })
    assert.equal(taken, null, '有进度且未停滞 ⇒ 继续等，不许抢')
  })
})

test('CV-373：取单后只有报活心跳（progress=0）也不判死 —— warmup/预览等人不被误杀', async () => {
  const t = Date.now()
  recordRenderHostReport({ state: 'idle' }, t)
  await withClientJob(async ({ jobId, claim }) => {
    // 画布页取单，随后只打报活心跳（首帧前的 warmup / 预览闸门等人期间就是这个形态）
    claim()
    const pingAt = t + 15_000
    assert.equal(reportRenderJobProgress(jobId, 0, { now: pingAt }), true)

    // 22s 没有真实进度 —— 但最后一次活性证据是 15s 前，还不到 20s 死线
    const tooEarly = claimRenderJobFor(null, 'render-host', { now: t + CLIENT_CLAIM_STALL_MS + 2_000 })
    assert.equal(tooEarly, null, '报活把死线往后推了 ⇒ 不许抢')

    // 心跳也停了：最后一次活性证据 15s + 21s = 36s 前的事 ⇒ 可以接管
    //（接管还要求窗口活着 —— 自报 30s 过期，所以按接管时刻重新自报一次）
    const reasons = []
    const takeoverAt = pingAt + CLIENT_CLAIM_STALL_MS + 1_000
    recordRenderHostReport({ state: 'idle' }, takeoverAt)
    const taken = claimRenderJobFor(null, 'render-host', {
      now: takeoverAt,
      onTakeover: (_id, reason) => reasons.push(reason),
    })
    assert.equal(taken?.jobId, jobId, '活性证据也断了 ⇒ 照常接管')
    assert.match(reasons[0], /无任何进度（含报活）/u)
  })
})

test('F-02b：已开渲但进度停滞超过阈值 ⇒ 允许改派', async () => {
  const t = Date.now()
  await withClientJob(async ({ jobId, claim }) => {
    claim()
    assert.equal(reportRenderJobProgress(jobId, 0.4), true)
    // 窗口仍在正常心跳（模拟"窗口好好的，是画布页卡住了"）
    const later = t + CLIENT_PROGRESS_STALL_MS + 5_000
    recordRenderHostReport({ state: 'idle' }, later)

    const reasons = []
    const taken = claimRenderJobFor(null, 'render-host', {
      now: later,
      onTakeover: (_id, reason) => reasons.push(reason),
    })
    assert.equal(taken?.jobId, jobId)
    assert.match(reasons[0], /停滞/u)
  })
})

test('F-02c：client 单也有看门狗 —— 取单后不出活即在阈值内结算', async () => {
  await withProject(async ({ project }) => {
    const before = activeRenderJobCount()
    const job = runRenderJob({
      projectId: project.id,
      manifest: minimalManifest(),
      timeoutMs: 30_000,
      // 注入极短阈值，避免测试真等 20s
      clientClaimStallMs: 80,
    })
    await assert.rejects(
      () => job,
      (err) => err.code === 'CS-RENDER-002' && /画布页/u.test(err.message),
      '原实现：client 单没有任何兜底，只能干等到工具超时',
    )
    assert.equal(activeRenderJobCount(), before, '结算后必须从工单表摘掉，否则泄漏')
  })
})

test('F-02c：有可用窗口时不判死 —— 把救活机会留给改派', async () => {
  await withProject(async ({ project }) => {
    const before = activeRenderJobCount()
    recordRenderHostReport({ state: 'idle' }, Date.now())
    const job = runRenderJob({
      projectId: project.id,
      manifest: minimalManifest(),
      timeoutMs: 30_000,
      clientClaimStallMs: 40,
    })
    const settled = job.then(() => 'resolved', () => 'rejected')
    const jobId = listRenderJobViews(project.id)[0].jobId
    // 远超阈值；若看门狗不看窗口，这里就已经把单判死了
    await new Promise((r) => setTimeout(r, 250))
    assert.equal(activeRenderJobCount(), before + 1, '有窗口可用 ⇒ 不该在这里判死，应等改派')
    cancelRenderJob(jobId, { failed: true, reason: '测试收尾' })
    await settled
  })
})

test('F-02e：工单载荷的 deadlineAt 落在派发时刻 + 预算', async () => {
  await withClientJob(async ({ claim }) => {
    const view = claim()
    assert.notEqual(view, null)
    assert.equal(typeof view.deadlineAt, 'number')
    assert.ok(view.deadlineAt > 0, '工单载荷必须带绝对截止时刻，页面才能自 abort')
    const budget = view.deadlineAt - Date.now()
    assert.ok(budget > 25_000 && budget <= 30_100, `deadlineAt 应≈派发+30s，实际 ${budget}ms`)
  })
})

test('F-01：超时错误里带工单诊断（谁认领 / 有没有首帧），且写进文案', async () => {
  await withProject(async ({ project }) => {
    await assert.rejects(
      () => runRenderJob({ projectId: project.id, manifest: minimalManifest(), timeoutMs: 30 }),
      (err) => {
        assert.equal(err.code, 'CS-RENDER-TIMEOUT')
        const job = err.params?.job
        assert.ok(job, '错误必须带 job 诊断快照')
        assert.equal(job.path, 'client', '无人认领时应如实记为画布页路径')
        assert.equal(job.claimedAt, null)
        assert.equal(job.firstFrameAt, null)
        assert.equal(job.settled, 'timeout')
        assert.match(err.message, /从未取走这张工单/u, `文案必须说清是"没人取单"，实际：${err.message}`)
        return true
      },
    )
  })
})
