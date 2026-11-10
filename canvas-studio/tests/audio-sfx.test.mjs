/**
 * 0A · 音效合成库（CV-460）。
 *
 * 这一层最容易「测试全绿但听感全错」：时长对、峰值对、WAV 头对，但滤波器方向反了
 * 或者 bright 参数没生效 ⇒ 所有数值断言都过，耳朵一听全是错的。
 *
 * 所以除了常规断言，这里**用频谱特征（过零率）钉住音色的方向**：
 * - `thud` 必须是低频（600Hz 低通 + 90Hz 正弦）
 * - `write` 必须是高频（2.5–8kHz 带通）
 * - `whoosh` 的 bright 参数必须真的生效：swipe(5000) > swoosh(4000) > card(2500)
 *
 * 真值配方见 `docs/plans/2026-11-10-视频模板化/gt/native_audiolib.py`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SFX_SAMPLE_RATE,
  SFX_VOICES,
  SFX_URL_PREFIX,
  SFX_ASSET_VERSION,
  encodeWavStereo,
  gaussian,
  highpass,
  lowpass,
  mulberry32,
  normalizePeak,
  paneSplit,
  peakOf,
  readWavHeader,
  renderVoice,
  sampleCount,
  seedFor,
  voiceById,
  whoosh,
} from '../lib/audio-sfx/index.js'

/** 过零率（每秒）。高频信号过零多、低频少 —— 用来验证滤波方向。 */
function zeroCrossPerSec(x, sampleRate = SFX_SAMPLE_RATE) {
  let crossings = 0
  let prev = x[0] ?? 0
  for (let i = 1; i < x.length; i += 1) {
    const v = x[i]
    if ((v >= 0) !== (prev >= 0)) crossings += 1
    prev = v
  }
  return crossings / (x.length / sampleRate)
}

/** RMS（线性）。 */
function rms(x) {
  let sum = 0
  for (let i = 0; i < x.length; i += 1) sum += x[i] * x[i]
  return Math.sqrt(sum / Math.max(1, x.length))
}

// ───────────────── ① 确定性（不能有 Math.random） ─────────────────

test('0A-DSP：同一 seed 的 PRNG 序列完全一致（产物可复现的前提）', () => {
  const a = mulberry32(11)
  const b = mulberry32(11)
  for (let i = 0; i < 50; i += 1) assert.equal(a(), b(), `第 ${i} 个数不同`)
})

test('0A-DSP：seedFor 由 id 派生且稳定（同 id → 同 seed，不同 id → 不同 seed）', () => {
  assert.equal(seedFor('thud'), seedFor('thud'))
  assert.notEqual(seedFor('thud'), seedFor('write'))
})

test('0A-DSP：★ 同一支音效渲染两次逐样本相同（确定性，Remotion 的硬要求）', () => {
  for (const id of ['thud', 'write', 'swoosh', 'card', 'swipe']) {
    const voice = voiceById(id)
    assert.ok(voice !== undefined, `缺 ${id} 配方`)
    const a = renderVoice(voice)
    const b = renderVoice(voice)
    assert.equal(a.length, b.length)
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) assert.fail(`${id} 第 ${i} 个样本不一致：${a[i]} vs ${b[i]}`)
    }
  }
})

test('0A-DSP：gaussian 落在合理范围（不是常量、不是 NaN）', () => {
  const rand = mulberry32(7)
  let nonZero = 0
  for (let i = 0; i < 200; i += 1) {
    const v = gaussian(rand)
    assert.ok(Number.isFinite(v), `gaussian 产生了非有限值 ${v}`)
    assert.ok(Math.abs(v) < 8, `gaussian 值异常大 ${v}`)
    if (v !== 0) nonZero += 1
  }
  assert.ok(nonZero > 190, 'gaussian 几乎全是 0 —— PRNG 有问题')
})

// ───────────────── ② DSP 正确性 ─────────────────

test('0A-DSP：lowpass / highpass 输出长度与输入等长', () => {
  const rand = mulberry32(3)
  const x = new Float64Array(sampleCount(0.05)).map(() => gaussian(rand))
  assert.equal(lowpass(x, 600).length, x.length)
  assert.equal(highpass(x, 600).length, x.length)
})

test('0A-DSP：lowpass 真的去掉了高频（过零率显著下降）', () => {
  const rand = mulberry32(3)
  const x = new Float64Array(sampleCount(0.2)).map(() => gaussian(rand))
  const before = zeroCrossPerSec(x)
  const after = zeroCrossPerSec(lowpass(x, 600))
  assert.ok(after < before / 3, `lowpass 后过零率应至少降到 1/3：${before.toFixed(0)} → ${after.toFixed(0)}`)
})

