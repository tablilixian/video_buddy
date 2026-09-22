/**
 * CV-223：「整理布局」镜位泳道 + CV-185 适配视野。
 *
 * 用户的问题是「整理布局点下去怎么工作」。分镜是短片画布的主角，排布主干
 * 从「按工具固定列」（CV-185）升级为「**按镜号分行**」：一个镜 = 一行，行内
 * 从左到右 分镜卡 → 场景图×k → 关键帧 → 视频/托盘 → 末帧；创意/源素材占
 * 头部行，文案/BGM/成片占右上尾区。守卫分三层：
 *
 *   - **镜位行**：同镜同行、镜号沿血缘继承（视频←卡 / 末帧←视频 / 托盘←子代）、
 *     链式镜自然落在下一行（不拉列）、全局锚（≥8 消费者）不进镜位行；
 *   - **兜底与钉扎**：无镜号节点按泳道落位不重叠、被取代节点钉在取代者正下方
 *     且取代者所在行加高、组随行（托盘与成员相对偏移不变）；
 *   - **静态**：适配数学（CV-185）只有一份实现，三层接线不回退。
 *
 * 运行：node --test tests/canvas-arrange.test.mjs（需先 build，import 的是 lib 产物）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  FIT_MIN_SCALE,
  FIT_PADDING,
  MAX_VIEW_SCALE,
  computeArrangeLayout,
  computeFitView,
} from '../lib/canvas-view.js'

const readSource = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

/** 只剥块注释与整行注释，不做行内剥除（`https://` 的 `//` 会长在行中间）。 */
const codeOnly = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

const VIEW_CODE = codeOnly(readSource('../src/canvas-view.ts'))
const SURFACE_CODE = codeOnly(readSource('../src/client/canvas/CanvasSurface.tsx'))
const STORE_CODE = codeOnly(readSource('../src/client/project-store.ts'))
const FRAME_CODE = codeOnly(readSource('../src/client/StudioFrame.tsx'))

/** 最小节点壳：排布只读 id / kind / title / x / y / width / height / sourceIds / parentId / createdAt。 */
const node = (id, width = 260, height = 180, extra = {}) => ({
  id, kind: 'image', title: id, x: 0, y: 0, width, height,
  zIndex: 0, createdAt: 1, origin: 'agent', sourceIds: [], ...extra,
})
const cardNode = (id, shot, extra = {}) =>
  node(id, 260, 180, { kind: 'text', toolName: 'submit_storyboard_for_approval', title: `分镜 ${shot} · 机位`, ...extra })
const videoNode = (id, extra = {}) =>
  node(id, 480, 270, { kind: 'video', toolName: 'video_composite', ...extra })

test('CV-223 镜位行：同镜的卡·绑镜的图·视频同行，泳道从左到右', () => {
  const brief = node('brief', 260, 180, { kind: 'text', toolName: 'user_brief', createdAt: 1 })
  const card = cardNode('card1', 1, { createdAt: 2, sourceIds: ['brief'] })
  const scene = node('scene1', 260, 180, {
    toolName: 'image_generate', createdAt: 3, sourceIds: ['card1'],
  })
  const video = videoNode('video1', { createdAt: 4, sourceIds: ['card1', 'scene1'] })
  const positions = computeArrangeLayout([brief, card, scene, video])

  const yOf = (id) => positions.get(id).y
  const xOf = (id) => positions.get(id).x
  assert.equal(yOf('card1'), yOf('scene1'), '场景图与分镜卡同镜同行')
  assert.equal(yOf('scene1'), yOf('video1'), '视频与分镜卡同镜同行')
  assert.ok(xOf('brief') < xOf('card1'), '创意在最左源区')
  assert.ok(xOf('card1') < xOf('scene1'), '场景图在卡右侧')
  assert.ok(xOf('scene1') < xOf('video1'), '视频在场景图右侧')
  assert.equal(yOf('card1'), yOf('brief'), '镜 1 与创意同行（头部与镜位共享行区间）')
  assert.ok(xOf('brief') + brief.width <= xOf('card1'), '同行不重叠：头部与镜位按泳道 X 分离')
})

