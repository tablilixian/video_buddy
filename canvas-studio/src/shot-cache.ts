/**
 * RQ-038 · R11-C2（分镜渲染架构 Phase 1）· **段内容 hash + 磁盘缓存**。
 *
 * ## 解决什么
 *
 * 增量渲染的核心问题：「哪个分镜变了」。本模块给每个段算**内容 hash**
 * （sha256(段轨 JSON + 渲染参数)），与 `<projectDir>/build/shot-cache/` 里的缓存
 * 条目比对——未变的段直接复用缓存 mp4，只有脏段进渲染队列。
 *
 * ## 口径
 *
 * - hash 输入 = 段活跃轨全量 JSON（含帧号）+ 段窗 + 渲染质量 + **manifest 全局态
 *   指纹**（2026-11-16 review P1-2 补：此前只含前三者，改 `meta.look` 全片调色 /
 *   `global.fonts` 这类不动任何轨道的全局输入时 hash 不变 ⇒ 缓存命中旧段，新样式
 *   永远进不了成片）——**改 s2 的 copy 只脏 s2**；carry/bg 变了全段脏（它们在每个
 *   段的活跃集里）；任何全局态变了全段脏（保守且正确）；
 * - 缓存条目 = `<hash>.mp4` + `<hash>.json`（段元数据：窗/轨数/全局态指纹/写入时间）；
 * - `clearStaleEntries` 只删「本次合法 hash 集合之外」的条目（孤儿回收），
 *   失败不抛（缓存是优化，坏了退化为全量重渲）。
 *
 * 纪律：文件操作集中在 mkdir/read/write/copy/unlink，**任何失败都返回失败标记
 * 而不抛**（铁律：缓存是优化，坏了退化为全量重渲）。
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CompositionManifest, RenderQuality } from './remotion/manifest.js'
import { resolveShotBoundaries, sliceByShots, type ShotSegment } from './shot-slice.js'

export interface ShotCacheEntry {
  /** 段 hash（缓存文件名主体）。 */
  hash: string
  /** 缓存 mp4 绝对路径。 */
  videoPath: string
}

export interface ShotCachePlan {
  /** 全部命中的段（直接复用缓存 mp4）。 */
  reused: Array<{ segment: ShotSegment; entry: ShotCacheEntry }>
  /** 需要渲染的脏段。 */
  dirty: ShotSegment[]
}

const CACHE_DIR_NAME = join('build', 'shot-cache')

export function shotCacheDir(projectDir: string): string {
  return join(projectDir, CACHE_DIR_NAME)
}

/**
 * canonical JSON：对象键**递归排序**后序列化。同一份语义数据的不同键序
 * （模型重写 manifest 时字段顺序变了）必须算出同一指纹，否则缓存会因键序
 * 抖动而永久未命中。数组保持顺序（轨道顺序本身是渲染语义）；`undefined`
 * 值剔除（JSON 语义下等价于字段不存在）。
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, val]) => val !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(',')}}`
}

/**
 * manifest **全局态指纹**（P1-2，2026-11-16 review）：影响渲染输出、但不属于
 * 任何单条轨道的全部输入。指纹进段 hash——全局态一变，全段脏（保守且正确）。
 *
 * - **进**：`meta` 全量（width/height/fps/backgroundColor/`look` 全片调色/
 *   durationInFrames…）与 `global` 全量（fontFamily/fonts/theme/brandColor/logo）。
 * - **不进**：`tracks`（段活跃集已含）、`audio`（分镜路线只在无 audio 时启用，
 *   见 `planShotRender` 的 allowShots）、顶层 `id`（模型每次生成可能换新 id，
 *   进指纹会让缓存永不命中——它不参与任何渲染输出）。
 */
export function manifestGlobalsFingerprint(manifest: CompositionManifest): string {
  return stableStringify({ meta: manifest.meta ?? null, global: manifest.global ?? null })
}

/**
 * 段内容 hash：sha256 前 16 位。输入 = 段窗 + 段活跃轨全量 JSON + 渲染质量 +
 * manifest 全局态指纹——任一变化（copy / 格位 / 质量档 / 调色 / 字体）都会换
 * hash。确定性：同输入同输出。`globals` 是**必传**参数（`manifestGlobalsFingerprint`
 * 的产物）：必须显式出现在每个调用点，防止再犯「忘了全局态」的集成错误。
 */
export function segmentHash(segment: ShotSegment, quality: string, globals: string): string {
  const payload = JSON.stringify({
    start: segment.startFrame,
    end: segment.endFrame,
    quality,
    globals,
    tracks: segment.tracks,
  })
  return createHash('sha256').update(payload).digest('hex').slice(0, 16)
}