test('0A-DSP：highpass 真的去掉了低频（直流分量为 0）', () => {
  const x = new Float64Array(sampleCount(0.2)).fill(0.5) // 纯直流
  const hp = highpass(x, 600)
  let mean = 0
  for (let i = 0; i < hp.length; i += 1) mean += hp[i]
  mean /= hp.length
  assert.ok(Math.abs(mean) < 0.02, `高通后直流应被压掉，实测均值 ${mean}`)
})

test('0A-DSP：pan(p=0) 左右能量相等（等功率中置）', () => {
  const rand = mulberry32(5)
  const x = new Float64Array(sampleCount(0.05)).map(() => gaussian(rand))
  const [l, r] = paneSplit(x, 0)
  assert.ok(Math.abs(rms(l) - rms(r)) < 1e-9, '中置时左右 RMS 应相等')
  // 等功率：单边 RMS = 原始 / √2
  assert.ok(Math.abs(rms(l) / rms(x) - Math.SQRT1_2) < 1e-9, '中置单边应为原信号的 1/√2')
})

test('0A-DSP：pan(p=−1) 全左（L=x, R=0）；pan(p=+1) 全右', () => {
  const rand = mulberry32(5)
  const x = new Float64Array(sampleCount(0.02)).map(() => gaussian(rand))
  const [lLeft, rLeft] = paneSplit(x, -1)
  assert.ok(peakOf(lLeft) > 0.1, 'p=−1 左声道应有信号')
  assert.equal(peakOf(rLeft), 0, 'p=−1 右声道必须为 0')
  const [lRight, rRight] = paneSplit(x, 1)
  assert.equal(peakOf(lRight), 0, 'p=+1 左声道必须为 0')
  assert.ok(peakOf(rRight) > 0.1, 'p=+1 右声道应有信号')
})

test('0A-DSP：pan 越界被夹紧（p=3 等价于 p=1）', () => {
  const x = new Float64Array([1, -1, 0.5])
  const [l3] = paneSplit(x, 3)
  assert.equal(peakOf(l3), 0, 'p=3 应夹到 +1（全右，左为 0）')
})

test('0A-DSP：normalizePeak 归一到目标峰值', () => {
  const x = new Float64Array([0.1, -0.05, 0.02])
  const n = normalizePeak(x, 0.5)
  assert.ok(Math.abs(peakOf(n) - 0.5) < 1e-9, `峰值应归一到 0.5，实测 ${peakOf(n)}`)
})

test('0A-DSP：全零信号归一不产生 NaN（除零保护）', () => {
  const n = normalizePeak(new Float64Array(10), 0.9)
  for (let i = 0; i < n.length; i += 1) assert.equal(n[i], 0)
})

// ───────────────── ③ 频谱特征：音色方向（最容易静默错的一层） ─────────────────

test('0A-DSP：★ thud 是低频（过零 < 1000/秒）—— 低通方向反了会立刻红', () => {
  const zcr = zeroCrossPerSec(renderVoice(voiceById('thud')))
  assert.ok(zcr < 1000, `thud 过零率 ${zcr.toFixed(0)}/秒，应为低频（600Hz 低通 + 90Hz）`)
})

test('0A-DSP：★ write 是高频（过零 > 8000/秒）—— 带通 2.5–8kHz', () => {
  const zcr = zeroCrossPerSec(renderVoice(voiceById('write')))
  assert.ok(zcr > 8000, `write 过零率 ${zcr.toFixed(0)}/秒，应为高频（2.5–8kHz 带通）`)
})

test('0A-DSP：★ whoosh 的 bright 参数真的生效 —— swipe(5000) > swoosh(4000) > card(2500)', () => {
  // 这条是「参数被忽略」的探针：如果 bright 没接进 fc，三支会几乎同值
  const zSwipe = zeroCrossPerSec(renderVoice(voiceById('swipe')))
  const zSwoosh = zeroCrossPerSec(renderVoice(voiceById('swoosh')))
  const zCard = zeroCrossPerSec(renderVoice(voiceById('card')))
  assert.ok(
    zSwipe > zSwoosh && zSwoosh > zCard,
    `bright 排序失效：swipe=${zSwipe.toFixed(0)} swoosh=${zSwoosh.toFixed(0)} card=${zCard.toFixed(0)}`,
  )
})

test('0A-DSP：★ 五支音效彼此不同（防止配方被写成同一支）', () => {
  const sigs = new Set()
  for (const voice of SFX_VOICES) {
    const x = renderVoice(voice)
    // 用「时长 + 前 200 样本峰值」做指纹，足够区分
    sigs.add(`${x.length}:${peakOf(x.subarray(0, 200)).toFixed(6)}`)
  }
  assert.equal(sigs.size, SFX_VOICES.length, '有音效配方产出了相同的指纹')
})

