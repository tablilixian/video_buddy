/**
 * 能力基准 #05 收口（2026-10-31）：词级时间戳推导纯函数单测。
 *
 * 合成包络直接构造（不需要真 mp3）：语音块 + 字间谷 + 逗号长停顿，
 * 校验切分边界、兜底路径（谷不够/谷太多/全静音）与确定性。
 * 直连 Host tsc 编译产物 `lib/remotion/word-timing.js`。
 * 定向跑：node --test tests/word-timing.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captionWordsByCharCount, countSpokenChars, trackWordWindows, wordTimingFromEnvelope } from '../lib/remotion/word-timing.js'

const FPS = 30

/** 合成一句包络：lead 静音 + n 个字块（energy，len 桶）+ 字间谷（gap 桶，valleyEnergy）+ tail 静音。 */
function phraseEnvelope({ chars, energy = 0.8, len = 30, gap = 6, valleyEnergy = 0.05, lead = 10, tail = 10 }) {
  const env = Array.from({ length: lead }, () => 0.01)
  for (let i = 0; i < chars; i += 1) {
    for (let k = 0; k < len; k += 1) env.push(energy)
    if (i < chars - 1) for (let k = 0; k < gap; k += 1) env.push(valleyEnergy)
  }
  for (let k = 0; k < tail; k += 1) env.push(0.01)
  return env
}

test('countSpokenChars：标点与空格不计（bench #05 的台词 = 14 口播字）', () => {
  assert.equal(countSpokenChars('凌晨三点，门外的脚步声忽然停了。'), 14)
  assert.equal(countSpokenChars('hello world!'), 10, '空格与标点都不算口播字符')
})

test('谷值清晰：切分边界落在字间谷上，窗口单调覆盖语音区', () => {
  const env = phraseEnvelope({ chars: 4, len: 30, gap: 6 })
  const w = wordTimingFromEnvelope({ envelope: env, fps: FPS, spokenChars: 4 })
  assert.equal(w.length, 4)
  for (let i = 1; i < 4; i += 1) {
    assert.ok(w[i].start >= w[i - 1].end - 0.01, `窗口 ${i} 起点不回退`)
  }
  // 起点应落在 lead 静音之后（语音区门槛 12%）
  assert.ok(w[0].start >= 8 * 0.3 - 0.01, '起点在语音区内（lead=10 桶）')
  // 每个字窗宽 ≈ 30+6=36 桶 = 1.2s = 36 帧（均匀字块下谷在中点）
  assert.ok(Math.abs(w[1].start - w[0].end) < 0.02, '相邻窗口无缝衔接')
  assert.ok(w[3].end > w[3].start, '末窗非空')
})

test('逗号长停顿：切分边界落在停顿区尾部（下一字起音点，等深取后）', () => {
  // 4 字短语 + 20 桶停顿 + 4 字短语（bench "凌晨三点，门外…" 的形态）
  const pauseLead = 4 * 30 + 3 * 6 + 10 // 第一短语末桶之后的停顿起点（桶序）
  const env = [...phraseEnvelope({ chars: 4, tail: 0 }), ...Array.from({ length: 20 }, () => 0.02), ...phraseEnvelope({ chars: 4, lead: 0 })]
  const w = wordTimingFromEnvelope({ envelope: env, fps: FPS, spokenChars: 8 })
  assert.equal(w.length, 8)
  // 边界应落在停顿区（±2 桶容差）—— 而不是停顿开头（否则下一字会在静音期提前高亮）
  const boundaryFrame = w[3].end
  const pauseStartFrame = pauseLead * 0.01 * FPS
  const pauseEndFrame = (pauseLead + 20) * 0.01 * FPS
  assert.ok(
    boundaryFrame >= pauseStartFrame - 0.6 && boundaryFrame <= pauseEndFrame + 0.6,
    `边界 ${boundaryFrame} 应落在停顿区 [${pauseStartFrame}, ${pauseEndFrame}] 内`,
  )
  assert.ok(Math.abs(w[4].start - boundaryFrame) < 0.01, '窗口连续（end == 下一字 start）')
})

test('谷不够（连续朗读无谷）⇒ 均匀内插兜底，窗口数仍精确', () => {
  const env = [0.01, ...Array.from({ length: 120 }, () => 0.8), 0.01]
  const w = wordTimingFromEnvelope({ envelope: env, fps: FPS, spokenChars: 6 })
  assert.equal(w.length, 6)
  const span = w[5].end - w[0].start
  const widths = w.map((x) => x.end - x.start)
  for (const width of widths) {
    assert.ok(Math.abs(width - span / 6) < 1.5, `均匀兜底下各窗宽接近 span/6（${width} vs ${span / 6}）`)
  }
})

