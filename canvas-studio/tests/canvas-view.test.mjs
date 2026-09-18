/**
 * canvas-view 纯函数冒烟测试：视口规范化（canvas.json v3）与无重叠整理布局。
 * 直连 Host tsc 编译产物 lib/canvas-view.js。运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clampViewScale,
  computeArrangeLayout,
  groupBoxOf,
  GROUP_HEAD_HEIGHT,
  GROUP_PADDING,
  GROUP_TIDY_GAP,
  normalizeCanvasView,
  normalizeGroupBoxes,
  singleMemberGroupOf,
  tidyGroupLayout,
} from '../lib/canvas-view.js'

test('normalizeCanvasView：缺失/非法输入回退默认值', () => {
  assert.equal(normalizeCanvasView(undefined), undefined)
  assert.equal(normalizeCanvasView(null), undefined)
  assert.equal(normalizeCanvasView('nope'), undefined)
  const view = normalizeCanvasView({ x: 'bad', y: 12, scale: 999, layersOpen: 'x' })
  assert.deepEqual(view, { x: 0, y: 12, scale: 5, layersOpen: false, minimapVisible: false })
})

test('clampViewScale：限制在 0.1–5', () => {
  assert.equal(clampViewScale(0.01), 0.1)
  assert.equal(clampViewScale(1), 1)
  assert.equal(clampViewScale(50), 5)
})

/** 构造一个画布节点（其余字段对布局无关，给最小合法值）。 */
function node(id, x, y, width, height, extra = {}) {
  return {
    id,
    kind: 'image',
    url: `/assets/${id}.png`,
    x,
    y,
    width,
    height,
    createdAt: 1000,
    origin: 'agent',
    sourceIds: [],
    ...extra,
  }
}

test('computeArrangeLayout：任意尺寸都不重叠', () => {
  const nodes = [
    node('a', 0, 0, 260, 180),
    node('b', 10, 10, 800, 600),
    node('c', -500, -500, 120, 90),
    node('d', 30, 30, 220, 140),
    node('e', 60, 60, 320, 220),
    node('f', 90, 90, 150, 400),
    node('g', 120, 120, 700, 100),
  ]
  const positions = computeArrangeLayout(nodes)
  assert.equal(positions.size, nodes.length)
  const placed = nodes.map(n => ({ id: n.id, ...positions.get(n.id), width: n.width, height: n.height }))
  for (let i = 0; i < placed.length; i += 1) {
    const left = placed[i]
    assert.ok(left.x !== undefined && Number.isFinite(left.y), `${left.id} 有坐标`)
    for (let j = i + 1; j < placed.length; j += 1) {
      const right = placed[j]
      const separated = left.x + left.width <= right.x
        || right.x + right.width <= left.x
        || left.y + left.height <= right.y
        || right.y + right.height <= left.y
      assert.ok(separated, `${left.id} 与 ${right.id} 不重叠`)
    }
  }
})

test('computeArrangeLayout：组节点随行，子图层保持相对位置', () => {
  const group = node('g', 100, 100, 500, 400, { kind: 'group', title: '分组' })
  const childA = node('a', 120, 120, 200, 150, { parentId: 'g' })
  const childB = node('b', 350, 200, 180, 130, { parentId: 'g' })
  const free = node('f', 0, 0, 260, 180)
  const positions = computeArrangeLayout([group, childA, childB, free])
  // 组与自由节点都被移动；子图层跟随组的位移。
  const groupDeltaX = positions.get('g').x - group.x
  const groupDeltaY = positions.get('g').y - group.y
  assert.notEqual(groupDeltaX, 0)
  assert.equal(positions.get('a').x, childA.x + groupDeltaX)
  assert.equal(positions.get('a').y, childA.y + groupDeltaY)
  assert.equal(positions.get('b').x, childB.x + groupDeltaX)
  assert.equal(positions.get('b').y, childB.y + groupDeltaY)
  // 组盒子仍包裹子图层（相对位置不变 → 包裹性不变）。
  const g = positions.get('g')
  const a = positions.get('a')
  assert.ok(a.x >= g.x && a.y >= g.y)
})

test('computeArrangeLayout：空列表返回空映射', () => {
  assert.equal(computeArrangeLayout([]).size, 0)
})

test('computeArrangeLayout：按制作流程阶段分列（创意在左、成片在右）', () => {
  // 创意（stage 1）→ 剧本（stage 2）→ 成片（stage 7），构成一条工作流链。
  const brief = node('brief', 0, 0, 260, 180, { toolName: 'user_brief' })
  const screenplay = node('sc', 0, 0, 260, 180, { toolName: 'write_screenplay', sourceIds: ['brief'] })
  const composed = node('out', 0, 0, 260, 180, { toolName: 'compose', sourceIds: ['sc'] })
  const positions = computeArrangeLayout([brief, screenplay, composed])
  // 阶段越大越靠右：创意 x < 剧本 x < 成片 x。
  assert.ok(positions.get('brief').x < positions.get('sc').x, '创意在剧本左侧')
  assert.ok(positions.get('sc').x < positions.get('out').x, '剧本在成片左侧')
  // 同阶段节点落在同一列（x 相等）。
  const twinA = node('a', 0, 0, 260, 180, { toolName: 'user_brief' })
  const twinB = node('b', 0, 0, 260, 180, { toolName: 'user_brief' })
  const twinPos = computeArrangeLayout([twinA, twinB, brief])
  assert.equal(twinPos.get('a').x, twinPos.get('b').x, '同阶段节点同列')
  // 纵向不重叠（同列两个节点 y 不同）。
  assert.notEqual(twinPos.get('a').y, twinPos.get('b').y, '同列节点纵向堆叠')
})

