/**
 * REQ-041 第 2 批（2026-11-25）· P0-3 方案 c + N1 单段重渲 + 两个小件（行为断言）。
 *
 * 锁六件事：
 * ① **P0-3**：带 audio 的 manifest（整片路径）也能把缓存里没有的段渲出来并发布
 *    —— 这是「新项目带旁白一段都没有」的根因修复；
 * ② 第二次渲（缓存已齐）**零渲染**（内容不变不该重复烧渲染时间）；
 * ③ **单段不退化成整片**：`rerenderSegmentArtifact` 只渲目标段；
 * ④ **只动这一屏**：重渲只发布目标段的副本，其余段文件字节不变；
 * ⑤ **D14 逐段指针**：一段失败不许把成功的段一起作废（渲路径 + 发布路径两处）；
 * ⑥ **渲后 manifest 落盘**：派生读盘（段清单）与内存 renderManifest 同源。
 *
 * 反向变异（每条都实测过变红，见文末记录）：
 * - `renderSegmentArtifacts` 改成渲 `plan.segments`（全段）⇒ ③ 红；
 * - `rerenderSegmentArtifact` 改成走 `publishSegmentsFromCache`（全量发布）⇒ ④ 红；
 * - `publishSegmentArtifacts` / `publishSegmentsFromCache` 退回「全有或全无」⇒ ⑤ 红；
 * - 删掉 `fillMissingSegments` 的「只补缺失」判断 ⇒ ② 红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  fillMissingSegments,
  missingArtifacts,
  rerenderSegmentArtifact,
  segmentCacheKey,
} from '../lib/segment-render.js'
import { planSegmentTable } from '../lib/segment-table.js'
import { publishSegmentsFromCache } from '../lib/segment-publish.js'
import { publishSegmentArtifacts } from '../lib/shot-render.js'
import { segmentRenderOptions } from '../lib/shot-cache.js'
import { planSegmentArtifacts } from '../lib/segment-artifacts.js'
import { writeRenderedManifest, renderedManifestPath } from '../lib/rendered-manifest.js'
import { deriveSegmentRows } from '../lib/segment-media.js'
import { isRenderSettledTool, RENDER_SETTLED_TOOLS } from '../lib/render-settled-tools.js'

const FPS = 30

/** 两屏 400 帧（各 200 帧）的 manifest；`audio` 有值 = 走整片路径的那种项目。 */
function seeded(overrides = {}) {
  const projectDir = mkdtempSync(join(tmpdir(), 'cs-b2-'))
  const assetsDir = join(projectDir, 'assets')
  const buildDir = join(projectDir, 'build')
  mkdirSync(assetsDir, { recursive: true })
  mkdirSync(buildDir, { recursive: true })
  const spec = {
    meta: { fps: FPS, durationSec: 400 / FPS },
    sections: [{ id: 's1', durationSec: 200 / FPS }, { id: 's2', durationSec: 200 / FPS }],
  }
  const manifest = {
    meta: {
      fps: FPS,
      durationInFrames: 400,
      width: 1920,
      height: 1080,
      segments: [
        { id: 's1', startFrame: 0, frames: 200 },
        { id: 's2', startFrame: 200, frames: 200 },
      ],
    },
    // 旁白 ⇒ `runShotRender` 的 allowShots 为 false（整片路径），正是 P0-3 的场景。
    audio: { voiceOver: [{ src: '/canvas-studio/assets/p/v1.mp3', startFrame: 10 }] },
    tracks: [],
    ...overrides,
  }
  writeFileSync(join(buildDir, 'spec.json'), JSON.stringify(spec))
  writeFileSync(join(buildDir, 'manifest.json'), JSON.stringify(manifest))
  return { projectDir, assetsDir, spec, manifest }
}

/** 假渲染器：按段写一个文件到 assets，返回 outcome。记录被渲的段。 */
function fakeRenderer(assetsDir, { failIndexes = [], bytesOf = (i) => `RENDERED-${String(i)}` } = {}) {
  const calls = []
  const renderSegment = async (segment) => {
    calls.push(segment)
    if (failIndexes.includes(segment.index)) throw new Error(`boom-${String(segment.index)}`)
    const assetFile = `rendered-${String(segment.index)}.mp4`
    writeFileSync(join(assetsDir, assetFile), bytesOf(segment.index))
    return { assetFile, warnings: [], quality: 'standard' }
  }
  return { calls, renderSegment }
}

