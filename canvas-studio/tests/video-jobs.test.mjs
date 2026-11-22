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
  recordGenerationIntent,
  recordGenerationSubmitted,
  startDramaJobResumeWatcher,
  updateDramaJobStatus,
  updateGenerationSnapshot,
} from '../lib/video-jobs.js'

/** registry 打桩：每项目一个独立子目录（台账按项目分文件）。 */
function stubRegistry(rootDir, projectIds = ['p1']) {
  const dirOf = new Map(projectIds.map((id) => [id, join(rootDir, id)]))
  return {
    list: async () => projectIds.map((id) => ({ id, name: id, dir: dirOf.get(id), createdAt: 1 })),
    projectDir: (projectId) => dirOf.get(projectId) ?? join(rootDir, projectId),
  }
}

/**
 * 轮询墙面预算：原为 3_000。全量冒烟（几十个测试进程并发 + 磁盘写台账）时偶发假红 ——
 * 3s 是空载期望，满载墙钟不可靠属于环境属性、不是被测行为。放宽到 15s，真卡死照样红。
 */
const WAIT_BUDGET_MS = 15_000

/**
 * 清理临时目录 —— **失败不许判红**：本机沙箱会拒绝递归删除 `$TMPDIR` 下的目录
 * （实测 EPERM，连测试自己刚建的目录都删不掉）。那是环境属性、不是被测行为，
 * 与 `remotion-render-report.test.mjs` 的 `withProject` 同一取向。
 */
async function cleanup(dir) {
  try {
    await rm(dir, { recursive: true, force: true })
  } catch {
    /* 环境拒绝删除：忽略（残留由系统临时目录自己回收） */
  }
}

/** 轮询等待条件成立（watcher 是异步定时器链，不能用同步断言）。 */
async function waitFor(condition, timeoutMs = WAIT_BUDGET_MS, label = 'condition') {
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
    await cleanup(dir)
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
    await cleanup(dir)
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
    await cleanup(dir)
  }
})

test('扫描：只入 business 非终态记录；v1 旧记录原样保留不处置（拍板 ③）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-videojobs-'))
  try {
    const registry = stubRegistry(dir, ['p1', 'p2'])
    // v1 legacy 记录（8082 时代）：不落终态、不删除，但也不入恢复扫描。
    await recordDramaJobSubmitted(registry, 'p1', RECORD)
    // business 记录（台账 v2）：intent 占位 + 202 后补 generationId。
    const intent = { key: 'idem-1', body: { model: 'video.minimax_h3', operation: 'image2videofl2va', inputs: [] } }
    await recordGenerationIntent(registry, 'p2', { intent, toolName: 'video_generate', params: '{"prompt":"p"}' })
    await recordGenerationSubmitted(registry, 'p2', { intentKey: 'idem-1', generationId: 'gen-2', version: 1 })
    await updateDramaJobStatus(registry, 'p2', 'gen-2', 'settled')
    const pending = await pendingDramaJobs(registry)
    assert.deepEqual(pending.map((entry) => entry.jobId), [], 'legacy 不入扫描；settled business 也不入')
    // business 非终态记录正常入扫描；v1 记录仍留在台账（原样保留）。
    const intent2 = { key: 'idem-2', body: { model: 'video.minimax_h3', operation: 'image2videofl2va', inputs: [] } }
    await recordGenerationIntent(registry, 'p1', { intent: intent2, toolName: 'video_generate', params: '{"prompt":"p"}' })
    await recordGenerationSubmitted(registry, 'p1', { intentKey: 'idem-2', generationId: 'gen-1', version: 1 })
    const pending2 = await pendingDramaJobs(registry)
    assert.deepEqual(pending2.map((entry) => entry.jobId), ['gen-1'])
    const all = await readDramaJobs(registry, 'p1')
    assert.equal(all.length, 2, 'v1 记录与 business 记录并存（v1 不清理）')
  } finally {
    await cleanup(dir)
  }
})

