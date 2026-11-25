/**
 * REQ-041 F1+F2（2026-11-25 真机复盘）· 段缓存命中判据 + 画序归一化（行为断言）。
 *
 * ## 为什么必须有这两条
 *
 * 真机会话（超级月亮 21:41）实测到两件事：
 * ① 改了第 2 屏后，`assets/seg-s2.mp4` 与 20:01 的 draft 缓存 **md5 完全相同**，
 *    成片却是新画面 —— 缓存命中按帧窗判（`startFrame:endFrame`），内容变了帧窗没变
 *    ⇒ 零补渲 + 把改前的旧片复制回前端，**永久陈旧且不报错**；
 * ② 同一份缓存的 draft 命中从 7/9 掉到 1/9 —— 其余段的轨集合没变，只是数组顺序
 *    被编辑脚本改了，而 hash 吃有序 tracks ⇒ 「改一屏」变成「全片重渲」。
 *
 * ## 这组用例锁什么
 *
 * - F1：命中按**内容**（帧窗 + 轨 + 全局态 + 档位下限），不按帧窗是否存在；
 *   stale（改过没重渲）与 absent（没渲过）分开，占位规则不许把 stale 当命中；
 * - F1：档位只许升不许降 —— 缓存里是 draft、本次要 standard ⇒ 必须重渲；
 *   缓存里是 high、本次只要 draft ⇒ 直接复用（不为了「同档」白烧一遍）；
 * - F1：内容变了但没重渲 ⇒ **不复制**旧片，回执点名「内容已变」；
 * - F2：时间**不重叠**的轨换顺序 ⇒ 同一份缓存（画序不影响任何一帧像素）；
 * - F2：时间**重叠**的轨换顺序 ⇒ 必须不同（画序是内容，否则会把错像素缓存住）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fillMissingSegments, missingArtifacts } from '../lib/segment-render.js'
import { planSegmentTable } from '../lib/segment-table.js'
import { publishSegmentsFromCache } from '../lib/segment-publish.js'
import {
  canonicalTracks,
  lookupSegmentsCache,
  manifestGlobalsFingerprint,
  segmentHash,
  shotCacheDir,
} from '../lib/shot-cache.js'

const FPS = 30

function card(id, startFrame, durationInFrames, copy = id) {
  return { id, type: 'textCard', startFrame, durationInFrames, text: copy }
}

function buildManifest(tracks) {
  return {
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
    // 旁白 ⇒ 整片路径（P0-3 的补段场景），也是真机上出问题的那条路。
    audio: { voiceOver: [{ src: '/canvas-studio/assets/p/v1.mp3', startFrame: 10 }] },
    tracks,
  }
}

const SPEC = {
  meta: { fps: FPS, durationSec: 400 / FPS },
  sections: [{ id: 's1', durationSec: 200 / FPS }, { id: 's2', durationSec: 200 / FPS }],
}

function project(manifest) {
  const projectDir = mkdtempSync(join(tmpdir(), 'cs-f1f2-'))
  const assetsDir = join(projectDir, 'assets')
  mkdirSync(assetsDir, { recursive: true })
  mkdirSync(join(projectDir, 'build'), { recursive: true })
  writeFileSync(join(projectDir, 'build', 'spec.json'), JSON.stringify(SPEC))
  writeFileSync(join(projectDir, 'build', 'manifest.json'), JSON.stringify(manifest))
  return { projectDir, assetsDir }
}

function renderer(assetsDir, bytesOf = (i) => `RENDERED-${String(i + 1)}`) {
  const calls = []
  return {
    calls,
    renderSegment: async (segment) => {
      calls.push(segment)
      const assetFile = `rendered-${String(segment.index)}.mp4`
      writeFileSync(join(assetsDir, assetFile), bytesOf(segment.index))
      return { assetFile, warnings: [], quality: 'standard' }
    },
  }
}

function io(p, r, quality = 'standard') {
  return {
    projectDir: p.projectDir,
    assetsDir: p.assetsDir,
    quality,
    signal: new AbortController().signal,
    renderSegment: r.renderSegment,
    resolveAsset: (file) => join(p.assetsDir, file),
  }
}

/** 两段各有内容：s1 见 a/b，s2 见 c/d（都不跨段，便于单独改一段）。 */
function baseTracks() {
  return [
    card('a', 10, 100),
    card('b', 20, 60),
    card('c', 210, 100),
    card('d', 220, 60),
  ]
}

// ── F1 ──────────────────────────────────────────────────────────────────────

