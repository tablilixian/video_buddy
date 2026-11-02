/**
 * 复刻提效批二：`image_crop` —— 从整图 / 拼贴图裁出子图，落为项目资产。
 *
 * ## 为什么有这个工具
 *
 * 2026-11-02 甜品复刻真机会话实测：素材是一张 1280×480 的**六格拼贴**，而下游
 * （生图参考 / 抠图 / 上传 / render 轨引用）每一条都要**独立素材**。当时没有任何
 * 裁切工具，结果 agent 自己写了 **52 次 PIL/numpy 像素脚本**（占全会话模型时间的
 * 28.2%），末端还用 `shutil.copy` 手搓 uuid 把文件塞进 assets —— 没有节点、没有
 * 血缘、`asset-gc` 看不见它。`REQ-036` 的 R-3 原话是「精灵图/拼贴可由 Agent 预裁切」，
 * 这句假设的实现方式就是「让模型写脚本」，本工具把这件事收回平台。
 *
 * ## 设计口径
 *
 * 1. **两种定位，不猜**：`grid`（rows×cols 均分，row/col 从 1 起）给拼贴/精灵图；
 *    `rect`（像素，x/y 是**左上角**）给自由裁切。二者必须给一个、且只给一个。
 *    ⚠️ 与 `inspect_image` 的 `region` **不是同一套坐标**：那边是画布百分比中心语义
 *    （为了把结果直接填进 render 轨 transform），这边是图片像素左上角语义（因为
 *    裁出来的是物理像素，百分比还要再换算、还要摊取整误差）。
 * 2. **必须能自证**：产物返回尺寸 / 四边平均色 / 主色 top3 / 8×4 亮度字符图。
 *    模型看不见图，裁歪了（rect 算错、行列数错）唯一能发现的方式就是这些数字；
 *    没有自证它只会一路带着错素材跑下去。
 * 3. **越界报错而不是静默 clamp**：ffmpeg 的 crop 会把超界矩形自动收进画面，产物
 *    看起来「成功」但内容是错的。这里先拿源图尺寸严格校验，报错里带源尺寸与
 *    当前 x 下的最大可用 w —— 模型一次就能改对。
 * 4. **落资产走唯一入口** `saveLocalAssetBytes`（资产历史 + 历史保护名单），
 *    不手搓文件名（手搓 = GC 看不见 + 血缘断）。中间文件落在 assets 目录下的
 *    `crop-tmp-*` 并由 `finally` 删除。
 */
import { mkdir, readFile, rm } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { throwError } from './error-system.js'
import { probeMediaInfo, resolveFfmpegPath, runFfmpeg } from './ffmpeg-run.js'
import { decodePng, type DecodedPng } from './inspect-image.js'
import { isAssetFileName, resolveAssetPathIn } from './asset-path.js'
import type { ProjectRegistry } from './projects.js'

/** 单图裁切超时（与 image_matting 同量级；裁一张图是秒级，5 分钟是宽裕上限）。 */
export const CROP_TIMEOUT_MS = 5 * 60 * 1000

/** 像素矩形：`x`/`y` 是左上角，`w`/`h` 是宽高（均为整数像素）。 */
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

/** 网格定位：`rows`×`cols` 均分整图，`row`/`col` 从 **1** 起。 */
export interface CropGrid {
  rows: number
  cols: number
  row: number
  col: number
}

/** 网格上限（超过这个数多半是把「格子数」误填成像素了）。 */
const MAX_GRID_SIDE = 24

/** 取整并对非法数值报错（NaN / Infinity / 负数在模型手写坐标时都会出现）。 */
function intOrThrow(value: unknown, label: string, min: number): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) {
    throwError('CS-USER-ERR', { message: `${label} 必须是数字，收到：${String(value)}` })
  }
  const rounded = Math.round(num)
  if (rounded < min) {
    throwError('CS-USER-ERR', { message: `${label} 必须 ≥ ${min}，收到：${rounded}` })
  }
  return rounded
}

/**
 * 网格 → 像素矩形。
 *
 * 均分取整的余数**归最后一格**（`cellW = floor(w/cols)`，最后一列宽 = 剩余全宽）：
 * 这样多格拼起来能无缝覆盖整图，不会在最右侧/最下侧留下 1–2px 缝隙（拼贴图常是
 * 奇数宽，例如 1280 分 3 列 = 426.67）。
 */
