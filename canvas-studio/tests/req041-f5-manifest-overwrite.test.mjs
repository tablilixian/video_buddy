/**
 * REQ-041 §5.4：重编 manifest 时**丢掉的手工轨**必须说出来 —— 守卫。
 *
 * 真机事故（2026-11-25 超级月亮）：模型为了「椭圆轨道」手改 `build/manifest.json`
 * （spec 的 section 字段表达不了沿路径运动），随后拆屏又跑了一次
 * `scaffold_from_spec({ writeTo: "build/manifest.json" })` —— **整份覆盖**，
 * 手工轨静默消失。模型自己在会话里都写着「重编后恢复第 2 屏的椭圆轨道和音频」，
 * 说明这层丢失从来没有被工具说过一次，全靠它记性。
 *
 * 本文件钉三件事：
 * 1. 覆盖前能算出「旧有新无」的轨 id（含 group 子轨）；
 * 2. 旧文件读不懂时**不说话**（不造假告警）；
 * 3. `writeManifestFile` 真的把这个结果带出来（接线行为断言，不看源码文本）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diffOverwrittenTracks, droppedTracksNote } from '../lib/manifest-overwrite.js'
import { writeManifestFile } from '../lib/manifest-file.js'

const manifestOf = (tracks) => JSON.stringify({ meta: { durationInFrames: 300 }, tracks })

test('覆盖差异：旧有新无的轨被点名（模板轨保留则不算丢失）', () => {
  const previous = manifestOf([
    { id: 'title', type: 'textCard', startFrame: 0, durationInFrames: 60 },
    { id: 's2-orbit', type: 'shape', startFrame: 60, durationInFrames: 90 },
  ])
  const next = manifestOf([
    { id: 'title', type: 'textCard', startFrame: 0, durationInFrames: 60 },
    { id: 's2-unit', type: 'textCard', startFrame: 60, durationInFrames: 90 },
  ])
  const diff = diffOverwrittenTracks(previous, next)
  assert.deepEqual(diff.dropped, ['s2-orbit'], '手工加的椭圆轨道必须被点名')
  assert.deepEqual(diff.nextTrackIds, ['title', 's2-unit'])
})

test('覆盖差异：group 容器的子轨也参与判定（它们才是真正会渲染的）', () => {
  const previous = manifestOf([
    { id: 'g1', type: 'group', startFrame: 0, durationInFrames: 120, children: [{ id: 'g1-child-orbit', type: 'shape' }] },
  ])
  const next = manifestOf([{ id: 'g1', type: 'group', startFrame: 0, durationInFrames: 120, children: [] }])
  assert.deepEqual(diffOverwrittenTracks(previous, next).dropped, ['g1-child-orbit'])
})

test('覆盖差异：旧文件不存在 / 读不懂 ⇒ null（不发假告警）', () => {
  assert.equal(diffOverwrittenTracks(undefined, manifestOf([])), null)
  assert.equal(diffOverwrittenTracks('{ not json', manifestOf([])), null)
  assert.equal(diffOverwrittenTracks(manifestOf([]), '{ not json'), null)
})

test('覆盖差异：没有丢失 ⇒ 文案为空串', () => {
  const same = manifestOf([{ id: 'a', type: 'textCard', startFrame: 0, durationInFrames: 30 }])
  const note = droppedTracksNote(diffOverwrittenTracks(same, same))
  assert.equal(note, '')
})

test('文案：说清「丢了几条 / 是哪几条 / 为什么 / 怎么办」', () => {
  const previous = manifestOf([
    { id: 'orbit-a', type: 'shape', startFrame: 0, durationInFrames: 30 },
    { id: 'orbit-b', type: 'shape', startFrame: 30, durationInFrames: 30 },
  ])
  const note = droppedTracksNote(diffOverwrittenTracks(previous, manifestOf([])))
  assert.match(note, /2 条轨/)
  assert.match(note, /orbit-a、orbit-b/)
  assert.match(note, /手工轨/, '要让模型知道这不是模板产出的')
  assert.match(note, /别以为重编会保留/)
})

test('writeManifestFile：覆盖时把丢失的轨带出来（接线行为断言）', () => {
  const root = mkdtempSync(join(tmpdir(), 'cs-overwrite-'))
  try {
    const target = join(root, 'build', 'manifest.json')
    writeManifestFile({ projectDir: root, writeTo: 'build/manifest.json', json: manifestOf([
      { id: 'title', type: 'textCard', startFrame: 0, durationInFrames: 60 },
      { id: 's2-orbit', type: 'shape', startFrame: 60, durationInFrames: 90 },
    ]), trackCount: 2 })
    const written = writeManifestFile({ projectDir: root, writeTo: 'build/manifest.json', json: manifestOf([
      { id: 'title', type: 'textCard', startFrame: 0, durationInFrames: 60 },
    ]), trackCount: 1 })
    assert.deepEqual(written.droppedTracks.dropped, ['s2-orbit'], '回执层拿得到这个结果')
    assert.equal(JSON.parse(readFileSync(target, 'utf8')).tracks.length, 1, '文件确实被新版本覆盖')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('writeManifestFile：目标原本不存在 ⇒ 没有「丢失」（首次落盘）', () => {
  const root = mkdtempSync(join(tmpdir(), 'cs-overwrite-fresh-'))
  try {
    const written = writeManifestFile({
      projectDir: root,
      writeTo: 'build/manifest.json',
      json: manifestOf([{ id: 'a', type: 'textCard', startFrame: 0, durationInFrames: 30 }]),
      trackCount: 1,
    })
    assert.equal(written.droppedTracks, null)
    assert.equal(droppedTracksNote(written.droppedTracks), '')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
