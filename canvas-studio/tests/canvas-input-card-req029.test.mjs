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
  // 编辑不触发红线：编辑动作不发生成请求 —— 唯一出口是显式「发送」按钮（Step 4），
  // 判据唯一走 isReplayable，先落字段再重试（C4 同款）。
  assert.equal(card.includes("'generate'"), false, '卡内不许直接调 generate 工具')
  assert.match(card, /isReplayable\(node\)/, '发送判据必须唯一走 isReplayable')
  assert.match(card, /commitAll\(\)\n\s*onRetry\?\.\(node\.id\)/, '发送必须先落字段再重试')
  // 草稿：与浮层同一份内存表，关卡保留（Esc / × / 选中移走同出口）。
  assert.match(card, /setEditorDraft\(node\.id, \{ prompt: fieldDrafts \}\)/, '脏草稿必须落内存草稿表')
  assert.match(card, /if \(event\.key === 'Escape'\) \{\n\s*event\.stopPropagation\(\)/, 'Esc 必须关卡（保草稿）')
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
  assert.match(card, /referenceNamesOf\(node\.generationPrompt\)\.length|const refCount = names\.length/, '计数必须来自真实参考名列表')
  assert.match(card, /const refCap = slot\?\.max \?\? 4/, '上限必须读槽位表 max（image 兜底 4）')
})

test('REQ-029 卡托盘（Step 3）：数据契约与 ReferenceSlotEditor 同源，三条红线继承', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  const surface = await read('src/client/canvas/CanvasSurface.tsx')
  // 红线②（只存可下发句柄）：新增必经 onResolveRefs 换句柄，不许把 url/filename 直接塞进参考位。
  assert.match(card, /await onResolveRefs\(refs\)/, '新增参考必须经 onResolveRefs 换句柄')
  assert.match(card, /commitRefs\(\[\.\.\.names, \.\.\.handles\]\)/, '落位必须是解析后的句柄数组')
  // 红线③（断链不静默）：写回走 withReferenceNames，失败说理由不写半截。
  assert.match(card, /withReferenceNames\(node\.generationPrompt, slot, next\)/, '参考位写回必须走 withReferenceNames 归一化')
  assert.match(card, /为避免写坏，本次改动已放弃/, '归一化失败必须显式报错')
  // 超限拦截（拍板口径）：达上限后写不进 + 瓦片 full 态 + 菜单候选禁用。
  assert.match(card, /最多 \$\{slot\.max\} 张参考，这次没有改动/, '超限必须显式拦截')
  assert.match(card, /atMax \? 'csRefAdd full' : 'csRefAdd'/, '达上限瓦片必须切 full 态')
  assert.match(card, /disabled=\{busy \|\| atMax\}/, '达上限后菜单候选必须禁用')
  // 必填单槽只换不空。
  assert.match(card, /slot\?\.required === true && refCount <= 1/, '必填单槽不许删成空')
  // 缩略图反查与断链占位（渲染层不许静默抹掉断链参考）。
  assert.match(card, /resolveReferenceSummaries\(names, allNodes\)/, '缩略图必须经 summaries 反查')
  assert.match(card, /参考<br \/>已断链/, '断链参考必须渲染占位')
  // 宿主透传：候选池 / 资产库 / 句柄解析 / 大图预览（CV-044 通道复用）。
  assert.match(surface, /allNodes=\{allNodes \?\? nodes\}/, '卡片必须拿到候选池')
  assert.match(surface, /\{\.\.\.\(onNodeOpenPreview !== undefined \? \{ onOpenPreview/, '放大镜必须接大图预览通道')
  // 偏差登记：本地上传来源置灰（解析链路只收 lib:/节点句柄）。
  assert.match(card, /本地上传通道待接线/, '本地上传必须置灰并注明原因')
})

test('REQ-029 卡 chips（Step 4）：参数挂卡走同一写回通路，拍板口径落位', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  // 模型（拍板④）：默认自动 + 高级三选（后端真实能力名），写 modelOverride。
  assert.match(card, /MODEL_OPTIONS[\s\S]*?value: 'textRender'[\s\S]*?value: 'krea2'/, '高级手动必须用后端真实能力名（textRender/krea2）')
  assert.match(card, /commitPrompt\('modelOverride', option\.value\)/, '模型选择必须写 modelOverride 参数')
  // 画幅档位（拍板⑤⑥）：比例 3 种数据驱动 + 清晰度展示名走共享映射，写 aspectRatio/resolution。
  assert.match(card, /ASPECT_OPTIONS: readonly \{ value: string; label: string \}\[\] = \[\n?\s*\{ value: '16:9'[\s\S]*?\{ value: '1:1'/, '比例清单必须只上后端 3 种（数据驱动）')
  assert.match(card, /from '\.\.\/\.\.\/resolution-display\.js'/, '档位展示名必须消费共享映射 resolution-display')
  assert.match(card, /commitPrompt\('aspectRatio', option\.value\)/, '画幅必须写 aspectRatio 参数')
  assert.match(card, /commitPrompt\('resolution', value\)/, '清晰度必须写 resolution 参数（内部键）')
  // 风格/摄像机（前缀注入）：参数挂卡，生成时 composeImagePrompt 消费。
  assert.match(card, /commitPrompt\('stylePrefix', option\.prefix\)/, '风格必须写 stylePrefix 参数')
  assert.match(card, /commitPrompt\('cameraPrefix'/, '摄像机必须写 cameraPrefix 参数')
  // 积分（拍板⑦）：前端估算 + 「预估」标注。
  assert.match(card, /CREDIT_ESTIMATE/, '积分必须是前端占位估算表')
  assert.match(card, /· 预估/, '积分读数必须带「预估」标注')
  // 摄像机四列可选值逐字取自演示。
  assert.match(card, /潘那维申 DXL2/, '相机列必须含演示值')
  assert.match(card, /阿莱大师定焦/, '镜头列必须含演示值')
})

test('REQ-029 卡 chips（Step 4）：发送 = 先落字段再走既有重试链路', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  const surface = await read('src/client/canvas/CanvasSurface.tsx')
  assert.match(surface, /\{\.\.\.\(onRetry !== undefined \? \{ onRetry \} : \{\}\)\}\n\s*\{\.\.\.\(onNodeOpenPreview/, '宿主必须把重试链路透传给卡片')
  assert.match(card, /const canSend = onRetry !== undefined && node\.isLoading !== true && isReplayable\(node\)/, '发送判据 = 有重试链路 + 非生成中 + 可重放')
  assert.match(card, /deleteEditorDraft\(node\.id\)\n\s*onClose\(\)/, '发送成功后清草稿并关闭（保存并重试同款）')
})

test('REQ-029 共享映射上提：lobby-spec 再导出保持兼容，卡片直连 resolution-display', async () => {
  const lobby = await read('src/lobby-spec.ts')
  const display = await read('src/resolution-display.ts')
  assert.match(lobby, /export \{ DEFAULT_LOBBY_RESOLUTION, RESOLUTION_DISPLAY, resolutionDisplay, type ResolutionDisplay \} from '\.\/resolution-display\.js'/, 'lobby-spec 必须再导出（既有消费面不断）')
  assert.match(display, /RESOLUTION_DISPLAY: readonly ResolutionDisplay\[\] = \[\n\s*\{ value: '480p', label: '480P'[\s\S]*?\{ value: '736p', label: '720P'[\s\S]*?\{ value: '2k', label: '1080P'/, '映射真值必须原样上提（480P/720P/1080P ↔ 480p/736p/2k）')
})
