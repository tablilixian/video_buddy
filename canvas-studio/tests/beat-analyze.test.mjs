/**
 * S5（2026-10-28 · CV-040 收口）：节拍分析纯函数测试。
 *
 * estimateBpm 用**合成包络**（确定性 click 包络）验证 120/90/140 三档（与 G2 真机
 * 探针 scripts/probe/beat.probe.mjs 的真实 ffmpeg 数据互补）；吸附/歌词对齐全分支。
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resampleEnvelope,
  estimateBpm,
  analyzeEnvelope,
  snapCutsToBeats,
  heuristicLyrics,
  parseEnvelopeStdout,
  parseLufs,
  parseSilenceRanges,
} from '../lib/beat-analyze.js'

/** 合成 click 包络：拍间隔 interval，click 宽 40ms、幅度高台 + 本底噪声。 */
function clickEnvelope(bpm, seconds, gridSec = 0.05) {
  const interval = 60 / bpm
  const clicks = Math.floor(seconds / interval) + 1
  const points = []
  for (let t = 0; t < seconds; t += gridSec) {
    // 到最近拍点的距离（显式枚举拍点 —— 浮点 t % interval 会让 click 漂移到错误的周期上）。
    let dist = Infinity
    for (let k = 0; k <= clicks; k += 1) {
      const d = Math.abs(t - k * interval)
      if (d < dist) dist = d
    }
    const db = dist < 0.04 ? -6 : -40 + Math.sin(t * 2.1) * 2
    points.push({ t: Math.round(t * 1000) / 1000, db })
  }
  return points
}

test('estimateBpm：合成 click 包络 120/90/140 三档，误差 ≤2（G2 同口径的纯函数面）', () => {
  for (const bpm of [120, 90, 140]) {
    const points = clickEnvelope(bpm, 8)
    const result = estimateBpm(resampleEnvelope(points))
    assert.ok(Math.abs(result.bpm - bpm) <= 2, `${bpm} BPM 应估出 ±2 内，实得 ${result.bpm}`)
    assert.ok(result.confidence >= 0.5, `click 曲置信度应达标，实得 ${result.confidence}`)
    assert.ok(result.beats.length >= Math.floor(8 * bpm / 60) - 2, `拍点数应接近 ${8 * bpm / 60}，实得 ${result.beats.length}`)
    // 拍点对齐 ≤0.1s：网格拍点应落在真实拍位（k·interval）±0.1s 内。
    const interval = 60 / bpm
    const aligned = result.beats.filter((beat) => {
      const nearest = Math.round(beat / interval) * interval
      return Math.abs(beat - nearest) <= 0.1
    })
    assert.ok(aligned.length / result.beats.length >= 0.9, `≥90% 拍点应对齐真值，实得 ${aligned.length}/${result.beats.length}`)
  }
})

test('estimateBpm：氛围噪声（无节拍）→ 置信度低或 0 拍（D-05 的入口）', () => {
  const points = []
  for (let t = 0; t < 8; t += 0.02) {
    // 无周期结构的确定性伪随机起伏（自相似正弦会对「峰占比」虚高，已废）。
    points.push({ t, db: -30 + (((t * 100) % 13) - 6) * 1.8 })
  }
  const result = estimateBpm(resampleEnvelope(points))
  assert.ok(result.confidence < 0.8, `噪声置信度应明显低于 click，实得 ${result.confidence}`)
})

test('analyzeEnvelope：空/过短包络 → 0 拍 + note 说明（不抛错）', () => {
  const result = analyzeEnvelope([])
  assert.equal(result.bpm, 0)
  assert.equal(result.beats.length, 0)
  assert.ok(result.notes.some((n) => n.includes('未能')), '应诚实说明未出结果')
  const short = analyzeEnvelope([{ t: 0, db: -20 }, { t: 0.1, db: -20 }])
  assert.equal(short.bpm, 0)
})

