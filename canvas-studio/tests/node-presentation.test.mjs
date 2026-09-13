/**
 * C10 · 节点「镜头条」的文字与几何契约测试。
 *
 * 这一批把卡片从「一个框里有张图」改成三段：头（类型 + 标题）/ 体（画面或正文）
 * / 脚（读数）。三段各自有一个**纯函数**作为唯一口径，所以口径钉在单测上，
 * 不靠肉眼回归：
 *
 * 1. **几何** —— 节点框 = 画面 + chrome。`previewSizeOf` 与 `frameSizeOf` 是一个
 *    常量的两个方向，混用其中之一都会让画面被头/脚挤掉（或凭空多出 48px）。
 * 2. **标题去重** —— 类型已由头部标签承载，标题里那一段必须摘掉。漏掉这一条，
 *    卡片会写成「关键帧 分镜 3 · 关键帧」。
 * 3. **脚部读数只报一个来源** —— 有实测时长就不报声明时长（同一张卡上两个
 *    来源不同的秒数，读者无法判断该信哪个）。
 * 4. **类型标签与阶段轨道对齐** —— 剧本卡靠 `toolName` 判（它的 operationType
 *    是 import），定妆段要细分成角色 / 场景（否则用户认不出这是角色表还是场景图）。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  previewSizeOf,
  frameSizeOf,
  mediaBoxOf,
  DEFAULT_NODE_SIZE,
  DEFAULT_MEDIA_BOX,
  NODE_CHROME_HEIGHT,
  NODE_HEAD_HEIGHT,
  NODE_FOOT_HEIGHT,
  MEDIA_LONG_SIDE,
  SQUARE_SIDE,
} from '../lib/canvas-aspect.js'
import { headTitleOf, declaredReadingsOf, READING_ORDER } from '../lib/node-presentation.js'
import { productLabelOf } from '../lib/workflow-stage.js'

function node(id, extra = {}) {
  return {
    id,
    kind: 'image',
    x: 0,
    y: 0,
    width: 260,
    height: 180,
    createdAt: 0,
    origin: 'agent',
    sourceIds: [],
    ...extra,
  }
}

// ---------------------------------------------------------------------------
// 1. 几何：节点框 = 画面 + chrome
// ---------------------------------------------------------------------------

test('chrome 高度 = 头 + 脚，且是一个显式常量（不是两处各写一遍）', () => {
  assert.equal(NODE_CHROME_HEIGHT, NODE_HEAD_HEIGHT + NODE_FOOT_HEIGHT)
  assert.equal(NODE_CHROME_HEIGHT, 48, '头 26 + 脚 22 —— 改这两个数必须同步 styles.ts 的插值与预览骨架')
})

test('frameSizeOf = 画面尺寸 + chrome；宽度不动', () => {
  const box = frameSizeOf({ width: 1920, height: 1080 })
  const media = previewSizeOf({ width: 1920, height: 1080 })
  assert.equal(box.width, media.width, '画面宽就是节点框宽（chrome 不占横向）')
  assert.equal(box.height, media.height + NODE_CHROME_HEIGHT, '节点框高 = 画面高 + chrome')
  assert.equal(box.width, MEDIA_LONG_SIDE)
  assert.equal(box.height, 270 + NODE_CHROME_HEIGHT)
})

test('mediaBoxOf 是 frameSizeOf 的逆运算（自然尺寸校正靠它判比例）', () => {
  for (const media of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }, { width: 1000, height: 1000 }]) {
    const box = frameSizeOf(media)
    const back = mediaBoxOf(box)
    assert.equal(back.width, box.width)
    assert.equal(back.height, box.height - NODE_CHROME_HEIGHT)
    // 逆算出的画面比例必须回到原比例（1:1 有 420 特判，所以只比非 1:1 的宽容差）
    const original = media.width / media.height
    const derived = back.width / back.height
    assert.ok(
      Math.abs(derived - original) / original < 0.06,
      `${media.width}×${media.height} 逆算比例漂了：${derived.toFixed(3)} vs ${original.toFixed(3)}`,
    )
  }
})

test('mediaBoxOf 对矮节点不产生 0 或负数（除零会让比例变 Infinity）', () => {
  assert.ok(mediaBoxOf({ width: 260, height: 0 }).height >= 1)
  assert.ok(mediaBoxOf({ width: 260, height: 10 }).height >= 1)
})

test('DEFAULT_NODE_SIZE 描述的是节点框：画面仍是 260×180', () => {
  assert.deepEqual(DEFAULT_MEDIA_BOX, { width: 260, height: 180 })
  assert.equal(DEFAULT_NODE_SIZE.width, 260)
  assert.equal(DEFAULT_NODE_SIZE.height, 180 + NODE_CHROME_HEIGHT)
  assert.notEqual(SQUARE_SIDE, DEFAULT_NODE_SIZE.width, '两个常量别混用（一个是画面、一个是框）')
  // 占位尺寸**不能**走 frameSizeOf —— 那条路会把长边拉到 480，占位卡放大近一倍，
  // 自动布局的 300/240 步进立刻重叠。
  assert.notDeepEqual(DEFAULT_NODE_SIZE, frameSizeOf(DEFAULT_MEDIA_BOX), '占位尺寸不走「已知识别率」的校正规则')
})

// ---------------------------------------------------------------------------
// 2. 头部标题：类型由标签承载，标题里那一段要摘掉
// ---------------------------------------------------------------------------

test('headTitleOf：尾段的类型整段删掉（「分镜 3 · 关键帧」→「分镜 3」）', () => {
  assert.equal(headTitleOf(node('a', { title: '分镜 3 · 关键帧' }), '关键帧'), '分镜 3')
})

test('headTitleOf：首段的类型只摘前缀，编号必须留下（「分镜 3 · 中近景」→「3 · 中近景」）', () => {
  assert.equal(headTitleOf(node('a', { title: '分镜 3 · 中近景' }), '分镜'), '3 · 中近景')
})

test('headTitleOf：标题就是类型本身时返回空串（否则头部会写成「BGM BGM」）', () => {
  assert.equal(headTitleOf(node('a', { title: 'BGM' }), 'BGM'), '')
  assert.equal(headTitleOf(node('a', { title: '  剧本  ' }), '剧本'), '')
  assert.equal(headTitleOf(node('a', {}), '参考'), '')
})

test('headTitleOf：类型与名字是两段时只留下名字（「角色 · 林晚」→「林晚」）', () => {
  assert.equal(headTitleOf(node('a', { title: '角色 · 林晚' }), '角色'), '林晚')
  assert.equal(headTitleOf(node('a', { title: '成片 · 凌晨三点的门外人' }), '成片'), '凌晨三点的门外人')
})

test('headTitleOf 不改数据：node.title 原样保留（纯显示层派生）', () => {
  const target = node('a', { title: '分镜 3 · 关键帧' })
  headTitleOf(target, '关键帧')
  assert.equal(target.title, '分镜 3 · 关键帧')
})

// ---------------------------------------------------------------------------
// 3. 脚部读数：只报一个来源
// ---------------------------------------------------------------------------

test('declaredReadingsOf：还没有产物时显示声明时长', () => {
  const readings = declaredReadingsOf(node('a', { kind: 'text', declaredDuration: 3.2, text: '画面：他在门口' }))
  assert.deepEqual(readings.map(r => r.key), ['declared-duration', 'chars'])
  assert.equal(readings[0].text, '3.2s')
})

test('declaredReadingsOf：有真实产物（url）时不再报声明时长 —— 两个来源的秒数会打架', () => {
  const readings = declaredReadingsOf(node('a', { kind: 'video', url: '/x.mp4', declaredDuration: 3.2, duration: 3.24 }))
  assert.deepEqual(readings, [], '实测时长由媒体元素报，声明时长必须让位')
})

test('declaredReadingsOf：字数按非空白字符算（剧本正文的缩进不该算进「字」）', () => {
  const readings = declaredReadingsOf(node('a', { kind: 'text', text: '  三 个 字\n\n' }))
  assert.equal(readings.find(r => r.key === 'chars')?.text, '3 字')
  assert.deepEqual(declaredReadingsOf(node('a', { kind: 'text', text: '   \n  ' })), [], '空白正文不报 0 字')
})

test('READING_ORDER 覆盖实际会渲染的每一类读数（漏一类就没顺序契约）', () => {
  assert.deepEqual([...READING_ORDER], ['audio-mix', 'duration', 'dims', 'declared-duration', 'chars'])
})

// ---------------------------------------------------------------------------
// 4. 类型标签：与阶段轨道对齐，且比六段更细
// ---------------------------------------------------------------------------

test('productLabelOf：剧本卡靠 toolName 判（它的 operationType 是 import）', () => {
  assert.equal(productLabelOf(node('a', { kind: 'text', toolName: 'user_brief', operationType: 'import' })), '剧本')
  // 同样是 import，但没有 toolName 的是普通素材，不能算剧本
  assert.equal(productLabelOf(node('a', { kind: 'image', operationType: 'import' })), '导入')
})

test('productLabelOf：成片压过一切', () => {
  assert.equal(productLabelOf(node('a', { kind: 'video', toolName: 'compose', operationType: 'video-clip' })), '成片')
})

test('productLabelOf：定妆段细分成角色 / 场景（阶段名「定妆」认不出是哪种）', () => {
  assert.equal(productLabelOf(node('a', { operationType: 'character-sheet' })), '角色')
  assert.equal(productLabelOf(node('a', { operationType: 'scene-concept' })), '场景')
})

test('productLabelOf：镜头段的三种产物各归各名', () => {
  assert.equal(productLabelOf(node('a', { kind: 'video', operationType: 'video-clip' })), '片段')
  assert.equal(productLabelOf(node('a', { kind: 'audio', operationType: 'text-to-audio' })), 'BGM')
  // 没有 operationType 的视频仍是片段（端点会随供应商换，逐个列举会漏）
  assert.equal(productLabelOf(node('a', { kind: 'video' })), '片段')
})

test('productLabelOf：关键帧走阶段名兜底，参考/便签/文本各归各名', () => {
  assert.equal(productLabelOf(node('a', { operationType: 'text-to-image' })), '关键帧')
  assert.equal(productLabelOf(node('a', { isReference: true, operationType: 'import' })), '参考')
  assert.equal(productLabelOf(node('a', { kind: 'sticky' })), '便签')
  assert.equal(productLabelOf(node('a', { kind: 'prompt' })), '提示')
  assert.equal(productLabelOf(node('a', { kind: 'group' })), '分组')
})
