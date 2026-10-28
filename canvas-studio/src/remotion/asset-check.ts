/**
 * REQ-034（Remotion 集成）· B3 route B 素材核对（宿主侧，**无浏览器**）。
 *
 * 技术事实源 = `docs/plans/remotion/remotion-integration-devdoc-2026-10-14.md` §8.2（v1.5）。
 *
 * route B 下渲染发生在 Electron 渲染进程、页面与素材**同源**，因此宿主**不拷素材**
 * （route A 的 `renderDir` / `staticFile()` / `link` / 临时目录一整套作废）。宿主只做：
 * 1. 用 `urlToAssetPath`（`compose.ts` 复用）把同源资产 URL 反查为本地文件，核对存在性；
 * 2. 对 `video` 轨用 `probeMediaInfo`（ffmpeg）探**真值时长**与**真实像素**，前者供
 *    `reconcileManifestVideoDurations`（`timing.ts`）校正「声明帧数 vs 真值」，后者供
 *    `checkManifestResolution`（O-12）判「素材被上采样进成片」。
 *
 * 素材缺失在宿主侧即可判定（`existsSync`），故**硬失败**：`missing` 非空由调用方抛
 * `CS-USER-ERR` —— 对齐 `compose_video`「片段文件不存在，请重新生成后再导出」的口径。
 * 若放行到渲染，用户拿到的是一条没有上下文的客户端渲染失败。
 *
 * @see materialize.ts —— 本核对**的前置**：它先把域内绝对路径物化成同源 URL。
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { urlToAssetPath } from '../compose.js'
import { probeMediaInfo } from '../ffmpeg-run.js'
import { ASSET_URL_PREFIX, type CompositionManifest } from './manifest.js'

/**
 * 素材核对结论。
 */
export interface AssetCheck {
  /**
   * 缺失 / 不可用的素材（形如 `<trackId> → <src>`）。**非空 ⇒ 调用方硬失败**
   * （对齐 `compose_video`「片段文件不存在」的口径，不静默出片）。
   */
  missing: string[]
  /**
   * `video` 轨 `src` → 真值时长（秒）。探不到真值的项**不出现**（区别于「真值 = 0」），
   * 调用方据此决定是否做时长核对（`reconcileManifestVideoDurations` 读不到键即原样返回）。
   */
  realDurations: Record<string, number>
  /**
   * O-12：`video` 轨 `src` → 素材**真实像素**。探不到尺寸的项不出现。
   *
   * 只探 `video`：真机症状是 `video_composite` 的 864×480 被上采样到 1280×720
   * （白丢 1.48× 细节）；`image` 轨是生成图、分辨率通常远高于成片，探它是纯开销。
   */
  realSizes: Record<string, { width: number; height: number }>
}

/** 探真值的并发上限（ffprobe 是 IO；4 路足以把 10 段素材压到 ~0.5s）。 */
const PROBE_CONCURRENCY = 4
/** 探测缓存文件名（放在项目资产目录里，随项目走）。 */
const PROBE_CACHE_FILE = '.remotion-probe.json'
/** 缓存有效期：7 天（素材被替换时 `mtimeMs` 会变，key 自然失效）。 */
const PROBE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

interface ProbeCacheEntry {
  size: number
  mtimeMs: number
  duration: number
  /** O-12：真实像素（旧缓存无此二字段 ⇒ 视为**未探尺寸**，下次重探一次补上）。 */
  width?: number
  height?: number
  at: number
}

type ProbeCache = Record<string, ProbeCacheEntry>

/** 读缓存（坏文件 / 不存在一律当空表 —— 探测失败不该阻断渲染）。 */
function readProbeCache(assetsDir: string): ProbeCache {
  try {
    const raw = readFileSync(join(assetsDir, PROBE_CACHE_FILE), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const out: ProbeCache = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue
      const entry = value as { size?: unknown; mtimeMs?: unknown; duration?: unknown; width?: unknown; height?: unknown; at?: unknown }
      if (
        typeof entry.size !== 'number' || typeof entry.mtimeMs !== 'number' ||
        typeof entry.duration !== 'number' || typeof entry.at !== 'number'
      ) continue
      const width = typeof entry.width === 'number' && entry.width > 0 ? entry.width : undefined
      const height = typeof entry.height === 'number' && entry.height > 0 ? entry.height : undefined
      out[key] = {
        size: entry.size,
        mtimeMs: entry.mtimeMs,
        duration: entry.duration,
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        at: entry.at,
      }
    }
    return out
  } catch {
    return {}
  }
}

/** 写缓存（失败静默：缓存是加速手段，不是正确性依赖）。 */
function writeProbeCache(assetsDir: string, cache: ProbeCache): void {
  try {
    writeFileSync(join(assetsDir, PROBE_CACHE_FILE), JSON.stringify(cache), 'utf8')
  } catch {
    // 只读目录 / 磁盘满：忽略。
  }
}

