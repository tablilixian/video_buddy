/**
 * REQ-041 L1（2026-11-25）· **段产物只读清单**（行为断言，可反向变异）。
 *
 * 锁四件事：
 * ① 两种 card 形状都认（实际写入是顶层 `segments`，需求文档写 `pointers.segments`）；
 * ② 副本 stat 不到 ⇒ 该段不进清单（未渲项目回空，不刷 404）；
 * ③ `ref` 原样透传，不从清洗后的 id 反推（中文 id / 过期段表会静默配错屏）；
 * ④ id 白名单：card.json 被手改塞 `../x` 也不能越出 assets 目录。
 *
 * 反向变异：去掉 stat 判存 ⇒ 「副本缺失」用例红；从 id 拼 ref ⇒ 「ref 透传」用例红；
 * 去掉白名单 ⇒ 「路径穿越」用例红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readSegmentMedia } from '../lib/segment-media.js'

function project(card, files = ['s1', 's2']) {
  const projectDir = mkdtempSync(join(tmpdir(), 'cs-seg-media-'))
  const assetsDir = join(projectDir, 'assets')
  mkdirSync(join(projectDir, 'deliver'), { recursive: true })
  mkdirSync(assetsDir, { recursive: true })
  writeFileSync(join(projectDir, 'deliver', 'card.json'), JSON.stringify(card))
  for (const id of files) writeFileSync(join(assetsDir, `seg-${id}.mp4`), `VIDEO:${id}`)
  return { projectDir, assetsDir }
}

const ROWS = [
  { id: 's1', ref: 'spec:s1', startFrame: 0, frames: 190, durationSec: 6.333 },
  { id: 's2', ref: 'spec:s2', startFrame: 190, frames: 200, durationSec: 6.667 },
]

test('顶层 segments：6 段全回、ref 原样、url 指向 assets 媒体路由、v = mtimeMs', async () => {
  const p = project({ segments: ROWS })
  const view = await readSegmentMedia({ ...p, projectId: 'p1' })
  assert.equal(view.projectId, 'p1')
  assert.deepEqual(view.segments.map((s) => s.ref), ['spec:s1', 'spec:s2'])
  assert.deepEqual(view.segments.map((s) => s.url), [
    '/canvas-studio/assets/p1/seg-s1.mp4',
    '/canvas-studio/assets/p1/seg-s2.mp4',
  ])
  assert.deepEqual(view.segments.map((s) => s.startFrame), [0, 190])
  assert.deepEqual(view.segments.map((s) => s.durationSec), [6.333, 6.667])
  assert.ok(view.segments.every((s) => Number.isFinite(s.v) && s.v > 0), 'v 必须是 mtimeMs')
})

test('兼容 pointers.segments（需求文档写法），顶层优先', async () => {
  const p = project({ pointers: { segments: ROWS }, segments: [ROWS[0]] })
  const view = await readSegmentMedia({ ...p, projectId: 'p' })
  assert.deepEqual(view.segments.map((s) => s.id), ['s1'], '顶层优先')
  const nested = project({ pointers: { segments: ROWS } })
  assert.deepEqual((await readSegmentMedia({ ...nested, projectId: 'p' })).segments.map((s) => s.id), ['s1', 's2'])
})

test('副本缺失 / 无 card / 坏 JSON ⇒ 空清单（诚实失败，不 404 不报错）', async () => {
  const missing = project({ segments: ROWS }, ['s1'])
  assert.deepEqual((await readSegmentMedia({ ...missing, projectId: 'p' })).segments.map((s) => s.id), ['s1'])

  const bare = mkdtempSync(join(tmpdir(), 'cs-seg-media-empty-'))
  assert.deepEqual(await readSegmentMedia({ projectDir: bare, assetsDir: join(bare, 'assets'), projectId: 'none' }),
    { projectId: 'none', segments: [] })

  const broken = project(null)
  writeFileSync(join(broken.projectDir, 'deliver', 'card.json'), '{ broken')
  assert.deepEqual((await readSegmentMedia({ ...broken, projectId: 'p' })).segments, [])
})

test('ref 缺省原样缺省：历史卡没有 ref 时不得按 id 反推', async () => {
  const p = project({ segments: [{ id: '第一屏', startFrame: 0, frames: 10, durationSec: 0.33 }] }, [])
  const view = await readSegmentMedia({ ...p, projectId: 'p' })
  assert.deepEqual(view.segments, [], '中文 id 不是合法产物 id，且没有副本，必须跳过')
  const ascii = project({ segments: [{ id: 's2', startFrame: 0, frames: 10, durationSec: 0.33 }] })
  const legacy = await readSegmentMedia({ ...ascii, projectId: 'p' })
  assert.equal(legacy.segments.length, 1)
  assert.ok(!('ref' in legacy.segments[0]), '没有发布时对齐信息就不给 ref（不许 spec: + id 猜）')
})

test('路径穿越 id 直接跳过；中文 projectId 在 URL 中编码', async () => {
  const p = project({ segments: [
    { id: '../evil', startFrame: 0, frames: 10, durationSec: 0.33 },
    { id: 's1', startFrame: 0, frames: 10, durationSec: 0.33 },
  ] })
  const view = await readSegmentMedia({ ...p, projectId: '我的项目 3' })
  assert.deepEqual(view.segments.map((s) => s.id), ['s1'])
  assert.equal(view.segments[0].url, `/canvas-studio/assets/${encodeURIComponent('我的项目 3')}/seg-s1.mp4`)
})
