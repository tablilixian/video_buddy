/**
 * R11-B2（2026-11-16）· **分镜渲染编排**（装配层集成测试）
 *
 * 为什么要有这一层：R11 第一版把「段清装配」内联在 `host-tools.ts` 的 render handler
 * 里，零测试覆盖 —— 真机 P0（`frameRange`/`muteAudio` 漏传，每段按整片时长渲）就
 * 发生在这段纯装配上，而当时的纯函数测试全绿。本文件用**假渲染器 + 真缓存/真复制**
 * 驱动整条装配链，锁住四件事：
 *
 * ① 段产物流向正确：新渲段与**复用段**都要复制到 `deliver/segments/<id>.mp4`
 *    （复用段只留在 hash 缓存目录 ⇒ 交付目录少一段，用户看到「三段里有一段不存在」）；
 * ② 段序严格按段号拼接（按段号只验总时长验不出错位）；
 * ③ 段级抽帧回灌 `outcome.frames[]`（此前恒空 ⇒ 模型自己抽 1080p PNG 撞 2MB 上限）；
 * ④ 报告按段产物真值构造（此前是 `undefined as unknown as RenderJobReport` 的 cast，
 *    下游自检行几乎空）；
 * ⑤ 辅助设施失败不陪葬：段产物复制失败只记一行，成片照常返回。
 *
 * 反向变异（改回旧行为必须红）：
 * - 删掉 `frames.push(...)` ⇒ 抽帧用例红；
 * - `publishSegmentArtifacts` 只复制新渲段（过滤 reused）⇒ 复用轮次的段产物用例红；
 * - `orderedFiles` 改成先复用后新渲 ⇒ 段序用例红；
 * - 发布失败改成 throw ⇒ 「不陪葬」用例红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runShotRender } from '../lib/shot-render.js'

/** 三段段表（s2/s3 已含 10 帧转场预卷）。 */
const SEGMENTS = [
  { id: 's1', startFrame: 0, frames: 190 },
  { id: 's2', startFrame: 190, frames: 200 },
  { id: 's3', startFrame: 390, frames: 210 },
]

/** 三段内容互不重叠：改 s2 只脏 s2（bg 是常驻轨，改它才全脏）。 */
function tracks(options = {}) {
  const s2Text = options.s2Text ?? 'TWO'
  return [
    { id: 'bg', type: 'shape', shape: 'rect', startFrame: 0, durationInFrames: 600 },
    { id: 's1-title', type: 'textCard', variant: 'title', text: 'ONE', startFrame: 0, durationInFrames: 190 },
    { id: 's2-title', type: 'textCard', variant: 'title', text: s2Text, startFrame: 190, durationInFrames: 200 },
    { id: 's3-title', type: 'textCard', variant: 'title', text: 'THREE', startFrame: 390, durationInFrames: 210 },
  ]
}

function manifest(options = {}) {
  return {
    id: 'm-shot-render',
    meta: { title: 't', width: 1920, height: 1080, fps: 30, durationInFrames: 600, segments: SEGMENTS },
    tracks: tracks(options),
  }
}

/** 项目骨架：build/ 与 assets/（宿主真实布局）。 */
function makeProject() {
  const projectDir = mkdtempSync(join(tmpdir(), 'cs-shot-render-'))
  const assetsDir = join(projectDir, 'assets')
  mkdirSync(join(projectDir, 'build'), { recursive: true })
  mkdirSync(assetsDir, { recursive: true })
  return { projectDir, assetsDir }
}

/** 假宿主：渲染器写带段号标记的假 mp4，拼接读回标记用于验段序。 */
function deps(project, overrides = {}) {
  const state = { rendered: [], sampled: [], concatOrder: [], merged: null }
  const base = {
    projectDir: project.projectDir,
    assetsDir: project.assetsDir,
    quality: 'standard',
    signal: new AbortController().signal,
    renderSegment: async (segment) => {
      state.rendered.push(segment.index)
      const assetFile = `seg-asset-${String(segment.index)}.mp4`
      writeFileSync(join(project.assetsDir, assetFile), `SEG:${String(segment.index)}`)
      return {
        url: `/canvas-studio/assets/p/${assetFile}`,
        assetFile,
        duration: (segment.endFrame - segment.startFrame) / 30,
        warnings: [],
        quality: 'standard',
        frames: [],
        report: {},
        job: { id: 'j', path: 'client', claimedAt: 0, firstFrameAt: null, settled: 'ok', takeover: false, waitedMs: 0, maxProgress: 1 },
      }
    },
    resolveAsset: (assetFile) => join(project.assetsDir, assetFile),
    saveMerged: async (bytes, name) => {
      writeFileSync(join(project.assetsDir, name), bytes)
      return { url: `/canvas-studio/assets/p/${name}`, assetFile: name }
    },
    probeMedia: async () => ({ duration: 20, width: 1920, height: 1080 }),
    concat: async ({ segmentFiles, outputPath }) => {
      state.concatOrder = segmentFiles.map((file) => readFileSync(file, 'utf8'))
      const body = state.concatOrder.join('|')
      state.merged = body
      writeFileSync(outputPath, body)
    },
    sampleFrame: async ({ artifact }) => {
      state.sampled.push(artifact.id)
      return { url: `/canvas-studio/assets/p/qc-${artifact.id}.png` }
    },
    loadSpec: () => null,
    ...overrides,
  }
  return { deps: base, state }
}

