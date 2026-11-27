/**
 * 批次 4（2026-11-27 审查 P1-3 / P1-4）：合声副本原子替换 + 档位缓存跨档复用。
 *
 * 两个 bug 的共同形态都是「改了又变回去」：
 * - **P1-3**：`mergeSegmentVoice` 失败留半截/旧版 `seg-<id>-voice.mp4`，清单层
 *   「带声副本存在 ⇒ 优先」只看 `size > 0` ⇒ 卡上指回旧画面+旧声音，回执却说
 *   「画面已换新」。修法：tmp+rename 原子替换、失败删残留、清单加 mtime 判据。
 * - **P1-4**：分镜路径只按**精确档** hash 判命中 ⇒ 渲 draft 全量重渲，且孤儿回收
 *   把 high 条目当垃圾清光（下次渲 high 又全量重渲）。修法：命中判据收口
 *   `lookupSegmentsCache`（跨档复用）+ 孤儿回收合法集 = 全档 hash。
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { mergeSegmentVoice, segmentPlaybackFile, voiceAssetFileOf } from '../lib/segment-voice-merge.js'
import {
  allTierCacheHashes,
  clearStaleEntries,
  getDirtySegments,
  lookupSegmentsCache,
  manifestGlobalsFingerprint,
  storeSegment,
} from '../lib/shot-cache.js'
import { readSegmentMedia } from '../lib/segment-media.js'

const FPS = 30

function textCard(id, startFrame, durationInFrames, text = id) {
  return { id, type: 'textCard', variant: 'subtitle', startFrame, durationInFrames, text }
}

function buildManifest(tracks) {
  return {
    id: 'm1',
    meta: {
      title: 't', fps: FPS, durationInFrames: 400, width: 1920, height: 1080, backgroundColor: '#000',
      // 两段才有切点（cuts ≥ 1 ⇒ 段数 ≥ 2）——deriveSegmentRows 切不出段会诚实返回 []。
      segments: [
        { id: 's1', startFrame: 0, frames: 200 },
        { id: 's2', startFrame: 200, frames: 200 },
      ],
    },
    tracks,
  }
}

const SPEC = {
  meta: { fps: FPS, durationSec: 400 / FPS },
  sections: [{ id: 's1', durationSec: 200 / FPS }, { id: 's2', durationSec: 200 / FPS }],
}

function tmpProject() {
  const dir = mkdtempSync(join(tmpdir(), 'cs-voice-'))
  mkdirSync(join(dir, 'build'), { recursive: true })
  mkdirSync(join(dir, 'assets'), { recursive: true })
  return dir
}

/** 假 ffmpeg：把输出写到 args 末位（= 输出路径），返回给定 code。 */
function fakeRun(code, { bytes = Buffer.from('new-voice-bytes') } = {}) {
  return async (_bin, args) => {
    const output = args[args.length - 1]
    if (code === 0) writeFileSync(output, bytes)
    // 失败也写半截文件 —— 复现「ffmpeg 非 0 退出留下半截」的真实形态。
    else writeFileSync(output, Buffer.from('half-written'))
    return { code, stderr: '' }
  }
}

// ─────────────────── P1-3a：失败必须删残留（「回退无声版」是真话） ───────────────────

