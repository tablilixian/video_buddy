/**
 * REQ-032（CV-287 Step 1）音频词库与纯函数守卫。
 *
 * 口径（方案 §三 + 交接「词库逐字转录」）：
 *   - DIMS / FNS / LAYERS / LAYER_ORDER 从演示稿 canvas-audionode-inputbox.html
 *     （存档件，不许改）用 new Function 拆出来与 lib/voice-dims.js 深比对 ——
 *     词库若要改，必须两边同批，否则守卫当场拦下；
 *   - estSeconds / creditCost / bodyCharCount 与后端真值对拍（探针 139 净字 →
 *     27.55s，误差 <1%）；
 *   - composeSpeechInstruct 层间「；」层内「，」口径与演示 captionText 一致。
 *
 * 运行：corepack yarn test:smoke（真值部分需要 build 后的 lib/ 产物）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  AUDIO_FNS, DIMS, LAYERS, LAYER_ORDER, LOCAL_REF_PREFIX,
  audioFnName, audioFnToolName, assetFileFromUrl, bodyCharCount, composeItems, composeSpeechInstruct,
  creditCostOf, dimOf, estSecondsOf, isLocalRef, layerDims, stripLocalRef, stripWs, toLocalRef,
} from '../lib/voice-dims.js'

const read = async (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8')

/** 从演示稿 JS 里抠出 `var NAME = <字面量>;` 并求值（纯字面量，无依赖）。 */
const demoLiteral = (html, name) => {
  const start = html.indexOf(`var ${name} = `)
  assert.notEqual(start, -1, `演示稿必须含 var ${name}`)
  const from = start + `var ${name} = `.length
  // 数组字面量以 "];" 收尾、对象以 "};\" 收尾；+1 只取到括号本身（分号留在括号外）。
  const isArray = name === 'DIMS' || name === 'FNS' || name === 'LAYER_ORDER'
  const close = isArray ? html.indexOf('];', from) : html.indexOf('};', from)
  assert.notEqual(close, -1, `演示稿 var ${name} 必须有收尾`)
  return new Function(`return (${html.slice(from, close + 1)})`)()
}

test('REQ-032 词库：DIMS / FNS / LAYERS / LAYER_ORDER 与演示稿逐字一致', async () => {
  const html = await read('docs/assets/library-2026-10-08/canvas-audionode-inputbox.html')
  assert.deepEqual(AUDIO_FNS, demoLiteral(html, 'FNS'), 'fn 三项必须与演示 FNS 逐字一致')
  assert.deepEqual(LAYERS, demoLiteral(html, 'LAYERS'), '四层名必须与演示 LAYERS 逐字一致')
  assert.deepEqual(LAYER_ORDER, demoLiteral(html, 'LAYER_ORDER'), '层序必须与演示 LAYER_ORDER 一致')
  assert.deepEqual(DIMS, demoLiteral(html, 'DIMS'), '18 维词库必须与演示 DIMS 逐字一致（含声明序）')
  assert.equal(DIMS.length, 18, '词库必须 18 维')
})

test('REQ-032 fn：展示名兜底 + 工具名映射（music 独立、其余共用 TTS）', () => {
  assert.equal(audioFnName('voice'), '语音生成')
  assert.equal(audioFnName('design'), '音色设计')
  assert.equal(audioFnName('music'), '音乐生成')
  assert.equal(audioFnName('不存在的fn'), '语音生成', '未知 fn 必须兜底语音生成')
  assert.equal(audioFnToolName('music'), 'music_generation')
  assert.equal(audioFnToolName('voice'), 'tts_voiceover')
  assert.equal(audioFnToolName('design'), 'tts_voiceover')
})

test('REQ-032 层维度查询：dimOf / layerDims（lang-dialect 互斥组保留 excl）', () => {
  assert.equal(dimOf('gender')?.n, '性别')
  assert.equal(dimOf('不存在'), null)
  assert.equal(layerDims('L1').length, 4, '身份层 4 维')
  assert.equal(layerDims('L3').length, 7, '声学层 7 维')
  assert.equal(layerDims('L4').length, 5, '情境层 5 维')
  assert.equal(layerDims('L2').length, 2, '语言层 2 维')
  assert.equal(dimOf('lang')?.excl, 'tongue')
  assert.equal(dimOf('dialect')?.excl, 'tongue')
})

