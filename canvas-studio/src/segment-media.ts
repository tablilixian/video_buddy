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
 */
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { SegmentMediaItem, SegmentMediaView } from './contracts/segment-media.js'
import { segmentAssetName } from './segment-artifacts.js'

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

/** 磁盘 → 只读清单。任何读盘失败都退化成空清单（不把渲染态问题抛给 UI）。 */
export async function readSegmentMedia(input: {
  projectDir: string
  assetsDir: string
  projectId: string
}): Promise<SegmentMediaView> {
  const empty: SegmentMediaView = { projectId: input.projectId, segments: [] }
  let rows: readonly CardSegmentRow[] = []
  try {
    const card = JSON.parse(await readFile(join(input.projectDir, 'deliver', 'card.json'), 'utf8')) as unknown
    rows = cardSegmentRows(card)
  } catch {
    return empty
  }
  const segments: SegmentMediaItem[] = []
  for (const row of rows) {
    if (typeof row.id !== 'string' || !SAFE_ID.test(row.id)) continue
    const file = segmentAssetName(row.id)
    let v: number
    try {
      v = (await stat(join(input.assetsDir, file))).mtimeMs
    } catch {
      continue // 副本不存在 = 这段没发布过，不是错误
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
