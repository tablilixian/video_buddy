/**
 * WAV 编码（0A · CV-460）。16-bit PCM、立体声、48kHz。
 *
 * 与 `gt/native_audiolib.py:359` 的 `write_wav` 同格式（它也是 clip → ×32767 → `<i2`
 * → 双声道），只是采样率用 48000 而非 44100 —— 与 `AUDIO_DELIVERY_SAMPLE_RATE`
 * 对齐，渲染期不必重采样（重采样会引入一层无法验证的误差）。
 *
 * 纯函数：不碰文件系统（落盘在 `scripts/build-sfx.mjs`），便于单测断言头字段。
 */
import type { Mono } from './dsp.js'

/**
 * 读到的字节不是 WAV。
 *
 * 为什么是自定义类而不是裸 `throw new Error`：`tests/error-system-guards.test.mjs`
 * 禁止 `src/**` 裸抛（裸抛没有错误码／没有可执行文案）。这个模块是纯编解码工具，
 * 不依赖 error-system（构建脚本 `build-sfx.mjs` 单独用它），所以用自定义类，
 * 由调用方决定怎么呈现。
 */
export class WavFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WavFormatError'
  }
}

/** WAV 头固定 44 字节（无附加 chunk）。 */
export const WAV_HEADER_BYTES = 44

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
}

/** 采样值 → 16-bit 有符号整数（先 clip 到 [−1, 1]，与源实现一致）。 */
export function toInt16(value: number): number {
  const clamped = value < -1 ? -1 : value > 1 ? 1 : value
  // ×32767 而非 ×32768：与 numpy 的 `.astype('<i2')` 截断口径一致，且不会溢出到 +32768
  return Math.round(clamped * 32767)
}

/**
 * 编码成立体声 WAV。
 *
 * `right` 缺省 = 复制 `left`（中置）。两条声道长度不同时按短的截断 —— 静默补齐
 * 只会掩盖调用方的 bug。
 */
export function encodeWavStereo(left: Mono, sampleRate: number, right?: Mono): Uint8Array {
  const r = right ?? left
  const frames = Math.min(left.length, r.length)
  const dataBytes = frames * 2 * 2 // 2 声道 × 2 字节
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true) // 后续字节数 = 36 + data
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // fmt 块长度
  view.setUint16(20, 1, true) // 1 = PCM
  view.setUint16(22, 2, true) // 声道数
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2 * 2, true) // byte rate = SR × 声道 × 位深/8
  view.setUint16(32, 4, true) // block align = 声道 × 位深/8
  view.setUint16(34, 16, true) // 位深
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  let offset = WAV_HEADER_BYTES
  for (let i = 0; i < frames; i += 1) {
    view.setInt16(offset, toInt16(left[i]!), true)
    view.setInt16(offset + 2, toInt16(r[i]!), true)
    offset += 4
  }
  return new Uint8Array(buffer)
}

/** 读回 WAV 头（测试与「幂等比对」用，避免依赖外部解码器）。 */
export interface WavHeader {
  sampleRate: number
  channels: number
  bitsPerSample: number
  /** data 块字节数（不含头）。 */
  dataBytes: number
  /** 帧数（= dataBytes / (channels × bits/8)）。 */
  frames: number
}

export function readWavHeader(bytes: Uint8Array): WavHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const riff = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)
  const wave = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!)
  if (riff !== 'RIFF' || wave !== 'WAVE') throw new WavFormatError('不是 WAV 文件（RIFF/WAVE 标记缺失）')
  const channels = view.getUint16(22, true)
  const sampleRate = view.getUint32(24, true)
  const bitsPerSample = view.getUint16(34, true)
  const dataBytes = view.getUint32(40, true)
  const blockAlign = channels * (bitsPerSample / 8)
  return { sampleRate, channels, bitsPerSample, dataBytes, frames: dataBytes / blockAlign }
}
