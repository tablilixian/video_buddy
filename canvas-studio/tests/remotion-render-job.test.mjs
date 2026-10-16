/**
 * REQ-034 · B3（CV-327）route B（CSR）渲染**工单桥**宿主段契约测试。
 *
 * 覆盖 `src/remotion/render-job.ts` 的四条结算路径 —— 不启浏览器、不跑真 CSR：
 *   1. 建单 → 客户端可见（`pendingRenderJobFor`）→ 回写结算（落盘 + 探真值）；
 *   2. 回写的坏入参：未知 / 已结算 jobId、空字节；
 *   3. 客户端长时间不回写 → 超时（`CS-RENDER-TIMEOUT`）且工单表归零；
 *   4. 客户端撤单：失败（`CS-RENDER-002`）/ 主动取消（`CS-GEN-207`）+ 幂等；
 *   5. abort（用户打断本轮）→ `CS-GEN-207`。
 *
 * 真机 CSR 渲染（`renderMediaOnWeb`）跑不了无头，只能用带 GUI 的桌面会话走
 * `docs/acceptance-test-cases.md` 第二十九 · Z 组；这里守的是宿主半的**状态机**。
 *
 * 从 `../lib/*.js` 导入 —— 先 build（`yarn workspace canvas-studio build`）再跑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  activeRenderJobCount,
  cancelRenderJob,
  commitRenderJob,
  pendingRenderJobFor,
  runRenderJob,
} from '../lib/remotion/render-job.js'
import { validateManifest } from '../lib/remotion/manifest.js'
import { ProjectRegistry } from '../lib/projects.js'
import '../lib/errors/catalog.js'

/** 一个**校验必过**的最小 Manifest（纯呈现轨，不依赖任何素材文件）。 */
function minimalManifest() {
  return {
    id: 'm-test',
    meta: { title: '测试片', width: 1280, height: 720, fps: 30, durationInFrames: 60 },
    tracks: [
      { id: 't-title', type: 'textCard', variant: 'title', text: '标题卡', startFrame: 0, durationInFrames: 60 },
    ],
  }
}

/** 非空字节即可：`saveLocalAssetBytes` 按扩展名分类，`probeMediaInfo` 对坏文件回落 duration 0。 */
const FAKE_MP4 = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70])

