/**
 * 音效合成 DSP 原语（0A · CV-460）。
 *
 * 移植来源：`docs/plans/2026-11-10-视频模板化/gt/native_audiolib.py`（GT 混音器的
 * 合成库，固定 seed 11）。公式与默认参数逐条照抄，**但绝不追求位级复刻** ——
 * numpy 的 PCG64 + `standard_normal` 在 JS 里复刻不了，而验收判据（LUFS / 事件
 * 窗口峰值 ±6dB / 起音帧号）也不看波形位级。噪声 seed 不同 ⇒ 频谱包络一致、
 * 人耳无差。
 *
 * 三条硬约束：
 * 1. **确定性**：同 seed 同输入必须同字节输出（`build-sfx` 幂等靠它）。
 * 2. **零依赖**：不引 npm 包（沙箱装不了库，与 `scripts/build-grain-tile.mjs` 同因）。
 * 3. **离线**：只在构建期跑，渲染期不调用（浏览器里跑不了这套 DSP，
 *    且合成必须确定性 —— 见任务包 0A 决策 2）。
 */

/** 采样率。与 `AUDIO_DELIVERY_SAMPLE_RATE` 一致 ⇒ 渲染期不必重采样。 */
export const SFX_SAMPLE_RATE = 48000

/** 一条单声道信号（长度 = 采样数）。 */
export type Mono = Float64Array

/**
 * 确定性 PRNG（mulberry32）。同 seed ⇒ 同序列，跨平台一致。
 * 不用 `Math.random`：那会让产物每次不同，`build-sfx` 就无法幂等。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box-Muller 标准正态（numpy `standard_normal` 的等价分布，非等价序列）。 */
export function gaussian(rand: () => number): number {
  // 1 - u 避免 ln(0)
  const u1 = 1 - rand()
  const u2 = rand()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/** 时长（秒）→ 采样数。与 numpy `len(T(d))` = `int(SR*d)` 同口径。 */
export function sampleCount(seconds: number): number {
  return Math.trunc(SFX_SAMPLE_RATE * seconds)
}

/** `T(d)`：时间轴数组（秒）。 */
export function timeAxis(seconds: number): Mono {
  const n = sampleCount(seconds)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i += 1) out[i] = i / SFX_SAMPLE_RATE
  return out
}

/** 白噪声（标准正态）。 */
export function noise(seconds: number, rand: () => number): Mono {
  const n = sampleCount(seconds)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i += 1) out[i] = gaussian(rand)
  return out
}

/** 正弦（`sin_(f,t)`）。 */
export function sine(freq: number, t: Mono): Mono {
  const out = new Float64Array(t.length)
  for (let i = 0; i < t.length; i += 1) out[i] = Math.sin(2 * Math.PI * freq * t[i]!)
  return out
}

/**
 * FIR 低通（`lowpass`）：255 抽头 sinc × Hamming，归一化后卷积，取中间段。
 *
 * 用**直接卷积**而不是 numpy 的 FFT 卷积：0.3s 片段 × 255 抽头 ≈ 370 万次乘加，
 * 几十毫秒就能跑完，为它写一套 FFT 是纯增加出错面。
 */
export function lowpass(x: Mono, cutoffHz: number, taps = 255): Mono {
  const k = taps
  const half = Math.floor(k / 2)
  const h = new Float64Array(k)
  const norm = (2 * Math.PI * cutoffHz) / SFX_SAMPLE_RATE
  let sum = 0
  for (let i = 0; i < k; i += 1) {
    const n = i - half
    // sinc(2fc/SR * n)：n=0 时极限为 1
    const arg = n === 0 ? 0 : Math.PI * norm * n
    const sinc = n === 0 ? 1 : Math.sin(arg) / arg
    const hamming = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (k - 1))
    h[i] = sinc * hamming
    sum += h[i]!
  }
  for (let i = 0; i < k; i += 1) h[i]! /= sum

  const n = x.length
  const out = new Float64Array(n)
  // 与 numpy 的 fir 一致：全卷积后从 len(h)//2 处起取 n 个样本（零相位居中）
  for (let i = 0; i < n; i += 1) {
    let acc = 0
    for (let j = 0; j < k; j += 1) {
      const idx = i + j - half
      if (idx >= 0 && idx < n) acc += x[idx]! * h[j]!
    }
    out[i] = acc
  }
  return out
}

/** 高通 = 原信号减低通（`highpass`）。 */
export function highpass(x: Mono, cutoffHz: number): Mono {
  const lp = lowpass(x, cutoffHz)
  const out = new Float64Array(x.length)
  for (let i = 0; i < x.length; i += 1) out[i] = x[i]! - lp[i]!
  return out
}

/** 带通 = 先高通再低通（`bandpass`）。 */
export function bandpass(x: Mono, loHz: number, hiHz: number): Mono {
  return lowpass(highpass(x, loHz), hiHz)
}

/** 逐点乘（对齐长度取短）。 */
export function mul(a: Mono, b: Mono): Mono {
  const n = Math.min(a.length, b.length)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i += 1) out[i] = a[i]! * b[i]!
  return out
}

/** 逐点加（对齐长度取短）。 */
export function add(a: Mono, b: Mono): Mono {
  const n = Math.min(a.length, b.length)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i += 1) out[i] = a[i]! + b[i]!
  return out
}

/** 标量乘。 */
export function scale(x: Mono, g: number): Mono {
  const out = new Float64Array(x.length)
  for (let i = 0; i < x.length; i += 1) out[i] = x[i]! * g
  return out
}

/** 截断到前 n 个样本（不足则原样返回）。 */
export function truncate(x: Mono, n: number): Mono {
  return x.length <= n ? x : x.subarray(0, n)
}

/**
 * 等功率声像（`pan`）。返回 [L, R]。
 * `p = −1` 全左、`0` 居中、`+1` 全右；公式与 `gt/native_audiolib.py` 的 `pan()` 一致。
 *
 * MVP 只用 `p = 0`（见决策日志 D-09：不复刻 GT 的 ±0.2 声像），但这里实现全量，
 * 因为将来要复刻时只改调用侧、不改 DSP。
 */
export function paneSplit(x: Mono, p: number): [Mono, Mono] {
  const clamped = Math.max(-1, Math.min(1, p))
  const gl = Math.sqrt((1 - clamped) / 2)
  const gr = Math.sqrt((1 + clamped) / 2)
  const left = new Float64Array(x.length)
  const right = new Float64Array(x.length)
  for (let i = 0; i < x.length; i += 1) {
    left[i] = x[i]! * gl
    right[i] = x[i]! * gr
  }
  return [left, right]
}

/** 峰值绝对值。 */
export function peakOf(x: Mono): number {
  let peak = 0
  for (let i = 0; i < x.length; i += 1) {
    const v = Math.abs(x[i]!)
    if (v > peak) peak = v
  }
  return peak
}

/**
 * 归一到目标峰值（缺省 0.89 ≈ −1 dBFS）。
 *
 * 为什么需要它：`thud` 一类音效公式里的系数（`.55` / `.12`）是按 GT 混音器
 * **下游还有总线增益**的前提写的，单拿出来听会偏小。归一到同一峰值后，
 * 事件间的相对音量关系由 manifest 的 `gain` 决定（那才是模型的调音位）。
 */
export function normalizePeak(x: Mono, target = 0.89): Mono {
  const peak = peakOf(x)
  if (peak <= 1e-9) return x
  return scale(x, target / peak)
}
