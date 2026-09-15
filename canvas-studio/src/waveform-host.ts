/**
 * Host 侧真波形包络（C3，唯一带 Host 新能力的一批）。
 *
 * 用既有 ffmpeg 解析链（resolveFfmpegPath）把音频解码成单声道 8kHz s16le
 * PCM，取峰值序列归一化到 0–1 —— 这是「波形与音频实际起伏相符」的数据源。
 * 设计稿的波形是伪随机 sine 公式，这里做成真的，属于「比设计稿更好」。
 *
 * ## 流式取峰（CV-180：真波形其实一直是降级条）
 *
 * 旧实现把整段 PCM 收进 Buffer，为防爆设了 200KB 上限 —— 而 8kHz s16le 单声道
 * 是 16KB/秒，于是**可解码时长上限只有 12.8 秒**。任何超过 12.8 秒的曲子都被
 * ffmpeg 强杀 → 路由 400 → 客户端静默退回确定性降级公式。用户实测症状正是
 * 「两首不同曲子的 BGM 轨看起来都不像真波形」：波形**看起来有**，其实永远是
 * 那套 `seed*(i+3)%71` 的降级条，真包络一次都没走到屏幕上。
 *
 * 现在改为**边解边取峰**：解码过程中就把每 250 个样本（31.25ms）的峰值取出来，
 * 内存只与时长有关（每秒 32 个数）、与字节数无关。上限因此从 12.8 秒抬到
 * 约 35 分钟，且每个切片都是**真峰**（不因分桶而丢瞬时峰值）。
 *
 * 为什么不走 ffmpeg-run.runFfmpeg：它的 stdout 按 UTF-8 字符串累计且有 1MB
 * 日志上限（CR-020，为进度文本设计），二进制 PCM 会被字符串化损坏 —— 这里
 * 自带 Buffer 收集的 spawn，超时强杀 / abort 语义与 runFfmpeg 对齐。
 *
 * 失败语义：ffmpeg 缺失 / 解码失败一律抛错，由路由层转成 400 —— 客户端
 * （use-waveform.ts）拿到失败会静默退回确定性降级公式，波形是装饰性信息，
 * 不该打断渲染或播放。
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { resolveFfmpegPath, FFMPEG_TIMEOUT_MS } from './ffmpeg-run.js'
import { WAVE_BARS_MAX } from './waveform.js'
import type { ProjectRegistry } from './projects.js'

/** 包络固定桶数：一次解码多处消费（节点卡 28 / 播放器 48 / 时间轴 ~32 都够）。 */
export const WAVEFORM_ENVELOPE_BUCKETS = Math.min(WAVE_BARS_MAX, 96)

/** 音频文件扩展名白名单。 */
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'])

/** 解码采样率：8kHz 单声道足以表达包络，每秒仅 16KB 字节流。 */
const DECODE_SAMPLE_RATE = 8000

/**
 * 峰值切片长度（样本数）：250 @8kHz = 31.25ms，即每秒 32 片。
 *
 * 切片是「内存与时长解耦」的手段：不解码完整段、只保留每片一个峰值数。
 * 32 片/秒 这个粒度远细于最终 96 桶（一首 15 秒 BGM = 480 片，每桶平均 5 片
 * 取 max），所以既不会丢瞬时峰值，也不会让短音频退化成一根平线。
 */
const SLICE_SAMPLES = 250

/**
 * 切片数上限（65536 片 / 32 片每秒 ≈ 34.9 分钟）。超出即认为不是 BGM 素材：
 * 直接失败而不是静默截断 —— 截断的包络会把后半段画成平线，比报错更难查。
 */
const MAX_SLICES = 65_536

/**
 * 按项目资产白名单解析出磁盘路径（与 promoteAssetFile 同一防穿越规则）：
 * file 必须是纯文件名且落在音频扩展名白名单内，项目必须存在。返回 null
 * 表示参数不可解析（客户端不该为这种请求重试）。
 */
export async function resolveAudioAssetPath(
  registry: ProjectRegistry,
  projectId: string,
  file: string,
): Promise<string | null> {
  if (!/^[A-Za-z0-9._-]+$/u.test(file) || file.includes('..')) return null
  const dot = file.lastIndexOf('.')
  if (dot < 0) return null
  if (!AUDIO_EXTENSIONS.has(file.slice(dot).toLowerCase())) return null
  const project = (await registry.list()).find((entry) => entry.id === projectId)
  if (!project) return null
  return join(registry.assetsDir(projectId), file)
}

/**
 * 探测音频包络：返回 WAVEFORM_ENVELOPE_BUCKETS 个 0–1 峰值（两位小数）。
 *
 * 两级归约：先由解码器给出「每 31.25ms 一个真峰」的切片表，再把切片表按 max
 * 归约到 96 桶。第二级只做降采样，不再触碰 PCM —— 这正是能支持任意时长 BGM
 * 的原因。
 *
 * @param signal 请求中断信号（对齐 runFfmpeg 的 abort 语义）。
 * @param ffmpegPath 显式 ffmpeg 路径（测试替身注入点；缺省走解析链）。
 */
