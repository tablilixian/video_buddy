/**
 * REQ-038 R11-C2 · **段内容 hash + 磁盘缓存**单测。
 *
 * 五条纪律必须同时成立：
 * ① **改一处只脏一段** —— 改 s2 的 copy 只有 s2 的 hash 变（carry/bg 变 = 全脏，符合预期）；
 * ② **命中即复用** —— mp4+元数据齐才算命中；写缓存失败不抛（退化为下次全量重渲）；
 * ③ **孤儿回收** —— clearStaleEntries 只删合法 hash 集合之外的条目；
 * ④ **段 manifest 剥 audio** —— D3：段视频无声渲（音频整轨后配 = Phase 1.5）；
 * ⑤ **全局态进 hash**（P1-2，2026-11-16 review）—— 改 `meta.look` / `global.fonts`
 *    等不动轨道的全局输入必须全段脏；顶层 `id` 变化**不**脏（否则缓存永不命中）；
 *    同一语义数据的不同键序算出同一 hash（canonical 指纹）。
 *
 * 直连 Host tsc 编译产物（临时目录）。定向跑：node --test tests/req038-r11-shot-cache.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planFromSpec } from '../lib/remotion/content-spec.js'
import {
  clearStaleEntries,
  getDirtySegments,
  manifestGlobalsFingerprint,
  segmentHash,
  segmentManifest,
  shotCacheDir,
  storeSegment,
} from '../lib/shot-cache.js'
import { sliceByShots } from '../lib/shot-slice.js'

const SPEC = {
  meta: { title: '缓存样例', durationSec: 20, fps: 30, autoStages: true },
  sections: [
    { id: 's1', copy: '开场', card: 'A2' },
    { id: 's2', copy: '数据', units: [
      { card: 'DAT2', copy: '1.2 亿', cell: { x: 28, y: 50, w: 42, h: 44 } },
      { card: 'A4', copy: '要点', cell: { x: 74, y: 50, w: 40, h: 44 }, overlap: true },
    ] },
    { id: 's3', copy: '收尾', card: 'A5' },
  ],
}

function segmentsOf(copyPatch, manifestPatch) {
  const spec = JSON.parse(JSON.stringify(SPEC))
  if (copyPatch !== undefined) spec.sections[1].units[0].copy = copyPatch
  const plan = planFromSpec(spec, 600)
  const manifest = { id: 'm', meta: { title: 'x', width: 1920, height: 1080, fps: 30, durationInFrames: 600, backgroundColor: '#0B1220' }, tracks: plan.tracks, ...manifestPatch }
  const cuts = [200, 400]
  const globals = manifestGlobalsFingerprint(manifest)
  return { manifest, globals, segments: sliceByShots(manifest, cuts).segments }
}

test('改 s2 的 copy → s2 脏 + s1 也脏（转场尾帧依赖传递），s3 不受牵连', () => {
  const { globals, segments: before } = segmentsOf()
  const { globals: globalsAfter, segments: after } = segmentsOf('2.4 亿')
  assert.equal(globals, globalsAfter, '只改轨道 copy 不动全局态：指纹必须相同')
  assert.equal(segmentHash(before[1], 'standard', globals) !== segmentHash(after[1], 'standard', globalsAfter), true, 's2 必须变脏')
  // s1 的活跃集含 s2 轨的前 10 帧（B4 转场窗 [190,200) 渐显 s2 开头）——
  // s2 内容变 = s1 尾帧画面变 = s1 必须重渲。这是**正确的依赖传递**，不是误伤。
  assert.equal(segmentHash(before[0], 'standard', globals) !== segmentHash(after[0], 'standard', globalsAfter), true, 's1 转场尾帧依赖 s2 开头')
  assert.equal(segmentHash(before[2], 'standard', globals), segmentHash(after[2], 'standard', globalsAfter), 's3 与 s2 无帧窗交集，不许被牵连')
})

test('P1-2：改 meta.look（全片调色）→ 全段脏', () => {
  const { segments: before, globals } = segmentsOf()
  const { segments: after, globals: globalsAfter } = segmentsOf(undefined, { meta: { title: 'x', width: 1920, height: 1080, fps: 30, durationInFrames: 600, backgroundColor: '#0B1220', look: { vignette: 0.35 } } })
  assert.notEqual(globals, globalsAfter, 'look 变化必须进指纹')
  for (let i = 0; i < 3; i += 1) {
    assert.notEqual(
      segmentHash(before[i], 'standard', globals),
      segmentHash(after[i], 'standard', globalsAfter),
      `段 ${i} 必须因全局态变脏`,
    )
  }
})

test('P1-2：改 global.fonts → 全段脏', () => {
  const { segments: before, globals } = segmentsOf()
  const { segments: after, globals: globalsAfter } = segmentsOf(undefined, { global: { fontFamily: 'Noto Sans SC', fonts: [{ name: 'Noto Sans SC' }] } })
  assert.notEqual(globals, globalsAfter)
  assert.notEqual(segmentHash(before[0], 'standard', globals), segmentHash(after[0], 'standard', globalsAfter))
})

test('P1-2：顶层 id 变化不脏缓存（id 不参与渲染输出）', () => {
  const { segments, globals } = segmentsOf()
  const relabeled = segmentsOf(undefined, { id: 'another-run' })
  assert.equal(relabeled.globals, globals, 'id 不在指纹里')
  assert.equal(segmentHash(segments[0], 'standard', globals), segmentHash(relabeled.segments[0], 'standard', relabeled.globals))
})

test('P1-2：键序不同 → 同一指纹（canonical 序列化）', () => {
  const { segments, globals } = segmentsOf()
  const reordered = segmentsOf(undefined, { meta: { durationInFrames: 600, fps: 30, height: 1080, width: 1920, title: 'x', backgroundColor: '#0B1220' } })
  assert.equal(reordered.globals, globals, '键序抖动不许作废缓存')
  assert.equal(segmentHash(reordered.segments[0], 'standard', reordered.globals), segmentHash(segments[0], 'standard', globals))
})

test('缓存命中/未命中：写入后 getDirtySegments 命中，未写的进 dirty', () => {
  const { segments, globals } = segmentsOf()
  const dir = mkdtempSync(join(tmpdir(), 'r11-cache-'))
  const cacheDir = shotCacheDir(dir)
  const plan1 = getDirtySegments(segments, 'standard', cacheDir, globals)
  assert.equal(plan1.dirty.length, 3, '冷缓存全脏')
  assert.equal(plan1.reused.length, 0)
  // 写入前两段
  for (const seg of [segments[0], segments[1]]) {
    const fake = join(dir, `rendered-${String(seg.index)}.mp4`)
    writeFileSync(fake, 'segment-bytes')
    storeSegment(seg, 'standard', cacheDir, fake, globals)
  }
  const plan2 = getDirtySegments(segments, 'standard', cacheDir, globals)
  assert.deepEqual(plan2.reused.map((r) => r.segment.index), [0, 1])
  assert.deepEqual(plan2.dirty.map((s) => s.index), [2])
  // 命中条目的 mp4 字节与渲染产物一致
  assert.equal(existsSync(plan2.reused[0].entry.videoPath), true)
  // P1-2：全局态变化 = 全部回到 dirty（命中的条目不再命中）
  const { segments: reLooked, globals: reGlobals } = segmentsOf(undefined, { meta: { title: 'x', width: 1920, height: 1080, fps: 30, durationInFrames: 600, backgroundColor: '#0B1220', look: { contrast: 1.06 } } })
  const plan3 = getDirtySegments(reLooked, 'standard', cacheDir, reGlobals)
  assert.equal(plan3.reused.length, 0, '全局态变了不许复用旧段')
  assert.equal(plan3.dirty.length, 3)
})

test('storeSegment 写失败（渲染产物不存在）返回 null 不抛', () => {
  const { segments, globals } = segmentsOf()
  const dir = mkdtempSync(join(tmpdir(), 'r11-cache-fail-'))
  const result = storeSegment(segments[0], 'standard', shotCacheDir(dir), join(dir, 'no-such.mp4'), globals)
  assert.equal(result, null)
})

test('clearStaleEntries：只删合法集合之外；无目录返回 0', () => {
  const { segments, globals } = segmentsOf()
  const dir = mkdtempSync(join(tmpdir(), 'r11-cache-gc-'))
  const cacheDir = shotCacheDir(dir)
  for (const seg of segments) {
    const fake = join(dir, `r-${String(seg.index)}.mp4`)
    writeFileSync(fake, 'bytes')
    storeSegment(seg, 'standard', cacheDir, fake, globals)
  }
  const validHashes = new Set(segments.map((s) => segmentHash(s, 'standard', globals)))
  // 造一个孤儿
  writeFileSync(join(cacheDir, 'deadbeef.mp4'), 'orphan')
  writeFileSync(join(cacheDir, 'deadbeef.json'), '{}')
  const removed = clearStaleEntries(cacheDir, validHashes)
  assert.equal(removed, 2, '孤儿 mp4+json 一对')
  assert.equal(existsSync(join(cacheDir, `${validHashes.values().next().value}.mp4`)), true, '合法条目保留')
  assert.equal(clearStaleEntries(cacheDir, validHashes), 0)
  assert.equal(clearStaleEntries(join(dir, 'no-dir'), new Set()), 0, '无目录返回 0')
})

test('segmentManifest：剥 audio + 段活跃轨 + 帧号绝对', () => {
  const { manifest, segments } = segmentsOf()
  const withAudio = { ...manifest, audio: { bgmUrl: '/x.mp3' } }
  const seg = segmentManifest(withAudio, segments[1])
  assert.equal(seg.audio, undefined, 'D3：段视频无声渲')
  assert.equal(seg.tracks.length, segments[1].tracks.length)
  assert.equal(seg.meta.durationInFrames, 600, '帧号绝对（frameRange 渲染口径）')
})

test('质量档变化 = 全段脏（hash 含 quality）', () => {
  const { segments, globals } = segmentsOf()
  assert.notEqual(segmentHash(segments[0], 'standard', globals), segmentHash(segments[0], 'high', globals))
})
