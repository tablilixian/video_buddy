/**
 * REQ-034 · O-10：多轨旁白 `audio.voiceOver[]`。
 *
 * 真机症状：三句旁白要落在 2.60 / 7.07 / 11.90 秒，而 `voiceOverUrl` 只收一个文件
 * ⇒ agent 自己用 ffmpeg 拼 `voiceover-timeline-v4.mp3`。**终端用户跑不了 ffmpeg**，
 * 所以「多句旁白」对用户是断的。这里守三件事：单轨老形态不变、多轨被收下、
 * 两者同时给必须拒收（否则同一句播两遍）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveAudioComposition,
  hasVoiceOverAudio,
  summarizeManifestAudio,
  validateManifest,
} from '../lib/remotion/manifest.js'

const VO = '/canvas-studio/assets/p1/vo-1.mp3'
const VO2 = '/canvas-studio/assets/p1/vo-2.mp3'

function base(audio) {
  return {
    id: 'comp-vo',
    meta: { title: '多轨旁白', width: 1280, height: 720, fps: 30, durationInFrames: 300, lint: 'off' },
    tracks: [{ id: 'tc', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 300 }],
    ...(audio === undefined ? {} : { audio }),
  }
}

const errorsOf = (input) => {
  const result = validateManifest(input)
  return result.ok ? [] : result.errors
}

test('单轨 voiceOverUrl 老形态：校验通过，音轨构成仍报「旁白」', () => {
  const manifest = base({ voiceOverUrl: VO })
  assert.deepEqual(errorsOf(manifest), [])
  assert.equal(deriveAudioComposition(manifest), 'voiceOver')
  assert.equal(hasVoiceOverAudio(manifest.audio), true)
})

test('多轨 voiceOver：三条各自带 startFrame，校验通过；构成仍报「旁白」', () => {
  const manifest = base({
    voiceOver: [
      { src: VO, startFrame: 78 },
      { src: VO2, startFrame: 212, volume: 0.9 },
      { src: VO, startFrame: 357 },
    ],
  })
  assert.deepEqual(errorsOf(manifest), [])
  assert.equal(deriveAudioComposition(manifest), 'voiceOver')
  assert.equal(hasVoiceOverAudio(manifest.audio), true)
})

test('同时给 voiceOverUrl 与 voiceOver ⇒ 拒收（否则同一句播两遍）', () => {
  const errors = errorsOf(base({ voiceOverUrl: VO, voiceOver: [{ src: VO2, startFrame: 0 }] }))
  assert.match(errors.join('；'), /voiceOverUrl 与 audio\.voiceOver 二选一/)
})

test('voiceOver 形状非法：非数组 / 空数组 / src 非资产引用 / startFrame 负数 / volume 越界', () => {
  assert.match(errorsOf(base({ voiceOver: 'x' })).join('；'), /voiceOver 必须是数组/)
  assert.match(errorsOf(base({ voiceOver: [] })).join('；'), /voiceOver 为空数组/)
  assert.match(
    errorsOf(base({ voiceOver: [{ src: 'https://evil.example/x.mp3', startFrame: 0 }] })).join('；'),
    /audio\.voiceOver\[0\]\.src 必须是/,
  )
  assert.match(
    errorsOf(base({ voiceOver: [{ src: VO, startFrame: -3 }] })).join('；'),
    /audio\.voiceOver\[0\]\.startFrame 必须是 >= 0 的整数/,
  )
  assert.match(
    errorsOf(base({ voiceOver: [{ src: VO, startFrame: 0, volume: 1.4 }] })).join('；'),
    /audio\.voiceOver\[0\]\.volume 必须是 0–1 的数值/,
  )
})

test('没有旁白 ⇒ hasVoiceOverAudio 为 false，构成退回纯 BGM / none', () => {
  assert.equal(hasVoiceOverAudio(undefined), false)
  assert.equal(hasVoiceOverAudio({}), false)
  assert.equal(hasVoiceOverAudio({ voiceOver: [] }), false)
  assert.equal(deriveAudioComposition(base({ bgmUrl: '/canvas-studio/assets/p1/bgm.mp3' })), 'bgm')
})

// ── CV-450（P0-A）：caption 轨**自播旁白**必须进音轨构成 ────────────────────
// 真机：55 段纯代码片 + 12 条 caption 自播，成片实测 −24.6 LUFS 有声，回执却写
// 「音轨 无声」（派生为 `none`）—— 模型据此白跑一轮音频排查。根因是构成派生只看
// `audio.*` 三件套，而 caption 的声音来自 `<Audio src={track.src} />`。

const CAPTION_SRC = '/canvas-studio/assets/p1/cap-1.mp3'

function captionComp(tracks, extra = {}) {
  return {
    id: 'comp-caption',
    meta: { title: '字幕自播', width: 1280, height: 720, fps: 30, durationInFrames: 300, lint: 'off' },
    tracks,
    ...extra,
  }
}

test('纯 caption 自播（无 video / 无 audio 字段）⇒ 音轨构成「旁白」，不再是 none', () => {
  const comp = captionComp([
    { id: 'c1', type: 'caption', src: CAPTION_SRC, text: '太阳直射点', startFrame: 0, durationInFrames: 90 },
    { id: 'c2', type: 'caption', src: VO2, text: '往返范围', startFrame: 90, durationInFrames: 90 },
  ])
  assert.equal(deriveAudioComposition(comp), 'voiceOver')
})

test('caption 自播 + 原生视频轨 ⇒ native+voiceOver', () => {
  const comp = captionComp([
    { id: 'v1', type: 'video', src: '/canvas-studio/assets/p1/a.mp4', startFrame: 0, durationInFrames: 300 },
    { id: 'c1', type: 'caption', src: CAPTION_SRC, text: '一句话', startFrame: 0, durationInFrames: 120 },
  ])
  assert.equal(deriveAudioComposition(comp), 'native+voiceOver')
})

test('caption 轨没有 src（只有文字）⇒ 不计入出声源，构成仍是 none', () => {
  const comp = captionComp([
    { id: 'c1', type: 'caption', text: '纯文字无配音', startFrame: 0, durationInFrames: 120 },
  ])
  assert.equal(deriveAudioComposition(comp), 'none')
})

test('与 render 报告的 audibleSources 口径一致：caption 两条 = 出声源 2', () => {
  // 同一份 manifest 两条派生链必须同结论（这正是本次误报的成因：一处计、一处不计）。
  const comp = captionComp([
    { id: 'c1', type: 'caption', src: CAPTION_SRC, text: '甲', startFrame: 0, durationInFrames: 90 },
    { id: 'c2', type: 'caption', src: VO2, text: '乙', startFrame: 90, durationInFrames: 90 },
  ])
  const summary = summarizeManifestAudio(comp)
  assert.equal(summary.audibleSources, 2, 'caption 轨自播应各计 1 个出声源')
  assert.equal(summary.mutedVideoTracks, 0)
  assert.equal(deriveAudioComposition(comp), 'voiceOver')
})