/** 有界并发跑 IO 任务（保序返回）。 */
async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await worker(items[index] as T)
    }
  })
  await Promise.all(runners)
  return results
}

/**
 * 核对 Manifest 引用的素材（只核对、不拷贝，devdoc §8.2）。
 *
 * @param manifest - 待渲染的 `CompositionManifest`。
 * @param assetsDir - 目标项目资产目录（`registry.assetsDir(projectId)`）。
 * @param ffmpegPath - 可选：显式 ffmpeg 路径（测试注入；缺省走 `resolveFfmpegPath`）。
 */
export async function checkManifestAssets(
  manifest: CompositionManifest,
  assetsDir: string,
  ffmpegPath?: string,
): Promise<AssetCheck> {
  const missing: string[] = []
  const realDurations: Record<string, number> = {}
  const realSizes: Record<string, { width: number; height: number }> = {}
  // 三期 W5-4：先按 `src` 去重 —— 同一段素材被两条轨引用时，原来会 ffprobe 两次。
  const videoSources = new Map<string, string>()
  for (const track of manifest.tracks) {
    if (track.type !== 'video' && track.type !== 'image') continue
    const src = track.src
    // 物化层（`materializeManifestSources`）已把**本项目资产目录内**的本地绝对路径转成同源
    // URL ⇒ 此处理论上只剩同源 URL。非前缀值按**上游漏物化**处理并记缺失（fail-closed）：
    // 跳过它会重新引入「放行但不核对」的静默 404。
    if (!src.startsWith(ASSET_URL_PREFIX)) {
      missing.push(`${track.id} → ${src}（非同源资产 URL，未经物化）`)
      continue
    }
    const local = urlToAssetPath(assetsDir, src)
    if (!existsSync(local)) {
      missing.push(`${track.id} → ${src}`)
      continue
    }
    if (track.type === 'video' && !videoSources.has(src)) videoSources.set(src, local)
  }

  const cache = readProbeCache(assetsDir)
  const now = Date.now()
  const pending: { src: string; local: string; key: string }[] = []
  for (const [src, local] of videoSources) {
    let size = 0
    let mtimeMs = 0
    try {
      const stat = statSync(local)
      size = stat.size
      mtimeMs = stat.mtimeMs
    } catch {
      // stat 失败：不做缓存，直接探（探不到就算了）。
    }
    const key = `${src}|${size}|${mtimeMs}`
    const cached = cache[key]
    // O-12：命中缓存还要**尺寸齐全**才算命中 —— 旧缓存只存了时长，拿它会把
    // 「分辨率核对」永久静默跳过（缓存 7 天才过期）。
    const fullyCached = cached !== undefined && now - cached.at <= PROBE_CACHE_TTL_MS
      && cached.duration > 0 && cached.width !== undefined && cached.height !== undefined
    if (fullyCached) {
      realDurations[src] = cached.duration
      realSizes[src] = { width: cached.width as number, height: cached.height as number }
      continue
    }
    if (cached !== undefined && now - cached.at <= PROBE_CACHE_TTL_MS && cached.duration > 0) {
      // 时长已知、尺寸缺失：先记时长（免得校正逻辑回退），再重探一次补尺寸。
      realDurations[src] = cached.duration
    }
    pending.push({ src, local, key })
  }

  // 并行探测（有界并发，保序）；结果顺手写回缓存。
  const probed = await runWithConcurrency(pending, PROBE_CONCURRENCY, async (item) => {
    const info = await probeMediaInfo(item.local, ffmpegPath)
    return { ...item, info }
  })
  let dirty = false
  for (const entry of probed) {
    const { duration, width, height } = entry.info
    if (Number.isFinite(duration) && duration > 0) realDurations[entry.src] = duration
    const hasSize = typeof width === 'number' && width > 0 && typeof height === 'number' && height > 0
    if (hasSize) realSizes[entry.src] = { width: width as number, height: height as number }
    if ((!Number.isFinite(duration) || duration <= 0) && !hasSize) continue
    const [, sizeRaw, mtimeRaw] = entry.key.split('|')
    cache[entry.key] = {
      size: Number(sizeRaw),
      mtimeMs: Number(mtimeRaw),
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
      ...(hasSize ? { width: width as number, height: height as number } : {}),
      at: now,
    }
    dirty = true
  }
  // 清掉过期条目，避免缓存文件无限长大。
  for (const [key, entry] of Object.entries(cache)) {
    if (now - entry.at > PROBE_CACHE_TTL_MS) {
      delete cache[key]
      dirty = true
    }
  }
  if (dirty) writeProbeCache(assetsDir, cache)

  return { missing, realDurations, realSizes }
}
