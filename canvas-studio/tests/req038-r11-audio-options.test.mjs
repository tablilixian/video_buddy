/**
 * R11 · P1-4 · **段渲染的音频参数**（唯一构造点，行为断言）
 *
 * 真机实测（2026-11-16，会话 6f8ba13c）：旧写法 `audioCodec: muteAudio ? null : 'aac'`
 * 产出的段 mp4 里有 `aac 314 帧 / 6.698667s / -91dB`——容器时长比视频流长 32ms，
 * 拼接点各定格 40ms，成片 20.0667s、9000/301 fps。
 *
 * 根因不在「静音没生效」，在 `null` 的语义：web-renderer 内部 `requestedCodec ?? default`，
 * `null` 等价于「没指定」⇒ 回落 aac。关断音轨必须显式 `muted: true`。
 *
 * 反向变异：把 `audioRenderOptions` 改成返回 `{ audioCodec: null }` ⇒ 本文件红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { audioRenderOptions } from '../lib/remotion/audio-options.js'

test('muteAudio=true ⇒ { muted: true }，且绝不带 audioCodec（null 会被吃成 aac）', () => {
  const options = audioRenderOptions(true)
  assert.deepEqual(options, { muted: true })
  assert.equal('audioCodec' in options, false, 'muted 路径不得出现 audioCodec —— null 会被 web-renderer 回落到 aac')
})

test('muteAudio=false / undefined ⇒ 显式 audioCodec:aac', () => {
  assert.deepEqual(audioRenderOptions(false), { audioCodec: 'aac' })
  assert.deepEqual(audioRenderOptions(undefined), { audioCodec: 'aac' })
})

test('两种形态互斥：不存在同时带 muted 与 audioCodec 的输出', () => {
  for (const input of [true, false, undefined]) {
    const options = audioRenderOptions(input)
    const keys = Object.keys(options).sort()
    assert.equal(keys.length, 1, `只允许一个键，收到 ${keys.join(',')}`)
  }
})
