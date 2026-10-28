#!/usr/bin/env node
/**
 * CV-040 基线取证探针（S0 · 2026-10-28）。
 *
 * 把 audio-timeline-plan-20261028.md §1.4 的三组手工实测固化成可重跑断言：
 * 跑**现有** `src/compose.ts` 实现（composeStudioVideo，从 lib/** 导入——先 build 再探，
 * 避免测旧码）对真实 ffmpeg 的行为，3 条判据实测值落 `build/probe/audio-baseline.json`。
 *
 * 判据（全部是「修复后应绿」的行为断言；当前实现下应全红 → exit 1）：
 *   ① 3 段含 1 段无声 → 成片音轨时长 == 视频时长（±0.15s；实测 4.09 vs 6.02 → 红）
 *   ② 无声段区间 [2s,4s) 静音、相邻区间有声（逐 0.5s RMS；实测该区间有声（错位）→ 红）
 *   ③ 16k 单声道 / 48k 立体声混拼 → 成片音轨时长 == 视频时长（±0.15s；实测 6.29 vs 6.02 → 红）
 *
 * 退出码：全部判据绿 = 0（修复完成）；任一红 = 1（基线仍断裂）。
 * 本探针是 S2a / S2b / G1a 的**验收尺子**：探针在 test:smoke 门禁之外运行，
 * 故意红的判据不许写进 tests/*.test.mjs（run-smoke 名单外新增红会让门禁退 1）。
 */
import { access, copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureAudioFixtures, packageRoot } from '../fixtures/make-audio-fixtures.mjs'
import { audioRmsBySecond, parseFfmpegStreams, runFfmpegCapture, videoDurationOf } from './lib/audio-probe.mjs'

const here = dirname(fileURLToPath(import.meta.url))

/** 产品实现（lib 构建产物）。S0 不改 src/，探针照常可 import；修复后同一探针复用。 */
const { composeStudioVideo } = await import(resolve(packageRoot, 'lib', 'compose.js'))
const { ProjectRegistry } = await import(resolve(packageRoot, 'lib', 'projects.js'))

const AUDIO_TOLERANCE_SEC = 0.15
const SILENT_RMS_THRESHOLD = 0.02
const SOUND_RMS_THRESHOLD = 0.05

function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH.length > 0) return process.env.FFMPEG_PATH
  return join(packageRoot, '..', 'dsh-plugin-desktop', 'build', 'ffmpeg', 'darwin-arm64', 'ffmpeg')
}

async function fileExists(path) {
  try { await access(path); return true } catch { return false }
}

/**
 * 在临时 registry 里用真实文件跑一次 composeStudioVideo。
 * 返回 { result, finalPath, assetsDir }；调用方负责清理 rootDir。
 */
