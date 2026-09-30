/**
 * REQ-003 Step 3 / E 组：就地编辑浮层的放置求解器（纯函数直连）。
 *
 * 机器判据（方案 §6 E1~E7 行）：
 * - 四侧择优顺序 right → left → below → above；
 * - 面板 ⊆ 安全区（8px 边距 + bottomInset 让位）**且** 面板 ∩ 节点 = ∅ ——
 *   这是"贴近而不压住"的硬约束，用**遍历枚举配置**断言；
 * - 最小平移：|pan| ≤ 理论最小值、<4px 归零、scale 永不被改动；
 * - 窄窗降级 sheet：只垂直抬节点且不抬出视口顶；
 * - 节点完全在视口外 ⇒ visible=false。
 *
 * ⚠️ 输入矩形与渲染同一份节点数据（方案 §9 表 1 的教训）：这里的节点坐标
 * 只有一份，屏算换算全部走求解器自己。
 *
 * 运行：corepack yarn test:smoke（先 corepack yarn build —— 从 ../lib 导入）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EDITOR_SHEET_BREAKPOINT, EDITOR_SHEET_RATIO, editorPlacement } from '../lib/canvas-view.js'

const VIEWPORT = { width: 1280, height: 800 }
const PANEL = { width: 396, height: 400 }
const NODE_SIZE = { width: 210, height: 196 }
const MARGIN = 8
const GAP = 8

/** 把画布节点摆到期望的屏幕位置（view 反推，保证"求解器输入 = 渲染坐标"）。 */
function viewFor(node, screenX, screenY, scale = 1) {
  return { x: screenX - node.x * scale, y: screenY - node.y * scale, scale }
}

function nodeAt(screenX, screenY, size = NODE_SIZE) {
  // 画布坐标随意（非零更有代表性），屏幕位置由 view 摆出来。
  const node = { x: 900, y: 700, ...size }
  return { node, view: viewFor(node, screenX, screenY) }
}

function assertSafeAndClear(placement, nodeScreen) {
  const { rect } = placement
  assert.ok(rect.x >= MARGIN, `面板左缘 ${rect.x} 越过安全边距`)
  assert.ok(rect.y >= MARGIN, `面板上缘 ${rect.y} 越过安全边距`)
  assert.ok(rect.x + rect.width <= VIEWPORT.width - MARGIN, `面板右缘 ${rect.x + rect.width} 越出视口`)
  assert.ok(rect.y + rect.height <= VIEWPORT.height - MARGIN, `面板下缘 ${rect.y + rect.height} 越出视口`)
  const overlaps = rect.x < nodeScreen.x + nodeScreen.width && nodeScreen.x < rect.x + rect.width
    && rect.y < nodeScreen.y + nodeScreen.height && nodeScreen.y < rect.y + rect.height
  assert.equal(overlaps, false, `面板压住了节点：rect=${JSON.stringify(rect)} node=${JSON.stringify(nodeScreen)}`)
}

