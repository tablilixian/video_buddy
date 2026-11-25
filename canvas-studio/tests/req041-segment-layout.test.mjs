/**
 * REQ-041 · 一行一镜**段产物格**守卫（2026-11-25 真机纠正）。
 *
 * ## 被纠正的错误形态
 *
 * 上一版把段视频画进分镜卡的体区。卡片在历程视图里只有 380×214，段画面是
 * 960×540 —— 正文一展开，画面被压成一条亮带、文字骑在上面。真机截图就是这个。
 * 结构上放错了格子，样式补不回来（那一版试过 min-height + 压选中态展开）。
 *
 * ## 正确口径（用户 2026-11-25 原话）
 *
 * 分镜托盘一行 = 文字卡 → 关键帧 → 视频 → 音频（→ 末帧）。段产物属于「视频」
 * 那一格：卡回纯文案，视频回视频位。
 *
 * 本闸钉行为，不钉实现：
 *   ① 有可播段 ⇒ 行内多一格，落在「视频」位，且**不是节点**（无 positions）；
 *   ② 无可播段 ⇒ 行形态与改前**逐字相同**（空清单不许凭空造空格）；
 *   ③ 有镜视频时两者并排：镜视频 → 段 → 配音；
 *   ④ 卡面不许再把段视频画回体区（源码闸，防复活）。
 *
 * 运行：corepack yarn test:smoke（import lib 产物，需先 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeWaterfallLayout, segmentCellId } from '../lib/canvas-waterfall.js'

const here = dirname(fileURLToPath(import.meta.url))
const readSource = (rel) => readFileSync(join(here, '..', rel), 'utf8')
/** 去注释切片：断言只看声明本体，不被注释里的说明文字骗过。 */
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const STYLES = codeOnly(readSource('src/client/styles.ts'))
const NODE_SRC = codeOnly(readSource('src/client/canvas/CanvasNode.tsx'))

let seq = 0
const node = (id, extra = {}) => ({
  id, kind: 'image', title: id, x: 0, y: 0, width: 260, height: 180,
  zIndex: 0, createdAt: ++seq * 10, origin: 'agent', sourceIds: [], ...extra,
})
const cardNode = (id, shot, extra = {}) =>
  node(id, { kind: 'text', toolName: 'submit_storyboard_for_approval', title: `分镜 ${shot} · 机位`, ...extra })
const videoNode = (id, extra = {}) => node(id, { kind: 'video', toolName: 'video_composite', ...extra })
const voiceNode = (id, extra = {}) => node(id, { kind: 'audio', toolName: 'tts_voiceover', ...extra })

const trayOf = (layout, shot) => layout.trays.find(tray => tray.shot === shot)

test('① 有可播段：行内多一格，落在卡后第一位，且不是节点', () => {
  const card = cardNode('card1', 1, { segmentRef: 'spec:s1' })
  const layout = computeWaterfallLayout([card], {
    thumbWidth: 380,
    segmentRefsWithMedia: new Set(['spec:s1']),
  })
  const tray = trayOf(layout, 1)
  assert.deepEqual(tray.nodeIds, ['card1', segmentCellId(1)], '卡之后就是段产物格')
  assert.equal(layout.segmentCells.length, 1, '段产物格必须交出来给渲染层')
  assert.equal(layout.segmentCells[0].ref, 'spec:s1', '格子要带 ref —— 渲染层按它去清单取 URL')
  assert.equal(layout.segmentCells[0].shot, 1, '格子要知道自己是哪一镜（浮层标题 / 角标）')

  // 不是节点：不进 positions（那里放的是「能拖能选」的坐标），但进 boxes（要画）。
  assert.ok(layout.boxes.has(segmentCellId(1)), '格位必须进 boxes，否则画不出来')
  assert.equal(layout.positions.has(segmentCellId(1)), false, '合成格不许进 positions：它不是节点')

  // 格位尺寸与媒体格同口径（16:9），否则同一行里高一截低一截。
  const cardBox = layout.boxes.get('card1')
  const segBox = layout.boxes.get(segmentCellId(1))
  assert.equal(segBox.width, cardBox.width, '同宽')
  assert.equal(segBox.height, Math.round(380 * 9 / 16), '段产物格按 16:9 定高')
  assert.equal(segBox.x - cardBox.x, 380 + 24, '紧贴卡右侧（格宽 + 间距）')
})

test('② 无可播段：行形态与改前逐字相同（空清单不许凭空造格）', () => {
  const card = cardNode('card1', 1, { segmentRef: 'spec:s1' })
  const voice = voiceNode('v1', { sourceIds: ['card1'] })
  const base = computeWaterfallLayout([card, voice], { thumbWidth: 380 })
  assert.deepEqual(base.segmentCells, [], '没给清单 = 没有段格')
  assert.deepEqual(trayOf(base, 1).nodeIds, ['card1', 'v1'], '行内仍只有卡与配音')

  // 清单到了但这一镜的 ref 不在里面（别的镜渲过、这一镜没渲）—— 同样不出格。
  const partial = computeWaterfallLayout([card, voice], {
    thumbWidth: 380,
    segmentRefsWithMedia: new Set(['spec:s9']),
  })
  assert.deepEqual(partial.segmentCells, [], 'ref 未命中不许出空格')
  assert.deepEqual(trayOf(partial, 1).nodeIds, ['card1', 'v1'], '行形态不受影响')
})