function io(p, renderer, extra = {}) {
  return {
    projectDir: p.projectDir,
    assetsDir: p.assetsDir,
    quality: 'standard',
    signal: new AbortController().signal,
    renderSegment: renderer.renderSegment,
    resolveAsset: (file) => join(p.assetsDir, file),
    ...extra,
  }
}

test('P0-3：带 audio 的整片路径，缓存为空时补渲每一段并发布两份副本', async () => {
  const p = seeded()
  const renderer = fakeRenderer(p.assetsDir)
  const filled = await fillMissingSegments({ ...io(p, renderer), manifest: p.manifest, spec: p.spec })
  try {
    assert.equal(filled.rendered, 2, '两段都要渲（缓存为空 ⇒ 全缺）')
    assert.equal(renderer.calls.length, 2, '每段渲一次，不多不少')
    assert.deepEqual(renderer.calls.map((s) => [s.startFrame, s.endFrame]), [[0, 200], [200, 400]],
      '传入的是**该段**（帧窗来自段表），不是整片')
    // 指针：逐段、带 ref（段表整表对齐时才有 ref —— 客户端只认 ref）
    assert.deepEqual(filled.pointers.map((p2) => p2.ref), ['spec:s1', 'spec:s2'])
    for (const pointer of filled.pointers) {
      assert.ok(existsSync(join(p.projectDir, pointer.file)), `交付副本必须落地：${pointer.file}`)
      assert.ok(existsSync(join(p.assetsDir, pointer.assetFile)), `assets 副本必须落地：${pointer.assetFile}`)
    }
    assert.equal(readFileSync(join(p.assetsDir, 'seg-s1.mp4'), 'utf8'), 'RENDERED-0')
    assert.equal(readFileSync(join(p.assetsDir, 'seg-s2.mp4'), 'utf8'), 'RENDERED-1')
  } finally {
    rmSync(p.projectDir, { recursive: true, force: true })
  }
})

test('P0-3：缓存已齐时零渲染（内容没变不该重复烧渲染时间）', async () => {
  const p = seeded()
  const first = fakeRenderer(p.assetsDir)
  await fillMissingSegments({ ...io(p, first), manifest: p.manifest, spec: p.spec })
  const second = fakeRenderer(p.assetsDir)
  const again = await fillMissingSegments({ ...io(p, second), manifest: p.manifest, spec: p.spec })
  try {
    assert.equal(second.calls.length, 0, '第二次必须一次渲染都不发（否则每次 draft 都是 2× 时长）')
    assert.equal(again.rendered, 0)
    assert.equal(again.elapsedMs, 0)
  } finally {
    rmSync(p.projectDir, { recursive: true, force: true })
  }
})

test('P0-3：一段渲失败 —— 成功的段照样给指针，失败写进 note（D14）', async () => {
  const p = seeded()
  const renderer = fakeRenderer(p.assetsDir, { failIndexes: [1] })
  const filled = await fillMissingSegments({ ...io(p, renderer), manifest: p.manifest, spec: p.spec })
  try {
    assert.equal(filled.rendered, 1)
    assert.deepEqual(filled.pointers.map((pointer) => pointer.id), ['s1'],
      '成功落地的段必须有指针（旧口径会整批不给）')
    assert.match(String(filled.note ?? ''), /s2/u, '失败的段必须点名，不许静默')
    assert.match(String(filled.note ?? ''), /boom-1/u, '失败原因要带出来')
  } finally {
    rmSync(p.projectDir, { recursive: true, force: true })
  }
})

