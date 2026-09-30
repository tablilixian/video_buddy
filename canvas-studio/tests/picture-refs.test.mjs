/**
 * REQ-003 Step 3 / F2-F3：`<Picture N>` 与参考位一致性（纯函数直连）。
 *
 * 两条硬要求（方案 §9 表 4/5 的教训）：
 * - rewritePictureNumbers 必须处理 N > k（越界夹到 k 并返回被夹**处数**）；
 * - 只改 `<Picture N>` 标记本身 —— 提示词其余文本逐字节原样（那是用户写的创作内容）。
 *
 * 运行：corepack yarn test:smoke（先 corepack yarn build —— 从 ../lib 导入）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pictureIssues, pictureNumbersIn, rewritePictureNumbers } from '../lib/prompt-refs.js'

test('F2 抽取：按出现顺序、不去重、大小写不敏感', () => {
  assert.deepEqual(pictureNumbersIn('<Picture 1> 和 <Picture 3> 再提 <Picture 1>'), [1, 3, 1])
  assert.deepEqual(pictureNumbersIn('<picture 2>'), [2])
  assert.deepEqual(pictureNumbersIn('<Picture  12>（多空格）'), [12])
  assert.deepEqual(pictureNumbersIn('没有编号的普通提示词'), [])
  assert.deepEqual(pictureNumbersIn(''), [])
})

test('F2 判定：dangling = 超出参考张数的编号；无编号时 max = 0', () => {
  assert.deepEqual(pictureIssues('<Picture 4> 首帧', 2).dangling, [4])
  assert.equal(pictureIssues('<Picture 4> 首帧', 2).max, 4)
  assert.deepEqual(pictureIssues('<Picture 1><Picture 2>', 3).dangling, [])
  assert.equal(pictureIssues('<Picture 1><Picture 2>', 3).max, 2)
  assert.deepEqual(pictureIssues('普通提示词', 2).dangling, [])
  assert.equal(pictureIssues('普通提示词', 2).max, 0)
  // 参考为 0 张时，任何编号都是悬空。
  assert.deepEqual(pictureIssues('<Picture 1>', 0).dangling, [1])
})

test('F3 致密化：按出现顺序压成 1..k，不改其余文本', () => {
  const result = rewritePictureNumbers('<Picture 2> 与 <Picture 3> 组合', 3)
  assert.equal(result.text, '<Picture 1> 与 <Picture 2> 组合')
  // 2→1 / 3→2 是致密化（确定性的），不是"猜"，不记入 clamped。
  assert.equal(result.clamped, 0)
})

test('F3 越界夹取：致密位次超出 k 时夹到 k，并按出现处数计数', () => {
  // 5 的致密位次是 3，超出 k=2 ⇒ 夹到 2。
  const result = rewritePictureNumbers('<Picture 1>、<Picture 2>、<Picture 5>', 2)
  assert.equal(result.text, '<Picture 1>、<Picture 2>、<Picture 2>')
  assert.equal(result.clamped, 1)
  // 同一编号多处出现按多处计（F8 回执要告诉用户"几处是猜的"）。
  const twice = rewritePictureNumbers('<Picture 1> <Picture 2> 再提 <Picture 9> 又 <Picture 9>', 2)
  assert.equal(twice.text, '<Picture 1> <Picture 2> 再提 <Picture 2> 又 <Picture 2>')
  assert.equal(twice.clamped, 2)
  // 对照：9 的致密位次是 2、恰好落在 k=2 内 ⇒ 是确定性致密化，不是"猜"。
  const dense = rewritePictureNumbers('<Picture 1> <Picture 9> 再提 <Picture 9>', 2)
  assert.equal(dense.text, '<Picture 1> <Picture 2> 再提 <Picture 2>')
  assert.equal(dense.clamped, 0)
})

test('F3 逐字节保真：标记之外的文本原样，无编号时是恒等变换', () => {
  const source = '前缀文字 <Picture 3> 中间；标点、\n换行 <Picture 7> 尾巴'
  const result = rewritePictureNumbers(source, 9)
  assert.equal(result.text, '前缀文字 <Picture 1> 中间；标点、\n换行 <Picture 2> 尾巴')
  assert.equal(result.clamped, 0)
  const noTags = rewritePictureNumbers('一句带标点的普通提示词，不动。', 2)
  assert.equal(noTags.text, '一句带标点的普通提示词，不动。')
  assert.equal(noTags.clamped, 0)
})
