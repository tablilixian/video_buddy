/**
 * REQ-036：历程瀑布流布局纯函数。
 *
 * 守卫分四层：
 *   - **归节**：五节归属表逐分支（创意 / 分镜托盘 / 音频 / 成片 / 其他兜底），
 *     文本类与辅助卡默认隐藏、分镜卡恒为托盘头（用户拍板 2026-10-26）；
 *   - **血缘**：镜号沿血缘传播（与 CV-223 整理布局共享 deriveShotSemantics，
 *     这里只验瀑布流侧的消费，不重复语义本身）；
 *   - **排序**：节内 createdAt、order 覆盖、被取代节点紧跟取代者、compose 恒末尾；
 *   - **纯度与性质**：入参不被修改、全部盒子两两不重叠（12 镜高压）、import 面
 *     白名单（纯函数不许长出 IO / Host 依赖）。
 *
 * 运行：node --test tests/canvas-waterfall.test.mjs（需先 build，import 的是 lib 产物）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { computeWaterfallLayout, thumbWidthFromViewport } from '../lib/canvas-waterfall.js'
import { deriveShotSemantics, normalizeCanvasView } from '../lib/canvas-view.js'

const readSource = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

/** 只剥块注释与整行注释（与 canvas-arrange.test.mjs 同款，注释里别写"斜杠+星号"序列）。 */
const codeOnly = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

const WF_CODE = codeOnly(readSource('../src/canvas-waterfall.ts'))
const VIEW_CODE = codeOnly(readSource('../src/canvas-view.ts'))

/** 最小节点壳：布局只读 id/kind/title/toolName/origin/sourceIds/supersededBy/createdAt
 *  与瞬态 isLoading/error（REQ-040 A 状态统计）；x/y/w/h 不进算法，进纯度校验。 */
let seq = 0
const node = (id, extra = {}) => ({
  id, kind: 'image', title: id, x: seq * 37, y: seq * 53, width: 260, height: 180,
  zIndex: 0, createdAt: ++seq * 10, origin: 'agent', sourceIds: [], ...extra,
})
const cardNode = (id, shot, extra = {}) =>
  node(id, { kind: 'text', toolName: 'submit_storyboard_for_approval', title: `分镜 ${shot} · 机位`, ...extra })
const videoNode = (id, extra = {}) =>
  node(id, { kind: 'video', toolName: 'video_composite', ...extra })
const sectionOf = (layout, stage) => layout.sections.find(section => section.stage === stage)
const trayOf = (layout, shot) => layout.trays.find(tray => tray.shot === shot)

test('REQ-036 归节：五节各就各位，节的纵向顺序固定', () => {
  const brief = node('brief', { kind: 'text', toolName: 'user_brief' })
  const concept = node('concept', { toolName: 'image_generate' })
  const card = cardNode('card1', 1, { sourceIds: ['brief'] })
  const kf = node('kf1', { toolName: 'image_generate', sourceIds: ['card1'] })
  const video = videoNode('video1', { sourceIds: ['card1'] })
  const bgm = node('bgm', { kind: 'audio', toolName: 'music_generation' })
  const copy = node('copy', { kind: 'text', toolName: 'write_script' })
  const final = node('final', { kind: 'video', toolName: 'compose' })
  const layout = computeWaterfallLayout([brief, concept, card, kf, video, bgm, copy, final])

  assert.deepEqual(layout.sections.map(section => section.stage), ['creative', 'shots', 'audio', 'film'], '空节塌缩，顺序固定')
  assert.ok(sectionOf(layout, 'creative').nodeIds.includes('concept'), '未绑镜图 → 创意节')
  assert.ok(sectionOf(layout, 'creative').nodeIds.includes('brief') === false, '文本类默认隐藏')
  assert.ok(sectionOf(layout, 'audio').nodeIds.includes('bgm'), 'music_generation → 音频节')
  assert.ok(sectionOf(layout, 'film').nodeIds.includes('copy') === false, '口播文案（纯文本）默认隐藏')
  assert.ok(sectionOf(layout, 'film').nodeIds.includes('final'), 'compose → 成片节')
})

