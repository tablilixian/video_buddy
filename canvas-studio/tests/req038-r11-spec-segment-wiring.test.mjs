/**
 * R11 · O-2 接线：`scaffold_from_spec` 产出的 manifest **必须带段表**（`meta.segments`）。
 *
 * 为什么单独一条：`planFromSpec` 的段表单测覆盖不到「host 组装 meta 时有没有把它带出去」——
 * 漏了这行 spread 不会报错，只会静默回退旧边界（优化没生效但没人知道）。所以这里直接
 * 驱动真实入口 `scaffoldFromSpec`（写临时 spec → 读回 manifest），做行为断言。
 *
 * 反向变异：删掉 host-tools-spec.ts 里 `...(plan.segments.length > 0 ? { segments: plan.segments } : {})`
 * 这一行 ⇒ 本文件第 1 条立刻红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { scaffoldFromSpec } from '../lib/host-tools-spec.js'

const SPEC = {
  meta: { title: '段表接线', durationSec: 20, fps: 30, autoStages: true },
  sections: [
    { id: 's1', card: 'A2', copy: '飞机为什么飞不过 2 万米？' },
    { id: 's2', card: 'A4', copy: '客机巡航约 1 万米' },
    { id: 's3', card: 'A5', copy: '关注我，下期讲急流层' },
  ],
}

function scaffold(spec) {
  const dir = mkdtempSync(join(tmpdir(), 'cs-seg-wiring-'))
  try {
    const specPath = join(dir, 'spec.json')
    writeFileSync(specPath, JSON.stringify(spec))
    const result = scaffoldFromSpec({ specPath, writeTo: 'build/manifest.json', projectDir: dir })
    const manifest = JSON.parse(readFileSync(join(dir, 'build/manifest.json'), 'utf8'))
    return { manifest, text: result.text }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('scaffold_from_spec 写出的 manifest 带段表，且段窗 = 预卷后的真实起点', () => {
  const { manifest } = scaffold(SPEC)
  assert.deepEqual(manifest.meta.segments, [
    { id: 's1', startFrame: 0, frames: 190 },
    { id: 's2', startFrame: 190, frames: 200 },
    { id: 's3', startFrame: 390, frames: 210 },
  ])
  assert.equal(manifest.meta.segments.reduce((sum, seg) => sum + seg.frames, 0), manifest.meta.durationInFrames)
})

test('段表是已知字段：manifest 校验通过且不产生「契约外字段」告警', () => {
  const { text } = scaffold(SPEC)
  assert.match(text, /已通过 validateManifest/)
  assert.doesNotMatch(text, /契约外字段 "segments"/)
})

test('段表起点 = 该段首轨的实际起点（190 而不是 planStages 的 200）', () => {
  const { manifest } = scaffold(SPEC)
  const s2 = manifest.meta.segments.find((segment) => segment.id === 's2')
  const s2TrackStarts = manifest.tracks
    .filter((track) => typeof track.id === 'string' && track.id.startsWith('s2-'))
    .map((track) => (typeof track.startFrame === 'number' ? track.startFrame : 0))
  assert.ok(s2TrackStarts.length > 0, 's2 应该有自己的卡轨')
  assert.equal(Math.min(...s2TrackStarts), s2.startFrame, '段起点必须对齐该段首轨，不能停在等分边界')
  assert.equal(s2.startFrame, 190, '转场预卷 10 帧必须被计入段窗')
})