async function withProject(run) {
  const dir = await mkdtemp(join(tmpdir(), 'cs-render-job-'))
  try {
    const registry = new ProjectRegistry(dir)
    const project = await registry.create('渲染工单测试')
    await run({ registry, project, dir })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('前置：测试用 Manifest 必须通过 validateManifest（否则工单桥测不到真东西）', () => {
  const result = validateManifest(minimalManifest())
  assert.deepEqual(result.errors, [], `最小 Manifest 不合法：${result.errors.join('；')}`)
})

test('建单 → 客户端可见 → 回写结算（落盘 + 探真值）', async () => {
  await withProject(async ({ registry, project }) => {
    const manifest = minimalManifest()
    const before = activeRenderJobCount()
    const pending = runRenderJob({ projectId: project.id, manifest, timeoutMs: 5_000 })

    // 建单是同步的（Promise executor 立即跑）：马上就能被客户端看到。
    assert.equal(activeRenderJobCount(), before + 1)
    const view = pendingRenderJobFor(project.id)
    assert.notEqual(view, null)
    assert.equal(view.projectId, project.id)
    assert.equal(view.fps, 30, 'fps 缺省取 manifest.meta.fps')
    assert.deepEqual(view.manifest, manifest)

    const committed = await commitRenderJob(registry, view.jobId, {
      bytes: FAKE_MP4,
      warnings: ['字体降级：Noto Sans SC → fallback'],
    })
    assert.equal(committed.ok, true)
    assert.match(committed.url, new RegExp(`^/canvas-studio/assets/${project.id}/`))
    assert.match(committed.assetFile, /\.mp4$/)
    assert.equal(typeof committed.duration, 'number')

    const outcome = await pending
    assert.equal(outcome.assetFile, committed.assetFile)
    assert.ok(outcome.warnings.includes('字体降级：Noto Sans SC → fallback'), '客户端上报的告警必须原样带上')
    if (outcome.duration <= 0) {
      assert.ok(
        outcome.warnings.some((w) => w.includes('未能探测成片真实时长')),
        '探测失败必须补一条告警（不静默）',
      )
    }

    // 结算后：工单表归零，客户端再也看不到。
    assert.equal(activeRenderJobCount(), before)
    assert.equal(pendingRenderJobFor(project.id), null)
  })
})

test('回写的坏入参：未知 jobId / 已结算 jobId / 空字节', async () => {
  await withProject(async ({ registry, project }) => {
    await assert.rejects(
      () => commitRenderJob(registry, 'rj-does-not-exist', { bytes: FAKE_MP4 }),
      (err) => err.code === 'CS-RENDER-002',
    )

    const pending = runRenderJob({ projectId: project.id, manifest: minimalManifest(), timeoutMs: 5_000 })
    const view = pendingRenderJobFor(project.id)
    await assert.rejects(
      () => commitRenderJob(registry, view.jobId, { bytes: new Uint8Array(0) }),
      (err) => err.code === 'CS-USER-ERR',
      '空字节不该被当成一张有效成片落盘',
    )
    // 坏入参不结算工单 —— 客户端还能重试回写。
    assert.equal(activeRenderJobCount() > 0, true)
    assert.equal(cancelRenderJob(view.jobId, {}), true, '收尾：撤单释放工单')
    await assert.rejects(() => pending, (err) => err.code === 'CS-GEN-207')
  })
})

test('客户端长时间不回写 → CS-RENDER-TIMEOUT 且工单表归零', async () => {
  await withProject(async ({ project }) => {
    const before = activeRenderJobCount()
    await assert.rejects(
      () => runRenderJob({ projectId: project.id, manifest: minimalManifest(), timeoutMs: 20 }),
      (err) => err.code === 'CS-RENDER-TIMEOUT',
    )
    assert.equal(activeRenderJobCount(), before, '超时必须把自己从工单表摘掉，否则泄漏')
  })
})

test('客户端撤单：失败 CS-RENDER-002 / 主动取消 CS-GEN-207 / 幂等', async () => {
  await withProject(async ({ project }) => {
    const failedJob = runRenderJob({ projectId: project.id, manifest: minimalManifest(), timeoutMs: 5_000 })
    const failedView = pendingRenderJobFor(project.id)
    assert.equal(cancelRenderJob(failedView.jobId, { failed: true, reason: '浏览器不支持 h264' }), true)
    await assert.rejects(
      () => failedJob,
      (err) => err.code === 'CS-RENDER-002' && err.message.includes('浏览器不支持 h264'),
    )

    const cancelJob = runRenderJob({ projectId: project.id, manifest: minimalManifest(), timeoutMs: 5_000 })
    const cancelView = pendingRenderJobFor(project.id)
    assert.equal(cancelRenderJob(cancelView.jobId, {}), true)
    await assert.rejects(() => cancelJob, (err) => err.code === 'CS-GEN-207')
    assert.equal(cancelRenderJob(cancelView.jobId, {}), false, '重复撤单必须幂等返回 false（路由回 200）')
  })
})

test('abort：建单前已打断立即 CS-GEN-207（不建单）；建单中打断同样 CS-GEN-207', async () => {
  await withProject(async ({ project }) => {
    const before = activeRenderJobCount()

    const pre = new AbortController()
    pre.abort()
    await assert.rejects(
      () => runRenderJob({ projectId: project.id, manifest: minimalManifest(), signal: pre.signal }),
      (err) => err.code === 'CS-GEN-207',
    )
    assert.equal(activeRenderJobCount(), before, '预打断不得留下工单')

    const mid = new AbortController()
    const pending = runRenderJob({ projectId: project.id, manifest: minimalManifest(), timeoutMs: 5_000, signal: mid.signal })
    mid.abort()
    await assert.rejects(() => pending, (err) => err.code === 'CS-GEN-207')
    assert.equal(activeRenderJobCount(), before)
  })
})
