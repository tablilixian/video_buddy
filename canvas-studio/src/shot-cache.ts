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
 * - **命中按内容 hash 查，不按帧窗**（REQ-041 F1，2026-11-25 真机复盘）：
 *   `lookupSegmentsCache` 是命中判据的唯一实现。此前「按 `startFrame:endFrame`
 *   找得到就算命中」导致改一屏内容后帧窗不变 ⇒ 零补渲 + 把旧 mp4 发回前端，
 *   且永久陈旧、不报错。帧窗现在只用来区分「没渲过（absent）」与「渲过但内容
 *   变了（stale）」，不再当缓存键；
 * - **hash 里的轨序是归一化的**（REQ-041 F2）：`canonicalTracks` 只对时间不重叠的
 *   轨重排 —— 那些轨永远不同帧出现，顺序是噪声；时间重叠的轨保持原相对次序
 *   （画序是内容）。这样「改一屏」不会因为编辑脚本重排数组而让全片失效；
 * - `clearStaleEntries` 只删「本次合法 hash 集合之外」的条目（孤儿回收），
 *   失败不抛（缓存是优化，坏了退化为全量重渲）。
 *
 * 纪律：文件操作集中在 mkdir/read/write/copy/unlink，**任何失败都返回失败标记
 * 而不抛**（铁律：缓存是优化，坏了退化为全量重渲）。
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
 * 画质档序（0 = 最低）。未知档返回 -1：旧 meta 没有 `quality` 时没有可比的维度，
 * 一律当「未知」处理（既不优于也不劣于已知档）。
 *
 * **唯一定义**：缓存查找（本文件）与发布择优都读这张表。此前它只活在
 * `segment-publish.ts`，而缓存命中判断另有一套「按帧窗有没有」的口径 —— 两套口径
 * 各说各话，才让「改了内容却命中旧件」这种事故没有一处代码能看出来。
 */
export const QUALITY_RANK: Readonly<Record<string, number>> = { draft: 0, standard: 1, high: 2 }

/** 由高到低的查找顺序：同内容优先用最高档那份（不许拿 draft 顶掉已有 high）。 */
const QUALITY_HIGH_TO_LOW = ['high', 'standard', 'draft'] as const

