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
