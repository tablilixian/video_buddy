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
  // 单击开卡（Step 5 收口后为唯一编辑面）：开卡清宿主受控 id（同一时刻一个编辑面）。
  assert.match(surface, /setInputCardNodeId\(current\.nodeId\)\n\s*setPromptEditNodeId\(null\)/, '开卡必须清宿主受控编辑 id')
  assert.match(surface, /onEditPrompt=\{node => \{ setInputCardNodeId\(node\.id\); setPromptEditNodeId\(null\) \}\}/, '「改提示词」入口必须打开输入框卡')
  // 关闭链：选中移走即关（清选即收起）。
  assert.match(surface, /!alive \|\| selectedNodeId !== inputCardNodeId/, '选中移走必须关闭输入框卡')
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
  assert.match(styles, /\.csNodeInputCard \{[\s\S]*?width: min\(\$\{CHROME_CARD_WIDTH\}px, 92vw\);/, '卡宽必须 = 演示 min(760px, 92vw)（760 插值 CHROME_CARD_WIDTH 同源）')
  assert.match(styles, /\.csNodeInputCard \{[\s\S]*?linear-gradient\(180deg, #161a1f 0%, #12151a 100%\)/, '卡底必须 = 演示渐变')
  // CV-283 拍板①：放大态（演示 body.zoomed / 对角箭头展开钮）已移除 —— 钉住不回潮。
  assert.equal(styles.includes('csNodeInputCardZoomed'), false, '放大态样式必须移除（CV-283 砍放大）')
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  assert.equal(card.includes('EXPAND_ICON'), false, '展开钮必须移除')
  assert.equal(/setExpanded|expanded \?/.test(card), false, 'expanded 状态必须移除')
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
  // REQ-032 Step 3 在 onToast 之后插了 onUploadMedia 透传行，其余相邻关系不变。
  assert.match(surface, /\{\.\.\.\(onRetry !== undefined \? \{ onRetry \} : \{\}\)\}\n\s*\{\.\.\.\(onToast !== undefined \? \{ onToast \} : \{\}\)\}\n\s*\{\.\.\.\(onUploadMedia !== undefined \? \{ onUploadMedia \} : \{\}\)\}\n\s*\{\.\.\.\(onNodeOpenPreview/, '宿主必须把重试链路透传给卡片')
  assert.match(card, /const canSend = onRetry !== undefined && node\.isLoading !== true && isReplayable\(node\)/, '发送判据 = 有重试链路 + 非生成中 + 可重放')
  assert.match(card, /deleteEditorDraft\(node\.id\)\n\s*onClose\(\)/, '发送成功后清草稿并关闭（保存并重试同款）')
})

test('REQ-029 共享映射上提：lobby-spec 再导出保持兼容，卡片直连 resolution-display', async () => {
  const lobby = await read('src/lobby-spec.ts')
  const display = await read('src/resolution-display.ts')
  assert.match(lobby, /export \{ DEFAULT_LOBBY_RESOLUTION, RESOLUTION_DISPLAY, resolutionDisplay, type ResolutionDisplay \} from '\.\/resolution-display\.js'/, 'lobby-spec 必须再导出（既有消费面不断）')
  assert.match(display, /RESOLUTION_DISPLAY: readonly ResolutionDisplay\[\] = \[\n\s*\{ value: '480p', label: '480P'[\s\S]*?\{ value: '736p', label: '720P'[\s\S]*?\{ value: '2k', label: '1080P'/, '映射真值必须原样上提（480P/720P/1080P ↔ 480p/736p/2k）')
})

// ==================== REQ-032 / CV-287 Step 1：audio 形态 ====================

test('REQ-032 audio 接线：kind 判定 + onToast 透传 + 卡宽 792/0.93', async () => {
  const surface = await read('src/client/canvas/CanvasSurface.tsx')
  const frame = await read('src/client/StudioFrame.tsx')
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  const aspect = await read('src/canvas-aspect.ts')
  // form 三路判定：audio 节点必须进 audio 形态。
  assert.match(surface, /form=\{cardNode\.kind === 'video' \? 'video' : cardNode\.kind === 'audio' \? 'audio' : 'image'\}/, 'form 判定必须三路')
  // toast 出口：card → surface → frame pushToast（画布层不认识 toast）。
  assert.match(card, /onToast\?\(message: string\): void/, '卡片必须暴露 onToast prop')
  assert.match(surface, /onToast\?\(message: string\): void/, '画布层必须透传 onToast')
  assert.match(surface, /\{\.\.\.\(onToast !== undefined \? \{ onToast \} : \{\}\)\}/, '画布层必须条件透传 onToast 给卡片')
  assert.match(frame, /onToast=\{pushToast\}/, 'frame 必须把 pushToast 接给画布层')
  // 卡宽：audio 792/0.93vw，image/video 760/0.92vw。
  assert.match(aspect, /export const CHROME_CARD_WIDTH_AUDIO = 792/, 'audio 卡宽常量必须 = 演示 792')
  assert.match(card, /const cardWidthMax = isAudio \? CHROME_CARD_WIDTH_AUDIO : CHROME_CARD_WIDTH/, '卡宽必须按形态切 792/760')
  assert.match(card, /const cardViewportRatio = isAudio \? 0\.93 : 0\.92/, '视口占比必须按形态切 0.93/0.92')
})

test('REQ-032 audio 参数：整体重建写回（不 spread 旧键）+ 双分支校验 + 发送重写', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  // 整体重建：fn 切换原子重写键形（CS-PARAM-001 防线）——写回口唯一。
  assert.match(card, /function buildAudioPrompt\(state: AudioCardState\): string/, '必须有 buildAudioPrompt 整体重建')
  assert.match(card, /commitAudio = \(next: AudioCardState, toastText\?: string\): void => \{\n\s*setAudio\(next\)\n\s*const raw = buildAudioPrompt\(next\)/, '写回必须经 buildAudioPrompt 整体重建')
  assert.match(card, /if \(rawRef\.current !== raw\) \{/, '串一致必须跳过写回（不留空撤销快照）')
  assert.match(card, /onUpdateNode\(node\.id, \{ toolName: audioFnToolName\(next\.fn\), generationPrompt: raw \}\)/, '写回必须同步 toolName')
  // 解析：蛇形优先、fn 缺失按 toolName 推断、[Instrumental] 读作无歌词。
  assert.match(card, /function parseAudioState\(raw: string \| undefined, toolName: string \| undefined\): AudioCardState/, '必须有 parseAudioState')
  assert.match(card, /hostLyrics === INSTRUMENTAL_LYRICS \? '' : hostLyrics/, 'host 器乐哨兵必须读作无歌词')
  assert.match(card, /toolName === 'music_generation' \? 'music' : 'voice'/, 'fn 缺失必须按 toolName 推断')
  // 双分支校验（按钮 + 发送防御）：music 描述必填 / voice·design 正文必填。
  assert.match(card, /audio\.fn === 'music'\n\s*\? \(audio\.free\.trim\(\) === '' \? '先描述一下这首歌的风格与情绪' : null\)\n\s*: \(audio\.body\.trim\(\) === '' \? '先写要合成的正文' : null\)/, '双分支必填校验必须落位')
  // Step 3 发送重写：music 写 duration=D-MusicDur、design 清 ref、voice 原样（§六）。
  assert.match(card, /const next: AudioCardState = audio\.fn === 'music'\s*\n\s*\? \{ \.\.\.audio, duration: audioEst, ref: null \}\s*\n\s*: audio\.fn === 'voice'\s*\n\s*\? audio\s*\n\s*: \{ \.\.\.audio, ref: null \}\s*\n\s*commitAudio\(next\)/, '发送必须按 fn 三路重写后再 commit')
  assert.match(card, /disabled=\{!canSend \|\| audioIssue !== null\}/, '发送按钮必须叠 audioIssue 禁用')
  // 红线不许破：判据唯一 isReplayable、先落字段再重试。
  assert.match(card, /const canSend = onRetry !== undefined && node\.isLoading !== true && isReplayable\(node\)/, 'canSend 红线必须原样')
  assert.match(card, /commitAll\(\)\n\s*onRetry\?\.\(node\.id\)/, '发送红线顺序必须原样')
})

test('REQ-032 audio 交互：fn 切换/清空/歌词确定走 toast，文本域 blur 才落参数', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  // fn 切换：toast 报所切功能 + 参数原子重写（switchAudioFn 调 commitAudio）。
  assert.match(card, /commitAudio\(\{ \.\.\.audio, fn: next \}, `节点功能 → \$\{audioFnName\(next\)\}`\)/, 'fn 切换必须 toast + 整体重写')
  // 清空双分支文案。
  assert.match(card, /commitAudio\(\{ \.\.\.audio, free: '', lyrics: '', lyricsOn: false \}, '已清空描述与歌词'\)/, 'music 清空必须含歌词')
  assert.match(card, /commitAudio\(\{ \.\.\.audio, sel: \{\}, free: '', body: '' \}, '已清空描述与正文'\)/, 'voice/design 清空必须含词条+正文')
  // 歌词确定：剥尾空白 + 有词自动开开关 + 字数 toast。
  assert.match(card, /const lyrics = lyricsDraft\.replace\(\/\\s\+\$\/, ''\)/, '确定必须剥尾空白')
  assert.match(card, /lyricsOn: lyrics !== '' \? true : audio\.lyricsOn/, '有词必须自动开开关')
  assert.match(card, /歌词已保存（\$\{stripWs\(lyrics\)\.length} 字）/, '保存 toast 必须带字数')
  // 文本域纪律：onChange 只进内存态，blur 才 commit（updateNode 逐键会拆 undo）。
  assert.match(card, /onChange=\{event => \{ setAudio\(previous => \(\{ \.\.\.previous, free: event\.target\.value \}\)\) \}\}/, '自由段 onChange 只进内存态')
  assert.match(card, /onBlur=\{\(\) => \{ commitAudio\(audio\) \}\}/, '文本域必须 blur 才落参数')
  // Esc 在文本域内关卡也要落一次（keyDown 先于 blur）。
  assert.match(card, /if \(isAudio\) commitAudio\(audio\)/, 'closeKeepingDraft 必须补落 audio 参数')
  // 词条 ×：单删一词、层空删键。
  assert.match(card, /removeAudioTok = \(dim: string, word: string\): void => \{/, '必须有词条删除口')
  assert.match(card, /if \(words\.length > 0\) sel\[dim\] = words\n\s*else delete sel\[dim\]/, '层空必须删键')
  // 描述区分隔符：层内「，」跨层「；」。
  assert.match(card, /sep = item\.t === 'tok' && prevL !== null && item\.L !== prevL \? '；' : '，'/, '跨层必须「；」层内「，」')
  // 音乐/语音显隐：music 隐藏 cap/body/layer-row/lyric 行，非 music 隐藏 music-wrap。
  assert.match(card, /\{isAudio && \(\n\s*<div className="csAudioBody">/, 'audio 主体必须渲染')
  assert.match(card, /\{audio\.fn !== 'music' \? \(\n\s*<div className="csAudioCapWrap">/, '非 music 必须渲染描述区')
  assert.match(card, /\{audio\.fn !== 'music' && \(\n\s*<div className="csAudioBodyWrap">/, '非 music 必须渲染正文区')
  assert.match(card, /\{audio\.fn === 'music' && \(\n\s*<span className="csAudioLyricSel">/, 'music 必须渲染歌词行')
  assert.match(card, /\{audio\.fn !== 'music' && \(\n\s*<div className="csAudioLayerRow">/, '非 music 必须渲染层 pill 行')
  // Step 1 四 pill 占位已被 Step 2 真接线取代（pill 可点开层面板）。
  // fn 菜单无对勾（演示口径：仅 .on 高亮 + aria-checked）。只查 audio fn 菜单块，
  // 不全文断言 —— image 模型弹层（csModelCheck）本就有对勾。
  assert.match(card, /aria-checked=\{item\.k === audio\.fn\}/, 'fn 菜单项必须 aria-checked')
  const fnMenuBlock = card.slice(card.indexOf('csAudioFnMenus'), card.indexOf('csAudioLayerRow'))
  assert.equal(fnMenuBlock.includes('✓'), false, 'fn 菜单块不许出现对勾字符（演示无对勾）')
  assert.equal(fnMenuBlock.includes('csModelCheck'), false, 'fn 菜单块不许复用模型对勾类')
  // 积分 title 拍板⑤附时长估算。
  assert.match(card, /预计约 \$\{audioEst\} 秒（按字数估算）/, '积分 title 必须带预计秒数')
  // 正文 placeholder 按 fn 分支。
  assert.match(card, /const audioBodyPlaceholder = audio\.fn === 'design' \? '音色文案，3秒以上' : '要合成的正文。'/, 'placeholder 必须按 fn 分支')
  // 托盘/prompt 区对 audio 跳过。
  assert.match(card, /\{isAudio \? null : isVideo \? \(/, 'audio 必须跳过参考托盘')
  assert.match(card, /\{!isAudio && \(\n\s*<div className="csInputCardPromptWrap">/, 'audio 必须跳过 PromptEditor 区')
  // act 区 audio 清空钮。
  assert.match(card, /\{isAudio && \(\n\s*<button\n\s*type="button"\n\s*className="csInputCardIb"\n\s*title=\{audio\.fn === 'music' \? '清空描述与歌词' : '清空描述与正文'\}/, 'act 区必须有 audio 清空钮')
})

test('REQ-032 audio 样式：csAudio* 类与演示色板落位（无反引号/无新插值）', async () => {
  const styles = await read('src/client/styles.ts')
  // 类存在性（关键锚点）。
  for (const cls of [
    'csAudioBody', 'csAudioCapWrap', 'csAudioCapFree', 'csAudioTok', 'csAudioTokX', 'csAudioSep',
    'csAudioBodyWrap', 'csAudioBodyText', 'csAudioMusicWrap', 'csAudioMusicDesc',
    'csAudioFootLeft', 'csAudioLayerRow', 'csAudioFnMenus', 'csAudioFnBtn', 'csAudioFnIcon',
    'csAudioFnCaret', 'csAudioFnPop', 'csAudioFnItem', 'csAudioLyricSel', 'csAudioLyricSwitch',
    'csAudioLyrPop', 'csAudioLyrHead', 'csAudioLyrText', 'csAudioLyrFoot', 'csAudioLyrHint', 'csAudioLyrOk',
  ]) {
    assert.ok(styles.includes(`.${cls} `) || styles.includes(`.${cls}{`) || styles.includes(`.${cls}\n`) || styles.includes(`.${cls} {`) || styles.includes(`.${cls}::`) || styles.includes(`.${cls}.`) || styles.includes(`.${cls}:`) || styles.includes(`.${cls},`) || styles.includes(`.${cls})`), `样式必须含 .${cls}`)
  }
  // 演示色板关键值。
  assert.match(styles, /\.csAudioFnBtn \{[\s\S]*?linear-gradient\(180deg, #ffb066, #ff8f3c\)/, 'fn 菜单钮必须演示 accent 渐变')
  assert.match(styles, /\.csAudioFnItem\.on \{ background: linear-gradient\(180deg, #ffb066, #ff8f3c\)/, 'fn 选中项必须渐变高亮')
  assert.match(styles, /\.csAudioLyrPop \{[\s\S]*?width: 344px/, '歌词弹层必须 = 演示 344px')
  assert.match(styles, /\.csAudioLyrSwitch \{|\.csAudioLyricSwitch \{/, '歌词开关类必须存在')
  // 括号装饰（演示 cap-wrap ::before/::after）。
  assert.match(styles, /\.csAudioCapWrap::before \{[\s\S]*?content: "\("/, '描述区左括号必须存在')
  assert.match(styles, /\.csAudioCapWrap::after \{[\s\S]*?content: "\)"/, '描述区右括号必须存在')
  // 无新 @keyframes（守卫只允许 develop/advance/yield/toast/logo）。
  const audioBlock = styles.slice(styles.indexOf('REQ-032 / CV-287 Step 1'))
  assert.equal(/@keyframes/.test(audioBlock), false, 'audio 样式块不许新增 @keyframes')
})

// ==================== REQ-032 / CV-287 Step 2：四层设置面板 ====================

test('REQ-032 Step 2 面板接线：pill 可点开层 + .has 选中态 + 同一时刻一层', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  const pop = await read('src/client/canvas/VoiceLayerPop.tsx')
  // 单一 openPop：层键带前缀 `layer:<L>`，天然满足「同一时刻只开一个」。
  assert.match(card, /type ChipPop =\n[\s\S]*?\| `layer:\$\{AudioLayer\}`/, 'openPop 必须能表示任一层')
  assert.match(card, /setOpenPop\(open \? null : `layer:\$\{layer\}`\)/, 'pill 点击必须开/关本层')
  // 本层有词 → pill 高亮（演示 .lpill.has accent 口径）。
  assert.match(card, /const has = layerDims\(layer\)\.some\(d => \(audio\.sel\[d\.k\] \?\? \[\]\)\.length > 0\)/, 'has 必须由本层各维选中数推导')
  assert.match(card, /\(has \? ' csAudioLayerPillHas' : ''\)/, 'has 必须落到 pill 类名')
  // 面板四路全接：选词 / 滑杆 / 清空 / 关闭。
  assert.match(card, /<VoiceLayerPop/, '必须渲染 VoiceLayerPop')
  assert.match(card, /onChoose=\{chooseAudioWord\}/, '面板选词必须接 chooseAudioWord')
  assert.match(card, /onSlide=\{setAudioSlide\}/, '面板滑杆必须接 setAudioSlide')
  assert.match(card, /onClear=\{\(\) => \{ clearAudioLayer\(layer\) \}\}/, '面板清空必须接本层清空')
  assert.match(card, /onClose=\{\(\) => \{ setOpenPop\(null\) \}\}/, '面板关闭必须收 openPop')
  // 组件结构：dialog 语义 + 三控件（slide/seg/grid）+ 满额禁用 + 计数 + 星标语义。
  assert.match(pop, /role="dialog"/, '面板必须是 dialog')
  assert.match(pop, /dim\.brand === 'slide'/, '必须渲染滑杆')
  assert.match(pop, /dim\.brand === 'seg'/, '必须渲染单选段')
  assert.match(pop, /dim\.mode === 'many'/, 'grid 必须判 many 上限')
  assert.match(pop, /已达上限 \$\{dim\.max \?\? 3\} 个，先取消一个/, '满额禁用必须带 title')
  assert.match(pop, /已选 \{?\(sel\[d\.k\] \?\? \[\]\)\.length\}? \/ \{?d\.max \?\? 3/, 'many 必须计数')
  assert.match(pop, /最常漏写的一维/, '星标语义必须在 <title>')
})

test('REQ-032 Step 2 选词语义：再点取消 / many 上限拒绝 + toast / one·seg 替换 / 互斥组', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  // 语义集中在 chooseAudioWord，控件只报事件。
  assert.match(card, /const chooseAudioWord = \(dimKey: string, word: string\): void =>/, '必须有选词口')
  // 再点取消。
  assert.match(card, /if \(cur\.includes\(word\)\) \{\n\s*next = cur\.filter\(item => item !== word\)/, '已选必须可取消')
  // many 满额 → 拒绝 + toast（不静默丢弃）。
  assert.match(card, /onToast\?\.\(`「\$\{dim\.n\}」最多选 \$\{max\} 个 —— 再多关键词之间会互相干扰`\)/, '满额必须 toast')
  assert.match(card, /if \(cur\.length >= max\) \{/, '满额必须先判再写')
  // one / seg = 替换（先清再放一个）。
  assert.match(card, /else \{\n\s*next = \[word\]\n\s*\}/, 'one/seg 必须替换而非追加')
  // 层空删键（与 removeAudioTok 同口径）。
  assert.match(card, /if \(next\.length > 0\) sel\[dimKey\] = next\n\s*else delete sel\[dimKey\]/, '层空必须删键')
  // 互斥组 lang ↔ dialect：选中一个必清同组另一个。
  assert.match(card, /if \(next\.length > 0 && dim\.excl !== undefined\) \{/, '互斥组必须只在真选中时清')
  assert.match(card, /if \(other\.k !== dimKey && other\.excl === dim\.excl\) delete sel\[other\.k\]/, '同组另一维必须删')
  // 上限与互斥是词库事实（voice-dims 深比对已锁词库本身，这里只确认口径引用）。
  assert.match(card, /const max = dim\.mode === 'many' \? \(dim\.max \?\? 3\) : 1/, '上限必须读 DIMS.max')
})

test('REQ-032 Step 2 滑杆与清空：写档位词不写数字 / 回拖删键 / 清空只动本层', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  const pop = await read('src/client/canvas/VoiceLayerPop.tsx')
  // 滑杆写档位词（永不写数字下标）。
  assert.match(card, /const setAudioSlide = \(dimKey: string, stop: string \| null\): void =>/, '必须有滑杆口')
  assert.match(card, /if \(stop === null\) delete sel\[dimKey\]\n\s*else sel\[dimKey\] = \[stop\]/, '滑杆必须写档位词')
  // 未设定显示默认中档 + 头部「未设定」。
  assert.match(pop, /idx < 0 \? '未设定' : cur\[0\]/, '未设定必须显示中档占位')
  assert.match(pop, /const mid = Math\.floor\(max \/ 2\)/, '默认必须落在中档')
  assert.match(pop, /const shown = idx < 0 \? mid : idx/, 'range 值必须默认中档')
  // 清空本层：只删本层键，不动自由段 / 正文 / 其他层。
  assert.match(card, /const clearAudioLayer = \(layer: AudioLayer\): void =>/, '必须有本层清空口')
  assert.match(card, /for \(const d of layerDims\(layer\)\) \{/, '清空必须只遍历本层维度')
  assert.match(card, /if \(!touched\) return/, '本层无词必须跳过写回（不留空撤销快照）')
  // 控件三种 brand 全渲染（seg / grid / slide）。
  assert.match(pop, /dim\.brand === 'slide'/, '必须渲染滑杆')
  assert.match(pop, /dim\.brand === 'seg'/, '必须渲染单选段')
  assert.match(pop, /className=\{cur\.includes\(word\) \? 'csAudioPanelSegB on' : 'csAudioPanelSegB'\}/, 'seg 选中态')
  assert.match(pop, /className=\{on \? 'csAudioPanelW on' : 'csAudioPanelW'\}/, 'grid 选中态')
  assert.match(pop, /disabled=\{full && !on\}/, 'grid 满额必须禁用未选中项')
  assert.match(pop, /title=\{full \&\& !on \? `已达上限 \$\{dim\.max \?\? 3\} 个，先取消一个` : undefined\}/, '满额禁用必须带 title')
  assert.match(pop, /\{many && <span className="csAudioPanelCnt">已选/, 'many 必须计数')
  assert.match(pop, /d\.star === true \&\& STAR_ICON/, '星标必须渲染且含义在 <title>')
  assert.match(pop, /<title>最常漏写的一维<\/title>/, '星标语义必须在 <title>')
})

test('REQ-032 Step 2 面板样式：层色落位 + 无反引号/无新插值/无新 keyframes/禁用白字面量', async () => {
  const styles = await read('src/client/styles.ts')
  // 关键类存在。
  for (const cls of [
    'csAudioLayerPop', 'csAudioPanelHd', 'csAudioPanelDot', 'csAudioPanelHt', 'csAudioPanelClr',
    'csAudioPanelClose', 'csAudioPanelBody', 'csAudioPanelH4', 'csAudioPanelStar', 'csAudioPanelCnt',
    'csAudioPanelDv', 'csAudioPanelGrid', 'csAudioPanelW', 'csAudioPanelSeg', 'csAudioPanelSegB',
    'csAudioPanelBlk', 'csAudioPanelSlide', 'csAudioPanelTicks', 'csAudioLayerPillHas',
  ]) {
    assert.ok(
      styles.includes(`.${cls} `) || styles.includes(`.${cls}{`) || styles.includes(`.${cls}\n`)
      || styles.includes(`.${cls} {`) || styles.includes(`.${cls}::`) || styles.includes(`.${cls}.`)
      || styles.includes(`.${cls}:`) || styles.includes(`.${cls},`) || styles.includes(`.${cls})`),
      `样式必须含 .${cls}`,
    )
  }
  // 层色（演示 --lay1..4：L1 indigo / L2 green / L3 sky / L4 accent）。
  assert.match(styles, /\.csAudioLayerPillHas \{[\s\S]*?color: #ffd3a6/, '已选 pill 必须 accent 文字')
  assert.match(styles, /background: rgba\(255, 176, 102, \.13\)/, '已选 pill 必须 accent 底')
  // 定位与尺寸 = 演示 .pop-layer。
  assert.match(styles, /\.csAudioLayerPop \{[\s\S]*?bottom: calc\(100% \+ 11px\)[\s\S]*?width: 432px/, '面板必须贴 pill 上方 + 432px')
  assert.match(styles, /\.csAudioPanelBody \{[\s\S]*?max-height: min\(62vh, 452px\)/, '主体必须 62vh 上限')
  // 材料纪律：只查 Step 2 面板块本身（到模板字面量闭合反引号之前），
  // 不许新增 @keyframes、不许白字面量 rgba（CV-261，走 color-mix）、不许反引号、不许新插值。
  const step2Start = styles.indexOf('REQ-032 / CV-287 Step 2')
  const templateClose = styles.indexOf('\n`', step2Start)
  const panelBlock = styles.slice(step2Start, templateClose > 0 ? templateClose : styles.length)
  assert.ok(panelBlock.length > 0, '必须定位到 Step 2 面板样式块')
  assert.equal(/@keyframes/.test(panelBlock), false, 'Step 2 面板块不许新增 @keyframes')
  assert.equal(/rgba\(255, 255, 255/.test(panelBlock), false, 'Step 2 面板块不许白字面量 rgba（CV-261，走 color-mix）')
  assert.equal(panelBlock.includes('`'), false, 'Step 2 面板块不许反引号')
  // ${} 插值仍只有既有三个（CHROME_CARD_WIDTH / NODE_FOOT_HEIGHT / NODE_HEAD_HEIGHT）。
  const interpolations = panelBlock.match(/\$\{[^}]*\}/g) ?? []
  assert.deepEqual(
    [...new Set(interpolations)].sort(),
    [],
    'Step 2 面板块不许新增 ${} 插值（守卫要求纯 hex 字面量）',
  )
})
