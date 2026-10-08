/**
 * REQ-003 B/C 组接线守卫 —— REQ-029 拍板⑧（CV-281 Step 5）起改钉**节点输入框卡**。
 *
 * 就地浮层（NodePromptEditor / .csNodePromptPanel / editorPlacement 求解器）已随
 * 拍板⑧「替换 + 迁移分批」退役：右键「修改提示词」/ 工具条「改提示词」（CV-272
 * 两入口，宿主受控 id）与单击节点现在都打开 NodeInputCard。能力迁移对照见
 * plans/REQ-029-画布image节点交互方案.md §6.2。
 *
 * **随浮层退役的能力（刻意不做，偏差登记于方案 §九）**：
 *   - E1~E5 四侧放置求解器 / 恢复视野（卡锚节点正下方、不平移，无回弹需求）；
 *   - F2/F3/F8 Picture 一致性条与同步编号（image 槽位无序、<Picture N> 场景罕见；
 *     video 形态若需要随 REQ-031 再评估）；
 *   - 显式「仅保存」按钮（卡的 × / Esc 即保草稿关闭；发送 = 保存并重试）；
 *   - F6 Cmd/Ctrl+Enter = 保存并重试（卡上 Cmd+Enter 走 PromptEditor 缺省提交档）。
 *
 * 源码级字符串断言（与 reference-slot-wiring.test.mjs 同款手法：够用、改坏了会红）。
 *
 * 运行：corepack yarn test:smoke（纯读源码，不需要 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = async (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8')

test('REQ-003→029 接线：编辑面唯一 = 节点输入框卡，浮层退役零残留', async () => {
  const surface = await read('src/client/canvas/CanvasSurface.tsx')
  assert.match(surface, /import \{ NodeInputCard \} from '\.\/NodeInputCard\.js'/, '必须引入输入框卡组件')
  assert.match(surface, /<NodeInputCard/, '必须在 JSX 里真的渲染它')
  assert.equal(surface.includes("from './NodePromptEditor.js'"), false, '画布不得再 import 浮层（拍板⑧已退役）')
  assert.equal(surface.includes('<NodePromptEditor'), false, '画布不得再渲染浮层（拍板⑧已退役）')
  // 宿主受控 id（CV-272 两入口）并入卡片打开口径：promptEditNodeId 也打开卡。
  assert.match(surface, /const cardNodeId = inputCardNodeId \?\? promptEditNodeId \?\? null/, '两路编辑 id 必须并一个打开口径')
  // CV-283 拍板③：卡片与就近工具条**同框共存**（不再以卡打开为由让工具条退场）。
  assert.match(surface, /actionBarNode !== null && \(/, '卡打开时工具条必须继续渲染（同框共存）')
  assert.equal(
    /actionBarNode !== null && cardNodeId === null/.test(surface),
    false,
    '不得再以「卡打开」为由让工具条退场（拍板③已反转）',
  )
  // 选中移走即关（两路 id 各自的关闭出口保留，清选即收起）。
  assert.match(surface, /!alive \|\| selectedNodeId !== inputCardNodeId/, '卡片必须绑选区（清选即收起）')
  assert.match(surface, /!alive \|\| selectedNodeId !== promptEditNodeId/, '宿主受控 id 必须绑选区')
  // styles 零残留。
  const styles = await read('src/client/styles.ts')
  assert.equal(styles.includes('.csNodePromptPanel'), false, '.csNodePromptPanel 样式必须随浮层退役')
})

test('REQ-003 B2（迁卡）：就地编辑只写字段，onCommit 路径上不出现生成', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  assert.match(card, /withPromptField\(/, '提示词写回必须经 withPromptField（其余重放键原样保留）')
  assert.match(card, /onUpdateNode\(node\.id, \{ generationPrompt: raw \}\)/, '写回必须走 onUpdateNode 的 generationPrompt')
  // 字段编辑器的 onCommit 回调里只允许 commitPrompt —— 生成只来自显式「发送」按钮。
  const fieldsBlock = card.slice(card.indexOf('promptFields.map'), card.indexOf('csInputCardFoot'))
  assert.ok(fieldsBlock.includes('commitPrompt(field.key, next)'), 'onCommit 必须接 commitPrompt')
  assert.equal(fieldsBlock.includes('onRetry'), false, 'onCommit 路径上不许出现 onRetry（编辑不触发）')
  // 写回链与详情抽屉同一条：不可解析时放弃写入（raw === null 直接 return）。
  assert.match(card, /if \(raw === null\) return/, '参数不可解析必须放弃写入，不留半截状态')
})

test('REQ-003 C1/C2/C4（迁卡）：发送 = 先落字段再重试，判据唯一', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  // C1：发送的顺序 —— commitAll() 在前、onRetry 在后（retryNode 从 store 现读参数，
  // 同一次事件里先写后读是安全的；反过来就是重放旧参数）。
  const sendFn = card.slice(card.indexOf('const send = '), card.indexOf('---- 放置'))
  const commitAt = sendFn.indexOf('commitAll()')
  const retryAt = sendFn.indexOf('onRetry')
  assert.ok(commitAt !== -1 && retryAt !== -1, 'send 必须先 commitAll 再 onRetry')
  assert.ok(commitAt < retryAt, '必须先落字段、再触发重试（顺序反了就是重放旧参数）')
  // C2：判据唯一（isReplayable + 不在生成中），组件不自造判据。
  assert.match(card, /const canSend = onRetry !== undefined && node\.isLoading !== true && isReplayable\(node\)/, '发送判据必须唯一走 node-params.isReplayable')
  // C4：显式按钮（canSend 才可用），不是失焦自动重跑。
  assert.match(card, /disabled=\{!canSend\}/, '发送必须是 canSend 条件禁用的显式按钮')
})

test('REQ-003 B3（迁卡）：参考托盘走同一数据契约，依赖由宿主透传', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  assert.match(card, /referenceSlotOf\(node\)/, '必须用槽位表决定参考区口径')
  assert.match(card, /await onResolveRefs\(refs\)/, '新增参考必须经句柄解析（红线②：只存可下发句柄）')

  const surface = await read('src/client/canvas/CanvasSurface.tsx')
  assert.match(surface, /allNodes=\{allNodes \?\? nodes\}/, '候选池缺省回落到画布自己的节点列表')

  const frame = await read('src/client/StudioFrame.tsx')
  // CanvasSurface 是自闭合标签：切到它自己的 '/>'，不许把后面抽屉的接线也算进来。
  const mountStart = frame.indexOf('<CanvasSurface\n')
  const surfaceMount = frame.slice(mountStart, frame.indexOf('/>', mountStart))
  assert.match(surfaceMount, /allNodes=\{nodes\}/, '宿主必须把全量节点传给画布（候选池与抽屉同一份）')
  assert.match(surfaceMount, /libraryAssets=\{libraryAssets\}/, '资产库来源必须透传给画布')
  assert.match(surfaceMount, /resolveStudioRefs\(projectId, refs\)/, '解析必须走 client api（不许在 UI 里裸 fetch）')
  // 「改提示词」不再开抽屉：宿主不许把 onEditPrompt 接回 handleNodeOpenDetail。
  assert.equal(surfaceMount.includes('onEditPrompt='), false, 'CanvasSurface 的 onEditPrompt 已内化，宿主不许再传（防止退回抽屉形态）')
})

test('CV-272→029 接线：右键「修改提示词」与工具条「改提示词」打开同一个输入框卡', async () => {
  const frame = await read('src/client/StudioFrame.tsx')
  // 右键菜单的 onEditPrompt 走受控 id（卡片消费同一口径），不得退回详情抽屉。
  const menuStart = frame.indexOf('<CanvasContextMenu')
  const menuMount = frame.slice(menuStart, frame.indexOf('/>', menuStart))
  assert.match(
    menuMount,
    /onEditPrompt=\{id => \{ actions\.selectNode\(id\); setPromptEditNodeId\(id\) \}\}/,
    '右键「修改提示词」必须 setPromptEditNodeId（打开输入框卡，与工具条同一编辑面）',
  )
  const surfaceStart = frame.indexOf('<CanvasSurface\n')
  const surfaceMount = frame.slice(surfaceStart, frame.indexOf('/>', surfaceStart))
  assert.match(surfaceMount, /promptEditNodeId=\{promptEditNodeId\}/, '宿主必须把编辑 id 传给画布（受控）')
  assert.match(surfaceMount, /onPromptEditNodeIdChange=\{setPromptEditNodeId\}/, '宿主必须接 id 变更出口')

  const surface = await read('src/client/canvas/CanvasSurface.tsx')
  // 受控 / 非受控两用：宿主未接时回落内部状态（既有测试 / 预览台直接挂画布不变）。
  assert.match(surface, /promptEditNodeIdProp !== undefined \? promptEditNodeIdProp : uncontrolledPromptEditId/, '必须保留非受控回落')
  // 工具条入口直接开卡（不再经浮层）。
  assert.match(surface, /onEditPrompt=\{node => \{ setInputCardNodeId\(node\.id\); setPromptEditNodeId\(null\) \}\}/, '工具条「改提示词」必须打开输入框卡')
})

test('REQ-003 B4：PromptEditor 三档语义不变，卡片经 ref 驱动同一条 commit', async () => {
  const editor = await read('src/client/canvas/PromptEditor.tsx')
  // B4：三档仍可达 —— 组件没有 fork，卡片复用同一份三档实现。
  assert.match(editor, /forwardRef<PromptEditorHandle, PromptEditorProps>/, '必须经 forwardRef 暴露句柄')
  // REQ-031 Step 3：句柄扩 appendText（运镜短语进草稿）——写回口径仍只有 commit 一条。
  assert.match(editor, /useImperativeHandle\(ref, \(\) => \(\{ commit, appendText \}\)\)/, '句柄必须复用内部 commit（不另开写回口径）')
  const appendBody = editor.slice(editor.indexOf('const appendText'), editor.indexOf('const cancel'))
  assert.ok(appendBody.length > 0 && !appendBody.includes('onCommit'), 'appendText 只动草稿，不得在句柄里开第二条写回路径')
  // 三档仍可达 —— 组件没有 fork；bare（CV-283 卡内形态）只是钉在既有 inline 档，
  // 不是第四个档位。
  assert.match(editor, /autoEdit \|\| bare \? 'inline' : 'read'/, 'autoEdit/bare 必须落在既有三档的 inline 档上（不新造档位）')
  // bare 的三条专属语义（卡是唯一编辑面）：外部值流回不退回只读、Esc 交还宿主、
  // 裸 Enter 发送（演示 L2603）。
  assert.match(editor, /if \(bare && !nodeSwitched\)/, 'bare 外部值变化必须走合并同步（不换档）')
  assert.match(editor, /bare：编辑器\*\*不吞\*\* Esc/, 'bare 的 Esc 必须冒泡给输入框卡（关卡保草稿）')
  assert.match(editor, /bare && onEnterSend !== undefined && event\.key === 'Enter'/, 'bare 必须裸 Enter 发送')
  // 首帧不许被「草稿回到真相」的 effect 冲掉（autoEdit 挂载即就地编辑）。
  assert.match(editor, /truthRef\.current/, '必须挡掉挂载那一跳，否则 autoEdit 会被重置回只读档')
  // onCommit 语义不变：内容真的变了才调。
  assert.match(editor, /if \(draft !== value\) onCommit\(draft\)/, 'commit 仍只在内容变化时写回')
})

test('REQ-003 F5（迁卡）：草稿只进内存表，出口纪律与切项目清扫保留', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  assert.match(card, /from '\.\.\/\.\.\/editor-drafts\.js'/, '草稿必须走内存表模块（不进 store / 不进画布契约）')
  // 出口：× / Esc / 选中移走 = 保留草稿（重开回填）；发送成功 = 清草稿。
  // （浮层的显式「取消」按钮与「仅保存」不迁卡 —— 卡的关闭即保草稿，偏差登记 §九。）
  assert.match(card, /const closeKeepingDraft = \(\): void => \{[\s\S]*?setEditorDraft\(node\.id, \{ prompt: fieldDrafts \}\)/, '×/Esc 关闭必须保留草稿')
  const sendFn = card.slice(card.indexOf('const send = '), card.indexOf('---- 放置'))
  assert.match(sendFn, /deleteEditorDraft\(node\.id\)/, '发送成功必须清草稿')
  // 切项目清空在宿主侧。
  const frame = await read('src/client/StudioFrame.tsx')
  assert.match(frame, /useEffect\(\(\) => \{ clearEditorDrafts\(\) \}, \[selectedProjectId\]\)/, '切换项目必须清空草稿')
})
