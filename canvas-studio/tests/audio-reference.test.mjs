/**
 * CV-129：H3 官方音频参考规格校验（纯函数）。
 *
 * 这些断言钉的是**官方硬规格**（MiniMax H3 / Hailuo-03 API reference）：
 * ≤3 段、单段 2–15s、合计 ≤15s、WAV/MP3、≤15MB/段、音频不能是唯一输入。
 * 规格若被改错，这里先红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  audioExtensionOf,
  audioModeNotice,
  validateH3AudioReferences,
} from '../lib/audio-reference.js'

test('CV-129：扩展名解析（大小写无关，无扩展名返回空串）', () => {
  assert.equal(audioExtensionOf('a.MP3'), '.mp3')
  assert.equal(audioExtensionOf('voice.wav'), '.wav')
  assert.equal(audioExtensionOf('noext'), '')
})

test('CV-129：合规的参考音频集合返回空问题列表', () => {
  const issues = validateH3AudioReferences(
    [{ label: 'a.mp3', seconds: 8, bytes: 1024 * 1024 }, { label: 'b.wav', seconds: 6 }],
    1,
  )
  assert.deepEqual(issues, [])
})

test('CV-129：段数超过官方 3 段上限', () => {
  const refs = Array.from({ length: 4 }, (_, i) => ({ label: `a${i}.mp3`, seconds: 3 }))
  const issues = validateH3AudioReferences(refs, 1)
  assert.ok(issues.some((issue) => issue.code === 'too-many'), '应报 too-many')
})

test('CV-129：音频不能作为唯一输入（官方硬规则）', () => {
  const issues = validateH3AudioReferences([{ label: 'a.mp3', seconds: 3 }], 0)
  assert.ok(issues.some((issue) => issue.code === 'audio-only'), '应报 audio-only')
  // 有视觉素材时不应报该码
  assert.ok(!validateH3AudioReferences([{ label: 'a.mp3', seconds: 3 }], 1).some((i) => i.code === 'audio-only'))
})

test('CV-129：单段时长上下限与合计上限', () => {
  assert.ok(
    validateH3AudioReferences([{ label: 'a.mp3', seconds: 1 }], 1).some((i) => i.code === 'too-short'),
    '低于 2s 应报 too-short',
  )
  assert.ok(
    validateH3AudioReferences([{ label: 'a.mp3', seconds: 20 }], 1).some((i) => i.code === 'too-long'),
    '超过 15s 应报 too-long',
  )
  // 每段都合法，但合计超过 15s——这是官方最容易踩的一条
  const total = validateH3AudioReferences(
    [{ label: 'a.mp3', seconds: 9 }, { label: 'b.mp3', seconds: 9 }],
    1,
  )
  assert.ok(total.some((i) => i.code === 'total-too-long'), '合计 18s 应报 total-too-long')
})

test('CV-129：格式与单段大小', () => {
  assert.ok(
    validateH3AudioReferences([{ label: 'a.m4a' }], 1).some((i) => i.code === 'bad-format'),
    '官方只收 WAV/MP3',
  )
  assert.ok(
    validateH3AudioReferences([{ label: 'a.mp3', bytes: 20 * 1024 * 1024 }], 1)
      .some((i) => i.code === 'too-large'),
    '超过 15MB 应报 too-large',
  )
})

test('CV-129：时长未知时跳过合计判定（不猜、不误拦合法请求）', () => {
  const refs = [{ label: 'a.mp3', seconds: 9 }, { label: 'b.mp3' }]
  assert.deepEqual(validateH3AudioReferences(refs, 1), [])
})

test('CV-129：带音频时按参考模式生成，首尾帧语义被改写需显式提示', () => {
  const notice = audioModeNotice('first-last-frame', 2)
  assert.ok(notice !== undefined && notice.includes('参考模式'), '原意图为首尾帧时必须提示语义已变')
  assert.equal(audioModeNotice('multi-reference', 2), undefined)
  assert.equal(audioModeNotice('text-to-video', 1), undefined)
})