export function gridToRect(grid: CropGrid, width: number, height: number): CropRect {
  const rows = intOrThrow(grid.rows, 'grid.rows', 1)
  const cols = intOrThrow(grid.cols, 'grid.cols', 1)
  const row = intOrThrow(grid.row, 'grid.row', 1)
  const col = intOrThrow(grid.col, 'grid.col', 1)
  if (rows > MAX_GRID_SIDE || cols > MAX_GRID_SIDE) {
    throwError('CS-USER-ERR', {
      message: `grid.rows / grid.cols 上限 ${MAX_GRID_SIDE}，收到 ${rows}×${cols}；拼贴图通常只有 2–9 格`,
    })
  }
  if (row > rows) throwError('CS-USER-ERR', { message: `grid.row 超出范围：rows=${rows}，row 只能是 1..${rows}，收到 ${row}` })
  if (col > cols) throwError('CS-USER-ERR', { message: `grid.col 超出范围：cols=${cols}，col 只能是 1..${cols}，收到 ${col}` })
  const cellW = Math.floor(width / cols)
  const cellH = Math.floor(height / rows)
  const x = (col - 1) * cellW
  const y = (row - 1) * cellH
  const w = col === cols ? width - x : cellW
  const h = row === rows ? height - y : cellH
  return { x, y, w, h }
}

/**
 * 严格校验矩形在源图内（**不做静默 clamp**）。
 *
 * 越界时的报错要能直接指导修正：带上源图尺寸、当前 x/y 下的最大可用宽高。
 */
export function rectWithin(rect: CropRect, width: number, height: number): CropRect {
  const w = intOrThrow(rect.w, 'rect.w', 1)
  const h = intOrThrow(rect.h, 'rect.h', 1)
  const x = intOrThrow(rect.x, 'rect.x', 0)
  const y = intOrThrow(rect.y, 'rect.y', 0)
  if (x >= width || y >= height) {
    throwError('CS-USER-ERR', {
      message: `裁切起点在图外：源图 ${width}×${height}，收到 x=${x} y=${y}（x 必须 < ${width}，y 必须 < ${height}；rect 的 x/y 是**左上角**像素，不是中心）`,
    })
  }
  if (x + w > width || y + h > height) {
    throwError('CS-USER-ERR', {
      message: `裁切范围超出源图：源图 ${width}×${height}，收到 x=${x} y=${y} w=${w} h=${h}；`
        + `在 x=${x} 处最大 w=${width - x}，在 y=${y} 处最大 h=${height - y}`,
    })
  }
  return { x, y, w, h }
}

/** 构造 ffmpeg 参数：`crop=w:h:x:y` 输出单帧 RGBA PNG（保留源 alpha）。 */
export function buildCropArgs(srcPath: string, destPath: string, rect: CropRect): string[] {
  return [
    '-hide_banner', '-v', 'error', '-y',
    '-i', srcPath,
    '-vf', `crop=${rect.w}:${rect.h}:${rect.x}:${rect.y}`,
    '-frames:v', '1',
    '-pix_fmt', 'rgba',
    destPath,
  ]
}

/**
 * 把源图解析成可读的绝对路径。
 *
 * 两条合法形态（与 `readSourceBytes` 的白名单同口径，避免 agent 参数诱导 Host
 * 裁任意系统文件并落进项目资产）：
 * 1. canvas-studio 资产 URL `/canvas-studio/assets/<projectId>/<file>` —— 跨项目一律拒；
 * 2. 项目资产库内的绝对路径（`registry.registryRoot` 之下）。
 */