test('REQ-036 分镜托盘：同镜聚合、镜号升序、卡为头、镜内产物有序', () => {
  const card1 = cardNode('card1', 1)
  const card2 = cardNode('card2', 2)
  const video2 = videoNode('video2', { sourceIds: ['card2'], createdAt: 1 })
  const kf2 = node('kf2', { toolName: 'image_generate', sourceIds: ['card2'], createdAt: 2 })
  const kf1 = node('kf1', { toolName: 'image_generate', sourceIds: ['card1'] })
  const voice2 = node('voice2', { kind: 'audio', toolName: 'tts_voiceover', sourceIds: ['card2'], createdAt: 3 })
  const frame2 = node('frame2', { toolName: 'extract_last_frame', sourceIds: ['video2'] })
  const layout = computeWaterfallLayout(
    [video2, kf2, card2, voice2, card1, kf1, frame2],
    { showAuxiliary: true },
  )

  assert.deepEqual(layout.trays.map(tray => tray.shot), [1, 2], '镜号升序')
  assert.equal(trayOf(layout, 1).cardId, 'card1', '镜 1 卡为头')
  assert.equal(trayOf(layout, 2).cardId, 'card2', '镜 2 卡为头')
  // 镜内产物按 role：关键帧 → 视频 → 末帧 → 配音（卡为第一格，参与同一次排序）。
  const tray2Ids = trayOf(layout, 2).nodeIds
  const idx = (id) => tray2Ids.indexOf(id)
  assert.equal(tray2Ids[0], 'card2', '卡是第一格（不再是头带）')
  assert.ok(idx('kf2') < idx('video2'), '关键帧在视频前')
  assert.ok(idx('video2') < idx('frame2'), '视频在末帧前')
  assert.ok(idx('frame2') < idx('voice2'), '末帧在配音前')
  // 位置次序与 nodeIds 一致（y 单调）。
  assert.ok(layout.boxes.get('kf2').y < layout.boxes.get('video2').y
    || (layout.boxes.get('kf2').y === layout.boxes.get('video2').y
      && layout.boxes.get('kf2').x < layout.boxes.get('video2').x), '网格次序可读')
  // REQ-036 一行一镜（2026-11-24）：卡与媒体同高（TRAY_HEAD_H 已退役），与同镜视频同 y。
  assert.equal(layout.boxes.get('card2').height, layout.boxes.get('kf2').height, '卡与媒体等高')
  assert.equal(layout.boxes.get('card2').height, Math.round(360 * 9 / 16), '卡高 = 媒体 16:9 格高')
  assert.equal(layout.boxes.get('card2').y, layout.boxes.get('video2').y, '卡与视频同排')
})

