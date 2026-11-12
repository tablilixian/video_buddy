/**
 * REQ-038 批次 4 守卫：RQ-08 `audio.sfx[].startFrom`（源内起始帧起播）。
 *
 * 验收口径（需求正本 §3）：可指定源内起始帧起播；老 manifest 不受影响。
 * 三条消费链同批接线：
 * - 契约：ManifestSfx.startFrom + KNOWN_SFX_KEYS + 校验（非负整数）；
 * - CSR：AudioTrack → Remotion `<Audio trimBefore>`（帧口径，与 VideoClip 同源）；
 * - 装配：audio-compose 派生 sourceOffsetSec → buildAudioGraph `atrim=start=N`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { validateManifest } from '../lib/remotion/manifest.js'
import { buildAudioGraph } from '../lib/audio-timeline.js'
import { timelineFromManifestAudio } from '../lib/audio-compose.js'

const here = dirname(fileURLToPath(import.meta.url))

const manifestWithSfx = (sfx) => ({
  id: 'req038-b4-test',
  meta: { title: 'REQ-038 批4', width: 1920, height: 1080, fps: 30, durationInFrames: 300 },
  tracks: [
    { id: 'card', type: 'textCard', variant: 'title', text: 'Impact', box: { x: 50, y: 50, w: 40, h: 20 }, startFrame: 0, durationInFrames: 90 },
  ],
  audio: { sfx },
})

test('RQ-08：startFrom 与成片定位正交（可与 startSec 同给），校验放行', () => {
  const m = validateManifest(manifestWithSfx([{ src: '/canvas-studio/assets/sfx/impact.mp3', startSec: 1.83, startFrom: 55 }]))
  assert.deepEqual(m.errors, [])
  assert.ok(!m.warnings.some((w) => w.includes('"startFrom"')), 'startFrom 已登记 KNOWN_SFX_KEYS')
})

test('RQ-08：startFrom 非法值拒收（负数 / 小数 / 非数字）', () => {
  for (const bad of [-1, 55.5, '55']) {
    const m = validateManifest(manifestWithSfx([{ src: '/canvas-studio/assets/sfx/impact.mp3', startSec: 1, startFrom: bad }]))
    assert.ok(m.errors.some((e) => e.includes('.startFrom 必须是非负整数')), `startFrom=${JSON.stringify(bad)} 应拒收`)
  }
})

test('RQ-08：老 manifest（无 startFrom）校验零告警', () => {
  const m = validateManifest(manifestWithSfx([{ src: '/canvas-studio/assets/sfx/impact.mp3', startSec: 1 }]))
  assert.deepEqual(m.errors, [])
})

test('RQ-08 ★装配链：派生时间轴把 startFrom 帧折算成 sourceOffsetSec（30fps）', () => {
  const timeline = timelineFromManifestAudio(manifestWithSfx([{ src: '/a/impact.mp3', startSec: 1.83, startFrom: 55 }]))
  const sfx = timeline.segments.find((s) => s.role === 'sfx')
  assert.ok(sfx, 'sfx 段必须派生出来')
  assert.equal(sfx.sourceOffsetSec, Math.round((55 / 30) * 1000) / 1000, '55 帧 @30fps ≈ 1.833s')
})

test('RQ-08 ★装配链：buildAudioGraph 消费 sourceOffsetSec 落 atrim=start', () => {
  const graph = buildAudioGraph({
    fps: 30,
    durationSec: 10,
    segments: [{ url: '/a/impact.mp3', startSec: 1.833, sourceOffsetSec: 1.833, role: 'sfx' }],
  })
  assert.match(graph.filterComplex, /atrim=start=1\.833/, '必须先 atrim=start 挪源内起点')
  // 淡入淡出与 adelay 语义不受影响。
  assert.match(graph.filterComplex, /adelay=delays=1833/)
})

test('RQ-08：无 sourceOffsetSec 的段不落 atrim=start（老行为逐样本不变）', () => {
  const graph = buildAudioGraph({
    fps: 30,
    durationSec: 10,
    segments: [{ url: '/a/impact.mp3', startSec: 1.5, role: 'sfx' }],
  })
  assert.ok(!graph.filterComplex.includes('atrim=start='), '老段不许出现源内裁切')
})

test('RQ-08 ★CSR 链：AudioTrack 消费 startFrom 落 trimBefore（帧口径）', () => {
  const src = readFileSync(join(here, '../src/remotion/components/AudioTrack.tsx'), 'utf8')
  assert.ok(src.includes('trimBefore'), 'CSR 侧必须落 Remotion trimBefore')
  assert.ok(src.includes('sfx.startFrom'), '直接消费 sfx.startFrom')
})
