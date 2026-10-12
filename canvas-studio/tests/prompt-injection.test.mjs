/**
 * prompt 注入守卫：两个**零测试**模块的注入文本。
 *
 * ## 为什么这两个模块值得单独盯
 *
 * `prompt-injection.ts` 与 `storyboard-discipline-prompt.ts` 都是「把东西拼进
 * system prompt / 生成提示词」的模块 —— 它们错了**不会抛异常、不会有报错**，
 * 只会让 agent 按一份错的前提干活（§5.1 把这两个列为「零覆盖」时点名的理由）。
 *
 * ### 两条关键不变量
 *
 * 1. **不得出现 `{{variable}}`** —— 两个模块的头注都写明了这条：
 *    `renderPrompt` 对**未知引用会直接抛错**。一旦有人往文案里写了一个花括号变量，
 *    表现是**每次 assemble 抛错**（整块 prompt 挂掉），而不是文案不好看。
 * 2. **前缀顺序 = 导演 → 摄影 → 美术** —— `composeImagePrompt` 的注释把它定为契约
 *    （节奏 → 摄像机 → 风格）。顺序变了不会有测试红，但模型读到的提示词语义会变。
 *
 * 从 ../lib/*.js 导入 —— 先 build 再跑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeImagePrompt } from '../lib/prompt-injection.js'
import { storyboardDisciplineText } from '../lib/storyboard-discipline-prompt.js'
import { emptyStoryboardSections } from '../lib/contracts/storyboard.js'

/** 未落地 / 无故事板 / 三节皆空 —— 都必须不注入（空串）。 */
const noInjectionCases = [
  ['document 为 undefined', undefined],
  ['landed 为 null（尚未落地，草稿随时会变）', { landed: null }],
  ['landed 存在但三节都空', { landed: { at: 1, sourceVersion: 'live', sections: emptyStoryboardSections() } }],
  ['landed 存在但只有空白字符', {
    landed: {
      at: 1,
      sourceVersion: 'live',
      sections: {
        ...emptyStoryboardSections(),
        '00_creative': { brief: '   ' },
        '08_constraints': ['', '  '],
      },
    },
  }],
]

for (const [label, document] of noInjectionCases) {
  test(`注入守卫①：${label} ⇒ 不注入（空串）`, () => {
    assert.equal(storyboardDisciplineText(document), '')
  })
}

test('注入守卫②：已落地的 §00 / §02 / §08 内容必须都出现在注入文本里', () => {
  const text = storyboardDisciplineText({
    landed: {
      at: 1,
      sourceVersion: 'live',
      sections: {
        ...emptyStoryboardSections(),
        '00_creative': { brief: '雨夜霓虹下的独行道别' },
        '02_visual': { tokens: [{ k: '光感', v: '冷调霓虹' }, { k: '镜头', v: '35mm 浅景深' }] },
        '08_constraints': ['不更换服装'],
      },
    },
  })
  for (const expected of ['雨夜霓虹下的独行道别', '光感：冷调霓虹', '镜头：35mm 浅景深', '不更换服装']) {
    assert.ok(text.includes(expected), `注入文本缺少「${expected}」`)
  }
  // 只列「有内容的」小节：本 fixture 没有 §00 之外的其它小节，不该冒出空标题
  assert.ok(!text.includes('undefined'), '注入文本里出现了 undefined（漏判空值）')
})

test('注入守卫③：注入文本不得含 `{{…}}` 变量（renderPrompt 对未知引用会抛错）', () => {
  const text = storyboardDisciplineText({
    landed: {
      at: 1,
      sourceVersion: 'live',
      sections: {
        ...emptyStoryboardSections(),
        '00_creative': { brief: '任意前提' },
        '08_constraints': ['任意约束'],
      },
    },
  })
  assert.ok(!/\{\{/.test(text), '注入文本含 `{{` —— renderPrompt 会在 assemble 时抛错')
})

test('注入守卫④：composeImagePrompt —— 前缀顺序为 节奏 → 摄像机 → 风格，以「，」连接', () => {
  const composed = composeImagePrompt({
    prompt: '主体正文',
    pacingPrefix: '节奏甲',
    cameraPrefix: '摄像机乙',
    stylePrefix: '风格丙',
  })
  assert.equal(composed, '节奏甲，摄像机乙，风格丙，主体正文')
})

test('注入守卫⑤：composeImagePrompt —— 空白前缀跳过，正文原样保留在末尾', () => {
  assert.equal(
    composeImagePrompt({ prompt: '只有正文', pacingPrefix: '   ', cameraPrefix: '', stylePrefix: undefined }),
    '只有正文',
    '空白/未给前缀时不得留下多余的分隔符',
  )
  // 正文里的「，」不能被当成前缀分隔符吃掉（逐字节保留）
  const tricky = '甲，乙；丙'
  assert.equal(composeImagePrompt({ prompt: tricky, stylePrefix: '风格' }), `风格，${tricky}`)
})
