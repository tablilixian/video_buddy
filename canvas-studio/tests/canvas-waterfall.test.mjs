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
import { computeWaterfallLayout } from '../lib/canvas-waterfall.js'
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

/** 最小节点壳：布局只读 id/kind/title/toolName/origin/sourceIds/supersededBy/createdAt（x/y/w/h 不进算法，进纯度校验）。 */
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
  // 镜内产物按 role：关键帧 → 视频 → 末帧 → 配音（卡在头部不算格）。
  const tray2Ids = trayOf(layout, 2).nodeIds
  const idx = (id) => tray2Ids.indexOf(id)
  assert.ok(idx('kf2') < idx('video2'), '关键帧在视频前')
  assert.ok(idx('video2') < idx('frame2'), '视频在末帧前')
  assert.ok(idx('frame2') < idx('voice2'), '末帧在配音前')
  // 位置次序与 nodeIds 一致（y 单调）。
  assert.ok(layout.boxes.get('kf2').y < layout.boxes.get('video2').y
    || (layout.boxes.get('kf2').y === layout.boxes.get('video2').y
      && layout.boxes.get('kf2').x < layout.boxes.get('video2').x), '网格次序可读')
  // 卡的盒子 = 托盘头部区（高 = TRAY_HEAD_H 语义：比缩略格矮）。
  assert.ok(layout.boxes.get('card2').height < layout.boxes.get('kf2').height, '卡为扁头部')
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
  assert.deepEqual(imports, ['./contracts/canvas.js', './canvas-view.js'],
    'canvas-waterfall 只许依赖 contracts 与 canvas-view（纯函数不许长出 IO / Host 依赖）')
  assert.ok(WF_CODE.includes('export function computeWaterfallLayout'), '唯一入口')
  assert.ok(VIEW_CODE.includes('deriveShotSemantics(nodes)'), '整理布局已切换到共享镜号语义（抽取干净，无第二份实现）')
})

test('REQ-036 normalizeCanvasView：waterfall 三字段合法保留、非法丢弃、缺省关闭（老文档零迁移）', () => {
  const on = normalizeCanvasView({ x: 1, y: 2, scale: 1, layersOpen: false, minimapVisible: false, waterfall: true, waterfallShowText: true, waterfallOrder: ['b', 'a'] })
  assert.equal(on.waterfall, true)
  assert.equal(on.waterfallShowText, true)
  assert.deepEqual(on.waterfallOrder, ['b', 'a'])

  const off = normalizeCanvasView({})
  assert.equal(off.waterfall, undefined, '缺省 = 关闭（字段不落盘，等价 false）')
  assert.equal(off.waterfallShowText, undefined)
  assert.equal(off.waterfallOrder, undefined)

  const invalid = normalizeCanvasView({ waterfall: 'yes', waterfallShowText: 1, waterfallOrder: ['b', 3] })
  assert.equal(invalid.waterfall, undefined, '非布尔丢弃')
  assert.equal(invalid.waterfallShowText, undefined, '非布尔丢弃')
  assert.equal(invalid.waterfallOrder, undefined, '混入非字符串整体丢弃')

  const falseIsOff = normalizeCanvasView({ waterfall: false })
  assert.equal(falseIsOff.waterfall, undefined, 'false 与缺省同形（关闭态不冗余落盘）')
})