/** 段 hash 集合（含渲染质量与全局态指纹——任一变化 = 全段脏，符合预期）。 */
export function segmentHashes(segments: readonly ShotSegment[], quality: string, globals: string): string[] {
  return segments.map((segment) => segmentHash(segment, quality, globals))
}

function entryPaths(cacheDir: string, hash: string): { videoPath: string; metaPath: string } {
  return { videoPath: join(cacheDir, `${hash}.mp4`), metaPath: join(cacheDir, `${hash}.json`) }
}

/**
 * 缓存比对：命中（mp4 + 元数据都在）→ reused；否则 → dirty。
 * 顺序与 segments 一致（拼接按段序）。`globals` 必传（见 segmentHash）。
 */
export function getDirtySegments(segments: readonly ShotSegment[], quality: string, cacheDir: string, globals: string): ShotCachePlan {
  const reused: ShotCachePlan['reused'] = []
  const dirty: ShotSegment[] = []
  if (!existsSync(cacheDir)) return { reused, dirty: [...segments] }
  for (const segment of segments) {
    const hash = segmentHash(segment, quality, globals)
    const { videoPath, metaPath } = entryPaths(cacheDir, hash)
    if (existsSync(videoPath) && existsSync(metaPath)) {
      reused.push({ segment, entry: { hash, videoPath } })
    } else {
      dirty.push(segment)
    }
  }
  return { reused, dirty }
}

/** 命中段的缓存条目（按段序）。 */
export function reusedEntries(segments: readonly ShotSegment[], quality: string, cacheDir: string, globals: string): Array<{ segment: ShotSegment; entry: ShotCacheEntry }> {
  return segments
    .map((segment) => {
      const hash = segmentHash(segment, quality, globals)
      const { videoPath, metaPath } = entryPaths(cacheDir, hash)
      return existsSync(videoPath) && existsSync(metaPath) ? { segment, entry: { hash, videoPath } } : null
    })
    .filter((v) => v !== null)
}

/** 渲染完成的段写入缓存（从渲染产物复制；元数据含窗/轨数/质量/全局态指纹）。 */
export function storeSegment(segment: ShotSegment, quality: string, cacheDir: string, renderedFile: string, globals: string): ShotCacheEntry | null {
  try {
    mkdirSync(cacheDir, { recursive: true })
    const hash = segmentHash(segment, quality, globals)
    const { videoPath, metaPath } = entryPaths(cacheDir, hash)
    copyFileSync(renderedFile, videoPath)
    writeFileSync(metaPath, JSON.stringify({
      hash,
      index: segment.index,
      startFrame: segment.startFrame,
      endFrame: segment.endFrame,
      trackCount: segment.tracks.length,
      quality,
      globals,
    }, null, 2), 'utf8')
    return { hash, videoPath }
  } catch {
    return null // 缓存写失败不阻断（下次全量重渲，行为正确）
  }
}

/** 清孤儿：只删「本次合法 hash 集合之外」的缓存条目。失败静默（不抛）。 */
export function clearStaleEntries(cacheDir: string, validHashes: ReadonlySet<string>): number {
  try {
    if (!existsSync(cacheDir)) return 0
    let removed = 0
    for (const file of readdirSync(cacheDir)) {
      const hash = file.replace(/\.(mp4|json)$/, '')
      if (!validHashes.has(hash)) {
        rmSync(join(cacheDir, file), { force: true })
        removed += 1
      }
    }
    return removed
  } catch {
    return 0
  }
}

/** 从被渲 manifest 剥出段渲染用 manifest（绝对帧号 + 段活跃轨 + **剥 audio**——D3 无声段）。 */
export function segmentManifest(manifest: CompositionManifest, segment: ShotSegment): CompositionManifest {
  const out = { ...(manifest as unknown as Record<string, unknown>), tracks: segment.tracks }
  delete (out as Record<string, unknown>).audio // D3：段视频无声渲，音频整轨后配（Phase 1.5）
  return out as unknown as CompositionManifest
}

/** 段渲染工单参数（`segmentRenderOptions` 的产物，字段与 `RunRenderJobOptions` 对齐）。 */
export interface SegmentRenderOptions {
  /** 段渲染用 manifest（`segmentManifest`：段活跃轨 + 剥 audio）。 */
  manifest: CompositionManifest
  fps: number
  /** 段帧窗（**闭区间**，见下）。 */
  frameRange: [number, number]
  /** 恒 true（D3：段视频无声渲）。 */
  muteAudio: true
  quality: RenderQuality
  realDurations?: Record<string, number>
}