test('E1 择优顺序：居中 → 右；贴右缘 → 左；贴左缘 → 右；两侧无空 → 下/上', () => {
  // 居中：右侧有足够空间。
  const centered = nodeAt((VIEWPORT.width - NODE_SIZE.width) / 2, (VIEWPORT.height - NODE_SIZE.height) / 2)
  const right = editorPlacement(centered.node, centered.view, VIEWPORT, PANEL, false)
  assert.equal(right.side, 'right')
  assert.deepEqual(right.pan, { dx: 0, dy: 0 })
  assertSafeAndClear(right, { x: (VIEWPORT.width - NODE_SIZE.width) / 2, y: (VIEWPORT.height - NODE_SIZE.height) / 2, ...NODE_SIZE })

  // 贴右缘：右侧放不下换左侧（左右放置恒不遮挡节点）。
  const rightEdge = nodeAt(VIEWPORT.width - NODE_SIZE.width - 10, 300)
  const left = editorPlacement(rightEdge.node, rightEdge.view, VIEWPORT, PANEL, false)
  assert.equal(left.side, 'left')
  assertSafeAndClear(left, { x: VIEWPORT.width - NODE_SIZE.width - 10, y: 300, ...NODE_SIZE })

  // 贴左缘：左侧放不下换右侧。
  const leftEdge = nodeAt(10, 300)
  const backToRight = editorPlacement(leftEdge.node, leftEdge.view, VIEWPORT, PANEL, false)
  assert.equal(backToRight.side, 'right')
  assertSafeAndClear(backToRight, { x: 10, y: 300, ...NODE_SIZE })

  // 横向两侧都放不下（宽节点）且节点偏上 → below（下方容得下 400 高的面板）。
  const wide = { x: 900, y: 700, width: 900, height: 196 }
  const wideView = viewFor(wide, 200, 150)
  const below = editorPlacement(wide, wideView, VIEWPORT, PANEL, false)
  assert.equal(below.side, 'below')
  assertSafeAndClear(below, { x: 200, y: 150, ...{ width: 900, height: 196 } })

  // 横向放不下 + 贴底 → above。
  const wideBottom = { x: 900, y: 700, width: 900, height: 196 }
  const wideBottomView = viewFor(wideBottom, 200, 594)
  const above = editorPlacement(wideBottom, wideBottomView, VIEWPORT, PANEL, false)
  assert.equal(above.side, 'above')
  assertSafeAndClear(above, { x: 200, y: 594, ...{ width: 900, height: 196 } })
})

test('E2 夹取：上下兜底矩形也完整落在安全区内，bottomInset 让出抽屉高度', () => {
  // 贴底节点 + 宽节点 → above；面板底部不得越过 (height - inset - margin)。
  const bottomInset = 220
  const wideBottom = { x: 900, y: 700, width: 900, height: 196 }
  const view = viewFor(wideBottom, 200, VIEWPORT.height - 220 - NODE_SIZE.height)
  const placement = editorPlacement(wideBottom, view, VIEWPORT, PANEL, false, bottomInset)
  assert.ok(placement.rect.y + placement.rect.height <= VIEWPORT.height - bottomInset - MARGIN,
    '面板下缘必须给详情抽屉让位')
  assert.ok(placement.rect.y >= MARGIN)
})

test('E3 最小平移：位移恰为补齐缺口的最小值，scale 不动，<4px 归零', () => {
  // 宽节点横竖都放不下 → 平移画布把右侧腾出来。
  const big = { x: 900, y: 700, width: 900, height: 196 }
  const view = viewFor(big, 180, 302)
  const placement = editorPlacement(big, view, VIEWPORT, PANEL, false)
  // 节点屏幕左缘 180，宽 900：要给右侧腾出 panel+gap=404，节点须左移 212；
  // 但节点左缘不得推出视口（≥8）⇒ 最大左移 172，位移有界。
  assert.equal(placement.pan.dx, -172)
  // 平移不改缩放，也不修改入参（纯函数）。
  assert.equal(view.scale, 1)
  // 死区：缺口只有 3px 时不平移（比不动更烦人的微抖动直接归零）。
  const tight = { x: 900, y: 700, width: 600, height: 196 }
  const tightView = viewFor(tight, 271, 300)
  const deadzone = editorPlacement(tight, tightView, VIEWPORT, PANEL, false)
  assert.deepEqual(deadzone.pan, { dx: 0, dy: 0 })
  assert.equal(deadzone.side, 'right')
  // 平移后矩形仍然安全且不压节点（大节点兜底走上下 + 二次平移）。
  assertSafeAndClear(placement, { x: 180 + placement.pan.dx, y: 302 + placement.pan.dy, ...{ width: 900, height: 196 } })
})

