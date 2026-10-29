/**
 * 能力基准 · 5 条硬检查 + contact sheet（全部机械判定，不看感觉）。
 *
 * 判据来历（文档 §9.4，2026-10-29 在本机实测校准过）：
 *   H1 有画面：逐帧 Y 跨度（YMAX−YMIN）≤8 记为"平帧"，**平帧占比 >20% 才判红**。
 *              实测真渲成片 180 帧里只有 1 帧平帧（0.6%，合法淡入），用"全片最小"会误杀。
 *   H2 有运动：首末帧 SSIM < 0.98，且中点帧必须落在两者之间（防"瞬间跳变"）。
 *   H3 时长帧率：duration ≈ frames/fps ±1 帧；avg_frame_rate 精确命中。
 *   H4 可复现：同参数渲两次，逐帧 md5 全等；做不到就退 ssim ≥ 0.999 并记 near。
 *   H5 编码合规：video codec / audio codec / 容器与声明一致。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe'

function run(bin, args) {
  const result = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) {
    throw new Error(`${bin} 失败（exit ${result.status}）：${`${result.stderr ?? ''}`.trim().split('\n').slice(-6).join('\n')}`)
  }
  return `${result.stdout ?? ''}`
}

/** 容器/流构成。 */
export function probe(file) {
  const json = run(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name,width,height,avg_frame_rate,nb_frames',
    '-show_entries', 'format=duration,size,bit_rate',
    '-of', 'json',
    file,
  ])
  const parsed = JSON.parse(json)
  const streams = parsed.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video') ?? null
  const audio = streams.find((s) => s.codec_type === 'audio') ?? null
  const [num, den] = String(video?.avg_frame_rate ?? '0/1').split('/').map(Number)
  return {
    durationSec: parsed.format?.duration ? Number(parsed.format.duration) : null,
    sizeBytes: parsed.format?.size ? Number(parsed.format.size) : null,
    bitRate: parsed.format?.bit_rate ? Number(parsed.format.bit_rate) : null,
    video: video
      ? {
          codec: video.codec_name,
          width: video.width,
          height: video.height,
          fps: den ? Number((num / den).toFixed(3)) : null,
          nbFrames: video.nb_frames ? Number(video.nb_frames) : null,
        }
      : null,
    audio: audio ? { codec: audio.codec_name } : null,
  }
}

/** H1：逐帧 Y 跨度，返回平帧占比。 */
export function flatFrameStats(file) {
  const out = run(FFMPEG, ['-v', 'error', '-i', file, '-vf', 'signalstats,metadata=print:file=-', '-f', 'null', '-'])
  const spreads = []
  let pendingMax = null
  for (const line of out.split('\n')) {
    const max = /signalstats\.YMAX=(\d+)/.exec(line)
    if (max) {
      pendingMax = Number(max[1])
      continue
    }
    const min = /signalstats\.YMIN=(\d+)/.exec(line)
    if (min && pendingMax !== null) {
      spreads.push(pendingMax - Number(min[1]))
      pendingMax = null
    }
  }
  const frames = spreads.length
  const flat = spreads.filter((s) => s <= 8).length
  return { frames, flat, ratio: frames > 0 ? flat / frames : 1, minSpread: frames > 0 ? Math.min(...spreads) : 0 }
}

