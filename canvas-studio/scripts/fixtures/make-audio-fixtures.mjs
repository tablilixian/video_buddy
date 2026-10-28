#!/usr/bin/env node
/**
 * 音频取证样本生成器（S0 · CV-040 基线，2026-10-28）。
 *
 * 把 audio-timeline-plan-20261028.md §1.4 的手工实验命令固化成脚本：
 * - 默认：往 `tests/fixtures/audio/` 造 6 个视频样本（320×240 / 25fps，总 <300KB）——
 *   ① 有声 2s（440Hz）② 无声 2s（无音轨）③ 有声短 0.4s ④ 有声 0.6s
 *   ⑤ 16k 单声道 2s ⑥ 48k 立体声 2s（⑤⑥ 复刻 §1.4 实验 C 的参数混拼场景）。
 * - `--beats`：另造 3 条已知 BPM 的合成鼓点曲（120/90/140，G2 节拍自验用），
 *   48k 单声道 wav（无损，节拍分析不被编码伪影干扰）。
 *
 * 样本不入 git（.gitignore），脚本可随时重造；探针运行前会自动调 ensureAudioFixtures。
 * 判音频时长**禁止** `ffmpeg -f null -`（解码器补静音帧会把 4.09s 报成 6.02s），
 * 本脚本只负责生成，判定统一走 scripts/probe/lib/audio-probe.mjs。
 */
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
/** canvas-studio 包根。 */
export const packageRoot = resolve(here, '..', '..')
/** 仓库根（video_buddy）。 */
export const repoRoot = resolve(packageRoot, '..')
/** 内置 ffmpeg（随包档主路径；FFMPEG_PATH 可覆盖）。 */
export function resolveFixtureFfmpegPath() {
  if (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH.length > 0) return process.env.FFMPEG_PATH
  return join(repoRoot, 'dsh-plugin-desktop', 'build', 'ffmpeg', 'darwin-arm64', 'ffmpeg')
}

/** 6 个视频样本的定义（§1.4 实验 A / C 的最小复刻集）。 */
export const VIDEO_FIXTURES = [
  { name: 't-audio2s.mp4', duration: 2, freq: 440, audioArgs: ['-c:a', 'aac', '-ar', '48000', '-ac', '2'] },
  { name: 't-silent2s.mp4', duration: 2, freq: null, audioArgs: null },
  { name: 't-audio04s.mp4', duration: 0.4, freq: 880, audioArgs: ['-c:a', 'aac', '-ar', '48000', '-ac', '2'] },
  { name: 't-audio06s.mp4', duration: 0.6, freq: 660, audioArgs: ['-c:a', 'aac', '-ar', '48000', '-ac', '2'] },
  { name: 't-audio2s-16kmono.mp4', duration: 2, freq: 440, audioArgs: ['-c:a', 'aac', '-ar', '16000', '-ac', '1'] },
  { name: 't-audio2s-48kstereo.mp4', duration: 2, freq: 440, audioArgs: ['-c:a', 'aac', '-ar', '48000', '-ac', '2'] },
]

/** G2 已知 BPM 鼓点曲（纯节拍 click，8s，间隔 = 60/BPM）。 */
export const BEAT_FIXTURES = [120, 90, 140].map((bpm) => ({ name: `beat-${bpm}.wav`, bpm }))

function runFfmpegSync(ffmpegPath, args) {
  const res = spawnSync(ffmpegPath, ['-v', 'error', ...args], { encoding: 'utf8', timeout: 60_000 })
  if (res.status !== 0) {
    throw new Error(`ffmpeg 失败（exit ${res.status}）：ffmpeg ${args.join(' ')}\n${res.stderr ?? ''}`)
  }
}

/**
 * 确保 6 个视频样本存在（缺哪个造哪个）。返回绝对路径表 `{ name: path }`。
 * 已存在时跳过（时长/内容由首次生成决定，判据不依赖重建）。
 */
export async function ensureAudioFixtures({ ffmpegPath = resolveFixtureFfmpegPath(), dir = join(packageRoot, 'tests', 'fixtures', 'audio'), force = false } = {}) {
  await mkdir(dir, { recursive: true })
  const paths = {}
  for (const spec of VIDEO_FIXTURES) {
    const out = join(dir, spec.name)
    paths[spec.name] = out
    if (!force) {
      try { await stat(out); continue } catch { /* 不存在则造 */ }
    }
    // 视频：testsrc 彩条（内嵌时间码内容差异，便于人眼区分段序）；音频：纯正弦。
    // -preset ultrafast + crf 34 控体积（6 样本总 <300KB）。
    const args = [
      '-f', 'lavfi', '-i', `testsrc=size=320x240:rate=25:duration=${spec.duration}`,
    ]
    if (spec.freq !== null) {
      args.push('-f', 'lavfi', '-i', `sine=frequency=${spec.freq}:duration=${spec.duration}`)
    }
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '34', '-pix_fmt', 'yuv420p')
    if (spec.audioArgs !== null) {
      args.push(...spec.audioArgs, '-shortest')
    } else {
      args.push('-an')
    }
    args.push('-y', out)
    runFfmpegSync(ffmpegPath, args)
  }
  return paths
}

/**
 * 生成 G2 已知 BPM 鼓点曲（缺哪个造哪个）。返回绝对路径表。
 * click 声：aevalsrc 按 `mod(t, 间隔) < 0.04` 开窗的 1kHz 正弦，窗口 40ms、
 * 幅度 0.8 —— 节拍位置在波形上是确定性尖峰，自相关估 BPM 不受和声干扰。
 */
export async function ensureBeatFixtures({ ffmpegPath = resolveFixtureFfmpegPath(), dir = join(packageRoot, 'tests', 'fixtures', 'audio'), force = false } = {}) {
  await mkdir(dir, { recursive: true })
  const paths = {}
  for (const spec of BEAT_FIXTURES) {
    const out = join(dir, spec.name)
    paths[spec.name] = out
    if (!force) {
      try { await stat(out); continue } catch { /* 不存在则造 */ }
    }
    const interval = 60 / spec.bpm
    const seconds = 8
    const expr = `if(lt(mod(t\\,${interval.toFixed(6)})\\,0.04)\\,0.8*sin(2*PI*1000*t)\\,0)`
    runFfmpegSync(ffmpegPath, [
      '-f', 'lavfi', '-i', `aevalsrc=${expr}:d=${seconds}:s=48000:c=mono`,
      '-c:a', 'pcm_s16le', '-y', out,
    ])
  }
  return paths
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  const force = process.argv.includes('--force')
  const beatsOnly = process.argv.includes('--beats')
  try {
    if (!beatsOnly) {
      const paths = await ensureAudioFixtures({ force })
      let total = 0
      for (const [name, path] of Object.entries(paths)) {
        const size = (await stat(path)).size
        total += size
        console.log(`✔ ${name} (${size} bytes)`)
      }
      console.log(`视频样本合计 ${total} bytes（预算 <300KB = ${total < 300 * 1024 ? 'OK' : '超预算'}）`)
    }
    if (beatsOnly || process.argv.includes('--all')) {
      const beats = await ensureBeatFixtures({ force })
      for (const [name, path] of Object.entries(beats)) {
        console.log(`✔ ${name} (${(await stat(path)).size} bytes)`)
      }
    }
  } catch (cause) {
    console.error(`make-audio-fixtures: ${cause instanceof Error ? cause.message : String(cause)}`)
    process.exit(1)
  }
}
