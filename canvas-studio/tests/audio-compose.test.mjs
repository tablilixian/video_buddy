/**
 * S2b（2026-10-28 · CV-040 收口）：音频从零装配纯函数测试。
 *
 * 覆盖 src/audio-compose.ts：timelineFromComposeClips（片段前缀和 / 多句旁白堆叠
 * 与显式起点 / BGM 音量与淡变 / bgmNodeId 指向旁白的角色识别）、buildAudioTrackArgs、
 * buildMuxArgs、bgmAutopadDecision（D-02）。
 *
 * 单镜整出的「逐字符不变」判据与装配路径端到端判据分别在
 * tests/compose.test.mjs（CV-141 等）与 tests/compose-audio-pad.test.mjs。
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  timelineFromComposeClips,
  buildAudioTrackArgs,
  buildMuxArgs,
  bgmAutopadDecision,
  bgmFadeSecondsOf,
  BGM_SHORTFALL_TOLERANCE_SEC,
} from '../lib/audio-compose.js'
import { compositionFromTimeline } from '../lib/audio-timeline.js'

const CLIPS = [
  { id: 'a', inputPath: '/x/a.mp4', hasAudio: true, realDurationSec: 2 },
  { id: 'b', inputPath: '/x/b.mp4', hasAudio: false, realDurationSec: 2 },
  { id: 'c', inputPath: '/x/c.mp4', hasAudio: true, realDurationSec: 2 },
]

// ---------------------------------------------------------------------------
// 1. timelineFromComposeClips
// ---------------------------------------------------------------------------
test('timelineFromComposeClips：native 段按真实时长前缀和落位，无声段不产生段并回显', () => {
  const { timeline, notices } = timelineFromComposeClips({ clips: CLIPS, filmDurationSec: 6, fps: 25 })
  const native = timeline.segments.filter((s) => s.role === 'native')
  assert.deepEqual(native.map((s) => s.startSec), [0, 4], '第 2 段无音轨 → 第 3 段原生声从 4s 起（前缀和）')
  assert.deepEqual(native.map((s) => s.durationSec), [2, 2])
  assert.equal(compositionFromTimeline(timeline), 'native')
  assert.ok(notices.some((n) => n.includes('b 无原生音轨')), `无声段应回显，实得 ${JSON.stringify(notices)}`)
})

test('timelineFromComposeClips：BGM 铺底 0.35（有原生声）/ 单轨 0.8（无原生声），淡变按 CV-209 口径', () => {
  const withNative = timelineFromComposeClips({ clips: CLIPS, bgm: { url: 'b.mp3', inputPath: '/x/b.mp3', role: 'bgm', realDurationSec: 30 }, filmDurationSec: 6, fps: 25 })
  const bgm1 = withNative.timeline.segments.find((s) => s.role === 'bgm')
  assert.equal(bgm1.gain, 0.35, '有原生声 → BGM 铺底')
  assert.equal(bgm1.startSec, 0)
  assert.equal(bgm1.fadeInSec, 1, '头留白假设 0 → 淡入 1s')
  assert.equal(bgm1.fadeOutSec, undefined, 'BGM 30s ≫ 成片 6s → 尾留白启发式（0.8×24s 封顶 4s ≥2）信任自带衰减，不强加淡出（CV-209 口径）')
  const noNative = timelineFromComposeClips({
    clips: CLIPS.map((c) => ({ ...c, hasAudio: false })),
    bgm: { url: 'b.mp3', inputPath: '/x/b.mp3', role: 'bgm', realDurationSec: 2 },
    filmDurationSec: 6,
    fps: 25,
  })
  const bgm2 = noNative.timeline.segments.find((s) => s.role === 'bgm')
  assert.equal(bgm2.gain, 0.8, '无原生声 → BGM 单轨口径')
  assert.equal(compositionFromTimeline(noNative.timeline), 'bgm')
})

test('timelineFromComposeClips：bgmNodeId 指向旁白时 role=voiceOver（满音量、无淡变）', () => {
  const { timeline } = timelineFromComposeClips({ clips: CLIPS, bgm: { url: 'v.mp3', inputPath: '/x/v.mp3', role: 'voiceOver', realDurationSec: 3 }, filmDurationSec: 6, fps: 25 })
  const vo = timeline.segments.find((s) => s.role === 'voiceOver')
  assert.equal(vo.gain, 1, '旁白满音量')
  assert.equal(vo.fadeInSec, undefined, '旁白不淡变')
  assert.equal(compositionFromTimeline(timeline), 'native+voiceOver', '旁白不再冒充 BGM（D6 口径延续）')
})

test('timelineFromComposeClips：多句旁白字符串顺序堆叠（零间隙），对象显式起点', () => {
  const stacked = timelineFromComposeClips({
    clips: CLIPS,
    voiceOvers: [
      { nodeId: 'v1', url: 'v1.mp3', inputPath: '/x/v1.mp3', realDurationSec: 0.4 },
      { nodeId: 'v2', url: 'v2.mp3', inputPath: '/x/v2.mp3', realDurationSec: 0.6 },
    ],
    filmDurationSec: 6,
    fps: 25,
  })
  const vos = stacked.timeline.segments.filter((s) => s.role === 'voiceOver')
  assert.deepEqual(vos.map((s) => s.startSec), [0, 0.4], '字符串形式顺序堆叠：0 → 0.4')
  const explicit = timelineFromComposeClips({
    clips: CLIPS,
    voiceOvers: [
      { nodeId: 'v1', url: 'v1.mp3', inputPath: '/x/v1.mp3', realDurationSec: 0.4, startSec: 1 },
      { nodeId: 'v2', url: 'v2.mp3', inputPath: '/x/v2.mp3', realDurationSec: 0.6, startSec: 4 },
    ],
    filmDurationSec: 6,
    fps: 25,
  })
  const vos2 = explicit.timeline.segments.filter((s) => s.role === 'voiceOver')
  assert.deepEqual(vos2.map((s) => s.startSec), [1, 4], '对象形式显式起点（与 render 的 startFrame 语义对齐）')
})

test('timelineFromComposeClips：时长未探到不伪造（0 → 段无 durationSec + notice）', () => {
  const { timeline, notices } = timelineFromComposeClips({
    clips: [{ id: 'a', inputPath: '/x/a.mp4', hasAudio: true }],
    voiceOvers: [{ nodeId: 'v1', url: 'v.mp3', inputPath: '/x/v.mp3' }],
    filmDurationSec: 6,
    fps: 25,
  })
  const native = timeline.segments.find((s) => s.role === 'native')
  assert.equal(native.durationSec, undefined, '未探到时长 → 不写 durationSec（装配用素材全长）')
  assert.equal(timeline.segments[0].startSec, 0)
  assert.ok(notices.some((n) => n.includes('未探到真实时长')), `应回显探测失败，实得 ${JSON.stringify(notices)}`)
})

test('timelineFromComposeClips：summary 是 describeTimeline 产物（模型自查通道）', () => {
  const { summary } = timelineFromComposeClips({ clips: CLIPS, filmDurationSec: 6, fps: 25 })
  assert.ok(summary.includes('音频时间轴'), `应含中文摘要，实得 ${summary}`)
  assert.ok(summary.includes('原生环境声'))
})

// ---------------------------------------------------------------------------
// 2. 装配/合流参数
// ---------------------------------------------------------------------------
test('buildAudioTrackArgs：-i × N + filter_complex + aac 48k 立体声 + 钉片长', () => {
  const args = buildAudioTrackArgs(['/x/a.mp4', '/x/c.mp4'], 'ANULLSRC[out]', '/t/a.m4a', 6.02)
  assert.deepEqual(args.filter((a) => a === '-i'), ['-i', '-i'])
  assert.deepEqual(args.slice(0, 4), ['-i', '/x/a.mp4', '-i', '/x/c.mp4'])
  const fcIndex = args.indexOf('-filter_complex')
  assert.equal(args[fcIndex + 1], 'ANULLSRC[out]')
  assert.ok(args.includes('aac') && args.includes('48000') && args.includes('2'), '交付口径 48k 立体声')
  const tIndex = args.indexOf('-t')
  assert.equal(args[tIndex + 1], '6.020')
  assert.equal(args[args.length - 1], '/t/a.m4a')
})

test('buildMuxArgs：母版视频流 + 装配音轨 -c:v copy 合流（音频替换母版音轨）', () => {
  const args = buildMuxArgs('/t/master.mp4', '/t/a.m4a', '/x/export.mp4', 6.02)
  assert.deepEqual(args.slice(0, 4), ['-i', '/t/master.mp4', '-i', '/t/a.m4a'])
  assert.deepEqual(args.filter((a) => a === '-map'), ['-map', '-map'])
  assert.ok(args.includes('0:v') && args.includes('1:a'), '视频取母版、音频取装配轨')
  assert.ok(args.includes('copy'), '视频零重编码')
  const tIndex = args.indexOf('-t')
  assert.equal(args[tIndex + 1], '6.020')
})

// ---------------------------------------------------------------------------
// 3. D-02：短 BGM 自动补静音决策
// ---------------------------------------------------------------------------
test('bgmAutopadDecision：默认补静音并告知；AUTOPAD=0 回退旧报错；等长/未知不触发', () => {
  const pad = bgmAutopadDecision(3.7, 6.02, true)
  assert.equal(pad.action, 'pad')
  assert.ok(pad.message.includes('已自动补静音'), `应告知补静音，实得 ${pad.message}`)
  assert.ok(pad.message.includes('CANVAS_STUDIO_AUDIO_AUTOPAD=0'), '告知回退开关')
  const err = bgmAutopadDecision(3.7, 6.02, false)
  assert.equal(err.action, 'error')
  assert.ok(err.message.includes('BGM 比成片短'), '回退模式沿用旧守卫文案')
  assert.equal(bgmAutopadDecision(6.02, 6.02, true).action, 'ok')
  assert.equal(bgmAutopadDecision(20, 6.02, true).action, 'ok', 'BGM 更长不触发')
  assert.equal(bgmAutopadDecision(0, 6.02, true).action, 'ok', '时长未知不触发（不把探测失败当短缺）')
  // 容差内（≤0.05s）视为等长。
  assert.equal(bgmAutopadDecision(6.02 - BGM_SHORTFALL_TOLERANCE_SEC, 6.02, true).action, 'ok')
})

test('bgmFadeSecondsOf：与 buildBgmFade 同口径的数值版（短 BGM 只淡入 / 留白大跳过淡出）', () => {
  assert.deepEqual(bgmFadeSecondsOf(20, 6), { fadeInSec: 1 }, 'BGM 长出 14s → 尾留白启发式（0.8×14 封顶 4 ≥2）跳过淡出；淡入保留')
  assert.deepEqual(bgmFadeSecondsOf(6.5, 6), { fadeInSec: 1, fadeOutSec: 1 }, 'BGM 略长（尾留白 0.4 <2）→ 头尾淡变')
  assert.deepEqual(bgmFadeSecondsOf(0.5, 6), { fadeInSec: 1 }, 'BGM 短 → 只淡入不淡出（锚 ≤ 淡变周期）')
  assert.deepEqual(bgmFadeSecondsOf(0, 6), {}, '时长未知 → 不淡变')
})
