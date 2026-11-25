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
 * ## 命中判据（REQ-041 F1，2026-11-25 真机复盘后重写）
 *
 * 旧实现按 `startFrame:endFrame` 帧窗找缓存：**改一屏内容后帧窗不变** ⇒ 判「已存在」
 * ⇒ 把改前的旧 mp4 复制回 `assets/`。表现是「托盘里第 2 屏一直是旧画面、成片却是
 * 新的」，永久陈旧且不报错。现在命中判据统一走 `shot-cache.ts` 的
 * `lookupSegmentsCache`（内容 hash + 画序归一化），帧窗只用来区分
 * 「没渲过（absent）」与「渲过但内容变了（stale）」。
 *
 * ## 纪律
 *
 * - 段窗来源与 L0 完全一致（`planSegmentTable`：`boundariesFromSpec`→
 *   `resolveShotBoundaries`→`sliceByShots`→`planSegmentArtifacts`）；只对整表对齐的
 *   段给 ref，禁止按序号配；
 * - **内容已变但没重渲 ⇒ 不复制**，逐段点名进 note（宁可不更新，也不拿旧片冒充新片）；
 * - 任一段两份副本缺一份 ⇒ 该段不进指针（半套比没有更误导）；
 * - 没有缓存段（第一次渲、probe/spot）⇒ 空指针 + note，不抛、不阻断成片。
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { CompositionManifest } from './remotion/manifest.js'
import { lookupSegmentsCache, manifestGlobalsFingerprint, shotCacheDir } from './shot-cache.js'
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

/** 从缓存发布段副本（内容不符 / 无缓存的段诚实跳过；不抛）。 */
export function publishSegmentsFromCache(input: PublishSegmentsFromCacheInput): PublishSegmentsResult {
  const fps = input.manifest.meta?.fps
  const safeFps = typeof fps === 'number' && Number.isFinite(fps) && fps > 0 ? fps : 30
  // 段表规划与渲染侧同源（`segment-table.ts`）：这里若自己再切一遍，就会出现
  // 「渲染按 A 套帧窗、发布按 B 套帧窗」—— 缓存按内容 hash 命中，错一帧就永远
  // 命中不了（表现为「渲了但不发布」）。
  const plan = planSegmentTable({ manifest: input.manifest, spec: input.spec })
  if (plan === null) return { pointers: [], artifacts: [], note: '无可用段边界，跳过段副本发布' }
  const artifacts = plan.artifacts
  const cacheDir = shotCacheDir(input.projectDir)
  if (!existsSync(cacheDir)) {
    return { pointers: [], artifacts, note: '段缓存为空（整片路径未渲段），跳过段副本发布' }
  }
  // 发布不设档位下限：缓存里有什么档就用什么档（优先最高档）。升档是渲染侧的事
  // （`missingArtifacts` 的 minQuality），发布侧越权重渲会把这条只读旁路变成渲染入口。
  const states = lookupSegmentsCache({
    segments: plan.segments,
    cacheDir,
    globals: manifestGlobalsFingerprint(input.manifest),
  })

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
    const state = states[artifact.index]
    if (state?.kind !== 'hit') {
      // stale 与 absent 分开说：「该重渲没渲」和「还没渲」是两种不同的处置。
      failures.push(state?.kind === 'stale'
        ? `${artifact.id}（内容已变、缓存仍是旧版，未发布）`
        : `${artifact.id}（从未渲过该段）`)
      continue
    }
    try {
      copyFileSync(state.videoPath, join(deliverDir, segmentArtifactName(artifact.id)))
      copyFileSync(state.videoPath, join(input.assetsDir, segmentAssetName(artifact.id)))
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