test('P1-3：合声失败 ⇒ 半截/旧版带声副本被删，清单真的回退无声版', async () => {
  const projectDir = tmpProject()
  const assetsDir = join(projectDir, 'assets')
  try {
    writeFileSync(join(assetsDir, 'seg-a1.mp4'), Buffer.from('silent-bytes'))
    writeFileSync(join(assetsDir, 'voice1.m4a'), Buffer.from('audio-bytes'))
    // 上一版带声副本（旧画面+旧声音）—— 这就是「改了又变回去」的元凶。
    writeFileSync(join(assetsDir, 'seg-a1-voice.mp4'), Buffer.from('stale-old-voice'))

    const result = await mergeSegmentVoice({
      projectDir,
      assetsDir,
      id: 'a1',
      silentFile: 'seg-a1.mp4',
      durationSec: 6,
      match: { src: '/canvas-studio/assets/p-test/voice1.m4a', startFrame: 0, offsetSec: 0 },
      run: fakeRun(1),
    })
    assert.equal(result.voiceFile, undefined, '失败不得返回 voiceFile')
    assert.match(result.note ?? '', /清单回退无声版/)
    assert.equal(existsSync(join(assetsDir, 'seg-a1-voice.mp4')), false,
      '失败必须删掉残留（半截或旧版）—— 留着它清单就会指回旧画面')
    assert.equal(existsSync(join(assetsDir, 'seg-a1-voice.mp4.tmp.mp4')), false, '临时文件也不许留')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

test('P1-3：合声异常（抛错）同样删残留', async () => {
  const projectDir = tmpProject()
  const assetsDir = join(projectDir, 'assets')
  try {
    writeFileSync(join(assetsDir, 'seg-a1.mp4'), Buffer.from('silent-bytes'))
    writeFileSync(join(assetsDir, 'voice1.m4a'), Buffer.from('audio-bytes'))
    writeFileSync(join(assetsDir, 'seg-a1-voice.mp4'), Buffer.from('stale-old-voice'))
    const result = await mergeSegmentVoice({
      projectDir,
      assetsDir,
      id: 'a1',
      silentFile: 'seg-a1.mp4',
      durationSec: 6,
      match: { src: '/canvas-studio/assets/p-test/voice1.m4a', startFrame: 0, offsetSec: 0 },
      run: async () => { throw new Error('ffmpeg 崩了') },
    })
    assert.equal(result.voiceFile, undefined)
    assert.equal(existsSync(join(assetsDir, 'seg-a1-voice.mp4')), false, '异常路径同样要清残留')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

// ─────────────────── P1-3b：成功走 tmp+rename（原子替换） ───────────────────

test('P1-3：合声成功 ⇒ 新副本原子替换旧版，临时文件不残留', async () => {
  const projectDir = tmpProject()
  const assetsDir = join(projectDir, 'assets')
  try {
    writeFileSync(join(assetsDir, 'seg-a1.mp4'), Buffer.from('silent-bytes'))
    writeFileSync(join(assetsDir, 'voice1.m4a'), Buffer.from('audio-bytes'))
    writeFileSync(join(assetsDir, 'seg-a1-voice.mp4'), Buffer.from('stale-old-voice'))

    const result = await mergeSegmentVoice({
      projectDir,
      assetsDir,
      id: 'a1',
      silentFile: 'seg-a1.mp4',
      durationSec: 6,
      match: { src: '/canvas-studio/assets/p-test/voice1.m4a', startFrame: 0, offsetSec: 0 },
      run: fakeRun(0, { bytes: Buffer.from('fresh-voice-bytes') }),
    })
    assert.equal(result.voiceFile, 'seg-a1-voice.mp4')
    assert.equal(String(readFileSync(join(assetsDir, 'seg-a1-voice.mp4'))), 'fresh-voice-bytes',
      '最终文件必须是**新**合成的字节，不是旧版')
    assert.equal(existsSync(join(assetsDir, 'seg-a1-voice.mp4.tmp.mp4')), false, 'tmp 必须被 rename 掉')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

// ─────────────────── P1-3c：清单 mtime 判据 ───────────────────

test('P1-3：带声副本比无声段旧 ⇒ 清单不采用它（旧画面+旧声音不算数）', async () => {
  const projectDir = tmpProject()
  const assetsDir = join(projectDir, 'assets')
  try {
    const manifest = buildManifest([textCard('V2', 0, 200)])
    writeFileSync(join(projectDir, 'build', 'manifest.json'), JSON.stringify(manifest), 'utf8')
    writeFileSync(join(projectDir, 'build', 'spec.json'), JSON.stringify(SPEC), 'utf8')
    writeFileSync(join(assetsDir, 'seg-s1.mp4'), Buffer.from('new-silent'))
    writeFileSync(join(assetsDir, 'seg-s1-voice.mp4'), Buffer.from('old-voice'))
    // 无声段（新画面）比带声副本新 —— 带声副本是旧画面的合成物。
    const old = new Date('2026-11-27T00:00:00Z')
    const fresh = new Date('2026-11-27T12:00:00Z')
    utimesSync(join(assetsDir, 'seg-s1-voice.mp4'), old, old)
    utimesSync(join(assetsDir, 'seg-s1.mp4'), fresh, fresh)

    const list = await readSegmentMedia({ projectDir, assetsDir, projectId: 'p-test' })
    assert.equal(list.segments.length, 1)
    assert.ok(list.segments[0].url.endsWith('seg-s1.mp4'),
      `旧带声副本不许顶包，实际 url=${list.segments[0].url}`)

    // 带声副本比无声段新 ⇒ 正常采用。
    utimesSync(join(assetsDir, 'seg-s1-voice.mp4'), fresh, fresh)
    utimesSync(join(assetsDir, 'seg-s1.mp4'), old, old)
    const list2 = await readSegmentMedia({ projectDir, assetsDir, projectId: 'p-test' })
    assert.ok(list2.segments[0].url.endsWith('seg-s1-voice.mp4'), '新的带声副本正常采用')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

// ─────────────────── P1-4：跨档复用 + 全档合法集 ───────────────────

function makeSegments(tracks) {
  const manifest = buildManifest(tracks)
  // runShotRender 的段切法在 req038 测试里覆盖；这里直接构造一个单段 ShotSegment 形状。
  return {
    manifest,
    globals: manifestGlobalsFingerprint(manifest),
    segment: {
      index: 0,
      id: 'seg1',
      startFrame: 0,
      endFrame: 200,
      tracks: manifest.tracks,
    },
  }
}

test('P1-4：high 缓存 + 本次渲 draft ⇒ 复用 high，不全量重渲、不清 high 条目', () => {
  const projectDir = tmpProject()
  const cacheDir = join(projectDir, 'build', 'shot-cache')
  mkdirSync(cacheDir, { recursive: true })
  try {
    const { segment, globals } = makeSegments([textCard('V2', 0, 200)])
    const rendered = join(projectDir, 'assets', 'out.mp4')
    writeFileSync(rendered, Buffer.from('high-bytes'))
    const stored = storeSegment(segment, 'high', cacheDir, rendered, globals)
    assert.notEqual(stored, null)

    // 本次只要 draft —— 此前 getDirtySegments 只认精确档 ⇒ 判 dirty 全量重渲。
    const plan = getDirtySegments([segment], 'draft', cacheDir, globals)
    assert.equal(plan.dirty.length, 0, '有 high 必须直接复用（F1 承诺）')
    assert.equal(plan.reused.length, 1)
    assert.equal(plan.reused[0].entry.hash, stored.hash, '复用的是 high 条目')

    // 孤儿回收的合法集必须含全档 —— 只放 draft 的 hash 会把 high 清光。
    const legal = new Set(allTierCacheHashes([segment], globals))
    assert.ok(legal.has(stored.hash), 'high hash 必须在合法集里')
    clearStaleEntries(cacheDir, legal)
    assert.ok(existsSync(join(cacheDir, `${stored.hash}.mp4`)), 'high 条目不许被当孤儿清掉')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

test('P1-4：lookupSegmentsCache 与 getDirtySegments 同一口径（判据收口不漂移）', () => {
  const projectDir = tmpProject()
  const cacheDir = join(projectDir, 'build', 'shot-cache')
  mkdirSync(cacheDir, { recursive: true })
  try {
    const { segment, globals } = makeSegments([textCard('V2', 0, 200)])
    const rendered = join(projectDir, 'assets', 'out.mp4')
    writeFileSync(rendered, Buffer.from('standard-bytes'))
    storeSegment(segment, 'standard', cacheDir, rendered, globals)

    const states = lookupSegmentsCache({ segments: [segment], cacheDir, globals, minQuality: 'draft' })
    const plan = getDirtySegments([segment], 'draft', cacheDir, globals)
    assert.equal(states[0].kind, 'hit')
    assert.equal(plan.dirty.length, 0, '两处判据必须一致 —— 不一致就是 F1 只修了一半')

    // 内容变了：两个判据都必须判不中。
    const changed = makeSegments([textCard('V2-changed', 0, 200)])
    const states2 = lookupSegmentsCache({ segments: [changed.segment], cacheDir, globals, minQuality: 'draft' })
    assert.equal(states2[0].kind, 'stale', '同帧窗、内容变 ⇒ stale（不是 absent）')
    const plan2 = getDirtySegments([changed.segment], 'draft', cacheDir, globals)
    assert.equal(plan2.dirty.length, 1)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

// ─────────────────── 小件回归 ───────────────────

test('voiceAssetFileOf：跨项目引用必须拒（不做同名错配）', () => {
  assert.equal(voiceAssetFileOf('/canvas-studio/assets/p-a/voice1.m4a', 'p-a'), 'voice1.m4a')
  assert.equal(voiceAssetFileOf('/canvas-studio/assets/p-b/voice1.m4a', 'p-a'), undefined, '别项目的文件不许用')
  assert.equal(segmentPlaybackFile('s1', true), 'seg-s1-voice.mp4')
  assert.equal(segmentPlaybackFile('s1', false), 'seg-s1.mp4')
})
