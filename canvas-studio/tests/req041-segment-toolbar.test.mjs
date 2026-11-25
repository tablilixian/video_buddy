/**
 * REQ-041（2026-11-25）· 就近工具条槽位判据（行为断言，不是源码文本闸）。
 *
 * 真机现象：H3 生成的视频卡工具条 = 引用到对话 / 预览 / 下载；同一批渲出来的
 * 分镜卡只剩「引用到对话」一个钮。根因是判据按 `kind`/`url` 分支，而段产物
 * 不是节点产物（text 卡 + url 空）。
 *
 * 反向变异（跑过即红）：
 * - 把 `hasSegment` 判据删掉 ⇒ 用例①②（分镜卡三钮）红；
 * - 把 text 放宽成任意 kind ⇒ 用例③（loading 时不出预览）红；
 * - 去掉 `NODE_ACTION_ORDER` 的过滤排序 ⇒ 顺序用例红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { NODE_ACTION_ORDER, isSegmentReviewMedia, nodeActionSlots } from '../lib/node-action-slots.js'

const CAPS_ALL = {
  retry: true,
  edit: true,
  reference: true,
  library: true,
  previewImage: true,
  playback: true,
  download: true,
}

/** 真实分镜卡形态（超级月亮 2 实测：text + segmentRef + seedStoryboardShot，无 url）。 */
const shotCard = (over = {}) => ({
  id: 'shot-1',
  kind: 'text',
  title: '2 · S1-Sh2 · 中近景，手持轻微摇晃',
  text: '【镜 2】方舟内部的第二层舱室，单薄的天光从高处的方形窗洞漏进来…',
  width: 300,
  height: 200,
  segmentRef: 'spec:s2',
  toolName: 'seedStoryboardShot',
  operationType: 'storyboard',
  ...over,
})

/** H3 视频卡形态（kind=video + 产物 url）。 */
const videoCard = (over = {}) => ({
  id: 'vid-1',
  kind: 'video',
  title: '分镜 2 · 视频',
  url: '/canvas-studio/assets/p/vid-2.mp4',
  width: 864,
  height: 588,
  toolName: 'video_generate',
  ...over,
})

test('① 分镜卡命中段产物 ⇒ 与 H3 视频卡同样的三个按钮、同样的顺序', () => {
  const seg = '/canvas-studio/assets/p/seg-s2-voice.mp4?v=1710000000000'
  assert.deepEqual(nodeActionSlots(shotCard(), seg, CAPS_ALL), ['reference', 'preview', 'download'])
  assert.deepEqual(nodeActionSlots(videoCard(), undefined, CAPS_ALL), ['reference', 'preview', 'download'])
})

test('② 段还没就绪（清单未回 / 空串）⇒ 不回退成「预览一个空 URL」', () => {
  // 分镜卡自身的重试 / 改词判据恒空（seedStoryboardShot 不在 REPLAYABLE_TOOLS、
  // 无 prompt 参数）⇒ 只剩引用，而不是复制一个打不通的预览钮。
  assert.deepEqual(nodeActionSlots(shotCard(), undefined, CAPS_ALL), ['reference'])
  assert.deepEqual(nodeActionSlots(shotCard(), '', CAPS_ALL), ['reference'])
})

test('③ 素材卡加载中 ⇒ 段预览/下载同样收敛（不按 kind 放宽）', () => {
  const seg = '/canvas-studio/assets/p/seg-s2.mp4?v=1'
  assert.deepEqual(nodeActionSlots(shotCard({ isLoading: true }), seg, CAPS_ALL), ['reference'])
  assert.equal(isSegmentReviewMedia(shotCard({ isLoading: true }), seg), false, 'isLoading 时不算「按媒体卡处理」')
})

test('④ 宿主没接播放/下载回调 ⇒ 该钮不出现（既有调用方不必全接）', () => {
  const seg = '/canvas-studio/assets/p/seg-s2.mp4?v=1'
  const caps = { ...CAPS_ALL, playback: false, download: false }
  assert.deepEqual(nodeActionSlots(shotCard(), seg, caps), ['reference'])
  // 只缺 playback：下载仍在（三项里各自独立，不互相牵连）。
  assert.deepEqual(nodeActionSlots(shotCard(), seg, { ...CAPS_ALL, playback: false }), ['reference', 'download'])
})

test('⑤ 其余 text 卡口径不变：引用/重试/改词按既有顺序，段相关钮不出现', () => {
  const promptCard = {
    id: 'txt-1',
    kind: 'text',
    title: '镜头说明',
    generationPrompt: JSON.stringify({ prompt: '一整段镜头说明' }),
    toolName: 'image_generate',
  }
  const slots = nodeActionSlots(promptCard, undefined, CAPS_ALL)
  assert.deepEqual(slots, ['retry', 'edit', 'reference'])
  // 顺序必须来自 NODE_ACTION_ORDER（换顺序 = 跨卡片扫读失去一致性）。
  assert.deepEqual(slots, NODE_ACTION_ORDER.filter(slot => slots.includes(slot)))
})

test('⑥ 分组卡不给「引用」（托盘没有产物）；video 卡不被当成段卡再判一次', () => {
  const group = { id: 'g-1', kind: 'group', title: '镜 2', childIds: [] }
  assert.deepEqual(nodeActionSlots(group, undefined, CAPS_ALL), [])
  assert.equal(isSegmentReviewMedia(videoCard(), '/canvas-studio/assets/p/seg-s2.mp4'), false)
})

test('⑦ image 预览走大图通道：playback 缺失不影响 image 的「预览」', () => {
  const image = { id: 'img-1', kind: 'image', title: '关键帧', url: '/canvas-studio/assets/p/a.png' }
  const caps = { ...CAPS_ALL, playback: false }
  assert.deepEqual(nodeActionSlots(image, undefined, caps), ['reference', 'library', 'preview', 'download'])
})
