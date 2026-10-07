/**
 * REQ-003 Step 2 接线守卫：就地编辑（B 组）+ 保存并重试（C 组）。
 *
 * 仓库里被反复记过账的失败模式（CV-176 / CV-177）：判定/纯函数对了但**没接上**，
 * 行为与"没做"完全一样。Step 2 有四条**必须接上**、纯函数测试照不到的线：
 *
 *   1. 「改提示词」真的打开**画布浮层**（不再退回详情抽屉 —— 那样 B1 就没发生）；
 *   2. 就地编辑**只写字段**（onCommit 路径上不许出现重试 —— B2 语义红线）；
 *   3. 「保存并重试」是**先落字段、再重试**的显式按钮，且判据仍唯一走
 *      node-params.isReplayable（C1/C2/C4）；
 *   4. 浮层打开时就近工具条退场（同一时刻只留一个操作面，方案 §7 风险表）。
 *
 * 源码级字符串断言，不做 AST（与 reference-slot-wiring.test.mjs 同款手法：
 * 够用、改坏了会红）。
 *
 * 运行：corepack yarn test:smoke（纯读源码，不需要 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = async (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8')

test('REQ-003 Step 2 接线：画布浮层真的被挂载，且打开时就近工具条退场', async () => {
  const surface = await read('src/client/canvas/CanvasSurface.tsx')
  assert.match(surface, /import \{ NodePromptEditor \} from '\.\/NodePromptEditor\.js'/, '必须引入浮层组件')
  assert.match(surface, /<NodePromptEditor/, '必须在 JSX 里真的渲染它')
  // 同一时刻只留一个操作面：编辑器打开（promptEditNodeId 非空）时工具条不渲染。
  assert.match(surface, /actionBarNode !== null && promptEditNodeId === null/, '编辑器打开时 NodeActionBar 必须被隐藏')
  // 浮层锚着最新节点：存 id、按 id 查活节点（存快照会把刚保存的内容顶回去）。
  assert.match(surface, /promptEditNodeId === null \? null : nodes\.find/, '必须按 id 从节点列表取活节点')
  // 节点被删 / 选中移走 ⇒ 浮层关闭（点空白清选是画布既有语义，浮层不豁免）。
  assert.match(surface, /selectedNodeId !== promptEditNodeId/, '选中移走必须关闭浮层')
  // 工具条的「改提示词」在画布内部接线（不再要求宿主传 onEditPrompt 才亮按钮）。
  // REQ-029（CV-281 Step 2）互斥接线：开浮层同时关输入框卡（同一时刻一个编辑面）。
  assert.match(surface, /onEditPrompt=\{node => \{ setPromptEditNodeId\(node\.id\); setInputCardNodeId\(null\) \}\}/, '改提示词必须打开就地浮层（并关输入框卡）')
})

test('REQ-003 Step 2 接线：就地编辑只写字段，onCommit 路径上不出现重试（B2）', async () => {
  const panel = await read('src/client/canvas/NodePromptEditor.tsx')
  assert.match(panel, /withPromptField\(/, '提示词写回必须经 withPromptField（其余重放键原样保留）')
  assert.match(panel, /onUpdateNode\(node\.id, \{ generationPrompt: raw \}\)/, '写回必须走 onUpdateNode 的 generationPrompt')
  // 字段编辑器的 onCommit 回调里只允许 commitPrompt —— 重试只能来自页脚显式按钮。
  const fieldsBlock = panel.slice(panel.indexOf('promptFields.map'), panel.indexOf('csNodePromptFoot'))
  assert.ok(fieldsBlock.includes('commitPrompt(field.key, next)'), 'onCommit 必须接 commitPrompt')
  assert.equal(fieldsBlock.includes('onRetry'), false, 'onCommit 路径上不许出现 onRetry（编辑不触发）')
  // 写回链与详情抽屉同一条：不可解析时放弃写入（raw === null 直接 return）。
  assert.match(panel, /if \(raw === null\) return/, '参数不可解析必须放弃写入，不留半截状态')
})

test('REQ-003 Step 2 接线：保存并重试 = 先落字段再重试，判据唯一（C1/C2/C4）', async () => {
  const panel = await read('src/client/canvas/NodePromptEditor.tsx')
  // C1：保存并重试的顺序 —— commitAll() 在前、onRetry 在后（retryNode 从 store
  // 现读参数，同一次事件里先写后读是安全的；反过来就是重放旧参数）。
  const retryFn = panel.slice(panel.indexOf('const saveAndRetry'), panel.indexOf('const nodeLeft'))
  const commitAt = retryFn.indexOf('commitAll()')
  const retryAt = retryFn.indexOf('onRetry')
  assert.ok(commitAt !== -1 && retryAt !== -1, 'saveAndRetry 必须先 commitAll 再 onRetry')
  assert.ok(commitAt < retryAt, '必须先落字段、再触发重试（顺序反了就是重放旧参数）')
  // C2：判据与 NodeActionBar 同款（isReplayable + 不在生成中），组件不自造判据。
  assert.match(panel, /const canRetry = onRetry !== undefined && node\.isLoading !== true && isReplayable\(node\)/, '重试判据必须唯一走 node-params.isReplayable')
  // C4：显式按钮（canRetry 才渲染），不是失焦自动重跑。
  assert.match(panel, /\{canRetry && \(/, '保存并重试必须是 canRetry 条件渲染的显式按钮')
  // 仅保存 = 落字段 + 关浮层（草稿清除），不出图。
  assert.match(panel, /onClick=\{saveOnly\}>仅保存</, '仅保存必须是显式按钮')
  const onlyFn = panel.slice(panel.indexOf('const saveOnly'), panel.indexOf('const closeKeepingDraft'))
  assert.ok(onlyFn.includes('commitAll()') && onlyFn.includes('onClose()'), '仅保存 = 落字段 + 关浮层')
  assert.equal(onlyFn.includes('onRetry'), false, '仅保存不得触发生成')
})

test('REQ-003 Step 2 接线：参考区复用 Step 1 组件，依赖由宿主透传（B3）', async () => {
  const panel = await read('src/client/canvas/NodePromptEditor.tsx')
  assert.match(panel, /import \{ ReferenceSlotEditor \} from '\.\/ReferenceSlotEditor\.js'/, '必须复用 Step 1 的参考编辑区')
  assert.match(panel, /referenceSlotOf\(node\)/, '必须用槽位表决定出不出参考区')
  assert.match(panel, /<ReferenceSlotEditor/, '必须在 JSX 里真的渲染参考区')
  assert.match(panel, /allNodes=\{allNodes\}/, '参考候选池必须透传')

  const surface = await read('src/client/canvas/CanvasSurface.tsx')
  assert.match(surface, /allNodes\??: readonly StudioCanvasNode\[\]/, 'CanvasSurface 必须有 allNodes 可选 prop')
  assert.match(surface, /allNodes=\{allNodes \?\? nodes\}/, '候选池缺省回落到画布自己的节点列表')

  const frame = await read('src/client/StudioFrame.tsx')
  // CanvasSurface 是自闭合标签：切到它自己的 '/>'，不许把后面抽屉的接线也算进来。
  // 开标签要带换行匹配 —— '<CanvasSurface' 会先撞上 '<CanvasSurfaceHandle>' 类型标注。
  const mountStart = frame.indexOf('<CanvasSurface\n')
  const surfaceMount = frame.slice(mountStart, frame.indexOf('/>', mountStart))
  assert.match(surfaceMount, /allNodes=\{nodes\}/, '宿主必须把全量节点传给画布（候选池与抽屉同一份）')
  assert.match(surfaceMount, /libraryAssets=\{libraryAssets\}/, '资产库来源必须透传给画布')
  assert.match(surfaceMount, /resolveStudioRefs\(projectId, refs\)/, '解析必须走 client api（不许在 UI 里裸 fetch）')
  // 「改提示词」不再开抽屉：宿主不许把 onEditPrompt 接回 handleNodeOpenDetail。
  assert.equal(surfaceMount.includes('onEditPrompt='), false, 'CanvasSurface 的 onEditPrompt 已内化，宿主不许再传（防止退回抽屉形态）')
})

test('CV-272 接线：右键「修改提示词」与工具条「改提示词」打开同一个就地浮层', async () => {
  const frame = await read('src/client/StudioFrame.tsx')
  // 右键菜单的 onEditPrompt 必须开就地浮层（受控 id），不得退回详情抽屉。
  const menuStart = frame.indexOf('<CanvasContextMenu')
  const menuMount = frame.slice(menuStart, frame.indexOf('/>', menuStart))
  assert.match(
    menuMount,
    /onEditPrompt=\{id => \{ actions\.selectNode\(id\); setPromptEditNodeId\(id\) \}\}/,
    '右键「修改提示词」必须 setPromptEditNodeId（打开就地浮层，与工具条同一面板）',
  )
  // 浮层 id 受控于宿主：CanvasSurface 挂载处必须接上这对 props。
  const surfaceStart = frame.indexOf('<CanvasSurface\n')
  const surfaceMount = frame.slice(surfaceStart, frame.indexOf('/>', surfaceStart))
  assert.match(surfaceMount, /promptEditNodeId=\{promptEditNodeId\}/, '宿主必须把浮层 id 传给画布（受控）')
  assert.match(surfaceMount, /onPromptEditNodeIdChange=\{setPromptEditNodeId\}/, '宿主必须接浮层 id 变更出口')

  const surface = await read('src/client/canvas/CanvasSurface.tsx')
  // 受控 / 非受控两用：宿主未接时回落内部状态（既有测试 / 预览台直接挂画布不变）。
  assert.match(surface, /promptEditNodeIdProp !== undefined \? promptEditNodeIdProp : uncontrolledPromptEditId/, '必须保留非受控回落')
})

test('REQ-003 Step 2 接线：PromptEditor 三档语义不变，浮层经 ref 驱动同一条 commit', async () => {
  const editor = await read('src/client/canvas/PromptEditor.tsx')
  // B4：三档仍可达 —— 组件没有 fork，浮层复用同一份三档实现。
  assert.match(editor, /forwardRef<PromptEditorHandle, PromptEditorProps>/, '必须经 forwardRef 暴露句柄')
  assert.match(editor, /useImperativeHandle\(ref, \(\) => \(\{ commit \}\)\)/, '句柄必须复用内部 commit（不另开写回口径）')
  assert.match(editor, /autoEdit \? 'inline' : 'read'/, 'autoEdit 必须落在既有三档的 inline 档上（不新造档位）')
  // 首帧不许被「草稿回到真相」的 effect 冲掉（autoEdit 挂载即就地编辑）。
  assert.match(editor, /truthRef\.current/, '必须挡掉挂载那一跳，否则 autoEdit 会被重置回只读档')
  // onCommit 语义不变：内容真的变了才调。
  assert.match(editor, /if \(draft !== value\) onCommit\(draft\)/, 'commit 仍只在内容变化时写回')
})

test('REQ-003 Step 3 接线：浮层位置走 editorPlacement 求解器，平移经手势守卫施加（E1~E4）', async () => {
  const panel = await read('src/client/canvas/NodePromptEditor.tsx')
  assert.match(panel, /editorPlacement\(node, view, viewport,/, '放置必须走 canvas-view 的求解器（不许在组件里自算四侧）')
  assert.match(panel, /EDITOR_SHEET_BREAKPOINT/, '窄窗断点必须用求解器的常量（不许第二份 720）')
  // 平移上报按序列化 pan 订阅：手势期间被拒绝的 pan 不重试（E4）。
  assert.match(panel, /const panKey = `\$\{placement\.pan\.dx\},\$\{placement\.pan\.dy\}`/, '平移上报必须按 pan 值订阅')
  assert.match(panel, /if \(!placement\.visible\) return null/, '节点滚出视野必须不渲染（E7）')
  // E5：打开时的视野快照 + 恢复按钮；关闭不回弹（没有关闭时写回快照的路径）。
  assert.match(panel, /const viewBeforeOpen = useRef\(view\)/, '必须快照打开时的 view')
  assert.match(panel, /恢复视野/, '浮层头部必须有「恢复视野」入口')

  const surface = await read('src/client/canvas/CanvasSurface.tsx')
  assert.match(surface, /if \(gesture\.current\.mode !== 'none'\) return/, 'onPan 必须带手势守卫（用户手势期间放弃自动平移）')
  assert.match(surface, /onViewChangeRef\.current\(\{ x: viewRef\.current\.x \+ dx, y: viewRef\.current\.y \+ dy \}\)/, '平移必须走 onViewChange 既有通路（不改缩放）')
})

test('REQ-003 Step 3 接线：草稿只进内存表，生命周期四出口各就各位（F5）', async () => {
  const panel = await read('src/client/canvas/NodePromptEditor.tsx')
  assert.match(panel, /from '\.\.\/\.\.\/editor-drafts\.js'/, '草稿必须走内存表模块（不进 store / 不进画布契约）')
  // 四个出口：Esc/×（保留草稿）→ setEditorDraft；显式取消 / 保存成功 → deleteEditorDraft。
  assert.match(panel, /const closeKeepingDraft = \(\): void => \{[\s\S]*?setEditorDraft\(node\.id, \{ prompt: fieldDrafts \}\)/, 'Esc/× 关闭必须保留草稿')
  assert.match(panel, /const discardAndClose = \(\): void => \{[\s\S]*?deleteEditorDraft\(node\.id\)/, '显式「取消」必须丢弃草稿')
  const saveRetry = panel.slice(panel.indexOf('const saveAndRetry'), panel.indexOf('const saveOnly'))
  assert.match(saveRetry, /deleteEditorDraft\(node\.id\)/, '保存并重试成功必须清草稿')
  const saveOnlyFn = panel.slice(panel.indexOf('const saveOnly'), panel.indexOf('const closeKeepingDraft'))
  assert.match(saveOnlyFn, /deleteEditorDraft\(node\.id\)/, '仅保存成功必须清草稿')
  // 切项目清空在宿主侧。
  const frame = await read('src/client/StudioFrame.tsx')
  assert.match(frame, /useEffect\(\(\) => \{ clearEditorDrafts\(\) \}, \[selectedProjectId\]\)/, '切换项目必须清空草稿')
})

test('REQ-003 Step 3 接线：Picture 一致性提示 + 同步编号 + 不随警告消失的撤销（F2/F3/F8）', async () => {
  const panel = await read('src/client/canvas/NodePromptEditor.tsx')
  assert.match(panel, /from '\.\.\/\.\.\/prompt-refs\.js'/, '一致性判定必须走纯函数模块')
  assert.match(panel, /rewritePictureNumbers\(promptText, names\.length\)/, '同步编号必须走纯函数（越界夹 k）')
  assert.match(panel, /onClick=\{syncPictures\}>同步编号</, 'amber 条上必须有「同步编号」动作')
  // F8：回执是独立于警告条的中性条，撤销入口在回执上（警告消失撤销还在）。
  assert.match(panel, /csPromptWarnbarNeutral[\s\S]*?撤销/, '中性回执必须自带撤销入口')
  assert.match(panel, /const undoRefChange = \(\): void => \{/, '撤销必须回到基线（refs + prompt）')
  // 不阻断：警告条/回执块里不许出现生成按钮的渲染条件（canRetry）。
  const barBlock = panel.slice(panel.indexOf('{/* F2/F3'), panel.indexOf('csNodePromptBody'))
  assert.equal(barBlock.includes('canRetry'), false, '警告条不得参与「保存并重试」的渲染条件（不阻断生成）')
})

test('REQ-003 Step 3 接线：Cmd/Ctrl+Enter = 保存并重试，正文里触发时拦冒泡（F6）', async () => {
  const editor = await read('src/client/canvas/PromptEditor.tsx')
  assert.match(editor, /onCmdEnter\?\(\): void/, 'PromptEditor 必须有 onCmdEnter 宿主出口')
  assert.match(editor, /if \(onCmdEnter !== undefined\) \{\s*event\.stopPropagation\(\)\s*onCmdEnter\(\)/, '正文里 Cmd+Enter 必须交宿主并拦冒泡（否则面板根节点重复响应）')
  const panel = await read('src/client/canvas/NodePromptEditor.tsx')
  assert.match(panel, /onCmdEnter=\{saveAndRetry\}/, '浮层把 Cmd+Enter 接成保存并重试')
  assert.match(panel, /if \(event\.key === 'Enter' && \(event\.metaKey \|\| event\.ctrlKey\)\) \{ event\.preventDefault\(\); saveAndRetry\(\) \}/, '焦点不在正文时 Cmd+Enter 也走保存并重试')
})
