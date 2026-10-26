/**
 * REQ-034 · 三期时序与样式纯函数单测（W1 / W2 / W3 / W4 / W6）。
 *
 * 覆盖 `src/remotion/timing.ts` 三期新增/扩展的纯函数：
 *   缓动 12 档与 `spring`（W2-1/W2-2）· `exit`（W1-1）· 颜色过渡（W2-3）·
 *   `meta.look`（W2-4）· 波形平滑（W3-3）· 文本动效（W4-2）· 音量包络与闪避（W3-2）·
 *   抽帧位置（W6-1）。
 *
 * 三条必须守住的线：
 *  1. **老 manifest 逐像素不变** ⇒ 老 4 档缓动的公式必须精确等于原值（不是"接近"）；
 *  2. **确定性** ⇒ 同一帧算两次必须完全相同（Remotion 逐帧截图走真实时钟）；
 *  3. **端点收敛** ⇒ 动画区间外取端点，末帧不许留残值（退场末帧跳黑就是这么来的）。
 *
 * 直连 Host tsc 编译产物 `lib/remotion/timing.js`（零 Remotion 依赖）。
 * 定向跑：node --test tests/remotion-timing-phase3.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  audioVolumeAt,
  colorShiftAt,
  duckWindowsFromSubtitles,
  EASINGS,
  easingFunctionFor,
  EXIT_DURATION_MAX,
  EXIT_DURATION_MIN,
  EXIT_DURATION_RATIO,
  exitStateAt,
  exitWindow,
  fadeInOnlyOpacity,
  interpolateState,
  lookStyles,
  mixColor,
  parseHexColor,
  pickSampleFrames,
  springEasing,
  splitTextUnits,
  textUnitProgress,
  waveformBars,
  waveformBarsSmoothed,
} from '../lib/remotion/timing.js'

function closeTo(actual, expected, tolerance = 1e-9, message = '') {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message} 期望 ${expected}（±${tolerance}），实际 ${actual}`,
  )
}

// ───────────────────── W2-1：老 4 档公式一字不改 + 新 8 档端点 ─────────────────────

test('缓动：老 4 档的公式与原实现**精确**一致（逐像素不变的唯一前提）', () => {
  // 这三行是历史 manifest 的视觉基线，不是"差不多"。改动它们等于给所有老片子换动画。
  closeTo(EASINGS.linear(0.37), 0.37, 0)
  closeTo(EASINGS.easeIn(0.37), 0.37 * 0.37, 0)
  closeTo(EASINGS.easeOut(0.37), 1 - 0.63 * 0.63, 0)
  closeTo(EASINGS.easeInOut(0.37), 2 * 0.37 * 0.37, 0)
  closeTo(EASINGS.easeInOut(0.63), 1 - 2 * 0.37 * 0.37, 0)
})

test('缓动：13 档全部端点收敛（f(0)=0、f(1)=1，含 backOut / spring）', () => {
  const names = Object.keys(EASINGS)
  assert.equal(names.length, 13, `白名单应有 13 档，实际 ${names.join(' / ')}`)
  for (const name of names) {
    closeTo(EASINGS[name](0), 0, 1e-9, `${name} 的 f(0)`)
    closeTo(EASINGS[name](1), 1, 1e-9, `${name} 的 f(1)`)
  }
})

test('缓动：新增 7 档单调不减（backOut / spring 除外 —— 它们的过冲是刻意的）', () => {
  const monotone = ['easeInCubic', 'easeOutCubic', 'easeInOutCubic', 'easeOutQuart', 'easeOutExpo', 'easeOutCirc', 'easeInOutExpo']
  for (const name of monotone) {
    let previous = -Infinity
    for (let i = 0; i <= 20; i += 1) {
      const value = EASINGS[name](i / 20)
      assert.ok(value >= previous - 1e-9, `${name} 在 t=${i / 20} 处回退了（${previous} → ${value}）`)
      assert.ok(Number.isFinite(value), `${name} 在 t=${i / 20} 处算出非有限值`)
      previous = value
    }
  }
})

// ───────────────────── W2-2：spring 闭式解 ─────────────────────

test('spring：端点精确、有过冲、且过冲幅度在「有重量感但不晃」的区间', () => {
  assert.equal(springEasing(0), 0, 't=0 必须精确是 0（否则入场首帧就跳一下）')
  assert.equal(springEasing(1), 1, 't=1 必须精确是 1（否则落位差一点点）')
  let peak = 0
  for (let i = 0; i <= 100; i += 1) peak = Math.max(peak, springEasing(i / 100))
  assert.ok(peak > 1.02, `缺省参数应当有过冲（否则 spring 等于普通 easeOut），实际峰值 ${peak}`)
  assert.ok(peak < 1.15, `过冲不能太夸张（>15% 观感是"弹簧"），实际峰值 ${peak}`)
})

test('spring：参数真的生效（刚度↑更快、阻尼↑更稳），且缺省/非法值可算', () => {
  const soft = springEasing(0.12, { stiffness: 60, damping: 18, mass: 1 })
  const stiff = springEasing(0.12, { stiffness: 400, damping: 18, mass: 1 })
  assert.ok(stiff > soft, `刚度更大的弹簧在早期应走得更远（${soft} vs ${stiff}）`)

  let softPeak = 0
  let heavyDampingPeak = 0
  for (let i = 0; i <= 100; i += 1) {
    softPeak = Math.max(softPeak, springEasing(i / 100, { stiffness: 170, damping: 10 }))
    heavyDampingPeak = Math.max(heavyDampingPeak, springEasing(i / 100, { stiffness: 170, damping: 40 }))
  }
  assert.ok(softPeak > heavyDampingPeak, `阻尼越大过冲越小（${softPeak} vs ${heavyDampingPeak}）`)
  assert.ok(heavyDampingPeak <= 1 + 1e-6, '过阻尼不该有过冲')

  // 非法参数（0 / NaN / 负数）必须回落缺省，不能算出 NaN
  for (const bad of [{ stiffness: 0 }, { damping: -5 }, { mass: Number.NaN }]) {
    const value = springEasing(0.4, bad)
    assert.ok(Number.isFinite(value), `非法参数 ${JSON.stringify(bad)} 算出了非有限值`)
  }
})

test('easingFunctionFor：spring 带参数；白名单外的脏值回落缺省（不抛）', () => {
  closeTo(easingFunctionFor('spring', { stiffness: 170, damping: 18 })(0.3), springEasing(0.3, { stiffness: 170, damping: 18 }), 0)
  closeTo(easingFunctionFor(undefined, undefined)(0.3), EASINGS.easeInOut(0.3), 0)
  closeTo(easingFunctionFor('not-a-real-easing', undefined)(0.3), EASINGS.easeInOut(0.3), 0)
})

test('interpolateState：opacity 被 clamp 在 0–1，x/y/scale 的过冲保留', () => {
  const overshooting = EASINGS.backOut
  const x = interpolateState({ x: 0 }, { x: 100 }, overshooting(0.75))
  assert.ok((x.x ?? 0) > 100, '位移的过冲必须保留（「弹一下」就是它）')

  const opacity = interpolateState({ opacity: 0 }, { opacity: 1 }, overshooting(0.75))
  assert.ok((opacity.opacity ?? -1) <= 1, `opacity 过冲成 ${opacity.opacity} 是非法样式`)
  assert.ok((opacity.opacity ?? -1) >= 0)
})

// ───────────────────── W1-1：exit ─────────────────────

test('exitWindow：缺省时长 = 入场时长 × 0.6 并 clamp 到 4–12 帧', () => {
  assert.equal(EXIT_DURATION_RATIO, 0.6)
  assert.equal(EXIT_DURATION_MIN, 4)
  assert.equal(EXIT_DURATION_MAX, 12)
  const exit = { to: { opacity: 0 } }

  const long = exitWindow({ durationInFrames: 60, animate: { from: {}, to: {}, durationInFrames: 20 }, exit })
  assert.deepEqual(long, { start: 48, duration: 12 }, '20 帧入场 ⇒ 12 帧退场（上限）')

  const short = exitWindow({ durationInFrames: 60, animate: { from: {}, to: {}, durationInFrames: 10 }, exit })
  assert.deepEqual(short, { start: 54, duration: 6 }, '10 帧入场 ⇒ 6 帧退场')

  const tiny = exitWindow({ durationInFrames: 60, animate: { from: {}, to: {}, durationInFrames: 2 }, exit })
  assert.equal(tiny.duration, 4, '再短也不会低于 4 帧（否则肉眼看不出）')

  assert.equal(exitWindow({ durationInFrames: 60 }), null, '没有 exit ⇒ null（老 manifest 完全不受影响）')
})

test('exitWindow：gapFrames 把退场整体提前；显式时长优先于比例', () => {
  const gapped = exitWindow({
    durationInFrames: 60,
    animate: { from: {}, to: {}, durationInFrames: 10 },
    exit: { to: { opacity: 0 }, gapFrames: 4 },
  })
  assert.deepEqual(gapped, { start: 50, duration: 6 })

  const explicit = exitWindow({
    durationInFrames: 60,
    animate: { from: {}, to: {}, durationInFrames: 10 },
    exit: { to: { opacity: 0 }, durationInFrames: 9 },
  })
  assert.deepEqual(explicit, { start: 51, duration: 9 })
})

test('exitStateAt：窗口之前返回 null（不干扰入场）；首帧与入场读数连续；末帧精确落到 to', () => {
  const track = {
    durationInFrames: 60,
    animate: { from: { y: 60, opacity: 0 }, to: { y: 50, opacity: 1 }, durationInFrames: 20 },
    exit: { to: { y: 44, opacity: 0 }, durationInFrames: 8 },
  }
  const window = exitWindow(track)
  assert.equal(exitStateAt(track, window.start - 1), null, '窗口前一帧不该有退场覆盖')

  const atStart = exitStateAt(track, window.start)
  assert.deepEqual(atStart, { y: 50, opacity: 1 }, '退场起点必须**接住**入场读数（不跳变）')

  const last = exitStateAt(track, 59)
  closeTo(last.y, 44, 1e-6, '末帧 y 必须走完')
  closeTo(last.opacity, 0, 1e-6, '末帧 opacity 必须归零 —— 否则紧接轨道结束就是一下跳黑')

  // 单调推进（不允许中途回头）
  let previousOpacity = 1.1
  for (let frame = window.start; frame < 60; frame += 1) {
    const state = exitStateAt(track, frame)
    assert.ok(state.opacity <= previousOpacity + 1e-9, `第 ${frame} 帧透明度回升了`)
    previousOpacity = state.opacity
  }
})

test('fadeInOnlyOpacity：有 exit 时尾部不再淡出（否则与退场叠成「灰一下」）', () => {
  assert.equal(fadeInOnlyOpacity(0, 60, 6), 0, '首帧仍是 0（首部淡入保留）')
  assert.equal(fadeInOnlyOpacity(3, 60, 6), 0.5)
  for (let frame = 6; frame < 60; frame += 1) {
    assert.equal(fadeInOnlyOpacity(frame, 60, 6), 1, `第 ${frame} 帧尾部不该再压透明度`)
  }
})

// ───────────────────── W2-3：颜色过渡 ─────────────────────

test('parseHexColor：#rgb 会展开；非法输入返回 null，绝不抛', () => {
  assert.deepEqual(parseHexColor('#fff'), [255, 255, 255])
  assert.deepEqual(parseHexColor('#4f9cf9'), [79, 156, 249])
  assert.deepEqual(parseHexColor('  #000  '), [0, 0, 0], '前后空白应被忽略')
  assert.equal(parseHexColor('rgb(1,2,3)'), null)
  assert.equal(parseHexColor('#12345'), null)
  assert.equal(parseHexColor(''), null)
})

test('mixColor：中点插值四舍五入；任一非法返回 null（调用方保留原色）', () => {
  assert.equal(mixColor('#000000', '#ffffff', 0.5), 'rgb(128, 128, 128)')
  assert.equal(mixColor('#000', '#fff', 0), 'rgb(0, 0, 0)')
  assert.equal(mixColor('#000', '#fff', 1), 'rgb(255, 255, 255)')
  assert.equal(mixColor('#000', '#fff', 9), 'rgb(255, 255, 255)', 'progress 越界按端点收敛')
  assert.equal(mixColor('red', '#fff', 0.5), null)
})

test('colorShiftAt：区间外取端点；无 colorShift 返回 null；缓动生效', () => {
  const track = { durationInFrames: 100, colorShift: { from: '#000000', to: '#ffffff', startFrame: 10, durationInFrames: 20, easing: 'linear' } }
  assert.equal(colorShiftAt(track, 0), 'rgb(0, 0, 0)', '起点前取 from')
  assert.equal(colorShiftAt(track, 10), 'rgb(0, 0, 0)')
  assert.equal(colorShiftAt(track, 20), 'rgb(128, 128, 128)', '中点')
  assert.equal(colorShiftAt(track, 40), 'rgb(255, 255, 255)', '终点后取 to')
  assert.equal(colorShiftAt({ durationInFrames: 100 }, 50), null)
})

// ───────────────────── W2-4：meta.look ─────────────────────

test('lookStyles：缺省 / 中性值 ⇒ 三层全不挂（老 manifest 逐像素不变）', () => {
  const none = lookStyles(undefined, 30)
  assert.deepEqual(none, { filter: null, vignetteBackground: null, grainOpacity: 0, grainOffsetX: 0, grainOffsetY: 0 })

  const neutral = lookStyles({ contrast: 1, saturation: 1, brightness: 1, temperature: 0 }, 30)
  assert.equal(neutral.filter, null, '中性值不该拼出 filter 串')
  assert.equal(neutral.vignetteBackground, null)
  assert.equal(neutral.grainOpacity, 0)
})

test('lookStyles：四个色彩分量拼成一条 filter；暗角与颗粒各自成层', () => {
  const styles = lookStyles({ contrast: 1.06, saturation: 1.12, brightness: 1.02, temperature: 0.12, vignette: 0.35, grain: 0.16 }, 30)
  assert.match(styles.filter, /^contrast\(1\.06\) saturate\(1\.12\) brightness\(1\.02\) sepia\(/)
  // OPT-9 修复后暖调角度按 |temperature| 缩放：0.12 → -1.44°（旧实现恒 -12°）。
  assert.match(styles.filter, /hue-rotate\(-1\.44deg\)$/, '暖色温走负角度且按强度缩放')
  assert.match(styles.vignetteBackground, /^radial-gradient\(ellipse at center, rgba\(0,0,0,0\) 42%/)
  assert.equal(styles.grainOpacity, 0.16)
})

test('lookStyles：暖调满档 t=1 与旧实现一致（sepia(0.28) + hue-rotate(-12deg)）', () => {
  const styles = lookStyles({ temperature: 1 }, 30)
  assert.equal(styles.filter, 'sepia(0.28) hue-rotate(-12deg)')
})

test('lookStyles：冷调 = 低饱和 + 微角度偏青，不垫 sepia、不出现大角度旋转（OPT-9）', () => {
  // 旧实现：sepia + hue-rotate(168deg) 把冷蓝 220° 拧到 28° 橙棕（真机事故）。
  const cold = lookStyles({ temperature: -0.55 }, 30)
  assert.equal(cold.filter, 'saturate(0.879) hue-rotate(7.7deg)', `冷调应为低饱和+微旋：${cold.filter}`)
  assert.ok(!cold.filter.includes('sepia'), '冷调不该垫 sepia（先弄黄再拧回是事故根源）')

  const full = lookStyles({ temperature: -1 }, 30)
  assert.equal(full.filter, 'saturate(0.78) hue-rotate(14deg)', '冷调满档 = saturate(0.78) + 14° 微旋')
  assert.ok(!full.filter.includes('168'), '任何冷调都不该再出现 168° 大角度（反向变异靶：恢复恒定角即红）')
})

test('lookStyles：颗粒偏移只依赖帧号（同帧可重复；相邻帧不同；恒在 0–255）', () => {
  const look = { grain: 0.2 }
  const a = lookStyles(look, 30)
  const b = lookStyles(look, 30)
  assert.deepEqual(a, b, '同一帧算两次必须完全一致（确定性渲染的硬要求）')

  const next = lookStyles(look, 31)
  assert.notEqual(`${a.grainOffsetX},${a.grainOffsetY}`, `${next.grainOffsetX},${next.grainOffsetY}`)

  for (const frame of [0, 1, 47, 255, 256, 1000, 99999]) {
    const styles = lookStyles(look, frame)
    assert.ok(styles.grainOffsetX >= 0 && styles.grainOffsetX <= 255, `第 ${frame} 帧 X 偏移越界：${styles.grainOffsetX}`)
    assert.ok(styles.grainOffsetY >= 0 && styles.grainOffsetY <= 255, `第 ${frame} 帧 Y 偏移越界：${styles.grainOffsetY}`)
    assert.ok(Number.isInteger(styles.grainOffsetX) && Number.isInteger(styles.grainOffsetY), '偏移必须是整数像素')
  }
})

// ───────────────────── W3-3：波形平滑 ─────────────────────

test('waveformBarsSmoothed：smoothing=0 与不平滑完全等价（老片子不受影响）', () => {
  const amplitudes = [0.2, 0.9, 0.4, 1, 0.1, 0]
  for (const frame of [0, 3, 17, 120]) {
    assert.deepEqual(
      waveformBarsSmoothed(amplitudes, frame, { bars: 6, smoothing: 0 }),
      waveformBars(amplitudes, frame, { bars: 6 }),
      `第 ${frame} 帧：smoothing=0 必须退化成原实现`,
    )
  }
})

test('waveformBarsSmoothed：平滑真的改变取值、结果有界、且同帧可重复', () => {
  const amplitudes = [1, 0, 1, 1]
  const raw = waveformBars(amplitudes, 2, { bars: 2 })
  const smoothed = waveformBarsSmoothed(amplitudes, 2, { bars: 2, smoothing: 0.5 })
  assert.notDeepEqual(smoothed, raw, '平滑后不该与原始值相同（否则等于没接）')
  for (const value of smoothed) {
    assert.ok(value >= 0 && value <= 1, `柱高越界：${value}`)
  }
  assert.deepEqual(
    waveformBarsSmoothed(amplitudes, 2, { bars: 2, smoothing: 0.5 }),
    smoothed,
    '同一帧算两次必须一致',
  )

  // 恒定信号经平滑后仍是恒定值（EMA 不该改变常量）
  const flat = waveformBarsSmoothed([0.5, 0.5, 0.5, 0.5], 40, { bars: 4, smoothing: 0.7 })
  for (const value of flat) closeTo(value, 0.5, 1e-9, '常量信号被平滑改变')
})

// ───────────────────── W4-2：文本动效 ─────────────────────

test('splitTextUnits：拉丁按词、CJK 逐字、空白保留；typewriter 逐字符', () => {
  assert.deepEqual(splitTextUnits('Hello 世界', 'fadeUp'), ['Hello', ' ', '世', '界'])
  assert.deepEqual(splitTextUnits('Hello 世界', 'typewriter'), ['H', 'e', 'l', 'l', 'o', ' ', '世', '界'])
  assert.deepEqual(splitTextUnits('', 'fadeUp'), [])
  // 拼接必须还原原文（否则"逐词"会把空格吃掉、字幕粘成一坨）
  for (const preset of ['fadeUp', 'maskReveal', 'typewriter', 'wordStagger']) {
    assert.equal(splitTextUnits('A B 世界', preset).join(''), 'A B 世界', `${preset} 切分后拼接不回原文`)
  }
})

test('textUnitProgress：按 index 错峰、单元素时长生效、端点收敛', () => {
  const options = { preset: 'fadeUp', wordDelayFrames: 3, unitDurationInFrames: 12 }
  assert.equal(textUnitProgress(0, 0, options), 0)
  assert.equal(textUnitProgress(0, 6, options) > 0, true)
  assert.equal(textUnitProgress(1, 2, options), 0, '第 2 个单元要等 3 帧才起步')
  assert.equal(textUnitProgress(1, 15, options), 1, '1 个错峰 + 12 帧时长 ⇒ 第 15 帧走完')
  assert.ok(textUnitProgress(1, 10, options) > 0, '窗口内必须有中间值')
  assert.ok(textUnitProgress(1, 10, options) < 1)
  closeTo(textUnitProgress(0, 12, options), 1, 1e-9, '单元素走完')
  closeTo(textUnitProgress(0, 999, options), 1, 1e-9, '之后恒为 1')

  // typewriter 缺省错 1 帧（逐字打出来）：第 1 个字从 0 帧起步，第 2 个从 1 帧起步
  assert.equal(textUnitProgress(1, 0, { preset: 'typewriter' }), 0)
  assert.equal(textUnitProgress(1, 1, { preset: 'typewriter' }), 0, '第 2 个字在 1 帧时刚开始（progress 仍是 0）')
  assert.ok(textUnitProgress(1, 2, { preset: 'typewriter' }) > 0)
})

// ───────────────────── W3-2：音量包络与闪避 ─────────────────────

test('audioVolumeAt：无包络时恒为基础音量', () => {
  const options = { durationInFrames: 100, fps: 30, baseVolume: 0.8 }
  for (const frame of [0, 1, 50, 99]) closeTo(audioVolumeAt(frame, options), 0.8, 1e-12)
})

test('audioVolumeAt：淡入淡出按秒换算成帧，端点正确', () => {
  const options = { durationInFrames: 100, fps: 30, baseVolume: 0.8, fadeInSeconds: 0.5, fadeOutSeconds: 1 }
  closeTo(audioVolumeAt(0, options), 0, 1e-12, '首帧静音')
  closeTo(audioVolumeAt(15, options), 0.8, 1e-12, '淡入 0.5s = 15 帧后满音量')
  closeTo(audioVolumeAt(50, options), 0.8, 1e-12, '中段满音量')
  assert.ok(audioVolumeAt(99, options) < 0.05, '末帧应接近静音')

  // 淡出必须单调下降
  let previous = 1
  for (let frame = 67; frame <= 99; frame += 1) {
    const value = audioVolumeAt(frame, options)
    assert.ok(value <= previous + 1e-12, `第 ${frame} 帧音量回升了`)
    previous = value
  }
})

test('audioVolumeAt：闪避窗口内压到 amount，前后有 ramp 且方向正确（不许"弹一下"）', () => {
  const options = {
    durationInFrames: 200, fps: 30, baseVolume: 0.8,
    duckAmount: 0.55, duckWindows: [{ startFrame: 50, durationInFrames: 40 }], duckRampFrames: 6,
  }
  closeTo(audioVolumeAt(50, options), 0.8 * 0.55, 1e-12, '窗口首帧即压到位')
  closeTo(audioVolumeAt(70, options), 0.8 * 0.55, 1e-12, '窗口内恒定')
  closeTo(audioVolumeAt(89, options), 0.8 * 0.55, 1e-12, '窗口末帧仍压着')
  closeTo(audioVolumeAt(44, options), 0.8, 1e-12, 'ramp 起点仍是满音量')
  closeTo(audioVolumeAt(96, options), 0.8, 1e-12, '窗口结束 6 帧后恢复')

  // 进窗口前必须**单调下降**（写反的话会先升到满音量再突降，听感是音乐弹一下）
  let previous = Number.POSITIVE_INFINITY
  for (let frame = 44; frame <= 50; frame += 1) {
    const value = audioVolumeAt(frame, options)
    assert.ok(value <= previous + 1e-12, `第 ${frame} 帧在进窗口前回升了（${previous} → ${value}）`)
    previous = value
  }
  // 出窗口后必须单调上升
  previous = -1
  for (let frame = 90; frame <= 96; frame += 1) {
    const value = audioVolumeAt(frame, options)
    assert.ok(value >= previous - 1e-12, `第 ${frame} 帧在出窗口后回降了`)
    previous = value
  }
})

test('duckWindowsFromSubtitles：只认 subtitle 轨，按起点排序', () => {
  const manifest = {
    id: 'm', meta: { title: 't', width: 1280, height: 720, fps: 30, durationInFrames: 300 },
    tracks: [
      { id: 's2', type: 'textCard', variant: 'subtitle', text: '第二句', startFrame: 80, durationInFrames: 60 },
      { id: 'title', type: 'textCard', variant: 'title', text: '标题', startFrame: 0, durationInFrames: 300 },
      { id: 's1', type: 'textCard', variant: 'subtitle', text: '第一句', startFrame: 20, durationInFrames: 60 },
      { id: 's0', type: 'textCard', variant: 'subtitle', text: '零长', startFrame: 5, durationInFrames: 0 },
    ],
  }
  assert.deepEqual(duckWindowsFromSubtitles(manifest), [
    { startFrame: 20, durationInFrames: 60 },
    { startFrame: 80, durationInFrames: 60 },
  ], '零长字幕不该产生闪避窗口')
})

// ───────────────────── W6-1：抽帧位置 ─────────────────────

test('pickSampleFrames：4 张均匀 + 转场中点，升序、去重、上限 8、恒在片内', () => {
  const manifest = {
    id: 'm', meta: { title: 't', width: 1280, height: 720, fps: 30, durationInFrames: 300 },
    tracks: [
      { id: 'a', type: 'image', src: '/canvas-studio/assets/p/a.png', startFrame: 0, durationInFrames: 150 },
      { id: 'b', type: 'image', src: '/canvas-studio/assets/p/b.png', startFrame: 130, durationInFrames: 170 },
      { id: 't1', type: 'transition', effect: 'fade', fromTrackId: 'a', toTrackId: 'b', startFrame: 138, durationInFrames: 12 },
    ],
  }
  assert.deepEqual(pickSampleFrames(manifest), [0, 75, 144, 150, 225])

  // 上限 8：塞 12 条转场也只能出 8 张
  const many = {
    ...manifest,
    tracks: [
      manifest.tracks[0],
      manifest.tracks[1],
      ...Array.from({ length: 12 }, (_, i) => ({
        id: `t${i}`, type: 'transition', effect: 'fade',
        fromTrackId: 'a', toTrackId: 'b', startFrame: 10 + i * 10, durationInFrames: 12,
      })),
    ],
  }
  const picks = pickSampleFrames(many)
  assert.ok(picks.length <= 8, `抽帧数必须封顶 8，实际 ${picks.length}`)
  assert.deepEqual(picks, [...new Set(picks)].sort((a, b) => a - b), '必须升序且去重')
  for (const frame of picks) {
    assert.ok(frame >= 0 && frame < 300, `抽帧位置越界：${frame}`)
  }
})

test('pickSampleFrames：极短片（1 帧）也只取合法的 0', () => {
  const picks = pickSampleFrames({ id: 'm', meta: { title: 't', width: 1, height: 1, fps: 30, durationInFrames: 1 }, tracks: [] })
  assert.deepEqual(picks, [0])
})