/** 抽单帧到 png。 */
export function extractFrame(file, frame, outPng) {
  mkdirSync(join(outPng, '..'), { recursive: true })
  run(FFMPEG, ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', '-y', outPng])
  return outPng
}

/** 两张 png 的 SSIM（读 `All:` 值）。 */
export function ssim(aPng, bPng) {
  const result = spawnSync(FFMPEG, ['-v', 'error', '-i', aPng, '-i', bPng, '-lavfi', 'ssim=stats_file=-', '-f', 'null', '-'], {
    encoding: 'utf8',
  })
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const match = /All:([0-9.]+)/.exec(text)
  return match ? Number(match[1]) : null
}

/** 逐帧 md5（H4 可复现）。 */
export function frameHashes(file) {
  const out = run(FFMPEG, ['-v', 'error', '-i', file, '-f', 'framemd5', '-'])
  const hashes = []
  for (const line of out.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const parts = line.split(',').map((s) => s.trim())
    if (parts.length >= 6) hashes.push(parts[5])
  }
  return hashes
}

/** 3×3 拼图（contact sheet）：只挑 9 个均匀帧，不整片缩放。 */
export function contactSheet(file, totalFrames, outPng) {
  const picks = Array.from({ length: 9 }, (_, i) => Math.min(totalFrames - 1, Math.round(((totalFrames - 1) * i) / 8)))
  const expr = picks.map((n) => `eq(n\\,${n})`).join('+')
  mkdirSync(join(outPng, '..'), { recursive: true })
  run(FFMPEG, [
    '-v', 'error',
    '-i', file,
    '-vf', `select='${expr}',scale=480:270,drawbox=x=0:y=0:w=iw:h=ih:color=0x5ad2ff@0.25:t=2,tile=3x3`,
    '-frames:v', '1',
    '-y', outPng,
  ])
  return { outPng, picks }
}

/**
 * 跑齐 5 条检查。
 * @param {{ file: string, file2?: string, expect: Record<string, unknown>, spec: { fps: number, durationInFrames: number, width: number, height: number }, workDir: string }} options
 */
export function runChecks(options) {
  const { file, file2, expect, spec, workDir } = options
  if (!existsSync(file)) throw new Error(`产物不存在：${file}`)
  mkdirSync(workDir, { recursive: true })

  const info = probe(file)
  const flat = flatFrameStats(file)

  const total = info.video?.nbFrames || spec.durationInFrames
  const firstPng = join(workDir, 'f-first.png')
  const midPng = join(workDir, 'f-mid.png')
  const lastPng = join(workDir, 'f-last.png')
  extractFrame(file, 0, firstPng)
  extractFrame(file, Math.floor(total / 2), midPng)
  extractFrame(file, total - 1, lastPng)

  const ssimFirstLast = ssim(firstPng, lastPng)
  const ssimFirstMid = ssim(firstPng, midPng)
  const ssimMidLast = ssim(midPng, lastPng)

  const expectedDuration = spec.durationInFrames / spec.fps
  const durationOk = info.durationSec !== null && Math.abs(info.durationSec - expectedDuration) <= 1 / spec.fps + 0.05
  const fpsOk = info.video?.fps !== null && Math.abs((info.video?.fps ?? 0) - spec.fps) < 0.01

  let determinism = { mode: 'not-run', pass: null, detail: '未跑第二次渲染' }
  if (file2 && existsSync(file2)) {
    const a = frameHashes(file)
    const b = frameHashes(file2)
    if (a.length > 0 && a.length === b.length && a.every((h, i) => h === b[i])) {
      determinism = { mode: 'hash', pass: true, detail: `${a.length}/${a.length} 帧 md5 全等` }
    } else {
      const sameLen = a.length === b.length
      const diff = sameLen ? a.filter((h, i) => h !== b[i]).length : Math.abs(a.length - b.length)
      const fallback = sameLen ? ssim(firstPng, join(workDir, 'f-first2.png')) : null
      determinism = {
        mode: sameLen ? 'hash-mismatch' : 'length-mismatch',
        pass: false,
        detail: sameLen ? `${diff}/${a.length} 帧不一致` : `帧数不一致：${a.length} vs ${b.length}`,
        fallbackSsim: fallback,
      }
    }
  }

  const hasAudio = info.audio !== null
  const checks = {
    H1: {
      name: '有画面（非纯色/非黑场）',
      pass: flat.ratio <= 0.2,
      detail: `平帧 ${flat.flat}/${flat.frames} = ${(flat.ratio * 100).toFixed(1)}%（阈值 ≤20%），最小 Y 跨度 ${flat.minSpread}`,
    },
    H2: {
      name: '有运动',
      pass: ssimFirstLast !== null && ssimFirstLast < 0.98,
      detail: `首末帧 SSIM ${ssimFirstLast ?? '?'}（阈值 <0.98）；首中 ${ssimFirstMid ?? '?'} / 中末 ${ssimMidLast ?? '?'}`,
    },
    H3: {
      name: '时长与帧率精确',
      pass: durationOk && fpsOk,
      detail: `duration ${info.durationSec ?? '?'}s vs 期望 ${expectedDuration.toFixed(3)}s；fps ${info.video?.fps ?? '?'} vs ${spec.fps}`,
    },
    H4: {
      name: '可复现',
      pass: determinism.pass,
      detail: determinism.detail,
      mode: determinism.mode,
    },
    H5: {
      name: '编码合规',
      pass:
        info.video?.codec === expect.videoCodec &&
        (expect.hasAudio ? info.audio?.codec === expect.audioCodec : true) &&
        info.video?.width === spec.width &&
        info.video?.height === spec.height,
      detail: `video ${info.video?.codec} ${info.video?.width}x${info.video?.height} / audio ${info.audio?.codec ?? 'none'}`,
    },
  }

  const passed = Object.values(checks).filter((c) => c.pass === true).length
  const hardFail = Object.entries(checks).filter(([, c]) => c.pass !== true).map(([k]) => k)

  return {
    info,
    flat,
    checks,
    passedCount: passed,
    hardFail,
    /** 机械分：5 = 5 条全绿；每缺一条扣 1；H1 或 H5 红直接判 0（"没渲出来"或"编码不对"等于没做成）。 */
    autoScore: checks.H1.pass === false || checks.H5.pass === false ? 0 : Math.max(0, passed),
  }
}

export function cleanWorkDir(dir) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
}
