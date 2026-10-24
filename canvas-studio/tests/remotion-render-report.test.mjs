/**
 * REQ-034 · 三期 W6：抽帧回写 + 渲染报告（宿主半）单测。
 *
 * 覆盖三件事：
 *   1. 工单视图把 `quality` / `realDurations` / `sampleFrames` 透传给客户端
 *      （少传一个，客户端就会重复探测 / 拉错质量档 / 抽错帧，而且**没有任何报错**）；
 *   2. `recordRenderSample` 落盘 PNG 并按帧号排序进结算产物（幂等、坏入参返回 null）；
 *   3. `commitRenderJob` 的报告里，**宿主测得到的字段优先**（质量档 / 帧数 / 字节数 /
 *      抽帧数），客户端上报只补宿主测不到的耗时与码率。
 *
 * 直连 Host tsc 编译产物 `lib/remotion/render-job.js`。
 * 定向跑：node --test tests/remotion-render-report.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  commitRenderJob,
  cancelRenderJob,
  pendingRenderJobFor,
  recordRenderSample,
  runRenderJob,
} from '../lib/remotion/render-job.js'
import { pickSampleFrames } from '../lib/remotion/timing.js'
import { ProjectRegistry } from '../lib/projects.js'
import '../lib/errors/catalog.js'

function minimalManifest(meta = {}) {
  return {
    id: 'm-report',
    meta: { title: '报告测试', width: 1280, height: 720, fps: 30, durationInFrames: 120, ...meta },
    tracks: [
      { id: 't-title', type: 'textCard', variant: 'title', text: '标题卡', startFrame: 0, durationInFrames: 120 },
    ],
  }
}

const FAKE_MP4 = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70])
const FAKE_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

async function withProject(run) {
  const dir = await mkdtemp(join(tmpdir(), 'cs-render-report-'))
  try {
    const registry = new ProjectRegistry(dir)
    const project = await registry.create('渲染报告测试')
    await run({ registry, project })
  } finally {
    // 清理失败**不许**把一条已通过的用例判红：沙箱 / 只读盘会拒绝递归删除临时目录，
    // 而那是环境属性、不是被测行为（实测：同一份代码在放行时全绿、收紧时 6/6 红）。
    // 临时目录由系统回收，这里尽力而为。
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

test('工单视图透传 quality / realDurations / sampleFrames（缺省 standard + 自动抽帧位置）', async () => {
  await withProject(async ({ project }) => {
    const manifest = minimalManifest()
    const pending = runRenderJob({ projectId: project.id, manifest, timeoutMs: 5_000 })
    const view = pendingRenderJobFor(project.id)

    assert.equal(view.quality, 'standard', '缺省质量档必须是 standard（= 今天全部默认值）')
    assert.deepEqual(view.realDurations, {}, '没探到真值就给空表（客户端据此决定是否自己探）')
    assert.deepEqual(view.sampleFrames, pickSampleFrames(manifest), '抽帧位置必须与宿主共用同一份实现')
    assert.ok(view.sampleFrames.length >= 1)

    cancelRenderJob(view.jobId, {})
    await assert.rejects(() => pending, (err) => err.code === 'CS-GEN-207')
  })
})

test('工单视图：显式入参优先，manifest.meta.quality 次之', async () => {
  await withProject(async ({ project }) => {
    const explicit = runRenderJob({
      projectId: project.id,
      manifest: minimalManifest({ quality: 'draft' }),
      quality: 'high',
      realDurations: { '/canvas-studio/assets/p/a.mp4': 12.5 },
      sampleFrames: [0, 40],
      timeoutMs: 5_000,
    })
    const view = pendingRenderJobFor(project.id)
    assert.equal(view.quality, 'high', '显式参数覆盖 meta')
    assert.deepEqual(view.realDurations, { '/canvas-studio/assets/p/a.mp4': 12.5 })
    assert.deepEqual(view.sampleFrames, [0, 40], '宿主给了抽帧位置就用宿主的（同一片抽同一批帧）')
    cancelRenderJob(view.jobId, {})
    await assert.rejects(() => explicit, (err) => err.code === 'CS-GEN-207')

    const fromMeta = runRenderJob({ projectId: project.id, manifest: minimalManifest({ quality: 'draft' }), timeoutMs: 5_000 })
    assert.equal(pendingRenderJobFor(project.id).quality, 'draft', 'manifest.meta.quality 应作为兜底')
    const view2 = pendingRenderJobFor(project.id)
    cancelRenderJob(view2.jobId, {})
    await assert.rejects(() => fromMeta, (err) => err.code === 'CS-GEN-207')
  })
})

test('recordRenderSample：落盘 PNG 并按帧号排序进结算产物', async () => {
  await withProject(async ({ registry, project }) => {
    const pending = runRenderJob({ projectId: project.id, manifest: minimalManifest(), timeoutMs: 5_000 })
    const view = pendingRenderJobFor(project.id)

    // 故意乱序回写：结算产物必须按帧号排（预览 / 报告都依赖稳定顺序）
    const late = await recordRenderSample(registry, view.jobId, 90, FAKE_PNG)
    const early = await recordRenderSample(registry, view.jobId, 10, FAKE_PNG)
    assert.notEqual(late, null)
    assert.notEqual(early, null)
    assert.match(late.url, new RegExp(`^/canvas-studio/assets/${project.id}/`))
    assert.match(late.url, /\.png$/)
    // ⚠️ 落盘名由 `saveLocalAssetBytes` 生成（帧号**不**进文件名）；帧号的真值只在
    // `frames[].frame` 里 —— 这条断言就是防止有人回头去猜文件名里的帧号。
    assert.doesNotMatch(late.url, /-f0090\.png$/, '不要把帧号编码进文件名：落盘名由共享助手决定')

    await commitRenderJob(registry, view.jobId, { bytes: FAKE_MP4 })
    const outcome = await pending
    assert.deepEqual(outcome.frames.map((sample) => sample.frame), [10, 90], '抽帧必须按帧号升序')
    assert.equal(outcome.report.sampledFrames, 2, '报告里的抽帧数取自宿主真实落盘数')
  })
})

test('recordRenderSample：未知 jobId / 空字节 ⇒ null（路由据此回 200 幂等）', async () => {
  await withProject(async ({ registry, project }) => {
    assert.equal(await recordRenderSample(registry, 'rj-does-not-exist', 0, FAKE_PNG), null)

    const pending = runRenderJob({ projectId: project.id, manifest: minimalManifest(), timeoutMs: 5_000 })
    const view = pendingRenderJobFor(project.id)
    assert.equal(await recordRenderSample(registry, view.jobId, 0, new Uint8Array(0)), null, '空字节不该落盘')
    assert.equal(await recordRenderSample(registry, view.jobId, -5, FAKE_PNG) !== null, true, '负帧号收敛到 0 而不是拒收')

    const clamped = await recordRenderSample(registry, view.jobId, Number.NaN, FAKE_PNG)
    assert.equal(clamped.frame, 0)

    cancelRenderJob(view.jobId, {})
    await assert.rejects(() => pending, (err) => err.code === 'CS-GEN-207')
    // 已结算的工单再来一张抽帧 ⇒ null（不写脏文件）
    assert.equal(await recordRenderSample(registry, view.jobId, 5, FAKE_PNG), null)
  })
})

test('渲染报告：宿主字段优先，客户端只补耗时 / 码率', async () => {
  await withProject(async ({ registry, project }) => {
    const pending = runRenderJob({
      projectId: project.id,
      manifest: minimalManifest(),
      quality: 'draft',
      timeoutMs: 5_000,
    })
    const view = pendingRenderJobFor(project.id)

    await commitRenderJob(registry, view.jobId, {
      bytes: FAKE_MP4,
      report: {
        totalMs: 12_345,
        msPerFrame: 102.9,
        prepareMs: 7_000,
        renderMs: 5_345,
        encodeDoneAtMs: 4_321,
        bitrateKbps: 3_500,
        // 下面这些宿主一定能自己算出来 ⇒ 客户端上报必须被忽略（防止两边口径漂移）
        quality: 'high',
        frames: 999,
        bytes: 1,
        sampledFrames: 42,
      },
    })
    const outcome = await pending

    assert.equal(outcome.report.quality, 'draft', '质量档以宿主工单为准')
    assert.equal(outcome.report.frames, 120, '帧数取 manifest 声明值')
    assert.equal(outcome.report.bytes, FAKE_MP4.length, '字节数取真实落盘长度')
    assert.equal(outcome.report.sampledFrames, 0, '抽帧数取宿主真实记录')
    assert.equal(outcome.report.totalMs, 12_345, '总耗时只能由客户端上报')
    assert.equal(outcome.report.encodeDoneAtMs, 4_321)
    assert.equal(outcome.report.bitrateKbps, 3_500)
    assert.ok(outcome.report.msPerFrame > 0)
  })
})

test('渲染报告：客户端没上报时全部兜底为 0（不产生 NaN / undefined）', async () => {
  await withProject(async ({ registry, project }) => {
    const pending = runRenderJob({ projectId: project.id, manifest: minimalManifest(), timeoutMs: 5_000 })
    const view = pendingRenderJobFor(project.id)
    await commitRenderJob(registry, view.jobId, { bytes: FAKE_MP4 })
    const outcome = await pending

    for (const key of ['totalMs', 'prepareMs', 'renderMs', 'msPerFrame', 'encodeDoneAtMs', 'bitrateKbps', 'width', 'height']) {
      assert.equal(typeof outcome.report[key], 'number', `report.${key} 必须是数字`)
      assert.ok(Number.isFinite(outcome.report[key]), `report.${key} 不得是 NaN`)
    }
    assert.equal(outcome.report.sampledFrames, 0)
    assert.equal(outcome.report.prepareMs, 0, '客户端没上报准备耗时时兜底 0')
  })
})
