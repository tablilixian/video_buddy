/**
 * CV-185：「整理布局」按视口整形 + 适配视野的可读下限。
 *
 * 用户的问题是「整理布局点下去怎么工作」，量出来的是**两件事**：
 *
 *   ① 排布形状与画布形状无关 —— 一个深度一条不限高的列。真实画布 23 个单元
 *      全在 depth 0，排出来是 **768×6452 的一根细长条**，适配比例被压到 0.1
 *      （canvas.json 里存的就是 0.1 —— 打开项目就是一片看不清的缩略图）。
 *   ② 适配视野会为了「全塞进去」一路缩到看不清，且**不告诉用户**还有内容在
 *      视野外（「节点是不是丢了」就是这么来的）。
 *
 * 守卫分两层：
 *   - **行为**：列宽按列自适应、行数上限超了就开同深度相邻子列（深度顺序仍严格
 *     左→右）、排布结果让适配比例最大化、装不下时缩到可读下限并回流左上角；
 *   - **静态**：适配数学只准有一份实现（原来写在 CanvasSurface 的 JSX 里，
 *     既没法单测，整理布局也没法引用），且三层（surface / store / frame）必须接线。
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

/** 最小节点壳：排布只读 id / x / y / width / height / sourceIds / parentId / createdAt。 */
const node = (id, width = 260, height = 180, extra = {}) => ({
  id, kind: 'image', title: id, x: 0, y: 0, width, height,
  zIndex: 0, createdAt: 1, sourceIds: [], ...extra,
})

const sortedX = (positions) => [...new Set([...positions.values()].map((p) => p.x))].sort((a, b) => a - b)

const boxWidth = (positions) => Math.max(...[...positions.values()].map((p) => p.x))
const distinctX = (positions) => new Set([...positions.values()].map((p) => p.x)).size

test('CV-185 列宽按列自适应：窄列不再被别处的宽单元撑开', () => {
  // depth 0 是窄的（260），depth 1 挂着一张 996 宽的托盘 —— 旧实现取全局最大宽，
  // 于是**所有**列都按 996+48 起步，多出 736px 的纯空白（真实画布实测多 1248px）。
  const source = node('src', 260, 180)
  const box = node('tray', 996, 366, { kind: 'group', title: '分镜 1 · 素材', sourceIds: ['src'] })
  const deep = node('kf', 260, 180, { sourceIds: ['tray'] })
  const positions = computeArrangeLayout([source, box, deep])
  assert.equal(positions.get('src').x, 40, '首列从原点开始')
  assert.equal(positions.get('tray').x, 40 + 260 + 48,
    'depth 1 的 x = depth 0 本列最大宽(260) + 间隙 —— 不是全局最大宽(996)')
  assert.equal(positions.get('kf').x, 40 + 260 + 48 + 996 + 48,
    'depth 2 接在 depth 1 本列之后（列宽各自算，逐列累加）')
})

test('CV-185 行数上限：一个深度堆太多行时开同深度相邻子列（细长条被摊平）', () => {
  const units = Array.from({ length: 12 }, (_, index) => node(`n${index}`))
  const viewport = { width: 1160, height: 700 }
  const positions = computeArrangeLayout(units, viewport)

  const columns = distinctX(positions)
  assert.ok(columns > 1, `12 个单元必须摊成多列，实际列数 ${columns}`)
  assert.ok(columns <= 4, `列数不该超过适配比例最优值太多，实际 ${columns}`)

  // 每列行数 ≤ 上限：列高不再是 12 行（改前 = 2736px，比视口高 4 倍）
  const perColumn = new Map()
  for (const p of positions.values()) perColumn.set(p.x, (perColumn.get(p.x) ?? 0) + 1)
  for (const [x, count] of perColumn) {
    assert.ok(count <= 4, `x=${x} 的列有 ${count} 行，超出行数上限`)
  }
  const height = Math.max(...[...positions.values()].map((p) => p.y)) + 180
  assert.ok(height < 12 * 228, `列高 ${height} 必须小于「一条列排到底」的 ${12 * 228}`)
})

test('CV-185 行数上限由「预测适配比例最大」挑出（独立算法复算同一个目标）', () => {
  // 同尺寸同深度的均匀情形，可以脱离实现独立算出每个候选 R 的适配比例。
  // 取 20 个单元是为了让最优行数**不等于**最小行数 —— 12 个单元时最优恰好是 3，
  // 「搜索」与「固定 3」给出同一个结果，那条用例区分不了（反向验证当场抓出来的）。
  const count = 20
  const units = Array.from({ length: count }, (_, index) => node(`n${index}`))
  const viewport = { width: 1160, height: 700 }
  const cellW = 260 + 48
  const cellH = 180 + 48
  const usableW = viewport.width - FIT_PADDING * 2
  const usableH = viewport.height - FIT_PADDING * 2

  let oracle = 0
  let oracleRows = 0
  for (let rows = 3; rows <= count; rows += 1) {
    const columns = Math.ceil(count / rows)
    const score = Math.min(usableW / (columns * cellW), usableH / (Math.min(rows, count) * cellH))
    if (score >= oracle) {
      oracle = score
      oracleRows = rows
    }
  }
  assert.notEqual(oracleRows, 3, '用例自身前提：最优行数不能等于最小行数，否则这条用例区分不出「搜索」')

  const positions = computeArrangeLayout(units, viewport)
  const columns = distinctX(positions)
  const rows = Math.ceil(count / columns)
  assert.equal(rows, oracleRows,
    `挑出的行数上限应当是 ${oracleRows}（预测适配比例 ${oracle.toFixed(3)}），实际 ${rows} 行`)

  const width = boxWidth(positions)
  const height = Math.max(...[...positions.values()].map((p) => p.y)) + 180
  const actual = Math.min(usableW / width, usableH / height)
  assert.ok(actual >= oracle - 1e-9, `真实排布的适配比例 ${actual.toFixed(3)} 低于最优 ${oracle.toFixed(3)}`)
})