test('CV-223 镜号沿血缘继承：视频←卡、末帧←视频、托盘←子代视频', () => {
  const card1 = cardNode('card1', 1, { createdAt: 1 })
  const card2 = cardNode('card2', 2, { createdAt: 2 })
  const video1 = videoNode('video1', { createdAt: 3, sourceIds: ['card1'] })
  const frame1 = node('frame1', 260, 180, { toolName: 'extract_last_frame', createdAt: 4, sourceIds: ['video1'] })
  const tray = node('tray', 552, 366, { kind: 'group', title: '分镜 2 · 素材', createdAt: 5, zIndex: -1 })
  const member = videoNode('member', { createdAt: 6, sourceIds: ['card2'], parentId: 'tray', x: 12, y: 48 })
  const positions = computeArrangeLayout([card1, card2, video1, frame1, tray, member])

  assert.equal(positions.get('video1').y, positions.get('card1').y, '视频继承分镜卡镜号 → 同行')
  assert.equal(positions.get('frame1').y, positions.get('video1').y, '末帧继承视频镜号 → 同行')
  assert.ok(positions.get('frame1').x > positions.get('video1').x, '末帧在视频右侧泳道')
  assert.equal(positions.get('tray').y, positions.get('card2').y, '托盘按子代视频镜号进镜位行')
  assert.ok(positions.get('card2').y > positions.get('card1').y, '镜 2 在镜 1 下一行')
  assert.equal(positions.get('member').y - positions.get('tray').y, member.y - tray.y, '成员相对托盘的偏移不变')
})

test('CV-223 链式镜不拉列：末帧与视频同行，下一镜在下一行且视频同列', () => {
  const card1 = cardNode('card1', 1, { createdAt: 1 })
  const video1 = videoNode('video1', { createdAt: 2, sourceIds: ['card1'] })
  const frame1 = node('frame1', 260, 180, { toolName: 'extract_last_frame', createdAt: 3, sourceIds: ['video1'] })
  const card2 = cardNode('card2', 2, { createdAt: 4 })
  const video2 = videoNode('video2', { createdAt: 5, sourceIds: ['card2', 'frame1'] })
  const positions = computeArrangeLayout([card1, video1, frame1, card2, video2])

  assert.equal(positions.get('frame1').y, positions.get('video1').y, '末帧与它的视频同镜同行')
  assert.ok(positions.get('card2').y > positions.get('card1').y, '链式下一镜在下一行')
  assert.equal(positions.get('video2').x, positions.get('video1').x, '18 镜链不会把视频拉成 18 列')
})

test('CV-223 图按「有没有绑镜」归属：不绑镜的一律留创意区', () => {
  // 2026-09-22 拍板。旧实现有一条推断：「无血缘的 image_generate 图被镜位视频消费
  // ⇒ 判为该镜的场景图」。实测它把 9 张跨镜色彩参考图塞进了分镜栏（其中一张被 6 个
  // 镜共用，却被安到「镜 3」那一行）——「被当参考用了」不等于「是这一镜的场景图」。
  // 归属只看有没有绑镜：agent 传了 shotRefs ⇒ 血缘含分镜卡 ⇒ 关键帧；否则创意区。
  const brief = node('brief', 260, 180, { kind: 'text', toolName: 'user_brief', createdAt: 1 })
  const style = node('style', 260, 180, { toolName: 'image_generate', createdAt: 2 })
  const scene1 = node('scene1', 260, 180, { toolName: 'image_generate', createdAt: 3 })
  const card1 = cardNode('card1', 1, { createdAt: 4 })
  const video1 = videoNode('video1', { createdAt: 5, sourceIds: ['card1', 'style', 'scene1'] })
  const nodes = [brief, style, scene1, card1, video1]
  // 再造 7 个镜位，把 style 的消费者堆到 8 个 —— 覆盖旧实现的「全局锚阈值」边界
  for (let shot = 2; shot <= 8; shot += 1) {
    nodes.push(cardNode(`card${shot}`, shot, { createdAt: 20 + shot }))
    nodes.push(videoNode(`video${shot}`, { createdAt: 40 + shot, sourceIds: [`card${shot}`, 'style'] }))
  }
  const positions = computeArrangeLayout(nodes)

  assert.equal(positions.get('style').x, positions.get('brief').x, '被 8 个镜共用的色彩参考仍在创意区')
  assert.equal(positions.get('scene1').x, positions.get('brief').x, '只被 1 个镜用到的参考图也在创意区')
  assert.ok(positions.get('video1').x > positions.get('brief').x, '视频仍在分镜区（镜号来自 shotRefs）')
})