test('REQ-032 组合序：chips 按 LAYER_ORDER 遍历、自由段永远垫底', () => {
  const items = composeItems({ emotion: ['温柔'], gender: ['女声'] }, '夜色般低沉')
  assert.deepEqual(
    items.map(item => [item.t, item.dim ?? null, item.w ?? item.s]),
    [['tok', 'gender', '女声'], ['tok', 'emotion', '温柔'], ['free', null, '夜色般低沉']],
    '必须 身份层 → 情境层 → 自由段（与点击顺序无关）',
  )
  assert.deepEqual(composeItems({}, ''), [], '空态必须空列表')
})

test('REQ-032 描述串：层间「；」、层内「；」、自由段前导标点不补、末尾 strip 不含「。」', () => {
  assert.equal(
    composeSpeechInstruct({ gender: ['女声'], emotion: ['温柔'] }, '带着笑意'),
    '女声；温柔，带着笑意',
    '跨层必须「；」，层内/自由段「，」',
  )
  assert.equal(
    composeSpeechInstruct({ gender: ['女声', '青年男性'] }, ''),
    '女声，青年男性',
    '同层多词必须「，」连接',
  )
  // 自由段前导已是「。」（句号自带断句），就不再补分隔符 —— 演示 captionText :1228
  // 「两端已有标点则不重复补」的口径，「。」在两端判定集合内。
  assert.equal(
    composeSpeechInstruct({ gender: ['女声'] }, '。已是句号结尾'),
    '女声。已是句号结尾',
    '自由段前导已有句号则不重复补分隔符',
  )
  assert.equal(composeSpeechInstruct({}, '只写自由段'), '只写自由段')
  assert.equal(composeSpeechInstruct({ gender: ['女声'] }, ''), '女声', '无自由段时尾部不带分隔符')
})

test('REQ-032 净字口径：stripWs 全去空白；bodyCharCount 返回去空白去标点后的净字数', () => {
  assert.equal(stripWs('a b\n c'), 'abc')
  // bodyCharCount 回的是**个数**不是串：剥掉空白与标点后数 CJK/字母/数字。
  assert.equal(bodyCharCount('你好，world 123！'), 10, '你好(2)+world(5)+123(3)=10 净字')
  assert.equal(bodyCharCount('……，。！？；：'), 0, '纯标点必须 0 净字')
  assert.equal(bodyCharCount(''), 0)
  assert.equal(bodyCharCount('   \n\t'), 0, '纯空白必须 0 净字')
})

test('REQ-032 时长/积分：与后端真值对拍（139 净字 → 28s / 10 分）', () => {
  assert.equal(estSecondsOf(0), 0, '没写正文不估时长')
  assert.equal(creditCostOf(0), 0, '没写正文不消耗')
  assert.equal(estSecondsOf(139), 28, '探针真值：139 净字 → round(139/5)=28s（后端 27.55s，误差 <1%）')
  assert.equal(creditCostOf(139), 9, '2 + ceil(139/20)=2+7=9 分')
  assert.equal(estSecondsOf(1), 1, '有正文至少 1 秒')
  assert.equal(creditCostOf(20), 3, '恰好 20 字 = 2 + 1')
  assert.equal(creditCostOf(21), 4, '21 字进位 = 2 + 2')
})

// ==================== REQ-032 / CV-287 Step 3：参考音色 `local:` 约定 ====================

test('REQ-032 Step 3 local: 约定：三来源归一 assetFile，host 剥前缀换句柄', () => {
  assert.equal(LOCAL_REF_PREFIX, 'local:', '前缀形态必须是 local:')
  assert.equal(toLocalRef('voice.wav'), 'local:voice.wav')
  assert.equal(isLocalRef('local:voice.wav'), true)
  assert.equal(isLocalRef(null), false, 'null 不是 local:')
  assert.equal(isLocalRef('agent-handle-abc'), false, '非前缀（agent 直传句柄）不是 local:')
  // 剥前缀：仅剥 local:，非前缀原样透传（agent 路径零改动）。
  assert.equal(stripLocalRef('local:voice.wav'), 'voice.wav')
  assert.equal(stripLocalRef('agent-handle-abc'), 'agent-handle-abc', '非前缀必须原样透传')
  // URL → assetFile（画布 node.url basename）：剥 query/hash 与路径段。
  assert.equal(assetFileFromUrl('/canvas-studio/assets/p1/voice%20take.mp3'), 'voice take.mp3', 'URL 段必须 decode')
  assert.equal(assetFileFromUrl('/a/b/c.wav?sig=xyz#frag'), 'c.wav', '必须剥掉 query 与 hash')
  assert.equal(assetFileFromUrl('plain.m4a'), 'plain.m4a')
})

// ==================== REQ-032 / CV-287 Step 3：参考音色接线 / 时长承诺 ====================