test('F1 核心：内容变了帧窗没变 ⇒ 判缺（stale）并重渲，其余段零渲染', async () => {
  const p = project(buildManifest(baseTracks()))
  const first = renderer(p.assetsDir)
  const firstRun = await fillMissingSegments({ ...io(p, first), manifest: buildManifest(baseTracks()), spec: SPEC })
  assert.equal(firstRun.rendered, 2, '首渲两段都要渲（缓存为空）')
  assert.equal(firstRun.staleCount, 0, '首渲是 absent，不是 stale')

  // 只改 s2 的文案 —— 帧窗不变，这正是真机上「判存在 ⇒ 零补渲」的条件。
  const changed = buildManifest([
    card('a', 10, 100),
    card('b', 20, 60),
    card('c', 210, 100, '改过的文案'),
    card('d', 220, 60),
  ])
  const second = renderer(p.assetsDir, () => 'RENDERED-NEW-2')
  const secondRun = await fillMissingSegments({ ...io(p, second), manifest: changed, spec: SPEC })
  try {
    assert.equal(second.calls.length, 1, `只该重渲改过的那一段，实际渲了 ${String(second.calls.length)} 段`)
    assert.equal(second.calls[0].startFrame, 200, '重渲的必须是 s2（帧窗 200-400）')
    assert.equal(secondRun.staleCount, 1, '回执要能说清「这是内容变更后的重渲」')
    assert.deepEqual(secondRun.staleIds, ['s2'])
    assert.equal(readFileSync(join(p.assetsDir, 'seg-s2.mp4'), 'utf8'), 'RENDERED-NEW-2',
      '发布出去的必须是新片 —— 旧实现会把改前的旧 mp4 复制回来')
    assert.equal(readFileSync(join(p.assetsDir, 'seg-s1.mp4'), 'utf8'), 'RENDERED-1', '没改的段不许动')
  } finally {
    rmSync(p.projectDir, { recursive: true, force: true })
  }
})

test('F1 档位只升不降：缓存是 draft、本次要 standard ⇒ 重渲；缓存是 high、本次要 draft ⇒ 复用', async () => {
  const manifest = buildManifest(baseTracks())
  const plan = planSegmentTable({ manifest, spec: SPEC })
  const globals = manifestGlobalsFingerprint(manifest)

  // 缓存只有 draft（= 真机那次「段产物停在 960×540、成片 1920×1080」）
  const p = project(manifest)
  const dir = shotCacheDir(p.projectDir)
  mkdirSync(dir, { recursive: true })
  plan.segments.forEach((segment, i) => {
    const hash = segmentHash(segment, 'draft', globals)
    writeFileSync(join(dir, `${hash}.json`), JSON.stringify({
      hash, startFrame: segment.startFrame, endFrame: segment.endFrame, quality: 'draft',
    }))
    writeFileSync(join(dir, `${hash}.mp4`), `DRAFT-${String(i + 1)}`)
  })
  try {
    const asStandard = missingArtifacts({ plan, cacheDir: dir, quality: 'standard', globals })
    assert.equal(asStandard.length, 2, '要 standard 而缓存只有 draft ⇒ 两段都算缺（必须升档重渲）')
    assert.deepEqual(asStandard.map((row) => row.reason), ['stale', 'stale'], '是「渲过但档位不够」，不是「没渲过」')
    const asDraft = missingArtifacts({ plan, cacheDir: dir, quality: 'draft', globals })
    assert.equal(asDraft.length, 0, '要 draft 而缓存就是 draft ⇒ 命中，零渲染')

    // 反过来：缓存是 high、本次要 draft ⇒ 不许降档重渲（白烧一次渲染）
    const p2 = project(manifest)
    const dir2 = shotCacheDir(p2.projectDir)
    mkdirSync(dir2, { recursive: true })
    plan.segments.forEach((segment, i) => {
      const hash = segmentHash(segment, 'high', globals)
      writeFileSync(join(dir2, `${hash}.json`), JSON.stringify({
        hash, startFrame: segment.startFrame, endFrame: segment.endFrame, quality: 'high',
      }))
      writeFileSync(join(dir2, `${hash}.mp4`), `HIGH-${String(i + 1)}`)
    })
    try {
      const states = lookupSegmentsCache({ segments: plan.segments, cacheDir: dir2, globals, minQuality: 'draft' })
      assert.ok(states.every((s) => s.kind === 'hit' && s.quality === 'high'), '有 high 时渲 draft 必须直接复用')
    } finally {
      rmSync(p2.projectDir, { recursive: true, force: true })
    }
  } finally {
    rmSync(p.projectDir, { recursive: true, force: true })
  }
})

