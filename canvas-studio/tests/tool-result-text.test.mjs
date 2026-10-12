/**
 * `tool-result-text.ts` 守卫 —— 该模块此前**零测试**（见 canvas-studio-architecture-review.md §5.1）。
 *
 * 为什么值得盯（本模块头注自己写了病史）：会话事件里工具结果的真实形状是
 * **`message.content[0].content[0].text`** —— 中间隔着 `tool-result` 那一层。
 * **CV-216 就踩过这个坑：直接遍历 `message.content` 找 `type === 'text'` 永远匹配不到**，
 * 表现为「点选卡片恒显示兜底文案」（不报错、只是文案错）。
 *
 * 所以本文件把「两种形状都要认」钉死，并覆盖三个静默失败面：
 *   ① 形状变了 ⇒ 退化到兜底文案；② 畸形数据 ⇒ 不能抛（会打断整条事件处理链）；
 *   ③ 深度上限 ⇒ 挡住自引用结构（否则递归到栈溢出）。
 *
 * 从 ../lib/*.js 导入 —— 先 build 再跑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { firstText, stripToolErrorPrefix, TOOL_ERROR_TEXT_PREFIX, STORYBOARD_TOUCH_MARKER, storyboardTouchedNote, touchedStoryboard } from '../lib/tool-result-text.js'

/** 真实形状：`tool-result` 包一层，文本在最里层。 */
const wrapped = (text) => [{ type: 'tool-result', content: [{ type: 'text', text }] }]

test('结果文本①：真实形状（tool-result 包裹）必须能取到 —— CV-216 的原始坑', () => {
  assert.equal(firstText(wrapped('命中')), '命中')
})

test('结果文本②：扁平形状（上游直接给 text 块）同样要认', () => {
  assert.equal(firstText([{ type: 'text', text: 'flat' }]), 'flat')
})

test('结果文本③：跳过空 text 与非 text 块，取第一段非空', () => {
  // 第一块是空 text、第二块非文本 ⇒ 必须继续往后找第三块
  assert.equal(
    firstText([
      { type: 'tool-result', content: [{ type: 'text', text: '' }] },
      { type: 'image', data: 'x' },
      { type: 'tool-result', content: [{ type: 'text', text: '第二段' }] },
    ]),
    '第二段',
  )
  // 全是空/非文本 ⇒ null（调用方据此回落兜底文案）
  assert.equal(firstText([{ type: 'tool-result', content: [{ type: 'text', text: '' }] }]), null)
  // 注：`content` 逐层是「对象 → content 数组」。块元素本身若是一个数组，不会被下钻
  // （数组没有 `.content`）——真实事件形状不会出现数组套数组，故不额外断言该细节。
})

test('结果文本④：非数组 / null / 原始值 ⇒ null（不抛）', () => {
  for (const input of [null, undefined, 'text', 42, {}, [null], [42], ['str']]) {
    assert.equal(firstText(input), null, `输入 ${JSON.stringify(input)} 应返回 null 而不是抛错`)
  }
})

test('结果文本⑤：深度上限挡住自引用/超深畸形结构（不递归到栈溢出）', () => {
  // 构造 8 层嵌套（真实形状只有 2 层；MAX_DEPTH = 4）
  let deep = [{ type: 'text', text: '太深了' }]
  for (let i = 0; i < 8; i += 1) deep = [{ type: 'tool-result', content: deep }]
  assert.equal(firstText(deep), null, '超出深度上限必须放弃（返回 null）而不是继续往下钻')

  // 自引用结构：必须立即返回，不挂死
  const cyclic = [{ type: 'tool-result' }]
  cyclic[0].content = cyclic
  assert.equal(firstText(cyclic), null, '自引用结构必须被深度上限拦住')
})