test('REQ-032 Step 3 接线：ref-slot 仅 voice 渲染 + 三来源 + 单选 0/1', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  const frame = await read('src/client/StudioFrame.tsx')
  const surface = await read('src/client/canvas/CanvasSurface.tsx')
  // 仅 voice 模式渲染（design/music 隐藏槽，状态保留、发送不带）。
  assert.match(card, /const refSlotVisible = isAudio && audio\.fn === 'voice'/, 'ref-slot 必须仅 voice 可见')
  assert.match(card, /\{refSlotVisible && \(/, 'ref-slot 必须按 refSlotVisible 渲染')
  // 候选池：画布 kind==='audio' + 资产库「音色」分类（音频媒体）。
  assert.match(card, /candidate\.kind === 'audio'/, '画布候选必须收音频节点')
  assert.match(card, /entry\.kind === 'audio'/, '资产库候选必须收音频媒体')
  // 单选 0/1：再点已选 = 取消（pickAudioRef 里 audio.ref === next ? null : next）。
  assert.match(card, /audio\.ref === next \? null : next/, '参考音色必须单选 0/1（再点取消）')
  // 清除 toast（演示 refX :2177）。
  assert.match(card, /已清除参考音色/, '清除必须 toast')
  // 三来源内联菜单（本地上传 / 选择资产 / 画布导入）+ 空态文案。
  assert.match(card, /本地上传/, '必须有本地上传入口')
  assert.match(card, /选择资产/, '必须有选择资产入口')
  assert.match(card, /画布导入/, '必须有画布导入入口')
  assert.match(card, /该分类下暂无可用音频/, '候选池空态必须落演示文案')
  assert.match(card, /支持 MP3 \/ WAV，单个 ≤ 50MB/, '菜单 hint 必须落演示文案')
  // 本地上传走 host 通道（B1：accept audio/*，不建节点）。
  assert.match(card, /input\.accept = 'audio\/\*'/, '本地上传必须 accept audio/*')
  assert.match(card, /onUploadMedia\?\(file: File\): Promise<\{ url: string; assetFile: string \} \| null>/, '卡片必须暴露 onUploadMedia（无项目返 null，不裸抛）')
  assert.match(surface, /onUploadMedia\?\(file: File\): Promise<\{ url: string; assetFile: string \} \| null>/, '画布层必须透传 onUploadMedia（同 null 签名）')
  assert.match(frame, /uploadStudioMedia\(projectId, file\)/, 'frame 必须接 uploadStudioMedia 作上传通道')
  // 写回 refaudio = local:<assetFile>（整体重建路径，不 spread 旧键）。
  assert.match(card, /toLocalRef\(uploaded\.assetFile\)/, '选中必须写 local: 前缀形态')
})

test('REQ-032 Step 3 发送语义：仅 voice 带 refaudio + music 带 duration（D-MusicDur）', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  // music = duration 承诺（= estSeconds 估算变承诺，探针 4 证实精确生效）。
  assert.match(card, /\{ \.\.\.audio, duration: audioEst, ref: null \}/, 'music 发送必须写 duration=估算且清 ref')
  // design 隐藏槽：状态保留、发送不带 refaudio（第三分支落 ref: null）。
  assert.match(card, /: audio\.fn === 'voice'\s*\n\s*\? audio\s*\n\s*: \{ \.\.\.audio, ref: null \}/, 'design 发送必须清 ref（隐藏但保留状态，发送不带）')
  // voice 原样带 refaudio（含 local: 前缀，host 侧 Step 4 再 promote）。
  assert.match(card, /const next: AudioCardState = audio\.fn === 'music'/, '发送必须按 fn 三路分支')
  assert.match(card, /commitAudio\(next\)/, 'voice 发送必须原样带 refaudio')
  // 非 music 隐藏 duration（不写 duration 键 —— buildAudioPrompt 已有 fn 分支）。
  assert.match(card, /params\.duration = state\.duration/, 'duration 必须仅在 music 分支写回')
})

// ==================== REQ-032 / CV-287 Step 4：host 转真（local: promote + 副文案 + 标题） ====================