test('E6 窄窗降级：sheet 底部抽屉 + 只垂直抬节点，不抬出视口顶', () => {
  assert.equal(EDITOR_SHEET_BREAKPOINT, 720)
  const narrowViewport = { width: 640, height: 800 }
  const node = { x: 900, y: 700, ...NODE_SIZE }
  // 节点在抽屉区域内的屏幕位置（y=500，抽屉上缘 = 800 - 46% = 432）。
  const view = viewFor(node, 200, 500)
  const placement = editorPlacement(node, view, narrowViewport, PANEL, true)
  assert.equal(placement.mode, 'sheet')
  assert.equal(placement.side, 'below')
  // 抽屉占满宽度、高约 46%。
  assert.equal(placement.rect.x, 8)
  assert.equal(Math.round(placement.rect.height / narrowViewport.height), Math.round(EDITOR_SHEET_RATIO))
  // 只垂直平移，把节点抬到抽屉之上。
  assert.equal(placement.pan.dx, 0)
  const lifted = { x: 200, y: 500 + placement.pan.dy, ...NODE_SIZE }
  assert.ok(lifted.y + lifted.height <= placement.rect.y, '节点必须被抬到抽屉之上')
  assert.ok(lifted.y >= 8, '节点不得被抬出视口顶')
  assert.equal(view.scale, 1)
})

test('E7 节点完全在视口外 ⇒ visible=false（调用方不渲染）', () => {
  const node = { x: 900, y: 700, ...NODE_SIZE }
  const view = viewFor(node, -500, 200)
  const placement = editorPlacement(node, view, VIEWPORT, PANEL, false)
  assert.equal(placement.visible, false)
})

test('E1×E2 硬约束矩阵：位置 × 缩放 × 窄窗 全组合下面板安全且不压节点', () => {
  const positions = [
    ['center', (VIEWPORT.width - NODE_SIZE.width) / 2, (VIEWPORT.height - NODE_SIZE.height) / 2],
    ['left-edge', 10, 240],
    ['right-edge', VIEWPORT.width - NODE_SIZE.width - 10, 240],
    ['bottom', 500, VIEWPORT.height - NODE_SIZE.height - 10],
    ['corner', VIEWPORT.width - NODE_SIZE.width - 8, VIEWPORT.height - NODE_SIZE.height - 8],
  ]
  for (const scale of [0.5, 1]) {
    // 节点的**屏幕**尺寸随缩放变 —— 遮挡判定必须用缩放后的矩形（渲染是同一份数据）。
    const nodeW = NODE_SIZE.width * scale
    const nodeH = NODE_SIZE.height * scale
    for (const narrow of [false, true]) {
      for (const [name, screenX, screenY] of positions) {
        const node = { x: 900, y: 700, ...NODE_SIZE }
        const view = viewFor(node, screenX, screenY, scale)
        const placement = editorPlacement(node, view, VIEWPORT, PANEL, narrow)
        assert.equal(placement.visible, true, `${name}@${scale} narrow=${narrow} 应可见`)
        if (narrow) {
          assert.equal(placement.mode, 'sheet', `${name}@${scale} 窄窗必须降级 sheet`)
          assert.equal(placement.rect.x + placement.rect.width <= VIEWPORT.width - MARGIN, true)
          assert.equal(placement.rect.y + placement.rect.height <= VIEWPORT.height - MARGIN, true)
          assert.equal(placement.pan.dx, 0, `${name}@${scale} 窄窗只允许垂直平移`)
          const lifted = { x: screenX, y: screenY + placement.pan.dy, width: nodeW, height: nodeH }
          const overlaps = placement.rect.x < lifted.x + lifted.width && lifted.x < placement.rect.x + placement.rect.width
            && placement.rect.y < lifted.y + lifted.height && lifted.y < placement.rect.y + placement.rect.height
          assert.equal(overlaps, false, `${name}@${scale} 窄窗下抽屉压住了节点`)
        } else {
          assertSafeAndClear(placement, { x: screenX, y: screenY, width: nodeW, height: nodeH })
        }
      }
    }
  }
})
