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
import { deriveAudioComposition, hasVoiceOverAudio, validateManifest } from '../lib/remotion/manifest.js'

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