test('F1 发布侧：内容已变但没重渲 ⇒ 一个字节都不复制，回执点名「内容已变」', () => {
  const original = buildManifest(baseTracks())
  const p = project(original)
  const plan = planSegmentTable({ manifest: original, spec: SPEC })
  const globals = manifestGlobalsFingerprint(original)
  const dir = shotCacheDir(p.projectDir)
  mkdirSync(dir, { recursive: true })
  // 两段都有「上一版」的缓存；s2 在盘上还有一份上一版的副本（内容即将过期）。
  plan.segments.forEach((segment, i) => {
    const hash = segmentHash(segment, 'standard', globals)
    writeFileSync(join(dir, `${hash}.json`), JSON.stringify({
      hash, startFrame: segment.startFrame, endFrame: segment.endFrame, quality: 'standard',
    }))
    writeFileSync(join(dir, `${hash}.mp4`), `CACHE-${String(i + 1)}`)
  })
  writeFileSync(join(p.assetsDir, 'seg-s2.mp4'), 'OLD-S2')
  try {
    // s2 内容变了（多一条轨），但帧窗不变 —— 没人重渲它。
    const published = publishSegmentsFromCache({
      projectDir: p.projectDir,
      assetsDir: p.assetsDir,
      manifest: buildManifest([...baseTracks(), card('c2', 210, 100)]),
      spec: SPEC,
    })
    assert.deepEqual(published.pointers.map((pointer) => pointer.id), ['s1'], '内容不符的段不许给指针')
    assert.match(String(published.note ?? ''), /s2.+内容已变/u, '回执必须说「内容已变」，不能混成「没渲过」')
    assert.equal(readFileSync(join(p.assetsDir, 'seg-s2.mp4'), 'utf8'), 'OLD-S2',
      '旧副本照原样留着（给用户看的最后已知画面），但不许被当成新片')
  } finally {
    rmSync(p.projectDir, { recursive: true, force: true })
  }
})

test('F1 反例守卫：帧窗对得上、内容不同（假 hash 名）不算命中', () => {
  const manifest = buildManifest(baseTracks())
  const plan = planSegmentTable({ manifest, spec: SPEC })
  const globals = manifestGlobalsFingerprint(manifest)
  const p = project(manifest)
  const dir = shotCacheDir(p.projectDir)
  mkdirSync(dir, { recursive: true })
  // 真机事故的形态：帧窗一模一样、meta 写得齐齐整整，但 hash 名不是内容算出来的。
  writeFileSync(join(dir, 'a9dcd570c9928c75.json'), JSON.stringify({ startFrame: 0, endFrame: 200, quality: 'standard' }))
  writeFileSync(join(dir, 'a9dcd570c9928c75.mp4'), 'OLD')
  try {
    const states = lookupSegmentsCache({ segments: plan.segments, cacheDir: dir, globals })
    assert.equal(states[0].kind, 'stale', '按帧窗判存在的实现会在这里给出 hit —— 那就是托盘陈旧的根因')
    assert.deepEqual(missingArtifacts({ plan, cacheDir: dir, quality: 'standard', globals }).map((row) => row.reason),
      ['stale', 'absent'])
  } finally {
    rmSync(p.projectDir, { recursive: true, force: true })
  }
})

// ── F2 ──────────────────────────────────────────────────────────────────────

test('F2：时间不重叠的轨换顺序 ⇒ 同一个 hash（画序对像素无影响，不该重渲）', () => {
  // 两条都落在 s1 的帧窗内（[10,110) 与 [150,190)），互不重叠 —— 换顺序后 s1 的
  // 轨数组不同但画序语义相同。若两条分属两段，这个用例会变成「两段各只有一条轨」，
  // 对「按数组序算 hash」的错误实现也是绿的（第一版就吃过这个假绿）。
  const manifest = buildManifest([card('a', 10, 100), card('b', 150, 40)])
  const swapped = buildManifest([card('b', 150, 40), card('a', 10, 100)])
  const globals = manifestGlobalsFingerprint(manifest)
  assert.equal(manifestGlobalsFingerprint(swapped), globals, '全局态不该因为轨序变')
  const segA = planSegmentTable({ manifest, spec: SPEC }).segments
  const segB = planSegmentTable({ manifest: swapped, spec: SPEC }).segments
  assert.equal(segA[0].tracks.length, 2, '前提：s1 里必须真有两条轨（否则用例无鉴别力）')
  assert.equal(JSON.stringify(segA[0].tracks.map((t) => t.id)), '["a","b"]')
  assert.equal(JSON.stringify(segB[0].tracks.map((t) => t.id)), '["b","a"]')
  for (let i = 0; i < segA.length; i += 1) {
    assert.equal(segmentHash(segA[i], 'standard', globals), segmentHash(segB[i], 'standard', globals),
      `s${String(i + 1)} 的轨时间不重叠，顺序是噪声：hash 必须相同（否则改一屏 = 全片重渲）`)
  }
})

