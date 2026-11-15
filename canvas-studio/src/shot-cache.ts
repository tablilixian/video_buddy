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
 * - hash 输入 = 段活跃轨全量 JSON（含帧号）+ 段窗 + 渲染质量——**改 s2 的 copy
 *   只脏 s2**；carry/bg 变了全段脏（它们在每个段的活跃集里）；
 * - 缓存条目 = `<hash>.mp4` + `<hash>.json`（段元数据：窗/轨数/写入时间）；
 * - `clearStaleEntries` 只删「本次合法 hash 集合之外」的条目（孤儿回收），
 *   失败不抛（缓存是优化，坏了退化为全量重渲）。
 *
 * 纪律：文件操作集中在 mkdir/read/write/copy/unlink，**任何失败都返回失败标记
 * 而不抛**（铁律：缓存是优化，坏了退化为全量重渲）。
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CompositionManifest } from './remotion/manifest.js'
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
 * 段内容 hash：sha256 前 16 位。输入 = 段窗 + 段活跃轨全量 JSON + 渲染质量——
 * 任一变化（copy / 格位 / 质量档）都会换 hash。确定性：同输入同输出。
 */
export function segmentHash(segment: ShotSegment, quality: string): string {
  const payload = JSON.stringify({
    start: segment.startFrame,
    end: segment.endFrame,
    quality,
    tracks: segment.tracks,
  })
  return createHash('sha256').update(payload).digest('hex').slice(0, 16)
}

/** 段 hash 集合（含渲染质量——质量档变化 = 全段脏，符合预期）。 */
export function segmentHashes(segments: readonly ShotSegment[], quality: string): string[] {
  return segments.map((segment) => segmentHash(segment, quality))
}

function entryPaths(cacheDir: string, hash: string): { videoPath: string; metaPath: string } {
  return { videoPath: join(cacheDir, `${hash}.mp4`), metaPath: join(cacheDir, `${hash}.json`) }
}

/**
 * 缓存比对：命中（mp4 + 元数据都在）→ reused；否则 → dirty。
 * 顺序与 segments 一致（拼接按段序）。
 */
export function getDirtySegments(segments: readonly ShotSegment[], quality: string, cacheDir: string): ShotCachePlan {
  const reused: ShotCachePlan['reused'] = []
  const dirty: ShotSegment[] = []
  if (!existsSync(cacheDir)) return { reused, dirty: [...segments] }
  for (const segment of segments) {
    const hash = segmentHash(segment, quality)
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
export function reusedEntries(segments: readonly ShotSegment[], quality: string, cacheDir: string): Array<{ segment: ShotSegment; entry: ShotCacheEntry }> {
  return segments
    .map((segment) => {
      const hash = segmentHash(segment, quality)
      const { videoPath, metaPath } = entryPaths(cacheDir, hash)
      return existsSync(videoPath) && existsSync(metaPath) ? { segment, entry: { hash, videoPath } } : null
    })
    .filter((v) => v !== null)
}

/** 渲染完成的段写入缓存（从渲染产物复制；元数据含窗/轨数/质量）。 */
export function storeSegment(segment: ShotSegment, quality: string, cacheDir: string, renderedFile: string): ShotCacheEntry | null {
  try {
    mkdirSync(cacheDir, { recursive: true })
    const hash = segmentHash(segment, quality)
    const { videoPath, metaPath } = entryPaths(cacheDir, hash)
    copyFileSync(renderedFile, videoPath)
    writeFileSync(metaPath, JSON.stringify({
      hash,
      index: segment.index,
      startFrame: segment.startFrame,
      endFrame: segment.endFrame,
      trackCount: segment.tracks.length,
      quality,
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
  return { mode: 'shots', segments, hashes: segmentHashes(segments, opts.quality), cacheDir }
}