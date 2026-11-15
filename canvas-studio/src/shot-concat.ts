/**
 * RQ-038 · R11-C4（分镜渲染架构 Phase 1）· **段拼接器**（ffmpeg concat）。
 *
 * ## 解决什么
 *
 * 分段渲染的产物是 N 段无声 mp4（C3 frameRange 渲染），本模块用**随包 ffmpeg**
 * （CV-201，`ffmpeg-run.ts` 的 runFfmpeg）按段序拼接成整片，供既有链路
 * （validateManifest / 画布节点 / deliver/card.json）消费——下游对「整片渲」还是
 * 「分段拼」无感知。
 *
 * ## 口径
 *
 * - concat demuxer（`-f concat -safe 0 -i list.txt -c copy`）：**不重编码**——段与段
 *   的编码参数一致（同一 manifest、同一质量档、同一渲染器），copy 拼接零损失；
 * - 段清单文件写入临时文件（concat demuxer 要求 file 指令），绝对路径 + 单引号转义；
 * - 失败**抛错**（拼接是交付路径的必要环节，静默降级 = 交付残片——与缓存/锚点的
 *   「辅助设施」不同，这里不能 fail-soft；错误码 CS-SHOT-001~003）。
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveFfmpegPath, runFfmpeg, FFMPEG_TIMEOUT_MS } from './ffmpeg-run.js'
import { throwError } from './error-system.js'

export interface ShotConcatInput {
  /** 按段序排列的段视频绝对路径（缓存命中 + 新渲混合，序 = 段序）。 */
  segmentFiles: readonly string[]
  /** 拼接输出的绝对路径（assetsDir 内的目标文件）。 */
  outputPath: string
  signal?: AbortSignal
}

/**
 * 按段序拼接。返回输出路径。段清单非空由调用方保证（C5 只在有 ≥2 段时调用）。
 * 抛错语义：ffmpeg 非 0 退出 / 超时 / 中断 —— 调用方（C5）把异常收敛进回执。
 */
export async function concatShots(input: ShotConcatInput): Promise<string> {
  if (input.segmentFiles.length === 0) {
    throwError('CS-SHOT-001')
  }
  if (input.segmentFiles.length === 1) {
    // 单段无需拼接：调用方不应走到这里，但守一下（copy 语义由调用方处理）
    throwError('CS-SHOT-002')
  }
  const ffmpegPath = resolveFfmpegPath()
  // concat demuxer 的 file 指令要求单引号转义（路径含空格/中文——真机项目名就是中文）
  const listBody = input.segmentFiles
    .map((file) => `file '${file.replace(/'/g, `'\\''`)}'`)
    .join('\n')
  const listDir = mkdtempSync(join(tmpdir(), 'r11-concat-'))
  const listFile = join(listDir, 'list.txt')
  writeFileSync(listFile, listBody, 'utf8')
  const result = await runFfmpeg(
    ffmpegPath,
    [
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      '-movflags', '+faststart',
      '-y',
      input.outputPath,
    ],
    FFMPEG_TIMEOUT_MS,
    input.signal,
  )
  if (result.code !== 0) {
    // 诊断正文由抛出点组装进 {message}（CS-RENDER-002 同款拼法）；stderr 尾部可能含
    // 绝对路径，走运行时参数而非 catalog 字面量（脱敏闸只查模板本身）。
    throwError('CS-SHOT-003', {
      message: `shot-concat: ffmpeg 拼接失败（exit ${String(result.code)}）：${result.stderr.slice(-400)}`,
      detail: result.stderr.slice(-400),
    })
  }
  return input.outputPath
}