test('F2 反向守卫：时间重叠的轨换顺序 ⇒ hash 必须不同（画序是内容）', () => {
  const manifest = buildManifest([card('a', 10, 100), card('overlap', 20, 100)])
  const swapped = buildManifest([card('overlap', 20, 100), card('a', 10, 100)])
  const globals = manifestGlobalsFingerprint(manifest)
  const segA = planSegmentTable({ manifest, spec: SPEC }).segments[0]
  const segB = planSegmentTable({ manifest: swapped, spec: SPEC }).segments[0]
  assert.notEqual(segmentHash(segA, 'standard', globals), segmentHash(segB, 'standard', globals),
    '重叠轨的先后就是 z-order：算成同一个 hash 会把画错的段缓存回来')
})

test('F2：group 容器内部同样归一化（不重叠可换、重叠不可换）', () => {
  const group = (children) => ({ id: 'g', type: 'group', startFrame: 0, durationInFrames: 400, children })
  const globals = manifestGlobalsFingerprint(buildManifest([]))
  const disjointA = canonicalTracks([group([card('a', 10, 50), card('b', 100, 50)])])
  const disjointB = canonicalTracks([group([card('b', 100, 50), card('a', 10, 50)])])
  assert.equal(JSON.stringify(disjointA), JSON.stringify(disjointB), '子轨不重叠 ⇒ 顺序归一')
  const overlapA = canonicalTracks([group([card('a', 10, 100), card('b', 20, 100)])])
  const overlapB = canonicalTracks([group([card('b', 20, 100), card('a', 10, 100)])])
  assert.notEqual(JSON.stringify(overlapA), JSON.stringify(overlapB), '子轨重叠 ⇒ 画序必须保留')
  // 归一化只用于 hash：返回的是新数组，不就地改入参（调用方可能还要拿原数组渲染）
  const input = [card('a', 10, 100), card('b', 200, 100)]
  const before = JSON.stringify(input)
  canonicalTracks(input)
  assert.equal(JSON.stringify(input), before, 'canonicalTracks 不许就地修改入参')
  void globals
})

test('F2 端到端：编辑脚本重排「不重叠的轨」后，另一段仍然命中缓存', async () => {
  // s1 内两条互不重叠的轨换顺序（编辑脚本 filter+push 的典型结果），s2 只放一条。
  const original = buildManifest([card('a', 10, 100), card('b', 150, 40), card('c', 210, 100)])
  const reordered = buildManifest([card('b', 150, 40), card('a', 10, 100), card('c', 210, 100)])
  const p = project(original)
  const first = renderer(p.assetsDir)
  await fillMissingSegments({ ...io(p, first), manifest: original, spec: SPEC })
  const second = renderer(p.assetsDir)
  const again = await fillMissingSegments({ ...io(p, second), manifest: reordered, spec: SPEC })
  try {
    assert.equal(second.calls.length, 0,
      `轨序重排后仍应零渲染（实际 ${String(second.calls.length)} 段）——这就是 F2 要省下的那份钱`)
    assert.equal(again.rendered, 0)
  } finally {
    rmSync(p.projectDir, { recursive: true, force: true })
  }
})

test('F1 存档：已有 draft 缓存但本次要 high ⇒ 升档重渲并覆盖段副本', async () => {
  const manifest = buildManifest(baseTracks())
  const p = project(manifest)
  const plan = planSegmentTable({ manifest, spec: SPEC })
  const globals = manifestGlobalsFingerprint(manifest)
  const dir = shotCacheDir(p.projectDir)
  mkdirSync(dir, { recursive: true })
  plan.segments.forEach((segment, i) => {
    const hash = segmentHash(segment, 'draft', globals)
    writeFileSync(join(dir, `${hash}.json`), JSON.stringify({
      hash, startFrame: segment.startFrame, endFrame: segment.endFrame, quality: 'draft',
    }))
    writeFileSync(join(dir, `${hash}.mp4`), `DRAFT-${String(i + 1)}`)
  })
  const r = renderer(p.assetsDir, () => 'HIGH-BYTE')
  const run = await fillMissingSegments({ ...io(p, r, 'high'), manifest, spec: SPEC })
  try {
    assert.equal(run.rendered, 2, 'draft 缓存不能顶替 high 出片')
    assert.equal(readFileSync(join(p.assetsDir, 'seg-s1.mp4'), 'utf8'), 'HIGH-BYTE')
    assert.equal(existsSync(join(dir, `${segmentHash(plan.segments[0], 'draft', globals)}.mp4`)), false,
      '升档落盘后同帧窗的 draft 旧条目应被清掉（不许留两份）')
  } finally {
    rmSync(p.projectDir, { recursive: true, force: true })
  }
})