test('CV-185 深度顺序仍严格左→右（子列不跨深度混排）', () => {
  const sources = Array.from({ length: 8 }, (_, index) => node(`s${index}`))
  const mids = sources.map((s, index) => node(`m${index}`, 260, 180, { sourceIds: [s.id] }))
  const outs = mids.slice(0, 3).map((m, index) => node(`o${index}`, 260, 180, { sourceIds: [m.id] }))
  const all = [...sources, ...mids, ...outs]
  const positions = computeArrangeLayout(all, { width: 1160, height: 700 })

  const xOf = (id) => positions.get(id).x
  for (const source of sources) {
    for (const mid of mids) {
      assert.ok(xOf(source.id) < xOf(mid.id),
        `源（${source.id}, x=${xOf(source.id)}）必须在生成层（${mid.id}, x=${xOf(mid.id)}）左侧`)
    }
    for (const out of outs) {
      assert.ok(xOf(source.id) < xOf(out.id), '源必须在成片左侧')
    }
  }
  for (const mid of mids) {
    for (const out of outs) {
      assert.ok(xOf(mid.id) < xOf(out.id), '生成层必须在成片左侧')
    }
  }
})

test('CV-185 小画布不退化：单元少时仍然「一个深度一条列」', () => {
  // 这条是 ARRANGE_MIN_ROWS = 3 的存在理由：放开到「列可以只有 1 行」时，
  // 3 个同层节点会被摊成一排 —— 列就没意义了，而且适配比例并不会更好。
  const three = [node('a'), node('b'), node('c')]
  const positions = computeArrangeLayout(three, { width: 1160, height: 700 })
  assert.equal(distinctX(positions), 1, '3 个同层节点必须落在同一列')
  assert.equal(new Set([...positions.values()].map((p) => p.y)).size, 3, '列内纵向堆叠')
})

test('CV-185 组随行：托盘与成员保持相对偏移，且不与其他单元重叠', () => {
  const tray = node('g', 552, 600, { kind: 'group', title: '分镜 1 · 素材', zIndex: -1 })
  const memberA = node('a', 270, 528, { x: 100, y: 200, parentId: 'g' })
  const memberB = node('b', 270, 528, { x: 382, y: 200, parentId: 'g' })
  const other = node('other', 480, 318, { x: 2000, y: 3000 })
  const positions = computeArrangeLayout([tray, memberA, memberB, other], { width: 1160, height: 700 })

  // 断言**相对偏移不变**，不要用「另一个成员推出来的 delta」—— 那样两边一起错时
  // 期望值会跟着错，断言恒真（第一版就是这么写的，被反向验证当场抓出来）。
  const trayX = positions.get('g').x
  const trayY = positions.get('g').y
  assert.equal(positions.get('a').x - trayX, memberA.x - tray.x, '成员 A 相对托盘的偏移不变')
  assert.equal(positions.get('a').y - trayY, memberA.y - tray.y)
  assert.equal(positions.get('b').x - trayX, memberB.x - tray.x, '成员 B 相对托盘的偏移不变')
  assert.equal(positions.get('b').y - trayY, memberB.y - tray.y)
  // 另加一组绝对值：相对断言本身对「托盘与成员一起不搬」是盲的。
  assert.equal(positions.get('g').x, 40, '托盘落在原点')
  assert.equal(positions.get('a').x, 40 + memberA.x, '成员绝对位置 = 托盘 + 相对偏移')
  assert.equal(positions.get('b').x, 40 + memberB.x)

  // 托盘与**无关**节点不得重叠（成员落在托盘内属预期）。
  const placed = [
    { id: 'g', ...positions.get('g'), width: 552, height: 600 },
    { id: 'other', ...positions.get('other'), width: 480, height: 318 },
  ]
  const overlaps = placed[0].x < placed[1].x + placed[1].width && placed[1].x < placed[0].x + placed[0].width
    && placed[0].y < placed[1].y + placed[1].height && placed[1].y < placed[0].y + placed[0].height
  assert.equal(overlaps, false, '托盘与无关节点不得重叠')
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

test('CV-185 接线：视口尺寸交给排布，被下限挡住必须出声', () => {
  assert.match(SURFACE_CODE, /viewportSize\(\): \{ width: number; height: number \} \| null/,
    'CanvasSurface 必须暴露视口尺寸 —— 否则排布拿不到「排成什么形状」')
  assert.match(SURFACE_CODE, /if \(result\.clamped\) onFitClampedRef\.current\?\.\(result\)/,
    '被下限挡住时必须回调出去（画布这层不认识 toast）')

  assert.match(STORE_CODE, /autoArrange: \(draft: ProjectStoreState, projectId: string, viewport\?: CanvasViewport\)/,
    'store 动作必须收视口参数')
  assert.match(STORE_CODE, /computeArrangeLayout\(existing, viewport\)/, '视口必须真的传进排布')

  assert.match(FRAME_CODE, /actions\.autoArrange\(projectId, surfaceRef\.current\?\.viewportSize\(\) \?\? undefined\)/,
    'StudioFrame 必须把画布实测尺寸交给整理布局')
  assert.match(FRAME_CODE, /fittedProjectRef\.current === projectId[\s\S]{0,120}suppressFitHintRef\.current = true/,
    '打开项目时的自动适配不得弹提示（只有用户主动适配才提示）')
  assert.match(FRAME_CODE, /内容较多，已按可读比例显示，视野外还有节点/,
    '「内容多于视口」必须有一句人话 —— 否则「只看到一半」会被读成「节点丢了」')
})
