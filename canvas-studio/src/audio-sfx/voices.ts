/**
 * 音效配方（0A · CV-460）。5 支 === GT 的 7 条事件所需的全部不同素材
 * （`card` 用三次、其余各一次，见 `gt/mix-report.json`）。
 *
 * 公式逐条照抄 `gt/native_audiolib.py`（行号标注在每支上），包括系数。
 * **不做归一化**：系数是 GT 的口径（`.55` / `.12` / `.9`），改了就不叫"照抄"。
 * 峰值统一由 `scripts/build-sfx.mjs` 决定（那里才是「我们自己的交付口径」）。
 */
import {
  type Mono,
  SFX_SAMPLE_RATE,
  add,
  bandpass,
  lowpass,
  mulberry32,
  noise,
  sampleCount,
  scale,
  sine,
  timeAxis,
} from './dsp.js'

/** 一支音效的合成描述。 */
export interface SfxVoice {
  /** 落盘文件名（不含扩展名），也是 manifest 里 `type` 的推荐值。 */
  id: string
  /** 一句话说明它听感上是什么（写进清单 JSON，供模型选型）。 */
  label: string
  /** 生成函数。每个 voice 独立 PRNG（seed 由 id 派生，与构建顺序无关）。 */
  render: (rand: () => number) => Mono
}

/**
 * `whoosh(d=.45, bright=2500)`（`native_audiolib.py:128`）。
 *
 * 分段做带通：每 30ms 一段，中心频率按 `300 + bright·sin(πk)` 走一遍弧线 ——
 * 这是「呼——」的扫频感来源。每段多取 300 个样本做边界再截回，避免段界爆音
 * （与源实现同做法）。
 */
export function whoosh(rand: () => number, d = 0.45, bright = 2500): Mono {
  const n = noise(d, rand)
  const t = timeAxis(d)
  const out = new Float64Array(t.length)
  const seg = Math.trunc(SFX_SAMPLE_RATE * 0.03)
  for (let i = 0; i < t.length; i += seg) {
    const k = i / t.length
    const fc = 300 + bright * Math.sin(Math.PI * k)
    const slice = bandpass(n.subarray(i, Math.min(n.length, i + seg + 300)), fc * 0.5, fc * 1.5)
    const take = Math.min(seg, t.length - i)
    for (let j = 0; j < take; j += 1) out[i + j] = slice[j] ?? 0
  }
  for (let i = 0; i < out.length; i += 1) {
    out[i]! *= Math.sin((Math.PI * t[i]!) / d) ** 2 * 0.9
  }
  return out
}

/** `thud()`（`:241`）：600Hz 低通噪声 + 90Hz 正弦，双指数衰减 ⇒ 闷响。 */
function thud(rand: () => number): Mono {
  const t = timeAxis(0.15)
  const body = lowpass(noise(0.15, rand), 600)
  const tone = sine(90, t)
  const out = new Float64Array(t.length)
  for (let i = 0; i < t.length; i += 1) {
    out[i] = (body[i]! * Math.exp(-t[i]! * 30) + tone[i]! * Math.exp(-t[i]! * 25)) * 0.55
  }
  return out
}

/** `write(d)`（`:240`）：2.5–8kHz 带通噪声，5Hz 幅度抖动，首尾正弦窗 ⇒ 笔尖摩擦。 */
function write(rand: () => number, d = 1.2): Mono {
  const t = timeAxis(d)
  const body = bandpass(noise(d, rand), 2500, 8000)
  const out = new Float64Array(t.length)
  for (let i = 0; i < t.length; i += 1) {
    const wobble = 0.5 + 0.5 * Math.abs(Math.sin(2 * Math.PI * 5 * t[i]!))
    out[i] = body[i]! * wobble * 0.12 * Math.sin((Math.PI * t[i]!) / d)
  }
  return out
}

/**
 * 配方表。**id 就是 manifest 里的 `type` 与文件名**，三者同一套词，避免
 * 「清单叫 swoosh、文件叫 whoosh、manifest 写 swipe」这类对不上的事故。
 */
export const SFX_VOICES: ReadonlyArray<SfxVoice> = [
  {
    id: 'thud',
    label: '低频闷响（物体落下/句子落地）',
    // swoosh() = whoosh(.3, 4000) * .7
    render: (rand) => thud(rand),
  },
  {
    id: 'write',
    label: '笔尖摩擦 1.2 秒（长句书写/打字氛围）',
    render: (rand) => write(rand, 1.2),
  },
  {
    id: 'swoosh',
    label: '明亮呼啸 0.3 秒（元素飞出/场景切换）',
    render: (rand) => scale(whoosh(rand, 0.3, 4000), 0.7),
  },
  {
    id: 'card',
    label: '卡片入场 0.3 秒（三连卡依次弹出）',
    // cardS() = whoosh(.3, 2500) * .45
    render: (rand) => scale(whoosh(rand, 0.3, 2500), 0.45),
  },
  {
    id: 'swipe',
    label: '短促划过 0.25 秒（收尾/翻页）',
    // swipeS() = whoosh(.25, 5000) * .5
    render: (rand) => scale(whoosh(rand, 0.25, 5000), 0.5),
  },
]

/** 按 id 取配方。 */
export function voiceById(id: string): SfxVoice | undefined {
  return SFX_VOICES.find((voice) => voice.id === id)
}

/**
 * 由 voice id 派生 PRNG seed。
 *
 * 为什么不用固定 11：5 支音效若共用同一序列，`swoosh` 与 `card` 只是同一段噪声
 * 换了滤波 ⇒ 听感会"同质"（GT 里它们本来就不同 seed）。用 id 的 FNV-1a 派生，
 * 既保证**同 id 永远同结果**（幂等），又让各支互不相关。
 */
export function seedFor(id: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** 渲染一支音效（单声道，未归一化）。 */
export function renderVoice(voice: SfxVoice): Mono {
  return voice.render(mulberry32(seedFor(voice.id)))
}

/** 供测试与清单用：一支音效的采样数。 */
export function voiceSamples(voice: SfxVoice): number {
  return renderVoice(voice).length
}

/** 导出以便测试覆盖 add（当前配方未用到，但保持 DSP 面完整）。 */
export { add, sampleCount }