test('REQ-036 一行一镜：卡在网格首格、同排同 y 且 x 递增；行框宽统一到节宽、高 = PAD*2 + cellH', () => {
  // 2026-11-24 用户拍板：分镜节从「每镜一个扁头带 + 产物竖排」改成一行一镜的行式表格。
  const cellW = 380
  const card1 = cardNode('card1', 1)
  const kf1 = node('kf1', { toolName: 'image_generate', sourceIds: ['card1'], createdAt: 1 })
  const video1 = videoNode('video1', { sourceIds: ['card1'], createdAt: 2 })
  const voice1 = node('voice1', { kind: 'audio', toolName: 'tts_voiceover', sourceIds: ['card1'], createdAt: 3 })
  // 镜 2 只有卡 + 一条视频 —— 产物少的镜，行框宽度不许缩回内容宽（否则细长条重现）。
  const card2 = cardNode('card2', 2)
  const video2 = videoNode('video2', { sourceIds: ['card2'], createdAt: 4 })
  const layout = computeWaterfallLayout([card1, kf1, video1, voice1, card2, video2], { thumbWidth: cellW })
  const pos = (id) => layout.positions.get(id)

  assert.deepEqual([...trayOf(layout, 1).nodeIds], ['card1', 'kf1', 'video1', 'voice1'], '格序：卡 → 关键帧 → 视频 → 配音')
  assert.equal(pos('card1').y, pos('kf1').y, '卡与关键帧同一排')
  assert.equal(pos('card1').y, pos('video1').y, '卡与同镜视频同一 y（不再是头带 + 网格两段）')
  assert.ok(pos('card1').x < pos('kf1').x && pos('kf1').x < pos('video1').x, 'x 递增：卡 < 帧 < 视频')

  const cellH = Math.round(cellW * 9 / 16)
  const sectionWidth = 4 * cellW + 3 * 24 + 32
  const tray1 = trayOf(layout, 1)
  const tray2 = trayOf(layout, 2)
  assert.equal(tray1.box.width, sectionWidth, '4 格行 = 节宽（1624 @380 档）')
  assert.equal(tray2.box.width, sectionWidth, '2 格行也铺到节宽（不从内容缩）')
  assert.equal(tray1.box.height, 32 + cellH, '行高 = PAD*2 + cellH = 246')
  assert.equal(tray2.box.height, 32 + cellH, '单排行等高')
  assert.equal(layout.boxes.get('card1').height, cellH, '卡与媒体等高（TRAY_HEAD_H 退役）')

  // 配音是行内普通格：宽 = cellW（不再是托盘内宽），盒高仍给足固有 168 并居中。
  assert.equal(layout.boxes.get('voice1').width, cellW, '配音格宽 = cellW')
  assert.equal(layout.boxes.get('voice1').height, 168, '配音盒高 = 168（卡内部布局不动）')
  assert.ok(layout.boxes.get('voice1').y > layout.boxes.get('video1').y, '168 居中在 214 的媒体排里')

  // 第 5 件折到**同一行框内**的第二排，行框随之变高（一行=一镜不破）。
  const frame1 = node('frame1', { toolName: 'extract_last_frame', sourceIds: ['video1'] })
  const five = computeWaterfallLayout([card1, kf1, video1, voice1, frame1], { showAuxiliary: true, thumbWidth: cellW })
  const folded = trayOf(five, 1)
  assert.equal(folded.nodeIds.length, 5, '5 件仍属同一个托盘的成员')
  assert.equal(five.positions.get('frame1').y, five.positions.get('card1').y, '第 4 件仍在第一排')
  assert.ok(five.positions.get('voice1').y > five.positions.get('card1').y, '第 5 件落到第二排')
  assert.ok(five.boxes.get('voice1').y + 168 <= folded.box.y + folded.box.height, '第二排仍在行框内')
  assert.ok(folded.box.height > tray1.box.height, '折行后行框变高（不强制等高）')
})

test('REQ-036 血缘消费：视频←卡、末帧←视频、绑镜图是关键帧（共享语义的一份实现）', () => {
  const card1 = cardNode('card1', 1)
  const video1 = videoNode('video1', { sourceIds: ['card1'] })
  const frame1 = node('frame1', { toolName: 'extract_last_frame', sourceIds: ['video1'] })
  const kf1 = node('kf1', { toolName: 'image_generate', sourceIds: ['card1'] })
  const nodes = [card1, video1, frame1, kf1]
  const semantics = deriveShotSemantics(nodes)
  assert.equal(semantics.shotNo.get('video1'), 1, '视频继承卡镜号')
  assert.equal(semantics.shotNo.get('frame1'), 1, '末帧继承视频镜号')
  assert.ok(semantics.keyframes.has('kf1'), '绑镜图判为关键帧')

  const layout = computeWaterfallLayout(nodes, { showAuxiliary: true })
  const tray = trayOf(layout, 1)
  assert.deepEqual([...tray.nodeIds], ['card1', 'kf1', 'video1', 'frame1'], '四类成员同托盘，次序 卡→帧→视频→末帧')
})