test('首渲：3 段全渲 + 每段抽中点帧 + 段产物落 deliver/segments + 报告按真值构造', async () => {
  const project = makeProject()
  const { deps: d, state } = deps(project)
  const result = await runShotRender(manifest(), d)

  assert.ok(result.outcome !== null, '分镜模式必须产出 outcome')
  assert.deepEqual(state.rendered, [0, 1, 2], '首次无缓存 ⇒ 三段全渲')
  assert.deepEqual(state.concatOrder, ['SEG:0', 'SEG:1', 'SEG:2'], '段序必须按段号拼接（只验总时长验不出错位）')

  // ③ 抽帧：每段一张，帧号是段中点绝对帧
  assert.deepEqual(result.outcome.frames.map((f) => f.frame), [94, 289, 494])
  assert.deepEqual(state.sampled, ['s1', 's2', 's3'])
  assert.equal(result.outcome.frames.length, 3, '分镜路径不再返回空抽帧（P1-1 的病灶）')

  // ①② 段产物：三份都在交付目录，文件名是可读段 id
  assert.deepEqual(result.segments.map((p) => p.file), [
    'deliver/segments/s1.mp4',
    'deliver/segments/s2.mp4',
    'deliver/segments/s3.mp4',
  ])
  for (const pointer of result.segments) {
    assert.ok(existsSync(join(project.projectDir, pointer.file)), `段产物必须落盘：${pointer.file}`)
    // REQ-041：assets/ 下必须有一份确定性命名的副本（只读清单据此拼 URL）。
    assert.ok(existsSync(join(project.assetsDir, pointer.assetFile)), `资产副本必须落盘：${pointer.assetFile}`)
    assert.equal(readFileSync(join(project.assetsDir, pointer.assetFile), 'utf8'),
      readFileSync(join(project.projectDir, pointer.file), 'utf8'), '两份副本内容必须同源')
  }
  assert.deepEqual(result.segments.map((p) => p.ref), ['spec:s1', 'spec:s2', 'spec:s3'])
  assert.equal(readFileSync(join(project.projectDir, 'deliver/segments/s2.mp4'), 'utf8'), 'SEG:1')

  // ④ 报告：帧数按段帧窗合计，分辨率走实测探测，码率非 0
  assert.equal(result.outcome.report.frames, 600)
  assert.equal(result.outcome.report.width, 1920)
  assert.equal(result.outcome.report.height, 1080)
  assert.ok(result.outcome.report.bytes > 0, '报告字节数必须来自合并产物')
  assert.ok(result.outcome.report.bitrateKbps > 0, '按成片时长折算码率')
  assert.equal(result.outcome.report.sampledFrames, 3)

  // 回执：段数 / 复用-重渲 / 边界来源 + 段产物清单
  const receipt = result.receipt.join('\n')
  assert.match(receipt, /分镜渲染：3 段（0 复用 \/ 3 重渲，边界来源 段表）/)
  assert.match(receipt, /段产物已落交付目录/)
})

test('改 s2 文案 ⇒ 只重渲 s2（“改一段不动全片”的装配级证明），三段产物仍全在', async () => {
  const project = makeProject()
  const first = await runShotRender(manifest(), deps(project).deps)
  assert.equal(first.segments.length, 3)

  const second = deps(project)
  const result = await runShotRender(manifest({ s2Text: 'TWO!' }), second.deps)

  assert.deepEqual(second.state.rendered, [1], '只有 s2 变脏')
  assert.match(result.receipt.join('\n'), /分镜渲染：3 段（2 复用 \/ 1 重渲，边界来源 段表）/)
  // 复用段的产物也必须复制 —— 否则交付目录会缺段
  for (const id of ['s1', 's2', 's3']) {
    assert.ok(existsSync(join(project.projectDir, `deliver/segments/${id}.mp4`)), `复用轮次缺段产物：${id}`)
  }
  assert.equal(result.segments.length, 3)
})

