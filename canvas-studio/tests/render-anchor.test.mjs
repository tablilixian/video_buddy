/**
 * 出片锚点 + 里程碑时钟单测（骨架优先出片 · P0）。
 *
 * 为什么必须测：
 *  - 今天（2026-11-05）3h37m 零成片的根因是「压缩后没有落点」—— 锚点是这个落点。
 *    它一旦静默失效，模型下一轮又会回去重读源码重推整片，而且**没有任何报错**。
 *  - 两条「不写」规则同样是防回归点：probe / spot 不是成片（写进锚点会污染「当前
 *    最佳」），模型手写的「下一步 / 未决」在重写时不能被宿主抹掉。
 *  - 时钟的三档文案（未出片 / 已超线 / 已达成）决定模型会不会在超时后继续美化，
 *    所以逐档钉住，且用固定 `now` 断言（不依赖真实时间）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  formatMilestoneClock,
  nextAnchorVersion,
  readAnchorState,
  readProgressSections,
  renderProgressMarkdown,
  segmentsOf,
  writeRenderAnchor,
} from '../lib/render-anchor.js'
import { appendClockLine } from '../lib/tool-error-boundary.js'

function freshDir() {
  return mkdtempSync(join(tmpdir(), 'cs-anchor-'))
}

test('segmentsOf：优先字幕轨，按 startFrame 排序，endFrame = start + duration', () => {
  const manifest = {
    tracks: [
      { id: 'bg', type: 'shape', startFrame: 0, durationInFrames: 900 },
      { id: 'cap-2', type: 'caption', startFrame: 300, durationInFrames: 120 },
      { id: 'cap-1', type: 'caption', startFrame: 0, durationInFrames: 300 },
    ],
  }
  assert.deepEqual(segmentsOf(manifest), [
    { id: 'cap-1', startFrame: 0, endFrame: 300 },
    { id: 'cap-2', startFrame: 300, endFrame: 420 },
  ])
})

test('segmentsOf：没有 caption 时退到 textCard（recipe 骨架就是这种）', () => {
  const manifest = {
    tracks: [
      { id: 'bg', type: 'shape', startFrame: 0, durationInFrames: 900 },
      { id: 'seg-hook', type: 'textCard', startFrame: 0, durationInFrames: 200 },
      { id: 'seg-data', type: 'textCard', startFrame: 200, durationInFrames: 700 },
    ],
  }
  assert.deepEqual(segmentsOf(manifest).map((s) => s.id), ['seg-hook', 'seg-data'])
})

test('segmentsOf：空 / 非法输入不抛', () => {
  assert.deepEqual(segmentsOf(undefined), [])
  assert.deepEqual(segmentsOf({}), [])
  assert.deepEqual(segmentsOf({ tracks: 'x' }), [])
})

test('nextAnchorVersion：空目录从 1 起，取最大 +1，忽略非 vN 文件', () => {
  const dir = freshDir()
  try {
    assert.equal(nextAnchorVersion(join(dir, 'versions')), 1)
    mkdirSync(join(dir, 'versions'), { recursive: true })
    writeFileSync(join(dir, 'versions', 'v1.json'), '{}')
    writeFileSync(join(dir, 'versions', 'v7.json'), '{}')
    writeFileSync(join(dir, 'versions', 'notes.txt'), 'x')
    assert.equal(nextAnchorVersion(join(dir, 'versions')), 8)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('writeRenderAnchor：落快照 + 状态 + PROGRESS，版本递增且内容可回读', () => {
  const dir = freshDir()
  try {
    const manifest = {
      id: 'comp-1',
      meta: { fps: 30, durationInFrames: 900 },
      tracks: [{ id: 'cap-1', type: 'caption', startFrame: 0, durationInFrames: 900 }],
    }
    const first = writeRenderAnchor({
      projectDir: dir,
      manifest,
      quality: 'draft',
      durationSec: 45,
      width: 1376,
      height: 768,
      trackCount: 1,
      sampledFrames: [0, 450],
      title: '玻璃为什么是透明的',
      now: 1_760_000_000_000,
    })
    assert.equal(first.version, 1)
    assert.match(first.summary, /锚点 v1 · 45\.00s · 1 轨/)
    const snapshot = JSON.parse(readFileSync(join(dir, 'build', 'versions', 'v1.json'), 'utf8'))
    assert.equal(snapshot.id, 'comp-1')
    const progress = readFileSync(join(dir, 'build', 'PROGRESS.md'), 'utf8')
    assert.match(progress, /# 进度锚 · 玻璃为什么是透明的/)
    assert.match(progress, /v1 · .*draft · 45\.00s · 1376×768 · 1 轨/)
    assert.match(progress, /本版抽帧：0, 450/)

    const second = writeRenderAnchor({
      projectDir: dir,
      manifest,
      quality: 'draft',
      durationSec: 45,
      trackCount: 2,
      now: 1_760_000_060_000,
    })
    assert.equal(second.version, 2)
    const state = readAnchorState(dir)
    assert.equal(state.versions.length, 2)
    // 标题在第一版写入后应保留（第二版没传 title）
    assert.equal(state.title, '玻璃为什么是透明的')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('writeRenderAnchor：重写 PROGRESS 时保留模型手写的「下一步 / 未决」', () => {
  const dir = freshDir()
  try {
    const manifest = { tracks: [] }
    writeRenderAnchor({ projectDir: dir, manifest, quality: 'draft', durationSec: 10, trackCount: 0 })
    const path = join(dir, 'build', 'PROGRESS.md')
    const edited = readFileSync(path, 'utf8')
      .replace(/## 下一步唯一动作\n[\s\S]*?\n## 已知未决/, '## 下一步唯一动作\n- 给 data 段加折线（帧 152–420）\n\n## 已知未决')
      .replace(/## 已知未决\n[\s\S]*$/, '## 已知未决\n- 末句字幕 2 行溢出\n')
    writeFileSync(path, edited, 'utf8')

    writeRenderAnchor({ projectDir: dir, manifest, quality: 'draft', durationSec: 10, trackCount: 0 })
    const after = readFileSync(path, 'utf8')
    assert.match(after, /给 data 段加折线/)
    assert.match(after, /末句字幕 2 行溢出/)
    assert.match(after, /v2/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readProgressSections：取两段，缺失返回 undefined', () => {
  const md = '# t\n\n## 下一步唯一动作\n- 做 A\n\n## 已知未决\n- B\n'
  assert.deepEqual(readProgressSections(md), { nextAction: '- 做 A', openIssues: '- B' })
  assert.deepEqual(readProgressSections('# t\n'), {})
})

test('renderProgressMarkdown：无成片时明说「尚无成片」，不给假版本', () => {
  const md = renderProgressMarkdown({ versions: [] }, 1_760_000_000_000)
  assert.match(md, /尚无成片/)
  assert.match(md, /probe \/ spotFrames 不算成片/)
})

test('formatMilestoneClock：无 landedAt 返回空串（老项目不误报）', () => {
  assert.equal(formatMilestoneClock({ now: 1000 }), '')
  assert.equal(formatMilestoneClock({ now: 1000, landedAt: 0 }), '')
})

test('formatMilestoneClock：未出片时给剩余分钟', () => {
  const landedAt = 1_760_000_000_000
  const line = formatMilestoneClock({ landedAt, now: landedAt + 5 * 60_000 })
  assert.match(line, /M1 剩余 15min（T\+5min）/)
  assert.match(line, /尚无成片/)
})

test('formatMilestoneClock：超线后给明确动作（不是继续美化）', () => {
  const landedAt = 1_760_000_000_000
  const line = formatMilestoneClock({ landedAt, now: landedAt + 27 * 60_000 })
  assert.match(line, /已超 M1 硬线/)
  assert.match(line, /scaffold_manifest/)
  assert.match(line, /quality:"draft"/)
})

test('formatMilestoneClock：已出片时报首片时刻与当前最佳版本', () => {
  const landedAt = 1_760_000_000_000
  const line = formatMilestoneClock({
    landedAt,
    firstDraftAt: landedAt + 6 * 60_000,
    now: landedAt + 40 * 60_000,
    best: { version: 3, at: 0, quality: 'draft', durationSec: 45, trackCount: 78, segments: [], sampledFrames: [] },
  })
  assert.match(line, /M1 已达成（首片 T\+6min）/)
  assert.match(line, /当前最佳 v3 · 45\.00s · 78 轨/)
})

test('appendClockLine：追加在末尾，不改动原结果（纯函数）', () => {
  const result = { isError: false, value: {}, content: [{ type: 'text', text: '原结果' }] }
  const next = appendClockLine(result, '⏱ M1 剩余 3min')
  assert.equal(result.content.length, 1)
  assert.equal(next.content.length, 2)
  assert.deepEqual(next.content[1], { type: 'text', text: '⏱ M1 剩余 3min' })
  assert.equal(next.content[0].text, '原结果')
})
