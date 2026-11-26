/**
 * REQ-041 F6 · **`patch_segment_tracks` 工具层**守卫（写入路径 + 五种 mode + 脏参数拒收）。
 *
 * 纯函数与 IO 的行为已在 `req041-f6-segment-overrides.test.mjs` 钉住；这里只测**入口**：
 * 工具层能不能把「用户的意图」正确落成一份 override，以及脏参数是不是真的零副作用。
 *
 * 真机教训（2026-11-25）：模型宁可手改 `build/manifest.json` 也不走工具，是因为没有工具。
 * 所以本工具的回执必须自己回答三个问题：**改了哪一屏、现在几条、下一步怎么看到效果**。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { definePatchSegmentTracksTool } from '../lib/host-tools-overrides.js'
import { readProjectOverrides, overrideCountByRef } from '../lib/segment-overrides-io.js'
import { mergeProjectOverrides } from '../lib/segment-overrides-io.js'
import { planSegmentTable } from '../lib/segment-table.js'
import { SEGMENT_OVERRIDES_DIR } from '../lib/segment-overrides.js'

const FPS = 30

function textCard(id, startFrame, durationInFrames, text = id) {
  return { id, type: 'textCard', variant: 'subtitle', startFrame, durationInFrames, text }
}

const MANIFEST = {
  id: 'm1',
  meta: {
    title: 't',
    fps: FPS,
    durationInFrames: 400,
    width: 1920,
    height: 1080,
    backgroundColor: '#000',
    segments: [
      { id: 's1', startFrame: 0, frames: 200 },
      { id: 's2', startFrame: 200, frames: 200 },
    ],
  },
  tracks: [textCard('V2', 0, 200), textCard('V3', 200, 200)],
}

const SPEC = {
  meta: { fps: FPS, durationSec: 400 / FPS },
  sections: [{ id: 's1', durationSec: 200 / FPS }, { id: 's2', durationSec: 200 / FPS }],
}

function orbitTrack(id, startFrame, durationInFrames) {
  return {
    id,
    type: 'shape',
    shape: 'circle',
    color: '#ffcc66',
    startFrame,
    durationInFrames,
    orbit: { center: { x: 50, y: 50 }, radius: 20, periodInFrames: durationInFrames },
  }
}

/** 一个「已 scaffold 过」的项目：build/manifest.json + build/spec.json 都在盘上。 */
function fixture(options = {}) {
  const projectDir = mkdtempSync(join(tmpdir(), 'cs-f6-tool-'))
  mkdirSync(join(projectDir, 'build'), { recursive: true })
  const manifest = options.manifest ?? MANIFEST
  writeFileSync(join(projectDir, 'build', 'manifest.json'), JSON.stringify(manifest), 'utf8')
  writeFileSync(join(projectDir, 'build', 'spec.json'), JSON.stringify(options.spec ?? SPEC), 'utf8')
  const canvas = options.canvas ?? { nodes: [] }
  const registry = {
    projectDir: () => projectDir,
    readCanvas: async () => canvas,
  }
  const tool = definePatchSegmentTracksTool({
    registry,
    resolveProjectId: async () => 'p1',
  })
  const exec = { agent: { session: { header: { cwd: projectDir } } } }
  return { projectDir, tool, exec }
}

function overrideFile(projectDir, ref = 'spec:s2') {
  return join(projectDir, SEGMENT_OVERRIDES_DIR, `${ref.replace(':', '-')}.json`)
}

