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
  assert.match(card, /onUploadMedia\?\(file: File\): Promise<\{ url: string; assetFile: string \}>/, '卡片必须暴露 onUploadMedia')
  assert.match(surface, /onUploadMedia\?\(file: File\): Promise<\{ url: string; assetFile: string \}>/, '画布层必须透传 onUploadMedia')
  assert.match(frame, /uploadStudioMedia\(projectId, file\)/, 'frame 必须接 uploadStudioMedia 作上传通道')
  // 写回 refaudio = local:<assetFile>（整体重建路径，不 spread 旧键）。
  assert.match(card, /toLocalRef\(assetFile\)/, '选中必须写 local: 前缀形态')
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
