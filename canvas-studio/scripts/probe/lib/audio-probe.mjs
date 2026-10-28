/**
 * 音频取证判定工具（探针专用，跑在 test:smoke 门禁之外）。
 *
 * 为什么放 scripts/probe/lib/ 而不是 tests/helpers/：探针与（未来变绿的）测试要共用
 * 同一套判据口径，而探针必须在门禁之外可独立运行（S0 的 3 条判据在修复完成前是红的，
 * 进 tests/ 会撞 run-smoke 的「名单外新增红」门禁）。
 *
 * 两条铁律（audio-timeline-plan-20261028.md §1.4 / 坑清单 #2）：
 * - **禁止用 `ffmpeg -f null -` 判音频时长**——解码器会给缺失部分补静音帧，
 *   把 4.09s 报成 6.02s。时长判定只用：`ffmpeg -i` stderr 的 `Duration:` 行、
 *   导出 wav 后按 data 块字节数算、silencedetect 的时间戳（后两者为主）。
 * - 判定口径与 `src/ffmpeg-run.ts` 的 `parseFfmpegDuration` / `parseFfmpegStreams`
 *   保持一致（同一正则），探针与产品代码读同一个 ffmpeg 的同一行 stderr。
 *
 * 零依赖：wav 解析是手写的最小 RIFF 头遍历（PCM 16-bit）。
 */
import { spawn } from 'node:child_process'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 与 src/ffmpeg-run.ts parseFfmpegDuration 同一正则同一口径。 */
export function parseFfmpegDuration(stderr) {
  const match = /Duration:\s*(\d+):(\d{2}):(\d{2})\.(\d+)/u.exec(stderr)
  if (match === null) return 0
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const fraction = Number(`0.${match[4]}`)
  return hours * 3600 + minutes * 60 + seconds + fraction
}

/** 与 src/ffmpeg-run.ts parseFfmpegStreams 同一口径（hasAudio / width / height）。 */
export function parseFfmpegStreams(stderr) {
  const videoLine = stderr.split('\n').find((line) => /Video:/.test(line))
  const resolution = videoLine === undefined ? null : /(\d{2,5})x(\d{2,5})/u.exec(videoLine)
  const width = resolution === null ? undefined : Number(resolution[1])
  const height = resolution === null ? undefined : Number(resolution[2])
  const hasAudio = stderr.split('\n').some((line) => /Audio:/.test(line))
  const info = { hasAudio }
  if (width !== undefined) info.width = width
  if (height !== undefined) info.height = height
  return info
}

/** 跑一次 ffmpeg，收集 stdout/stderr（超时强杀）。探针内独立实现，不 import lib/**（避免测旧码）。 */
export function runFfmpegCapture(ffmpegPath, args, timeoutMs = 120_000) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      if (!settled) { settled = true; rejectPromise(new Error(`ffmpeg 超时（${Math.round(timeoutMs / 1000)}s）`)) }
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (cause) => {
      clearTimeout(timer)
      if (!settled) { settled = true; rejectPromise(new Error(`ffmpeg 启动失败: ${cause.message}`)) }
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (!settled) { settled = true; resolvePromise({ code: code ?? -1, stdout, stderr }) }
    })
  })
}

/** 容器时长（`ffmpeg -i` stderr 的 `Duration:` 行；探测失败 0）。 */
export async function audioDurationOf(file, ffmpegPath) {
  const probe = await runFfmpegCapture(ffmpegPath, ['-i', file])
  return parseFfmpegDuration(probe.stderr)
}

/**
 * **视频流时长**：导出 `-an -c copy` 的临时 mp4 再读 Duration。
 * 为什么不直接用容器 Duration：补静音轨之后音轨可能比视频长零点几秒（AAC 编码
 * 延迟），容器 Duration 取的是 max(video, audio)，会把音轨长度冒充视频长度。
 */