export async function probeWaveformEnvelope(
  registry: ProjectRegistry,
  projectId: string,
  file: string,
  signal?: AbortSignal,
  ffmpegPath?: string,
): Promise<number[]> {
  const audioPath = await resolveAudioAssetPath(registry, projectId, file)
  if (audioPath === null) throw new Error(`不是可解析的项目音频资产: ${projectId}/${file}`)
  const ffmpeg = ffmpegPath ?? resolveFfmpegPath()
  const slices = await decodeSlicePeaks(ffmpeg, audioPath, signal)
  if (slices.length === 0) throw new Error('音频解码结果为空（文件损坏或不含可解码音轨）')

  const buckets = WAVEFORM_ENVELOPE_BUCKETS
  const peaks = new Float64Array(buckets)
  for (let index = 0; index < buckets; index += 1) {
    const start = Math.floor((index * slices.length) / buckets)
    const end = Math.max(start + 1, Math.floor(((index + 1) * slices.length) / buckets))
    let peak = 0
    for (let cursor = start; cursor < end && cursor < slices.length; cursor += 1) {
      const value = slices[cursor]!
      if (value > peak) peak = value
    }
    peaks[index] = peak
  }
  let max = 0
  for (const peak of peaks) if (peak > max) max = peak
  if (max === 0) throw new Error('音频全部静音，无法生成波形')
  return Array.from(peaks, (peak) => Math.round((peak / max) * 100) / 100)
}

/**
 * 解码成 s16le 单声道 PCM，**边解边取峰值切片**（不整段缓存）。
 *
 * s16le 是 2 字节对齐的：chunk 边界可能劈开一个样本，故用 carry 捎带那半个
 * 样本到下一 chunk —— 不处理的话每个 chunk 边界都会产生一个错位噪声样本。
 *
 * 超时强杀 / abort 以 reason 拒绝，与 runFfmpeg 语义对齐。
 * @returns 每 SLICE_SAMPLES 个样本一个峰值的切片表（末片不足也算一片）。
 */
function decodeSlicePeaks(ffmpegPath: string, audioPath: string, signal?: AbortSignal): Promise<number[]> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(ffmpegPath, [
      '-v', 'error', '-i', audioPath, '-vn', '-ac', '1', '-ar', String(DECODE_SAMPLE_RATE), '-f', 's16le', '-',
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    const slices: number[] = []
    let carry = Buffer.alloc(0)
    let slicePeak = 0
    let sliceSamples = 0
    let stderr = ''
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    /** 失败即强杀子进程 —— 否则解码会带着已经无主的输出继续跑。 */
    const fail = (error: Error) => {
      finish(() => rejectPromise(error))
      child.kill('SIGKILL')
    }
    const onAbort = () => {
      child.kill('SIGKILL')
      finish(() => rejectPromise(signal?.reason ?? new DOMException('aborted', 'AbortError')))
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(() => rejectPromise(new Error(`波形解码超时（${Math.round(FFMPEG_TIMEOUT_MS / 1000)}s）`)))
    }, FFMPEG_TIMEOUT_MS)
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return
      const buffer = carry.length === 0 ? chunk : Buffer.concat([carry, chunk])
      const usable = buffer.length - (buffer.length % 2)
      carry = usable === buffer.length ? Buffer.alloc(0) : Buffer.from(buffer.subarray(usable))
      for (let offset = 0; offset < usable; offset += 2) {
        // little-endian s16 → 幅值绝对值（符号折叠）。
        const raw = buffer[offset]! | (buffer[offset + 1]! << 8)
        const magnitude = Math.abs(raw < 0x8000 ? raw : raw - 0x10000)
        if (magnitude > slicePeak) slicePeak = magnitude
        sliceSamples += 1
        if (sliceSamples === SLICE_SAMPLES) {
          slices.push(slicePeak)
          slicePeak = 0
          sliceSamples = 0
          if (slices.length > MAX_SLICES) {
            fail(new Error('音频过长，超出波形解码上限（约 35 分钟）'))
            return
          }
        }
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += String(chunk)
    })
    child.on('error', (cause) => {
      finish(() => rejectPromise(new Error(`无法启动 ffmpeg：${cause instanceof Error ? cause.message : String(cause)}`)))
    })
    child.on('close', (code) => {
      if (settled) return
      if (code !== 0) {
        finish(() => rejectPromise(new Error(`ffmpeg 波形解码失败（exit ${code}）：${stderr.slice(-400) || '无 stderr'}`)))
        return
      }
      if (sliceSamples > 0) slices.push(slicePeak)
      finish(() => resolvePromise(slices))
    })
  })
}