test('CV-223 修：源素材数量不推高镜位区起点（头部与镜位共享行区间）', () => {
  // 桌面验收实测：真实画布有 6 个源素材，旧实现让镜位区整体让出 headRows 行 ⇒
  // 分镜区被推下六行、与头部之间空出一大片。头部只占 LANE_SOURCE / LANE_SCRIPT，
  // 镜位占 LANE_CARD~FRAME，X 本就分离 ⇒ 共享行区间是安全的。
  const briefs = [1, 2, 3, 4, 5, 6].map((index) =>
    node(`brief${index}`, 260, 180, { kind: 'text', toolName: 'user_brief', createdAt: index }))
  const card1 = cardNode('card1', 1, { createdAt: 20 })
  const card2 = cardNode('card2', 2, { createdAt: 21 })
  const positions = computeArrangeLayout([...briefs, card1, card2])

  assert.ok(positions.get('card1').y < positions.get('brief6').y,
    '镜 1 不因源素材多而被推到最末源素材行之下')
  assert.ok(positions.get('brief1').x + 260 <= positions.get('card1').x,
    '共享行不等于重叠：头部与镜位仍按泳道 X 分离')
})

test('CV-223 每栏独立纵向游标：创意栏的行距不跟随分镜栏', () => {
  // 验收反馈「分镜和参考混到一起」的根因是**全局行号**：创意栏的第 3 个素材会与
  // 分镜栏的第 3 行硬对齐在一条水平线上。现在每栏各有一根纵向游标，行高序列不同
  // ⇒ 排几行就自然错开。这条断言就是钉住「两栏行距互不影响」。
  const brief1 = node('b1', 260, 100, { kind: 'text', toolName: 'user_brief', createdAt: 1 })
  const brief2 = node('b2', 260, 100, { kind: 'text', toolName: 'user_brief', createdAt: 2 })
  const card1 = cardNode('card1', 1, { createdAt: 3 })
  const card2 = cardNode('card2', 2, { createdAt: 4 })
  const video1 = videoNode('video1', { createdAt: 5, sourceIds: ['card1'] })
  const positions = computeArrangeLayout([brief1, brief2, card1, card2, video1])

  const creativeStep = positions.get('b2').y - positions.get('b1').y
  const shotStep = positions.get('card2').y - positions.get('card1').y
  assert.equal(creativeStep, 100 + 48, '创意栏按自己的单元高向下排')
  assert.equal(shotStep, 270 + 48, '分镜栏按自己的行高（行内最高的视频 270）向下排')
  assert.notEqual(creativeStep, shotStep,
    '两栏行距必须不同 —— 相等就说明又退回共用一套全局行（那正是「混」的根因）')
})