test('REQ-032 Step 4 host 侧 local: 剥前缀 + 陈旧句柄 500 中文归一', async () => {
  const { isLocalRefaudio, stripLocalRefaudio } = await import('../lib/generate.js')
  const source = await read('src/generate.ts')
  // 前缀判定：仅纯文件名（白名单字符集，防路径穿越）才算 local:。
  assert.equal(isLocalRefaudio('local:voice.wav'), true)
  assert.equal(isLocalRefaudio('local:a/b.wav'), false, '含路径分隔符必须拒（路径穿越）')
  assert.equal(isLocalRefaudio('local:..'), false)
  assert.equal(isLocalRefaudio('local:../x.wav'), false)
  assert.equal(isLocalRefaudio('agent-handle-abc'), false, '非前缀（agent 直传）不是 local:')
  // 剥前缀：仅剥 local:，非前缀原样透传（agent 路径零改动）。
  assert.equal(stripLocalRefaudio('local:voice.wav'), 'voice.wav')
  assert.equal(stripLocalRefaudio('agent-handle-abc'), 'agent-handle-abc', '非前缀必须原样透传')
  // generateSpeech 必须 promote：遇前缀 → promoteAssetFile 现换句柄。
  assert.match(source, /isLocalRefaudio\(refaudio\)/, 'generateSpeech 必须判 local: 前缀')
  assert.match(source, /promoteAssetFile\(registry, projectId, stripLocalRefaudio\(refaudio\), signal\)/, '必须剥前缀后 promoteAssetFile 现换句柄')
  // 陈旧句柄 500 → 中文归一（探针 2：坏句柄 0.06s 快失败）。
  assert.match(source, /参考音色失效，请重新选择/, '陈旧句柄错误必须归一为中文提示')
  assert.match(source, /function normalizeRefaudioError/, '必须有 refaudio 错误归一函数')
})

