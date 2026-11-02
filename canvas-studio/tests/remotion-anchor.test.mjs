/**
 * C4 相对锚定测试（REQ-036，CV-400）—— resolveAnchor 全分支 + manifest 校验集成 +
 * 组合期解析 + **双版 manifest 断言**（同一 anchor 结构 + 两套不同字数文案，事件均落词窗口 ±2 帧）。
 *
 * 词级 timing 显式 words 路径走 node 全链路（与浏览器组合期同一条 applyAnchorResolution
 * 管线）；能量谷路径用合成包络单测（wordTimingFromEnvelope 确定性已由 word-timing 测试钉住）。
 * 真 TTS 双版渲染的 bench 探针 = 真机验收项（两条 TTS 资产要真机自产，见 tracking CV-400）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  anchorRefsOf,
  applyAnchorResolution,
  collectAnchorIssues,
  envelopeWordWindows,
  explicitWordWindows,
  groupWordsByPhrase,
  resolveAnchor,
  spokenCharsPerPhrase,
} from '../lib/remotion/anchor.js'
import { validateManifest } from '../lib/remotion/manifest.js'

// ───────────────── 纯函数：分句与词窗口 ─────────────────

test('C4：groupWordsByPhrase 按句末标点分组（标点不占词窗）', () => {
  const text = '价格离谱。真的假的？'
  // 8 个口播字：价格离谱（4）+ 真的假的（4）
  const windows = [
    { start: 0, end: 10 }, { start: 10, end: 20 }, { start: 20, end: 30 }, { start: 30, end: 40 },
    { start: 50, end: 60 }, { start: 60, end: 70 }, { start: 70, end: 80 }, { start: 80, end: 90 },
  ]
  const phrases = groupWordsByPhrase(text, windows)
  assert.equal(phrases.length, 2)
  assert.equal(phrases[0].words.length, 4)
  assert.equal(phrases[1].words.length, 4)
  assert.deepEqual(spokenCharsPerPhrase(text), [4, 4])
})

test('C4：spokenCharsPerPhrase 无句末标点 = 整段一句', () => {
  assert.deepEqual(spokenCharsPerPhrase('没有句末标点的整句'), [9])
  assert.deepEqual(spokenCharsPerPhrase('第一句。'), [3])
})

test('C4：explicitWordWindows 轨内相对帧 → 绝对帧；长度不符回退 null', () => {
  const words = [{ from: 5, to: 15 }, { from: 15, to: 30 }]
  const absolute = explicitWordWindows(words, '你好', 90)
  assert.deepEqual(absolute, [{ start: 95, end: 105 }, { start: 105, end: 120 }])
  assert.equal(explicitWordWindows([{ from: 0, to: 10 }], '你好', 0), null, '1 词 vs 2 口播字 → null（同 Caption 回退口径）')
})

test('C4：envelopeWordWindows 合成包络 → 逐字窗口（绝对帧）', () => {
  // 30 桶 = 300ms @10ms；三段语音（每段 6 桶）+ 两段静音（每段 6 桶）
  const envelope = []
  for (let seg = 0; seg < 3; seg += 1) {
    for (let i = 0; i < 6; i += 1) envelope.push(0.8)
    for (let i = 0; i < 6; i += 1) envelope.push(0.01)
  }
  const windows = envelopeWordWindows(envelope, '一二三', 30, 60)
  assert.ok(windows !== null)
  assert.equal(windows.length, 3)
  // 语音区从桶 0 起；窗口递增且全部 +60（trackStart）
  assert.ok(windows[0].start >= 60, `首窗应 ≥60，实得 ${windows[0].start}`)
  assert.ok(windows[2].end > windows[0].end, '窗口单调推进')
})

// ───────────────── 纯函数：resolveAnchor 全分支 ─────────────────

const PHRASES = [
  { words: [{ start: 100, end: 110 }, { start: 110, end: 125 }, { start: 125, end: 140 }] },
  { words: [{ start: 200, end: 230 }] },
]

test('C4：resolveAnchor start/end × 整句/单词 × 正负 offset', () => {
  // 形态二（句级）：from=end + offset 3
  assert.equal(resolveAnchor({ ref: 'cap-1', phrase: 1, from: 'end', offsetFrames: 3 }, PHRASES), 233)
  // 形态一（词级）：word=2 → 窗口 [125,140)，from 缺省 start
  assert.equal(resolveAnchor({ ref: 'cap-1', phrase: 0, word: 2 }, PHRASES), 125)
  // word + from=end + 负 offset
  assert.equal(resolveAnchor({ ref: 'cap-1', phrase: 0, word: 0, from: 'end', offsetFrames: -5 }, PHRASES), 105)
  // 整句窗口 = 首词 start → 末词 end
  assert.equal(resolveAnchor({ ref: 'cap-1', phrase: 0 }, PHRASES), 100)
})

test('C4：resolveAnchor 越界 fail-fast（错误含 ref 与索引）', () => {
  assert.throws(() => resolveAnchor({ ref: 'cap-1', phrase: 5 }, PHRASES), /cap-1.*5 句|共 2 句/)
  assert.throws(() => resolveAnchor({ ref: 'cap-1', phrase: 0, word: 9 }, PHRASES), /cap-1.*word=9/)
})

// ───────────────── manifest 校验（validateManifest 集成）─────────────────

const BASE_TRACKS = [
  {
    id: 'cap-1', type: 'caption', src: '/assets/a.mp3', text: '价格离谱。真的假的？',
    startFrame: 90, durationInFrames: 120,
  },
  {
    id: 'card', type: 'textCard', variant: 'title', text: '跳卡',
    startFrame: 210, durationInFrames: 60,
    animate: [{ from: { opacity: 0 }, to: { opacity: 1 }, anchor: { ref: 'cap-1', phrase: 1, word: 2 } }],
  },
]

function manifestWith(tracks) {
  return {
    id: 'm1',
    meta: { title: 't', width: 1280, height: 720, fps: 30, durationInFrames: 300 },
    tracks,
  }
}

test('C4：validateManifest 合法锚通过，anchor 不再被报契约外字段', () => {
  const result = validateManifest(manifestWith(BASE_TRACKS))
  const anchorErrors = result.errors.filter((e) => e.includes('anchor'))
  assert.deepEqual(anchorErrors, [], `合法锚不应报错：${JSON.stringify(anchorErrors)}`)
  assert.ok(!result.warnings.some((w) => w.includes('契约外字段 "anchor"')), 'anchor 是契约内字段')
})

test('C4：validateManifest 锚与 startFrame 互斥 / ref 不存在 / 被锚轨无 src / 越界 全部硬失败', () => {
  // 互斥
  const mutex = structuredClone(BASE_TRACKS)
  mutex[1].animate[0].startFrame = 30
  const r1 = validateManifest(manifestWith(mutex))
  assert.ok(r1.errors.some((e) => e.includes('不能同时给 startFrame 与 anchor') && e.includes('card')), JSON.stringify(r1.errors))
  // ref 不存在
  const missing = structuredClone(BASE_TRACKS)
  missing[1].animate[0].anchor.ref = 'cap-none'
  const r2 = validateManifest(manifestWith(missing))
  assert.ok(r2.errors.some((e) => e.includes('cap-none') && e.includes('不是本 manifest 里的 caption 轨')))
  // 被锚轨无 src
  const noSrc = structuredClone(BASE_TRACKS)
  delete noSrc[0].src
  const r3 = validateManifest(manifestWith(noSrc))
  assert.ok(r3.errors.some((e) => e.includes('没有 src 旁白')))
  // phrase 越界
  const badPhrase = structuredClone(BASE_TRACKS)
  badPhrase[1].animate[0].anchor.phrase = 9
  const r4 = validateManifest(manifestWith(badPhrase))
  assert.ok(r4.errors.some((e) => e.includes('共 2 句') && e.includes('phrase=9')))
  // word 越界（phrase1 = 真的假的，4 个口播字，word=9 不存在）
  const badWord = structuredClone(BASE_TRACKS)
  badWord[1].animate[0].anchor = { ref: 'cap-1', phrase: 1, word: 9 }
  const r5 = validateManifest(manifestWith(badWord))
  assert.ok(r5.errors.some((e) => e.includes('共 4 个口播字') && e.includes('word=9')))
})

test('C4：collectAnchorIssues 与 validateManifest 同一份实现（直接调用口径一致）', () => {
  assert.deepEqual(collectAnchorIssues(BASE_TRACKS), [])
  assert.equal(collectAnchorIssues([{ id: 'x', animate: [{ from: {}, to: {}, anchor: { ref: 'nope', phrase: 0 } }] }]).length, 1)
  assert.deepEqual(anchorRefsOf(BASE_TRACKS), ['cap-1'])
})

// ───────────────── 组合期解析：applyAnchorResolution ─────────────────

test('C4：applyAnchorResolution 锚 → 绝对帧 − 轨道起点（anchor 字段删除）', () => {
  const timings = new Map([
    // cap-1 从 90 帧起：phrase1 word2 = 相对 95+2 → 绝对 ~137（显式 words 见下）
    ['cap-1', groupWordsByPhrase('价格离谱。真的假的？', explicitWordWindows(
      [
        { from: 0, to: 5 }, { from: 5, to: 10 }, { from: 10, to: 15 }, { from: 15, to: 20 },
        { from: 30, to: 35 }, { from: 35, to: 40 }, { from: 40, to: 45 }, { from: 45, to: 50 },
      ],
      '价格离谱。真的假的？', 90,
    ))],
  ])
  const { tracks, errors } = applyAnchorResolution(manifestWith(BASE_TRACKS), timings)
  assert.deepEqual(errors, [])
  const card = tracks[1]
  assert.equal(card.animate.length, 1)
  assert.equal(card.animate[0].anchor, undefined, '解析后 anchor 字段删除（渲染器只认数字 startFrame）')
  // phrase1 word2 = 「假」：显式窗口 [40,45)+90 → 绝对 [130,135)；startFrame = 130 − 210 = -80
  assert.equal(card.animate[0].startFrame, 130 - 210)
})

test('C4：applyAnchorResolution 无锚 manifest 原样返回（逐像素同路）', () => {
  const manifest = manifestWith([
    { id: 'a', type: 'shape', shape: 'rect', color: '#fff', startFrame: 0, durationInFrames: 30 },
  ])
  const { tracks, errors } = applyAnchorResolution(manifest, new Map())
  assert.deepEqual(errors, [])
  assert.equal(tracks[0], manifest.tracks[0], '无锚轨道保持原对象引用（零拷贝）')
})

// ───────────────── 双版 manifest 断言（REQ §4.4 验收的 node 层等价）─────────────────

test('C4 E2E：双版 manifest —— 同一 anchor 结构 + 两套不同字数文案，事件均落对应词窗口 ±2 帧内', () => {
  // 版本 A：5 字口播（anchor 挂 phrase0 word2 = 「就」）
  const textA = '现在就买它'
  const wordsA = [
    { text: '现', from: 0, to: 30 }, { text: '在', from: 30, to: 60 }, { text: '就', from: 60, to: 90 },
    { text: '买', from: 90, to: 120 }, { text: '它', from: 120, to: 150 },
  ]
  // 版本 B：11 字口播（同一 anchor 结构：phrase0 word2 = 「们」）—— 词数变化 → 能量谷
  // 重排，绝对帧字段必然漂移；锚定字段必须自动跟到新窗口。
  const textB = '家人们现在真的直接买它'
  const wordsB = [
    { text: '家', from: 0, to: 30 }, { text: '人', from: 30, to: 55 }, { text: '们', from: 55, to: 80 },
    { text: '现', from: 80, to: 110 }, { text: '在', from: 110, to: 135 }, { text: '真', from: 135, to: 160 },
    { text: '的', from: 160, to: 190 }, { text: '直', from: 190, to: 215 }, { text: '接', from: 215, to: 240 },
    { text: '买', from: 240, to: 270 }, { text: '它', from: 270, to: 300 },
  ]
  const build = (text, words) => manifestWith([
    { id: 'cap-1', type: 'caption', src: '/assets/narration.mp3', text, startFrame: 0, durationInFrames: 360, words },
    {
      id: 'cta', type: 'textCard', variant: 'title', text: '限时特价',
      startFrame: 0, durationInFrames: 360,
      animate: [{ from: { opacity: 0, y: 10 }, to: { opacity: 1, y: 0 }, anchor: { ref: 'cap-1', phrase: 0, word: 2 } }],
    },
  ])
  for (const [text, words] of [[textA, wordsA], [textB, wordsB]]) {
    const manifest = build(text, words)
    assert.deepEqual(validateManifest(manifest).errors, [], `${text} 版结构合法`)
    const timings = new Map([['cap-1', groupWordsByPhrase(text, explicitWordWindows(words, text, 0))]])
    const { tracks, errors } = applyAnchorResolution(manifest, timings)
    assert.deepEqual(errors, [])
    const resolvedStart = tracks[1].animate[0].startFrame
    const window = words[2] // word=2 的词窗口（显式帧，track 从 0 起 → 绝对 = 相对）
    assert.ok(
      resolvedStart >= window.from - 2 && resolvedStart <= window.from + 2,
      `「${text}」版事件应落在 word2 起点 ±2 帧内（期望 ≈${window.from}，实得 ${resolvedStart}）`,
    )
  }
})
