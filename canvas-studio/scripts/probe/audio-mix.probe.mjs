#!/usr/bin/env node
/**
 * G1a 音频混音离线自验探针（S2a 之后、S2b 之前；audio-timeline-plan-20261028.md §6）。
 *
 * 跑真实合成全流程（composeStudioVideo + 内置 ffmpeg 6.0），断言：
 *   ① 成片音轨时长 == 视频时长（±0.15s）
 *   ② 逐秒 RMS 对齐（BGM 铺满全程，无「后半段突然静音」）
 *   ③ A/V 双流时长差 ≤1 帧（0.041s @25fps，`ffmpeg -i` 双流时长差）
 *
 * 场景分两部分（D-10 自决，处理计划内在顺序矛盾：「2 句旁白」是 S2b 才有的能力，
 * 但 G1a 卡在 S2b 之前）：
 * - **Part 1**（现在就跑，exit 0 才准进 S2b）：3 段含 1 段无声 + BGM（beat-120.wav，
 *   8s > 成片 6.02s，过时长守卫）→ amix 混音路径全链路。
 * - **Part 2**（S2b 落地后自动激活）：`voiceOverNodeIds` 双旁白不同起点 → 差分断言
 *   （同窗口有旁白 vs 无旁白能量抬升）。探测方式：`timelineFromComposeClips` 导出存在
 *   （S2b 的能力标记）。S6 之前必须全绿。
 *
 * 报告落 `build/probe/audio-mix.json`；退出码 0 = 全绿 / 1 = 有红 / 2 = 环境问题。
 */
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureAudioFixtures, ensureBeatFixtures, packageRoot } from '../fixtures/make-audio-fixtures.mjs'
import { audioRmsBySecond, parseFfmpegDuration, parseFfmpegStreams, runFfmpegCapture, videoDurationOf } from './lib/audio-probe.mjs'

const { composeStudioVideo } = await import(resolve(packageRoot, 'lib', 'compose.js'))
const { ProjectRegistry } = await import(resolve(packageRoot, 'lib', 'projects.js'))

const AUDIO_TOLERANCE_SEC = 0.15
const ONE_FRAME_SEC = 0.041 // 1 帧 @24fps≈0.042 / @25fps=0.04，取 0.041 为界
const SILENT_RMS_THRESHOLD = 0.02 // 「无死区」判静音阈值（BGM 铺底区合法低能量 ≈0.04，修复前该区是 0）

function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH.length > 0) return process.env.FFMPEG_PATH
  return join(packageRoot, '..', 'dsh-plugin-desktop', 'build', 'ffmpeg', 'darwin-arm64', 'ffmpeg')
}

async function fileExists(path) {
  const { access } = await import('node:fs/promises')
  try { await access(path); return true } catch { return false }
}

/**
 * 用真实文件跑一次 composeStudioVideo（带可选 BGM / 多旁白）。
 * 返回 { result, finalPath }；调用方清理 rootDir。
 */
async function composeScenario({ rootDir, ffmpegPath, fixturePaths, clipNames, bgmName, voiceOverNames = [], explicitStarts = [], extraOptions = {} }) {
  const registry = new ProjectRegistry(rootDir)
  const project = await registry.create('G1a 混音自验')
  const assetsDir = registry.assetsDir(project.id)
  await mkdir(assetsDir, { recursive: true })
  const allNames = [...clipNames, ...(bgmName ? [bgmName] : []), ...voiceOverNames]
  for (const name of allNames) await copyFile(fixturePaths[name], join(assetsDir, name))
  const nodes = allNames.map((name, index) => ({
    id: `node-${index}`,
    kind: 'video',
    url: `/canvas-studio/assets/${project.id}/${name}`,
    x: index * 300,
    y: 0,
    width: 320,
    height: 240,
    createdAt: 1000 + index,
    origin: 'agent',
    sourceIds: [],
  }))
  await registry.writeCanvas(project.id, nodes)
  const byId = new Map(allNames.map((name, index) => [`node-${index}`, name]))
  const bgmNodeId = bgmName ? nodes.find((n) => byId.get(n.id) === bgmName)?.id : undefined
  const voiceOverNodeIds = voiceOverNames.map((name, index) => {
    const nodeId = nodes.find((n) => byId.get(n.id) === name)?.id
    return explicitStarts[index] !== undefined ? { nodeId, startSec: explicitStarts[index] } : nodeId
  })
  const result = await composeStudioVideo(
    registry,
    project.id,
    nodes.filter((n) => clipNames.includes(byId.get(n.id))).map((n) => n.id),
    bgmNodeId,
    { ffmpegPath, ...extraOptions, ...(voiceOverNames.length > 0 ? { voiceOverNodeIds } : {}) },
  )
  return { result, finalPath: join(assetsDir, result.url.split('/').at(-1)) }
}