test('CV-223 分栏：用户上传的素材（图 / 视频 / 音频）一律归创意栏', () => {
  // 2026-09-22 拍板「**按来源分栏**」：用户给的一律进创意栏，agent 产出的进各自产物栏。
  // 音频的上传入口还没做，这条断言先把规则钉住 —— 将来它带着 toolName 走进 switch，
  // 若不显式归位就会掉到成片栏去。
  const uploadedAudio = node('a1', 260, 100, {
    kind: 'audio', toolName: 'upload_audio', origin: 'manual', createdAt: 1,
  })
  const uploadedVideo = node('v1', 480, 270, {
    kind: 'video', toolName: 'upload_video', origin: 'manual', createdAt: 2,
  })
  const uploadedImage = node('i1', 260, 180, {
    toolName: 'upload_image', origin: 'manual', createdAt: 3,
  })
  const generatedMusic = node('m1', 260, 100, {
    kind: 'audio', toolName: 'music_generation', origin: 'agent', createdAt: 4,
  })
  const positions = computeArrangeLayout([uploadedAudio, uploadedVideo, uploadedImage, generatedMusic])

  const xOf = (id) => positions.get(id).x
  assert.equal(xOf('a1'), xOf('i1'), '上传音频与上传图片同栏（创意栏）')
  assert.equal(xOf('v1'), xOf('i1'), '上传视频也在创意栏')
  assert.ok(xOf('m1') > xOf('v1'), 'agent 生成的音乐在更靠右的音乐栏')
})

test('CV-223 同镜多张绑镜的图同行、行内横向错开', () => {
  // 绑镜的图统一走关键帧泳道；同一镜有多张时在同一行内错开。（「场景图子泳道」
  // 暂时空置，要等 agent 能在生成时声明"这张是场景参考还是构图关键帧"。）
  const card1 = cardNode('card1', 1, { createdAt: 1 })
  const card2 = cardNode('card2', 2, { createdAt: 2 })
  const kfA = node('kfA', 260, 180, { toolName: 'image_generate', createdAt: 3, sourceIds: ['card1'] })
  const kfB = node('kfB', 260, 180, { toolName: 'image_generate', createdAt: 4, sourceIds: ['card1'] })
  const kfC = node('kfC', 260, 180, { toolName: 'image_generate', createdAt: 5, sourceIds: ['card2'] })
  const positions = computeArrangeLayout([card1, card2, kfA, kfB, kfC])

  assert.equal(positions.get('kfA').y, positions.get('card1').y, '绑镜的图与该镜同行')
  assert.equal(positions.get('kfB').y, positions.get('kfA').y, '同镜两张图同行')
  assert.ok(positions.get('kfB').x > positions.get('kfA').x, '同行内横向错开')
  assert.ok(positions.get('kfC').y > positions.get('kfA').y, '镜 2 的图在下一行')
})

test('CV-185 组随行：托盘与成员保持相对偏移，且不与其他单元重叠', () => {
  const tray = node('g', 552, 600, { kind: 'group', title: '分镜 1 · 素材', zIndex: -1 })
  const memberA = node('a', 270, 528, { x: 100, y: 200, parentId: 'g' })
  const memberB = node('b', 270, 528, { x: 382, y: 200, parentId: 'g' })
  const other = node('other', 480, 318, { x: 2000, y: 3000 })
  const positions = computeArrangeLayout([tray, memberA, memberB, other])

  // 断言**相对偏移不变**，不要用「另一个成员推出来的 delta」—— 那样两边一起错时
  // 期望值会跟着错，断言恒真（第一版就是这么写的，被反向验证当场抓出来）。
  const trayX = positions.get('g').x
  const trayY = positions.get('g').y
  assert.equal(positions.get('a').x - trayX, memberA.x - tray.x, '成员 A 相对托盘的偏移不变')
  assert.equal(positions.get('a').y - trayY, memberA.y - tray.y)
  assert.equal(positions.get('b').x - trayX, memberB.x - tray.x, '成员 B 相对托盘的偏移不变')
  assert.equal(positions.get('b').y - trayY, memberB.y - tray.y)
  assert.ok(trayY > positions.get('other').y || trayX + tray.width <= positions.get('other').x
    || positions.get('other').x + 480 <= trayX, '托盘与无关节点不重叠')

  const trayBox = { x: trayX, y: trayY, width: 552, height: 600 }
  const otherBox = { ...positions.get('other'), width: 480, height: 318 }
  const overlaps = trayBox.x < otherBox.x + otherBox.width && otherBox.x < trayBox.x + trayBox.width
    && trayBox.y < otherBox.y + otherBox.height && otherBox.y < trayBox.y + trayBox.height
  assert.equal(overlaps, false, '托盘矩形与无关节点矩形不相交')
})

