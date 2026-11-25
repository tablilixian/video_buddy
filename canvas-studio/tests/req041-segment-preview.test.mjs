/**
 * REQ-041 P0-b+P1 · 段预览旁路编排（行为断言，可反向变异）。
 *
 * 锁四件事：
 * ① 整片路径（shotOutcome=null）也能从段缓存按帧窗发布无声段；
 * ② 带 audio 的 manifest 自动合声，清单 url 指向 `-voice.mp4`；
 * ③ 合声失败 → 无声段仍在、清单回退无声版、note 如实说；
 * ④ 缓存为空/无段边界 → 空指针 + note，不抛。
 *
 * 反向变异：把缓存匹配改成按序号 ⇒ ①红；把合声关掉 ⇒ ②红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { publishSegmentsFromCache, cacheIndexByWindow } from '../lib/segment-publish.js'
import { publishSegmentPreview } from '../lib/segment-preview-publish.js'
import { readSegmentMedia } from '../lib/segment-media.js'

function seededProject() {
  const projectDir = mkdtempSync(join(tmpdir(), 'cs-preview-'))
  const assetsDir = join(projectDir, 'assets')
  const cacheDir = join(projectDir, 'build', 'shot-cache')
  mkdirSync(assetsDir, { recursive: true })
  mkdirSync(cacheDir, { recursive: true })
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
  writeFileSync(join(cacheDir, 'hash1.json'), JSON.stringify({ startFrame: 0, endFrame: 200 }))
  writeFileSync(join(cacheDir, 'hash1.mp4'), 'SILENT1')
  writeFileSync(join(cacheDir, 'hash2.json'), JSON.stringify({ startFrame: 200, endFrame: 400 }))
  writeFileSync(join(cacheDir, 'hash2.mp4'), 'SILENT2')
  writeFileSync(join(assetsDir, 'v1.mp3'), 'VOICE1')
  return { projectDir, assetsDir, cacheDir, spec, manifest }
}

test('缓存索引：按帧窗建键，坏 meta / 缺 mp4 跳过', () => {
  const p = seededProject()
  const index = cacheIndexByWindow(p.cacheDir)
  assert.deepEqual([...index.keys()].sort(), ['0:200', '200:400'])
  assert.ok(index.get('0:200').endsWith('hash1.mp4'))
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