/**
 * R11-C5 修复（P0，2026-11-16 review）：段渲染工单参数的**唯一构造点**。
 *
 * 为什么必须是纯函数而不是入口内联对象：C5 接线时漏传了 frameRange/muteAudio
 * （commit message 声称传了、代码没传），C3 的透传单测与 C5 的决策单测各测一段、
 * 中间的集成点零测试——错误产物（每段按整片时长渲）还进了缓存。把构造收进纯函数
 * + 单测钉死，集成点想漏都没地方漏。
 *
 * 口径换算（本函数的核心职责）：
 * - 段窗是**半开** `[startFrame, endFrame)`（`sliceByShots` / `trackVisibleIn`）；
 *   Remotion `renderMediaOnWeb` 的 frameRange 是**闭区间**（`getRealFrameRange`：
 *   `end >= durationInFrames` 直接抛错）⇒ 必须传 `[startFrame, endFrame - 1]`。
 *   直传 `[start, end)` 会让末段越界抛错、中间段每段多渲一帧（拼接后边界重复帧）。
 * - `muteAudio` 恒 true（D3）：段视频不编码音轨；段 manifest 本身已剥 audio，
 *   双保险保证 concat 前所有段流结构一致。
 * - `endFrame - 1` 取 `max(startFrame)` 兜底：sanitizeCuts 保证段长 ≥
 *   MIN_SHOT_FRAMES，正常永不触发；纯函数独立使用时不许产出倒挂区间。
 */
export function segmentRenderOptions(
  manifest: CompositionManifest,
  segment: ShotSegment,
  quality: RenderQuality,
  realDurations?: Record<string, number>,
): SegmentRenderOptions {
  return {
    manifest: segmentManifest(manifest, segment),
    fps: manifest.meta.fps,
    frameRange: [segment.startFrame, Math.max(segment.startFrame, segment.endFrame - 1)],
    muteAudio: true,
    quality,
    ...(realDurations !== undefined ? { realDurations } : {}),
  }
}


// ── RQ-038 R11-C5 · **分镜渲染决策**（planShotRender，纯函数）────────────────
//
// 渲染入口（render_composition）在整片渲染之前问一句「这单能不能按分镜走」：
// - **能**：返回段清单 + hash + 缓存目录（入口据此渲染脏段 → 拼接）；
// - **不能**：mode 'whole' + 原因（回退整片路径——行为与今天逐字段一致）。
//
// 回退条件（D3/D5 拍板 + fail-safe）：probe/spot 单、manifest 有 audio 段、
// 无可用边界（<2 段）、无项目目录。

export interface ShotRenderPlan {
  mode: 'shots' | 'whole'
  /** mode 'whole' 时的回退原因（进回执，不静默）。 */
  reason?: string
  segments?: ShotSegment[]
  /** 段 hash（与 segments 同序；缓存键 + 拼接清单的主体）。 */
  hashes?: string[]
  cacheDir?: string
  /**
   * manifest 全局态指纹（P1-2；mode 'shots' 时必有）——调用方必须把**同一个**
   * 值传给 `getDirtySegments` / `storeSegment`，保证决策、比对、落缓存三方
   * 用同一把钥匙（此前三方各算各的正是集成缺口的一种形态）。
   */
  globals?: string
}

export interface PlanShotRenderOptions {
  /** spec.json 派生的边界（帧）；派生失败传 null。 */
  specBoundaries: number[] | null
  quality: string
  projectDir: string | null
  /** 入口条件：非 probe/spot 且 manifest 无 audio 段。 */
  allowShots: boolean
}

export function planShotRender(
  manifest: CompositionManifest,
  opts: PlanShotRenderOptions,
): ShotRenderPlan {
  if (!opts.allowShots) return { mode: 'whole', reason: 'probe/spot 单或 manifest 含音频段（音频整轨后配 = Phase 1.5）' }
  if (opts.projectDir === null) return { mode: 'whole', reason: '无项目目录（首页态）' }
  const { cuts, source } = resolveShotBoundaries(manifest, opts.specBoundaries)
  if (cuts.length === 0) return { mode: 'whole', reason: `无可用边界（来源 ${source}）` }
  // cuts ≥ 1 ⇒ 段数 ≥ 2（sanitizeCuts 保证严格升序）——无需再判段数
  const { segments } = sliceByShots(manifest, cuts)
  const cacheDir = shotCacheDir(opts.projectDir)
  const globals = manifestGlobalsFingerprint(manifest)
  return { mode: 'shots', segments, hashes: segmentHashes(segments, opts.quality, globals), cacheDir, globals }
}