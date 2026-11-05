/**
 * P1-4 段边界 diff 单测。
 *
 * 为什么必须测：这条提示是**唯一**能发现「模型绕过 builder 偷改帧表」的机制。
 * 它误报一次，模型就会学会无视它；它漏报一次，改坏的帧表就静默进成片。
 * 所以三种情形都要钉：完全一致（不说话）、段数变化、起点漂移。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diffSegments, segmentDriftNote, writeRenderAnchor } from '../lib/render-anchor.js'

function freshProject() {
  return mkdtempSync(join(tmpdir(), 'cs-drift-'))
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // 沙箱里递归删除可能被拦；清不掉不该让测试红。
  }
}

/** 8 段 caption 的最小 manifest（`segmentsOf` 只认 caption / textCard 的帧窗）。 */
function manifestOf(starts, { withCaption = true } = {}) {
  const tracks = starts.map((start, i) => ({
    id: `V${String(i + 1)}`,
    type: withCaption ? 'caption' : 'textCard',
    startFrame: start,
    durationInFrames: 120,
  }))
  return { id: 'comp-1', meta: { fps: 30 }, tracks }
}

const BASE = manifestOf([0, 120, 240, 360, 480, 600, 720, 840])

test('段边界完全一致：不报', () => {
  const diff = diffSegments(
    [{ id: 'V1', startFrame: 0, endFrame: 120 }, { id: 'V2', startFrame: 120, endFrame: 240 }],
    [{ id: 'V1', startFrame: 0, endFrame: 130 }, { id: 'V2', startFrame: 120, endFrame: 240 }],
  )
  assert.equal(diff.changed, false)
  assert.deepEqual(diff.added, [])
  assert.deepEqual(diff.removed, [])
  // 结束帧变化不算段边界变化（边界 = 段的起点身份），这正是「只报起点」的口径。
  assert.deepEqual(diff.shifted, [])
})

test('段数变化：新增段被点名', () => {
  const diff = diffSegments(
    [{ id: 'V1', startFrame: 0, endFrame: 120 }],
    [{ id: 'V1', startFrame: 0, endFrame: 120 }, { id: 'V2', startFrame: 120, endFrame: 240 }],
  )
  assert.equal(diff.changed, true)
  assert.equal(diff.baselineCount, 1)
  assert.equal(diff.currentCount, 2)
  assert.deepEqual(diff.added, ['V2'])
})

test('段被删掉：removed 点名', () => {
  const diff = diffSegments(
    [{ id: 'V1', startFrame: 0, endFrame: 120 }, { id: 'V2', startFrame: 120, endFrame: 240 }],
    [{ id: 'V1', startFrame: 0, endFrame: 120 }],
  )
  assert.deepEqual(diff.removed, ['V2'])
  assert.equal(diff.changed, true)
})

test('起点漂移：shifted 带上 from / to', () => {
  const diff = diffSegments(
    [{ id: 'V3', startFrame: 300, endFrame: 420 }],
    [{ id: 'V3', startFrame: 320, endFrame: 440 }],
  )
  assert.deepEqual(diff.shifted, [{ id: 'V3', from: 300, to: 320 }])
  assert.equal(diff.changed, true)
})

test('还没有基准（第一次出片）：segmentDriftNote 返回空串，不许告警自己', () => {
  const dir = freshProject()
  try {
    assert.equal(segmentDriftNote(dir, BASE), '')
  } finally {
    cleanup(dir)
  }
})

test('基准已落、当前一致：空串', () => {
  const dir = freshProject()
  try {
    writeRenderAnchor({
      projectDir: dir,
      manifest: BASE,
      quality: 'draft',
      durationSec: 32,
      trackCount: BASE.tracks.length,
      sampledFrames: [],
    })
    assert.equal(segmentDriftNote(dir, BASE), '')
  } finally {
    cleanup(dir)
  }
})

test('段数变化：提示带「8 段 → 9 段」与新增段名', () => {
  const dir = freshProject()
  try {
    writeRenderAnchor({
      projectDir: dir,
      manifest: BASE,
      quality: 'draft',
      durationSec: 32,
      trackCount: BASE.tracks.length,
      sampledFrames: [],
    })
    const next = manifestOf([0, 120, 240, 360, 480, 600, 720, 840, 960])
    const note = segmentDriftNote(dir, next)
    assert.ok(note.includes('段边界相对 v1 变了'), note)
    assert.ok(note.includes('8 段 → 9 段'), note)
    assert.ok(note.includes('新增 V9'), note)
    assert.ok(note.includes('重排'), '必须告诉模型：重排要在汇报里说明')
  } finally {
    cleanup(dir)
  }
})

test('起点漂移：提示带 from → to（改坏帧表能看出来）', () => {
  const dir = freshProject()
  try {
    writeRenderAnchor({
      projectDir: dir,
      manifest: BASE,
      quality: 'draft',
      durationSec: 32,
      trackCount: BASE.tracks.length,
      sampledFrames: [],
    })
    const shifted = manifestOf([0, 120, 320, 360, 480, 600, 720, 840])
    const note = segmentDriftNote(dir, shifted)
    assert.ok(note.includes('V3 起点 240 → 320'), note)
  } finally {
    cleanup(dir)
  }
})

test('没有 caption 轨时回落到 textCard（同一份口径，不另立判定）', () => {
  const dir = freshProject()
  try {
    writeRenderAnchor({
      projectDir: dir,
      manifest: manifestOf([0, 120], { withCaption: false }),
      quality: 'draft',
      durationSec: 8,
      trackCount: 2,
      sampledFrames: [],
    })
    assert.equal(segmentDriftNote(dir, manifestOf([0, 120], { withCaption: false })), '')
    assert.ok(segmentDriftNote(dir, manifestOf([0, 200], { withCaption: false })).includes('V2 起点 120 → 200'))
  } finally {
    cleanup(dir)
  }
})