export async function videoDurationOf(file, ffmpegPath) {
  const dir = await mkdtemp(join(tmpdir(), 'cs-probe-v-'))
  try {
    const out = join(dir, 'video-only.mp4')
    const res = await runFfmpegCapture(ffmpegPath, ['-i', file, '-an', '-c:v', 'copy', '-y', out])
    if (res.code !== 0) return 0
    const probe = await runFfmpegCapture(ffmpegPath, ['-i', out])
    return parseFfmpegDuration(probe.stderr)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * 提取音轨为单声道 8kHz PCM16 wav（`-vn`），返回 { data, sampleRate, channels, bitsPerSample }。
 * 8kHz 对「逐秒 RMS」足够（人耳关心的能量分布是秒级/半秒级现象）。
 */
export async function extractWav(file, ffmpegPath) {
  const dir = await mkdtemp(join(tmpdir(), 'cs-probe-w-'))
  try {
    const out = join(dir, 'audio.wav')
    const res = await runFfmpegCapture(ffmpegPath, ['-i', file, '-vn', '-ac', '1', '-ar', '8000', '-c:a', 'pcm_s16le', '-y', out])
    // 解码非零退出 ≠ 探针失败：混采样率损坏流（实验 C）本来就会中途炸掉解码器，
    // 已解出的部分 wav 仍是合法实测值 —— 原样返回并标注 decodePartial。
    let decodePartial = false
    if (res.code !== 0) {
      decodePartial = true
      if (!/Conversion failed|Invalid data/u.test(res.stderr)) {
        throw new Error(`wav 导出失败（exit ${res.code}）：${file}\n${res.stderr.trim().split('\n').slice(-8).join('\n')}`)
      }
    }
    const buf = await readFile(out)
    const wav = parseWav(buf)
    if (wav === null) throw new Error(`wav 解析失败（RIFF/data 块缺失）：${out}`)
    return { ...wav, decodePartial }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** 最小 RIFF 遍历：返回 { samples: Int16Array, sampleRate, channels, bitsPerSample }；解析失败 null。 */
export function parseWav(buf) {
  if (buf.length < 12) return null
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null
  let offset = 12
  let fmt = null
  let dataStart = -1
  let dataSize = 0
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4)
    const chunkSize = buf.readUInt32LE(offset + 4)
    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(offset + 8),
        channels: buf.readUInt16LE(offset + 10),
        sampleRate: buf.readUInt32LE(offset + 12),
        bitsPerSample: buf.readUInt16LE(offset + 22),
      }
    } else if (chunkId === 'data') {
      dataStart = offset + 8
      dataSize = Math.min(chunkSize, buf.length - dataStart)
    }
    offset += 8 + chunkSize + (chunkSize % 2)
  }
  if (fmt === null || dataStart < 0) return null
  const bytesPerSample = fmt.bitsPerSample / 8
  const count = Math.floor(dataSize / bytesPerSample)
  const samples = new Int16Array(count)
  for (let i = 0; i < count; i += 1) samples[i] = buf.readInt16LE(dataStart + i * bytesPerSample)
  return { samples, sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bitsPerSample }
}

/**
 * **逐秒（或逐 bin）RMS**：导出 wav 后按 binSec 切窗算均方根（0–1 归一）。
 * 这是「音轨实际有多长 / 哪里有声」的唯一可靠判据（坑清单 #2）。
 * 返回 { binSec, bins: number[], durationSec }；durationSec = wav data 块折算的真实音轨时长。
 */
export async function audioRmsBySecond(file, { ffmpegPath, binSec = 1 } = {}) {
  const wav = await extractWav(file, ffmpegPath)
  const samplesPerBin = Math.max(1, Math.round(wav.sampleRate * binSec))
  const bins = []
  for (let start = 0; start < wav.samples.length; start += samplesPerBin) {
    const end = Math.min(start + samplesPerBin, wav.samples.length)
    let sumSquares = 0
    for (let i = start; i < end; i += 1) {
      const v = wav.samples[i] / 32768
      sumSquares += v * v
    }
    bins.push(Math.sqrt(sumSquares / Math.max(1, end - start)))
  }
  const durationSec = wav.samples.length / wav.sampleRate
  return { binSec, bins, durationSec, sampleRate: wav.sampleRate }
}

/**
 * silencedetect 静音区间（读 `-af silencedetect` 的 stderr 时间戳；时间戳本身
 * 是可靠判据，禁的是用 `-f null -` 的**解码帧计数**判时长）。
 * 返回 [{ start, end }]（end 为 null 表示静音持续到文件尾）。
 */
export async function detectSilenceRanges(file, { ffmpegPath, noiseDb = -40, minDur = 0.3 } = {}) {
  const res = await runFfmpegCapture(ffmpegPath, ['-i', file, '-af', `silencedetect=noise=${noiseDb}dB:d=${minDur}`, '-f', 'null', '-'])
  const starts = [...res.stderr.matchAll(/silence_start:\s*(-?[\d.]+)/gu)].map((m) => Number(m[1]))
  const ends = [...res.stderr.matchAll(/silence_end:\s*(-?[\d.]+)/gu)].map((m) => Number(m[1]))
  const ranges = []
  for (let i = 0; i < starts.length; i += 1) {
    ranges.push({ start: Math.max(0, starts[i]), end: i < ends.length ? ends[i] : null })
  }
  return ranges
}
