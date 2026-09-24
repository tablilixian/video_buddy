/**
 * 视频上传改造（2026-09-22）接线守卫。
 *
 * 改造前：上传 = 抽帧 + 风格归纳一次做完，画布当场被灌一批帧图，而**视频本身不落节点**
 * ⇒ 既不能播放，也当不了参考视频（CV-226 已接通 `video1..3`）。
 * 改造后：上传只落**一个视频节点**；抽帧与归纳改为画布右键「拆分视频」按需触发。
 *
 * 这里钉的是**接线**（谁调谁），不是行为 —— 行为在 `video-style.test.mjs`：
 * - 上传路径**不得**出现抽帧（否则改造白做）；
 * - 拆分必须走独立路由，且**不动原视频**（它是画布节点资产）；
 * - 菜单入口判据用 `toolName`，与布局的「上传素材按来源分栏」同源；
 * - 帧图血缘指向源视频节点（不然画布上看不出这组帧的出处）。
 *
 * ⚠️ 本文件用「读源码 + 剥注释」的方式断言（与 canvas-arrange.test.mjs 同一手法）。
 *    写产品注释时**不要写出块注释起始序列**，否则会把后面整段代码连带剥掉 ——
 *    这个坑在 CV-225 的上传音频守卫里踩过一次。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const readSource = (relative) => readFileSync(join(here, relative), 'utf8')
/** 只剥块注释与整行注释，不做行内剥除（`https://` 的 `//` 会长在行中间）。 */
const codeOnly = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

const ROUTES = codeOnly(readSource('../src/routes.ts'))
const VIDEO_STYLE = codeOnly(readSource('../src/video-style.ts'))
const FRAME = codeOnly(readSource('../src/client/StudioFrame.tsx'))
const STORE = codeOnly(readSource('../src/client/project-store.ts'))
const MENU = codeOnly(readSource('../src/client/canvas/CanvasContextMenu.tsx'))
const INDEX = codeOnly(readSource('../src/client/index.ts'))
const UPLOAD_BAR = codeOnly(readSource('../src/client/VideoUploadBar.tsx'))