test('REQ-036 默认隐藏：文本类与辅助卡不进布局，开关各自放开；分镜卡永不受文本开关影响', () => {
  const brief = node('brief', { kind: 'text', toolName: 'user_brief' })
  const card = cardNode('card1', 1)
  const kf = node('kf1', { toolName: 'image_generate', sourceIds: ['card1'] })
  const frame = node('frame1', { toolName: 'extract_last_frame', sourceIds: ['kf1'] })
  const sticky = node('note', { kind: 'sticky' })
  const prompt = node('prompt1', { kind: 'prompt' })

  const off = computeWaterfallLayout([brief, card, kf, frame, sticky, prompt])
  assert.ok(sectionOf(off, 'shots').nodeIds.includes('card1'), '分镜卡不受文本开关影响（归属锚点）')
  const offIds = off.sections.flatMap(section => section.nodeIds)
  assert.ok(!offIds.includes('brief') && !offIds.includes('note') && !offIds.includes('prompt1'), '文本类默认隐藏')
  assert.ok(!offIds.includes('frame1'), '辅助卡默认隐藏')

  const on = computeWaterfallLayout([brief, card, kf, frame, sticky, prompt], { showText: true, showAuxiliary: true })
  const onIds = on.sections.flatMap(section => section.nodeIds)
  assert.ok(onIds.includes('brief') && onIds.includes('note') && onIds.includes('prompt1') && onIds.includes('frame1'), '开关放开后全部进布局')
})

test('REQ-036 兜底：未知节点进「其他」节，绝不丢节点；手动上传素材进创意节', () => {
  const uploadV = node('upv', { kind: 'video', toolName: undefined, origin: 'manual' })
  const uploadA = node('upa', { kind: 'audio', origin: 'manual' })
  const weird = node('weird', { kind: 'text', toolName: 'totally_unknown_tool' })
  const layout = computeWaterfallLayout([uploadV, uploadA, weird])

  assert.ok(sectionOf(layout, 'creative').nodeIds.includes('upv'), '手动上传视频 → 创意（与 CV-223 laneOfNode 同口径）')
  assert.ok(sectionOf(layout, 'creative').nodeIds.includes('upa'), '手动上传音频 → 创意')
  assert.ok(sectionOf(layout, 'other').nodeIds.includes('weird'), '未知工具 → 其他兜底')
  const all = layout.sections.flatMap(section => section.nodeIds)
  assert.equal(all.length, 3, '一个不少')
})

test('REQ-036 排序：节内按 createdAt；order 覆盖；被取代节点紧跟取代者；compose 恒末尾', () => {
  const oldLook = node('lookOld', { toolName: 'image_generate', createdAt: 1, supersededBy: 'lookNew' })
  const newLook = node('lookNew', { toolName: 'image_generate', createdAt: 5 })
  const other = node('other1', { toolName: 'image_generate', createdAt: 3 })
  const creative = computeWaterfallLayout([oldLook, newLook, other])
  const ids = sectionOf(creative, 'creative').nodeIds
  assert.ok(Math.abs(ids.indexOf('lookOld') - ids.indexOf('lookNew')) === 1, '被取代版本紧跟取代者')
  assert.ok(ids.indexOf('other1') < ids.indexOf('lookNew'), '取代者按自身 createdAt 排（other1 更早）')

  const ordered = computeWaterfallLayout([oldLook, newLook, other], { order: ['other1', 'lookNew'] })
  const orderedIds = sectionOf(ordered, 'creative').nodeIds
  assert.ok(orderedIds.indexOf('other1') < orderedIds.indexOf('lookNew'), 'order 覆盖生效')
  assert.ok(orderedIds.indexOf('lookOld') === orderedIds.indexOf('lookNew') + 1, 'order 下仍紧跟取代者')
  assert.ok(orderedIds.indexOf('lookOld') > orderedIds.indexOf('other1'), '未列入 order 的按 createdAt 追后')

  const midVideo = videoNode('mid', { createdAt: 1 })
  const final = node('final', { kind: 'video', toolName: 'compose', createdAt: 2 })
  const film = computeWaterfallLayout([final, midVideo])
  const filmIds = sectionOf(film, 'film').nodeIds
  assert.equal(filmIds[filmIds.length - 1], 'final', 'compose 恒排成片节末尾（终点语义）')
})

