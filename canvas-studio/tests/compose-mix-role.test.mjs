/**
 * REQ-034 · D6：`compose_video` 的混入音源**角色判定**（配乐 vs 旁白）。
 *
 * 缺陷原貌：`compose_video` 只有一个混音入口 `bgmNodeId`，而 `tts_voiceover` 的产物也是
 * 音频节点（工具结果里就是教模型「传 bgmNodeId」）。于是旁白被当成配乐处理：
 *   ① 角标显示「纯 BGM」，用户看不出这里有人在说话；
 *   ② 0.35 的铺底音量把台词压没；
 *   ③ 首尾淡入淡出咬掉字头字尾；
 *   ④ 「BGM 必须不短于成片」的硬守卫把一段正常长度的旁白直接报错。
 *
 * 本文件守的角色判定（`resolveAudioMixRole`）与混音参数（`buildAmixArgs`）都是纯函数，
 * 可在 Node 里直接覆盖。
 *
 * 直连 Host tsc 编译产物 `lib/compose.js`。
 * 定向跑：node --test tests/compose-mix-role.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAmixArgs, resolveAudioMixRole } from '../lib/compose.js'

test('resolveAudioMixRole：tts_voiceover 产物一律判为旁白', () => {
  assert.equal(resolveAudioMixRole({ toolName: 'tts_voiceover', title: '配音 1' }), 'voiceOver')
  // 标题写成什么都不能翻案 —— 来源工具是硬判据。
  assert.equal(resolveAudioMixRole({ toolName: 'tts_voiceover', title: '背景音乐' }), 'voiceOver')
})

test('resolveAudioMixRole：music_generation 产物一律判为配乐', () => {
  assert.equal(resolveAudioMixRole({ toolName: 'music_generation', title: '温暖钢琴' }), 'bgm')
})

test('resolveAudioMixRole：无可靠来源时按标题关键词兜底', () => {
  assert.equal(resolveAudioMixRole({ title: '旁白 · 第一段' }), 'voiceOver')
  assert.equal(resolveAudioMixRole({ title: '女声配音' }), 'voiceOver')
  assert.equal(resolveAudioMixRole({ title: '口播版' }), 'voiceOver')
  assert.equal(resolveAudioMixRole({ title: 'Narration take 2' }), 'voiceOver')
  assert.equal(resolveAudioMixRole({ title: 'Voice-over final' }), 'voiceOver')
  // 认不出来时**宁可当配乐**：多一条淡入淡出，也绝不把配乐灌成满音量。
  assert.equal(resolveAudioMixRole({ title: '音轨 3' }), 'bgm')
  assert.equal(resolveAudioMixRole(undefined), 'bgm')
})

test('buildAmixArgs：配乐缺省口径不变（铺底音量 + 淡入淡出）', () => {
  const args = buildAmixArgs('/tmp/concat.mp4', '/tmp/bgm.mp3', '/tmp/out.mp4', true, 30, 12)
  const filter = args[args.indexOf('-filter_complex') + 1]
  assert.match(filter, /volume=0\.35/, '有原生音轨时配乐仍走 0.35 铺底')
  assert.match(filter, /afade/, '配乐保留淡入淡出（防爆音）')
  assert.match(filter, /amix=inputs=2:duration=first:normalize=0/, '线性求和，不各压一半')
  assert.ok(args.includes('-t'), '输出时长按成片真值裁，而不是 -shortest')
})

test('buildAmixArgs：无原生音轨时配乐走 0.8（不做 amix）', () => {
  const args = buildAmixArgs('/tmp/concat.mp4', '/tmp/bgm.mp3', '/tmp/out.mp4', false, 30, 12)
  const filter = args[args.indexOf('-filter_complex') + 1]
  assert.match(filter, /volume=0\.8/)
  assert.equal(filter.includes('amix'), false)
})

test('buildAmixArgs：旁白走满音量、**不加**淡入淡出', () => {
  const args = buildAmixArgs('/tmp/concat.mp4', '/tmp/vo.mp3', '/tmp/out.mp4', true, 6, 12, undefined, 'voiceOver')
  const filter = args[args.indexOf('-filter_complex') + 1]
  assert.match(filter, /volume=1\b/, '旁白是前景主声，满音量')
  assert.equal(filter.includes('afade'), false, '旁白不许淡入淡出（会咬掉字头字尾）')
  assert.match(filter, /amix=inputs=2/, '旁白仍与原生环境声叠混')
})

test('buildAmixArgs：旁白短于成片时仍按成片时长收尾（不被 -shortest 截画面）', () => {
  const args = buildAmixArgs('/tmp/concat.mp4', '/tmp/vo.mp3', '/tmp/out.mp4', true, 6, 12, undefined, 'voiceOver')
  assert.ok(args.includes('-t'), '用 -t <成片真值> 收尾')
  assert.equal(args.includes('-shortest'), false)
})
