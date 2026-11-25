/**
 * REQ-041 L1（2026-11-25）· **段产物只读清单**（磁盘 → 客户端的媒体事实）。
 *
 * ## 为什么不是客户端自己拼 URL
 *
 * 分镜卡只有 `segmentRef`（「我是哪一段」），没有「这一段渲过没有」。让客户端
 * `/canvas-studio/assets/<pid>/seg-<id>.mp4` 盲拼，未渲项目会刷出 6 个 404，而且
 * 宿主改一次命名规则客户端就静默断链。清单一次回答两件事：**是否存在**（stat）
 * 与**从哪儿取**（url）+ 破缓存版本（`v` = mtimeMs）。
 *
 * ## 为什么 id 必须再校验白名单
 *
 * `id` 来自磁盘上的 card.json（可搬、可手改），又直接进文件名。历史卡或手写卡
 * 若塞了 `../x`，拼进 assets 路径就会越界。这里只认产物 id 的同一套白名单，
 * 不合法的行直接跳过（诚实失败，不报错给最终用户）。
 *
 * ## ref 纪律
 *
 * `ref` 由 L0 发布时写入（只在段表整表对齐时给），这里**原样透传**：不按序号猜、
 * 不从清洗后的 id 反推。历史卡没有 ref ⇒ 清单不给 ref ⇒ 卡维持文案（存量不回填）。
 *
 * ## REQ-041 P0-a：`card.json` 缺失时的派生回退
 *
 * draft 档不写交付卡（`host-tools.ts` 的 `isDeliverableRender`），但段副本照样能
 * 产出。清单因此多一条**只读派生**路径：`build/spec.json` + `build/manifest.json`
 * → 同一套 `resolveShotBoundaries`/`sliceByShots`/`planSegmentArtifacts` → 段行。
 * 判据与 L0 完全一致（段表整表对齐才给 ref），**不按 `seg-sN` 文件名反推**。
 * 派生结果仍是渲染态事实：不写盘、不改卡、不回填历史。
 */
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { SegmentMediaItem, SegmentMediaView } from './contracts/segment-media.js'
import type { CompositionManifest } from './remotion/manifest.js'
import { planSegmentArtifacts, segmentAssetName, segmentPointers } from './segment-artifacts.js'
import { segmentVoiceName } from './segment-audio.js'
import { boundariesFromSpec, resolveShotBoundaries, sliceByShots } from './shot-slice.js'

export type { SegmentMediaItem, SegmentMediaView } from './contracts/segment-media.js'

/** 产物 id 白名单（与 segment-artifacts 的文件名纪律同源，不认路径语义）。 */
const SAFE_ID = /^[A-Za-z0-9_-]+$/

interface CardSegmentRow {
  id?: unknown
  ref?: unknown
  startFrame?: unknown
  frames?: unknown
  durationSec?: unknown
}

/**
 * 读 card.json 的段清单。
 *
 * 形状兼容两种：实际写入是**顶层 `segments`**（`deliverable.ts` 的 `DeliveryCard`），
 * 需求文档写的是 `pointers.segments` —— 两者都认，顶层优先。没有卡 / 坏 JSON /
 * 字段缺失 ⇒ 空数组（未渲项目是正常的空，不抛）。
 */
