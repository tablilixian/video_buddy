/**
 * REQ-034（Remotion 集成）· B1 契约层单测：CompositionManifest 校验与派生。
 * 直连 Host tsc 编译产物 lib/remotion/manifest.js（零 Remotion 依赖）。
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  collectManifestSourceIds,
  deriveAudioComposition,
  isAllowedManifestAssetRef,
  validateManifest,
} from '../lib/remotion/manifest.js'

/** 一份合法基线（素材轨 id = 画布节点 id；img 与 video 首尾重叠 12 帧）。 */
function baseManifest() {
  return {
    id: 'comp-1',
    meta: { title: '睡眠的科学', width: 1280, height: 720, fps: 30, durationInFrames: 300 },
    tracks: [
      { id: 'node-img', type: 'image', src: '/canvas-studio/assets/p1/brain.png', startFrame: 0, durationInFrames: 150, fit: 'kenburns' },
      { id: 'node-vid', type: 'video', src: '/canvas-studio/assets/p1/clip.mp4', startFrame: 138, durationInFrames: 162 },
      { id: 'tr0', type: 'transition', effect: 'fade', fromTrackId: 'node-img', toTrackId: 'node-vid', startFrame: 138, durationInFrames: 12 },
    ],
    audio: { bgmUrl: '/canvas-studio/assets/p1/bgm.mp3' },
  }
}

test('合法 manifest 通过且无警告', () => {
  const result = validateManifest(baseManifest())
  assert.equal(result.ok, true, result.errors.join('；'))
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.warnings, [])
})

test('非对象 / 缺 meta 直接拒绝', () => {
  assert.equal(validateManifest('nope').ok, false)
  assert.equal(validateManifest(null).ok, false)
  const noMeta = validateManifest({ id: 'x', tracks: [] })
  assert.equal(noMeta.ok, false)
  assert.ok(noMeta.errors.some((e) => e.includes('meta')))
})

test('meta 数值必须为正数（含 durationInFrames 正整数）', () => {
  const m = baseManifest()
  m.meta.width = 0
  m.meta.fps = Number.NaN
  m.meta.durationInFrames = 299.5
  const result = validateManifest(m)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((e) => e.includes('meta.width')))
  assert.ok(result.errors.some((e) => e.includes('meta.fps')))
  assert.ok(result.errors.some((e) => e.includes('meta.durationInFrames')))
})

test('坏 src（外链）被拒，本地绝对路径放行', () => {
  const bad = baseManifest()
  bad.tracks[0].src = 'https://evil.example/a.png'
  const result = validateManifest(bad)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((e) => e.includes('.src')))

  const local = baseManifest()
  local.tracks[0].src = '/abs/local/brain.png'
  assert.equal(validateManifest(local).ok, true)
})

test('isAllowedManifestAssetRef：同源 / 本地放行，外链与协议相对拒绝', () => {
  assert.equal(isAllowedManifestAssetRef('/canvas-studio/assets/p/a.png'), true)
  assert.equal(isAllowedManifestAssetRef('/tmp/local.png'), true)
  assert.equal(isAllowedManifestAssetRef('https://evil/a.png'), false)
  assert.equal(isAllowedManifestAssetRef('//evil/a.png'), false)
  assert.equal(isAllowedManifestAssetRef('relative/a.png'), false)
})

test('悬空 transition（引用不存在轨道）被拒', () => {
  const m = baseManifest()
  m.tracks[2].fromTrackId = 'ghost'
  const result = validateManifest(m)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((e) => e.includes('不存在的轨道')))
})

test('transition from / to 相同被拒', () => {
  const m = baseManifest()
  m.tracks[2].toTrackId = 'node-img'
  const result = validateManifest(m)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((e) => e.includes('不能相同')))
})

test('transition 两轨首尾相接（无重叠）→ warning（退化为硬切）', () => {
  const m = baseManifest()
  m.tracks[0].durationInFrames = 138 // img 0..138，vid 138..300，恰好相接
  const result = validateManifest(m)
  assert.equal(result.ok, true, result.errors.join('；'))
  assert.ok(result.warnings.some((w) => w.includes('硬切')))
})

