/**
 * S3（2026-10-28 · CV-040 收口）：只读音频轨布局 + 混音面板写回 + 导出前预检。
 *
 * 全部纯函数（layoutAudioLane / nodeAudioOverride / buildNodeAudioTimeline /
 * composeAudioPrecheck / audioDrawerRows），不测 JSX（与 timeline-layout 同口径）。
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layoutAudioLane, FALLBACK_AUDIO_S } from '../lib/timeline-layout.js'
import { nodeAudioOverride, buildNodeAudioTimeline, composeAudioPrecheck, resolveAudioMixRole, audioMixRows, audioDrawerRows } from '../lib/compose-selection.js'

// ---------------------------------------------------------------------------
// 1. layoutAudioLane（≥6 条，退出条件）
// ---------------------------------------------------------------------------
test('layoutAudioLane：空段或成片时长未知返回空（不画无标尺的假布局）', () => {
  assert.deepEqual(layoutAudioLane([], 30), [])
  assert.deepEqual(layoutAudioLane([{ id: 'a', startSec: 0, durationSec: 2 }], 0), [])
  assert.deepEqual(layoutAudioLane([{ id: 'a', startSec: 0, durationSec: 2 }], -1), [])
})

test('layoutAudioLane：单段在片内 → left/width 按比例', () => {
  const blocks = layoutAudioLane([{ id: 'b', startSec: 0, durationSec: 15 }], 30)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].leftPct, 0)
  assert.ok(Math.abs(blocks[0].widthPct - 50) < 1e-9, `BGM 15s / 成片 30s → 50%，实得 ${blocks[0].widthPct}`)
  assert.equal(blocks[0].overflow, false)
  assert.equal(blocks[0].clipped, false)
  assert.equal(blocks[0].measured, true)
})

test('layoutAudioLane：BGM 比成片长 → overflow 标记 + 裁到标尺右端（CV-007 长短差一眼可读）', () => {
  const blocks = layoutAudioLane([{ id: 'b', startSec: 0, durationSec: 35 }], 30)
  assert.equal(blocks[0].overflow, true, '35s BGM 对 30s 成片应标越界')
  assert.ok(Math.abs(blocks[0].widthPct - 100) < 1e-9, '可见宽度裁到标尺右端')
  assert.equal(blocks[0].spanSec, 35, 'spanSec 保留真值（title 可读出多出 5s）')
})

test('layoutAudioLane：旁白显式起点落位；起点越过片尾 → clipped + 宽 0', () => {
  const blocks = layoutAudioLane([
    { id: 'v1', startSec: 5, durationSec: 3 },
    { id: 'v2', startSec: 31, durationSec: 2 },
  ], 30)
  assert.ok(Math.abs(blocks[0].leftPct - 5 / 30 * 100) < 1e-9, `5s/30s → 16.7%，实得 ${blocks[0].leftPct}`)
  assert.equal(blocks[0].overflow, false)
  assert.equal(blocks[1].clipped, true, '31s 起的段完全越过 30s 标尺')
  assert.equal(blocks[1].widthPct, 0)
})

test('layoutAudioLane：负起点钳到 0；未探测时长按占位并标 measured=false', () => {
  const blocks = layoutAudioLane([
    { id: 'a', startSec: -2, durationSec: 4 },
    { id: 'b', startSec: 10 },
  ], 30)
  assert.equal(blocks[0].leftPct, 0, '负起点钳到 0')
  assert.equal(blocks[1].measured, false, '无探测值 → 占位')
  assert.equal(blocks[1].spanSec, FALLBACK_AUDIO_S)
  assert.ok(blocks[1].widthPct > 0, '占位段仍可点（与视频轨 FALLBACK_CLIP_S 同口径）')
})

test('layoutAudioLane：多段互不重叠时按绝对坐标定位（不按顺序堆叠）', () => {
  const blocks = layoutAudioLane([
    { id: 'a', startSec: 0, durationSec: 10 },
    { id: 'b', startSec: 20, durationSec: 5 },
  ], 30)
  assert.ok(Math.abs(blocks[1].leftPct - 20 / 30 * 100) < 1e-9, `20s/30s → 66.7%，实得 ${blocks[1].leftPct}`)
  assert.ok(Math.abs(blocks[1].widthPct - 5 / 30 * 100) < 1e-9, `5s/30s → 16.7%，实得 ${blocks[1].widthPct}`)
})

// ---------------------------------------------------------------------------
// 2. 混音面板写回（nodeAudioOverride / buildNodeAudioTimeline）
// ---------------------------------------------------------------------------
test('nodeAudioOverride：读节点 audioTimeline 的角色段；无字段返回 undefined', () => {
  const node = { audioTimeline: { fps: 0, durationSec: 0, segments: [{ url: 'b.mp3', startSec: 0, role: 'bgm', gain: 0.5 }] } }
  assert.equal(nodeAudioOverride(node, 'bgm')?.gain, 0.5)
  assert.equal(nodeAudioOverride(node, 'voiceOver'), undefined)
  assert.equal(nodeAudioOverride({}, 'bgm'), undefined)
})

test('buildNodeAudioTimeline：patch 覆盖、未触字段继承、跨角色段保留（滑杆写回通路）', () => {
  const node = {
    url: 'b.mp3',
    audioTimeline: { fps: 0, durationSec: 0, segments: [
      { url: 'b.mp3', startSec: 0, role: 'bgm', gain: 0.35, fadeInSec: 1, fadeOutSec: 1 },
      { url: 'v.mp3', startSec: 2, role: 'voiceOver', gain: 1 },
    ] },
  }
  const next = buildNodeAudioTimeline(node, 'bgm', { gain: 0.6 })
  const bgm = next.segments.find((s) => s.role === 'bgm')
  const vo = next.segments.find((s) => s.role === 'voiceOver')
  assert.equal(bgm.gain, 0.6, 'patch 生效')
  assert.equal(bgm.fadeInSec, 1, '未触字段继承')
  assert.equal(bgm.fadeOutSec, 1)
  assert.deepEqual(vo, node.audioTimeline.segments[1], '旁白段原样保留')
  // 无既有字段时从零建（老节点第一次写回）。
  const fresh = buildNodeAudioTimeline({ url: 'x.mp3' }, 'voiceOver', { duckAmount: 0.5 })
  assert.equal(fresh.segments.length, 1)
  assert.equal(fresh.segments[0].role, 'voiceOver')
  assert.equal(fresh.segments[0].duckAmount, 0.5)
})

test('audioMixRows / resolveAudioMixRole：面板行派生（BGM 行 + 旁白行）', () => {
  const nodes = [
    { id: 'm1', kind: 'audio', toolName: 'music_generation', title: 'BGM 1' },
    { id: 'v1', kind: 'audio', toolName: 'tts_voiceover', title: '旁白 1' },
    { id: 'v2', kind: 'audio', title: '配音 2' },
    { id: 'x', kind: 'video', toolName: 'tts_voiceover' },
  ]
  const { bgmNode, voiceOverNodes } = audioMixRows(nodes, 'm1')
  assert.equal(bgmNode.id, 'm1')
  assert.deepEqual(voiceOverNodes.map((n) => n.id), ['v1', 'v2'], 'tts_voiceover + 标题关键词兜底，非音频节点不进')
  assert.equal(resolveAudioMixRole({ toolName: 'tts_voiceover' }), 'voiceOver')
})

// ---------------------------------------------------------------------------
// 3. 导出前预检（composeAudioPrecheck）
// ---------------------------------------------------------------------------
test('composeAudioPrecheck：短 BGM → confirm；无任何音频节点 → confirm；对齐 → ok', () => {
  const short = composeAudioPrecheck({ bgmDurationSec: 10, estSeconds: 15.5, hasAnyAudioNode: true })
  assert.equal(short.level, 'confirm')
  assert.ok(short.message.includes('短 5.5s'), `应给出差额，实得 ${short.message}`)
  assert.ok(short.message.includes('自动补静音'), '应说明默认处置（D-02）')
  // 容差内（0.05s）不弹。
  assert.equal(composeAudioPrecheck({ bgmDurationSec: 15.48, estSeconds: 15.5, hasAnyAudioNode: true }).level, 'ok')
  const silent = composeAudioPrecheck({ estSeconds: 12, hasAnyAudioNode: false })
  assert.equal(silent.level, 'confirm')
  assert.ok(silent.message.includes('没有任何音频节点'))
  assert.equal(composeAudioPrecheck({ bgmDurationSec: 20, estSeconds: 15.5, hasAnyAudioNode: true }).level, 'ok')
  assert.equal(composeAudioPrecheck({ estSeconds: 0, hasAnyAudioNode: false }).level, 'ok', '无片段（est=0）不弹')
})

// ---------------------------------------------------------------------------
// 4. 音频抽屉行派生（audioDrawerRows）
// ---------------------------------------------------------------------------
test('audioDrawerRows：全音频节点 + 角色 + 歌词首行 + 失效标记（多版对比）', () => {
  const rows = audioDrawerRows([
    { id: 'm1', kind: 'audio', toolName: 'music_generation', title: 'BGM A', duration: 30 },
    { id: 'm0', kind: 'audio', toolName: 'music_generation', title: 'BGM 旧版', retired: true },
    { id: 'v1', kind: 'audio', toolName: 'tts_voiceover', title: '旁白', text: '第一句歌词\n第二句' },
    { id: 'x', kind: 'video', title: '不是音频' },
  ])
  assert.equal(rows.length, 3, '只收 kind=audio')
  assert.deepEqual(rows.map((r) => r.node.id), ['m1', 'm0', 'v1'])
  assert.equal(rows[0].role, 'bgm')
  assert.equal(rows[0].durationSec, 30)
  assert.equal(rows[1].retired, true, '失效版本保留并标记（多版对比）')
  assert.equal(rows[2].role, 'voiceOver')
  assert.equal(rows[2].lyricFirstLine, '第一句歌词')
})