test('谷多余 ⇒ 按谷深贪心挑，切点数精确 = 口播数 − 1', () => {
  // 每字块中间再挖一个浅谷（深度 0.3 < 0.35 阈值 ⇒ 是候选），字间深谷 0.05
  const env = [0.01]
  for (let i = 0; i < 4; i += 1) {
    for (let k = 0; k < 15; k += 1) env.push(0.8)
    for (let k = 0; k < 6; k += 1) env.push(0.3) // 字内浅谷
    for (let k = 0; k < 15; k += 1) env.push(0.8)
    if (i < 3) for (let k = 0; k < 6; k += 1) env.push(0.05) // 字间深谷
  }
  env.push(0.01)
  const w = wordTimingFromEnvelope({ envelope: env, fps: FPS, spokenChars: 4 })
  assert.equal(w.length, 4)
  // 深谷（字间）应优先于浅谷（字内）：第 1/2 字边界应在第一个深谷附近（≈ 桶 36 → 10.8 帧）
  const firstDeep = 36 * 0.01 * FPS
  assert.ok(Math.abs(w[0].end - firstDeep) < 2.5, `边界咬住深谷（${w[0].end} vs ${firstDeep}）`)
})

test('全静音包络 ⇒ 全程均匀兜底；口播数 0 ⇒ 空数组', () => {
  const zero = wordTimingFromEnvelope({ envelope: Array.from({ length: 90 }, () => 0), fps: FPS, spokenChars: 5 })
  assert.equal(zero.length, 5)
  assert.equal(wordTimingFromEnvelope({ envelope: [0.5, 0.4], fps: FPS, spokenChars: 0 }).length, 0)
})

test('确定性：同输入两次调用逐帧全等', () => {
  const env = phraseEnvelope({ chars: 5 })
  const a = wordTimingFromEnvelope({ envelope: env, fps: FPS, spokenChars: 5 })
  const b = wordTimingFromEnvelope({ envelope: env, fps: FPS, spokenChars: 5 })
  assert.deepEqual(a, b)
})

// ── CV-450：按真实时长 + 口播字数生成逐字窗口 ──────────────────────────────
// `caption.words` 显式声明没人填；能量谷要解码整段音频且中文词间无明显谷。
// caption 轨的 `durationInFrames` 来自 tts_narration 的 ffprobe 真值，等分即够用。

test('等分：条数 === 口播字数，首字从 startFrame 起、末字 to === startFrame+duration', () => {
  const spans = captionWordsByCharCount({ text: '太阳直射点', startFrame: 100, durationInFrames: 50 })
  assert.equal(spans.length, 5, '5 个口播字 ⇒ 5 条窗口')
  assert.equal(spans[0].from, 100)
  assert.equal(spans[spans.length - 1].to, 150)
  // 严格递增且首尾相接，不留空洞
  for (let i = 0; i < spans.length; i += 1) {
    assert.ok(spans[i].to > spans[i].from, `第 ${i} 个字必须有正时长`)
    if (i > 0) assert.equal(spans[i].from, spans[i - 1].to, '相邻窗口必须首尾相接')
  }
})

test('标点不计入口播字（与 Caption 的 spokenIndices 同源）', () => {
  const withPunct = captionWordsByCharCount({ text: '太阳，直射点。', startFrame: 0, durationInFrames: 60 })
  assert.equal(withPunct.length, 5)
  assert.deepEqual(withPunct.map((w) => w.text), ['太', '阳', '直', '射', '点'])
  assert.equal(countSpokenChars('太阳，直射点。'), 5)
})

test('等分误差不累积：中点字的起点落在区间中点附近（±1 帧）', () => {
  const spans = captionWordsByCharCount({ text: '一二三四五六七八九十', startFrame: 0, durationInFrames: 100 })
  const mid = spans[5]
  assert.ok(Math.abs(mid.from - 50) <= 1, `第 6 个字的起点应≈50，实得 ${mid.from}`)
})

test('帧数少于字数 ⇒ null（不硬压成零长度窗口）', () => {
  assert.equal(captionWordsByCharCount({ text: '一二三四五', startFrame: 0, durationInFrames: 3 }), null)
})

test('非法输入 ⇒ null（无口播字 / 时长非正 / NaN）', () => {
  assert.equal(captionWordsByCharCount({ text: '，。！', startFrame: 0, durationInFrames: 60 }), null)
  assert.equal(captionWordsByCharCount({ text: '太阳', startFrame: 0, durationInFrames: 0 }), null)
  assert.equal(captionWordsByCharCount({ text: '太阳', startFrame: 0, durationInFrames: -10 }), null)
  assert.equal(captionWordsByCharCount({ text: '太阳', startFrame: Number.NaN, durationInFrames: 60 }), null)
})