test('REQ-032 Step 4 music duration 接线 + TOOL_TITLES 补项 + progSub 三格式副文案', async () => {
  const source = await read('src/generate.ts')
  const node = await read('src/client/canvas/CanvasNode.tsx')
  // H4：generateMusic 必须消费 duration（D-MusicDur：= estSeconds 承诺）。
  assert.match(source, /caption_prompt: params\.captionPrompt,\s*\n\s*lyrics_prompt: effectiveLyrics,\s*\n\s*duration,/, 'generateMusic 请求体必须带 duration')
  assert.match(source, /const duration = params\.duration !== undefined \? Math\.max\(1, Math\.round\(params\.duration\)\) : DEFAULT_MUSIC_DURATION/, 'duration 必须取自参数（非写死默认）')
  // H8：TOOL_TITLES 补 music_generation（现缺，兜底「生成中…」）。
  assert.match(node, /music_generation: '生成音乐中…'/, 'TOOL_TITLES 必须补 music_generation')
  // F4：progSub 三格式副文案（读 generationPrompt，缺参回退）。
  assert.match(node, /含人声歌词.*纯音乐|纯音乐.*含人声歌词/, 'music 副文案必须区分含人声歌词/纯音乐')
  assert.match(node, /参考音色.*无参考音色|无参考音色.*参考音色/, 'voice 副文案必须区分参考音色有无')
  assert.match(node, /\$\{est\}s/, '副文案必须带时长估算')
  assert.match(node, /const audioProgSub = \(\(\) => \{/, 'audio 必须有独立 progSub 计算')
  assert.match(node, /audioProgSub !== null/, '副文案必须渲染到 overlay')
})

test('REQ-032 Step 5 audio 空态：麦克风图标 + 引导语，无产物未生成时渲染', async () => {
  const node = await read('src/client/canvas/CanvasNode.tsx')
  const styles = await read('src/client/styles.ts')
  // F1：空态结构 = 条件渲染 + 麦克风 SVG（演示 1:1）+ 引导语。
  assert.match(node, /node\.kind === 'audio' && node\.url === undefined && node\.isLoading !== true/, 'audio 空态必须仅无产物未生成时渲染')
  assert.match(node, /csNodeAudioEmpty/, '空态必须挂 csNodeAudioEmpty 类')
  assert.match(node, /设计音色，语音生成，音乐生成/, '空态引导语必须与演示一致')
  // 麦克风 SVG：矩形话筒头 + 底座 + 括号曲线（演示 em-i 1:1）。
  assert.match(node, /<rect x="17" y="6\.5" width="14" height="23" rx="7"/, '麦克风话筒头 SVG 必须存在')
  assert.match(node, /csNodeAudioEmptyIcon/, '图标必须挂 csNodeAudioEmptyIcon 类')
  // 样式：与 video 空态同构（绝对定位贴满帧内、图标色 #7dd3fc、引导语字号）。
  assert.match(styles, /\.csNodeAudioEmpty \{/, '必须有 csNodeAudioEmpty 样式')
  assert.match(styles, /\.csNodeAudioEmptyIcon \{ display: flex; color: #7dd3fc; \}/, '图标色必须为 audio accent #7dd3fc')
  assert.match(styles, /\.csNodeAudioEmptyText \{/, '必须有引导语样式')
})

test('REQ-032 Step 5 audio 字幕条：描述+正文合成一行，仅产物后显示', async () => {
  const node = await read('src/client/canvas/CanvasNode.tsx')
  const styles = await read('src/client/styles.ts')
  // F3：条件渲染 = 仅产物已落（node.url 有值）时显示。
  assert.match(node, /node\.kind === 'audio' && node\.url === undefined/, '字幕条必须仅产物已落时渲染')
  assert.match(node, /csNodeAudioCapstrip/, '字幕条必须挂 csNodeAudioCapstrip 类')
  // 拼装：voice/design = (描述) 正文；music = (描述) ♪ 含人声歌词（歌词开关开着时）。
  assert.match(node, /hasLyrics \? '♪ 含人声歌词' : null/, 'music 分支必须拼 ♪ 含人声歌词')
  assert.match(node, /fn === 'music' \? String\(params\.caption_prompt \?\? ''\) : String\(params\.instruct_prompt \?\? ''\)/, '描述源必须按 fn 分支（music=caption_prompt / 其余=instruct_prompt）')
  assert.match(node, /String\(params\.txt_prompt \?\? ''\)/, '正文源必须取 txt_prompt')
  // 样式：两行 clamp + 描述在等宽括号里（演示 .capstrip 1:1）。
  assert.match(styles, /\.csNodeAudioCapstrip \{/, '必须有 csNodeAudioCapstrip 样式')
  assert.match(styles, /\.csNodeAudioCapstripParen \{ color: #9ecbff; font-family: ui-monospace, Consolas, monospace; \}/, '括号必须等宽 #9ecbff')
  assert.match(styles, /-webkit-line-clamp: 2/, '字幕条必须两行 clamp')
})

test('REQ-032 Step 5 audio 工具栏：四项 + 入库扩 audio + 预览走播放浮层', async () => {
  const bar = await read('src/client/canvas/NodeActionBar.tsx')
  // F5：audio 进媒体工具栏组（isMedia 含 audio，退出重试/改提示词）。
  assert.match(bar, /const isAudio = node\.kind === 'audio'/, '必须判 isAudio')
  assert.match(bar, /const isMedia = isVideo \|\| isImage \|\| isAudio/, 'isMedia 必须含 audio')
  assert.match(bar, /const canRetry = !isMedia &&/, 'audio 必须退出重试按钮')
  assert.match(bar, /const canEdit = !isMedia &&/, 'audio 必须退出改提示词按钮')
  // 四项判据：引用（非 group）/ 入库（audio 扩入）/ 预览（audio→播放浮层）/ 下载（canDownloadNode 含 audio）。
  assert.match(bar, /const canAddToLibrary = \(isImage \|\| isAudio\)/, '入库必须扩到 audio')
  assert.match(bar, /\(\(isVideo \|\| isAudio\) && onOpenPlayback !== undefined\)/, '预览：audio 必须走 onOpenPlayback')
  assert.match(bar, /title=\{isImage \? '预览：打开大图预览' : '预览：打开播放浮层'\}/, '预览 title 必须按 isImage 分支')
  // 入库 title 按 audio 分支。
  assert.match(bar, /title=\{isAudio \? '把这段音频存入资产库' : '把当前画面存入资产库'\}/, '入库 title 必须按 audio 分支')
  // 下载判据：canDownloadNode 已含 audio（canvas-actions.ts）。
  const actions = await read('src/canvas-actions.ts')
  assert.match(actions, /if \(node\.kind !== 'image' && node\.kind !== 'video' && node\.kind !== 'audio'\) return false/, 'canDownloadNode 必须含 audio')
})

test('REQ-032 Step 5 资产库第五分类「音色」：契约 + 标签 + 颜色', async () => {
  const contract = await read('src/contracts/asset-library.ts')
  const lib = await read('src/client/AssetLibrary.tsx')
  // C1：LibCategory 加 voice（第五分类），LIB_CATEGORIES 稳定枚举序含 voice。
  assert.match(contract, /'character' \| 'scene' \| 'prop' \| 'group' \| 'voice'/, 'LibCategory 必须含 voice')
  assert.match(contract, /\['character', 'scene', 'prop', 'group', 'voice'\]/, 'LIB_CATEGORIES 必须含 voice 且排在末位')
  assert.match(contract, /voice: '音色'/, 'LIB_CATEGORY_LABELS 必须有 voice 中文标签')
  // AssetLibrary 的 Record<LibCategory,...> 必须补 voice 键（否则类型不完整）。
  assert.match(lib, /voice: '#7DD3FC'/, 'CATEGORY_COLORS 必须补 voice 键（audio accent #7dd3fc）')
})
