/**
 * REQ-041 P0-b（2026-11-25）· **整片路径的段产物旁路发布**。
 *
 * ## 解决什么
 *
 * `runShotRender` 只在 `allowShots` 为真（manifest 无 audio）时走分镜路径并发段。
 * 带旁白/BGM 的片子走整片路径 ⇒ 一段都不发 —— 真机会话负反馈的根因。
 * 本模块补一条**只读缓存 + 复制**的旁路：整片渲完后，按同一套 spec/manifest
 * 边界找出 shot-cache 里已渲好的无声段，发布两份到 `deliver/segments/` 与
 * `assets/seg-<id>.mp4`。不重渲、不 concat、不碰成片 —— 成片声音零风险。
 *
 * ## 纪律
 *
 * - 段窗来源与 L0 完全一致（`boundariesFromSpec`→`resolveShotBoundaries`→`sliceByShots`
 *   →`planSegmentArtifacts`）；只对整表对齐的段给 ref，禁止按序号配；
 * - 缓存段按 `(startFrame,endFrame)` 帧窗精确匹配 meta.json，不做「第 N 个缓存配第 N 段」；
 * - 任一段两份副本缺一份 ⇒ 该段不进指针（半套比没有更误导）；
 * - 没有缓存段（第一次渲、probe/spot）⇒ 空指针 + note，不抛、不阻断成片。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { CompositionManifest } from './remotion/manifest.js'
import { shotCacheDir } from './shot-cache.js'
import { planSegmentTable } from './segment-table.js'
import {
  segmentArtifactName,
  segmentAssetName,
  segmentPointers,
  SEGMENT_DELIVER_DIR,
  type SegmentArtifact,
} from './segment-artifacts.js'

export interface PublishSegmentsFromCacheInput {
  projectDir: string
  assetsDir: string
  manifest: CompositionManifest
  spec: unknown
}

export interface PublishSegmentsResult {
  pointers: ReturnType<typeof segmentPointers>
  artifacts: SegmentArtifact[]
  note?: string
}

/**
 * 画质档的择优序（REQ-041 复审 #1）。
 *
 * 同一帧窗可能有多份缓存：先 draft 渲过、后来 standard 渲过 —— 文件名是
 * `hash(帧窗, quality, globals)`，所以两份共存。取哪份不能交给 `readdir` 顺序
 * （macOS 上是目录项顺序，与质量、mtime 都无关），否则卡上画质会随文件系统抖动：
 * 一次 draft 之后，用户看到的是半分辨率的这一屏。
 */
const QUALITY_RANK: Readonly<Record<string, number>> = { draft: 0, standard: 1, high: 2 }

/** 读 shot-cache 的 *.json，按 `start:end` 帧窗建绝对 mp4 路径索引。坏 meta 跳过。 */
export function cacheIndexByWindow(cacheDir: string): Map<string, string> {
  const out = new Map<string, string>()
  /** 每个帧窗当前选中档的 rank；同键更高档才允许覆盖。 */
  const best = new Map<string, number>()
  if (!existsSync(cacheDir)) return out
  try {
    for (const name of readdirSync(cacheDir)) {
      if (!name.endsWith('.json')) continue
      try {
        const meta = JSON.parse(readFileSync(join(cacheDir, name), 'utf8')) as {
          startFrame?: unknown
          endFrame?: unknown
          quality?: unknown
        }
        if (typeof meta.startFrame !== 'number' || typeof meta.endFrame !== 'number') continue
        const key = `${String(meta.startFrame)}:${String(meta.endFrame)}`
        const mp4 = join(cacheDir, name.replace(/\.json$/, '.mp4'))
        if (!existsSync(mp4)) continue
        const rank = typeof meta.quality === 'string' ? (QUALITY_RANK[meta.quality] ?? -1) : -1
        const prev = best.get(key)
        // 已知档一律优于未知档；同为未知（旧 meta 没有 quality）时保持先到的，
        // 不去猜 —— 旧格式没有可比的维度。
        if (prev !== undefined && (rank < 0 || prev >= rank)) continue
        out.set(key, mp4)
        best.set(key, rank)
      } catch {
        // 坏 meta 不阻断其它段
      }
    }
  } catch {
    return out
  }
  return out
}

/** 从缓存发布段副本（无缓存的段诚实跳过；不抛）。 */
export function publishSegmentsFromCache(input: PublishSegmentsFromCacheInput): PublishSegmentsResult {
  const fps = input.manifest.meta?.fps
  const safeFps = typeof fps === 'number' && Number.isFinite(fps) && fps > 0 ? fps : 30
  // 段表规划与渲染侧同源（`segment-render.ts` 的 `planSegmentTable`）：这里若自己
  // 再切一遍，就会出现「渲染按 A 套帧窗、发布按 B 套帧窗」—— 缓存按帧窗匹配
  // meta.json，错一帧就永远命中不了（表现为「渲了但不发布」）。
  const plan = planSegmentTable({ manifest: input.manifest, spec: input.spec })
  if (plan === null) return { pointers: [], artifacts: [], note: '无可用段边界，跳过段副本发布' }
  const artifacts = plan.artifacts
  const index = cacheIndexByWindow(shotCacheDir(input.projectDir))
  if (index.size === 0) return { pointers: [], artifacts, note: '段缓存为空（整片路径未渲段），跳过段副本发布' }

  const deliverDir = join(input.projectDir, SEGMENT_DELIVER_DIR)
  try {
    mkdirSync(deliverDir, { recursive: true })
    mkdirSync(input.assetsDir, { recursive: true })
  } catch (cause) {
    return { pointers: [], artifacts, note: `建段目录失败：${cause instanceof Error ? cause.message : String(cause)}` }
  }

  const published: SegmentArtifact[] = []
  const failures: string[] = []
  for (const artifact of artifacts) {
    const source = index.get(`${String(artifact.startFrame)}:${String(artifact.startFrame + artifact.frames)}`)
    if (source === undefined) {
      failures.push(`${artifact.id}（缓存无该帧窗）`)
      continue
    }
    try {
      copyFileSync(source, join(deliverDir, segmentArtifactName(artifact.id)))
      copyFileSync(source, join(input.assetsDir, segmentAssetName(artifact.id)))
      published.push(artifact)
    } catch (cause) {
      failures.push(`${artifact.id}（${cause instanceof Error ? cause.message : String(cause)}）`)
    }
  }
  // REQ-041 D14：**逐段** —— 落地几段给几段指针，失败的逐段点名进 note。
  // 旧口径「任一段失败 ⇒ 全批不给」会让已经复制进 assets/ 的段在账上消失
  // （卡能播、交付卡说没发），与差异表不符。
  return {
    pointers: published.length > 0 ? segmentPointers(published, safeFps) : [],
    artifacts: published,
    ...(failures.length > 0 ? { note: `段 ${failures.join('、')} 副本发布失败` } : {}),
  }
}
