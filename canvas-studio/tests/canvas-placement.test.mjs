/**
 * CV-184：画布落点唯一实现 + 「新节点带进视野」的守卫。
 *
 * 这一批的起因是「新生成的节点落点」有**四份实现**（Host 生成 / 成片 / 占位 /
 * 手动新建），三份是同一套裸数字的复制粘贴，且只有一份带血缘避让。这种重复
 * 不会报错，只会表现为「成片压在别人身上」「拖进来的 20 张图叠成一摞」——
 * 所以守卫分两层：
 *
 *   ① **静态**：落点只准在 canvas-placement.ts 里算，别处不得再出现裸网格；
 *   ② **行为**：无血缘落位必须避开已有节点（改造前它不查冲突，且 stepX(300)
 *      比 16:9 媒体节点(480) 还窄 —— 连「没删过节点」都必然重叠）。
 *
 * 另有 revealOffsetOf 的用例：它决定「生成完把镜头挪多少」，挪错的表现是
 * 「用户正在看的地方被莫名拽走」，比不挪更烦人。
 *
 * 运行：node --test tests/canvas-placement.test.mjs（需先 build，import 的是 lib 产物）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  PLACEMENT_GRID,
  boxesOverlap,
  deriveNodePlacement,
  placeSequence,
} from '../lib/canvas-placement.js'
import { revealOffsetOf } from '../lib/canvas-view.js'

const readSource = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

/** 只剥块注释与整行注释，不做行内剥除（`https://` 的 `//` 会长在行中间）。 */
const codeOnly = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

const GENERATE_CODE = codeOnly(readSource('../src/generate.ts'))
const COMPOSE_CODE = codeOnly(readSource('../src/compose.ts'))
const CLIENT_INDEX_CODE = codeOnly(readSource('../src/client/index.ts'))
const STORE_CODE = codeOnly(readSource('../src/client/project-store.ts'))
const FRAME_CODE = codeOnly(readSource('../src/client/StudioFrame.tsx'))
const SURFACE_CODE = codeOnly(readSource('../src/client/canvas/CanvasSurface.tsx'))
const PLACEMENT_CODE = codeOnly(readSource('../src/canvas-placement.ts'))

/** 最小节点壳：落点只读 id / x / y / width / height / sourceIds。 */
const at = (id, x, y, width, height, sourceIds = []) => ({
  id, x, y, width, height, sourceIds,
  kind: 'image', createdAt: 1, origin: 'agent',
})

/** 第 k 个网格格的左上角（与 PLACEMENT_GRID 同源，不在用例里手抄数字）。 */
const cell = (k) => ({
  x: PLACEMENT_GRID.origin + (k % PLACEMENT_GRID.columns) * PLACEMENT_GRID.stepX,
  y: PLACEMENT_GRID.origin + Math.floor(k / PLACEMENT_GRID.columns) * PLACEMENT_GRID.stepY,
})

test('CV-184 唯一实现：落点只准在 canvas-placement.ts 里算（四处各写一遍是这次的真因）', () => {
  assert.match(PLACEMENT_CODE, /export function deriveNodePlacement/,
    '唯一实现必须住在 canvas-placement.ts')
  assert.doesNotMatch(GENERATE_CODE, /export function deriveNodePlacement/,
    'generate.ts 不得再自带一份落点实现（它就是被收敛掉的那份）')

  for (const [name, src] of [['compose.ts', COMPOSE_CODE], ['client/index.ts', CLIENT_INDEX_CODE], ['project-store.ts', STORE_CODE]]) {
    assert.doesNotMatch(src, /LAYOUT\.(origin|stepX|stepY|columns)/,
      `${name} 不得再引用本地 LAYOUT 网格常量`)
    assert.doesNotMatch(src, /\(\s*\w*index\w*\s*%\s*4\s*\)\s*\*\s*300/,
      `${name} 不得再自己算网格落点（裸数字 4 列 / 300 步距）`)
    assert.match(src, /from '(\.\.\/|\.\/)canvas-placement\.js'/,
      `${name} 必须 import 共享落点模块`)
  }
})

test('CV-184 无血缘落位要避开已有节点（改造前 index 与「格子被占」毫无关系）', () => {
  const start = 1
  assert.equal(cell(start).x, 340, '用例自身前提：第 1 格在 x=340')
  const prior = [at('a', cell(start).x, cell(start).y, 260, 180)]

  const position = deriveNodePlacement(prior, [], 260, 180)
  assert.equal(boxesOverlap({ ...position, width: 260, height: 180 }, prior[0]), false,
    '新节点不得叠在已有节点上')
  assert.deepEqual(position, cell(start + 1), '应当顺延到下一个空位')
})

test('CV-184 stepX(300) 比 16:9 媒体节点(480) 窄：同尺寸连续落点必须错开', () => {
  const size = { width: 480, height: 318 }
  const first = deriveNodePlacement([], [], size.width, size.height)
  assert.deepEqual(first, cell(0), '空画布第一个落在首格')

  const second = deriveNodePlacement([at('a', first.x, first.y, size.width, size.height)], [], size.width, size.height)
  assert.equal(boxesOverlap({ ...second, ...size }, { ...first, ...size }), false,
    '480 宽的节点走 300 的步距会自重叠 —— 这正是成片叠成片的原因')
  assert.deepEqual(second, cell(2), '越过被占的中间格')
})