/** 画质档的分值（未知档 -1）。 */
export function qualityRankOf(quality: string): number {
  return QUALITY_RANK[quality] ?? -1
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
 *   进指纹会让缓存永不命中——它不参与任何渲染输出）、`meta.segments`（R11 · O-2：
 *   段表是**派生数据**，只描述怎么切段，不改任何一张像素；进了指纹就等于“切法一改
 *   全段失效”，把「改一段只重渲这段」直接废掉。段窗本身已进 `segmentHash` 的
 *   `start/end`，不需要在全局指纹里重复）。
 */
export function manifestGlobalsFingerprint(manifest: CompositionManifest): string {
  const { segments: _segments, ...metaWithoutSegments } = manifest.meta ?? {}
  return stableStringify({ meta: metaWithoutSegments, global: manifest.global ?? null })
}

/**
 * 轨的时间窗（帧，半开 `[start, start+duration)`）。脏数据一律按 0 长处理 ——
 * 归一化只影响缓存键，不该因为一条坏轨让整段失去缓存能力。
 */
function trackWindow(track: CompositionManifest['tracks'][number]): [number, number] {
  const rawStart = (track as { startFrame?: unknown }).startFrame
  const rawDuration = (track as { durationInFrames?: unknown }).durationInFrames
  const start = typeof rawStart === 'number' && Number.isFinite(rawStart) ? rawStart : 0
  const duration = typeof rawDuration === 'number' && Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0
  return [start, start + duration]
}

/**
 * 画序归一化（REQ-041 F2，2026-11-25 真机复盘）：**只用于算缓存 hash**，不参与渲染。
 *
 * ## 解决什么
 *
 * 真机实测：改第 2 屏后，同一份缓存的 draft 命中从 7/9 掉到 1/9 —— 其余 6 段的轨
 * **集合完全没变**，只是数组顺序变了（模型直改 manifest 时的 filter+push / 重新
 * 归组）。而 `segmentHash` 吃的是有序 tracks，于是「改一屏」变成「全片重渲」。
 *
 * ## 为什么不能简单 sort(by id)
 *
 * `Root.tsx:238` 按数组顺序 `<Sequence>` 渲染 ⇒ **数组顺序就是画序（z-order）**。
 * 两条**时间上重叠**的轨互换位置会真的改像素；对它们排序就等于让两份不同的画面
 * 算出同一个 hash，把错的段缓存回放出去。
 *
 * ## 做法：只对「时间不重叠」的轨重排
 *
 * 时间窗不相交的两条轨永远不同帧出现，谁先谁后不影响任何一帧 ⇒ 它们的相对顺序
 * 是纯噪声，可以归一。于是：
 * - 重叠对 → 连边 `前 → 后`（这是画序语义，属于内容，必须进 hash）；
 * - 不重叠对 → 无边（顺序自由）；
 * - 在这个偏序上做确定性拓扑排序（同时可选的按轨内容排序取名次）⇒ **同一偏序
 *   的任意输入顺序得到同一个输出**，而画序不同的输入得到不同输出。
 *
 * 推论：`canonicalTracks` 相同 ⇔ 每一帧的画序相同（在「轨是独立图层」这一前提下），
 * 所以拿它当缓存键是安全的 —— 这也是它**只**出现在 hash 里的原因（渲染顺序仍用
 * 原始数组，存量项目的画面零变化）。
 *
 * group 容器的子轨同权递归处理（容器内部同样是 `<Sequence>` 顺序）。
 */
export function canonicalTracks(tracks: readonly CompositionManifest['tracks'][number][]): CompositionManifest['tracks'] {
  const items = tracks.map((track) => (
    track.type === 'group'
      ? { ...track, children: canonicalTracks(track.children ?? []) }
      : track
  )) as CompositionManifest['tracks']
  const count = items.length
  if (count < 2) return items

  const windows = items.map(trackWindow)
  const successors: number[][] = items.map(() => [])
  const indegree = new Array<number>(count).fill(0)
  for (let i = 0; i < count; i += 1) {
    const [startA, endA] = windows[i] as [number, number]
    for (let j = i + 1; j < count; j += 1) {
      const [startB, endB] = windows[j] as [number, number]
      if (startA < endB && startB < endA) {
        ;(successors[i] as number[]).push(j)
        indegree[j] = (indegree[j] ?? 0) + 1
      }
    }
  }

  // 同内容同键：可互换的两条轨（键完全一致）谁先谁后对 hash 无影响。
  const keys = items.map((track) => stableStringify(track))
  const ready: number[] = []
  for (let i = 0; i < count; i += 1) if (indegree[i] === 0) ready.push(i)
  const byKey = (left: number, right: number): number => {
    const a = keys[left] as string
    const b = keys[right] as string
    return a < b ? -1 : a > b ? 1 : 0
  }
  ready.sort(byKey)

  const out: CompositionManifest['tracks'] = []
  while (ready.length > 0) {
    const pick = ready.shift() as number
    out.push(items[pick] as CompositionManifest['tracks'][number])
    for (const next of successors[pick] as number[]) {
      const left = (indegree[next] ?? 0) - 1
      indegree[next] = left
      if (left === 0) {
        ready.push(next)
        ready.sort(byKey)
      }
    }
  }
  // 理论上不可达（边只从低索引指向高索引 ⇒ 无环）；真出环时退回原序，绝不丢轨。
  return out.length === count ? out : items
}

/**
 * 段内容 hash：sha256 前 16 位。输入 = 段窗 + 段活跃轨全量 JSON（**画序归一化后**）
 * + 渲染质量 + manifest 全局态指纹——任一变化（copy / 格位 / 质量档 / 调色 / 字体 /
 * 真正的画序调整）都会换 hash。确定性：同输入同输出。`globals` 是**必传**参数
 * （`manifestGlobalsFingerprint` 的产物）：必须显式出现在每个调用点，防止再犯
 * 「忘了全局态」的集成错误。
 *
 * P2-4（2026-11-27 审查）：payload 走 `stableStringify` 而非 `JSON.stringify` ——
 * 模型重写 manifest 时轨对象的**键序**变了必须算出同一个指纹，否则键序抖动会让
 * 所有段 hash 一起变 = 全片重渲（F2 归一化轨序要消灭的症状换个形态回来）。
 * 本次改动会让存量缓存一次性失效（重渲一遍）——缓存是可再生产物，不是历史数据。
 */
export function segmentHash(segment: ShotSegment, quality: string, globals: string): string {
  const payload = stableStringify({
    start: segment.startFrame,
    end: segment.endFrame,
    quality,
    globals,
    tracks: canonicalTracks(segment.tracks),
  })
  return createHash('sha256').update(payload).digest('hex').slice(0, 16)
}

/** 段 hash 集合（含渲染质量与全局态指纹——任一变化 = 全段脏，符合预期）。 */
export function segmentHashes(segments: readonly ShotSegment[], quality: string, globals: string): string[] {
  return segments.map((segment) => segmentHash(segment, quality, globals))
}

/**
 * 孤儿回收的**合法集合**：当前各段在**全部质量档**下的 hash。
 *
 * P1-4（2026-11-27 审查）：合法集只放本次档 ⇒ 渲 draft 时 high 条目被当孤儿清光
 * （下次渲 high 全量重渲）；反过来渲 high 也会清掉还能用的 draft。任一档的条目都可能
 * 再被命中（`lookupSegmentsCache` 跨档复用），只有**内容对不上任何现存段**的条目才是
 * 真孤儿。与 `plan.hashes`（本次档、一段一 hash、拼接清单主体）刻意分开：那是一次
 * 运行的清单，这是目录清扫的白名单。
 */
export function allTierCacheHashes(segments: readonly ShotSegment[], globals: string): string[] {
  return QUALITY_HIGH_TO_LOW.flatMap((quality) => segmentHashes(segments, quality, globals))
}

function entryPaths(cacheDir: string, hash: string): { videoPath: string; metaPath: string } {
  return { videoPath: join(cacheDir, `${hash}.mp4`), metaPath: join(cacheDir, `${hash}.json`) }
}

/**
 * 缓存比对：命中（mp4 + 元数据都在）→ reused；否则 → dirty。
 * 顺序与 segments 一致（拼接按段序）。`globals` 必传（见 segmentHash）。
 *
 * P1-4（2026-11-27 审查）：命中判据**委托 `lookupSegmentsCache`**（跨档复用：有更高档
 * 直接算命中，不为同档白烧一遍）。此前这里只按**精确档** hash 判 —— F1 的「有 high 渲
 * draft 直接复用」只修了整片补段路径，分镜路径反而全量重渲，且下面的孤儿回收会把
 * high 条目当垃圾清光（下次渲 high 又全量重渲）。两处判据必须同源，否则 F1 的承诺
 * 只有一半成立。
 */
export function getDirtySegments(segments: readonly ShotSegment[], quality: string, cacheDir: string, globals: string): ShotCachePlan {
  const reused: ShotCachePlan['reused'] = []
  const dirty: ShotSegment[] = []
  if (!existsSync(cacheDir)) return { reused, dirty: [...segments] }
  const states = lookupSegmentsCache({ segments, cacheDir, globals, minQuality: quality })
  for (const [index, state] of states.entries()) {
    const segment = segments[index] as ShotSegment
    if (state.kind === 'hit') {
      reused.push({ segment, entry: { hash: state.hash, videoPath: state.videoPath } })
    } else {
      dirty.push(segment)
    }
  }
  return { reused, dirty }
}

/** 缓存里出现过的帧窗集合（`start:end`）。只用于区分「没渲过」与「渲过但内容变了」。 */
function cachedWindows(cacheDir: string): Set<string> {
  const out = new Set<string>()
  try {
    for (const name of readdirSync(cacheDir)) {
      if (!name.endsWith('.json')) continue
      try {
        const meta = JSON.parse(readFileSync(join(cacheDir, name), 'utf8')) as {
          startFrame?: unknown
          endFrame?: unknown
        }
        if (typeof meta.startFrame === 'number' && typeof meta.endFrame === 'number') {
          out.add(`${String(meta.startFrame)}:${String(meta.endFrame)}`)
        }
      } catch {
        // 坏 meta 不参与「渲过没渲过」的判断（宁可说没渲过，也不谎称陈旧）
      }
    }
  } catch {
    return out
  }
  return out
}

/** 一段在缓存里的状态（见 `lookupSegmentsCache`）。 */
export type SegmentCacheState =
  | { kind: 'hit'; hash: string; quality: string; videoPath: string }
  | { kind: 'stale' }
  | { kind: 'absent' }

/**
 * 一批段在缓存里的状态（与入参同序）。**按内容 hash 查，不按帧窗**。
 *
 * ## 为什么这是关键修正（REQ-041 F1，2026-11-25 真机复盘）
 *
 * 旧口径（`segment-publish.ts` 的 `cacheIndexByWindow`）只拿 `startFrame:endFrame`
 * 当键：改一屏内容后帧窗没变 ⇒ 判「已存在」⇒ 零补渲 + 把改前的旧 mp4 复制回
 * `assets/`。用户看到的是「托盘里的第 2 屏一直是旧画面，成片却是新的」，而且**永久
 * 陈旧、不报错**。meta.json 里一直写着 `hash`，却从来没被用来判命中。
 *
 * ## 三态，而不是布尔
 *
 * `stale`（同帧窗有条目、内容/档位不合）与 `absent`（从没渲过）要分开：前者的回执
 * 必须说「内容已变、缓存仍是旧版」，那是「该重渲而没渲」；后者只是「还没渲」。
 * 混成一句「缓存无该段」会让排查重新回到猜。
 *
 * `minQuality`：本次要渲的档。缓存里只有**更低**档 ⇒ 视为不可用（要真渲一版补上
 * —— 这正是「段产物停在 540p、成片是 1080p」的修法）；只有**更高**档 ⇒ 直接复用
 * （渲 draft 时不必把 high 降级重渲）。
 */
export function lookupSegmentsCache(input: {
  segments: readonly ShotSegment[]
  cacheDir: string
  globals: string
  /** 可接受的最低档；缺省 = 任何档都行（发布场景：现有最高档就够）。 */
  minQuality?: string
}): SegmentCacheState[] {
  if (!existsSync(input.cacheDir)) return input.segments.map(() => ({ kind: 'absent' as const }))
  const floor = input.minQuality === undefined ? -1 : qualityRankOf(input.minQuality)
  let windows: Set<string> | null = null
  return input.segments.map((segment) => {
    for (const quality of QUALITY_HIGH_TO_LOW) {
      if (qualityRankOf(quality) < floor) continue
      const hash = segmentHash(segment, quality, input.globals)
      const { videoPath, metaPath } = entryPaths(input.cacheDir, hash)
      if (existsSync(videoPath) && existsSync(metaPath)) {
        return { kind: 'hit' as const, hash, quality, videoPath }
      }
    }
    windows ??= cachedWindows(input.cacheDir)
    return { kind: windows.has(`${String(segment.startFrame)}:${String(segment.endFrame)}`) ? 'stale' as const : 'absent' as const }
  })
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

/**
 * 删掉**同一帧窗**下除 `keepHash` 之外的缓存条目（meta + mp4 成对删）。
 *
 * 用途是**控制磁盘**与「同帧窗多份」的混乱度：单段重渲会在同一帧窗留下改前/改后
 * 两份。命中判断自 F1 起已按内容 hash 查（`lookupSegmentsCache`），所以留两份不再
 * 造成「发回旧片」，但同帧窗堆 N 份会让缓存目录无法人工核对，也白占盘。
 *
 * **不删比 `keepQuality` 更高的档**：拿 high 缓存渲一版 draft（用户只要快看）时，
 * 把 high 删掉等于永久降级预览画质 —— 这与 D11「只允许更高档覆盖」相悖。
 */
export function pruneStaleWindowEntries(input: {
  cacheDir: string
  startFrame: number
  endFrame: number
  keepHash: string
  /**
   * 本次落盘的档；更高档的旧条目保留。**必填**（2026-11-27 审查不严谨 #5）：
   * 原来缺省 `Number.POSITIVE_INFINITY` 与保护意图相反（rank > Infinity 恒假 ⇒
   * 同帧窗全删尽）。唯一调用方一直显式传值，这里把危险缺省改成类型强制。
   */
  keepQuality: string
}): string[] {
  const removed: string[] = []
  const keepRank = qualityRankOf(input.keepQuality)
  try {
    if (!existsSync(input.cacheDir)) return removed
    for (const name of readdirSync(input.cacheDir)) {
      if (!name.endsWith('.json')) continue
      const hash = name.slice(0, -'.json'.length)
      if (hash === input.keepHash) continue
      try {
        const meta = JSON.parse(readFileSync(join(input.cacheDir, name), 'utf8')) as {
          startFrame?: unknown
          endFrame?: unknown
          quality?: unknown
        }
        // 坏 meta 无法判断归属 ⇒ 不动它（保守：宁可留脏也不误删别的窗）。
        if (meta.startFrame !== input.startFrame || meta.endFrame !== input.endFrame) continue
        const rank = typeof meta.quality === 'string' ? qualityRankOf(meta.quality) : -1
        if (rank > keepRank) continue
      } catch {
        continue
      }
      rmSync(join(input.cacheDir, name), { force: true })
      rmSync(join(input.cacheDir, `${hash}.mp4`), { force: true })
      removed.push(hash)
    }
  } catch {
    return removed
  }
  return removed
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