test('恢复（business）：resumeBusiness 全权处理——终态 succeeded 由闭包落 settled', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-videojobs-'))
  try {
    const registry = stubRegistry(dir)
    const intent = { key: 'idem-1', body: {} }
    await recordGenerationIntent(registry, 'p1', { intent, toolName: 'video_generate', params: '{"prompt":"p"}' })
    await recordGenerationSubmitted(registry, 'p1', { intentKey: 'idem-1', generationId: 'gen-1', version: 1 })
    await updateDramaJobStatus(registry, 'p1', 'gen-1', 'in_progress')
    const resumed = []
    const watcher = startDramaJobResumeWatcher({
      registry,
      resumeBusiness: async (record) => {
        resumed.push({ jobId: record.jobId, version: record.version })
        await updateGenerationSnapshot(registry, 'p1', record.jobId, { status: 'succeeded', version: 9 })
        await updateDramaJobStatus(registry, 'p1', record.jobId, 'settled')
      },
    })
    await waitFor(async () => (await readDramaJobs(registry, 'p1'))[0].status === 'settled', WAIT_BUDGET_MS, 'resume 落 settled')
    await watcher.stop()
    assert.deepEqual(resumed, [{ jobId: 'gen-1', version: 1 }], '恢复闭包收到台账记录（含 version 游标）')
  } finally {
    await cleanup(dir)
  }
})

test('恢复（business）：failed/cancelled 落终态；瞬时错误不落终态（下次 Host 重启再试）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-videojobs-'))
  try {
    const registry = stubRegistry(dir)
    // —— failed：恢复闭包内按终态快照回写
    const intent = { key: 'idem-f', body: {} }
    await recordGenerationIntent(registry, 'p1', { intent, toolName: 'video_generate', params: '{"prompt":"p"}' })
    await recordGenerationSubmitted(registry, 'p1', { intentKey: 'idem-f', generationId: 'gen-f', version: 1 })
    let calls = 0
    let watcher = startDramaJobResumeWatcher({
      registry,
      resumeBusiness: async (record) => {
        calls += 1
        await updateGenerationSnapshot(registry, 'p1', record.jobId, { status: 'failed', version: 5, error: { code: 'provider_error', message: 'boom' } })
        throw new Error('unreachable after terminal write')
      },
    })
    await waitFor(async () => (await readDramaJobs(registry, 'p1'))[0].status === 'failed', WAIT_BUDGET_MS, 'failed 落终态')
    await watcher.stop()
    const failedRecord = (await readDramaJobs(registry, 'p1'))[0]
    assert.equal(failedRecord.executionError, 'provider_error: boom')
    assert.equal(failedRecord.version, 5, 'version 游标随快照回写')

    // —— 恢复闭包抛错（网络抖动）：台账保持非终态，watcher 不崩、其余任务继续
    const intent2 = { key: 'idem-g', body: {} }
    await recordGenerationIntent(registry, 'p1', { intent: intent2, toolName: 'video_generate', params: '{"prompt":"p"}' })
    await recordGenerationSubmitted(registry, 'p1', { intentKey: 'idem-g', generationId: 'gen-g', version: 1 })
    watcher = startDramaJobResumeWatcher({
      registry,
      resumeBusiness: async (record) => {
        if (record.jobId === 'gen-g') throw new Error('ECONNRESET')
      },
    })
    await waitFor(() => calls >= 1, 2_000, '首个恢复已发生')
    await watcher.stop()
    assert.equal((await readDramaJobs(registry, 'p1')).find((e) => e.jobId === 'gen-g').status, 'pending', '瞬时错误不落终态（下次 Host 重启再试）')
  } finally {
    await cleanup(dir)
  }
})