test('CV-223 版本钉扎：被取代节点钉在取代者正下方，取代者所在行加高', () => {
  const v1 = videoNode('v1', { createdAt: 1, supersededBy: 'v2' })
  const v2 = videoNode('v2', { createdAt: 2 })
  const script = node('script', 260, 180, { kind: 'text', toolName: 'write_script', createdAt: 3 })
  const positions = computeArrangeLayout([v1, v2, script])

  const v1p = positions.get('v1')
  const v2p = positions.get('v2')
  assert.equal(v1p.x, v2p.x, '被取代节点与取代者对齐 X')
  assert.equal(v1p.y, v2p.y + 270 + 6, '钉在取代者正下方（间隙 6px）')
  assert.ok(positions.get('script').y >= v1p.y + 270, '取代者所在行已加高，下一行不压被取代节点')
})

test('小画布不退化：同泳道节点同列纵排', () => {
  const three = [
    node('a', 260, 180, { kind: 'text', toolName: 'user_brief', createdAt: 1 }),
    node('b', 260, 180, { kind: 'text', toolName: 'user_brief', createdAt: 2 }),
    node('c', 260, 180, { kind: 'text', toolName: 'user_brief', createdAt: 3 }),
  ]
  const positions = computeArrangeLayout(three)
  assert.equal(new Set([...positions.values()].map((p) => p.x)).size, 1, '3 个同泳道节点必须落在同一列')
  assert.equal(new Set([...positions.values()].map((p) => p.y)).size, 3, '列内纵向堆叠')
})

test('CV-223 制作流程从左到右：创意 < 剧本 < 分镜卡 < 视频 < 成片', () => {
  const brief = node('brief', 260, 180, { kind: 'text', toolName: 'user_brief', createdAt: 1 })
  const screenplay = node('sc', 260, 180, { kind: 'text', toolName: 'write_screenplay', createdAt: 2, sourceIds: ['brief'] })
  const card = cardNode('sb', 1, { createdAt: 3, sourceIds: ['sc'] })
  const video = videoNode('clip', { createdAt: 4, sourceIds: ['sb'] })
  const composed = videoNode('out', { createdAt: 5, toolName: 'compose', sourceIds: ['clip'] })
  const positions = computeArrangeLayout([brief, screenplay, card, video, composed])

  const xOf = (id) => positions.get(id).x
  assert.ok(xOf('brief') < xOf('sc'), '创意在剧本左侧')
  assert.ok(xOf('sc') < xOf('sb'), '剧本在分镜卡左侧')
  assert.ok(xOf('sb') < xOf('clip'), '分镜卡在分镜视频左侧')
  assert.ok(xOf('clip') < xOf('out'), '分镜视频在成片左侧')
})

test('CV-223 尾区：compose 恒在文案之后（最后一行）', () => {
  const scriptA = node('sa', 260, 180, { kind: 'text', toolName: 'write_script', createdAt: 1 })
  const scriptB = node('sb', 260, 180, { kind: 'text', toolName: 'write_script', createdAt: 2 })
  const composed = videoNode('out', { createdAt: 1, toolName: 'compose' })
  const positions = computeArrangeLayout([composed, scriptA, scriptB])

  assert.ok(positions.get('out').y > positions.get('sa').y, '成片在文案 A 下一行')
  assert.ok(positions.get('out').y > positions.get('sb').y, '成片在文案 B 下一行')
})