test('snapCutsToBeats：容差内吸附（±0.5 拍）、超差保持 + 告警、总漂移回显', () => {
  const beats = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0]
  // 120 BPM（拍长 0.5s）：切点 1.48 → 吸到 1.5（偏 0.02）；切点 2.21 → 吸到 2.0？2.21 距 2.0=0.21、距 2.5=0.29 → 吸 2.0（偏 -0.21，容差 0.25 内）。
  const result = snapCutsToBeats([1.48, 2.21], beats, 120, 0.5)
  assert.equal(result.cuts[0].snapped, 1.5)
  assert.ok(Math.abs(result.cuts[0].deltaSec - 0.02) < 1e-9)
  assert.equal(result.snappedCount, 2)
  assert.ok(result.totalDriftSec > 0, '总漂移应回显')
  // 超差：切点 2.6 距最近拍 0.1？2.6-2.5=0.1 ≤0.25 会吸——构造真正超差的：拍距 0.5、容差 0.1 拍=0.05s。
  const strict = snapCutsToBeats([1.48], beats, 120, 0.03)
  assert.equal(strict.cuts[0].snapped, undefined, '容差 0.015s 时 1.48（距最近拍 0.02s）不吸附')
  assert.ok(strict.warnings.some((w) => w.includes('未吸附')), '应告警')
  // 无节拍数据。
  const empty = snapCutsToBeats([1.0], [], 120)
  assert.equal(empty.snappedCount, 0)
  assert.ok(empty.warnings.some((w) => w.includes('无有效节拍数据')))
})

test('heuristicLyrics：静音区间够用按区间对齐；不够按字数比例；全部标 estimated', () => {
  // 8s 曲、3 句：静音中点在 2.5 / 5.0 → 边界 [0, 2.5, 5.0, 8]。
  const silences = [{ start: 2.4, end: 2.6 }, { start: 4.9, end: 5.1 }]
  const rows = heuristicLyrics(['第一句', '第二句', '第三句'], silences, 8)
  assert.equal(rows.length, 3)
  assert.deepEqual(rows.map((r) => r.source), ['estimated', 'estimated', 'estimated'], '启发式必须标 estimated')
  assert.ok(Math.abs(rows[1].startSec - 2.5) < 0.01, '第二句从第一个静音中点起')
  assert.ok(rows[0].endSec <= rows[1].startSec + 1e-9, '行间不重叠')
  // 静音不够 → 字数比例。
  const fallback = heuristicLyrics(['短', '这是一句比较长的歌词'], [], 10)
  assert.equal(fallback.length, 2)
  assert.ok(fallback[1].endSec - fallback[1].startSec > fallback[0].endSec - fallback[0].startSec, '字多的行占时长更长')
  assert.ok(fallback.every((r) => r.source === 'estimated'))
  // 空入参。
  assert.deepEqual(heuristicLyrics([], silences, 8), [])
})

test('parseEnvelopeStdout / parseLufs / parseSilenceRanges：ffmpeg 输出解析', () => {
  const stdout = [
    'frame:0    pts:0       pts_time:0',
    'lavfi.astats.Overall.RMS_level=-25.3',
    'frame:1    pts:480     pts_time:0.023',
    'lavfi.astats.Overall.RMS_level=-inf',
  ].join('\n')
  const points = parseEnvelopeStdout(stdout)
  assert.deepEqual(points, [{ t: 0, db: -25.3 }, { t: 0.023, db: -120 }], '-inf 静音归 -120 哨兵')
  const stderr = [
    '[Parsed_ebur128_0 @ 0x0] Summary:',
    '  Integrated loudness:',
    '    I:         -14.5 LUFS',
    '    Threshold: -24.6 LUFS',
  ].join('\n')
  assert.equal(parseLufs(stderr), -14.5)
  assert.equal(parseLufs('no summary'), undefined)
  const silenceStderr = ['[silencedetect @ 0x0] silence_start: 2.41', '[silencedetect @ 0x0] silence_end: 2.6 | silence_duration: 0.19'].join('\n')
  assert.deepEqual(parseSilenceRanges(silenceStderr), [{ start: 2.41, end: 2.6 }])
})