test('draft 档不发布段产物（草稿不进交付目录），但抽帧照旧', async () => {
  const project = makeProject()
  const { deps: d } = deps(project, { quality: 'draft' })
  const result = await runShotRender(manifest(), d)
  assert.equal(result.segments.length, 0)
  assert.ok(!existsSync(join(project.projectDir, 'deliver/segments')), 'draft 不得在交付目录留半成品')
  assert.equal(result.outcome.frames.length, 3, '抽帧与质量档无关（取证不能因 draft 关掉）')
})

test('段产物复制失败 ⇒ 只记一行，成片照常返回（辅助设施不陪葬）', async () => {
  const project = makeProject()
  // deliver/segments 被一个同名文件占位 ⇒ mkdir 失败
  mkdirSync(join(project.projectDir, 'deliver'), { recursive: true })
  writeFileSync(join(project.projectDir, 'deliver/segments'), 'not a dir')

  const { deps: d } = deps(project)
  const result = await runShotRender(manifest(), d)

  assert.ok(result.outcome !== null, '发布失败不得影响成片')
  assert.equal(result.segments.length, 0, '半套指针比没有更误导')
  assert.match(result.receipt.join('\n'), /段产物未完整落地/)
})

test('抽帧实现抛错 ⇒ 只记一行，渲染结果不变（取证设施不陪葬）', async () => {
  const project = makeProject()
  const { deps: d } = deps(project, {
    sampleFrame: async () => {
      throw new Error('ffmpeg 不存在')
    },
  })
  const result = await runShotRender(manifest(), d)
  assert.equal(result.outcome.frames.length, 0)
  assert.match(result.receipt.join('\n'), /抽帧失败/)
  assert.ok(result.outcome.url.length > 0)
})

test('无从切片（无段表 / 无 spec / 无转场 ⇒ 单段）⇒ outcome 为 null + 回执说明原因', async () => {
  const project = makeProject()
  const flat = {
    id: 'flat',
    meta: { title: 't', width: 1920, height: 1080, fps: 30, durationInFrames: 600 },
    tracks: [{ id: 'only', type: 'shape', shape: 'rect', startFrame: 0, durationInFrames: 600 }],
  }
  const { deps: d } = deps(project)
  const result = await runShotRender(flat, d)
  assert.equal(result.outcome, null, '切片不可用时必须回退整片（不得编段）')
  assert.match(result.receipt.join('\n'), /分镜渲染未启用/)
  assert.deepEqual(result.segments, [])
})

// ── B4（2026-11-16）· Q2 时序回核接进分镜路径 ────────────────────────────────
//
// 此前分镜路径合成 outcome 时绕过 `commitRenderJob`，`verifyTeardown` 不跑 ⇒ 用户
// 传了 `timingSegments`，`report.timingCheck` 永远缺席（界面看起来像回核过，其实一次
// 都没比）。反向变异：把 `deps.timingSegments` 的判断删掉 ⇒ 前两个用例红。

const TIMING = [
  { label: '开场', startSec: 0, endSec: 6.3 },
  { label: '数据', startSec: 6.3, endSec: 13 },
  { label: '收尾', startSec: 13, endSec: 20 },
]

function timingVerify(summary, warnings = []) {
  return async () => ({ summary, warnings })
}

test('传了拆解表 ⇒ report 带 timingCheck，漂移进 warnings', async () => {
  const project = makeProject()
  const summary = { toleranceSec: 0.45, boundaries: [{ label: '数据', tableSec: 6.3, status: 'ok', measuredSec: 6.4, deltaSec: 0.1 }] }
  const { deps: d } = deps(project, {
    timingSegments: TIMING,
    verifyTiming: timingVerify(summary, ['[时序回核] 1 处边界漂移']),
  })
  const result = await runShotRender(manifest(), d)
  assert.deepEqual(result.outcome.report.timingCheck, summary, 'Q2 结论必须进报告（否则「回核过」是假的）')
  assert.ok(result.outcome.warnings.includes('[时序回核] 1 处边界漂移'), '漂移必须进 warnings')
})

test('拆解表 <2 段 ⇒ 不回核（单段没有边界可比），report 无该字段', async () => {
  const project = makeProject()
  let called = 0
  const { deps: d } = deps(project, {
    timingSegments: [{ label: '全片', startSec: 0, endSec: 20 }],
    verifyTiming: async () => {
      called += 1
      return { summary: { toleranceSec: 0.45, boundaries: [] }, warnings: [] }
    },
  })
  const result = await runShotRender(manifest(), d)
  assert.equal(called, 0, '单段拆解表不该触发回核')
  assert.equal(result.outcome.report.timingCheck, undefined)
})