export function resolveCropSource(source: string, registry: ProjectRegistry, projectId: string): string {
  const raw = source.trim()
  if (raw === '') throwError('CS-USER-ERR', { message: 'source 不能为空：传源图绝对路径或画布资产 URL' })
  const asset = /\/canvas-studio\/assets\/([^/]+)\/([^/?#]+)(?:\?[^#]*)?$/u.exec(raw)
  if (asset !== null) {
    const assetProject = asset[1]!
    const file = decodeURIComponent(asset[2]!)
    if (assetProject !== projectId) {
      throwError('CS-USER-ERR', {
        message: `资产 URL 属于其它项目（${assetProject}），当前项目是 ${projectId}；跨项目请先导入本项目（上传或素材库）`,
        detail: `cross-project crop source: ${assetProject} != ${projectId}`,
      })
    }
    if (!isAssetFileName(file)) {
      throwError('CS-USER-ERR', { message: `资产文件名不合法：${file}` })
    }
    return resolveAssetPathIn(registry.assetsDir(projectId), file)
  }
  if (!isAbsolute(raw)) {
    throwError('CS-USER-ERR', {
      message: `source 既不是绝对路径也不是画布资产 URL：${raw}；请在项目 assets 目录内给绝对路径，或直接用画布资产 URL（/canvas-studio/assets/...）`,
    })
  }
  const localPath = resolve(raw)
  const root = resolve(registry.registryRoot)
  if (!(localPath === root || localPath.startsWith(root + sep))) {
    throwError('CS-USER-ERR', {
      message: `拒绝读取项目目录之外的文件：${localPath}；只允许本项目资产目录内的素材（先把素材放进项目再裁）`,
      detail: 'crop source outside registryRoot',
    })
  }
  return localPath
}

/** 自证用摘要：模型看不见图，只能靠这些数字判断「裁对了没有」。 */
export interface CropProvenance {
  width: number
  height: number
  /** 四边平均色（hex，`#RRGGBB`）。白底拼贴的四边应接近 #FFFFFF。 */
  edges: { top: string; bottom: string; left: string; right: string }
  /** 全透明像素占比（%，0 = 完全不透明）。 */
  alphaPct: number
  /** 主色 top3（hex + 占比%）。 */
  topColors: string[]
  /** 8 列 × 4 行亮度字符图（字符越靠后越亮），供模型「看」构图。 */
  luminanceRows: string[]
}

/** 亮度字符梯：从暗（空格）到亮（@），共 10 档。 */
const LUMINANCE_RAMP = ' .:-=+*#%@'

function hexOf(r: number, g: number, b: number): string {
  const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)))
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`
}

/** 取一块矩形区域的平均色（越界自动收进图内）。 */
function averageColor(decoded: DecodedPng, x0: number, y0: number, x1: number, y1: number): { r: number; g: number; b: number } {
  const left = Math.max(0, Math.min(decoded.width - 1, Math.floor(x0)))
  const right = Math.max(left, Math.min(decoded.width - 1, Math.floor(x1)))
  const top = Math.max(0, Math.min(decoded.height - 1, Math.floor(y0)))
  const bottom = Math.max(top, Math.min(decoded.height - 1, Math.floor(y1)))
  let r = 0
  let g = 0
  let b = 0
  let count = 0
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const at = (y * decoded.width + x) * 4
      r += decoded.rgba[at] ?? 0
      g += decoded.rgba[at + 1] ?? 0
      b += decoded.rgba[at + 2] ?? 0
      count += 1
    }
  }
  if (count === 0) return { r: 0, g: 0, b: 0 }
  return { r: r / count, g: g / count, b: b / count }
}

/**
 * 从裁剪产物算自证摘要。纯函数（解好的 PNG 进，数字出），单测直连。
 *
 * 亮度图取每格**平均亮度**（不是采样点）：平均对「这一格整体是什么」更稳，
 * 单点采样会被一个深色物体骗成「整格都暗」。
 */
export function summarizeCrop(decoded: DecodedPng): CropProvenance {
  const { width, height, rgba } = decoded
  const band = Math.max(1, Math.round(Math.min(width, height) * 0.06))
  const topBand = averageColor(decoded, 0, 0, width - 1, band)
  const bottomBand = averageColor(decoded, 0, height - 1 - band, width - 1, height - 1)
  const leftBand = averageColor(decoded, 0, 0, band, height - 1)
  const rightBand = averageColor(decoded, width - 1 - band, 0, width - 1, height - 1)
  const edges = {
    top: hexOf(topBand.r, topBand.g, topBand.b),
    bottom: hexOf(bottomBand.r, bottomBand.g, bottomBand.b),
    left: hexOf(leftBand.r, leftBand.g, leftBand.b),
    right: hexOf(rightBand.r, rightBand.g, rightBand.b),
  }
  // 透明率 + 主色直方图（每通道 32 级量化分桶，但**报告桶内实际均值** ——
  // 直接报桶下界会把纯白说成 #f8f8f8，模型据此判断「底色偏灰」就歪了）。
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  let transparent = 0
  for (let i = 0; i < rgba.length; i += 4) {
    if ((rgba[i + 3] ?? 255) < 16) {
      transparent += 1
      continue
    }
    const r = rgba[i] ?? 0
    const g = rgba[i + 1] ?? 0
    const b = rgba[i + 2] ?? 0
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, { n: 1, r, g, b })
    else {
      bucket.n += 1
      bucket.r += r
      bucket.g += g
      bucket.b += b
    }
  }
  const total = width * height
  const alphaPct = total === 0 ? 0 : (transparent / total) * 100
  const topColors = [...buckets.values()]
    .sort((left, right) => right.n - left.n)
    .slice(0, 3)
    .map((bucket) => `${hexOf(bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n)}(${((bucket.n / Math.max(1, total - transparent)) * 100).toFixed(0)}%)`)
  // 8 列 × 4 行亮度字符图。
  const cols = 8
  const rows = 4
  const luminanceRows: string[] = []
  for (let ry = 0; ry < rows; ry += 1) {
    let line = ''
    for (let rx = 0; rx < cols; rx += 1) {
      const avg = averageColor(
        decoded,
        (rx * width) / cols, (ry * height) / rows,
        ((rx + 1) * width) / cols - 1, ((ry + 1) * height) / rows - 1,
      )
      const lum = (avg.r * 0.299 + avg.g * 0.587 + avg.b * 0.114) / 255
      line += LUMINANCE_RAMP[Math.min(LUMINANCE_RAMP.length - 1, Math.round(lum * (LUMINANCE_RAMP.length - 1)))]
    }
    luminanceRows.push(line)
  }
  return { width, height, edges, alphaPct, topColors, luminanceRows }
}

export interface CropOutcome {
  rect: CropRect
  sourceWidth: number
  sourceHeight: number
  provenance: CropProvenance
}

/**
 * 裁切主流程：解析源 → 探源尺寸 → 定位（grid / rect）→ 严格校验 → ffmpeg 出图 →
 * 解 PNG 自证。**产物落盘与资产登记由调用方（工具层）负责**，本函数只产出字节。
 *
 * @param readBytes 读中间文件的函数（默认 `readFile`，测试可换成假实现）
 */
export async function runImageCrop(
  o: {
    srcPath: string
    grid?: CropGrid | undefined
    rect?: CropRect | undefined
    scratchPath: string
    signal?: AbortSignal | undefined
  },
  deps: {
    run?: typeof runFfmpeg
    probe?: typeof probeMediaInfo
    readBytes?: (path: string) => Promise<Uint8Array>
  } = {},
): Promise<{ bytes: Uint8Array; outcome: CropOutcome }> {
  const run = deps.run ?? ((path, args, timeout, signal) => runFfmpeg(path, args, timeout, signal))
  const probe = deps.probe ?? probeMediaInfo
  const readBytes = deps.readBytes ?? (async (path: string) => readFile(path))

  const info = await probe(o.srcPath, undefined, o.signal)
  const sourceWidth = info.width ?? 0
  const sourceHeight = info.height ?? 0
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throwError('CS-USER-ERR', {
      message: `读不到源图尺寸（ffmpeg 探测失败）：${o.srcPath}；确认它是图片文件且未损坏`,
      detail: 'probeMediaInfo returned no width/height',
    })
  }
  const hasGrid = o.grid !== undefined
  const hasRect = o.rect !== undefined
  if (hasGrid === hasRect) {
    throwError('CS-USER-ERR', {
      message: `grid 与 rect 必须给且只给一个：拼贴图用 grid（rows/cols/row/col，从 1 起），自由裁切用 rect（x/y 是左上角像素 + w/h）`,
    })
  }
  const rect = hasGrid
    ? gridToRect(o.grid!, sourceWidth, sourceHeight)
    : rectWithin(o.rect!, sourceWidth, sourceHeight)

  const ffmpegPath = resolveFfmpegPath()
  try {
    await run(ffmpegPath, buildCropArgs(o.srcPath, o.scratchPath, rect), CROP_TIMEOUT_MS, o.signal)
  } catch (error) {
    throwError('CS-USER-ERR', {
      message: `裁切失败（ffmpeg）：${error instanceof Error ? error.message : String(error)}`,
      detail: 'image_crop ffmpeg run failed',
    })
  }
  const bytes = await readBytes(o.scratchPath)
  if (bytes.length === 0) {
    throwError('CS-USER-ERR', { message: `裁切产物为空（ffmpeg 静默失败）：${o.scratchPath}` })
  }
  let provenance: CropProvenance
  try {
    provenance = summarizeCrop(decodePng(bytes))
  } catch {
    // 产物解不出来（理论上 ffmpeg 出的一定是 PNG）⇒ 自证降级为「只有尺寸」，
    // 不因为自证失败把整个裁切判死。
    provenance = {
      width: rect.w, height: rect.h,
      edges: { top: 'n/a', bottom: 'n/a', left: 'n/a', right: 'n/a' },
      alphaPct: 0, topColors: [], luminanceRows: [],
    }
  }
  return { bytes, outcome: { rect, sourceWidth, sourceHeight, provenance } }
}

/** 中间文件落点：项目 assets 目录下的 `crop-tmp-<id>.png`（调用方 finally 删）。 */
export function cropScratchPath(assetsDir: string, id: string): string {
  return join(assetsDir, `crop-tmp-${id}.png`)
}

/** 删中间文件（尽力而为，失败不影响主流程）。 */
export async function discardScratch(path: string): Promise<void> {
  await rm(path, { force: true }).catch(() => {})
}

/** 确保资产目录存在（`saveLocalAssetBytes` 自己会 mkdir，这里给中间文件用）。 */
export async function ensureAssetsDir(assetsDir: string): Promise<void> {
  await mkdir(assetsDir, { recursive: true })
}