function cardSegmentRows(card: unknown): readonly CardSegmentRow[] {
  if (card === null || typeof card !== 'object') return []
  const record = card as {
    segments?: unknown
    pointers?: { segments?: unknown } | undefined
  }
  const raw = Array.isArray(record.segments)
    ? record.segments
    : (Array.isArray(record.pointers?.segments) ? record.pointers.segments : [])
  return raw.filter((row): row is CardSegmentRow => row !== null && typeof row === 'object')
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * 只读派生：spec + manifest → 段行（与 L0 同一套切段/对齐实现）。
 *
 * 任何一步不自洽 ⇒ 空数组（诚实失败）。`ref` 只由 `planSegmentArtifacts` 在
 * 段表整表对齐时给出；**禁止**用产物文件名 `seg-sN` 反推 `spec:sN`。
 */
export function deriveSegmentRows(spec: unknown, manifest: unknown): readonly CardSegmentRow[] {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return []
  const m = manifest as CompositionManifest
  const fps = m.meta?.fps
  const safeFps = typeof fps === 'number' && Number.isFinite(fps) && fps > 0 ? fps : 30
  const totalFrames = Math.max(1, Math.floor(m.meta?.durationInFrames ?? 0))
  const specBoundaries = boundariesFromSpec(spec, totalFrames, safeFps)
  const { cuts } = resolveShotBoundaries(m, specBoundaries)
  if (cuts.length === 0) return []
  const { segments } = sliceByShots(m, cuts)
  if (segments.length === 0) return []
  return segmentPointers(planSegmentArtifacts({
    segments,
    declared: m.meta?.segments,
    fps: safeFps,
  }), safeFps)
}

/**
 * 读 `build/` 下的派生源；任一缺失/坏 JSON ⇒ 空数组（draft、未渲项目、老项目都是空）。
 */
async function derivedRowsFromBuild(projectDir: string): Promise<readonly CardSegmentRow[]> {
  try {
    const [specRaw, manifestRaw] = await Promise.all([
      readFile(join(projectDir, 'build', 'spec.json'), 'utf8'),
      readFile(join(projectDir, 'build', 'manifest.json'), 'utf8'),
    ])
    return deriveSegmentRows(JSON.parse(specRaw) as unknown, JSON.parse(manifestRaw) as unknown)
  } catch {
    return []
  }
}

/** 磁盘 → 只读清单。任何读盘失败都退化成空清单（不把渲染态问题抛给 UI）。 */
export async function readSegmentMedia(input: {
  projectDir: string
  assetsDir: string
  projectId: string
}): Promise<SegmentMediaView> {
  let rows: readonly CardSegmentRow[] = []
  let cardRead = false
  try {
    const card = JSON.parse(await readFile(join(input.projectDir, 'deliver', 'card.json'), 'utf8')) as unknown
    rows = cardSegmentRows(card)
    cardRead = true
  } catch {
    // 没有卡 / 坏卡：继续走 build/ 派生（draft 不写卡，但段副本可能存在）
  }
  // 卡片有明确指针 ⇒ 它是权威（历史卡不回填、不覆盖）；无卡或无指针 ⇒ 只读派生。
  if (!cardRead || rows.length === 0) rows = await derivedRowsFromBuild(input.projectDir)
  const segments: SegmentMediaItem[] = []
  for (const row of rows) {
    if (typeof row.id !== 'string' || !SAFE_ID.test(row.id)) continue
    let file = segmentAssetName(row.id)
    let v: number
    try {
      v = (await stat(join(input.assetsDir, file))).mtimeMs
    } catch {
      continue // 副本不存在 = 这段没发布过，不是错误
    }
    // REQ-041 P1：带声副本存在 ⇒ 清单改指它（`v` 也用带声版 mtime）。
    // 无声段必须仍在（上面已 stat）—— 带声副本是附加文件，不是替代发布。
    // 任一读盘异常都静默回退无声版（清单不因预览副本坏掉而丢掉这段）。
    const voiceFile = segmentVoiceName(row.id)
    try {
      const voiceStat = await stat(join(input.assetsDir, voiceFile))
      if (voiceStat.isFile() && voiceStat.size > 0) {
        file = voiceFile
        v = voiceStat.mtimeMs
      }
    } catch {
      // 没合过声 / 合并失败：维持无声版（诚实回退）
    }
    segments.push({
      id: row.id,
      ...(typeof row.ref === 'string' && row.ref.length > 0 ? { ref: row.ref } : {}),
      url: `/canvas-studio/assets/${encodeURIComponent(input.projectId)}/${encodeURIComponent(file)}`,
      startFrame: finiteNumber(row.startFrame),
      frames: finiteNumber(row.frames),
      durationSec: finiteNumber(row.durationSec),
      v,
    })
  }
  return { projectId: input.projectId, segments }
}