test('REQ-036 hiddenIds：显式排除优先于一切', () => {
  const card = cardNode('card1', 1)
  const kf = node('kf1', { toolName: 'image_generate', sourceIds: ['card1'] })
  const layout = computeWaterfallLayout([card, kf], { hiddenIds: new Set(['kf1']) })
  assert.ok(!layout.sections.flatMap(s => s.nodeIds).includes('kf1'), '被排除节点不进布局')
  assert.ok(!layout.positions.has('kf1'), '无坐标')
  assert.ok(trayOf(layout, 1).nodeIds.length === 1, '托盘只剩卡头')
})

test('REQ-036 竖版素材：媒体格按真实分辨率派生高度（封顶 9:16），横版与未知维持 16:9', () => {
  // 2026-10-27 用户拍板：瀑布流支持横版/竖版两种显示效果，竖图不再被 16:9 格裁成横带。
  const portrait = node('p1', { toolName: 'image_generate', mediaWidth: 768, mediaHeight: 1376 })
  const extreme = node('p2', { toolName: 'image_generate', mediaWidth: 300, mediaHeight: 1200 })
  const landscape = node('l1', { toolName: 'image_generate', mediaWidth: 1920, mediaHeight: 1080 })
  const square = node('s1', { toolName: 'image_generate', mediaWidth: 1024, mediaHeight: 1024 })
  const unknown = node('u1', { toolName: 'image_generate' })
  const layout = computeWaterfallLayout([portrait, extreme, landscape, square, unknown])
  const box = (id) => layout.boxes.get(id)
  assert.equal(box('p1').width, 360, '格宽不变（竖版只变高）')
  assert.equal(box('p1').height, 640, '768×1376 → 360×640（比例 1.79 封顶到 16/9 镜像）')
  assert.equal(box('p2').height, 640, '1:4 极端长图同封顶，不撑爆行')
  assert.equal(box('l1').height, Math.round(360 * 9 / 16), '横版维持 16:9')
  assert.equal(box('s1').height, Math.round(360 * 9 / 16), '正方形不判竖版，维持 16:9')
  assert.equal(box('u1').height, Math.round(360 * 9 / 16), '分辨率未知（未加载/老数据）维持 16:9 缺省')
  // 竖卡确实更高 —— 行高取 max，同行横卡落位不重叠由「高压」性质测试兜底。
  assert.ok(box('p1').height > box('l1').height, '竖版格高于横版格')
})

test('REQ-036 音频格高：瀑布流盒高给足音频卡固有高度 168，不再被裁下半截', () => {
  // 2026-10-27 修正：AUDIO_H 曾手写 96 < 卡固有 168（chrome 48 + 波形/控制/歌词），
  // overflow:hidden 把卡下半截裁掉。盒高必须等于 contracts 的 AUDIO_NODE_HEIGHT。
  const bgm = node('bgm', { kind: 'audio', toolName: 'music_generation' })
  const voice = node('voice', { kind: 'audio', toolName: 'tts_voiceover', sourceIds: ['card1'] })
  const card = cardNode('card1', 1)
  const layout = computeWaterfallLayout([bgm, card, voice])
  assert.equal(layout.boxes.get('bgm').height, 168, '音频节网格格高 = 168')
  // REQ-036 一行一镜（2026-11-24）：配音是行内普通格，格宽 = cellW（不再铺满内宽），
  // 盒高仍给足固有 168 —— 落在媒体排（203）里纵向居中，卡内部布局不动。
  assert.equal(layout.boxes.get('voice').width, 360, '托盘内配音格宽 = cellW')
  assert.equal(layout.boxes.get('voice').height, 168, '托盘内配音盒高 = 168（居中在媒体排里）')
  const tray = trayOf(layout, 1)
  assert.ok(layout.boxes.get('voice').y > layout.boxes.get('card1').y, '居中：比同排媒体格低一点')
  assert.ok(layout.boxes.get('voice').y + 168 < tray.box.y + tray.box.height, '配音仍在行框内')
})