test('CV-185 computeFitView：装得下居中，装不下缩到可读下限并对齐左上角', () => {
  const viewport = { width: 1000, height: 600 }

  const small = { x: 0, y: 0, width: 400, height: 200 }
  const fit = computeFitView(small, viewport)
  assert.equal(fit.clamped, false)
  assert.equal(fit.scale, Math.min((1000 - 120) / 400, (600 - 120) / 200), '比例 = 两轴较小者')
  assert.equal(fit.x, 500 - 200 * fit.scale, '装得下 → 内容居中')
  assert.equal(fit.y, 300 - 100 * fit.scale)

  const huge = { x: 0, y: 0, width: 8000, height: 4000 }
  const clamped = computeFitView(huge, viewport)
  assert.equal(clamped.clamped, true, '内容远大于视口 → 必须报 clamped')
  assert.equal(clamped.scale, FIT_MIN_SCALE, '被下限挡住时就停在下限')
  assert.equal(huge.x * clamped.scale + clamped.x, FIT_PADDING, '对齐内容左上角（从阅读起点看）')
  assert.equal(huge.y * clamped.scale + clamped.y, FIT_PADDING)

  const tiny = computeFitView({ x: 0, y: 0, width: 4, height: 2 }, viewport)
  assert.equal(tiny.scale, MAX_VIEW_SCALE, '再小也不放大超过缩放上限')

  const offset = { x: 3000, y: 2000, width: 8000, height: 4000 }
  const offsetFit = computeFitView(offset, viewport)
  assert.equal(offset.x * offsetFit.scale + offsetFit.x, FIT_PADDING, '下限态用内容自身坐标对齐')
})

test('CV-185 适配数学只有一份实现（原来写在 CanvasSurface 的 JSX 里）', () => {
  assert.match(VIEW_CODE, /export function computeFitView/, '唯一实现必须住在 canvas-view.ts')
  assert.match(VIEW_CODE, /export const FIT_MIN_SCALE/, '可读下限必须可被断言/复用')
  assert.match(SURFACE_CODE, /computeFitView\(/, 'CanvasSurface 必须用共享实现')
  assert.doesNotMatch(SURFACE_CODE, /\/ bounds\.width/,
    '画布侧不得再自带一份「按包围盒算比例」的数学（就是被收敛掉的那份）')
  assert.doesNotMatch(SURFACE_CODE, /const padding = 60/,
    '内边距也是共享常量（FIT_PADDING），不得在画布侧重写一个 60')
})

test('接线：排布按镜位泳道（CV-223），被下限挡住必须出声', () => {
  assert.match(SURFACE_CODE, /viewportSize\(\): \{ width: number; height: number \} \| null/,
    'CanvasSurface 必须暴露视口尺寸 —— 适配视野需要')
  assert.match(SURFACE_CODE, /if \(result\.clamped\) onFitClampedRef\.current\?\.\(result\)/,
    '被下限挡住时必须回调出去（画布这层不认识 toast）')

  assert.match(STORE_CODE, /autoArrange: \(draft: ProjectStoreState, projectId: string, visibleIds\?: readonly string\[\]\) => void/,
    'store 动作签名：visibleIds 支持只排可见节点（隐藏废弃素材）')
  assert.match(STORE_CODE, /computeArrangeLayout\(existing\)/, '排布由 computeArrangeLayout 统一给出')

  assert.match(FRAME_CODE, /actions\.autoArrange\(projectId, ids\)/,
    'StudioFrame 调用整理布局时传入可见节点集（隐藏废弃素材时只排可见节点）')
  assert.match(FRAME_CODE, /fittedProjectRef\.current === projectId[\s\S]{0,120}suppressFitHintRef\.current = true/,
    '打开项目时的自动适配不得弹提示（只有用户主动适配才提示）')
  assert.match(FRAME_CODE, /内容较多，已按可读比例显示，视野外还有节点/,
    '「内容多于视口」必须有一句人话 —— 否则「只看到一半」会被读成「节点丢了」')
})
