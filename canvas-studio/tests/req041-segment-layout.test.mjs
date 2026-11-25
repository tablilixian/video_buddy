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