test('恢复（business）：intent 占位记录（响应丢失）也交给恢复闭包重放', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-videojobs-'))
  try {
    const registry = stubRegistry(dir)
    // 崩溃窗口：intent 已落、202 响应没等到 → jobId 仍是幂等键占位。
    const intent = { key: 'idem-x', body: { model: 'video.minimax_h3', operation: 'image2videofl2va', inputs: [] } }
    await recordGenerationIntent(registry, 'p1', { intent, toolName: 'video_generate', params: '{"prompt":"p"}' })
    const replayed = []
    const watcher = startDramaJobResumeWatcher({
      registry,
      resumeBusiness: async (record) => {
        replayed.push(record)
        // 闭包内按原 key+body 重放创建后回写 generationId（这里模拟其结果）。
        await recordGenerationSubmitted(registry, record.projectId, { intentKey: record.intent.key, generationId: 'gen-replayed', version: 1 })
        await updateDramaJobStatus(registry, record.projectId, 'gen-replayed', 'settled')
      },
    })
    await waitFor(async () => (await readDramaJobs(registry, 'p1')).some((e) => e.jobId === 'gen-replayed'), WAIT_BUDGET_MS, '重放创建回写 generationId')
    await watcher.stop()
    assert.equal(replayed[0].intent.key, 'idem-x', '恢复闭包拿到 intent（重放凭据）')
    assert.equal((await readDramaJobs(registry, 'p1')).length, 1, '占位记录被原地更新（不重复入册）')
  } finally {
    await cleanup(dir)
  }
})

/**
 * 回归（2026-11-05 全量冒烟唯一红）：`stop()` 必须等到循环真正退出才 resolve。
 *
 * 旧实现 fire-and-forget：`stop()` 立刻返回，但上一条循环还在 `activeResumeJobIds`
 * 里，紧接着用**同一 jobId** 启动的新 watcher 会在扫描阶段被 `continue` 跳过 ——
 * 于是新 watcher 空等一个只写旧目录的循环，15s 后假红。生产侧同一 jobId 不会二次
 * 启动，所以只有测试吃到；但「stop 之后还继续写台账」本身就该修。
 *
 * 这条用例在旧实现上必红：A 的循环还在跑时 B 拿不到 job-1。
 */
test('stop 会等循环退出：同一 jobId 紧接着重新启动能立刻接管', async () => {
  const dirA = await mkdtemp(join(tmpdir(), 'cs-videojobs-a-'))
  const dirB = await mkdtemp(join(tmpdir(), 'cs-videojobs-b-'))
  try {
    const registryA = stubRegistry(dirA)
    const intentA = { key: 'idem-a', body: {} }
    await recordGenerationIntent(registryA, 'p1', { intent: intentA, toolName: 'video_generate', params: '{}' })
    await recordGenerationSubmitted(registryA, 'p1', { intentKey: 'idem-a', generationId: 'gen-a', version: 1 })
    let inFlight = 0
    const watcherA = startDramaJobResumeWatcher({
      registry: registryA,
      resumeBusiness: async () => {
        inFlight += 1
        await new Promise((resolve) => setTimeout(resolve, 300))
      },
    })
    await waitFor(() => inFlight >= 1, WAIT_BUDGET_MS, 'A 已进入恢复闭包')
    await watcherA.stop()

    // B：同一 jobId（gen-a），不同目录；A 若没退干净，B 会被 activeResumeJobIds 挡掉。
    const registryB = stubRegistry(dirB)
    const intentB = { key: 'idem-b', body: {} }
    await recordGenerationIntent(registryB, 'p1', { intent: intentB, toolName: 'video_generate', params: '{}' })
    await recordGenerationSubmitted(registryB, 'p1', { intentKey: 'idem-b', generationId: 'gen-a', version: 1 })
    const settledB = []
    const watcherB = startDramaJobResumeWatcher({
      registry: registryB,
      resumeBusiness: async (record) => { settledB.push(record.jobId) },
    })
    await waitFor(() => settledB.length === 1, 5_000, 'B 接管同一 jobId')
    await watcherB.stop()
    assert.equal(settledB[0], 'gen-a')
  } finally {
    await cleanup(dirA)
    await cleanup(dirB)
  }
})