// ───────────────── ④ 配方与真值对齐 ─────────────────

test('0A：五支音效的时长与 GT 配方参数一致', () => {
  const expect = { thud: 0.15, write: 1.2, swoosh: 0.3, card: 0.3, swipe: 0.25 }
  for (const [id, seconds] of Object.entries(expect)) {
    const x = renderVoice(voiceById(id))
    assert.equal(x.length, sampleCount(seconds), `${id} 时长应为 ${seconds}s`)
  }
})

test('0A：voiceById 覆盖 7 条事件用到的全部 type', () => {
  // gt/mix-report.json 的 7 条事件只用到这 5 个 type
  for (const id of ['thud', 'write', 'swoosh', 'card', 'swipe']) {
    assert.ok(voiceById(id) !== undefined, `缺 ${id}`)
  }
  assert.equal(voiceById('pop'), undefined, '不存在的 type 应返回 undefined')
})

// ───────────────── ⑤ WAV 编码 ─────────────────

test('0A-WAV：头字段自洽（RIFF/WAVE, PCM, 48kHz, 2ch, 16bit）', () => {
  const mono = new Float64Array(480)
  const bytes = encodeWavStereo(mono, SFX_SAMPLE_RATE)
  const header = readWavHeader(bytes)
  assert.equal(header.sampleRate, 48000)
  assert.equal(header.channels, 2)
  assert.equal(header.bitsPerSample, 16)
  assert.equal(header.frames, 480)
  assert.equal(bytes.byteLength, 44 + 480 * 4, '总字节 = 头 44 + 帧数 × 2ch × 2byte')
})

test('0A-WAV：读回样本数 = 帧数，且 int16 往返误差 ≤ 1 LSB', () => {
  const input = [0, 0.5, -0.5, 1, -1]
  const bytes = encodeWavStereo(new Float64Array(input), SFX_SAMPLE_RATE)
  const view = new DataView(bytes.buffer)
  assert.equal(header_frames(bytes), 5)
  // 量化必然有误差：0.5 × 32767 = 16383.5，四舍五入到 16384 ⇒ 回读 0.500015…
  // 断言「≤ 1 LSB」而不是精确相等，否则是把量化误差当成缺陷。
  const lsb = 1 / 32767
  for (let i = 0; i < input.length; i += 1) {
    const got = view.getInt16(44 + i * 4, true) / 32767
    assert.ok(
      Math.abs(got - input[i]) <= lsb + 1e-12,
      `第 ${i} 个样本往返误差 ${Math.abs(got - input[i])} 超过 1 LSB（${input[i]} → ${got}）`,
    )
  }
  // 端点必须精确（clip 到 ±32767，回读正好 ±1）
  assert.equal(view.getInt16(44 + 3 * 4, true) / 32767, 1)
  assert.equal(view.getInt16(44 + 4 * 4, true) / 32767, -1)
})

function header_frames(bytes) {
  return readWavHeader(bytes).frames
}

test('0A-WAV：超范围样本被 clip（不溢出成反向尖峰）', () => {
  const bytes = encodeWavStereo(new Float64Array([2, -2]), SFX_SAMPLE_RATE)
  const view = new DataView(bytes.buffer)
  assert.equal(view.getInt16(44, true), 32767, '+2 应 clip 到 +32767')
  assert.equal(view.getInt16(48, true), -32767, '−2 应 clip 到 −32767')
})

test('0A：每支音效编码成 WAV 后仍能被自身头解析器读出正确帧数', () => {
  for (const voice of SFX_VOICES) {
    const mono = normalizePeak(renderVoice(voice), 0.89)
    const [l, r] = paneSplit(mono, 0)
    const header = readWavHeader(encodeWavStereo(l, SFX_SAMPLE_RATE, r))
    assert.equal(header.frames, mono.length, `${voice.id} 帧数不一致`)
    assert.equal(header.sampleRate, SFX_SAMPLE_RATE)
  }
})

// ───────────────── ⑥ 清单契约 ─────────────────

test('0A：URL 前缀与路由常量一致（改一处忘了另一处会 404）', () => {
  assert.equal(SFX_URL_PREFIX, '/canvas-studio/remotion/sfx')
})

test('0A：素材版本号是正整数（改配方必须 +1，否则 --check 判不出漂移）', () => {
  assert.ok(Number.isInteger(SFX_ASSET_VERSION) && SFX_ASSET_VERSION >= 1)
})
