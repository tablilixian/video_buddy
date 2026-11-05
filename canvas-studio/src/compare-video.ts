/**
 * 自动对比片（CV-445 S4，rea-video A6 吸收）—— 原片｜复刻 **左右并排** 一条出。
 *
 * 为什么：五项对照（节奏 ≤0.2s / 转场 / 字幕 / 信息卡 / 整体）目前是文字判据靠人工
 * 想象；并排对比片把「哪一秒没对齐」变成**看得见的错位** —— 验收体验的硬差距。
 *
 * 算法（对齐 rea-video `remake.py` 的核心形态，不 vendor）：
 *   两路各缩放进 640×360 信箱（force_original_aspect_ratio=decrease + pad 居中，
 *   纵横比不一致不会互相拉伸）→ 各自烧录标签（原片 / 复刻）→ hstack 并排；
 *   音频取**复刻片**（被验收的对象）；时长取两者较短者（-t）。
 *
 * 纯函数（argv 构造）与 ffmpeg IO 分离；标签经 `sanitizeDrawtextLabel` 清洗
 * （复用 evidence-grid 同一份实现，不复制）。
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { probeMediaInfo, resolveFfmpegPath, runFfmpeg, FFMPEG_TIMEOUT_MS } from './ffmpeg-run.js'
import { bundledGridFontFile, sanitizeDrawtextLabel } from './evidence-grid.js'
import { throwError } from './error-system.js'
import './errors/catalog.js'

/** 单侧画面宽高（并排后 1280×360 —— 竖屏素材进信箱，不互相拉伸）。 */
export const COMPARE_CELL_W = 640
export const COMPARE_CELL_H = 360

export interface CompareLabels {
  left: string
  right: string
  fontFile?: string
}

/**
 * 标签与字体决策（纯）：随包 CJK 字体存在 → 用中文标签（原片/复刻）；
 * 缺失 → 退 ASCII 标签（ORIGINAL/REMAKE），drawtext 不带 fontfile。
 */
export function decideCompareLabels(fontFile?: string, labels?: { left?: string; right?: string }): CompareLabels {
  const resolvedFont = fontFile ?? bundledGridFontFile()
  if (existsSync(resolvedFont)) {
    return {
      left: sanitizeDrawtextLabel(labels?.left ?? '原片'),
      right: sanitizeDrawtextLabel(labels?.right ?? '复刻'),
      fontFile: resolvedFont,
    }
  }
  return { left: labels?.left ?? 'ORIGINAL', right: labels?.right ?? 'REMAKE' }
}

function drawtextFilter(text: string, fontFile: string | undefined): string {
  const size = Math.max(18, Math.round(COMPARE_CELL_H / 12))
  const font = fontFile !== undefined ? `fontfile=${fontFile}:` : ''
  return `drawtext=${font}text='${text}':fontsize=${size}:fontcolor=white:borderw=2:bordercolor=black:x=(w-tw)/2:y=8`
}

function cellChain(label: string, fontFile: string | undefined): string {
  return `scale=${COMPARE_CELL_W}:${COMPARE_CELL_H}:force_original_aspect_ratio=decrease`
    + `,pad=${COMPARE_CELL_W}:${COMPARE_CELL_H}:(ow-iw)/2:(oh-ih)/2`
    + `,${drawtextFilter(label, fontFile)}`
}

export interface BuildCompareArgsOptions {
  labels?: { left?: string; right?: string }
  fontFile?: string
}

/**
 * 构造对比片 ffmpeg argv（纯，可断言）。时长都探到时加 `-t`（较短者对齐），
 * 否则靠输入自然结束（hstack 短流结束即冻结尾帧 —— ffmpeg 缺省行为，可接受）。
 */
export function buildCompareArgs(
  paths: { originalPath: string; remakePath: string; outPath: string },
  durations: { originalSec?: number; remakeSec?: number },
  options: BuildCompareArgsOptions = {},
): string[] {
  const { labels, fontFile } = options
  const decided = decideCompareLabels(fontFile, labels)
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-i', paths.originalPath,
    '-i', paths.remakePath,
    '-filter_complex',
    `[0:v]${cellChain(decided.left, decided.fontFile)}[L];`
    + `[1:v]${cellChain(decided.right, decided.fontFile)}[R];`
    + '[L][R]hstack=inputs=2[v]',
    '-map', '[v]',
    '-map', '1:a?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '160k',
  ]
  if (durations.originalSec !== undefined && durations.originalSec > 0
    && durations.remakeSec !== undefined && durations.remakeSec > 0) {
    args.push('-t', Math.min(durations.originalSec, durations.remakeSec).toFixed(3))
  }
  args.push('-y', paths.outPath)
  return args
}

/** 对比片产物路径决策：与复刻片同目录 `compare.mp4`（显式 outPath 优先）。 */
export function defaultCompareOutPath(remakePath: string, explicit?: string): string {
  if (explicit !== undefined && explicit.trim() !== '') return explicit.trim()
  return join(dirname(remakePath), 'compare.mp4')
}

/**
 * 对比片入口：原片 + 复刻片 → 并排 compare.mp4。任一输入探不到时长不阻塞
 * （时长对齐降级为自然结束）；ffmpeg 失败显式报错（这是验收产物，静默失败没意义）。
 */
export async function makeCompareVideo(options: {
  originalPath: string
  remakePath: string
  outPath?: string
  labels?: { left?: string; right?: string }
  fontFile?: string
  ffmpegPath?: string
  signal?: AbortSignal
}): Promise<{ outPath: string; durationSec: number | null }> {
  const { originalPath, remakePath } = options
  const ffmpeg = resolveFfmpegPath(options.ffmpegPath)
  const outPath = defaultCompareOutPath(remakePath, options.outPath)

  const [originalInfo, remakeInfo] = await Promise.all([
    probeMediaInfo(originalPath, ffmpeg, options.signal),
    probeMediaInfo(remakePath, ffmpeg, options.signal),
  ])
  if (originalInfo.duration <= 0) {
    throwError('CS-USER-ERR', { message: `探不到原片时长（${originalPath}）—— 文件损坏或不是视频。`, detail: 'original duration unknown' })
  }
  if (remakeInfo.duration <= 0) {
    throwError('CS-USER-ERR', { message: `探不到复刻片时长（${remakePath}）—— 文件损坏或不是视频。`, detail: 'remake duration unknown' })
  }
  const args = buildCompareArgs(
    { originalPath, remakePath, outPath },
    { originalSec: originalInfo.duration, remakeSec: remakeInfo.duration },
    { ...(options.labels !== undefined ? { labels: options.labels } : {}), ...(options.fontFile !== undefined ? { fontFile: options.fontFile } : {}) },
  )
  const run = await runFfmpeg(ffmpeg, args, FFMPEG_TIMEOUT_MS, options.signal)
  if (run.code !== 0) {
    throwError('CS-USER-ERR', { message: `对比片合成失败：${run.stderr.trim().slice(-400) || '无 stderr'}`, detail: 'compare encode failed' })
  }
  return {
    outPath,
    durationSec: Math.round(Math.min(originalInfo.duration, remakeInfo.duration) * 1000) / 1000,
  }
}