test('确定性：同输入两次调用逐字段全等', () => {
  const input = { text: '黄赤交角约为二十三度半', startFrame: 30, durationInFrames: 90 }
  assert.deepEqual(captionWordsByCharCount(input), captionWordsByCharCount(input))
})

// ── R-01（四季片复盘）：trackWordWindows —— 轨内相对帧口径的接线层 ─────────────
// `captionWordsByCharCount` 的原点由调用方决定（纯函数语义），而 Caption 组件在
// `<Sequence from={track.startFrame}>` 内拿的是轨内相对帧 ⇒ 接线层必须把等分原点钉在 0。
// 这里测的是「组件真实调用的那层」，不是裸等分 —— 反向变异（原点改回 track.startFrame）
// 必须让下面的相对口径断言变红。

test('trackWordWindows：等分原点恒 0（轨内相对帧），与 startFrame 无关', () => {
  const w = trackWordWindows({ text: '太阳直射点', startFrame: 144, durationInFrames: 150 })
  assert.equal(w.length, 5)
  assert.equal(w[0].start, 0, '首字从轨内相对帧 0 起（不是 144）')
  assert.equal(w[w.length - 1].end, 150, '末字 to === durationInFrames')
  assert.ok(w.every((x) => x.start < 144), `全部窗口落在轨内 [0, duration) —— 实得 ${JSON.stringify(w)}`)
})

test('trackWordWindows：startFrame=0 时与裸等分逐帧一致（老路径行为不变）', () => {
  const raw = captionWordsByCharCount({ text: '太阳直射点', startFrame: 0, durationInFrames: 150 })
  const w = trackWordWindows({ text: '太阳直射点', startFrame: 0, durationInFrames: 150 })
  assert.deepEqual(w, raw.map((x) => ({ start: x.from, end: x.to })))
})

test('trackWordWindows：显式 words 优先且原样采用（0-based 语义一致）', () => {
  const words = [
    { text: '太', from: 0, to: 30 },
    { text: '阳', from: 30, to: 60 },
  ]
  const w = trackWordWindows({ words, text: '太阳', startFrame: 144, durationInFrames: 60 })
  assert.deepEqual(w, [
    { start: 0, end: 30 },
    { start: 30, end: 60 },
  ])
})

test('trackWordWindows：words 长度与口播字数不符 ⇒ 落等分；都不成立 ⇒ null（退能量包络）', () => {
  // 2 个显式词 vs 5 个口播字 ⇒ 不匹配，走等分
  const mismatch = trackWordWindows({ words: [{ text: '太', from: 0, to: 30 }], text: '太阳直射点', startFrame: 10, durationInFrames: 150 })
  assert.equal(mismatch.length, 5)
  assert.equal(mismatch[0].start, 0)
  // 纯标点文本 + 无 words ⇒ null（组件据此开能量包络兜底）
  assert.equal(trackWordWindows({ text: '，。！', startFrame: 10, durationInFrames: 60 }), null)
})

// ── D-03（Q-A7）：audioFrames 真值等分 —— 高亮随语音收束，长窗口剩余静默不爬 ───

test('audioFrames 在场 ⇒ 按音频真值等分，末字 to === 音频帧数（V10 场景）', () => {
  // 四季片 V10：字幕窗口 246 帧（8.20s 凑片长），音频只有 106 帧（3.55s）
  const w = trackWordWindows({ text: '太阳直射点', startFrame: 0, durationInFrames: 246, audioDurationFrames: 106 })
  assert.equal(w.length, 5)
  assert.equal(w[w.length - 1].end, 106, '末字收在语音结束处（不是窗口尾 246）')
  assert.ok(w.every((x) => x.end <= 106.01), `全部窗口落在音频内 —— ${JSON.stringify(w.map((x) => x.end))}`)
})

test('audioFrames 缺省 / 非法 ⇒ 退回字幕窗口（老 manifest 逐帧不变）', () => {
  const plain = captionWordsByCharCount({ text: '太阳直射点', startFrame: 0, durationInFrames: 150 })
  for (const bad of [undefined, 0, -5, Number.NaN]) {
    const w = captionWordsByCharCount({ text: '太阳直射点', startFrame: 0, durationInFrames: 150, audioDurationFrames: bad })
    assert.deepEqual(w, plain, `audioFrames=${String(bad)} 必须与缺省行为逐帧一致`)
  }
})

test('audioFrames 少于口播字数 ⇒ null（交回兜底，不硬压成零长窗口）', () => {
  assert.equal(
    captionWordsByCharCount({ text: '一二三四五', startFrame: 0, durationInFrames: 300, audioDurationFrames: 3 }),
    null,
  )
})