test('上传只落视频节点：路由与 handler 都不再抽帧', () => {
  // 两条路由在源码里**相邻**，故按切片分段断言，不用「距离窗口」正则 ——
  // 窗口一放宽，upload 段会把 split 路由一起圈进来，负向断言当场失效。
  const uploadRoute = ROUTES.slice(
    ROUTES.indexOf('path: ROUTE_UPLOAD_VIDEO'),
    ROUTES.indexOf('path: ROUTE_SPLIT_VIDEO'),
  )
  const splitRoute = ROUTES.slice(ROUTES.indexOf('path: ROUTE_SPLIT_VIDEO'))
  assert.ok(uploadRoute.length > 0, '上传路由必须存在')
  assert.ok(splitRoute.length > 0, '拆分路由必须存在')
  // ① 各走各的入口
  assert.match(uploadRoute, /importVideoAsset\(/, '上传路由必须调 importVideoAsset')
  assert.doesNotMatch(uploadRoute, /splitVideoAsset\(/, '上传路由不得抽帧 —— 抽帧挪到了拆分路由')
  assert.doesNotMatch(uploadRoute, /frames:/, '上传响应不得带帧列表')
  assert.match(splitRoute, /splitVideoAsset\(/, '拆分路由必须调 splitVideoAsset')
  // ② Host 侧上传函数自身不含抽帧计划
  assert.doesNotMatch(VIDEO_STYLE, /export async function importVideoAsset[\s\S]{0,2000}?planFrameTimes\(/,
    'importVideoAsset 不得调用 planFrameTimes（抽帧只属于拆分）')
  // ③ 客户端：上传落 addVideoNode，不再落 addVideoStyleNodes
  assert.match(FRAME, /const handleUploadVideo[\s\S]{0,900}?actions\.addVideoNode\(/,
    'handleUploadVideo 必须落视频节点')
  assert.doesNotMatch(FRAME, /const handleUploadVideo[\s\S]{0,900}?addVideoStyleNodes\(/,
    'handleUploadVideo 不得再落帧图与便签')
  // ④ 视频节点的形态：kind=video + toolName=upload_video + origin=manual
  //    （toolName 让布局的 switch 直接归创意栏，origin 是「按来源分栏」的另一半）
  assert.match(STORE, /addVideoNode: \(draft, projectId, asset\) => \{[\s\S]{0,1000}?kind: 'video'/,
    '落卡必须是 video 节点')
  assert.match(STORE, /addVideoNode: \(draft, projectId, asset\) => \{[\s\S]{0,1400}?toolName: 'upload_video'/,
    'toolName 必须是 upload_video（布局按它归创意栏）')
  assert.match(STORE, /addVideoNode: \(draft, projectId, asset\) => \{[\s\S]{0,1400}?origin: 'manual'/,
    "origin: 'manual' 是「上传素材按来源分栏」的判据")
})

test('拆分视频：独立路由 + 菜单入口（判据用 toolName）', () => {
  assert.match(ROUTES, /ROUTE_SPLIT_VIDEO = '\/canvas-studio\/split-video'/,
    '拆分必须有独立路由常量')
  // 菜单只对**上传的视频**开放：判据用 toolName（与布局同源），不用 origin
  assert.match(MENU, /node\.kind === 'video' && node\.toolName === 'upload_video'/,
    '拆分入口的判据必须是 kind=video && toolName=upload_video')
  assert.match(MENU, /onSplitVideo\(node\.id\)/, '菜单项必须接到 onSplitVideo')
  // 客户端 handler：走 splitStudioVideo，并把源视频节点 id 传给落卡（血缘用）
  assert.match(FRAME, /const handleSplitVideo[\s\S]{0,1300}?splitStudioVideo\(/,
    'handleSplitVideo 必须调 splitStudioVideo')
  assert.match(FRAME, /sourceVideoId: nodeId/, '必须把源视频节点 id 传下去（帧图血缘用）')
})

test('拆分不动原视频：失败清理只覆盖本次新抽的帧', () => {
  // 旧实现里输入视频是**本次上传**的，故 writtenFiles 从 [videoFile] 起、失败时连它一起清。
  // 改造后输入视频属于画布节点 —— 沿用旧清理会把用户素材删掉，所以初始必须是空数组。
  assert.match(VIDEO_STYLE, /const writtenFiles: string\[\] = \[\]/,
    '清理列表必须从空开始（不得含输入视频）')
  assert.doesNotMatch(VIDEO_STYLE, /writtenFiles: string\[\] = \[videoFile\]/,
    '不得沿用「连输入视频一起清」的旧行为')
  // 只接受本项目画布资产：既挡路径穿越，也防止拆到别的项目的资产
  assert.match(VIDEO_STYLE, /assetKeyFromUrl\(videoUrl\)/,
    '拆分必须用 assetKeyFromUrl 解析并校验资产归属')
  assert.match(VIDEO_STYLE, /不是本项目的画布资产/, '非本项目资产必须明确报错')
  // 帧图血缘指向源视频（空数组 = 画布上看不出这组帧从哪来）
  assert.match(STORE, /sourceIds: payload\.sourceVideoId !== undefined \? \[payload\.sourceVideoId\] : \[\]/,
    '帧图血缘必须指向源视频节点')
})

test('四类拖放：捕获阶段接管非 image，宿主不再收到「仅支持图片」', () => {
  // 宿主的附件拖放挂在 **document、冒泡阶段、不分落点**（ui-attachment 的
  // ComposerAttachments）⇒ 拖视频/音频/文本到任意位置都会撞它的图片校验。只有下在捕获阶段
  // 才能先手截断。三个事件都要，少一个就漏：dragenter/dragover 决定它那张「松手
  // 添加图片」遮罩弹不弹，drop 决定它收不收到文件。
  for (const type of ['dragenter', 'dragover', 'drop']) {
    assert.match(FRAME, new RegExp(`document\\.addEventListener\\('${type}', [A-Za-z]+, true\\)`),
      `${type} 必须在捕获阶段监听（第三个参数 true）—— 否则宿主照样处理这批文件`)
  }

  // 编译后的副作用域：从判据函数切到 effect 的依赖数组，再按两个 handler 分成两段 ——
  // 合成一段断言「有个 stopPropagation 就行」会漏掉「只删掉其中一个」这种退化。
  const start = FRAME.indexOf('const declaresOwnedMedia =')
  const end = FRAME.indexOf('}, [projectId])', start)
  assert.ok(start > 0 && end > start, '找不到捕获阶段接管块（结构变了就更新本守卫）')
  const capture = FRAME.slice(start, end)
  const swallowAt = capture.indexOf('const swallow =')
  const dropAt = capture.indexOf('const onDrop =')
  assert.ok(swallowAt > 0 && dropAt > swallowAt, '接管块里应有 swallow 与 onDrop 两个 handler')
  const swallow = capture.slice(swallowAt, dropAt)
  const captureDrop = capture.slice(dropAt)

  // CV-241：判据从「只有 video MIME」扩到「非 image MIME（含空 MIME）」——
  // 拖放分类在 drop 用 classifyFile(file.name)，dragenter/dragover 只能看 items.type。
  assert.match(capture, /!item\.type\.startsWith\('image\/'\)/,
    'dragenter/dragover 判据：非 image MIME（含空 MIME）才接管')
  assert.match(swallow, /event\.stopPropagation\(\)/,
    'dragenter/dragover 不截断 ⇒ 宿主那张「松手添加图片」遮罩照弹（措辞对非图片是错的）')
  assert.match(swallow, /declaresOwnedMedia\(event\.dataTransfer\)/,
    'swallow 必须复用同一个声明类型判据（不得另写一份）')
  assert.match(captureDrop, /event\.stopPropagation\(\)/,
    'drop 不截断 ⇒ 宿主照样把文件塞进图片附件校验、弹「仅支持 PNG、JPG、WebP、GIF」')
  assert.match(captureDrop, /classifyFile\(file\.name\) !== 'image'/,
    'drop 判据：按扩展名分类，非 image（含未知）才接管')
  assert.match(captureDrop, /droppedFilesRef\.current\(files\)/,
    '接管后必须走统一分发 handleDroppedFiles')
  // 图片必须留给宿主（对话附件）与画布原有 drop 路径 —— 由「非 image」判据保证，
  // 不得再出现「只拦 video」的旧 MIME 判定。
  assert.doesNotMatch(captureDrop, /file\.type\.startsWith\('video\/'\)/,
    '不得只拦 video —— 已扩到四类（video/image/audio/text）')
})

test('视频拖放：分发规则只一份，画布 drop 截断冒泡', () => {
  // 两处入口（画布区 drop / 全局视频接管）必须共用同一个「取哪个文件」的实现，
  // 各写一套迟早分叉。
  const definitions = FRAME.match(/const handleDroppedFiles =/g) ?? []
  assert.equal(definitions.length, 1, '「拖入文件取哪个」的分发只准一份实现')
  assert.match(FRAME, /droppedFilesRef\.current\(files\)/,
    'effect 必须经 ref 调分发（否则每次渲染都要重挂 document 监听）')

  const canvasStart = FRAME.indexOf('className="csCanvas"')
  assert.ok(canvasStart > 0, '找不到画布容器')
  const canvasDrop = FRAME.slice(canvasStart, canvasStart + 900)
  assert.match(canvasDrop, /event\.stopPropagation\(\)/,
    '画布 drop 必须截断冒泡 —— 否则同一批文件还会被宿主按「对话图片附件」再处理一次')
  assert.match(canvasDrop, /handleDroppedFiles\(Array\.from\(event\.dataTransfer\.files\)\)/,
    '画布 drop 必须走统一分发')
  assert.doesNotMatch(canvasDrop, /find\(item => item\.type\.startsWith\('video\/'\)\)/,
    '画布 drop 不得自己再挑一次视频 —— 那是第二份分发规则')
})

test('上传反馈：输入框上方的首帧卡片（槽接线 + 单一数据源 + 不抽帧）', () => {
  // 槽选错的表现就是「拖完视频什么也看不到」：宿主对 `composer.dock` 的渲染带
  // `!hero`，而用户拖视频时正是首屏（hero）态 —— 必须挂 `input.dock`。
  assert.match(INDEX, /slots\.inject\(\s*'conversation\.input\.dock'/,
    '必须注册 conversation.input.dock（composer.dock 在 hero 态不渲染）')
  assert.match(INDEX, /id: 'canvas-studio-video-upload'/, 'list 槽必须带 id（缺了运行时会抛）')
  assert.match(INDEX, /VideoUploadBar/, '注册的组件必须是 VideoUploadBar')

  // 单一数据源：卡片读的是 StudioFrame 同一个 store 的 videoUploads。
  assert.match(UPLOAD_BAR, /store\.videoUploads\[store\.selectedProjectId\]/,
    '卡片必须读 store.videoUploads（不得引第二份状态）')
  // 三段状态缺一不可 —— 少任何一段，卡片会永远停在「上传中」。
  for (const action of ['beginVideoUpload', 'settleVideoUpload', 'failVideoUpload']) {
    assert.match(FRAME, new RegExp(`actions\\.${action}\\(`), `StudioFrame 必须调 ${action}`)
  }
  // 首帧交给 `<video preload="metadata">` 由浏览器画：**不许引入抽帧 / 解码** ——
  // 那会把 ffmpeg 或 canvas 解码重新拉回上传的关键路径（本轮刚从那里拿掉）。
  assert.match(UPLOAD_BAR, /<video[^>]*preload="metadata"/, '首帧应由 <video preload="metadata"> 画')
  assert.doesNotMatch(UPLOAD_BAR, /ffmpeg|drawImage|toBlob/, '卡片不得抽帧 / 解码')
})

test('视频上传卡片：状态只改读数色、不改盒子（否则切状态时行高会跳）', () => {
  // 三种状态（上传中 / 已就绪 / 失败）共用同一套盒子，只有读数颜色不同 —— 这是
  // styles.ts 里明写的承诺。改坏的表现很隐蔽：状态一换卡片高度变几像素，整条
  // dock 跟着抖一下，而截图看不出来。
  const styles = readSource('../src/client/styles.ts')
  for (const state of ['is-ready', 'is-failed']) {
    const rule = new RegExp(`\\.csUploadChip\\.${state} \\.csUploadChipMeta\\s*\\{([^}]*)\\}`).exec(styles)
    assert.ok(rule !== null, `.csUploadChip.${state} .csUploadChipMeta 规则必须存在`)
    assert.match(rule[1].replace(/\s+/gu, ''), /^color:/,
      `${state} 只允许声明 color —— 加任何尺寸属性都会让状态切换时行高跳`)
  }
})
