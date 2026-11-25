/**
 * REQ-041 P0-b+P1 · 段预览旁路编排（行为断言，可反向变异）。
 *
 * 锁四件事：
 * ① 整片路径（shotOutcome=null）也能从段缓存发布无声段；
 * ② 带 audio 的 manifest 自动合声，清单 url 指向 `-voice.mp4`；
 * ③ 合声失败 → 无声段仍在、清单回退无声版、note 如实说；
 * ④ 缓存为空/无段边界 → 空指针 + note，不抛。
 *
 * F1（2026-11-25）之后命中按**内容 hash** 查：种缓存必须用 `segmentHash` 算真名，
 * 手写文件名不再算命中（这正是「帧窗对得上就算存在」那个洞的反面）。
 *
 * 反向变异：把命中改回按帧窗 ⇒ 「内容变了不发旧片」红；把合声关掉 ⇒ ②红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { publishSegmentsFromCache } from '../lib/segment-publish.js'
import { publishSegmentPreview } from '../lib/segment-preview-publish.js'
import { readSegmentMedia } from '../lib/segment-media.js'
import { planSegmentTable } from '../lib/segment-table.js'
import { lookupSegmentsCache, manifestGlobalsFingerprint, segmentHash, shotCacheDir } from '../lib/shot-cache.js'

/** 按真实内容 hash 种缓存（`quality` 决定档位；同段可种多档）。 */
function seedCache(p, quality = 'standard', bytesOf = (i) => `SILENT${String(i + 1)}`) {
  const plan = planSegmentTable({ manifest: p.manifest, spec: p.spec })
  const globals = manifestGlobalsFingerprint(p.manifest)
  const dir = shotCacheDir(p.projectDir)
  mkdirSync(dir, { recursive: true })
  plan.segments.forEach((segment, i) => {
    const hash = segmentHash(segment, quality, globals)
    writeFileSync(join(dir, `${hash}.json`), JSON.stringify({
      hash, index: segment.index, startFrame: segment.startFrame, endFrame: segment.endFrame, quality,
    }))
    writeFileSync(join(dir, `${hash}.mp4`), bytesOf(i))
  })
  return { dir, plan, globals }
}

function seededProject() {
  const projectDir = mkdtempSync(join(tmpdir(), 'cs-preview-'))
  const assetsDir = join(projectDir, 'assets')
  mkdirSync(assetsDir, { recursive: true })
  mkdirSync(join(projectDir, 'build'), { recursive: true })
  const spec = {
    meta: { fps: 30, durationSec: 400 / 30 },
    sections: [{ id: 's1', durationSec: 200 / 30 }, { id: 's2', durationSec: 200 / 30 }],
  }
  const manifest = {
    meta: {
      fps: 30,
      durationInFrames: 400,
      segments: [
        { id: 's1', startFrame: 0, frames: 200 },
        { id: 's2', startFrame: 200, frames: 200 },
      ],
    },
    audio: { voiceOver: [{ src: '/canvas-studio/assets/p/v1.mp3', startFrame: 10 }] },
    tracks: [],
  }
  writeFileSync(join(projectDir, 'build', 'spec.json'), JSON.stringify(spec))
  writeFileSync(join(projectDir, 'build', 'manifest.json'), JSON.stringify(manifest))
  writeFileSync(join(assetsDir, 'v1.mp3'), 'VOICE1')
  const project = { projectDir, assetsDir, cacheDir: shotCacheDir(projectDir), spec, manifest }
  seedCache(project)
  return project
}

test('缓存命中：按内容 hash 查，坏 meta / 缺 mp4 不算命中', () => {
  const p = seededProject()
  const plan = planSegmentTable({ manifest: p.manifest, spec: p.spec })
  const globals = manifestGlobalsFingerprint(p.manifest)
  const states = lookupSegmentsCache({ segments: plan.segments, cacheDir: p.cacheDir, globals })
  assert.deepEqual(states.map((s) => s.kind), ['hit', 'hit'])
  // 缺 mp4（只剩 meta）⇒ 不算命中：发布侧复制会读空字节，卡上是黑帧。
  const onlyJson = mkdtempSync(join(tmpdir(), 'cs-cache-jsononly-'))
  const hash0 = segmentHash(plan.segments[0], 'standard', globals)
  writeFileSync(join(onlyJson, `${hash0}.json`), JSON.stringify({ startFrame: 0, endFrame: 200, quality: 'standard' }))
  assert.equal(lookupSegmentsCache({ segments: [plan.segments[0]], cacheDir: onlyJson, globals })[0].kind, 'stale')
})