/** 成片双流测量：音轨时长（wav data 块）/ 视频流时长（-an -c copy 后 Duration）/ 逐 0.5s RMS。 */
async function measureFilm(file, ffmpegPath) {
  const rms = await audioRmsBySecond(file, { ffmpegPath, binSec: 0.5 })
  const videoSec = await videoDurationOf(file, ffmpegPath)
  return { audioSec: rms.durationSec, videoSec, rms }
}

async function main() {
  const ffmpegPath = resolveFfmpeg()
  if (!(await fileExists(ffmpegPath))) {
    console.error(`audio-mix.probe: 内置 ffmpeg 不存在：${ffmpegPath}（设 FFMPEG_PATH 覆盖）`)
    process.exit(2)
  }
  const reportDir = join(packageRoot, 'build', 'probe')
  await mkdir(reportDir, { recursive: true })
  const fixturePaths = { ...(await ensureAudioFixtures({ ffmpegPath })), ...(await ensureBeatFixtures({ ffmpegPath })) }
  const criteria = []
  const part2 = { supported: false, criteria: [] }

  // ── Part 1：3 段含 1 段无声 + BGM（S2a 能力，gate）───────────────────────
  const dirA = await mkdtemp(join(tmpdir(), 'cs-mix-a-'))
  try {
    const { result, finalPath } = await composeScenario({
      rootDir: dirA, ffmpegPath, fixturePaths,
      clipNames: ['t-audio2s.mp4', 't-silent2s.mp4', 't-audio2s.mp4'],
      bgmName: 'beat-120.wav',
    })
    const m = await measureFilm(finalPath, ffmpegPath)
    const avGap = Math.abs(m.audioSec - m.videoSec)
    criteria.push({
      id: 'P1-音轨时长对齐',
      pass: Math.abs(m.audioSec - m.videoSec) <= AUDIO_TOLERANCE_SEC,
      measured: { audioSec: Number(m.audioSec.toFixed(3)), videoSec: Number(m.videoSec.toFixed(3)), gapSec: Number((m.audioSec - m.videoSec).toFixed(3)) },
    })
    criteria.push({
      id: 'P1-双流时长差≤1帧',
      pass: avGap <= ONE_FRAME_SEC,
      measured: { avGapSec: Number(avGap.toFixed(3)), limitSec: ONE_FRAME_SEC },
    })
    criteria.push({
      id: 'P1-逐秒RMS无死区',
      // 修复前：amix duration=first 在 concat 音轨（4.09s）处截断 → 尾段全静音（bins≈0）。
      // 修复后：BGM 铺满全程，任何 0.5s bin 都不应是真静音（铺底区合法低能量 >0.02）。
      pass: m.rms.bins.length > 0 && m.rms.bins.every((v) => v > SILENT_RMS_THRESHOLD),
      measured: { bins05s: m.rms.bins.map((v) => Number(v.toFixed(4))) },
    })
    criteria.push({
      id: 'P1-逐段回显',
      // S2b 装配路径措辞：「片段 <id> 无原生音轨，该区间保持静音」（S2a 期为「已补静音」）。
      pass: (result.warnings ?? []).some((w) => w.includes('无原生音轨')),
      measured: { warnings: result.warnings ?? [] },
    })
  } finally {
    await rm(dirA, { recursive: true, force: true })
  }

  // ── Part 2：voiceOverNodeIds 双旁白（S2b 能力标记：timelineFromComposeClips）──
  const composeMod = await import(resolve(packageRoot, 'lib', 'compose.js'))
  if (typeof composeMod.timelineFromComposeClips === 'function') {
    part2.supported = true
    const withVo = await mkdtemp(join(tmpdir(), 'cs-mix-vo1-'))
    const withoutVo = await mkdtemp(join(tmpdir(), 'cs-mix-vo0-'))
    try {
      const scenario = {
        clipNames: ['t-audio2s.mp4', 't-silent2s.mp4', 't-audio2s.mp4'],
        bgmName: 'beat-90.wav',
        voiceOverNames: ['t-audio04s.mp4', 't-audio06s.mp4'],
      }
      const a = await composeScenario({ rootDir: withVo, ffmpegPath, fixturePaths, ...scenario, explicitStarts: [1.0, 4.0] })
      const b = await composeScenario({ rootDir: withoutVo, ffmpegPath, fixturePaths, clipNames: scenario.clipNames, bgmName: scenario.bgmName })
      const ma = await measureFilm(a.finalPath, ffmpegPath)
      const mb = await measureFilm(b.finalPath, ffmpegPath)
      // 旁白窗口（显式起点）：第 1 句 1.0–1.4s、第 2 句 4.0–4.6s。
      const windowBins = (m, from, to) => m.rms.bins.slice(Math.ceil(from / 0.5), Math.floor(to / 0.5))
      const mean = (xs) => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length)
      const w1a = mean(windowBins(ma, 1.0, 1.5)); const w1b = mean(windowBins(mb, 1.0, 1.5))
      const w2a = mean(windowBins(ma, 4.0, 4.5)); const w2b = mean(windowBins(mb, 4.0, 4.5))
      part2.criteria.push({
        id: 'P2-旁白窗口能量抬升',
        pass: w1a > w1b && w2a > w2b,
        measured: { w1With: Number(w1a.toFixed(4)), w1Without: Number(w1b.toFixed(4)), w2With: Number(w2a.toFixed(4)), w2Without: Number(w2b.toFixed(4)) },
      })
      const avGap = Math.abs(ma.audioSec - ma.videoSec)
      part2.criteria.push({
        id: 'P2-双流时长差≤1帧',
        pass: avGap <= ONE_FRAME_SEC,
        measured: { avGapSec: Number(avGap.toFixed(3)) },
      })
      criteria.push(...part2.criteria)
    } finally {
      await rm(withVo, { recursive: true, force: true })
      await rm(withoutVo, { recursive: true, force: true })
    }
  }

  const passed = criteria.every((c) => c.pass)
  const report = {
    generatedAt: new Date().toISOString(),
    ffmpeg: ffmpegPath,
    gate: 'G1a（audio-timeline-plan-20261028.md §6）',
    tolerance: { avSec: AUDIO_TOLERANCE_SEC, oneFrameSec: ONE_FRAME_SEC },
    part2,
    criteria,
    passed,
  }
  await writeFile(join(reportDir, 'audio-mix.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`audio-mix.probe：报告 → ${join(reportDir, 'audio-mix.json')}`)
  for (const criterion of criteria) {
    console.log(`  ${criterion.pass ? '✅' : '❌'} ${criterion.id}：${JSON.stringify(criterion.measured)}`)
  }
  if (!part2.supported) {
    console.log('  ⏭ Part 2（voiceOverNodeIds 双旁白）待 S2b 落地后自动激活（能力标记 timelineFromComposeClips 未导出）')
  }
  console.log(passed ? 'audio-mix.probe：G1a 全绿' : 'audio-mix.probe：G1a 有红 —— 先修 S2a，不得带未解释的 A/V 偏差进 S2b')
  process.exit(passed ? 0 : 1)
}

main().catch((cause) => {
  console.error(`audio-mix.probe: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}`)
  process.exit(2)
})
