#!/usr/bin/env node
/**
 * G2 节拍自验探针（S5 之后；audio-timeline-plan-20261028.md §6）。
 *
 * 用 make-audio-fixtures.mjs 生成的**已知 BPM 合成鼓点曲**（120 / 90 / 140 三档）跑
 * 真实 ffmpeg 全链路（analyzeBeatsFromFile），机器判定：
 *   ① 估测 BPM 误差 ≤2（三档全过）
 *   ② 拍点对齐 ≤0.1s（≥90% 网格拍点落在真值拍位 ±0.1s）
 *   ③ click 曲 confidence ≥0.5（可用卡点）
 * 不达标按 D-05 降级并在报告里记录实际精度。
 *
 * 报告落 build/probe/beat.json；退出码 0 = 全绿 / 1 = 超标（降级记录）/ 2 = 环境问题。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureBeatFixtures, packageRoot } from '../fixtures/make-audio-fixtures.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const { analyzeBeatsFromFile } = await import(join(packageRoot, 'lib', 'beat-analyze.js'))

const BPM_TARGETS = [120, 90, 140]
const BPM_TOLERANCE = 2
const BEAT_TOLERANCE_SEC = 0.1
const BEAT_ALIGN_RATIO = 0.9

function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH.length > 0) return process.env.FFMPEG_PATH
  return join(packageRoot, '..', 'dsh-plugin-desktop', 'build', 'ffmpeg', 'darwin-arm64', 'ffmpeg')
}

async function main() {
  const ffmpegPath = resolveFfmpeg()
  const reportDir = join(packageRoot, 'build', 'probe')
  await mkdir(reportDir, { recursive: true })
  const fixtures = await ensureBeatFixtures({ ffmpegPath })
  const results = []
  let allPass = true
  for (const bpm of BPM_TARGETS) {
    const file = fixtures[`beat-${bpm}.wav`]
    if (file === undefined) {
      console.error(`beat.probe: 缺 fixture beat-${bpm}.wav`)
      process.exit(2)
    }
    const analysis = await analyzeBeatsFromFile(ffmpegPath, file)
    const bpmError = Math.abs(analysis.bpm - bpm)
    const interval = 60 / bpm
    const aligned = analysis.beats.filter((beat) => Math.abs(beat - Math.round(beat / interval) * interval) <= BEAT_TOLERANCE_SEC)
    const alignRatio = analysis.beats.length > 0 ? aligned.length / analysis.beats.length : 0
    const pass = bpmError <= BPM_TOLERANCE && alignRatio >= BEAT_ALIGN_RATIO && analysis.confidence >= 0.5
    if (!pass) allPass = false
    results.push({
      bpm,
      measuredBpm: analysis.bpm,
      bpmError: Math.round(bpmError * 10) / 10,
      beatCount: analysis.beats.length,
      alignRatio: Math.round(alignRatio * 100) / 100,
      confidence: analysis.confidence,
      lufs: analysis.lufs ?? null,
      notes: analysis.notes,
      pass,
    })
    console.log(`  ${pass ? '✅' : '❌'} ${bpm} BPM：实测 ${analysis.bpm}（误差 ${bpmError.toFixed(1)}），对齐率 ${Math.round(alignRatio * 100)}%，confidence ${analysis.confidence}`)
  }
  const report = {
    generatedAt: new Date().toISOString(),
    gate: 'G2（audio-timeline-plan-20261028.md §6）',
    tolerance: { bpm: BPM_TOLERANCE, beatSec: BEAT_TOLERANCE_SEC, alignRatio: BEAT_ALIGN_RATIO },
    results,
    passed: allPass,
  }
  await writeFile(join(reportDir, 'beat.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`beat.probe：报告 → ${join(reportDir, 'beat.json')}`)
  console.log(allPass
    ? 'beat.probe：G2 全绿（已知 BPM 三档误差 ≤2、拍点对齐 ≤0.1s）'
    : 'beat.probe：G2 超标 —— 按 D-05 降级：卡点路径默认关闭，beats 仅作参考信息（实际精度已记录在报告）')
  process.exit(allPass ? 0 : 1)
}

main().catch((cause) => {
  console.error(`beat.probe: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}`)
  process.exit(2)
})
