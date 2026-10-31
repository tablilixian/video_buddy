// CV-384 探针：画布瓦片内存超限（拖缩抖动）改前/改后对比工具。
//
// 与 render-host-stall.probe.mjs 的分工：那边在隐藏窗口里真渲一单；这边在
// **客户端画布界面**上采集三个读数 —— 挂载节点数、被提升为合成层（will-change
// 含 transform）的节点数、拖缩期间的 rAF 帧时长分布。tile 告警本身打在
// Chromium 合成器日志里，页面读不到 —— 用终端 grep 计数（见下）。
//
// 用法：
//   1. 真机起客户端（corepack yarn dev），打开一个多节点画布；
//   2. DevTools console 里粘贴下方 SNIPPET（或 `node scripts/probe/canvas-raster.probe.mjs --snippet | pbcopy`）；
//   3. 改前基线：`await __canvasProbe.drive(10)` ×2（缩放扫 + 平移扫），
//      记下 nodes() 的 promoted/mounted 比例与 p50/p95；
//   4. tile 告警计数（客户端终端输出里）：
//        grep -c "tile memory limits exceeded" <客户端终端输出>
//   5. 应用改后重复 3-4，对比 —— 通过判据见
//      docs/plans/画布瓦片内存超限抖动-修复方案-20261031.md §六.T3。
//
// 读数口径：
//   - nodes().mounted   = document 挂载的 .csNode 数（应有多少张卡在画布上）
//   - nodes().promoted  = 计算样式 will-change 含 transform 的节点数。
//       改前（每节点常驻合成层）≈ mounted；改后（仅拖拽态提升）≈ 0~2（拖拽进行中才有）。
//       这是 P0-1 最直接的机器读数 —— Layer borders 满屏层框应收敛为世界层一个。
//   - drive(seconds)    = 合成手势（wheel 缩放扫 / pointer 平移扫）期间逐帧采样
//       rAF 间隔，返回 p50/p95/max（ms）。合成事件经 React 根委托与原生 wheel
//       监听进入与真人手势同一条路径（合并器 → 帧回调）。

const SNIPPET = `(() => {
  const surface = document.querySelector('.csCanvasSurface')
  if (surface === null) return '未找到 .csCanvasSurface —— 先打开画布'
  let sampling = false
  let last = 0
  const frame = []
  const sampleLoop = (t) => {
    if (!sampling) return
    if (last !== 0) frame.push(t - last)
    last = t
    requestAnimationFrame(sampleLoop)
  }
  const pct = (p) => {
    if (frame.length === 0) return NaN
    const sorted = [...frame].sort((a, b) => a - b)
    return +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(2)
  }
  const fire = (type, x, y, extra = {}) => {
    surface.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, isPrimary: true, pointerId: 7,
      pointerType: 'mouse', clientX: x, clientY: y, ...extra,
    }))
  }
  async function drive(seconds = 10) {
    frame.length = 0
    last = 0
    sampling = true
    requestAnimationFrame(sampleLoop)
    const t0 = performance.now()
    const cx = window.innerWidth / 2
    const cy = window.innerHeight / 2
    // 缩放扫：正弦往复的 wheel（每帧至多一个事件，进合并器同一条路径）
    while (performance.now() - t0 < seconds * 500) {
      const dir = Math.sin((performance.now() - t0) / 250)
      surface.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, clientX: cx, clientY: cy, deltaY: dir * 40,
      }))
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    // 平移扫：按下 → 圆周拖动 → 松手（真 pointer 手势，含 pointer capture）
    fire('pointerdown', cx, cy, { button: 0, buttons: 1 })
    while (performance.now() - t0 < seconds * 1000) {
      const t = (performance.now() - t0) / 1000
      fire('pointermove', cx + Math.cos(t * 2) * 200, cy + Math.sin(t * 2) * 200, { buttons: 1 })
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    fire('pointerup', cx, cy, { button: 0, buttons: 0 })
    sampling = false
    return { frames: frame.length, p50: pct(0.5), p95: pct(0.95) }
  }
  function nodes() {
    const els = [...document.querySelectorAll('.csNode')]
    const promoted = els.filter((el) => getComputedStyle(el).willChange.includes('transform')).length
    return { mounted: els.length, promoted }
  }
  window.__canvasProbe = { drive, nodes }
  return '__canvasProbe 就绪：await drive(10) / nodes()'
})()`

const args = process.argv.slice(2)
if (args.includes('--snippet')) {
  process.stdout.write(SNIPPET)
} else {
  process.stdout.write(`CV-384 画布瓦片内存探针 —— 用法见文件头注释。

${'='.repeat(72)}
以下整段粘贴进客户端 DevTools console（或 --snippet | pbcopy）：
${'='.repeat(72)}

${SNIPPET}

${'='.repeat(72)}
tile 告警计数（客户端终端输出）：
  grep -c "tile memory limits exceeded" <客户端终端输出>

通过判据（方案 §六.T3，硬指标）：
  1) 全程 tile 告警计数 = 0；
  2) nodes().promoted：改前 ≈ mounted → 改后静态 ≈ 0（拖拽中 ≤ 参与数）；
  3) 无肉眼可见块状闪现（对照改前录屏）。
`)
}