test('N1：只渲目标段，且只发布目标段（其余段文件字节不变）', async () => {
  const p = seeded()
  // 预置：两段的旧副本 + 两段缓存（让「全量重发」这种错误实现能被字节差异抓到）
  for (const id of ['s1', 's2']) {
    mkdirSync(join(p.projectDir, 'build', 'shot-cache'), { recursive: true })
    writeFileSync(join(p.assetsDir, `seg-${id}.mp4`), `STALE-${id}`)
  }
  writeFileSync(join(p.projectDir, 'build', 'shot-cache', 'h1.json'), JSON.stringify({ startFrame: 0, endFrame: 200, quality: 'standard' }))
  writeFileSync(join(p.projectDir, 'build', 'shot-cache', 'h1.mp4'), 'CACHE-1')
  writeFileSync(join(p.projectDir, 'build', 'shot-cache', 'h2.json'), JSON.stringify({ startFrame: 200, endFrame: 400, quality: 'standard' }))
  writeFileSync(join(p.projectDir, 'build', 'shot-cache', 'h2.mp4'), 'CACHE-2')

  const plan = planSegmentTable({ manifest: p.manifest, spec: p.spec })
  assert.ok(plan !== null)
  const target = plan.artifacts.find((candidate) => candidate.ref === 'spec:s2')
  assert.ok(target, '段表必须能按 ref 定位到 s2')

  const renderer = fakeRenderer(p.assetsDir)
  const out = await rerenderSegmentArtifact({ ...io(p, renderer), manifest: p.manifest, plan, artifact: target })
  try {
    assert.equal(renderer.calls.length, 1, '只渲一段 —— 渲全片就是这个入口最严重的退化')
    assert.equal(renderer.calls[0].startFrame, 200)
    assert.ok(out.result, '目标段必须渲成')
    assert.equal(out.result.pointer.id, 's2')
    assert.equal(readFileSync(join(p.assetsDir, 'seg-s2.mp4'), 'utf8'), 'RENDERED-1', '目标段必须换新')
    assert.equal(readFileSync(join(p.assetsDir, 'seg-s1.mp4'), 'utf8'), 'STALE-s1',
      '其余段必须原样不动（全量重发会把没改过的屏也刷新掉，客户端要重拉）')
  } finally {
    rmSync(p.projectDir, { recursive: true, force: true })
  }
})

test('N1：目标段渲失败 ⇒ 明确失败，不返回旧片冒充新片', async () => {
  const p = seeded()
  const plan = planSegmentTable({ manifest: p.manifest, spec: p.spec })
  const target = plan.artifacts[0]
  const renderer = fakeRenderer(p.assetsDir, { failIndexes: [0] })
  const out = await rerenderSegmentArtifact({ ...io(p, renderer), manifest: p.manifest, plan, artifact: target })
  try {
    assert.equal(out.result, null)
    assert.match(String(out.failure ?? ''), /boom-0/u)
    assert.equal(existsSync(join(p.assetsDir, 'seg-s1.mp4')), false, '失败时一个副本都不许落地')
  } finally {
    rmSync(p.projectDir, { recursive: true, force: true })
  }
})

test('D14 发布路径：`publishSegmentArtifacts` 一段缺源文件也照给另一段的指针', () => {
  const p = seeded()
  const artifacts = planSegmentArtifacts({
    segments: [{ index: 0, startFrame: 0, endFrame: 200 }, { index: 1, startFrame: 200, endFrame: 400 }],
    fps: FPS,
  })
  const good = join(p.projectDir, 'good.mp4')
  writeFileSync(good, 'OK')
  const published = publishSegmentArtifacts({
    projectDir: p.projectDir,
    assetsDir: p.assetsDir,
    artifacts,
    files: [good, join(p.projectDir, 'missing.mp4')],
    fps: FPS,
  })
  try {
    assert.deepEqual(published.pointers.map((pointer) => pointer.id), [artifacts[0].id],
      '落地的那一段必须有指针（旧实现 failures>0 ⇒ pointers=[]）')
    assert.match(String(published.note ?? ''), new RegExp(String(artifacts[1].id), 'u'))
  } finally {
    rmSync(p.projectDir, { recursive: true, force: true })
  }
})

test('D14 发布路径：缓存缺一段时，其余段的指针照给', () => {
  const p = seeded()
  const cacheDir = join(p.projectDir, 'build', 'shot-cache')
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(join(cacheDir, 'h1.json'), JSON.stringify({ startFrame: 0, endFrame: 200, quality: 'standard' }))
  writeFileSync(join(cacheDir, 'h1.mp4'), 'CACHE-1')
  const published = publishSegmentsFromCache({
    projectDir: p.projectDir,
    assetsDir: p.assetsDir,
    manifest: p.manifest,
    spec: p.spec,
  })
  try {
    assert.deepEqual(published.pointers.map((pointer) => pointer.id), ['s1'])
    assert.match(String(published.note ?? ''), /s2/u)
  } finally {
    rmSync(p.projectDir, { recursive: true, force: true })
  }
})