/* ===================== CV-177：托盘（素材组）几何与整理 =====================
   托盘 = kind='group' 的容器节点。这一组纯函数是 Host（生成时自动编组）与
   client（手动编组 / 整理托盘 / 载入规范化）的**同一份**实现 —— 改前几何算在
   两处（generate.ts 与 project-store.ts），加一条抓取带就会当场分叉。 */

/** 构造一个托盘节点。 */
function group(id, x, y, width, height, extra = {}) {
  return node(id, x, y, width, height, { kind: 'group', title: '分镜 1 · 素材', zIndex: -1, ...extra })
}

test('CV-177 groupBoxOf：托盘 = 成员包围盒 + 内边距 + 顶部抓取带', () => {
  const members = [node('a', 100, 200, 270, 528), node('b', 382, 200, 270, 528)]
  const box = groupBoxOf(members)
  // 跨度 = 100 → 652（两图并排 270 + 12 缝 + 270），不是间距。
  assert.deepEqual(box, {
    x: 100 - GROUP_PADDING,
    y: 200 - GROUP_PADDING - GROUP_HEAD_HEIGHT,
    width: 552 + GROUP_PADDING * 2,
    height: 528 + GROUP_PADDING * 2 + GROUP_HEAD_HEIGHT,
  })
  assert.equal(groupBoxOf([]), null, '空成员没有托盘几何（调用方各自处理）')
})

test('CV-177：托盘顶部抓取区 = 内边距 + 抓取带，单张也不缩水', () => {
  // 托盘没有 resize 把手，抓取区全靠代码给。这条盯的是**单张**这一档 ——
  // 改前单张托盘只比图片大 12px，缩放 50% 后只剩 6px，实际抓不住。
  const one = node('a', 0, 0, 270, 528)
  const box = groupBoxOf([one])
  assert.equal(one.y - box.y, GROUP_PADDING + GROUP_HEAD_HEIGHT, '成员头顶必须让出内边距 + 抓取带')
  assert.ok(GROUP_HEAD_HEIGHT >= 24, '抓取带不得低于 24px（50% 缩放下仍有 12px 可抓）')
})

test('CV-177 tidyGroupLayout：≤3 张排一行，更多排成接近正方形的网格', () => {
  const tray = group('g', 1000, 1000, 300, 600)
  const three = [
    node('a', 1000, 1036, 270, 528),
    node('b', 2000, 1036, 270, 528),
    node('c', 3000, 1036, 270, 528),
  ]
  const layout3 = tidyGroupLayout(tray, three)
  const xs3 = three.map(m => layout3.positions.get(m.id).x)
  assert.equal(new Set(three.map(m => layout3.positions.get(m.id).y)).size, 1, '三张排一行')
  assert.ok(xs3[0] < xs3[1] && xs3[1] < xs3[2], '行内从左到右')
  assert.equal(xs3[1] - xs3[0], 270 + GROUP_TIDY_GAP, '等间距')

  const four = [...three, node('d', 4000, 1036, 270, 528)]
  const layout4 = tidyGroupLayout(tray, four)
  assert.equal(new Set(four.map(m => layout4.positions.get(m.id).y)).size, 2, '四张排 2×2')
  assert.equal(new Set(four.map(m => layout4.positions.get(m.id).x)).size, 2, '四张两列')

  const five = [...four, node('e', 5000, 1036, 270, 528)]
  const layout5 = tidyGroupLayout(tray, five)
  assert.equal(new Set(five.map(m => layout5.positions.get(m.id).y)).size, 2, '五张 = 3 + 2 两行')
  const placed = five.map(m => ({ ...m, ...layout5.positions.get(m.id) }))
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const left = placed[i]
      const right = placed[j]
      const separated = left.x + left.width <= right.x || right.x + right.width <= left.x
        || left.y + left.height <= right.y || right.y + right.height <= left.y
      assert.ok(separated, `整理后 ${left.id} 与 ${right.id} 不得重叠`)
    }
  }
})

