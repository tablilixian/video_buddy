/**
 * 复刻提效批四：拆解成果跨项目落库（src/teardown-store.ts）单测。
 *
 * 存储根可注入（root 参数）—— 测试全部走临时目录，不碰真实 dshHome。
 * 覆盖：指纹稳定性（同文件跨目录同 key）与敏感性（改名/改字节 = 新 key）、
 * save→load 往返、重复 save 覆盖（updated + priorSavedAt）、损坏档如实报 corrupt、
 * list 排序与跳过损坏条目、<2 段拒收、videoPath 不可读拒收。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// 错误码目录表（CS-USER-ERR）靠副作用注册。
import '../lib/errors/catalog.js'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveTeardown, loadTeardown, listTeardowns } from '../lib/teardown-store.js'

/** 尽力而为清理（受管 shell 的 unlink 偶发 EPERM，不让清理失败淹掉测试结论）。 */
function cleanupDir(dir) {
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* 临时目录留给系统清 */ }
}

function makeVideo(dir, name, bytes = 1024) {
  const p = join(dir, name)
  writeFileSync(p, Buffer.alloc(bytes, 7))
  return p
}

const SEGMENTS = [
  { label: '开场', startSec: 0, endSec: 1.8 },
  { label: '口味一', startSec: 1.8, endSec: 4.2 },
  { label: '收尾', startSec: 4.2, endSec: 6.0 },
]

test('save→load 往返：segments 与 note 原样取回', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cs-teardown-store-'))
  try {
    const video = makeVideo(root, 'ref-a.mp4')
    const saved = await saveTeardown({ videoPath: video, segments: SEGMENTS, note: '原片 -11.4 LUFS', root })
    assert.equal(saved.updated, false)
    assert.equal(saved.videoName, 'ref-a.mp4')
    const hit = await loadTeardown(video, root)
    assert.equal(hit.found, true)
    assert.deepEqual(hit.segments, SEGMENTS)
    assert.equal(hit.note, '原片 -11.4 LUFS')
    assert.equal(hit.videoName, 'ref-a.mp4')
  } finally { cleanupDir(root) }
})

test('指纹：同一份文件拷到别的目录 key 不变；改名/改字节 = 新 key（双向）', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cs-teardown-store-'))
  try {
    const video = makeVideo(root, 'ref.mp4', 2048)
    const saved = await saveTeardown({ videoPath: video, segments: SEGMENTS, root })
    // 同文件换目录（模拟新 project dir 引用同一支参考片）
    const otherDir = join(root, 'project-b')
    mkdirSync(otherDir)
    const copied = join(otherDir, 'ref.mp4')
    copyFileSync(video, copied)
    const hit = await loadTeardown(copied, root)
    assert.equal(hit.found, true, '跨目录同指纹必须命中')
    assert.equal(hit.key, saved.key)
    // 改名 → 新 key
    const renamed = join(root, 'renamed.mp4')
    copyFileSync(video, renamed)
    assert.equal((await loadTeardown(renamed, root)).found, false)
    // 改字节（重编码）→ 新 key
    const resized = makeVideo(root, 'ref.mp4', 4096) // 同名不同字节 → 不同 key
    const saved2 = await saveTeardown({ videoPath: resized, segments: SEGMENTS, root })
    assert.notEqual(saved2.key, saved.key)
  } finally { cleanupDir(root) }
})

test('重复 save：覆盖旧档并带回上一版时间', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cs-teardown-store-'))
  try {
    const video = makeVideo(root, 'ref.mp4')
    const first = await saveTeardown({ videoPath: video, segments: SEGMENTS, root })
    const second = await saveTeardown({ videoPath: video, segments: SEGMENTS.slice(0, 2), note: 'v2', root })
    assert.equal(second.updated, true)
    assert.equal(second.priorSavedAt, first.savedAt)
    const hit = await loadTeardown(video, root)
    assert.equal(hit.segments.length, 2)
    assert.equal(hit.note, 'v2')
  } finally { cleanupDir(root) }
})

test('损坏档：load 如实报 corrupt，list 跳过不炸', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cs-teardown-store-'))
  try {
    const video = makeVideo(root, 'ref.mp4')
    const saved = await saveTeardown({ videoPath: video, segments: SEGMENTS, root })
    writeFileSync(saved.file, '{not-json')
    const hit = await loadTeardown(video, root)
    assert.equal(hit.found, false)
    assert.equal(hit.corrupt, true)
  } finally { cleanupDir(root) }
})

test('list：按时间倒序、条目字段齐全、损坏条目跳过', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cs-teardown-store-'))
  try {
    const a = await saveTeardown({ videoPath: makeVideo(root, 'a.mp4'), segments: SEGMENTS, note: '甲', root })
    const b = await saveTeardown({ videoPath: makeVideo(root, 'b.mp4'), segments: SEGMENTS, root })
    // 人为拉开 savedAt（同秒内 ISO 时间相同会让排序不稳）
    await new Promise((r) => setTimeout(r, 20))
    const c = await saveTeardown({ videoPath: makeVideo(root, 'c.mp4'), segments: SEGMENTS, root })
    writeFileSync(join(root, 'teardowns', 'broken.json'), 'garbage')
    const entries = await listTeardowns(root)
    assert.equal(entries.length, 3, '损坏条目跳过')
    assert.equal(entries[0].key, c.key, '最近落库在前')
    assert.ok([a.key, b.key].includes(entries[1].key))
    assert.equal(entries[0].segmentCount, 3)
    const withNote = entries.find((e) => e.note !== undefined)
    assert.equal(withNote?.note, '甲')
    // 空库
    assert.deepEqual(await listTeardowns(join(root, 'nope')), [])
  } finally { cleanupDir(root) }
})

test('拒收：save 少于 2 段；videoPath 不可读', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cs-teardown-store-'))
  try {
    const video = makeVideo(root, 'ref.mp4')
    await assert.rejects(
      () => saveTeardown({ videoPath: video, segments: [SEGMENTS[0]], root }),
      (error) => error?.code === 'CS-USER-ERR',
    )
    await assert.rejects(
      () => saveTeardown({ videoPath: join(root, 'missing.mp4'), segments: SEGMENTS, root }),
      (error) => error?.code === 'CS-USER-ERR',
    )
    await assert.rejects(() => loadTeardown(join(root, 'missing.mp4'), root), (error) => error?.code === 'CS-USER-ERR')
  } finally { cleanupDir(root) }
})
