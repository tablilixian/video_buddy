/**
 * REQ-041 P1 · 段视频 + 对应旁白（行为断言，可反向变异）。
 *
 * 锁四件事：
 * ① 落窗配对按 startFrame，不按序号；落不进任何窗的旁白不配；
 * ② 带声副本名唯一（`seg-<id>-voice.mp4`），清单 stat 到就改指它；
 * ③ 合声用 buildMuxArgs（画面 -c:v copy），失败回退无声版且不抛；
 * ④ 同源 URL 越界 / 非同源 URL 跳过（不拿外部 URL 喂 ffmpeg）。
 *
 * 反向变异：把配对改成按数组下标 ⇒ ①红；把清单的带声优先删掉 ⇒ ②红；
 * 把合声失败改成 throw ⇒ ③红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { matchVoiceForSegment, matchSegmentVoices, segmentVoiceName } from '../lib/segment-audio.js'
import { mergeSegmentVoice, voiceAssetFileOf, segmentPlaybackFile } from '../lib/segment-voice-merge.js'
import { readSegmentMedia } from '../lib/segment-media.js'

test('落窗配对：startFrame 落在 [start,end) 才算这段；跨段不串、缺句不硬凑', () => {
  const voiceOver = [
    { src: 'a.mp3', startFrame: 0 },
    { src: 'b.mp3', startFrame: 245 },
    { src: 'c.mp3', startFrame: 9999 }, // 落在任何段窗外
  ]
  assert.equal(matchVoiceForSegment({ voiceOver, startFrame: 0, endFrame: 235, fps: 30 })?.src, 'a.mp3')
  assert.equal(matchVoiceForSegment({ voiceOver, startFrame: 235, endFrame: 480, fps: 30 })?.src, 'b.mp3')
  assert.equal(matchVoiceForSegment({ voiceOver, startFrame: 800, endFrame: 900, fps: 30 }), undefined, '没有旁白就缺省，不许拿 c 凑')
  // 一段多句：取第一句 + note，不静默丢信息
  const multi = matchVoiceForSegment({ voiceOver: [{ src: 'x.mp3', startFrame: 10 }, { src: 'y.mp3', startFrame: 20 }], startFrame: 0, endFrame: 235, fps: 30 })
  assert.equal(multi?.src, 'x.mp3')
  assert.match(multi?.note ?? '', /2 句/)
})

test('manifest 整表配对：键是段 id，与段数组顺序无关', () => {
  const manifest = { meta: { fps: 30 }, audio: { voiceOver: [{ src: 'v3.mp3', startFrame: 500 }, { src: 'v1.mp3', startFrame: 0 }] } }
  const map = matchSegmentVoices({ manifest, artifacts: [
    { id: 's1', startFrame: 0, frames: 235 },
    { id: 's2', startFrame: 235, frames: 265 },
    { id: 's3', startFrame: 500, frames: 100 },
  ] })
  assert.equal(map.get('s1')?.src, 'v1.mp3')
  assert.equal(map.get('s3')?.src, 'v3.mp3')
  assert.equal(map.has('s2'), false)
  assert.equal(segmentVoiceName('s1'), 'seg-s1-voice.mp4')
  assert.equal(segmentPlaybackFile('s1', true), 'seg-s1-voice.mp4')
  assert.equal(segmentPlaybackFile('s1', false), 'seg-s1.mp4')

  // REQ-041 P1-4：落窗还要算出「台词相对段首的偏移」——段窗起点不是台词起点。
  // 真机数据 s2：段窗 235、旁白 245 ⇒ 段内 10 帧；30fps 下 = 0.333s。
  const s2 = matchVoiceForSegment({ voiceOver: [{ src: 'b.mp3', startFrame: 245 }], startFrame: 235, endFrame: 480, fps: 30 })
  assert.equal(s2?.offsetSec, 10 / 30, '段内偏移必须按 帧差/fps 算，不许整条贴段首')
  const aligned = matchVoiceForSegment({ voiceOver: [{ src: 'a.mp3', startFrame: 0 }], startFrame: 0, endFrame: 235, fps: 30 })
  assert.equal(aligned?.offsetSec, 0, '对齐的那一段偏移必须是 0（s1 就是这种）')
})

test('合声成功：同源 URL → 本地音频；假 ffmpeg 拿到 -c:v copy + -t；副本落 assets', async () => {
  const assetsDir = mkdtempSync(join(tmpdir(), 'cs-voice-merge-'))
  writeFileSync(join(assetsDir, 'seg-s1.mp4'), 'SILENT')
  writeFileSync(join(assetsDir, 'voice.mp3'), 'AUDIO')
  let seenArgs = []
  const fakeRun = async (_ffmpeg, args) => {
    seenArgs = args
    const out = args.at(-1)
    writeFileSync(out, 'MUXED')
    return { code: 0, stdout: '', stderr: '' }
  }
  const result = await mergeSegmentVoice({
    projectDir: assetsDir,
    assetsDir,
    id: 's1',
    silentFile: 'seg-s1.mp4',
    durationSec: 7.833,
    // 真机数据：段窗起点 235、台词 245 ⇒ 段内 0.333s。合声必须补这段前置静音。
    match: { src: '/canvas-studio/assets/any-project/voice.mp3', startFrame: 245, offsetSec: 10 / 30 },
    run: fakeRun,
  })
  assert.equal(result.voiceFile, 'seg-s1-voice.mp4')
  assert.ok(seenArgs.includes('-c:v'), '画面走 copy，不重编码')
  assert.ok(seenArgs.includes('copy'), '画面走 copy，不重编码')
  assert.ok(seenArgs.includes('-t') && seenArgs.includes('7.833'), '严格按段长截断')
  // P1-4：句首要落在段内真实位置（0.333s），不是整条贴段首。
  assert.ok(seenArgs.includes('-af') && seenArgs.includes('adelay=333|333'),
    '旁白偏移没接线：段窗起点 ≠ 台词起点时，预览会比成片早开口 1/3 秒')
  assert.equal(statSync(join(assetsDir, 'seg-s1-voice.mp4')).size, 5, '带声副本落盘')
  assert.equal(statSync(join(assetsDir, 'seg-s1.mp4')).size, 6, '无声段未被覆盖')
})

test('合声失败/URL 越界 ⇒ 回退无声版，不抛', async () => {
  const assetsDir = mkdtempSync(join(tmpdir(), 'cs-voice-fail-'))
  const fail = await mergeSegmentVoice({
    projectDir: assetsDir, assetsDir, id: 's2', silentFile: 'seg-s2.mp4', durationSec: 5,
    match: { src: '/canvas-studio/assets/p/a.mp3', startFrame: 0 },
    run: async () => ({ code: 1, stdout: '', stderr: 'boom' }),
  })
  assert.equal(fail.voiceFile, undefined)
  assert.match(fail.note ?? '', /合声失败/)

  const outside = await mergeSegmentVoice({
    projectDir: assetsDir, assetsDir, id: 's3', silentFile: 'seg-s3.mp4', durationSec: 5,
    match: { src: 'https://evil.example/a.mp3', startFrame: 0 },
    run: async () => ({ code: 0, stdout: '', stderr: '' }),
  })
  assert.equal(outside.voiceFile, undefined)
  assert.equal(voiceAssetFileOf('/canvas-studio/assets/p/../evil.mp3'), '../evil.mp3', '解析只取文件名，越界由 resolveAssetPathIn 挡')
})

test('偏移为 0 / 缺省 ⇒ 合声参数与改前逐字相同（成片口径不许被这条线带动）', async () => {
  const assetsDir = mkdtempSync(join(tmpdir(), 'cs-voice-zero-'))
  writeFileSync(join(assetsDir, 'seg-s9.mp4'), 'SILENT')
  writeFileSync(join(assetsDir, 'v9.mp3'), 'AUDIO')
  let seenArgs = []
  const fakeRun = async (_ffmpeg, args) => {
    seenArgs = args
    writeFileSync(args.at(-1), 'MUXED')
    return { code: 0, stdout: '', stderr: '' }
  }
  await mergeSegmentVoice({
    projectDir: assetsDir, assetsDir, id: 's9', silentFile: 'seg-s9.mp4', durationSec: 5,
    match: { src: '/canvas-studio/assets/p/v9.mp3', startFrame: 0, offsetSec: 0 },
    run: fakeRun,
  })
  assert.ok(!seenArgs.includes('-af'), '对齐段被加了滤镜：成片口径不该被段预览这条线带动')
  assert.ok(!seenArgs.some(arg => arg.includes('adelay')), '偏移为 0 时不许出现 adelay')
})

test('清单：带声副本存在 ⇒ url 指向它、v 用带声 mtime；不存在 ⇒ 无声版', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'cs-voice-list-'))
  const assetsDir = join(projectDir, 'assets')
  mkdirSync(join(projectDir, 'deliver'), { recursive: true })
  mkdirSync(assetsDir, { recursive: true })
  writeFileSync(join(projectDir, 'deliver', 'card.json'), JSON.stringify({ segments: [
    { id: 's1', ref: 'spec:s1', startFrame: 0, frames: 100, durationSec: 3.33 },
  ] }))
  writeFileSync(join(assetsDir, 'seg-s1.mp4'), 'SILENT')
  const before = (await readSegmentMedia({ projectDir, assetsDir, projectId: 'p' })).segments[0]
  assert.equal(before.url.split('/').at(-1), 'seg-s1.mp4')

  writeFileSync(join(assetsDir, 'seg-s1-voice.mp4'), 'MUXED')
  const after = (await readSegmentMedia({ projectDir, assetsDir, projectId: 'p' })).segments[0]
  assert.equal(after.url.split('/').at(-1), 'seg-s1-voice.mp4')
  assert.ok(after.v >= before.v, 'v 用带声版 mtime')
  assert.equal(after.ref, 'spec:s1', 'ref 不受合声影响')
})
