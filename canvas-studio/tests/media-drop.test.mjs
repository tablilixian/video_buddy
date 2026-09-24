/**
 * CV-241 Step 3：四类拖放分发 + capture 接管 + 文字落卡 + Q3 只读预览。
 *
 * 钉四件事（读源码 + 剥注释，与 video-upload-wiring 同一手法）：
 * 1. 分发唯一：`handleDroppedFiles` 用 `classifyFile`，未知给 reject toast，失败
 *    toast 带 `MEDIA_KIND_LABEL` 前缀；图片/音频切 `uploadStudioMedia`（无 base64）。
 * 2. capture：dragenter/dragover 判「非 image MIME」，drop 判「classifyFile !== image」；
 *    纯图片不拦。
 * 3. 文字落卡：`handleUploadText` → `addTextAssetNode`（kind text / origin manual /
 *    operationType import / 无 referenceRole）。
 * 4. Q3：带 url 的文字素材双击开详情、详情正文 readOnly。
 *
 * ⚠️ 产品注释不要写出块注释起始序列（会把后面整段代码连带剥掉）。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const readSource = (relative) => readFileSync(join(here, relative), 'utf8')
const codeOnly = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

const FRAME = codeOnly(readSource('../src/client/StudioFrame.tsx'))
const STORE = codeOnly(readSource('../src/client/project-store.ts'))
const API = codeOnly(readSource('../src/client/api.ts'))
// 路由的 DEPRECATED 标记是整行 // 注释，codeOnly 会剥掉，用原文断言
const ROUTES_RAW = readSource('../src/routes.ts')
const NODE = codeOnly(readSource('../src/client/canvas/CanvasNode.tsx'))
const DETAIL = codeOnly(readSource('../src/client/canvas/NodeDetailDrawer.tsx'))

test('CV-241 分发：classifyFile 唯一入口 + 未知 reject + 类型化失败 toast', () => {
  assert.equal(
    (FRAME.match(/const handleDroppedFiles =/g) ?? []).length,
    1,
    '拖放分发只准一份实现',
  )
  assert.match(FRAME, /classifyFile\(file\.name\)/, '必须用 classifyFile 分类')
  assert.match(FRAME, /不支持的文件类型：\$\{rejected\.join\('、'\)\}/,
    '未知扩展必须给用户可见的 reject toast（绝不静默）')
  assert.match(FRAME, /errorToastText\(cause, `\$\{MEDIA_KIND_LABEL\[kind\]\}上传失败`\)/,
    '失败 toast 前缀必须取 MEDIA_KIND_LABEL（不得写死「图片上传失败」）')
  // 四类各有一个 handler 出口
  for (const handler of ['handleUploadVideo', 'handleUploadImage', 'handleUploadAudio', 'handleUploadText']) {
    assert.ok(FRAME.includes(`${handler}(`), `分发必须调用 ${handler}`)
  }
  // 优先级：video > image > audio > text（混拖时先出视频卡）
  assert.match(FRAME, /video: 0, image: 1, audio: 2, text: 3/,
    '混拖优先级必须是 video > image > audio > text')
})

test('CV-241 图片/音频切 uploadStudioMedia：无 base64、无旧 /upload', () => {
  assert.match(FRAME, /await uploadStudioMedia\(projectId, file\)/,
    '图片与音频必须走 uploadStudioMedia（octet-stream）')
  assert.doesNotMatch(FRAME, /uploadLocalStudioImage\(/,
    '不得再调旧 base64 /upload（Step 3 起画布链路清零）')
  assert.doesNotMatch(FRAME, /bytesToBase64\(/,
    '不得再做 base64 编码（体积膨胀 + 同步慢）')
  // 图片仍探测尺寸供 import 节点 display
  assert.match(FRAME, /probeImageDisplay\(file\)/, '图片上传后仍要 probe 尺寸')
})

test('CV-241 capture：非 image 接管；drop 按扩展名；纯图片留给宿主', () => {
  assert.match(FRAME, /const declaresOwnedMedia =/,
    '接管判据函数应覆盖四类（declaresOwnedMedia）')
  assert.match(FRAME, /!item\.type\.startsWith\('image\/'\)/,
    'dragenter/dragover 判据：非 image MIME（含空 MIME）才拦')
  assert.match(FRAME, /classifyFile\(file\.name\) !== 'image'/,
    'drop 判据：按扩展名分类，非 image（含未知）才接管')
  assert.doesNotMatch(FRAME, /item\.type\.startsWith\('video\/'\)/,
    '不得只拦 video —— 已扩到四类')
  // 纯图片不进 capture drop 的接管分支（由 !== 'image' 保证）
  assert.match(FRAME, /if \(!files\.some\(file => classifyFile\(file\.name\) !== 'image'\)\) return/,
    '全部是 image 时必须 return（不截断、不分发）')
})

test('CV-241 文字落卡：handleUploadText → addTextAssetNode', () => {
  assert.match(FRAME, /const handleUploadText[\s\S]{0,900}?actions\.addTextAssetNode\(/,
    'handleUploadText 必须落 addTextAssetNode')
  assert.match(FRAME, /await file\.text\(\)\)\.slice\(0, 4000\)/,
    '正文必须 file.text() 截前 4000 字符')
  assert.match(FRAME, /uniqueTitle\(file\.name, usedTitles\)/,
    '文字标题必须 uniqueTitle 去重（@ref 按标题解析）')

  const start = STORE.indexOf('addTextAssetNode: (draft, projectId, url, body, title) =>')
  assert.ok(start > 0, 'project-store 必须实现 addTextAssetNode')
  const impl = STORE.slice(start, STORE.indexOf('addVideoNode: (draft, projectId, asset) =>', start))
  assert.match(impl, /kind: 'text'/, '落卡必须是 text 节点')
  assert.match(impl, /origin: 'manual'/, "origin: 'manual' 归创意栏")
  assert.match(impl, /operationType: 'import'/, "operationType: 'import' 归导入 product")
  assert.match(impl, /NODE_SIZE\.text/, '尺寸必须用 NODE_SIZE.text')
  assert.doesNotMatch(impl, /referenceRole/, '文字素材不得设 referenceRole')
  assert.doesNotMatch(impl, /toolName:/, '文字素材不得设 toolName（与 brief 区分）')
  assert.match(impl, /deriveNodePlacement\(/, '落点必须走唯一入口 deriveNodePlacement')
})

test('CV-241 Q3：带 url 的文字素材双击开详情；详情正文只读', () => {
  const dblStart = NODE.indexOf('const handleDoubleClick =')
  const dblEnd = NODE.indexOf('const handleRenameSubmit =', dblStart)
  assert.ok(dblStart > 0 && dblEnd > dblStart, '找不到 handleDoubleClick')
  const dbl = NODE.slice(dblStart, dblEnd)
  assert.match(dbl, /node\.kind === 'text' && node\.url !== undefined/,
    '双击判据：text + 有 url = 素材 chip')
  assert.match(dbl, /onOpenDetail\(node\)/, '素材 chip 双击必须开详情（只读预览）')
  // 在进入 setEditingBody 之前 return —— 切片内应先 onOpenDetail 再 setEditingBody
  const detailAt = dbl.indexOf('onOpenDetail(node)')
  const editAt = dbl.indexOf('setEditingBody(true)')
  assert.ok(detailAt > 0 && (editAt < 0 || detailAt < editAt),
    '素材 chip 不得进入内联编辑分支')

  assert.match(DETAIL, /node\.kind === 'text' && node\.url !== undefined/,
    '详情必须识别文字素材 chip')
  assert.match(DETAIL, /readOnly/,
    '素材 chip 的正文必须 readOnly（改了也不会写回文件）')
  // 只读分支用 value（受控），编辑分支仍是 defaultValue + onBlur
  assert.match(DETAIL, /value=\{node\.text \?\? node\.title \?\? ''\}/,
    '只读 textarea 必须 value 受控')
  assert.match(DETAIL, /onBlur=\{event => \{/,
    '非素材 text 仍保留失焦提交编辑')
})

test('CV-241 Step 5：旧 base64 /upload 零调用方；deferred 对话旁路保留', () => {
  const CLIENT = codeOnly(readSource('../src/client/index.ts'))
  // 旧一步式 base64 入口：api.ts 允许留定义（deprecated 兼容一版），但除定义外不得有调用
  const apiCalls = (API.match(/uploadLocalStudioImage\(/g) ?? []).length
  assert.equal(apiCalls, 1, `api.ts 里 uploadLocalStudioImage 只准出现定义本身，实际 ${apiCalls} 次`)
  // StudioFrame / index 等消费方不得再引用（仅 Deferred 允许）
  assert.doesNotMatch(FRAME, /uploadLocalStudioImage\(/,
    'StudioFrame 不得调用旧 base64 /upload')
  assert.doesNotMatch(CLIENT, /uploadLocalStudioImage\(/,
    'index.ts 不得调用旧一步式（Deferred 是另一符号，带 Deferred 后缀）')
  // 对话附件旁路 deferred 路径保留（计划 §6.5：不迁移）
  assert.match(CLIENT, /uploadLocalStudioImageDeferred\(/,
    '对话附件旁路 uploadLocalStudioImageDeferred 必须保留')
  assert.match(API, /uploadLocalStudioImageDeferred/,
    'api.ts 必须保留 deferred 导出')
  // 路由仍标 DEPRECATED 保留一版
  assert.match(ROUTES_RAW, /DEPRECATED（CV-241 §6\.5）/,
    '/canvas-studio/upload 路由必须标 DEPRECATED')
  // 新链路：图片/音频走 uploadStudioMedia（octet-stream），不走旧 /upload
  assert.match(FRAME, /await uploadStudioMedia\(projectId, file\)/,
    '图片/音频必须走 uploadStudioMedia')
  assert.doesNotMatch(FRAME, /bytesToBase64\(/,
    '画布链路不得再做 base64 编码')
})

test('CV-241 D3：工具栏一个「上传文件」按钮 + mediaAcceptAttribute 同源', () => {
  const toolbar = codeOnly(readSource('../src/client/canvas/CanvasToolbar.tsx'))
  assert.match(toolbar, /onUploadFile/, '必须有统一 onUploadFile 入口')
  assert.match(toolbar, /mediaAcceptAttribute\(\)/, 'accept 必须取白名单并集（不另写死 MIME）')
  assert.match(toolbar, /上传文件/, '按钮文案是「上传文件」')
  for (const gone of ['onUploadImage', 'onUploadVideo', 'onUploadAudio']) {
    assert.doesNotMatch(toolbar, new RegExp(gone), `${gone} 三旧入口必须删净`)
  }
  // StudioFrame：工具栏入口复用拖放统一分发（不另写第二套 handler）
  assert.match(FRAME, /onUploadFile=\{async \(file\) => \{[\s\S]{0,200}?handleDroppedFiles\(\[file\]\)/,
    '工具栏必须复用 handleDroppedFiles（分发只准一份实现）')
  assert.match(FRAME, /mediaAcceptAttribute|classifyFile/,
    '分发链路必须引用分类白名单')
})
