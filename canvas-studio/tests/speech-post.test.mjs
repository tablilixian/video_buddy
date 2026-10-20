/**
 * REQ-034 · O-09：`tts_voiceover` 的语速 / 音高后处理链（纯函数部分）。
 *
 * 后处理本身是 ffmpeg 调用（集成测），但**滤镜链怎么拼**是纯函数 —— 拼错了
 * 会「听起来像变了又像没变」（比如漏掉第一次 `aresample`，源是 24k 时音高倍率就错）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampSpeechOptions, speechFilterChain, SPEECH_PITCH_RANGE, SPEECH_SPEED_RANGE } from '../lib/speech-post.js'

test('无参数 / 参数等于缺省 ⇒ 返回 null（调用方据此跳过整个后处理）', () => {
  assert.equal(speechFilterChain({}), null)
  assert.equal(speechFilterChain({ speed: 1 }), null)
  assert.equal(speechFilterChain({ pitchSemitones: 0 }), null)
  assert.equal(speechFilterChain({ speed: 1, pitchSemitones: 0 }), null)
})

test('只变速：单级 atempo', () => {
  const chain = speechFilterChain({ speed: 0.8 })
  assert.equal(chain, 'atempo=0.800000')
})

test('只变调：先统一采样率再改采样率，末尾用 atempo 把时长拉回', () => {
  // +12 半音 = 倍率 2 ⇒ asetrate 88200，atempo 0.5 抵消时长变化。
  const up = speechFilterChain({ pitchSemitones: 12 })
  assert.equal(up, 'aresample=44100,asetrate=88200,aresample=44100,atempo=0.500000')
  // -12 半音 = 倍率 0.5 ⇒ asetrate 22050，atempo 2。
  const down = speechFilterChain({ pitchSemitones: -12 })
  assert.equal(down, 'aresample=44100,asetrate=22050,aresample=44100,atempo=2.000000')
  // 顺序不可调：第一次 aresample 必须在 asetrate 之前（源采样率不同会让倍率错位）。
  assert.ok((up ?? '').indexOf('aresample') < (up ?? '').indexOf('asetrate'))
})

test('变调 + 变速：变调链在前，atempo 在后（顺序决定听感）', () => {
  const chain = speechFilterChain({ speed: 0.9, pitchSemitones: -3 }) ?? ''
  assert.match(chain, /^aresample=44100,asetrate=\d+,aresample=44100,atempo=[\d.]+,atempo=0\.900000$/)
})

test('越界夹取而不报错（工具「尽力而为」，越界原因进 warnings）', () => {
  const slow = clampSpeechOptions({ speed: 5, pitchSemitones: -40 })
  assert.equal(slow.speed, SPEECH_SPEED_RANGE.max)
  assert.equal(slow.pitchSemitones, SPEECH_PITCH_RANGE.min)
  assert.equal(slow.notes.length, 2)
  assert.match(slow.notes[0] ?? '', /语速 5 超出/)
  assert.match(slow.notes[1] ?? '', /音高 -40 半音超出/)

  const normal = clampSpeechOptions({ speed: 0.9, pitchSemitones: -3 })
  assert.deepEqual(normal, { speed: 0.9, pitchSemitones: -3, notes: [] })
})

test('NaN / 非数值 ⇒ 回落到缺省（不能让 NaN 进 ffmpeg 参数）', () => {
  const result = clampSpeechOptions({ speed: Number.NaN, pitchSemitones: Number.POSITIVE_INFINITY })
  assert.equal(Number.isFinite(result.speed), true)
  assert.equal(Number.isFinite(result.pitchSemitones), true)
  assert.equal(speechFilterChain({ speed: Number.NaN, pitchSemitones: Number.NaN }), null)
})
