/**
 * 故事板强约束 **L4 · 老项目迁移** 的纯函数守卫：`sectionsFromShotCards()`。
 *
 * 为什么不测工具而测这个函数：工具层只是「读画布 → 调用它 → 落盘」，真正会错的是
 * **反推规则**（用哪个字段、缺字段时兜底成什么、会不会把两张卡的 id 撞在一起）。
 * 这些规则一旦猜错，老项目迁移出来的故事板就是错的，而用户看不出是猜的。
 *
 * 三条纪律在这里被钉死：
 *   1. `sbRef` 优先、`title` 只作历史卡兜底，且**兜底必须留 warning**（用户要能核）；
 *   2. 卡面正文的 `【标签】` 解析不猜：没有就是空，不编造；
 *   3. 读不出 scene/shot 号的卡**跳过并计数**，绝不铸一个假 id 假装成功。
 *
 * 运行：node --test tests/storyboard-adopt.test.mjs（需先 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sectionsFromShotCards } from '../lib/storyboard-adopt.js'

function card(overrides = {}) {
  return {
    id: 'n1',
    kind: 'text',
    toolName: 'seedStoryboardShot',
    title: '分镜 1 · S1-Sh1 · 缓慢推进',
    text: [
      '【镜 1】空走廊，尽头一扇门',
      '【运镜】缓慢推进',
      '【声音】滴水声',
      '【旁白】V1',
      '【英文 prompt】a dark corridor, slow push in',
    ].join('\n'),
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    createdAt: 1,
    sbRef: '04:S1/shots/S1-Sh1',
    declaredDuration: 5,
    declaredFrames: 120,
    ...overrides,
  }
}

test('L4 ①：sbRef 优先 —— scene/shot 号从结构化回指针取，不看标题', () => {
  const adopted = sectionsFromShotCards([card({ title: '用户手改过的标题' })])
  assert.equal(adopted.scenes, 1)
  assert.equal(adopted.shots, 1)
  assert.equal(adopted.storyboard.scenes[0].id, 'S1')
  assert.equal(adopted.storyboard.scenes[0].shots[0].id, 'S1-Sh1')
  assert.deepEqual(adopted.warnings, [], '有 sbRef 时不该产 warning')
})

test('L4 ②：卡面正文解析 —— 视觉/运镜/声音/旁白/prompt 各归各位', () => {
  const shot = sectionsFromShotCards([card()]).storyboard.scenes[0].shots[0]
  assert.equal(shot.visual, '空走廊，尽头一扇门')
  assert.equal(shot.camera, '缓慢推进')
  assert.equal(shot.audio, '滴水声')
  assert.equal(shot.narrationRef, 'V1')
  assert.equal(shot.promptEn, 'a dark corridor, slow push in')
  assert.equal(shot.duration, 5)
  assert.equal(shot.frames, 120)
})

test('L4 ③：无 sbRef 的历史卡按标题兜底，且必须留 warning 让人核对', () => {
  const adopted = sectionsFromShotCards([card({ sbRef: undefined })])
  assert.equal(adopted.shots, 1)
  assert.equal(adopted.storyboard.scenes[0].id, 'S1')
  assert.equal(adopted.storyboard.scenes[0].shots[0].id, 'S1-Sh1')
  assert.equal(adopted.warnings.length, 1, '兜底必须留痕')
  assert.match(adopted.warnings[0], /sbRef/u)
})

test('L4 ④：读不出 scene/shot 号的卡跳过并计数 —— 不铸假 id 假装成功', () => {
  const adopted = sectionsFromShotCards([
    card(),
    card({ id: 'n2', sbRef: undefined, title: '一张随手画的卡' }),
  ])
  assert.equal(adopted.shots, 1, '无号的卡不许进分镜')
  assert.ok(adopted.warnings.some((w) => /跳过/u.test(w)), '跳过必须报数')
})

test('L4 ⑤：同 scene 相邻卡合并进一个 scene，跨 scene 另起一段（顺序 = 画布顺序）', () => {
  const adopted = sectionsFromShotCards([
    card({ id: 'n1', sbRef: '04:S1/shots/S1-Sh1' }),
    card({ id: 'n2', sbRef: '04:S1/shots/S1-Sh2' }),
    card({ id: 'n3', sbRef: '04:S2/shots/S2-Sh1' }),
  ])
  assert.equal(adopted.scenes, 2)
  assert.deepEqual(adopted.storyboard.scenes.map((s) => s.id), ['S1', 'S2'])
  assert.equal(adopted.storyboard.scenes[0].shots.length, 2)
  assert.equal(adopted.storyboard.scenes[1].shots.length, 1)
})

test('L4 ⑥：缺时长时兜底 3s/90帧，缺正文时留空 —— 不编内容', () => {
  const adopted = sectionsFromShotCards([
    card({ declaredDuration: undefined, declaredFrames: undefined, text: undefined }),
  ])
  const shot = adopted.storyboard.scenes[0].shots[0]
  assert.equal(shot.duration, 3)
  assert.equal(shot.frames, 90)
  assert.equal(shot.visual, '', '拿不到画面描述就留空，等 write_storyboard 补')
  assert.equal(shot.camera, '缓慢推进', '运镜可以从标题第三段拿到')
})

test('L4 ⑦：画布上没有分镜卡 ⇒ shots 0（调用方据此拒绝，而不是产一份空故事板）', () => {
  const adopted = sectionsFromShotCards([card({ toolName: 'image_generate' })])
  assert.equal(adopted.shots, 0)
  assert.equal(adopted.storyboard.scenes.length, 0)
})