test('结果文本⑥：stripToolErrorPrefix 只剥框架前缀，且大小写敏感', () => {
  assert.equal(TOOL_ERROR_TEXT_PREFIX, 'Error: ')
  assert.equal(stripToolErrorPrefix('Error: 后端超时'), '后端超时')
  assert.equal(stripToolErrorPrefix('正常文本'), '正常文本', '不带前缀时逐字节原样返回')
  assert.equal(stripToolErrorPrefix('Error: '), '', '只有前缀 ⇒ 空串')
  assert.equal(stripToolErrorPrefix('error: 小写不剥'), 'error: 小写不剥', '前缀匹配区分大小写')
  assert.equal(
    stripToolErrorPrefix('正文里提到 Error: 但不在开头'),
    '正文里提到 Error: 但不在开头',
    '只剥开头的，不剥正文里的',
  )
})

// ────────────────────────────── CV-308：故事板回写标记 ──────────────────────────────

test('CV-308 标记①：写法与读法往返 —— Host 生成的附注必须被客户端认出', () => {
  // 这一条是「一条规则一份实现」的往返钉：Host 侧 `storyboardTouchedNote()` 写出来的
  // 东西，客户端侧 `touchedStoryboard()` 必须认；反之（普通附注）必须不认。
  const note = storyboardTouchedNote('基调样张已挂到 §02 视觉规范（lookRef → n1）。')
  assert.equal(note.startsWith(STORYBOARD_TOUCH_MARKER), true)
  // Host 的 renderResult 把附注拼在 `；注意: ` 之后 —— 生产形状下的往返
  const production = wrapped(`已生成产物: /a.png (1280x736)；注意: ${note}；画布节点 id: n1`)
  assert.equal(touchedStoryboard(production), true, 'Host 写的附注必须被读出来')
  assert.equal(
    touchedStoryboard(wrapped('已生成产物: /a.png (1280x736)；注意: 未找到故事板目标「S9-Sh9」。')),
    false,
    '没写成的附注不许被认出来',
  )
})

test('CV-308 标记②：真实结果文本里命中（标记在「；注意: 」之后 ⇒ 必须 includes 而非 startsWith）', () => {
  // Host 的 renderResult 把回写附注拼在 `；注意: ` 后面，所以标记**不在**文本开头。
  const text = '已生成产物: http://127.0.0.1:8899/canvas-studio/assets/p1/a.png (1280x736)'
    + `；注意: ${STORYBOARD_TOUCH_MARKER}基调样张已自动挂到 §02 视觉规范（lookRef → n1）。`
    + '；画布节点 id: n1'
  assert.equal(touchedStoryboard(wrapped(text)), true)
})

test('CV-308 标记③：没写故事板的普通结果 / 畸形输入 ⇒ 不命中（不抛）', () => {
  assert.equal(touchedStoryboard(wrapped('已生成产物: /a.png (1280x736)')), false, '普通结果不该触发重载')
  assert.equal(
    touchedStoryboard(wrapped(`注意: 未找到故事板目标「S9-Sh9」，效果图只落在画布节点 n2 上。`)),
    false,
    '「没写成」的附注不带标记，不许触发重载',
  )
  for (const input of [null, undefined, 'text', 42, {}, [null], [42], ['str']]) {
    assert.equal(touchedStoryboard(input), false, `输入 ${JSON.stringify(input)} 应返回 false 而不是抛错`)
  }
})

test('CV-308 标记④：标记在更靠后的文本块里也要命中（不能只看第一段）', () => {
  // firstText 只取第一段；touchedStoryboard 必须扫全部文本块，否则「先有一段说明、
  // 再是产物结果」的形状会漏判。
  const blocks = [
    { type: 'tool-result', content: [{ type: 'text', text: '前置说明' }] },
    { type: 'tool-result', content: [{ type: 'text', text: `产物已落盘；注意: ${STORYBOARD_TOUCH_MARKER}效果图已挂到分镜 S1-Sh1（refImage → n3）。` }] },
  ]
  assert.equal(touchedStoryboard(blocks), true)
})
