/**
 * S-3 守卫：**几何表必须与现跑结果一致**（REQ-038-R11 文档体系整改 · M2）。
 *
 * 抓的是什么：真机两轮会话约 18 次 bash 在反推「cell → 盒高 → 字号 → 行数」这条链，
 * 它横跨 `cell-projection.ts` / `type-scale.ts` / `text-fit-plan.ts` / `recipe-cards.ts`
 * 四个文件，而**从来没有被写成文档**。
 *
 * 四条断言：
 * 1. 磁盘上的生成物 === 现跑脚本的输出。
 * 2. **硬编码期望值**：四个算例的数值逐字段固定。只比对生成物是恒真的
 *    （生成器和文档用的是同一个函数），所以必须有一层"独立记忆"——常量一变就红，
 *    逼人确认「这是有意改设计」再重生成。
 * 3. 反向变异：把 cell.h 改小，字号必须跟着变小（证明算例不是写死的字符串）。
 * 4. 换算表自洽：同一设计值在 480p / 720p / 1080p / 竖屏 四档上的像素值严格递增。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderSpecGeometry, projectedBox, OUTPUT } from '../scripts/gen-spec-geometry.mjs'
import { planTextFit } from '../lib/remotion/text-fit-plan.js'

const body = () => readFileSync(OUTPUT, 'utf8')
const SIZING = (variant, text, box, canvasWidth, canvasHeight) =>
  planTextFit({ variant, text, box, canvasWidth, canvasHeight })

test('几何表与现跑结果一致（改了排版常量 / 卡内 box 必须重跑 gen-spec-geometry.mjs）', () => {
  assert.equal(
    body(),
    renderSpecGeometry(),
    '生成物与现跑结果不一致 —— 跑 `yarn build && node scripts/gen-spec-geometry.mjs` 后一起提交。'
    + '（这条守卫的意义：几何是最容易漂的一类事实，改一个常量全表变。）',
  )
})

test('硬编码期望值：四个算例的字号 / 行数 / 盒高（改设计请同时改这里，别只重跑脚本）', () => {
  // 竖屏 1080×1920；A1 title 的盒 = cell × 30%，A4 bullets 的盒 = cell × 46%
  const vertical = { width: 1080, height: 1920 }
  const title24 = SIZING('title', '量化基金 散户', { x: 50, y: 22, w: 76, h: 7.2 }, vertical.width, vertical.height)
  assert.equal(title24.baseFontPx, 149, '竖屏 title 基准号变了')
  assert.equal(title24.fontPx, 115, '竖屏 title（盒 138px）实测字号变了')
  assert.equal(title24.overflow, false, '竖屏 title 不该裁字')
  assert.equal(title24.heightLimited, true, '竖屏 title 应被标记为「盒高压过字号」')

  const title30 = SIZING('title', '量化基金 散户', { x: 50, y: 22, w: 76, h: 9 }, vertical.width, vertical.height)
  assert.equal(title30.fontPx, 123, 'cell.h 30（盒 173px）实测字号变了')
  assert.equal(title30.heightLimited, true, '30 也不够满号 —— 文档里不许再写「提到 30 就满号」')

  // box 必须与生成器**同源**（真跑 planFromSpec 的投影），不能手写 —— P0-2（bullets 容器
  // 改按 box.w 算）之后，手写 w:100 与真投影 w:64% 的字号会差出一档（79 vs 60）。
  const bulletsBox = projectedBox('A4', '-bullets', { x: 50, y: 62, w: 100, h: 56 })
  const bullets = SIZING('bullets', ['量化基金：规则先写死', '按信号执行', '散户：临场决定', '看心情执行'], bulletsBox, vertical.width, vertical.height)
  assert.equal(bullets.lines.length, 4, '四条要点必须还是四行（内容不许丢）')
  assert.equal(bullets.fontPx, 60, '竖屏 bullets（盒 495px）实测字号变了')

  const flat = SIZING('title', '量化基金 散户', { x: 50, y: 46, w: 76, h: 9 }, 1920, 1088)
  assert.equal(flat.fontPx, 85, '1080p title 应是满号（85）')
  assert.equal(flat.heightLimited, false, '1080p 标准版式不该触发高度限制（零回归基线）')
})

test('反向变异：cell.h 减半，字号必须跟着变小（算例不是写死的字符串）', () => {
  const big = SIZING('title', '量化基金 散户', { x: 50, y: 22, w: 76, h: 9 }, 1080, 1920)
  const small = SIZING('title', '量化基金 散户', { x: 50, y: 22, w: 76, h: 4.5 }, 1080, 1920)
  assert.ok(small.fontPx < big.fontPx, `盒高减半后字号没变小（${big.fontPx} → ${small.fontPx}）—— 盒高没进缩号循环`)
  assert.ok(body().includes(`${big.fontPx}px`), '文档里应出现满号那档的数值')
})

test('换算表自洽：四档画布的字号严格递增（480p < 720p < 1080p < 竖屏）', () => {
  const sizes = [[864, 480], [1376, 768], [1920, 1088], [1080, 1920]]
    .map(([w, h]) => SIZING('title', '甲乙', { x: 50, y: 50, w: 90, h: 30 }, w, h).baseFontPx)
  for (let i = 1; i < sizes.length; i += 1) {
    assert.ok(sizes[i] > sizes[i - 1], `第 ${i + 1} 档基准号没有变大：${sizes.join(' < ')}`)
  }
  const text = body()
  for (const size of sizes) assert.ok(text.includes(`${size}px`) || text.includes(`| ${size} `), `换算表里缺 ${size}px 这一档`)
})
