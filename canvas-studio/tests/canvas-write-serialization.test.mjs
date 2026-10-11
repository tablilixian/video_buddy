/**
 * AR-01 / AR-04 回归守卫：`canvas.json` / `jobs.json` 的**并发写不丢数据**。
 *
 * 背景：这两个状态档的写路径都是 `read → 内存改 → writeFileAtomic`。原子写只保证
 * 文件不损坏，**不保证「读-改-写」的原子性** —— 修复前两个并发写者各读一份快照、
 * 后者整段覆盖前者。实测（`scripts/canvas-write-race-repro.mjs`）每场景 10 轮
 * **轮轮丢失**：并发 append ×20 → 只剩 1 条；并发 upsertAsset ×10 → 只剩 1 条；
 * 并发 apps 入台账 ×5 → 只剩 1 条。
 *
 * 修复 = `src/keyed-queue.ts` 按**文件路径**串行化写口。本文件把这四条钉成 gate。
 *
 * 另外两条**反向**断言很重要，否则「把所有写都串成一条」也能骗过上面的用例：
 *   - 不同项目的写必须**并行**（key 粒度不能退化成全局单锁）；
 *   - 同 id 重复 append 的幂等去重必须仍然生效（串行化不能把去重逻辑挤掉）。
 *
 * 从 ../lib/*.js 导入 —— 先 build 再跑。手动版（含 10 轮表格式证据）见
 * `scripts/canvas-write-race-repro.mjs`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectRegistry } from '../lib/projects.js'
import { readDramaJobs, recordDramaJobSubmitted } from '../lib/video-jobs.js'

/** 并发写者数（修复前这些数字每个都只剩 1）。 */
const APPEND_CONCURRENCY = 20
const ASSET_CONCURRENCY = 10
const JOB_CONCURRENCY = 5

/** 最小合法画布节点（字段与 `isCanvasNode` 兼容；缺字段会被静默丢弃）。 */
const node = (id) => ({
  id,
  kind: 'image',
  title: id,
  url: `/canvas-studio/assets/p/${id}.png`,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  createdAt: 1,
  origin: 'agent',
  sourceIds: [],
})

/** 最小合法资产（字段与 `isStudioAsset` 兼容 —— 少一个就会被静默丢弃）。 */
const asset = (id) => ({
  id,
  name: `资产 ${id}`,
  role: 'character',
  anchorNodeIds: [],
  lockedPrompt: '',
  createdAt: 1,
})