test('同帧窗多档缓存：取最高档，不许按 readdir 顺序抖动画质', () => {
  const p = seededProject()
  // 先种 draft（低档），再种 high：两档同帧窗共存是常态（先草稿快看、后高清出片）。
  seedCache(p, 'draft', () => 'DRAFT')
  seedCache(p, 'high', () => 'HIGHQ')
  const plan = planSegmentTable({ manifest: p.manifest, spec: p.spec })
  const globals = manifestGlobalsFingerprint(p.manifest)
  const states = lookupSegmentsCache({ segments: plan.segments, cacheDir: p.cacheDir, globals })
  assert.ok(states.every((s) => s.kind === 'hit' && s.quality === 'high'),
    '同内容有 draft 与 high 时必须取 high —— 否则卡上画质会随目录顺序跳')
  // 只有 draft 时照旧用它（不许因为「没有高档」就整段不发）。
  const onlyDraft = mkdtempSync(join(tmpdir(), 'cs-cache-draft-'))
  const hash0 = segmentHash(plan.segments[0], 'draft', globals)
  writeFileSync(join(onlyDraft, `${hash0}.json`), JSON.stringify({ startFrame: 0, endFrame: 200, quality: 'draft' }))
  writeFileSync(join(onlyDraft, `${hash0}.mp4`), 'DRAFT')
  const single = lookupSegmentsCache({ segments: [plan.segments[0]], cacheDir: onlyDraft, globals })[0]
  assert.equal(single.kind, 'hit')
  assert.equal(single.quality, 'draft')
})

test('P0-b：整片路径从缓存发布两份；ref 来自对齐段表', () => {
  const p = seededProject()
  const result = publishSegmentsFromCache({ ...p })
  assert.deepEqual(result.pointers.map((x) => x.ref), ['spec:s1', 'spec:s2'])
  assert.equal(existsSync(join(p.assetsDir, 'seg-s1.mp4')), true)
  assert.equal(existsSync(join(p.projectDir, 'deliver', 'segments', 's2.mp4')), true)
})

test('P1：带 audio ⇒ 自动合声；清单指向 -voice.mp4；无声段不被覆盖', async () => {
  const p = seededProject()
  const fakeRun = async (_ffmpeg, args) => {
    writeFileSync(args.at(-1), 'MUXED')
    return { code: 0, stdout: '', stderr: '' }
  }
  const result = await publishSegmentPreview({ ...p, runFfmpeg: fakeRun })
  assert.deepEqual(result.pointers.map((x) => x.ref), ['spec:s1', 'spec:s2'])
  // 耗时汇总只数真正调了 ffmpeg 的段：s1 有旁白（1 段），s2 没有。
  assert.equal(result.voiceCost?.merged, 1, '合声段数不许把「没旁白的段」也算进去')
  assert.equal(typeof result.voiceCost?.totalMs, 'number', '总耗时要回传（回执那一行靠它）')
  assert.equal(existsSync(join(p.assetsDir, 'seg-s1-voice.mp4')), true, 's1 有旁白 ⇒ 合声')
  assert.equal(existsSync(join(p.assetsDir, 'seg-s2-voice.mp4')), false, 's2 无旁白 ⇒ 不合')
  const view = await readSegmentMedia({ projectDir: p.projectDir, assetsDir: p.assetsDir, projectId: 'p' })
  assert.equal(view.segments[0].url.split('/').at(-1), 'seg-s1-voice.mp4')
  assert.equal(view.segments[1].url.split('/').at(-1), 'seg-s2.mp4')
})

test('合声失败 / 缓存为空：不抛，清单回退无声版', async () => {
  const p = seededProject()
  const fail = await publishSegmentPreview({
    ...p,
    runFfmpeg: async () => ({ code: 1, stdout: '', stderr: 'boom' }),
  })
  assert.equal(fail.pointers.length, 2, '段副本照常发布')
  assert.match(fail.note ?? '', /合声失败/)
  const view = await readSegmentMedia({ projectDir: p.projectDir, assetsDir: p.assetsDir, projectId: 'p' })
  assert.equal(view.segments[0].url.split('/').at(-1), 'seg-s1.mp4', '回退无声版')

  const empty = mkdtempSync(join(tmpdir(), 'cs-preview-empty-'))
  const result = await publishSegmentPreview({
    projectDir: empty, assetsDir: join(empty, 'assets'),
    manifest: p.manifest, spec: p.spec,
    runFfmpeg: async () => ({ code: 0, stdout: '', stderr: '' }),
  })
  assert.deepEqual(result.pointers, [])
  assert.match(result.note ?? '', /缓存为空/)
})
