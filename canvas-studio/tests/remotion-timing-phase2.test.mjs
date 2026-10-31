/**
 * REQ-034 · 二期（A1 / A2 / A4 / A5 / B1 / D-04）时序与样式纯函数单测。
 *
 * 覆盖 `src/remotion/timing.ts` 二期新增的 6 个纯函数：
 *   `orbitStateAt`（公转）/ `drawProgressAt`（路径生长）/ `fxStyles`（视觉特效）/
 *   `fitTextPolicy`（排版自适配）/ `waveformBars`（音频可视化）/ `renderTimeoutMs`（超时公式）。
 *
 * 为什么这些必须是纯函数：Remotion 逐帧截图走真实时钟，任何"随状态漂移"的插值都会让
 * 同一份 manifest 渲两次结果不同。所以判定全部在纯函数里，组件只贴样式。
 *
 * 直连 Host tsc 编译产物 `lib/remotion/timing.js`（零 Remotion 依赖）。
 * 定向跑：node --test tests/remotion-timing-phase2.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  drawProgressAt,
  fitTextPolicy,
  fxStyles,
  orbitStateAt,
  RENDER_TIMEOUT_MAX_MS,
  RENDER_TIMEOUT_MIN_MS,
  RENDER_TIMEOUT_PER_FRAME_MS,
  renderTimeoutMs,
  transitionOverride,
  waveformBars,
} from '../lib/remotion/timing.js'

const TAU = Math.PI * 2

function closeTo(actual, expected, tolerance = 1e-9, message = '') {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message} 期望 ${expected}（±${tolerance}），实际 ${actual}`,
  )
}

// ───────────────────────────── A1：公转 orbitStateAt ─────────────────────────────

test('orbitStateAt：无 orbit ⇒ null（不干扰老 manifest）', () => {
  assert.equal(orbitStateAt({ durationInFrames: 100 }, 0), null)
  assert.equal(orbitStateAt({ durationInFrames: 100, orbit: undefined }, 50), null)
})

test('orbitStateAt：startAngle=0 从正右出发，顺时针（角度增大 = y 增大）', () => {
  const track = {
    durationInFrames: 360,
    orbit: { center: { x: 50, y: 50 }, radius: 20, periodInFrames: 360 },
  }
  const at0 = orbitStateAt(track, 0)
  closeTo(at0.x, 70, 1e-9, '0° 在正右：x = cx + r')
  closeTo(at0.y, 50, 1e-9, '0° 在正右：y = cy')

  const quarter = orbitStateAt(track, 90)
  closeTo(quarter.x, 50, 1e-9, '90° 回到 cx')
  closeTo(quarter.y, 70, 1e-9, '顺时针 ⇒ 90° 在下方')

  const half = orbitStateAt(track, 180)
  closeTo(half.x, 30, 1e-9, '180° 在正左')
  closeTo(half.y, 50, 1e-9, '180° y 回中')

  const threeQuarter = orbitStateAt(track, 270)
  closeTo(threeQuarter.y, 30, 1e-9, '270° 在上方')
})

test('orbitStateAt：direction=ccw 反向，startAngle 生效', () => {
  const ccw = {
    durationInFrames: 360,
    orbit: { center: { x: 50, y: 50 }, radius: 10, startAngle: -90, periodInFrames: 360, direction: 'ccw' },
  }
  const at0 = orbitStateAt(ccw, 0)
  closeTo(at0.x, 50, 1e-9, '-90° 在正上：x = cx')
  closeTo(at0.y, 40, 1e-9, '-90° 在正上：y = cy - r')

  // 逆时针走 90° ⇒ -90 → -180 ⇒ 到正左
  const quarter = orbitStateAt(ccw, 90)
  closeTo(quarter.x, 40, 1e-9, '逆时针 90° 到正左')
  closeTo(quarter.y, 50, 1e-9, '逆时针 90° y 回中')
})

test('orbitStateAt：periodInFrames 缺省 = 整轨（整轨正好一圈）', () => {
  const track = { durationInFrames: 400, orbit: { center: { x: 50, y: 50 }, radius: 25 } }
  const at0 = orbitStateAt(track, 0)
  const atEnd = orbitStateAt(track, 400)
  closeTo(at0.x, 75, 1e-9, '起点在正右')
  closeTo(atEnd.x, 75, 1e-6, '走满一轨回到起点（x）')
  closeTo(atEnd.y, 50, 1e-6, '走满一轨回到起点（y）')

  const atHalf = orbitStateAt(track, 200)
  closeTo(atHalf.x, 25, 1e-9, '半圈在正左')
})

test('orbitStateAt：一帧一位移，角度是帧的线性函数（可复现、不读时钟）', () => {
  const track = { durationInFrames: 360, orbit: { center: { x: 0, y: 0 }, radius: 10, periodInFrames: 720 } }
  const a = orbitStateAt(track, 123)
  const b = orbitStateAt(track, 123)
  assert.deepEqual(a, b, '同一帧两次求值必须完全相等')
  closeTo(a.x, 10 * Math.cos((2 * Math.PI * 123) / 720), 1e-9, 'x 按周期线性推角')
  closeTo(a.y, 10 * Math.sin((2 * Math.PI * 123) / 720), 1e-9, 'y 按周期线性推角')
  // 一整个周期后回到出发点
  const after = orbitStateAt(track, 123 + 720)
  closeTo(after.x, a.x, 1e-9, '整周期后 x 不变')
  closeTo(after.y, a.y, 1e-9, '整周期后 y 不变')
  assert.ok(TAU > 0)
})

// ───────────────────────── A1：路径生长 drawProgressAt ─────────────────────────

test('drawProgressAt：无 draw ⇒ 恒 1（老 shape 行为不变）', () => {
  assert.equal(drawProgressAt({ durationInFrames: 100 }, 0), 1)
  assert.equal(drawProgressAt({ durationInFrames: 100 }, 99), 1)
})

test('drawProgressAt：linear 区间线性生长，区间前 0、区间后恒 to', () => {
  const track = { durationInFrames: 100, draw: { to: 1, startFrame: 10, durationInFrames: 20, easing: 'linear' } }
  assert.equal(drawProgressAt(track, 0), 0, '区间前不画')
  assert.equal(drawProgressAt(track, 10), 0, '起始帧为 0')
  closeTo(drawProgressAt(track, 20), 0.5, 1e-9, '半程 0.5')
  closeTo(drawProgressAt(track, 30), 1, 1e-9, '终点 1')
  closeTo(drawProgressAt(track, 99), 1, 1e-9, '区间后收敛在 to（不跳变）')
})

test('drawProgressAt：to<1 时上界收敛，easeIn 走 t²', () => {
  const partial = { durationInFrames: 100, draw: { to: 0.6, durationInFrames: 40, easing: 'linear' } }
  closeTo(drawProgressAt(partial, 20), 0.3, 1e-9, '半程 = 0.5 × to')
  closeTo(drawProgressAt(partial, 40), 0.6, 1e-9, '终点 = to')
  closeTo(drawProgressAt(partial, 80), 0.6, 1e-9, '之后保持 to')

  const easeIn = { durationInFrames: 100, draw: { durationInFrames: 40, easing: 'easeIn' } }
  closeTo(drawProgressAt(easeIn, 20), 0.25, 1e-9, 'easeIn(0.5) = 0.25')
})

test('drawProgressAt：draw 缺省 durationInFrames ⇒ 用整轨时长', () => {
  const track = { durationInFrames: 60, draw: { to: 1, easing: 'linear' } }
  closeTo(drawProgressAt(track, 30), 0.5, 1e-9, '整轨半程 = 0.5')
  closeTo(drawProgressAt(track, 60), 1, 1e-9, '轨末画满')
})

// ───────────────────────── A2：视觉特效 fxStyles ─────────────────────────

test('fxStyles：五种特效各自给出对应样式，缺省为空对象', () => {
  assert.deepEqual(fxStyles(undefined), {}, '无 fx ⇒ 空对象（渲染结果逐像素不变）')
  assert.equal(fxStyles('glow').filter.includes('drop-shadow'), true, 'glow 走 filter drop-shadow')
  assert.equal(typeof fxStyles('glow').textShadow, 'string', 'glow 同时给文字辉光')
  assert.equal(typeof fxStyles('stroke').textStroke, 'string', 'stroke 给文字描边')
  assert.equal(typeof fxStyles('shadow').boxShadow, 'string', 'shadow 给卡片投影')
  assert.equal(fxStyles('blur').filter, 'blur(3px)', 'blur 固定 3px')
  assert.match(fxStyles('maskFade').maskImage, /linear-gradient/, 'maskFade 是底部渐隐遮罩')
})

// ───────────────────────── A5：排版自适配 fitTextPolicy ─────────────────────────

test('fitTextPolicy：短文本不缩字号、单行、不溢出（老 manifest 排版不变）', () => {
  const result = fitTextPolicy('短标题', { maxWidthPx: 1000, baseFontPx: 40, maxLines: 2 })
  assert.equal(result.fontPx, 40, '放得下就不许改字号')
  assert.deepEqual(result.lines, ['短标题'], '放得下就不许改换行')
  assert.equal(result.overflow, false)
  assert.equal(result.estimatedHeightPx, Math.round(40 * 1.35))
})

test('fitTextPolicy：按宽度贪心折行（CJK 宽 1、拉丁宽 0.55）', () => {
  // maxWidth 40、字号 20 ⇒ CJK 每字 20px，一行两个
  const cjk = fitTextPolicy('你好世界', { maxWidthPx: 40, baseFontPx: 20, maxLines: 2 })
  assert.deepEqual(cjk.lines, ['你好', '世界'])
  assert.equal(cjk.fontPx, 20)
  assert.equal(cjk.overflow, false)
  assert.equal(cjk.estimatedHeightPx, Math.round(2 * 20 * 1.35))

  // 拉丁字符宽 0.55 × 20 = 11px ⇒ maxWidth 40 一行三个
  const latin = fitTextPolicy('abcdef', { maxWidthPx: 40, baseFontPx: 20, maxLines: 2 })
  assert.deepEqual(latin.lines, ['abc', 'def'])
})

test('fitTextPolicy：超行数时缩字号，缩到 minFontPx 仍超 ⇒ overflow 且不强改行数', () => {
  const longText = '这是一段很长的说明文字需要缩字号才能塞进有限行数里'
  const result = fitTextPolicy(longText, { maxWidthPx: 200, baseFontPx: 32, maxLines: 2, minFontPx: 16 })
  assert.ok(result.fontPx <= 32, '只许缩不许放')
  assert.ok(result.fontPx >= 16, '不得低于 minFontPx')
  assert.equal(result.lines.length > 2, true, '缩到下限仍放不下 ⇒ 保持多行并标记溢出')
  assert.equal(result.overflow, true)
  assert.equal(result.estimatedHeightPx, Math.round(result.lines.length * result.fontPx * 1.35))
})

test('fitTextPolicy：显式换行符优先当段落边界', () => {
  const result = fitTextPolicy('第一行\n第二行', { maxWidthPx: 1000, baseFontPx: 20, maxLines: 4 })
  assert.deepEqual(result.lines, ['第一行', '第二行'])
  assert.equal(result.fontPx, 20)
})

// ───────────────────────── B1：音频可视化 waveformBars ─────────────────────────

test('waveformBars：柱数取整并夹到 1–128，空振幅画基线', () => {
  assert.deepEqual(waveformBars([], 0, { bars: 4 }), [0, 0, 0, 0], '无数据 ⇒ 全 0 基线')
  assert.equal(waveformBars([0.5], 0, { bars: 0 }).length, 1, 'bars=0 夹到 1')
  assert.equal(waveformBars([0.5], 0, { bars: 999 }).length, 128, 'bars 超上限夹到 128')
  assert.equal(waveformBars([0.5], 0, { bars: 12.7 }).length, 12, 'bars 向下取整')
})

test('waveformBars：按帧推移采样窗口（同一帧完全可复现）', () => {
  const amplitudes = [0.5, 1]
  assert.deepEqual(waveformBars(amplitudes, 0, { bars: 2, gain: 1 }), [0.5, 1])
  assert.deepEqual(waveformBars(amplitudes, 1, { bars: 2, gain: 1 }), [1, 0.5], '前进一帧 ⇒ 窗口整体移位')
  assert.deepEqual(waveformBars(amplitudes, 0, { bars: 2, gain: 1 }), [0.5, 1], '同一帧两次调用必须相等')
  // speed=2 ⇒ 每帧前进两格（偶数长度下与 speed=1 同相，故用奇数长度验证）
  const three = [0.1, 0.2, 0.3]
  assert.deepEqual(waveformBars(three, 1, { bars: 3, gain: 1, speed: 2 }), [0.3, 0.1, 0.2])
})

test('waveformBars：gain 放大后逐柱 clamp 到 0–1，越界 gain 归一到合法区间', () => {
  assert.deepEqual(waveformBars([0.5, 0.1], 0, { bars: 2, gain: 4 }), [1, 0.4], '0.5×4 夹到 1')
  assert.deepEqual(waveformBars([0.5], 0, { bars: 1, gain: 0 }), [0], 'gain=0 ⇒ 恒 0')
  assert.deepEqual(waveformBars([0.25], 0, { bars: 1, gain: 99 }), [1], 'gain 超上限按 4 处理')
  assert.deepEqual(waveformBars([0.25], 0, { bars: 1, gain: -3 }), [0], '负 gain 按 0 处理')
})

test('waveformBars：offset 指定窗口起点，负索引也安全回绕', () => {
  const amplitudes = [0.1, 0.2, 0.3, 0.4]
  assert.deepEqual(waveformBars(amplitudes, 0, { bars: 2, gain: 1, offset: 2 }), [0.3, 0.4])
  assert.deepEqual(waveformBars(amplitudes, 0, { bars: 2, gain: 1, offset: -1 }), [0.4, 0.1], '负 offset 回绕到尾部')
})

// ───────────────── 超时公式 renderTimeoutMs（REQ-034 O-06 改口径） ─────────────────
//
// 旧口径（二期 D-04）= clamp(2×秒数 + 120s, 10min, 30min)。真机暴露两个问题：
// ① 高 fps 片子按「秒」算被平白砍半（600 帧 60fps 只有 10s，预算比 30fps 少一半，
//    而软编成本只跟帧数走）；② 下限 10 分钟意味着挂死时要等满 10 分钟（评审 P1-5）。
// 新口径 = clamp(帧数 × 200ms + 60s, 90s, 20min)。

test('renderTimeoutMs：clamp 在 90s–20min，随帧数线性增长（与 fps 无关）', () => {
  assert.equal(RENDER_TIMEOUT_MIN_MS, 90_000, '下限 90 秒')
  assert.equal(RENDER_TIMEOUT_MAX_MS, 1_200_000, '上限 20 分钟')
  assert.equal(RENDER_TIMEOUT_PER_FRAME_MS, 200, '每帧预算 200ms')

  // 30 帧：30×200 + 60000 = 66000 < 90000 ⇒ 下限
  assert.equal(renderTimeoutMs(30), RENDER_TIMEOUT_MIN_MS, '短片夹到下限')
  assert.equal(renderTimeoutMs(0), RENDER_TIMEOUT_MIN_MS, '零帧 ⇒ 下限兜底')
  assert.equal(renderTimeoutMs(Number.NaN), RENDER_TIMEOUT_MIN_MS, 'NaN 帧数 ⇒ 下限兜底')

  // 600 帧（20s @30fps，真机 standard 实测 35s）：600×200 + 60000 = 180000
  assert.equal(renderTimeoutMs(600), 180_000, '600 帧 ⇒ 3 分钟（实测 35s，3.4× 余量）')
  // 6000 帧：6000×200 + 60000 = 1260000 > 上限 ⇒ 夹到 20 分钟
  assert.equal(renderTimeoutMs(6000), RENDER_TIMEOUT_MAX_MS, '超长片夹到上限')
  // 单调不减
  assert.ok(renderTimeoutMs(9000) >= renderTimeoutMs(6000))
  // 只看帧数：调用方少传 fps 也不会变（幂等签名）
  assert.equal(renderTimeoutMs(600), renderTimeoutMs(600))
})

// ───────────────────────── A4：转场（新增四种，全部按帧求值） ─────────────────────────

function windowOf(effect, role) {
  return { role, effect, startFrame: 100, durationInFrames: 20 }
}

test('transitionOverride：wipeLeft / wipeRight 用 clipPath 硬边裁切，中点为半屏', () => {
  const incoming = transitionOverride(110, [windowOf('wipeLeft', 'to')])
  assert.match(incoming.clipPath, /^inset\(/, 'wipe 走 clipPath')
  assert.equal(incoming.opacity, 1, 'wipe 不额外压透明度')

  const rightHalf = transitionOverride(110, [windowOf('wipeLeft', 'to')]).clipPath
  assert.match(rightHalf, /inset\(0 50\.000% 0 0\)/, '中点：右侧被裁 50%')

  const outgoing = transitionOverride(110, [windowOf('wipeLeft', 'from')])
  assert.match(outgoing.clipPath, /inset\(0 0 0 50\.000%\)/, 'outgoing 从左被吃掉')

  const mirrored = transitionOverride(110, [windowOf('wipeRight', 'to')])
  assert.match(mirrored.clipPath, /inset\(0 0 0 50\.000%\)/, 'wipeRight 方向相反')
})

test('transitionOverride：clock 用 clip-path polygon 扇形扫描（conic mask 在 web-renderer 被无视）', () => {
  const incoming = transitionOverride(110, [windowOf('clock', 'to')])
  assert.match(incoming.clipPath, /^polygon\(50% 50%/, '中点：扇形从圆心出发')
  assert.match(incoming.clipPath, /-?[0-9.]+% -?[0-9.]+%\)$/, '扇形以弧点收尾')
  assert.equal(incoming.maskImage, '', 'clock 不再走 mask（conic 会被渲染器整字段无视）')
  const outgoing = transitionOverride(110, [windowOf('clock', 'from')])
  assert.match(outgoing.clipPath, /^polygon\(50% 50%/, 'outgoing 可见扇形随 progress 收缩')
  // 中点：incoming 扫过 0→180°，outgoing 剩 180→360°，两侧拼起来是整圆
  assert.notEqual(incoming.clipPath, outgoing.clipPath, '两侧扇形互补不重合')
  // 起点帧：incoming 全隐（所有弧点重合在 12 点方向）、outgoing 全显（不裁）
  const atStartTo = transitionOverride(100, [windowOf('clock', 'to')])
  assert.equal(atStartTo.clipPath, 'polygon(50% 50%, 50.00% -100.00%, 50.00% -100.00%, 50.00% -100.00%)', 'sweep=0 ⇒ 弧点全部重合在 12 点方向（零面积 = 不可见）')
  const atStartFrom = transitionOverride(100, [windowOf('clock', 'from')])
  assert.equal(atStartFrom.clipPath, '', 'sweep=0 ⇒ outgoing 全圆可见（不裁）')
})

test('transitionOverride：flipX 压扁翻面（perspective 不被 web-renderer 读取，降级 2D swap）', () => {
  const incoming = transitionOverride(110, [windowOf('flipX', 'to')])
  closeTo(incoming.scaleXPercent, Math.sin(Math.PI / 4), 1e-12, 'incoming 中点 scaleX = sin(45°)')
  const outgoing = transitionOverride(110, [windowOf('flipX', 'from')])
  closeTo(outgoing.scaleXPercent, Math.cos(Math.PI / 4), 1e-12, 'outgoing 中点 scaleX = cos(45°)')
  assert.equal(incoming.opacity, 1, '压扁 swap 无重影，不再压 opacity')
  assert.equal(outgoing.opacity, 1, 'outgoing 同理全可见')
  // 终点附近：incoming 展开到 1，outgoing 压到 0
  const nearEnd = transitionOverride(119, [windowOf('flipX', 'to')])
  closeTo(nearEnd.scaleXPercent, Math.sin(19 * Math.PI / 40), 1e-12, 'incoming 末帧接近全显')
})

test('transitionOverride：老四种效果语义不变（窗口外恒等）', () => {
  const identity = transitionOverride(0, [])
  assert.deepEqual(identity, {
    opacity: 1,
    translateXPercent: 0,
    // 三期 W2-6 新增的垂直位移分量：缺省 0 ⇒ 与只有 translateX 时**完全同一串**，
    // 恒等语义不变（Transition.tsx 只在非 0 时才往 transform 里拼 translateY）。
    translateYPercent: 0,
    scale: 1,
    clipPath: '',
    maskImage: '',
    // flipX 降级为压扁翻面后，恒等位是 scaleXPercent=1（不再是 rotateY=0）。
    scaleXPercent: 1,
  }, '窗口外必须是恒等串（老片逐像素不变的前提）')

  const fadeMid = transitionOverride(110, [windowOf('fade', 'to')])
  assert.equal(fadeMid.opacity, 0.5, 'fade 中点 0.5')
  const slideMid = transitionOverride(110, [windowOf('slide', 'to')])
  assert.equal(slideMid.translateXPercent, 6, 'slide 中点位移半程（12% × 0.5）')
  const zoomMid = transitionOverride(110, [windowOf('zoom', 'to')])
  closeTo(zoomMid.scale, 0.96, 1e-12, 'zoom 中点 0.92 → 1 的半程')
})

// ── REQ-035 B2-1（D9）：超时预算公式钉住 ────────────────────────────────────
// Phase 0 结论：39 次超时**不是**预算问题（工单压根没被取走）。但公式本身是
// 「基线 + 帧×单价」的正确形态，必须有守卫钉住，别被下一次"以为预算是问题"改回去。

test('B2-1：预算 = 帧数 × 200ms + 60s，clamp 在 [90s, 20min]', () => {
  assert.equal(renderTimeoutMs(0), 90_000, '下限 90s：短片不该被压到 60s 以下')
  assert.equal(renderTimeoutMs(150), 90_000, '150 帧理论 90s，正好压线')
  assert.equal(renderTimeoutMs(450), 150_000, '450 帧 ⇒ 150s（事故里就是这个数）')
  assert.equal(renderTimeoutMs(1800), 420_000, '1800 帧 ⇒ 420s（独立工程实测 129–182s，3.2× 余量）')
  assert.equal(renderTimeoutMs(100_000), 20 * 60_000, '上限 20min：再长也不许无限挂')
})

test('B2-1：预算随帧数线性、与 fps 无关（同一帧数同预算）', () => {
  const a = renderTimeoutMs(600)
  const b = renderTimeoutMs(600)
  assert.equal(a, b)
  assert.ok(renderTimeoutMs(1200) - renderTimeoutMs(600) === 120_000, '每 600 帧应多 120s（200ms/帧）')
})