test('C5 硬约束：段作业参数来自纯函数（闭区间帧窗 + 静音 + 剥 audio）', () => {
  const p = seeded()
  const plan = planSegmentTable({ manifest: p.manifest, spec: p.spec })
  const job = segmentRenderOptions(p.manifest, plan.segments[1], 'draft', { a: 3 })
  // 半开段窗 [200,400) → Remotion 闭区间 [200,399]：直传半开会让末段越界、中间段多渲一帧。
  assert.deepEqual(job.frameRange, [200, 399])
  assert.equal(job.muteAudio, true, '段视频必须无声渲（D3），漏传就会渲出带声的段')
  assert.equal(job.manifest.audio, undefined, '段 manifest 必须剥 audio（双保险）')
  assert.equal(job.quality, 'draft')
  assert.deepEqual(job.realDurations, { a: 3 })
  // 倒挂区间兜底：startFrame >= endFrame 时不许产出 [200,199]
  const degenerate = { index: 0, startFrame: 200, endFrame: 200, tracks: [] }
  assert.deepEqual(segmentRenderOptions(p.manifest, degenerate, 'draft').frameRange, [200, 200])
  rmSync(p.projectDir, { recursive: true, force: true })
})

test('段表切法唯一：渲染侧与发布侧算出同一批帧窗', () => {
  const p = seeded()
  const plan = planSegmentTable({ manifest: p.manifest, spec: p.spec })
  const missing = missingArtifacts(plan.artifacts, join(p.projectDir, 'build', 'shot-cache'))
  try {
    assert.deepEqual(missing.map((artifact) => segmentCacheKey(artifact)), ['0:200', '200:400'])
    // 发布侧（publishSegmentsFromCache）与渲染侧共用 planSegmentTable ⇒ 键必须一致
    const cacheDir = join(p.projectDir, 'build', 'shot-cache')
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(join(cacheDir, 'h1.json'), JSON.stringify({ startFrame: 0, endFrame: 200, quality: 'standard' }))
    writeFileSync(join(cacheDir, 'h1.mp4'), 'CACHE-1')
    const published = publishSegmentsFromCache({
      projectDir: p.projectDir,
      assetsDir: p.assetsDir,
      manifest: p.manifest,
      spec: p.spec,
    })
    assert.deepEqual(published.pointers.map((pointer) => [pointer.startFrame, pointer.frames]), [[0, 200]])
  } finally {
    rmSync(p.projectDir, { recursive: true, force: true })
  }
})

test('渲后 manifest 落盘：派生读盘与内存 renderManifest 同源（帧窗不再错位）', () => {
  const p = seeded()
  // 盘上那份是**渲前**的（模型声明 400 帧两段）；内存里是被 ffprobe 真值校正过的
  // （视频轨只有 300 帧 ⇒ 第二段被缩短）。派生若读旧盘，段行就会与产物错位。
  const reconciled = {
    ...p.manifest,
    meta: {
      ...p.manifest.meta,
      durationInFrames: 300,
      segments: [
        { id: 's1', startFrame: 0, frames: 200 },
        { id: 's2', startFrame: 200, frames: 100 },
      ],
    },
  }
  const before = deriveSegmentRows(p.spec, JSON.parse(readFileSync(renderedManifestPath(p.projectDir), 'utf8')))
  const written = writeRenderedManifest({ projectDir: p.projectDir, manifest: reconciled })
  const after = deriveSegmentRows(p.spec, JSON.parse(readFileSync(written.path, 'utf8')))
  try {
    assert.equal(written.note, undefined, '落盘必须成功（失败只该在盘不可写时）')
    assert.deepEqual(before.map((row) => [row.startFrame, row.frames]), [[0, 200], [200, 200]])
    assert.deepEqual(after.map((row) => [row.startFrame, row.frames]), [[0, 200], [200, 100]],
      '派生读盘必须看到校正后的帧窗 —— 否则卡上的画面会错位到隔壁段')
  } finally {
    rmSync(p.projectDir, { recursive: true, force: true })
  }
})

test('渲染结算名单：rerender_segment 必须触发段清单刷新，普通生成工具不触发', () => {
  assert.equal(isRenderSettledTool('rerender_segment'), true,
    '漏登记 ⇒ 段文件换新了、卡上还是旧画面（用户以为「说了意见但没变化」）')
  assert.equal(isRenderSettledTool('render_composition'), true)
  assert.equal(isRenderSettledTool('image_generate'), false)
  assert.equal(isRenderSettledTool(undefined), false)
  assert.deepEqual([...RENDER_SETTLED_TOOLS].sort(), ['render_composition', 'rerender_segment'])
})