test('REQ-041 draft 档：缺省不发段，显式 publishSegments:true 才发（宿主走后者）', async () => {
  const quiet = makeProject()
  const defaultDraft = await runShotRender(manifest(), deps(quiet, { quality: 'draft' }).deps)
  assert.deepEqual(defaultDraft.segments, [], 'shot-render 缺省语义不变：draft 不发段')

  const published = makeProject()
  const explicit = await runShotRender(manifest(), deps(published, { quality: 'draft', publishSegments: true }).deps)
  assert.equal(explicit.segments.length, 3, '宿主显式发布后 draft 也有段指针')
  for (const pointer of explicit.segments) {
    assert.ok(existsSync(join(published.assetsDir, pointer.assetFile)), `draft 段副本必须落盘：${pointer.assetFile}`)
  }
})

test('回核实现抛错 ⇒ 成片照常返回，只记一行（回核不吞成果）', async () => {
  const project = makeProject()
  const { deps: d } = deps(project, {
    timingSegments: TIMING,
    verifyTiming: async () => {
      throw new Error('ffmpeg 采样失败')
    },
  })
  const result = await runShotRender(manifest(), d)
  assert.ok(result.outcome !== null)
  assert.ok(result.outcome.url.length > 0)
  assert.match(result.receipt.join('\n'), /\[时序回核\] 未执行/)
})

test('段合声：分镜路径发布段之后必须过合声（整片路径有、分镜路径此前漏 = 无声段）', async () => {
  const project = makeProject()
  const audioManifest = {
    ...manifest(),
    audio: { voiceOver: [{ src: '/canvas-studio/assets/p/vo-1.mp3', startFrame: 0 }] },
  }
  const calls = []
  const { deps: d } = deps(project, {
    // 带 audio 也会走 muxAudio（成片整轨混音）—— 这里只验合声接线，混音用假实现避开 ffmpeg。
    muxAudio: async ({ videoPath }) => ({ mixed: false, videoPath }),
    mergeVoices: async (input) => {
      calls.push({ pointers: input.pointers.map((p) => p.id), artifacts: input.artifacts.map((a) => a.id), projectId: input.projectId })
      return { note: undefined, voiceCost: { merged: 3, totalMs: 240, maxMs: 90 } }
    },
    projectId: 'proj-1',
  })
  const result = await runShotRender(audioManifest, d)

  assert.ok(result.outcome !== null, '带 audio 但无 video 轨 ⇒ 仍走分镜')
  assert.equal(calls.length, 1, '段发布之后必须调一次合声')
  assert.deepEqual(calls[0].pointers, ['s1', 's2', 's3'], '合声入参必须是刚发布的段指针')
  assert.deepEqual(calls[0].artifacts, ['s1', 's2', 's3'], '旁白按段窗配对需要段拆解表')
  assert.equal(calls[0].projectId, 'proj-1', '跨项目错配防护必须透传 projectId')
  assert.match(result.receipt.join('\n'), /🔊 段合声：3 段/, '合声耗时要有回执（用户问「发段会不会更慢」时有数）')
})

test('段合声抛错 ⇒ 段指针照常返回，只记一行（无声段仍可用）', async () => {
  const project = makeProject()
  const audioManifest = {
    ...manifest(),
    audio: { voiceOver: [{ src: '/canvas-studio/assets/p/vo-1.mp3', startFrame: 0 }] },
  }
  const { deps: d } = deps(project, {
    muxAudio: async ({ videoPath }) => ({ mixed: false, videoPath }),
    mergeVoices: async () => {
      throw new Error('ffmpeg 缺失')
    },
  })
  const result = await runShotRender(audioManifest, d)

  assert.equal(result.segments.length, 3, '合声失败不能没收段产物')
  assert.ok(result.outcome !== null)
  assert.match(result.receipt.join('\n'), /段合声失败（无声段仍可用）：ffmpeg 缺失/)
})

test('无 audio 的片不调合声（没有旁白可配，别白跑一轮）', async () => {
  const project = makeProject()
  let called = 0
  const { deps: d } = deps(project, {
    mergeVoices: async () => {
      called += 1
      return {}
    },
  })
  await runShotRender(manifest(), d)
  assert.equal(called, 0, 'manifest.audio 缺失时不应触达合声')
})
