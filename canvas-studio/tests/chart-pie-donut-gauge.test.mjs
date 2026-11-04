/**
 * 阶段 4.1（2026-11-04）：chart 扩型 pie / donut / gauge 守卫。
 *
 * 锁三件事：
 * 1. **纯几何**（chart-pie.ts，node 直连）：份额归一、扇/环路径端点、gauge dasharray；
 * 2. **校验语义**：variant 白名单、gauge 单值 / gaugeMax 正数且不小于进度值、
 *    palette 形状、lineValues 对新变体只警告不吞数据；
 * 3. **反向变异**：gauge 判据删掉必须变红（守卫不是装饰）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcOf = (p) => readFileSync(join(ROOT, p), 'utf8')

function base(overrides = {}) {
  return {
    id: 'comp-chart-pie',
    meta: { title: '饼图环契约', width: 1280, height: 720, fps: 30, durationInFrames: 300, lint: 'off' },
    tracks: [
      { id: 't-title', type: 'textCard', variant: 'title', text: '标题', startFrame: 0, durationInFrames: 300 },
    ],
    ...overrides,
  }
}

function chart(overrides = {}) {
  return {
    id: 't-chart',
    type: 'chart',
    variant: 'gauge',
    labels: ['完成度'],
    values: [76],
    startFrame: 0,
    durationInFrames: 300,
    ...overrides,
  }
}

test('4.1 几何：份额归一 + 扇形路径端点（12 点钟起顺时针）', async () => {
  const { sliceFractions, wedgePath, donutSlicePath, gaugeDashArray, GAUGE_CIRCUMFERENCE, DONUT_INNER_RATIO } =
    await import('../lib/remotion/chart-pie.js')
  assert.deepEqual(sliceFractions([1, 3]), [0.25, 0.75])
  assert.deepEqual(sliceFractions([5, 5, 10]), [0.25, 0.25, 0.5])
  // 1/4 圆从 12 点钟起：起点 = (50, 4)，终点 = (96, 50)
  assert.equal(wedgePath(0.25, 0), 'M 50.000 50.000 L 50.000 4.000 A 46 46 0 0 1 96.000 50.000 Z')
  // 3/4 圆是大弧（largeArc=1）
  assert.match(wedgePath(0.75, 0.25), / A 46 46 0 1 1 /)
  // donut 路径含外弧与内弧（内半径 = 46 × 0.55 = 25.300）
  assert.match(donutSlicePath(0.5, 0), /A 46 46 /)
  assert.match(donutSlicePath(0.5, 0), /A 25\.300 25\.300 /)
  assert.equal(DONUT_INNER_RATIO, 0.55)
  // gauge：半程 dasharray = C/2；满程 = 全 C；负值钳 0
  assert.equal(gaugeDashArray(0.5), `${(GAUGE_CIRCUMFERENCE / 2).toFixed(3)} ${GAUGE_CIRCUMFERENCE.toFixed(3)}`)
  assert.equal(gaugeDashArray(1), `${GAUGE_CIRCUMFERENCE.toFixed(3)} ${GAUGE_CIRCUMFERENCE.toFixed(3)}`)
  assert.equal(gaugeDashArray(-3), `0.000 ${GAUGE_CIRCUMFERENCE.toFixed(3)}`)
})

test('4.1 校验：合法三变体放行 + gauge 专属语义 + palette 形状', async () => {
  const { validateManifest } = await import('../lib/remotion/manifest.js')
  // 合法 gauge / pie / donut 放行
  for (const t of [
    chart({ gaugeMax: 100 }),
    chart({ variant: 'pie', labels: ['a', 'b'], values: [1, 3], palette: ['#fff', '#000'] }),
    chart({ variant: 'donut', labels: ['a', 'b'], values: [1, 3] }),
  ]) {
    const v = validateManifest(base({ tracks: [t] }))
    assert.equal(v.errors.length, 0, v.errors.join('\n'))
  }
  // gauge 多值拒收
  const multi = validateManifest(base({ tracks: [chart({ values: [76, 24] })] }))
  assert.ok(multi.errors.some((e) => e.includes("variant:'gauge' 下必须恰好 1 个数")), multi.errors.join('\n'))
  // gaugeMax 非正数拒收；进度值超分母拒收
  const badMax = validateManifest(base({ tracks: [chart({ gaugeMax: 0 })] }))
  assert.ok(badMax.errors.some((e) => e.includes('gaugeMax 必须是正数')))
  const overMax = validateManifest(base({ tracks: [chart({ gaugeMax: 50 })] }))
  assert.ok(overMax.errors.some((e) => e.includes('超过 gaugeMax')))
  // palette 形状拒收
  const badPalette = validateManifest(base({ tracks: [chart({ variant: 'pie', labels: ['a', 'b'], values: [1, 2], palette: [] })] }))
  assert.ok(badPalette.errors.some((e) => e.includes('palette 必须是非空字符串数组')))
  // 未知变体仍拒收；pie 全 0 仍被通用规则拦
  const badVariant = validateManifest(base({ tracks: [chart({ variant: 'treemap' })] }))
  assert.ok(badVariant.errors.some((e) => e.includes('只允许 bars / dual / line / pie / donut / gauge')))
  const allZero = validateManifest(base({ tracks: [chart({ variant: 'pie', labels: ['a', 'b'], values: [0, 0] })] }))
  assert.ok(allZero.errors.some((e) => e.includes('不能全为 0')))
})

test('4.1 回归：bars/dual/line 校验语义逐字不变（lineValues 对新变体只警告）', async () => {
  const { validateManifest } = await import('../lib/remotion/manifest.js')
  const track = (extra) => chart({ variant: 'bars', labels: ['a', 'b'], values: [1, 2], ...extra })
  // dual 缺 lineValues 仍硬错
  const dual = validateManifest(base({ tracks: [track({ variant: 'dual' })] }))
  assert.ok(dual.errors.some((e) => e.includes('必须提供 lineValues')))
  // pie 带了 lineValues 只警告不报错
  const pie = validateManifest(base({ tracks: [track({ variant: 'pie', lineValues: [1, 2] })] }))
  assert.equal(pie.errors.length, 0, pie.errors.join('\n'))
  assert.ok(pie.warnings.some((w) => w.includes("只在 variant:'dual' 下生效")))
})

test('4.1 反向变异：gauge 判据删除必须变红（守卫不是装饰）', () => {
  const t = srcOf('src/remotion/chart-pie.ts')
  assert.ok(t.includes("variant === 'gauge'"), 'chart-pie.ts 必须含 gauge 分支')
  assert.ok(t.includes('必须恰好 1 个数'), 'gauge 单值判据缺失（反向变异哨兵）')
  assert.ok(t.includes('超过 gaugeMax'), 'gauge 上限判据缺失（反向变异哨兵）')
  // 组件侧接线哨兵：PieFamily 分支必须存在且 SVG 不得用非等比拉伸
  const chart = srcOf('src/remotion/components/Chart.tsx')
  assert.ok(chart.includes('PieFamily'), 'Chart.tsx 必须接 PieFamily 分支')
  const stretch = (chart.match(/^\s+preserveAspectRatio="none"$/gm) ?? []).length
  assert.equal(stretch, 2, `非等比拉伸只允许既有 dual/line 两处（pie 族必须等比 meet），实测 ${stretch}`)
})
