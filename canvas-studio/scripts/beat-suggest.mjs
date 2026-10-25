#!/usr/bin/env node
/**
 * CV-372 · R5（D17，可选线）：BGM 卡点建议器（离线咨询工具，不进渲染链）。
 *
 * 输入 WAV（16/24-bit PCM，任一采样率；mp3 先用系统工具转 wav，如
 * macOS 自带 `afconvert -f WAVE -d LEI16 in.mp3 out.wav`），
 * 输出建议切点帧号 JSON —— 排轨时参考着把段落起点/重音落在节拍上。
 *
 * 算法：分块 RMS 能量 + 自适应阈值 onset 检测（能量显著高于滑动均值即认作一拍，
 * 相邻拍最小间隔 120ms）。纯咨询输出，不改 manifest 契约 —— 有收益后再立项字段。
 *
 * 用法：node scripts/beat-suggest.mjs bgm.wav [--fps 30] [--offset-ms 0] [--out cut.json]
 */
import { readFile, writeFile } from 'node:fs/promises'

const args = process.argv.slice(2)
const input = args.find((a, i) => i === 0 && !a.startsWith('--'))
if (input === undefined) {
  console.error('用法：node scripts/beat-suggest.mjs <bgm.wav> [--fps 30] [--offset-ms 0] [--out cut.json]')
  process.exit(1)
}
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback
}
const fps = Math.max(1, flag('fps', 30))
const offsetMs = flag('offset-ms', 0)
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null

/** 解析 RIFF/WAVE：只取 fmt 与 data 两个必需块，容忍 LIST 等附加块。 */
function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('不是 RIFF/WAVE 文件')
  }
  let pos = 12
  let fmt = null
  let data = null
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(pos + 10),
        sampleRate: buf.readUInt32LE(pos + 12),
        bits: buf.readUInt16LE(pos + 22),
      }
    } else if (id === 'data') {
      data = buf.subarray(pos + 8, pos + 8 + size)
    }
    pos += 8 + size + (size % 2) // chunk 按 2 字节对齐
  }
  if (fmt === null || data === null) throw new Error('WAV 缺 fmt/data 块')
  if (fmt.bits !== 16 && fmt.bits !== 24) throw new Error(`仅支持 16/24-bit PCM（当前 ${fmt.bits}-bit）`)
  return { ...fmt, data }
}

/** 解出单声道样本（多声道取均值；24-bit 按小端三字节取补码）。 */
function decodeMono({ channels, bits, data }) {
  const bytesPerFrame = (bits / 8) * channels
  const frames = Math.floor(data.length / bytesPerFrame)
  const mono = new Float32Array(frames)
  for (let i = 0; i < frames; i += 1) {
    let sum = 0
    for (let c = 0; c < channels; c += 1) {
      const base = i * bytesPerFrame + c * (bits / 8)
      let v
      if (bits === 16) v = data.readInt16LE(base)
      else {
        v = data[base] | (data[base + 1] << 8) | (data[base + 2] << 16)
        if (v & 0x800000) v -= 0x1000000 // 24-bit 补码
      }
      sum += v / (bits === 16 ? 32768 : 8388608)
    }
    mono[i] = sum / channels
  }
  return mono
}

/** RMS 能量块 + 自适应阈值 onset；返回拍点时刻（毫秒）。 */
function detectBeats(mono, sampleRate) {
  const block = Math.max(64, Math.round(sampleRate / 43)) // ≈23ms 一块
  const blocks = Math.floor(mono.length / block)
  const rms = new Float32Array(blocks)
  for (let b = 0; b < blocks; b += 1) {
    let sum = 0
    for (let i = 0; i < block; i += 1) sum += mono[b * block + i] ** 2
    rms[b] = Math.sqrt(sum / block)
  }
  // 全局静音段（前奏/尾奏）不产出拍点：阈值下限取全曲峰值的一小部分。
  let peak = 0
  for (const v of rms) peak = Math.max(peak, v)
  const floor = peak * 0.04
  const window = 43 // ≈1s 滑动均值
  const beats = []
  let lastBeatBlock = -Infinity
  for (let b = window; b < blocks; b += 1) {
    let sum = 0
    for (let i = b - window; i < b; i += 1) sum += rms[i]
    const avg = sum / window
    const t = b * (block / sampleRate) * 1000
    if (rms[b] > avg * 1.6 && rms[b] > floor && t - lastBeatBlock * (block / sampleRate) * 1000 >= 120) {
      beats.push(Math.round(t))
      lastBeatBlock = b
    }
  }
  return beats
}

const wav = parseWav(await readFile(input))
const mono = decodeMono(wav)
const beats = detectBeats(mono, wav.sampleRate)
const durationMs = Math.round((mono.length / wav.sampleRate) * 1000)
const result = {
  input,
  fps,
  offsetMs,
  durationMs,
  sampleRate: wav.sampleRate,
  beatCount: beats.length,
  // 节拍时刻 → 帧号（含 offset 校准；排轨时 startFrame 直接取这里的值）。
  cutFrames: beats.map((ms) => Math.round(((ms + offsetMs) / 1000) * fps)),
}
const json = JSON.stringify(result, null, 2)
if (out !== null) await writeFile(out, `${json}\n`)
else console.log(json)
