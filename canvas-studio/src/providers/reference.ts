/**
 * 参考图素材读取（阶段 2 抽出；阶段 5 供 fal 多参考复用）。
 *
 * 从「把本地资产重传到 Drama」的逻辑里拆出纯读字节部分，使 Drama / fal 适配器
 * 都能复用，而不必各自实现磁盘读取；fal 侧再经 `toFalDataUri()` 编码后内联。
 */
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ProjectRegistry } from '../projects.js'
import { FFMPEG_TIMEOUT_MS, resolveFfmpegPath, runFfmpeg } from '../ffmpeg-run.js'

/** 读取项目资产目录下的一个文件，返回字节与扩展名（去点、小写，缺省 png）。 */
export async function readLocalAssetBytes(
  registry: ProjectRegistry,
  projectId: string,
  file: string,
): Promise<{ bytes: Uint8Array; ext: string }> {
  const localPath = join(registry.assetsDir(projectId), file)
  if (!existsSync(localPath)) throw new Error(`本地资产不存在: ${file}`)
  const buffer = await readFile(localPath)
  const ext = extname(file).replace(/^\./, '') || 'png'
  return { bytes: new Uint8Array(buffer), ext }
}

/** 扩展名 → data URI 的 MIME。白名单外的类型按 image/png 处理（Drama 上传侧同样宽松）。 */
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

/** fal 参考图的目标长边（像素）：降采样到 1024 后单张通常在 150KB 量级。 */
const FAL_MAX_EDGE = 1024
/** JPEG 输出质量（ffmpeg -q:v，2–31，越小越好）。 */
const FAL_JPEG_QV = 5
/**
 * 单张参考图编码后的上限（字节）。超限直接抛错——让 fal 甩一个 413 回来远不如
 * 本地说清楚原因（方案 §5.5 逃生阀）。
 */
export const FAL_MAX_SINGLE_REFERENCE_BYTES = 2 * 1024 * 1024
/** 全部参考图编码后的合计上限（字节）。 */
export const FAL_MAX_TOTAL_REFERENCE_BYTES = 12 * 1024 * 1024

/** 编码选项：显式 ffmpeg 路径（测试替身）与取消信号。 */
export interface FalDataUriOptions {
  readonly ffmpegPath?: string
  readonly signal?: AbortSignal
}

/**
 * 用 ffmpeg 把参考图压成「长边 ≤1024 的 JPEG」，返回字节；失败返回 undefined。
 *
 * 用 `scale=w:h:force_original_aspect_ratio=decrease` 一处表达「长边受限且保持
 * 比例」，避免 `if(gt(a,1)…)` 那种需要转义逗号的写法（横竖屏都正确）。
 */
async function downsampleWithFfmpeg(
  asset: { bytes: Uint8Array; ext: string },
  options: FalDataUriOptions,
): Promise<Uint8Array | undefined> {
  let tempDir: string | undefined
  try {
    const ffmpeg = resolveFfmpegPath(options.ffmpegPath)
    tempDir = await mkdtemp(join(tmpdir(), 'cs-fal-ref-'))
    const inputPath = join(tempDir, `in.${asset.ext || 'png'}`)
    const outputPath = join(tempDir, 'out.jpg')
    await writeFile(inputPath, asset.bytes)
    const result = await runFfmpeg(
      ffmpeg,
      [
        '-y',
        '-i',
        inputPath,
        '-vf',
        `scale=${FAL_MAX_EDGE}:${FAL_MAX_EDGE}:force_original_aspect_ratio=decrease`,
        '-q:v',
        String(FAL_JPEG_QV),
        outputPath,
      ],
      FFMPEG_TIMEOUT_MS,
      options.signal,
    )
    if (result.code !== 0 || !existsSync(outputPath)) return undefined
    return new Uint8Array(await readFile(outputPath))
  } catch {
    // ffmpeg 不可用 / 解码失败 / 被取消：回退原始字节（体积校验交给逃生阀）。
    return undefined
  } finally {
    if (tempDir !== undefined) await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * 把参考图编码为 fal 可接受的 base64 data URI（阶段 5：含 ffmpeg 降采样）。
 *
 * fal 不认 Drama 的服务器 filename 句柄，图片参考必须是公网 URL 或 data URI；
 * 本地画布产物没有公网 URL，故统一内联。默认先经 ffmpeg 压成 JPEG（长边 ≤1024），
 * 失败则回退原字节——宁可多传一点，也不要因为本机没装 ffmpeg 而阻断生成。
 */
export async function toFalDataUri(
  asset: { bytes: Uint8Array; ext: string },
  options: FalDataUriOptions = {},
): Promise<string> {
  const downsampled = await downsampleWithFfmpeg(asset, options)
  if (downsampled !== undefined) {
    return `data:image/jpeg;base64,${Buffer.from(downsampled).toString('base64')}`
  }
  const mime = MIME_BY_EXT[asset.ext] ?? 'image/png'
  return `data:${mime};base64,${Buffer.from(asset.bytes).toString('base64')}`
}

/** data URI 的载荷字节数（不含 `data:…;base64,` 前缀）。 */
function payloadBytesOf(dataUri: string): number {
  const comma = dataUri.indexOf(',')
  return Buffer.byteLength(comma < 0 ? dataUri : dataUri.slice(comma + 1))
}

/**
 * 逃生阀：编码后的参考图超过单张 / 合计上限时抛中文错误，而不是等着 fal 回 413。
 */
export function assertFalReferenceSizes(dataUris: readonly string[]): void {
  let total = 0
  for (const [index, uri] of dataUris.entries()) {
    const size = payloadBytesOf(uri)
    total += size
    if (size > FAL_MAX_SINGLE_REFERENCE_BYTES) {
      const mb = (size / (1024 * 1024)).toFixed(1)
      throw new Error(
        `参考图 ${index + 1} 编码后 ${mb}MB，超过 fal 单张上限 `
        + `${FAL_MAX_SINGLE_REFERENCE_BYTES / (1024 * 1024)}MB。请改用更小的参考图，`
        + '或先上传到公网（fal storage）后改用 URL 方式接入。',
      )
    }
  }
  if (total > FAL_MAX_TOTAL_REFERENCE_BYTES) {
    const mb = (total / (1024 * 1024)).toFixed(1)
    throw new Error(
      `参考图合计 ${mb}MB，超过 fal 单次请求上限 `
      + `${FAL_MAX_TOTAL_REFERENCE_BYTES / (1024 * 1024)}MB。请减少参考图数量或改用更小的图。`,
    )
  }
}
