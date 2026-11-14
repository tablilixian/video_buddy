/**
 * RQ-R8/P1-18（2026-11-14 复盘 #18）· **权威交付路径**。
 *
 * ## 解决什么
 *
 * 31 个项目仅 6 个有 `final*` 命名成片；DNS 2 同时存在 4 个分辨率互相矛盾的 final；
 * 香水项目唯一 "final" 是 480p 草稿；PROGRESS 记的「最佳成片 26.62s」与实际 45.1s 对不上
 * —— 没有单一权威路径，用户与后续流程只能靠猜。
 *
 * ## 机制（D1/D2/D4 拍板）
 *
 * - **触发**：`quality ∈ {standard, high}` 且非 probe/spot 的成功渲染（draft 不落）；
 * - **落盘**：`<projectDir>/deliver/final.mp4` **覆盖写**（不留 final-vN 家族——版本史在
 *   card.json 与 build/versions/），加 `deliver/card.json` 交付卡；
 * - **复制不改节点**：画布节点 url 仍指向 assets/<uuid>.mp4，deliver/ 是复制副本
 *   （落节点逻辑零改动，卡点 K1）；card.json 记 assetFile 与节点 id 建立对应；
 * - **时长断言**（#15 的落地口）：|actual − plan.targetDuration| > 1s ⇒ card.json 标
 *   `durationMismatch`（混规格显性化，不拒收——已渲好的片子不陪葬，D4）；
 * - **handoff 倒逼**（#2，D3）：未决项读 PROGRESS「已知未决」段（宿主锚点已保留模型
 *   手写段），为空 ⇒ card.json 标 `deliveredWithGaps` + 回执硬提醒——不加新审批门。
 *
 * 纪律：写盘失败**不阻断渲染**（同 render-anchor 锚点纪律，交付卡是辅助设施）；
 * 无时钟/随机进入 manifest（card.json 是宿主运维产物，generatedAt 合法）。
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 交付时长断言容忍（秒）：|actual − target| 超过即标 durationMismatch。D4 拍板 ±1s。 */
export const DELIVER_DURATION_TOLERANCE_SEC = 1

/** 定稿判定（D1）：standard/high 且非 probe/spot 的渲染才落 deliver/。 */
export function isDeliverableRender(quality: string | undefined, probe: boolean, spot: boolean): boolean {
  return !probe && !spot && (quality === 'standard' || quality === 'high')
}

export interface DeliverableInput {
  projectDir: string
  /** 成片在磁盘上的绝对路径（assets/<projectId>/<assetFile>）。 */
  sourceFile: string
  url: string
  assetFile: string
  /** 画布节点 id（成片节点；探针/spot 单没有，但那些也不会走到这里）。 */
  nodeId: string | null
  durationSec: number
  width?: number
  height?: number
  fps: number
  quality: 'standard' | 'high'
  /** manifest 内容 hash（sha256 前 16 位，调用方算好传入）。 */
  manifestHash: string
  anchorVersion: number | null
  targetDurationSec: number | null
  /** PROGRESS「已知未决」段原文（null/空 = 模型没填）。 */
  openIssues: string | null
  now: number
}

export interface DeliverableResult {
  written: boolean
  finalPath: string
  cardPath: string
  deliveredWithGaps: boolean
  durationMismatch: boolean
  /** 实际 − 目标（秒，一位小数）；target 缺省时 null。 */
  deltaSec: number | null
  /** written=false 时的失败原因（写盘失败不阻断渲染，回执给一行警告）。 */
  note?: string
}

/** 交付卡形状（card.json 的唯一事实源；下游读它不要猜）。 */
export interface DeliveryCard {
  generatedAt: number
  spec: { fps: number; width?: number; height?: number; durationSec: number; quality: string }
  version: { anchorVersion: number | null; manifestHash: string }
  pending: { openIssues: string; deliveredWithGaps: boolean }
  durationCheck: {
    targetDurationSec: number | null
    actualDurationSec: number
    deltaSec: number | null
    toleranceSec: number
    durationMismatch: boolean
  }
  pointers: { url: string; assetFile: string; nodeId: string | null }
}

/** 一次交付的落盘（覆盖写）。失败返回 written:false + note，**不抛**（渲染不陪葬）。 */
export function writeDeliverable(input: DeliverableInput): DeliverableResult {
  const deliverDir = join(input.projectDir, 'deliver')
  const finalPath = join(deliverDir, 'final.mp4')
  const cardPath = join(deliverDir, 'card.json')
  const deltaSec = input.targetDurationSec === null
    ? null
    : Math.round((input.durationSec - input.targetDurationSec) * 10) / 10
  const durationMismatch = deltaSec !== null && Math.abs(deltaSec) > DELIVER_DURATION_TOLERANCE_SEC
  const deliveredWithGaps = input.openIssues === null || input.openIssues.trim() === ''
  try {
    mkdirSync(deliverDir, { recursive: true })
    copyFileSync(input.sourceFile, finalPath)
    const card: DeliveryCard = {
      generatedAt: input.now,
      spec: {
        fps: input.fps,
        durationSec: input.durationSec,
        quality: input.quality,
        ...(input.width === undefined ? {} : { width: input.width }),
        ...(input.height === undefined ? {} : { height: input.height }),
      },
      version: { anchorVersion: input.anchorVersion, manifestHash: input.manifestHash },
      pending: {
        openIssues: deliveredWithGaps ? '（未填）' : (input.openIssues as string),
        deliveredWithGaps,
      },
      durationCheck: {
        targetDurationSec: input.targetDurationSec,
        actualDurationSec: input.durationSec,
        deltaSec,
        toleranceSec: DELIVER_DURATION_TOLERANCE_SEC,
        durationMismatch,
      },
      pointers: { url: input.url, assetFile: input.assetFile, nodeId: input.nodeId },
    }
    writeFileSync(cardPath, JSON.stringify(card, null, 2), 'utf8')
    return { written: true, finalPath, cardPath, deliveredWithGaps, durationMismatch, deltaSec }
  } catch (cause) {
    const note = cause instanceof Error ? cause.message : String(cause)
    return {
      written: false,
      finalPath,
      cardPath,
      deliveredWithGaps,
      durationMismatch,
      deltaSec,
      note: `权威交付写入失败（成片不受影响）：${note}`,
    }
  }
}

/** 交付结果 → 渲染回执的 warnings 行（空数组 = 无话可说）。 */
export function deliveryReceiptLines(result: DeliverableResult | null): string[] {
  if (result === null) return []
  if (!result.written) return [`⚠️ ${result.note as string}`]
  const lines: string[] = ['📦 权威交付：deliver/final.mp4 + card.json（版本 / 时长断言 / 未决项见卡）']
  if (result.durationMismatch) {
    lines.push(`⚠️ 时长断言：成片与目标相差 ${String(result.deltaSec)}s（> ${String(DELIVER_DURATION_TOLERANCE_SEC)}s 容忍）—— 混规格会话请显性化处理（durationMismatch 已标进 card.json）`)
  }
  if (result.deliveredWithGaps) {
    lines.push('⚠️ 交付卡未决项为空——把未决项写进 PROGRESS「已知未决」再交付，下一会话的续接靠它（card.json 已标 deliveredWithGaps）')
  }
  return lines
}