test('transition 两轨完全不相交 → error', () => {
  const m = baseManifest()
  m.tracks[0].durationInFrames = 100 // img 0..100，vid 138..300，缺空
  const result = validateManifest(m)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((e) => e.includes('完全不相交')))
})

test('总时长偏差 > 1 帧 → warning', () => {
  const m = baseManifest()
  m.meta.durationInFrames = 900
  const result = validateManifest(m)
  assert.equal(result.ok, true, result.errors.join('；'))
  assert.ok(result.warnings.some((w) => w.includes('偏差')))
})

test('轨道超出 meta 总时长 → warning（不静默吞）', () => {
  const m = baseManifest()
  m.meta.durationInFrames = 100
  const result = validateManifest(m)
  assert.ok(result.warnings.some((w) => w.includes('超出总时长')))
})

test('轨道 id 重复 → error', () => {
  const m = baseManifest()
  m.tracks[1].id = 'node-img'
  const result = validateManifest(m)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((e) => e.includes('重复')))
})

test('textCard variant 非法 / shape 缺色 → error', () => {
  const m = baseManifest()
  m.tracks.push({ id: 't-card', type: 'textCard', variant: 'bogus', text: 'x', startFrame: 0, durationInFrames: 30 })
  m.tracks.push({ id: 't-shape', type: 'shape', shape: 'rect', startFrame: 0, durationInFrames: 30 })
  const result = validateManifest(m)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((e) => e.includes('.variant')))
  assert.ok(result.errors.some((e) => e.includes('.color')))
})

test('audio.bgmUrl 外链 / audio.mix 越界 → error', () => {
  const m = baseManifest()
  m.audio = { bgmUrl: 'http://cdn/bgm.mp3', mix: { bgmVolume: 1.5 } }
  const result = validateManifest(m)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((e) => e.includes('audio.bgmUrl')))
  assert.ok(result.errors.some((e) => e.includes('audio.mix.bgmVolume')))
})

test('deriveAudioComposition 八分支（CV-334 / D6 正交展开）', () => {
  const withVideo = (audio) => ({ id: 'c', meta: {}, tracks: [{ id: 'n', type: 'video', src: '/x' }], audio })
  const noVideo = (audio) => ({ id: 'c', meta: {}, tracks: [{ id: 'n', type: 'textCard' }], audio })
  const bgm = { bgmUrl: '/b.mp3' }
  const vo = { voiceOverUrl: '/v.mp3' }
  const both = { bgmUrl: '/b.mp3', voiceOverUrl: '/v.mp3' }

  // 有原生声（存在 video 轨）→ native 系
  assert.equal(deriveAudioComposition(withVideo(undefined)), 'native')
  assert.equal(deriveAudioComposition(withVideo(bgm)), 'native+bgm')
  assert.equal(deriveAudioComposition(withVideo(vo)), 'native+voiceOver')
  assert.equal(deriveAudioComposition(withVideo(both)), 'native+bgm+voiceOver')

  // 无原生声 → 纯音轨系。D6 之前 `voiceOver` 被并入 `bgm` 位（角标把"只有旁白"显示成
  // 「纯 BGM」，用户看不出这里有旁白）；现按「原生声 / BGM / 旁白」三布尔正交展开。
  // 无旁白的三个值（none / bgm / native+bgm 一组）语义与旧 4 值完全一致。
  assert.equal(deriveAudioComposition(noVideo(undefined)), 'none')
  assert.equal(deriveAudioComposition(noVideo(bgm)), 'bgm')
  assert.equal(deriveAudioComposition(noVideo(vo)), 'voiceOver')
  assert.equal(deriveAudioComposition(noVideo(both)), 'bgm+voiceOver')
})

test('collectManifestSourceIds：只收 video/image 轨且按序去重', () => {
  const manifest = {
    id: 'c',
    meta: {},
    tracks: [
      { id: 'node-a', type: 'image', src: '/x' },
      { id: 'node-b', type: 'video', src: '/y' },
      { id: 'local-card', type: 'textCard' },
      { id: 'tr0', type: 'transition' },
      { id: 'node-a', type: 'video', src: '/z' },
    ],
  }
  assert.deepEqual(collectManifestSourceIds(manifest), ['node-a', 'node-b'])
})