test('F6 工具：set 落盘 + 回执点明「重编不会丢」与下一步', async () => {
  const { projectDir, tool, exec } = fixture()
  try {
    const result = await tool.execute({ ref: 's2', tracks: [orbitTrack('hi-orbit-1', 210, 180)] }, exec)
    assert.equal(result.ref, 'spec:s2', '裸段 id 归一化成 spec: 前缀')
    assert.equal(result.mode, 'set')
    assert.equal(result.tracks, 1)
    assert.equal(result.path, `${SEGMENT_OVERRIDES_DIR}/spec-s2.json`)
    assert.match(result.text, /重编 manifest 都不会丢/)
    assert.match(result.text, /rerender_segment/, '必须告诉模型下一步怎么看到画面变化')
    assert.match(result.text, /200–400 帧/, '回执要写段窗，模型才知道时间窗该落在哪')

    const raw = JSON.parse(readFileSync(overrideFile(projectDir), 'utf8'))
    assert.deepEqual(raw.anchor, { startFrame: 200, frames: 200 }, 'anchor 记的是当前段窗')
    assert.equal(raw.tracks.length, 1)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

test('F6 工具：add 追加；同 id 再 add 是覆盖不是重复', async () => {
  const { projectDir, tool, exec } = fixture()
  try {
    await tool.execute({ segmentId: 's2', tracks: [orbitTrack('hi-1', 210, 60)] }, exec)
    const added = await tool.execute({ segmentId: 's2', mode: 'add', tracks: [orbitTrack('hi-2', 300, 60)] }, exec)
    assert.equal(added.tracks, 2)

    const replaced = await tool.execute({
      segmentId: 's2',
      mode: 'add',
      tracks: [orbitTrack('hi-1', 240, 60)],
    }, exec)
    assert.equal(replaced.tracks, 2, '同 id 追加 = 替换那一条，不新增')
    const stored = readProjectOverrides(projectDir).overrides[0]
    assert.deepEqual(stored.tracks.map((track) => track.startFrame).sort((a, b) => a - b), [240, 300])
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

test('F6 工具：remove 按 ids 删；删空之后文件消失', async () => {
  const { projectDir, tool, exec } = fixture()
  try {
    await tool.execute({ segmentId: 's2', tracks: [orbitTrack('hi-1', 210, 60), orbitTrack('hi-2', 300, 60)] }, exec)
    const removed = await tool.execute({ segmentId: 's2', mode: 'remove', ids: ['hi-1'] }, exec)
    assert.equal(removed.tracks, 1)
    const emptied = await tool.execute({ segmentId: 's2', mode: 'remove', ids: ['hi-2'] }, exec)
    assert.equal(emptied.tracks, 0)
    assert.equal(existsSync(overrideFile(projectDir)), false, '零条手工轨不该留空文件')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

test('F6 工具：clear 幂等（没有文件时也是成功而不是报错）', async () => {
  const { projectDir, tool, exec } = fixture()
  try {
    const first = await tool.execute({ segmentId: 's2', mode: 'clear' }, exec)
    assert.match(first.text, /本来就没有手工轨/)
    await tool.execute({ segmentId: 's2', tracks: [orbitTrack('hi-1', 210, 60)] }, exec)
    const second = await tool.execute({ segmentId: 's2', mode: 'clear' }, exec)
    assert.match(second.text, /已清空/)
    assert.equal(existsSync(overrideFile(projectDir)), false)
    assert.equal(overrideCountByRef(projectDir).size, 0)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

test('F6 工具：show 只看不改（无文件也讲得清段窗）', async () => {
  const { projectDir, tool, exec } = fixture()
  try {
    const empty = await tool.execute({ segmentId: 's2', mode: 'show' }, exec)
    assert.equal(empty.tracks, 0)
    assert.equal(empty.path, '')
    assert.match(empty.text, /当前没有手工轨/)
    assert.match(empty.text, /200–400/)

    await tool.execute({ segmentId: 's2', tracks: [orbitTrack('hi-1', 210, 60)] }, exec)
    const filled = await tool.execute({ segmentId: 's2', mode: 'show' }, exec)
    assert.equal(filled.tracks, 1)
    assert.match(filled.text, /hi-1/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

test('F6 工具：脏参数**零副作用**（越段 / 撞 id / 无 tracks / 多定位）', async () => {
  const { projectDir, tool, exec } = fixture()
  try {
    await assert.rejects(
      () => tool.execute({ segmentId: 's2', tracks: [orbitTrack('hi-1', 150, 60)] }, exec),
      /越出本段/,
    )
    await assert.rejects(
      () => tool.execute({ segmentId: 's2', tracks: [orbitTrack('V3', 210, 60)] }, exec),
      /只做\*\*新增\*\*/,
    )
    await assert.rejects(() => tool.execute({ segmentId: 's2' }, exec), /必须给 `tracks`/)
    await assert.rejects(
      () => tool.execute({ ref: 's2', segmentId: 's2', tracks: [orbitTrack('hi-1', 210, 60)] }, exec),
      /只能给一个/,
    )
    await assert.rejects(() => tool.execute({ tracks: [] }, exec), /必须给 `ref`/)
    assert.equal(readProjectOverrides(projectDir).overrides.length, 0, '拒收之后盘上必须干净')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

test('F6 工具：shotNodeId 走卡上的 segmentRef；没有段指针要明确拒收', async () => {
  const canvas = {
    nodes: [
      { id: 'card1', kind: 'text', title: '第 2 屏', segmentRef: 'spec:s2' },
      { id: 'card2', kind: 'text', title: '没有段指针' },
    ],
  }
  const { projectDir, tool, exec } = fixture({ canvas })
  try {
    const result = await tool.execute({ shotNodeId: 'card1', tracks: [orbitTrack('hi-1', 210, 60)] }, exec)
    assert.equal(result.ref, 'spec:s2')
    await assert.rejects(
      () => tool.execute({ shotNodeId: 'card2', tracks: [orbitTrack('hi-2', 210, 60)] }, exec),
      /没有段指针/,
    )
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

test('F6 工具：写下的 override 会被渲染前合并入口认到（端到端一次）', async () => {
  const { projectDir, tool, exec } = fixture()
  try {
    await tool.execute({ segmentId: 's2', tracks: [orbitTrack('hi-orbit-1', 210, 180)] }, exec)
    const merged = mergeProjectOverrides({ projectDir, manifest: MANIFEST, spec: SPEC })
    assert.deepEqual(merged.applied, [{ ref: 'spec:s2', tracks: 1 }])
    assert.equal(merged.lines.length, 1)
    assert.deepEqual([...merged.trackIds], ['hi-orbit-1'])

    const plan = planSegmentTable({ manifest: merged.manifest, spec: SPEC })
    assert.equal(plan.segments[1].tracks.length, 2, 's2 = 原 1 条 + 手工 1 条')
    assert.equal(plan.segments[0].tracks.length, 1, 's1 不受影响')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})