test('③ 有镜视频时并排：镜视频 → 段产物 → 配音（段不抢卡的位置，也不抢配音的位置）', () => {
  const card = cardNode('card1', 1, { segmentRef: 'spec:s1' })
  const keyframe = node('kf1', { toolName: 'image_generate', sourceIds: ['card1'] })
  const video = videoNode('vid1', { sourceIds: ['card1'] })
  const voice = voiceNode('v1', { sourceIds: ['card1'] })
  const layout = computeWaterfallLayout([card, keyframe, video, voice], {
    thumbWidth: 380,
    segmentRefsWithMedia: new Set(['spec:s1']),
  })
  assert.deepEqual(
    trayOf(layout, 1).nodeIds,
    ['card1', 'kf1', 'vid1', segmentCellId(1), 'v1'],
    '格序必须是 卡 → 关键帧 → 镜视频 → 段 → 配音',
  )
})

test('④ 卡面不许把段视频画回体区（防复活：格子放得对，样式补丁就没人需要了）', () => {
  assert.ok(!STYLES.includes('csNodeSegmentVideoBox'), '卡内段视频框的样式复活了 —— 那正是「视频压成一条」的形态')
  assert.ok(!NODE_SRC.includes('segmentVideoUrl'), 'CanvasNode 又接了段视频：段产物只能由 SegmentCell 渲染')
  // 画面完整：段产物格必须 contain —— cover 会把字幕所在的下缘裁掉。
  const media = STYLES.match(/\.csSegmentCell \.csNodeMedia\s*\{([^}]*)\}/)
  assert.ok(media, '.csSegmentCell .csNodeMedia 规则不见了')
  assert.ok(/object-fit:\s*contain/.test(media[1]), '段产物格必须 object-fit: contain：cover 会裁掉画面上下的字幕/角标')
  // 反向：CV-081 的长文展开能力不许被顺手删（上一版为压重叠动过它）。
  const cv081 = STYLES.match(/(?:^|\n)\.csNodeSelected\s+\.csNodeBody\s*\{([^}]*)\}/)
  assert.ok(cv081, 'CV-081 通用选中展开规则整条不见了')
  assert.ok(/line-clamp:\s*unset/.test(cv081[1]), 'CV-081 被连带删掉：长分镜稿/脚本将无法在选中态展开阅读')
})

test('⑤ 文字卡完整显示正文 + 卡内可滚（不许再钳两行）', () => {
  const rule = STYLES.match(/\.csWaterfall \.csNode:has\(\.csNodeText\) \.csNodeBody\s*\{([^}]*)\}/)
  assert.ok(rule, '历程视图的正文规则不见了：分镜稿会退回自由画布的 12 行折叠')
  assert.ok(/display:\s*block/.test(rule[1]), '正文必须是块级流：-webkit-box 下钳制无法解除')
  assert.ok(/overflow-y:\s*auto/.test(rule[1]), '正文必须可滚：用户口径是「显示不下滚轮查看」')
  assert.ok(/min-height:\s*0/.test(rule[1]), '缺 min-height:0 时 flex 子项顶到内容高，滚动条永远不出现')
  assert.ok(!/max-height:\s*\d/.test(rule[1]), '又钳高度了：完整显示是 2026-11-25 的明确口径（推翻 REQ-036 两行）')
  assert.ok(!/-webkit-line-clamp:\s*\d/.test(rule[1]), '又按行数截断了')
})

test('⑥ 滚轮在正文里滚正文，不劫持成画布缩放（未选中也算）', () => {
  const surface = codeOnly(readSource('src/client/canvas/CanvasSurface.tsx'))
  const closest = surface.match(/closest<HTMLElement>\('([^']*)'\)/)
  assert.ok(closest, 'wheel 的可滚判定不见了')
  assert.ok(closest[1].includes('.csNodeBody'), '豁免必须覆盖正文')
  assert.ok(!closest[1].includes('.csNodeSelected'),
    '豁免绑在选中态上：历程视图未选中的文字卡一滚就变成缩放，用户根本滚不动分镜稿')
  assert.ok(/overflowY\s*!==\s*'hidden'/.test(surface),
    '缺 overflowY 检查：A-5 折叠态（overflow:hidden）会被当成可滚而放行，结果既不滚也不缩放')
})

test('⑦ 有则显示、缺则左移：格序不按列占位，缺一格后面补上前', () => {
  const card = cardNode('card1', 1, { segmentRef: 'spec:s1' })
  const video = videoNode('vid1', { sourceIds: ['card1'] })
  const voice = voiceNode('v1', { sourceIds: ['card1'] })
  // 这一镜没有关键帧 —— 镜视频必须直接贴住卡右，中间不许留「关键帧的空位」。
  const layout = computeWaterfallLayout([card, video, voice], {
    thumbWidth: 380,
    segmentRefsWithMedia: new Set(['spec:s1']),
  })
  const tray = trayOf(layout, 1)
  assert.deepEqual(tray.nodeIds, ['card1', 'vid1', segmentCellId(1), 'v1'], '缺关键帧时空位必须被后面的格补上')
  const xs = tray.nodeIds.map(id => layout.boxes.get(id).x)
  for (let i = 1; i < xs.length; i += 1) {
    assert.equal(xs[i] - xs[i - 1], 380 + 24, `第 ${i + 1} 格没贴住前一格（x=${xs[i]}）：中间留了空位`)
  }
  // 反向：这一镜没有段产物时，配音必须紧贴镜视频，不许留着段格的位置。
  const noSeg = computeWaterfallLayout([card, video, voice], { thumbWidth: 380 })
  const xs2 = trayOf(noSeg, 1).nodeIds.map(id => noSeg.boxes.get(id).x)
  for (let i = 1; i < xs2.length; i += 1) {
    assert.equal(xs2[i] - xs2[i - 1], 380 + 24, '没段产物时也不许留空位')
  }
})