test('CV-184 有血缘落位：来源右缘 + 间隙；被占则整格右移', () => {
  const source = at('s', 40, 40, 260, 180)
  const first = deriveNodePlacement([source], ['s'], 480, 318)
  assert.equal(first.x, 40 + 260 + 60, 'x = 来源右缘 + 间隙')
  assert.equal(first.y, 40, 'y 对齐来源顶')

  const blocker = at('b', first.x, first.y, 480, 318)
  const second = deriveNodePlacement([source, blocker], ['s'], 480, 318)
  assert.equal(second.x, first.x + 480 + 60, '被挡后按「自身宽 + 间隙」整格右移')
  assert.equal(boxesOverlap({ ...second, width: 480, height: 318 }, blocker), false)
})

test('CV-184 多来源：x 取最右来源的右缘，y 取最上来源', () => {
  const nodes = [at('s1', 40, 400, 260, 180), at('s2', 700, 120, 260, 180)]
  const position = deriveNodePlacement(nodes, ['s1', 's2'], 360, 220)
  assert.equal(position.x, 700 + 260 + 60)
  assert.equal(position.y, 120)
})

test('CV-184 placeSequence：同一批节点互不重叠（拖 20 张图不再叠成一摞）', () => {
  const sizes = Array.from({ length: 20 }, () => ({ width: 480, height: 318 }))
  const positions = placeSequence([], sizes)
  assert.equal(positions.length, 20)
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = i + 1; j < positions.length; j += 1) {
      assert.equal(
        boxesOverlap({ ...positions[i], ...sizes[i] }, { ...positions[j], ...sizes[j] }),
        false,
        `第 ${i} 个与第 ${j} 个重叠了`,
      )
    }
  }
})

test('CV-184 boxesOverlap：贴边不算重叠（半开区间）', () => {
  const base = at('a', 0, 0, 100, 100)
  assert.equal(boxesOverlap({ x: 100, y: 0, width: 100, height: 100 }, base), false)
  assert.equal(boxesOverlap({ x: 99, y: 0, width: 100, height: 100 }, base), true)
})

test('CV-184 revealOffsetOf：已可见不动，出界只补差额，超视野且相交不动', () => {
  const view = { x: 0, y: 0, scale: 1 }
  const viewport = { width: 1000, height: 600 }
  const padding = 48

  assert.deepEqual(
    revealOffsetOf({ x: 100, y: 100, width: 200, height: 100 }, view, viewport, padding),
    { dx: 0, dy: 0 },
    '完整可见的节点不得移动镜头',
  )
  assert.deepEqual(
    revealOffsetOf({ x: -500, y: 100, width: 200, height: 100 }, view, viewport, padding),
    { dx: padding + 500, dy: 0 },
    '左侧出界：只补到内边距为止',
  )
  assert.deepEqual(
    revealOffsetOf({ x: 900, y: 100, width: 400, height: 100 }, view, viewport, padding),
    { dx: viewport.width - padding - 1300, dy: 0 },
    '右侧出界：负向补差额',
  )
  assert.deepEqual(
    revealOffsetOf({ x: 100, y: 100, width: 2000, height: 100 }, view, viewport, padding),
    { dx: 0, dy: 0 },
    '比视野还大但已经能看到一部分 → 不动（贴边等于把它自己挪出去）',
  )
  assert.deepEqual(
    revealOffsetOf({ x: 5000, y: 100, width: 2000, height: 100 }, view, viewport, padding),
    { dx: viewport.width / 2 - 6000, dy: 0 },
    '完全在视野外 → 居中（这是「生成完看不到产物」的唯一补救）',
  )
})

test('CV-184 接线：新节点必须真的被带进视野，且不抢进行中的手势', () => {
  assert.match(SURFACE_CODE, /revealNodes\(ids: readonly string\[\]\): void/,
    'CanvasSurface 必须暴露 revealNodes —— 否则 StudioFrame 调到的是不存在的方法')
  assert.match(SURFACE_CODE, /revealOffsetOf\(/, 'revealNodes 必须用共享的位移计算')
  assert.match(SURFACE_CODE, /gesture\.current\.mode !== 'none'\) return/,
    '手势进行中不得平移视野（会打乱正在进行的拖拽）')
  assert.match(SURFACE_CODE, /scale: current\.scale,/, 'revealNodes 不得改缩放')
  assert.doesNotMatch(SURFACE_CODE, /scale: current\.scale[^,]/,
    'revealNodes 的 scale 必须是原值本身 —— 后面接任何运算符都算改缩放')

  assert.match(FRAME_CODE, /surfaceRef\.current\?\.revealNodes\(/, 'StudioFrame 必须在节点到达后调用')
  assert.match(FRAME_CODE, /node\.isLoading !== true/,
    '占位节点不得触发（它是本地网格算的，结算后会被真节点替换，跟它跳一次等于白跳）')
  assert.match(FRAME_CODE, /node\.toolName !== BRIEF_NODE_TOOL/,
    '创意锚点不得触发（每次开项目都可能由 flush 补落，会把视野拉回原点）')
  assert.match(FRAME_CODE, /seen\.ids\.add\(node\.id\)/,
    '收集式记录：见过的 id 不再算新 —— 撤销删除/重做搬回旧节点时不该抢镜头')
})