async function composeWithRegistry({ rootDir, ffmpegPath, fixturePaths, clipNames }) {
  const registry = new ProjectRegistry(rootDir)
  const project = await registry.create('基线取证')
  const assetsDir = registry.assetsDir(project.id)
  await mkdir(assetsDir, { recursive: true })
  for (const name of clipNames) {
    await copyFile(fixturePaths[name], join(assetsDir, name))
  }
  const nodes = clipNames.map((name, index) => ({
    id: `clip-${index}`,
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
  const result = await composeStudioVideo(
    registry,
    project.id,
    nodes.map((node) => node.id),
    undefined,
    { ffmpegPath },
  )
  const finalPath = join(assetsDir, result.url.split('/').at(-1))
  return { result, finalPath, assetsDir }
}

async function measureFilm(file, ffmpegPath) {
  const probe = await runFfmpegCapture(ffmpegPath, ['-i', file])
  if (process.env.CS_PROBE_KEEP) {
    const keep = `/tmp/csdbg/keep-${Date.now()}.mp4`
    await copyFile(file, keep)
    console.error(`measureFilm: 保留成片副本 → ${keep}`)
  }
  const streams = parseFfmpegStreams(probe.stderr)
  const filmVideoSec = await videoDurationOf(file, ffmpegPath)
  if (!streams.hasAudio) {
    return { hasAudioStream: false, filmAudioSec: 0, filmVideoSec, rms: { binSec: 0.5, bins: [] } }
  }
  const rms = await audioRmsBySecond(file, { ffmpegPath, binSec: 0.5 })
  return {
    hasAudioStream: true,
    filmAudioSec: rms.durationSec,
    filmVideoSec,
    ...(rms.decodePartial === true ? { decodePartial: true } : {}),
    rms,
  }
}

async function main() {
  const ffmpegPath = resolveFfmpeg()
  if (!(await fileExists(ffmpegPath))) {
    console.error(`audio-baseline.probe: 内置 ffmpeg 不存在：${ffmpegPath}（设 FFMPEG_PATH 覆盖）`)
    process.exit(2)
  }
  const reportDir = join(packageRoot, 'build', 'probe')
  await mkdir(reportDir, { recursive: true })
  const fixturePaths = await ensureAudioFixtures({ ffmpegPath })

  // ── 案例 A：3 段含 1 段无声（§1.4 实验 A 的最小复刻）──────────────────────
  const dirA = await mkdtemp(join(tmpdir(), 'cs-baseline-a-'))
  const caseA = {}
  try {
    const { result, finalPath } = await composeWithRegistry({
      rootDir: dirA, ffmpegPath, fixturePaths,
      clipNames: ['t-audio2s.mp4', 't-silent2s.mp4', 't-audio2s.mp4'],
    })
    const m = await measureFilm(finalPath, ffmpegPath)
    caseA.compose = {
      duration: result.duration,
      audioComposition: result.audioComposition,
      warnings: result.warnings ?? [],
    }
    caseA.measured = {
      filmAudioSec: Number(m.filmAudioSec.toFixed(3)),
      filmVideoSec: Number(m.filmVideoSec.toFixed(3)),
      avGapSec: Number((m.filmAudioSec - m.filmVideoSec).toFixed(3)),
      ...(m.decodePartial === true ? { decodePartial: true } : {}),
      rmsBins05s: m.rms.bins.map((v) => Number(v.toFixed(4))),
    }
    // 判据 ②：[2s,4s) 的 bin（0.5s bin → 下标 4..7）应静音；[0,2) 与 [4,6)（下标 0..3 / 8..11）应有声。
    const bins = m.rms.bins
    const middleSilent = bins.length >= 12 && bins.slice(4, 8).every((v) => v < SILENT_RMS_THRESHOLD)
    const headHasSound = bins.slice(0, 4).some((v) => v > SOUND_RMS_THRESHOLD)
    const tailHasSound = bins.length >= 12 && bins.slice(8, 12).some((v) => v > SOUND_RMS_THRESHOLD)
    caseA.criteria = { middleSilent, headHasSound, tailHasSound }
  } finally {
    await rm(dirA, { recursive: true, force: true })
  }

  // ── 案例 C：16k 单声道 × 48k 立体声混拼（§1.4 实验 C 的最小复刻）─────────
  const dirC = await mkdtemp(join(tmpdir(), 'cs-baseline-c-'))
  const caseC = {}
  try {
    const { result, finalPath } = await composeWithRegistry({
      rootDir: dirC, ffmpegPath, fixturePaths,
      clipNames: ['t-audio2s-16kmono.mp4', 't-audio2s-48kstereo.mp4'],
    })
    const m = await measureFilm(finalPath, ffmpegPath)
    caseC.compose = {
      duration: result.duration,
      audioComposition: result.audioComposition,
      warnings: result.warnings ?? [],
    }
    caseC.measured = {
      filmAudioSec: Number(m.filmAudioSec.toFixed(3)),
      filmVideoSec: Number(m.filmVideoSec.toFixed(3)),
      avGapSec: Number((m.filmAudioSec - m.filmVideoSec).toFixed(3)),
      ...(m.decodePartial === true ? { decodePartial: true } : {}),
      rmsBins05s: m.rms.bins.map((v) => Number(v.toFixed(4))),
    }
  } finally {
    await rm(dirC, { recursive: true, force: true })
  }

  // ── 三条判据汇总 ─────────────────────────────────────────────────────────
  const criteria = [
    {
      id: 'A1-音轨时长对齐',
      desc: '3 段含 1 段无声 → 成片音轨时长 == 视频时长（±0.15s）',
      pass: Math.abs(caseA.measured.filmAudioSec - caseA.measured.filmVideoSec) <= AUDIO_TOLERANCE_SEC,
      measured: caseA.measured,
    },
    {
      id: 'A2-无声段区间静音',
      desc: '无声段区间 [2s,4s) 静音、相邻区间有声（逐 0.5s RMS）',
      pass: caseA.criteria.middleSilent && caseA.criteria.headHasSound && caseA.criteria.tailHasSound,
      measured: { ...caseA.criteria, rmsBins05s: caseA.measured.rmsBins05s },
    },
    {
      id: 'C1-混采样率时长对齐',
      desc: '16k 单声道 / 48k 立体声混拼 → 成片音轨时长 == 视频时长（±0.15s）',
      pass: Math.abs(caseC.measured.filmAudioSec - caseC.measured.filmVideoSec) <= AUDIO_TOLERANCE_SEC,
      measured: caseC.measured,
    },
  ]
  const passed = criteria.every((c) => c.pass)
  const report = {
    generatedAt: new Date().toISOString(),
    ffmpeg: ffmpegPath,
    plan: 'docs/plans/audio-timeline-plan-20261028.md §1.4',
    tolerance: { avSec: AUDIO_TOLERANCE_SEC, silentRms: SILENT_RMS_THRESHOLD, soundRms: SOUND_RMS_THRESHOLD },
    cases: { caseA, caseC },
    criteria,
    passed,
  }
  const reportPath = join(reportDir, 'audio-baseline.json')
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)

  console.log(`audio-baseline.probe：报告 → ${reportPath}`)
  for (const criterion of criteria) {
    console.log(`  ${criterion.pass ? '✅' : '❌'} ${criterion.id}：${criterion.desc}（实测 A/V 差 ${criterion.measured.avGapSec ?? caseA.measured.avGapSec}s）`)
  }
  console.log(passed
    ? 'audio-baseline.probe：全部判据绿（CV-040 断裂已修复）'
    : 'audio-baseline.probe：存在红判据（CV-040 断裂仍可复现 —— 这是 S0 的预期基线）')
  process.exit(passed ? 0 : 1)
}

main().catch((cause) => {
  console.error(`audio-baseline.probe: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}`)
  process.exit(2)
})
