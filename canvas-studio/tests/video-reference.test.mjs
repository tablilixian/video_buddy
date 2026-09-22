/**
 * 参考视频规格校验（纯函数）—— H3 官方 reference video 通道。
 *
 * 断言钉的是**官方硬规格**（MiniMax H3 多源交叉核实：minimax.io 开源公告的
 * H3-Base-Ref2VA 规格表 + ToAPIs `MiniMax-H3` API reference）：
 * ≤3 段、单段 2–15s、合计 ≤15s、MP4/MOV、≤50MB/段，且**可作唯一输入**。
 * 最后一条与音频相反，是本文件最该守住的一条差异。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  H3_MAX_TOTAL_FILES,
  validateH3ReferenceBudget,
  validateH3VideoReferences,
} from '../lib/video-reference.js'

test('参考视频：合规集合返回空问题列表', () => {
  const issues = validateH3VideoReferences(
    [{ label: 'a.mp4', seconds: 8, bytes: 4 * 1024 * 1024 }, { label: 'b.mov', seconds: 6 }],
  )
  assert.deepEqual(issues, [])
})

test('参考视频：段数超过官方 3 段上限', () => {
  const refs = Array.from({ length: 4 }, (_, i) => ({ label: `a${i}.mp4`, seconds: 3 }))
  assert.ok(
    validateH3VideoReferences(refs).some((issue) => issue.code === 'too-many'),
    '应报 too-many',
  )
})

test('参考视频：单段时长上下限与合计上限', () => {
  assert.ok(
    validateH3VideoReferences([{ label: 'a.mp4', seconds: 1 }]).some((i) => i.code === 'too-short'),
    '低于 2s 应报 too-short',
  )
  assert.ok(
    validateH3VideoReferences([{ label: 'a.mp4', seconds: 20 }]).some((i) => i.code === 'too-long'),
    '超过 15s 应报 too-long',
  )
  // 每段都合法，但合计超过 15s
  assert.ok(
    validateH3VideoReferences([{ label: 'a.mp4', seconds: 9 }, { label: 'b.mp4', seconds: 9 }])
      .some((i) => i.code === 'total-too-long'),
    '合计 18s 应报 total-too-long',
  )
})

test('参考视频：格式限 MP4 / MOV，且单段 ≤50MB', () => {
  assert.ok(
    validateH3VideoReferences([{ label: 'a.webm' }]).some((i) => i.code === 'bad-format'),
    '官方只收 MP4 / MOV（H.264/H.265）',
  )
  assert.ok(
    validateH3VideoReferences([{ label: 'a.mp4', bytes: 60 * 1024 * 1024 }])
      .some((i) => i.code === 'too-large'),
    '超过 50MB 应报 too-large',
  )
  // 50MB 是比音频（15MB）宽的一条，别跟着音频写错
  assert.deepEqual(validateH3VideoReferences([{ label: 'a.mp4', bytes: 49 * 1024 * 1024 }]), [])
})

test('参考视频：**可以**作为唯一输入（与音频相反，官方硬规则）', () => {
  // 音频侧有 audio-only 这条码；视频侧**不应**有对应拒绝 —— 函数签名里根本没有
  // visualCount 参数就是为此（`validateH3VideoReferences` 只收 refs）。
  const issues = validateH3VideoReferences([{ label: 'a.mp4', seconds: 5 }])
  assert.deepEqual(issues, [], '单段参考视频 + 无图无音频 = 合法（官方允许视频作唯一输入）')
})

test('参考视频：时长未知时跳过合计判定（不猜、不误拦合法请求）', () => {
  const refs = [{ label: 'a.mp4', seconds: 9 }, { label: 'b.mp4' }]
  assert.deepEqual(validateH3VideoReferences(refs), [])
})

test('跨模态文件总数：图 + 视频 + 音频 ≤ 12', () => {
  // 每路都不超（图 ≤9 / 视频 ≤3 / 音频 ≤3），合起来 15 —— 正是官方上限要拦的情形
  const over = validateH3ReferenceBudget({ images: 9, videos: 3, audios: 3 })
  assert.ok(over.some((i) => i.code === 'too-many-files'), `${9 + 3 + 3} > ${H3_MAX_TOTAL_FILES} 应被拦下`)
  assert.deepEqual(validateH3ReferenceBudget({ images: 6, videos: 3, audios: 3 }), [], '恰好 12 合规')
  assert.deepEqual(validateH3ReferenceBudget({ images: 0, videos: 1, audios: 0 }), [])
})
