/**
 * Drama 异步任务台账（jobs.json）+ 恢复轮询测试（后端 0.5.0）。
 *
 * 直连 Host 侧编译产物 lib/video-jobs.js；registry 用打桩对象（list/projectDir），
 * 任务端点用假 request 闭包，不打桩 fetch、不碰真实后端。
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DRAMA_JOBS_VERSION,
  dramaJobsFileOf,
  isTerminalJobPhase,
  pendingDramaJobs,
  readDramaJobs,
  recordDramaJobSubmitted,
  startDramaJobResumeWatcher,
  updateDramaJobStatus,
} from '../lib/video-jobs.js'

/** registry 打桩：每项目一个独立子目录（台账按项目分文件）。 */
function stubRegistry(rootDir, projectIds = ['p1']) {
  const dirOf = new Map(projectIds.map((id) => [id, join(rootDir, id)]))
  return {
    list: async () => projectIds.map((id) => ({ id, name: id, dir: dirOf.get(id), createdAt: 1 })),
    projectDir: (projectId) => dirOf.get(projectId) ?? join(rootDir, projectId),
  }
}

/** 轮询等待条件成立（watcher 是异步定时器链，不能用同步断言）。 */
async function waitFor(condition, timeoutMs = 3000, label = 'condition') {
  const started = Date.now()
  for (;;) {
    if (await condition()) return
    if (Date.now() - started > timeoutMs) throw new Error(`waitFor 超时: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** 任务端点假 request：状态按序列弹出；result/cancel 按 path 分流。 */
function makeRequest({
  statusSequence = ['completed'],
  resultStatus = 200,
  result = { prompt_id: 'job-1', filename: 'out.mp4', full_url: 'https://media.example/out.mp4', duration: 8.5 },
  failFirst = 0,
} = {}) {
  const calls = []
  let statusIndex = 0
  let failures = failFirst
  const request = async (method, path) => {
    calls.push({ method, path })
    if (failures > 0) {
      failures -= 1
      throw new Error('ECONNRESET')
    }
    if (path.endsWith('/result')) return { status: resultStatus, json: result }
    if (path.endsWith('/cancel')) return { status: 200, json: { cancelled: true } }
    const status = statusSequence[Math.min(statusIndex, statusSequence.length - 1)]
    statusIndex += 1
    return { status: 200, json: { job_id: 'job-1', status, execution_error: status === 'failed' ? 'boom' : null } }
  }
  return { request, calls }
}

const RECORD = { jobId: 'job-1', toolName: 'video_generate', params: '{"prompt":"p","duration":5}' }

test('台账：提交即落地（pending），重复提交幂等；文件结构与版本号稳定', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-videojobs-'))
  try {
    const registry = stubRegistry(dir)
    await recordDramaJobSubmitted(registry, 'p1', RECORD)
    await recordDramaJobSubmitted(registry, 'p1', RECORD)
    const jobs = await readDramaJobs(registry, 'p1')
    assert.equal(jobs.length, 1)
    assert.equal(jobs[0].status, 'pending')
    assert.equal(jobs[0].projectId, 'p1')
    assert.equal(jobs[0].toolName, 'video_generate')
    const document = JSON.parse(await readFile(dramaJobsFileOf(registry, 'p1'), 'utf8'))
    assert.equal(document.version, DRAMA_JOBS_VERSION)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('台账：状态回写流转 pending → in_progress → completed（带 result）；缺记录/终态不动', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-videojobs-'))
  try {
    const registry = stubRegistry(dir)
    await recordDramaJobSubmitted(registry, 'p1', RECORD)
    await updateDramaJobStatus(registry, 'p1', 'job-1', 'in_progress')
    await updateDramaJobStatus(registry, 'p1', 'job-1', 'completed', { result: { filename: 'out.mp4', fullUrl: 'https://x/out.mp4' } })
    let jobs = await readDramaJobs(registry, 'p1')
    assert.equal(jobs[0].status, 'completed')
    assert.equal(jobs[0].result?.filename, 'out.mp4')

    // 终态保护：settled 后迟到的 in_progress 不得打回去。
    await updateDramaJobStatus(registry, 'p1', 'job-1', 'settled')
    await updateDramaJobStatus(registry, 'p1', 'job-1', 'in_progress')
    jobs = await readDramaJobs(registry, 'p1')
    assert.equal(jobs[0].status, 'settled')

    // 缺记录：不抛不写。
    await updateDramaJobStatus(registry, 'p1', 'job-unknown', 'failed')
    assert.equal((await readDramaJobs(registry, 'p1')).length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('台账：failed 记录 execution_error；isTerminalJobPhase 覆盖 failed/cancelled/settled', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-videojobs-'))
  try {
    const registry = stubRegistry(dir)
    await recordDramaJobSubmitted(registry, 'p1', RECORD)
    await updateDramaJobStatus(registry, 'p1', 'job-1', 'failed', { executionError: 'ComfyUI 崩了' })
    const jobs = await readDramaJobs(registry, 'p1')
    assert.equal(jobs[0].status, 'failed')
    assert.equal(jobs[0].executionError, 'ComfyUI 崩了')
    assert.equal(isTerminalJobPhase('failed'), true)
    assert.equal(isTerminalJobPhase('cancelled'), true)
    assert.equal(isTerminalJobPhase('settled'), true)
    assert.equal(isTerminalJobPhase('in_progress'), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('扫描：pendingDramaJobs 汇总多项目非终态任务，跳过损坏文件', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-videojobs-'))
  try {
    const registry = stubRegistry(dir, ['p1', 'p2'])
    await recordDramaJobSubmitted(registry, 'p1', RECORD)
    await recordDramaJobSubmitted(registry, 'p2', { ...RECORD, jobId: 'job-2' })
    await updateDramaJobStatus(registry, 'p2', 'job-2', 'settled')
    const pending = await pendingDramaJobs(registry)
    assert.deepEqual(pending.map((entry) => entry.jobId), ['job-1'], 'settled 不再入恢复扫描')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('恢复轮询：completed → 取 result → settle 回调；台账随状态流转', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-videojobs-'))
  try {
    const registry = stubRegistry(dir)
    await recordDramaJobSubmitted(registry, 'p1', RECORD)
    const { request, calls } = makeRequest({ statusSequence: ['in_progress', 'completed'] })
    const settled = []
    const watcher = startDramaJobResumeWatcher({
      registry,
      request,
      settle: async (record, result) => {
        settled.push({ jobId: record.jobId, filename: result.filename })
      },
      pollIntervalMs: 5,
    })
    await waitFor(() => settled.length === 1, 3000, 'settle 被回调')
    watcher.stop()
    const jobs = await readDramaJobs(registry, 'p1')
    assert.equal(jobs[0].status, 'completed', 'watcher 只到 completed；settled 由结算方（generate.ts）回写')
    assert.equal(jobs[0].result?.fullUrl, 'https://media.example/out.mp4')
    assert.ok(calls.some((c) => c.path.endsWith('/result')), 'completed 后取了 result')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('恢复轮询：failed 落终态（带错误详情），404 判任务消失，瞬时错误不放弃', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-videojobs-'))
  try {
    const registry = stubRegistry(dir)
    // —— failed
    await recordDramaJobSubmitted(registry, 'p1', RECORD)
    const failed = makeRequest({ statusSequence: ['failed'] })
    let watcher = startDramaJobResumeWatcher({ registry, request: failed.request, settle: async () => {}, pollIntervalMs: 5 })
    await waitFor(async () => (await readDramaJobs(registry, 'p1'))[0].status === 'failed', 3000, 'failed 落终态')
    watcher.stop()
    assert.equal((await readDramaJobs(registry, 'p1'))[0].executionError, 'boom')

    // —— 404（任务消失）
    await recordDramaJobSubmitted(registry, 'p1', { ...RECORD, jobId: 'job-2' })
    const missing = { request: async (_method, path) => ({ status: 404, json: { detail: 'Job not found' } }), calls: [] }
    watcher = startDramaJobResumeWatcher({ registry, request: missing.request, settle: async () => {}, pollIntervalMs: 5 })
    await waitFor(async () => (await readDramaJobs(registry, 'p1')).find((entry) => entry.jobId === 'job-2')?.status === 'failed', 3000, '404 落 failed')
    watcher.stop()
    assert.match((await readDramaJobs(registry, 'p1')).find((entry) => entry.jobId === 'job-2').executionError, /404/)

    // —— 瞬时错误容忍：先失败两拍，再 completed，settle 仍被回调
    await recordDramaJobSubmitted(registry, 'p1', { ...RECORD, jobId: 'job-3' })
    const transient = makeRequest({ statusSequence: ['completed'], failFirst: 2 })
    const settled = []
    watcher = startDramaJobResumeWatcher({ registry, request: transient.request, settle: async (record, result) => { settled.push(result.filename) }, pollIntervalMs: 5 })
    await waitFor(() => settled.length === 1, 3000, '瞬时错误后仍能结算')
    watcher.stop()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('恢复轮询：cancelled 落终态；settle 抛错时保持 completed（下一轮重试）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-videojobs-'))
  try {
    const registry = stubRegistry(dir)
    // —— cancelled
    await recordDramaJobSubmitted(registry, 'p1', RECORD)
    let watcher = startDramaJobResumeWatcher({
      registry,
      request: makeRequest({ statusSequence: ['cancelled'] }).request,
      settle: async () => {},
      pollIntervalMs: 5,
    })
    await waitFor(async () => (await readDramaJobs(registry, 'p1'))[0].status === 'cancelled', 3000, 'cancelled 落终态')
    watcher.stop()

    // —— settle 抛错：台账留在 completed，settle 会被再次调用
    await recordDramaJobSubmitted(registry, 'p1', { ...RECORD, jobId: 'job-4' })
    let attempts = 0
    watcher = startDramaJobResumeWatcher({
      registry,
      request: makeRequest({ statusSequence: ['completed'] }).request,
      settle: async () => {
        attempts += 1
        if (attempts < 2) throw new Error('磁盘抖动')
      },
      pollIntervalMs: 5,
    })
    await waitFor(() => attempts >= 2, 3000, 'settle 失败后重试')
    watcher.stop()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