test('CV-177 tidyGroupLayout：锚在托盘上 —— 拖出去的成员被收回，单张即复位', () => {
  const tray = group('g', 1000, 1000, 300, 600)
  const home = node('a', 1000 + GROUP_PADDING, 1000 + GROUP_PADDING + GROUP_HEAD_HEIGHT, 270, 528)
  const strayed = node('b', 9000, 9000, 270, 528)
  const two = tidyGroupLayout(tray, [home, strayed])
  assert.deepEqual(two.positions.get('a'), { x: home.x, y: home.y }, '已在标准位的那张不动')
  const b = two.positions.get('b')
  assert.ok(b.x < 9000 && b.y < 9000, '被拖远的那张收回托盘内')
  // 「收回」必须是真的收进托盘覆盖范围，否则这个词名不副实。
  assert.ok(b.x >= two.box.x && b.y >= two.box.y)
  assert.ok(b.x + 270 <= two.box.x + two.box.width)
  assert.ok(b.y + 528 <= two.box.y + two.box.height)

  // 单张：整理 = 复位到托盘内的标准位置，并且幂等（对整理后的结果再整理不变）。
  const single = node('s', 7777, 7777, 270, 528)
  const one = tidyGroupLayout(tray, [single])
  const placed = one.positions.get('s')
  assert.deepEqual(placed, { x: tray.x + GROUP_PADDING, y: tray.y + GROUP_PADDING + GROUP_HEAD_HEIGHT })
  const again = tidyGroupLayout({ ...tray, ...one.box }, [{ ...single, ...placed }])
  assert.deepEqual(again.positions.get('s'), placed, '整理两次结果相同')
  assert.deepEqual(again.box, one.box, '托盘盒也幂等')
})

test('CV-177 tidyGroupLayout：阅读顺序 = 先上后下、同一行内先左后右', () => {
  const tray = group('g', 0, 0, 300, 600)
  // 故意把 createdAt 与视觉顺序**反着给**：顺序必须看位置，不看创建时间。
  const topLeft = node('tl', 1000, 1000, 270, 528, { createdAt: 9 })
  const topRight = node('tr', 1400, 1010, 270, 528, { createdAt: 1 })
  const lower = node('lo', 1000, 1600, 270, 528, { createdAt: 5 })
  const layout = tidyGroupLayout(tray, [lower, topRight, topLeft])
  const xs = ['tl', 'tr', 'lo'].map(id => layout.positions.get(id).x)
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2], '先上后下、行内先左后右')
  assert.equal(layout.positions.get('tl').y, layout.positions.get('lo').y, '三张排一行')
})

test('CV-177 normalizeGroupBoxes：老托盘补齐抓取带，且只扩张不收缩', () => {
  // 老几何（CV-079 时代：成员包围盒 + 12px，没有抓取带位置）。
  const legacy = group('g', 100 - GROUP_PADDING, 200 - GROUP_PADDING, 270 + GROUP_PADDING * 2, 528 + GROUP_PADDING * 2)
  const member = node('a', 100, 200, 270, 528, { parentId: 'g' })
  const fixed = normalizeGroupBoxes([member, legacy]).find(n => n.id === 'g')
  assert.equal(fixed.y, 200 - GROUP_PADDING - GROUP_HEAD_HEIGHT, '老托盘头顶必须补出抓取带')
  assert.equal(fixed.height, 528 + GROUP_PADDING * 2 + GROUP_HEAD_HEIGHT)

  // 幂等：对已经是新几何的托盘再跑一次，数值不变（不能每读一次盘就往上长 24px）。
  const again = normalizeGroupBoxes([member, fixed]).find(n => n.id === 'g')
  assert.deepEqual(
    { x: again.x, y: again.y, width: again.width, height: again.height },
    { x: fixed.x, y: fixed.y, width: fixed.width, height: fixed.height },
  )

  // 成员被单独拖到框外 → 框扩张包住它（与 attachShotGroup「只扩张」同一语义）。
  const strayed = node('b', 5000, 5000, 270, 528, { parentId: 'g' })
  const grown = normalizeGroupBoxes([member, strayed, fixed]).find(n => n.id === 'g')
  assert.ok(grown.x + grown.width >= 5000 + 270, '框必须包住被拖出去的成员')
  assert.ok(grown.y + grown.height >= 5000 + 528)

  // 没有组时原样返回（元素引用相等，供 React 省一次无关重渲染）。
  const plain = [node('x', 0, 0, 10, 10)]
  assert.equal(normalizeGroupBoxes(plain)[0], plain[0])
})

test('CV-177 singleMemberGroupOf：只有单成员托盘才算「拖成员 = 拖托盘」', () => {
  const tray = group('g', 0, 0, 300, 600)
  const only = node('a', GROUP_PADDING, GROUP_PADDING + GROUP_HEAD_HEIGHT, 270, 528, { parentId: 'g' })
  assert.equal(singleMemberGroupOf([tray, only], only)?.id, 'g', '单成员：拖成员等于拖托盘')
  const second = node('b', 300, 36, 270, 528, { parentId: 'g' })
  assert.equal(singleMemberGroupOf([tray, only, second], only), undefined, '多成员托盘保留成员独立拖动')
  const free = node('f', 0, 0, 10, 10)
  assert.equal(singleMemberGroupOf([tray, free], free), undefined, '没有托盘的节点不走代理')
  const orphan = node('o', 0, 0, 10, 10, { parentId: 'ghost' })
  assert.equal(singleMemberGroupOf([orphan], orphan), undefined, '托盘已删（悬空 parentId）不得当代理')
})
