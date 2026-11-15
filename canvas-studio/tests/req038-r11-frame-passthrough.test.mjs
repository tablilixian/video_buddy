/**
 * REQ-038 R11-C3 · **frameRange / muteAudio 全链路透传**单测。
 *
 * 三条纪律必须同时成立：
 * ① **claim payload 带齐** —— runRenderJob 的 frameRange/muteAudio 必须出现在
 *    claimRenderJobFor 的取单载荷里（跨进程边界：宿主 → 画布页/隐藏窗口）；
 * ② **缺省不出现** —— 不传时载荷里没有这两个字段（整片渲染的载荷与今天逐字段一致）；
 * ③ **滞留改派不丢** —— client 单被隐藏窗口接管时，frameRange/muteAudio 跟着走。
 *
 * 复用 render-host-executor 的测试骨架（startJob/waitForClaim/abortJob）。
 * 定向跑：node --test tests/req038-r11-frame-passthrough.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const {
  cancelRenderJob,
  claimRenderJobFor,
  runRenderJob,
} = await import('../lib/remotion/render-job.js')

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

const manifest = (frames = 600) => ({
  meta: { title: 't', width: 1280, height: 720, fps: 30, durationInFrames: frames, backgroundColor: '#000000' },
  tracks: [],
})

/** 起一张单并等它落表。 */
async function startJob(options) {
  const pending = runRenderJob({ manifest: manifest(), timeoutMs: 30_000, ...options })
  const guarded = pending.then((value) => value, (error) => error)
  await sleep(20)
  return { pending, guarded }
}

/** 轮询取单直到取到。 */
async function waitForClaim(projectId, owner, budgetMs = 1500) {
  const deadline = Date.now() + budgetMs
  for (;;) {
    const job = claimRenderJobFor(projectId, owner)
    if (job !== null) return job
    if (Date.now() >= deadline) return null
    await sleep(20)
  }
}

/** 收工：撤单并等结算（jobId 可能未知——cancelRenderJob 对未知 id 容错）。 */
async function abortJob(jobId, guarded) {
  if (jobId !== null && jobId !== undefined) cancelRenderJob(jobId, { reason: 'test cleanup' })
  await guarded
}

test('frameRange + muteAudio 出现在 claim payload（跨进程不丢）', async () => {
  const { pending, guarded } = await startJob({ projectId: 'r11-passthrough', executor: 'client', frameRange: [100, 299], muteAudio: true })
  let claimedId = null
  try {
    const job = await waitForClaim('r11-passthrough', 'client')
    assert.ok(job !== null, '必须能取到单')
    claimedId = job.jobId
    assert.deepEqual(job.frameRange, [100, 299])
    assert.equal(job.muteAudio, true)
  } finally {
    await abortJob(claimedId, guarded)
  }
})

test('缺省不传：payload 里没有这两个字段（整片载荷与今天一致）', async () => {
  const { pending, guarded } = await startJob({ projectId: 'r11-default', executor: 'client' })
  let claimedId = null
  try {
    const job = await waitForClaim('r11-default', 'client')
    assert.ok(job !== null)
    claimedId = job.jobId
    assert.equal('frameRange' in job, false, '不传 frameRange 时载荷不得带该字段')
    assert.equal('muteAudio' in job, false, '不传 muteAudio 时载荷不得带该字段')
  } finally {
    await abortJob(claimedId, guarded)
  }
})

test('滞留改派：takeover payload 也带 frameRange/muteAudio（接线完整性）', () => {
  // takeoverOrphanedClientJob 未导出——改为对源码做接线断言：takeover 分支必须
  // 复制这两个字段（与 claim payload 同构）。静态断言，防有人只改一处。
  const src = readFileSync(join(root, 'src', 'remotion', 'render-job.ts'), 'utf8')
  const takeoverIdx = src.indexOf("if (owner === 'render-host') {")
  const takeoverBody = src.slice(takeoverIdx, src.indexOf('return null', takeoverIdx))
  assert.match(takeoverBody, /takeover\.frameRange/, 'takeover payload 必须带 frameRange')
  assert.match(takeoverBody, /takeover\.muteAudio/, 'takeover payload 必须带 muteAudio')
})