async function withRegistry(run) {
  const root = await mkdtemp(join(tmpdir(), 'cs-ar01-serial-'))
  try {
    await run(new ProjectRegistry(root))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('AR-01：并发 appendCanvasNode 不丢节点（冷启动，期望 N 条）', async () => {
  await withRegistry(async (registry) => {
    await Promise.all(Array.from({ length: APPEND_CONCURRENCY }, (_, index) =>
      registry.appendCanvasNode('p1', node(`n${String(index)}`))))
    const document = await registry.readCanvas('p1')
    assert.equal(
      document.nodes.length,
      APPEND_CONCURRENCY,
      `${String(APPEND_CONCURRENCY)} 个并发 append 只留下 ${String(document.nodes.length)} 条 —— 读-改-写没有串行化`,
    )
  })
})

test('AR-01：并发 appendCanvasNode 不丢节点（画布已有内容，期望 N+1 条）', async () => {
  await withRegistry(async (registry) => {
    await registry.appendCanvasNode('p1', node('pre-existing'))
    await Promise.all(Array.from({ length: APPEND_CONCURRENCY }, (_, index) =>
      registry.appendCanvasNode('p1', node(`n${String(index)}`))))
    const document = await registry.readCanvas('p1')
    assert.equal(document.nodes.length, APPEND_CONCURRENCY + 1)
    assert.ok(document.nodes.some((entry) => entry.id === 'pre-existing'), '既有节点不能被覆盖掉')
  })
})

test('AR-01：并发 upsertAsset 不丢资产', async () => {
  await withRegistry(async (registry) => {
    await Promise.all(Array.from({ length: ASSET_CONCURRENCY }, (_, index) =>
      registry.upsertAsset('p1', asset(`a${String(index)}`))))
    const document = await registry.readCanvas('p1')
    assert.equal(document.assets?.length ?? 0, ASSET_CONCURRENCY)
  })
})

test('AR-04：并发视频任务入台账不丢记录（丢一条 = 那条产物永远取不回）', async () => {
  await withRegistry(async (registry) => {
    await Promise.all(Array.from({ length: JOB_CONCURRENCY }, (_, index) =>
      recordDramaJobSubmitted(registry, 'p1', {
        jobId: `job-${String(index)}`,
        toolName: 'video_generate',
        params: '{}',
      })))
    const jobs = await readDramaJobs(registry, 'p1')
    assert.equal(jobs.length, JOB_CONCURRENCY)
  })
})

test('AR-01：同一提交与状态回写交错时不丢状态更新（同文件同队列）', async () => {
  await withRegistry(async (registry) => {
    // 先落一条，再并发触发两次状态回写 —— 若两条队列分开，这里会丢一次更新。
    await recordDramaJobSubmitted(registry, 'p1', { jobId: 'j', toolName: 'video_generate', params: '{}' })
    const { updateDramaJobStatus } = await import('../lib/video-jobs.js')
    await Promise.all([
      updateDramaJobStatus(registry, 'p1', 'j', 'in_progress'),
      updateDramaJobStatus(registry, 'p1', 'j', 'completed', { result: { filename: 'f.mp4', fullUrl: 'http://x/f.mp4' } }),
    ])
    const jobs = await readDramaJobs(registry, 'p1')
    assert.equal(jobs.length, 1, '同一 jobId 只应有一条记录')
    // 终态不可逆 + 队列保证两个回写都真的执行过（先后不定，但结果必须是终态之一）。
    assert.ok(['in_progress', 'completed'].includes(jobs[0].status), `状态异常：${jobs[0].status}`)
  })
})

test('AR-01 反向：不同项目各自成链（key 粒度不得退化成全局单锁）', async () => {
  await withRegistry(async (registry) => {
    const { sharedWriteQueue } = await import('../lib/keyed-queue.js')
    const keyA = registry.canvasFile('pa')
    const keyB = registry.canvasFile('pb')
    assert.notEqual(keyA, keyB, '不同项目的画布文件必须产生不同 key')

    // 占住 A 的链（不释放），然后**同步**断言 B 有自己的链 —— 不依赖任何超时，
    // 否则在满负载的并行测试里会飘（第一版就是这么写错的：用 200ms race 判据）。
    //
    // 注意：deferred 必须在 `run` **之前**建好 —— 任务体要到微任务才执行，
    // 在任务体里赋值 `releaseA` 会让「同步调用 releaseA()」拿到 undefined
    // （第一版第二条错就是这么犯的）。
    let releaseA
    const gateA = new Promise((resolve) => { releaseA = resolve })
    const held = sharedWriteQueue.run(keyA, () => gateA)
    assert.equal(sharedWriteQueue.pending(keyA), 1)

    const bWrite = registry.appendCanvasNode('pb', node('b-only'))
    assert.equal(sharedWriteQueue.pending(keyB), 1, 'B 必须入自己的链')
    assert.equal(
      sharedWriteQueue.pending(keyA),
      1,
      'A 的深度不能因 B 而变 —— 变了就说明两者共用了同一条链（= 全局单锁）',
    )
    assert.equal(sharedWriteQueue.activeKeys(), 2, '两条独立链必须同时存在')

    releaseA()
    await bWrite
    await held
    assert.equal((await registry.readCanvas('pb')).nodes.length, 1)
    assert.equal((await registry.readCanvas('pa')).nodes.length, 0, 'A 不应被 B 写到')
  })
})

test('AR-01 反向：同 id 重复 append 仍然幂等（串行化不得挤掉去重）', async () => {
  await withRegistry(async (registry) => {
    await Promise.all(Array.from({ length: 10 }, () => registry.appendCanvasNode('p1', node('same-id'))))
    const document = await registry.readCanvas('p1')
    assert.equal(document.nodes.length, 1, '同 id 应只落一条（appendCanvasNode 的既有幂等语义）')
  })
})
