/**
 * REQ-029（CV-281 Step 2）节点输入框卡接线守卫。
 *
 * 口径（tracking.md REQ-029 条目「拍板」段 + 方案 §六/§七 Step 2）：
 *   - 单击节点（无位移干净点击）= 唤起输入框卡，与就地浮层互斥（同一时刻一个编辑面）；
 *   - 卡只落字段（withPromptField 通路），绝不发生成请求（编辑不触发红线）；
 *   - 关卡保留草稿（与浮层同一份 editor-drafts 表）；
 *   - 1:1 还原演示规格（色值/圆角/宽度照抄 canvas-imagenode-inputbox.html）。
 *
 * 源码级字符串断言（与 canvas-prompt-edit.test.mjs 同款手法：够用、改坏了会红）。
 *
 * 运行：corepack yarn test:smoke（纯读源码，不需要 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = async (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8')

test('REQ-029 卡接线：单击节点唤起输入框卡，与就地浮层互斥', async () => {
  const surface = await read('src/client/canvas/CanvasSurface.tsx')
  assert.match(surface, /import \{ NodeInputCard \} from '\.\/NodeInputCard\.js'/, '必须引入输入框卡组件')
  assert.match(surface, /<NodeInputCard/, '必须在 JSX 里真的渲染它')
  // 单击开卡：干净点击（editBegun 未置位）才唤起 —— 拖拽/连线不触发。
  assert.match(
    surface,
    /current\.mode === 'node' && current\.editBegun !== true && current\.nodeId !== undefined/,
    'pointerup 必须有「干净点击开卡」分支',
  )
  // 互斥：开卡关浮层、开浮层关卡（同一时刻一个编辑面，拍板⑧）。
  assert.match(surface, /setInputCardNodeId\(current\.nodeId\)\n\s*setPromptEditNodeId\(null\)/, '开卡必须让浮层让位')
  assert.match(surface, /onEditPrompt=\{node => \{ setPromptEditNodeId\(node\.id\); setInputCardNodeId\(null\) \}\}/, '「改提示词」入口必须关卡')
  // 关闭链：选中移走即关（与浮层同款 effect）。
  assert.match(surface, /inputCardNode === null \|\| selectedNodeId !== inputCardNodeId/, '选中移走必须关闭输入框卡')
})

test('REQ-029 卡语义：只落字段不触发生成，关卡保留草稿', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  // 写回唯一通路：withPromptField → onUpdateNode（与浮层同一条线）。
  assert.match(card, /const raw = withPromptField\(rawRef\.current, key, next\)/, '写回必须经 withPromptField')
  assert.match(card, /onUpdateNode\(node\.id, \{ generationPrompt: raw \}\)/, '写回必须走 onUpdateNode 的 generationPrompt')
  // 编辑不触发红线：卡内不允许出现生成/重试出口。
  assert.equal(card.includes('onRetry'), false, '卡内不许出现 onRetry（Step 4 发送走生成链路，另行接线）')
  assert.equal(/generate/i.test(card), false, '卡内不许出现 generate 调用（骨架只落字段）')
  // 草稿：与浮层同一份内存表，关卡保留（Esc / × / 选中移走同出口）。
  assert.match(card, /setEditorDraft\(node\.id, \{ prompt: fieldDrafts \}\)/, '脏草稿必须落内存草稿表')
  assert.match(card, /if \(event\.key === 'Escape'\) \{ event\.stopPropagation\(\); closeKeepingDraft\(\) \}/, 'Esc 必须关卡（保草稿）')
  // 提示词编辑复用 PromptEditor（能力迁移纪律：同编辑器、同草稿、同写回）。
  assert.match(card, /<PromptEditor/, '提示词区必须复用 PromptEditor')
  assert.match(card, /\{\.\.\.\(seed\.current !== undefined && seed\.current\.prompt\[field\.key\] !== undefined/, '重开必须回填草稿')
})

test('REQ-029 卡 1:1：演示规格（色值/圆角/宽度）照抄入 styles', async () => {
  const styles = await read('src/client/styles.ts')
  assert.match(styles, /\.csNodeInputCard \{[\s\S]*?border-radius: 20px;/, '卡壳圆角必须 = 演示 20px')
  assert.match(styles, /\.csNodeInputCard \{[\s\S]*?width: min\(760px, 92vw\);/, '卡宽必须 = 演示 min(760px, 92vw)')
  assert.match(styles, /\.csNodeInputCard \{[\s\S]*?linear-gradient\(180deg, #161a1f 0%, #12151a 100%\)/, '卡底必须 = 演示渐变')
  assert.match(styles, /\.csNodeInputCard\.csNodeInputCardZoomed \{[\s\S]*?width: min\(1120px, 94vw\);/, '展开态宽度必须 = 演示 min(1120px, 94vw)')
  // accent 固定演示色（1:1 硬要求；不随预设 —— 偏差登记见方案 §九）。
  assert.match(styles, /\.csInputSend \{[\s\S]*?background: #ffb066;/, '发送钮必须 = 演示 accent #ffb066')
  assert.match(styles, /\.csRefAdd \{[\s\S]*?border: 1\.5px dashed #333a45;/, '参考添加瓦片必须 = 演示虚线规格')
})

test('REQ-029 卡计数：参考托盘读数接真值（槽位上限来自 REFERENCE_SLOTS）', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  assert.match(card, /referenceNamesOf\(node\.generationPrompt\)\.length/, '计数必须来自真实参考名列表')
  assert.match(card, /referenceSlotOf\(node\)\?\.max \?\? 4/, '上限必须读槽位表 max（image 兜底 4）')
})