test('REQ-036 纯度：入参不被修改；空输入返回空布局', () => {
  const card = cardNode('card1', 1)
  const kf = node('kf1', { toolName: 'image_generate', sourceIds: ['card1'] })
  const nodes = [card, kf]
  const before = JSON.stringify(nodes)
  computeWaterfallLayout(nodes, { order: ['kf1'] })
  assert.equal(JSON.stringify(nodes), before, '输入零改动')

  const empty = computeWaterfallLayout([])
  assert.deepEqual(empty.sections, [], '空输入 → 空节')
  assert.equal(empty.positions.size, 0, '空输入 → 无坐标')
})

test('REQ-036 性质：12 镜高压数据下全部盒子两两不重叠', () => {
  const nodes = []
  nodes.push(node('brief', { kind: 'text', toolName: 'user_brief' }))
  nodes.push(node('bgm', { kind: 'audio', toolName: 'music_generation' }))
  nodes.push(node('final', { kind: 'video', toolName: 'compose' }))
  for (let shot = 1; shot <= 12; shot += 1) {
    const card = cardNode(`card${shot}`, shot)
    nodes.push(card)
    const kfs = shot % 3 === 2 ? 2 : 1
    for (let k = 0; k < kfs; k += 1) {
      nodes.push(node(`kf${shot}_${k}`, { toolName: 'image_generate', sourceIds: [`card${shot}`] }))
    }
    nodes.push(videoNode(`video${shot}`, { sourceIds: [`card${shot}`] }))
    nodes.push(node(`frame${shot}`, { toolName: 'extract_last_frame', sourceIds: [`video${shot}`] }))
    if (shot % 2 === 1) nodes.push(node(`voice${shot}`, { kind: 'audio', toolName: 'tts_voiceover', sourceIds: [`card${shot}`] }))
  }
  const layout = computeWaterfallLayout(nodes, { showAuxiliary: true })
  const boxes = [...layout.boxes.values()]
  assert.equal(boxes.length, nodes.length - 1, 'brief 被文本开关隐藏，其余全部有盒')
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]
      const b = boxes[j]
      const overlap = a.x < b.x + b.width && b.x < a.x + a.width
        && a.y < b.y + b.height && b.y < a.y + a.height
      assert.ok(!overlap, `盒 ${i} 与盒 ${j} 重叠: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
    }
  }
  assert.equal(layout.trays.length, 12, '12 个托盘')
  // 托盘框之间也不重叠（托盘框 = 成员盒的并集 + 头部，这里直接验成员并集落在各自框内）。
  for (const tray of layout.trays) {
    for (const id of tray.nodeIds) {
      const box = layout.boxes.get(id)
      assert.ok(box.x >= tray.box.x && box.x + box.width <= tray.box.x + tray.box.width
        && box.y >= tray.box.y && box.y + box.height <= tray.box.y + tray.box.height, `镜 ${tray.shot} 成员 ${id} 超出托盘框`)
    }
  }
})

test('REQ-036 静态守卫：瀑布流纯函数 import 面白名单 + 镜号语义单一实现', () => {
  const imports = [...new Set([...WF_CODE.matchAll(/from '([^']+)'/g)].map(match => match[1]))]
  assert.deepEqual(imports, ['./contracts/canvas.js', './canvas-view.js', './shot-versions.js'],
    'canvas-waterfall 只许依赖 contracts / canvas-view / shot-versions（纯函数不许长出 IO / Host 依赖）')
  assert.ok(WF_CODE.includes('export function computeWaterfallLayout'), '唯一入口')
  assert.ok(VIEW_CODE.includes('deriveShotSemantics(nodes)'), '整理布局已切换到共享镜号语义（抽取干净，无第二份实现）')
})

test('REQ-040 B 版本堆栈折叠：被取代链不进布局、折叠进链尾 stacks（新→旧）；retired 隐藏；链尾不在场保持可见', () => {
  // 链：v1 ← v2 ← v3（v3 = 链尾，当前生效版本）。fold 开：v1/v2 无格位，v3 名下 2 历史。
  const v1 = node('v1', { kind: 'video', toolName: 'video_generate', shotVersion: 1, supersededBy: 'v2', createdAt: 10 })
  const v2 = node('v2', { kind: 'video', toolName: 'video_generate', shotVersion: 2, supersededBy: 'v3', createdAt: 20 })
  const v3 = node('v3', { kind: 'video', toolName: 'video_generate', shotVersion: 3, createdAt: 30 })
  const folded = computeWaterfallLayout([v1, v2, v3], { foldSuperseded: true })
  assert.equal(folded.boxes.size, 1, '折叠后只有链尾有格位')
  assert.ok(folded.boxes.has('v3'))
  assert.equal(folded.boxes.has('v1'), false)
  assert.equal(folded.boxes.has('v2'), false)
  const stack = folded.stacks.get('v3')
  assert.ok(stack, '链尾名下有堆栈')
  assert.equal(stack.count, 2, '两个历史版本')
  assert.deepEqual([...stack.supersededIds], ['v2', 'v1'], '历史成员新→旧')
  // stats 只数当前生效版本（推进读数不被历史稀释）。
  assert.deepEqual(folded.stats, { total: 1, done: 1, running: 0, failed: 0 })
  // fold 关：旧行为——三个都进布局（被取代者紧跟取代者），无 stacks。
  const flat = computeWaterfallLayout([v1, v2, v3], { foldSuperseded: false })
  assert.equal(flat.boxes.size, 3, '关闭折叠 = 平铺钉扎旧行为')
  assert.equal(flat.stacks.size, 0)
  // retired（手动作废、无替代者）折叠模式下隐藏。
  const retiredNode = node('dead', { retired: true })
  const withRetired = computeWaterfallLayout([v3, retiredNode], { foldSuperseded: true })
  assert.equal(withRetired.boxes.has('dead'), false, 'retired 无格位')
  assert.equal(withRetired.stacks.size, 0, 'retired 不入堆栈（无「当前生效版本」卡可挂）')
  // 链尾不在场（取代者被删）：保持可见，兜底不丢节点。
  const orphan = node('orphan', { kind: 'video', toolName: 'video_generate', supersededBy: 'gone' })
  const fallback = computeWaterfallLayout([orphan], { foldSuperseded: true })
  assert.equal(fallback.boxes.has('orphan'), true, '链尾解析不出 → 不折叠、保持可见')
  // 纯度：入参不被修改（supersededBy/shotVersion 原样）。
  assert.equal(v1.supersededBy, 'v2')
  assert.equal(v3.shotVersion, 3)
})

test('REQ-040 A normalizeCanvasView：waterfall 缺省 = 开（D1 默认主视图），显式 false 保真落盘', () => {
  const on = normalizeCanvasView({ x: 1, y: 2, scale: 1, layersOpen: false, minimapVisible: false, waterfall: true, waterfallShowText: true, waterfallOrder: ['b', 'a'] })
  assert.equal(on.waterfall, true)
  assert.equal(on.waterfallShowText, true)
  assert.deepEqual(on.waterfallOrder, ['b', 'a'])

  const missing = normalizeCanvasView({})
  assert.equal(missing.waterfall, true, '缺省 = 开（历程视图为默认主视图，老文档零迁移进历程）')
  assert.equal(missing.waterfallShowText, undefined)
  assert.equal(missing.waterfallOrder, undefined)

  const invalid = normalizeCanvasView({ waterfall: 'yes', waterfallShowText: 1, waterfallOrder: ['b', 3] })
  assert.equal(invalid.waterfall, true, '非布尔丢弃 → 回落缺省（开）')
  assert.equal(invalid.waterfallShowText, undefined, '非布尔丢弃')
  assert.equal(invalid.waterfallOrder, undefined, '混入非字符串整体丢弃')

  const falseIsOff = normalizeCanvasView({ waterfall: false })
  assert.equal(falseIsOff.waterfall, false, '显式 false 保真落盘（「切到自由画布」的选择必须可记忆）')
})

test('REQ-040 A 状态统计：全局/节/托盘三层数据 + 活动行摘要（判据 = isLoading / error 瞬态字段）', () => {
  const card = cardNode('card1', 1)
  const kfDone = node('kfDone', { toolName: 'image_generate', sourceIds: ['card1'] })
  const kfRunning = node('kfRunning', { toolName: 'image_generate', sourceIds: ['card1'], isLoading: true })
  const videoFail = videoNode('videoFail', { sourceIds: ['card1'], error: 'CS-GEN-500' })
  const bgm = node('bgm', { kind: 'audio', toolName: 'music_generation', isLoading: true })
  const layout = computeWaterfallLayout([card, kfDone, kfRunning, videoFail, bgm])

  // 全局：total 5 = done 2（card/kfDone）+ running 2（kfRunning/bgm）+ failed 1。
  assert.deepEqual(layout.stats, { total: 5, done: 2, running: 2, failed: 1 }, '全局统计三态口径')
  assert.deepEqual([...layout.runningIds].sort(), ['bgm', 'kfRunning'], 'runningIds = 全部 isLoading 节点')
  assert.ok(layout.activity.includes('kfRunning'), '活动行取第一个生成中节点')
  assert.ok(layout.activity.includes('等 2 个'), '多个生成中附「等 N 个」')

  // 托盘层：镜 1 = 卡(done) + 关键帧(done/running) + 视频(failed)。
  const tray = trayOf(layout, 1)
  assert.deepEqual(tray.stats, { total: 4, done: 2, running: 1, failed: 1 }, '托盘统计')
  // 节层：分镜节 4 项；音频节 1 项 1 生成中。
  assert.deepEqual(sectionOf(layout, 'shots').stats, { total: 4, done: 2, running: 1, failed: 1 }, '分镜节统计')
  assert.deepEqual(sectionOf(layout, 'audio').stats, { total: 1, done: 0, running: 1, failed: 0 }, '音频节统计')

  // 空闲：无生成/失败 → activity null。
  const idle = computeWaterfallLayout([card, kfDone])
  assert.equal(idle.activity, null, '空闲无活动行')
  assert.deepEqual(idle.stats, { total: 2, done: 2, running: 0, failed: 0 })

  // 失败中又在生成（重试在途）：isLoading 优先，不重复计数。
  const retrying = computeWaterfallLayout([videoNode('v', { isLoading: true, error: '旧错误' })])
  assert.deepEqual(retrying.stats, { total: 1, done: 0, running: 1, failed: 0 }, 'isLoading 优先于 error')
})

test('REQ-040 A 视口档位：thumbWidthFromViewport 阶梯 + 钳制', () => {
  assert.equal(thumbWidthFromViewport(0), 240, '零宽兜底最小档')
  assert.equal(thumbWidthFromViewport(500), 240)
  assert.equal(thumbWidthFromViewport(900), 300)
  assert.equal(thumbWidthFromViewport(1300), 380)
  assert.equal(thumbWidthFromViewport(1800), 480)
  assert.equal(thumbWidthFromViewport(4000), 480, '大屏钳上限')
})
