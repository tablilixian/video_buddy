/**
 * CV-394（REQ-036 复刻复盘批）：`image_matting` —— 纯色底图抠透明底（alpha PNG）。
 *
 * 为什么有这个工具（甜品复刻会话实测教训）：生图模型（Krea2/Qwen）不吐 alpha，
 * 提示词写「透明背景」只会得到白底/纯色底；agent 只能手搓 Python 抠图 + 拼假透明
 * 拼贴，成片产品边缘一圈棋盘格残影。本工具用**内置 ffmpeg 的 colorkey 滤镜**把
 * 纯色底转成真 alpha —— 生图侧配合「纯白背景」提示词，就是一条完整的透明素材线。
 *
 * 设计口径：
 * - 纯函数 `buildMattingArgs` 构造 ffmpeg 参数（单测直连）；`runImageMatting` 可注入
 *   执行器（假 ffmpeg 替身，同 compose 测试先例）。
 * - key 色接受 `white / black / green / magenta` 与 `#RRGGBB` / `0xRRGGBB`；
 *   `similarity`（抠取宽度）与 `blend`（边缘羽化）都钳制在 0–1，与 colorkey 滤镜语义一致。
 * - 输出固定 PNG（alpha 只有 PNG/WEBP 承载；产物给 image 轨引用，PNG 通用性最好）。
 */
import { statSync } from 'node:fs'
import { throwError } from './error-system.js'
import { resolveFfmpegPath, runFfmpeg } from './ffmpeg-run.js'

/** ffmpeg 超时（与 audio-cut 同量级；单图抠图秒级完成，5 分钟是宽裕上限）。 */
export const MATTING_TIMEOUT_MS = 5 * 60 * 1000

/** 常用 key 色别名（绿幕/品红/黑白底）。 */
const NAMED_KEYS: Record<string, string> = {
  white: '0xFFFFFF',
  black: '0x000000',
  green: '0x00B140',
  magenta: '0xFF00FF',
}

/**
 * key 色归一化：`white` 等别名 / `#RRGGBB` / `0xRRGGBB` → colorkey 的 `0xRRGGBB`。
 * 非法返回 null（调用方报 CS-USER 错误）。三与六位 hex 都收。
 */
export function normalizeKeyColor(key: string): string | null {
  const named = NAMED_KEYS[key.trim().toLowerCase()]
  if (named !== undefined) return named
  const hex = /^(?:0x|#)?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(key.trim())
  const body = hex?.[1]
  if (body === undefined) return null
  const full = body.length === 3 ? [...body].map((c) => c + c).join('') : body
  return `0x${full.toUpperCase()}`
}

/** 钳制 0–1（NaN / 越界取缺省）。 */
export function clampUnit(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

export interface MattingOptions {
  srcPath: string
  destPath: string
  key: string
  similarity?: number | undefined
  blend?: number | undefined
}

/**
 * 构造 ffmpeg 参数：`colorkey=<key>:<similarity>:<blend>` 输出 PNG。
 * 纯字符串插值前 key 已归一化（只含 0x + hex），similarity/blend 已钳制数值 —— 无注入面。
 */
export function buildMattingArgs(o: MattingOptions): string[] {
  const key = normalizeKeyColor(o.key)
  if (key === null) throwError('CS-USER-ERR', { message: `非法 key 色值：${o.key}` })
  const similarity = clampUnit(o.similarity, 0.28)
  const blend = clampUnit(o.blend, 0.12)
  return [
    '-hide_banner', '-v', 'error', '-y',
    '-i', o.srcPath,
    '-vf', `colorkey=${key}:${similarity.toFixed(4)}:${blend.toFixed(4)}`,
    '-frames:v', '1',
    o.destPath,
  ]
}

export interface MattingResult {
  destPath: string
  bytes: number
  key: string
  similarity: number
  blend: number
}

type RunFn = typeof runFfmpeg

/**
 * 执行抠图：源文件存在性校验 → ffmpeg colorkey → 产物大小回读。
 * `run` 可注入（测试用假 ffmpeg）；缺省 `resolveFfmpegPath()` 解析内置 ffmpeg。
 */
export async function runImageMatting(
  o: MattingOptions,
  run: RunFn = (_path, args, timeout) => runFfmpeg(resolveFfmpegPath(), args, timeout),
): Promise<MattingResult> {
  let srcStat
  try {
    srcStat = statSync(o.srcPath)
  } catch {
    throwError('CS-USER-ERR', { message: `源图不存在或不可读：${o.srcPath}` })
  }
  if (!srcStat.isFile()) throwError('CS-USER-ERR', { message: `源路径不是文件：${o.srcPath}` })
  if (!/\.(png|jpe?g|webp)$/i.test(o.srcPath)) {
    throwError('CS-USER-ERR', { message: `源图格式不支持（只收 png / jpg / webp）：${o.srcPath}` })
  }
  const key = normalizeKeyColor(o.key)
  if (key === null) throwError('CS-USER-ERR', { message: `非法 key 色值：${o.key}（可用 white / black / green / magenta / #RRGGBB）` })
  const args = buildMattingArgs(o)
  await run(resolveFfmpegPath(), args, MATTING_TIMEOUT_MS)
  let destStat
  try {
    destStat = statSync(o.destPath)
  } catch {
    throwError('CS-USER-ERR', { message: `抠图产物未生成（ffmpeg 静默失败）：${o.destPath}` })
  }
  return {
    destPath: o.destPath,
    bytes: destStat.size,
    key,
    similarity: clampUnit(o.similarity, 0.28),
    blend: clampUnit(o.blend, 0.12),
  }
}

/** 产物默认落点：源文件同目录 `<stem>-alpha.png`（后缀替换，目录天然不变）。 */
export function alphaDestPath(srcPath: string): string {
  return srcPath.replace(/\.(png|jpe?g|webp)$/i, '') + '-alpha.png'
}
