/**
 * REQ-034 O-03：`shape.box` 的**中心语义**回归。
 *
 * 抓的是什么：真机上 agent 照抄契约文档示例 `box:{x:0,y:0,w:100,h:100}` 想铺满全屏，
 * 结果只铺了左上四分之一（片头卡大面积纯黑），白跑 2 次渲染 + 一轮取色排查 + 一次 VL 误判。
 *
 * 根因不是实现错，是**文档与实现不同源**：`Shape.tsx` 用 `left/top` + `translate(-50%,-50%)`
 * ⇒ `x`/`y` 是形状中心；文档却暗示是左上角。这里把两件事一起钉住：
 * ① 几何纯函数（组件唯一取值点）算出的矩形；② 文档与工具描述的写法。
 *
 * 直连 Host tsc 编译产物 `lib/remotion/shape-geometry.js` 与 `lib/host-tools.js`。
 * 定向跑：node --test tests/remotion-shape-box.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boxStyle, boxToRect } from '../lib/remotion/shape-geometry.js'
import { createStudioTools } from '../lib/host-tools.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8')

test('几何：box 50,50,100,100 的渲染矩形 = 整块画布', () => {
  assert.deepEqual(boxToRect({ x: 50, y: 50, w: 100, h: 100 }), { left: 0, top: 0, width: 100, height: 100 })
})

test('几何：box 0,0,100,100 只铺左上四分之一（契约旧示例照抄就是四分之一底）', () => {
  // 左上角 = 中心 0,0 减去一半宽高 ⇒ -50%；可见区域只有右下 50%×50% 的一块。
  assert.deepEqual(boxToRect({ x: 0, y: 0, w: 100, h: 100 }), { left: -50, top: -50, width: 100, height: 100 })
})

test('几何：boxStyle 的 CSS 口径与中心对齐同源（left/top = 中心，translate 拉回中心）', () => {
  assert.deepEqual(boxStyle({ x: 50, y: 50, w: 100, h: 100 }), {
    left: '50%',
    top: '50%',
    width: '100%',
    height: '100%',
    transform: 'translate(-50%, -50%)',
  })
  // 非满幅也按中心算：x=70,w=8 ⇒ 左边缘 66%
  assert.deepEqual(boxToRect({ x: 70, y: 40, w: 8, h: 8 }), { left: 66, top: 36, width: 8, height: 8 })
})

test('文档：manifest-contract 的 box 示例必须是 50,50,100,100，且写明 x/y 是中心', () => {
  const contract = read('skills/code-driven-explainer/references/manifest-contract.md')
  assert.ok(
    contract.includes('"box": { "x": 50, "y": 50, "w": 100, "h": 100 }'),
    '示例必须是 50,50,100,100（铺满全屏）',
  )
  assert.ok(
    !contract.includes('"box": { "x": 0, "y": 0, "w": 100, "h": 100 }'),
    '旧示例 0,0,100,100 必须清掉——照抄会得到四分之一底',
  )
  assert.match(contract, /形状中心/, '必须写明 x/y 是形状中心')
})

test('工具描述：render_composition 必须写明 box 的 x/y 是中心、铺满用 50,50,100,100', () => {
  const tool = createStudioTools({}, 3000).find((entry) => entry.name === 'render_composition')
  assert.ok(tool, 'render_composition 必须存在')
  const description = tool.description ?? ''
  // 2026-10-26：box 从 shape 专属上提为四类轨通用，措辞从「形状中心」改为「区域中心」。
  assert.ok(description.includes('x/y 是区域中心'), '工具描述必须点明中心语义（模型读的是这一段）')
  assert.ok(description.includes('{x:50,y:50,w:100,h:100}'), '必须给出铺满全屏的正确写法')
  assert.ok(description.includes('layout-recipes'), '必须指向布局配方文档（免手算 transform）')
})
