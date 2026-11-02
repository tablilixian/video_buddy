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
import { readFileSync, statSync } from 'node:fs'
import { throwError } from './error-system.js'
import { resolveFfmpegPath, runFfmpeg } from './ffmpeg-run.js'
import { decodePng } from './inspect-image.js'

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

/**
 * 抠图产物的**数值自检**（2026-11-02 复刻真机复盘新增）。
 *
 * ## 为什么必须要这一层
 *
 * 上一版把质量自查写成「把产物叠在深色卡上**目视**边缘」—— 而本项目的创作模型
 * （deepseek-flash）**没有图像输入**，读图会直接报 `model does not declare image
 * input`。于是那句指引永远无法执行，模型只能拿着「抠图完成」四个字往下走。
 * 甜品复刻会话的实际后果：它用「四角 alpha=255 ⇒ 白底没被 key 掉」判本工具失败，
 * 弃用产物改用自写 alpha 蒙版 —— 而那几张产品图是**圆角白卡**，圆角外侧本来就该
 * 不透明，判据本身是错的。等于 CV-394 这条验收从来没真正做过。
 *
 * ## 判据（都只看数字，不看图）
 *
 * - `alphaPct` —— 全透明像素占比。接近 0 = 底色没被 key 掉（key 色或 similarity 不对）；
 *   接近 100 = 整张被吃掉（产品被误伤，similarity 太高）。
 * - `keyResiduePct` —— **不透明像素里**仍与 key 色接近的比例 = 残留底色。这是「抠干净
 *   没有」的正解；四角 alpha 不是（圆角卡的角本来就不透明）。
 * - `corners` —— 四角 alpha，只作为**辅助线索**：全 255 且 keyResidue 高 ⇒ 底也没抠；
 *   全 0 ⇒ 透明区太大。
 * - `colorType` —— 6 = RGBA，确实带 alpha 通道。
 */
export interface MattingAudit {
  width: number
  height: number
  /** PNG colorType（6 = RGBA）。 */
  colorType: number
  /** 全透明像素占比（%）。 */
  alphaPct: number
  /** 不透明像素里与 key 色接近的比例（%）= 残留底色。 */
  keyResiduePct: number
  /** 四角 alpha（左上、右上、左下、右下）。 */
  corners: [number, number, number, number]
}

/** 与 key 色的容差（每通道）：低于这个差就认为是「同一种底色」。 */
const KEY_RESIDUE_TOLERANCE = 28

/**
 * key 色 → [r,g,b]。**必须走 `normalizeKeyColor`**（别名 white/green 也是合法入参，
 * 只认 `#RRGGBB` 会让「残留底色」永远算成 0 —— 自检就成了永远通过的摆设）。
 */
function rgbOfKey(key: string): [number, number, number] | null {
  const normalized = normalizeKeyColor(key)
  if (normalized === null) return null
  const body = normalized.replace(/^0x/u, '')
  return [parseInt(body.slice(0, 2), 16), parseInt(body.slice(2, 4), 16), parseInt(body.slice(4, 6), 16)]
}

/**
 * 审计一张抠图产物。**绝不抛错**：解不开（非 PNG / 数据损坏）返回 `null`，
 * 由调用方把「自检不可用」如实写进结果，而不是让抠图主流程失败。
 */
export function auditMattingPng(bytes: Uint8Array, key: string): MattingAudit | null {
  try {
    const decoded = decodePng(bytes)
    const keyRgb = rgbOfKey(key)
    const { width, height, rgba } = decoded
    const total = width * height
    if (total === 0) return null
    let transparent = 0
    let opaque = 0
    let residue = 0
    for (let i = 0; i < rgba.length; i += 4) {
      const alpha = rgba[i + 3] ?? 255
      if (alpha < 16) {
        transparent += 1
        continue
      }
      opaque += 1
      if (keyRgb === null) continue
      const dr = Math.abs((rgba[i] ?? 0) - keyRgb[0])
      const dg = Math.abs((rgba[i + 1] ?? 0) - keyRgb[1])
      const db = Math.abs((rgba[i + 2] ?? 0) - keyRgb[2])
      if (dr <= KEY_RESIDUE_TOLERANCE && dg <= KEY_RESIDUE_TOLERANCE && db <= KEY_RESIDUE_TOLERANCE) {
        residue += 1
      }
    }
    const cornerAt = (x: number, y: number): number => rgba[(y * width + x) * 4 + 3] ?? 255
    return {
      width,
      height,
      colorType: decoded.colorType,
      alphaPct: (transparent / total) * 100,
      keyResiduePct: opaque === 0 ? 0 : (residue / opaque) * 100,
      corners: [cornerAt(0, 0), cornerAt(width - 1, 0), cornerAt(0, height - 1), cornerAt(width - 1, height - 1)],
    }
  } catch {
    return null
  }
}

/**
 * 审计磁盘上的抠图产物（`auditMattingPng` 的读盘薄封装）。
 * 读盘失败 / 非 PNG 一律返回 `null`，不抛。
 */
export function auditMattingFile(destPath: string, key: string): MattingAudit | null {
  try {
    return auditMattingPng(readFileSync(destPath), key)
  } catch {
    return null
  }
}

/**
 * 把审计结果翻译成「通过 / 可疑 + 该怎么调」的一句话结论。
 *
 * 判据只有三条，且都能给出**可执行的下一步**（不提「目视」—— 模型看不见图）。
 */
export function auditVerdict(audit: MattingAudit): { ok: boolean; note: string } {
  if (audit.alphaPct < 2) {
    return {
      ok: false,
      note: `底色基本没被抠掉（透明率 ${audit.alphaPct.toFixed(1)}%）⇒ key 色选错或 similarity 太小；确认底色确实是 white/black/green，或把 similarity 提到 0.35–0.5 重抠`,
    }
  }
  if (audit.alphaPct > 96) {
    return {
      ok: false,
      note: `几乎整张都被抠掉了（透明率 ${audit.alphaPct.toFixed(1)}%）⇒ 主体与底色太接近，similarity 调小（0.12–0.2）重抠，或改用外部工具处理`,
    }
  }
  if (audit.keyResiduePct > 8) {
    return {
      ok: false,
      note: `不透明区还残留 ${audit.keyResiduePct.toFixed(1)}% 的底色（四角 alpha ${audit.corners.join('/')}）⇒ 提高 similarity（0.35–0.5）或加大 blend 重抠`,
    }
  }
  return {
    ok: true,
    note: `抠图干净：透明率 ${audit.alphaPct.toFixed(1)}%、不透明区残留底色 ${audit.keyResiduePct.toFixed(1)}%（阈值 8%）`,
  }
}

/** 产物默认落点：源文件同目录 `<stem>-alpha.png`（后缀替换，目录天然不变）。 */
export function alphaDestPath(srcPath: string): string {
  return srcPath.replace(/\.(png|jpe?g|webp)$/i, '') + '-alpha.png'
}
