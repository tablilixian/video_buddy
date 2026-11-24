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
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SegmentPointer } from './segment-artifacts.js'

/** 交付时长断言容忍（秒）：|actual − target| 超过即标 durationMismatch。D4 拍板 ±1s。 */
export const DELIVER_DURATION_TOLERANCE_SEC = 1

/**
 * A1 响度交付闸（2026-11-24）· 阈值。
 *
 * 为什么要有：`media-probe.ts` 早就在量 `lufs`，但**没有任何一处拿它做阈值判断** ——
 * 2026-11-04 科普 0.1 验收那次事故（TTS 仅 −27 LUFS → 成片 −22.0 → loudnorm 重混 →
 * −14.0，而自检全绿）就是「工具只报数不做判断」的直接代价。这里补的就是那个 `if`。
 */
/** 交付综合响度目标（EBU R128 广播 / 平台通用的 −16 LUFS 档）。 */
export const DELIVER_LUFS_TARGET = -16
/** 响度容忍（LU）：|实测 − 目标| 超过即标 outOfRange。 */
export const DELIVER_LUFS_TOLERANCE_LU = 2
/** 真峰上限（dBTP）：超过即削波风险，且削波**不可逆**（响度能被 loudnorm 救，削波不能）。 */
export const DELIVER_TRUE_PEAK_CEILING_DBTP = -1.5

/** 响度闸的实测输入（全部实测值，没有推断）。 */
export interface LoudnessGateInput {
  /** 实测综合响度 LUFS；null = 未测得（ffmpeg 不可用 / 音频无法解码）。 */
  lufs: number | null
  /** 实测真峰 dBTP；null = 未测得（含静音时的 `-inf`）。 */
  truePeakDbtp: number | null
  /** 产物实测有音轨（`ffmpeg -i` 的 `Audio:` 行）。 */
  hasAudio: boolean
  /** 本次渲染**声明**有音轨（`audioComposition !== 'none'`）。 */
  expectsAudio: boolean
}

/** 响度闸结论：硬 blocker 决定「算不算交付」，软标注只提醒。 */
export interface LoudnessGateResult {
  /** 可交付 = 没有硬 blocker。响度超界**不算** blocker（loudnorm 可救）。 */
  deliverable: boolean
  /** 声明有音轨但产物实测没有 —— 硬 blocker（旁白/BGM 全丢，这是废片）。 */
  audioMissing: boolean
  /** 真峰超过 −1.5 dBTP —— 硬 blocker（削波不可逆）。 */
  truePeakOver: boolean
  /** 综合响度超出 −16±2 —— 软标注（能靠 loudnorm 修）。 */
  lufsOutOfRange: boolean
  /** 响度未测得（不是错，只是这一项没有结论）。 */
  unmeasured: boolean
  /** 硬 blocker 的人话原因（回执用 ❌ 行）。 */
  blockers: string[]
  /** 软标注的人话原因（回执用 ⚠️ 行）。 */
  warnings: string[]
}

/**
 * 响度交付闸的唯一判据实现（纯函数，无 IO —— 反向变异靠它）。
 *
 * 分级依据是「可不可逆」：**削波不可逆**（真峰超标）和**音轨丢失**都不可挽回，所以
 * 拒；响度偏低/偏高能靠 `loudnorm=I=-16:TP=-1.5:LRA=11` 重跑一遍修（`-c:v copy` 不重
 * 编码视频，几秒），所以只标注。
 *
 * 未测得 ≠ 合格：`unmeasured` 单列，卡里能看出「这一项没判」，不会被当成通过。
 */
export function evaluateLoudnessGate(input: LoudnessGateInput): LoudnessGateResult {
  const audioMissing = input.expectsAudio && !input.hasAudio
  const truePeakOver = input.truePeakDbtp !== null
    && input.truePeakDbtp > DELIVER_TRUE_PEAK_CEILING_DBTP
  const unmeasured = !audioMissing && input.lufs === null
  const lufsOutOfRange = input.lufs !== null
    && Math.abs(input.lufs - DELIVER_LUFS_TARGET) > DELIVER_LUFS_TOLERANCE_LU
  const blockers: string[] = []
  if (audioMissing) {
    blockers.push('渲染声明有音轨，但产物实测无音轨 —— 旁白/BGM 全丢（成片在 assets/ 与画布上，可重渲）')
  }
  if (truePeakOver) {
    blockers.push(`真峰 ${String(input.truePeakDbtp)} dBTP 超过 ${String(DELIVER_TRUE_PEAK_CEILING_DBTP)} dBTP —— 削波不可逆`)
  }
  const warnings: string[] = []
  if (lufsOutOfRange) {
    warnings.push(`综合响度 ${String(input.lufs)} LUFS 超出 ${String(DELIVER_LUFS_TARGET)}±${String(DELIVER_LUFS_TOLERANCE_LU)} LU —— 可 loudnorm 修（-c:v copy 不重编码）`)
  }
  if (unmeasured) {
    warnings.push('响度未测得（ffmpeg 不可用或音频无法解码）—— 本项未判，不等于合格')
  }
  return {
    deliverable: blockers.length === 0,
    audioMissing,
    truePeakOver,
    lufsOutOfRange,
    unmeasured,
    blockers,
    warnings,
  }
}

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
  /**
   * A1（2026-11-24）：成片响度与音轨的实测值。**缺省 = 没测**（不判、不标、照旧交付），
   * 这样既有调用点与历史行为零变化；只有调用方真的 probe 过才传。
   */
  loudness?: LoudnessGateInput
  /**
   * R11-B2：分镜路由的段产物指针（`deliver/segments/<id>.mp4`）。
   *
   * 为什么要进卡：用户「改一段」的前提是知道「哪一段是哪个文件」。只在回执里说一次
   * 等于一次性信息 —— 压缩丢上下文后，磁盘上的 card.json 才是唯一可回读的答案。
   * 整片路径（未走分镜）缺省，卡的形状与今天逐字段一致。
   */
  segments?: SegmentPointer[]
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
  /**
   * A1：响度闸拒绝了这次交付 ⇒ **没有**覆盖写 `deliver/final.mp4`（卡照写）。
   * 成片本身在 `assets/` 与画布节点上，不受影响；`finalIsStale` 说明磁盘上的
   * final.mp4 是上一版（读卡的人别把它当本次产物）。
   */
  rejected: boolean
  /** rejected 时 deliver/final.mp4 是否残留上一版（未被本次覆盖）。 */
  finalIsStale: boolean
  /** 响度闸结论；没传 loudness 时为 null（不判）。 */
  loudness: LoudnessGateResult | null
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
  /**
   * A1：交付裁决。`deliverable=false` ⇒ `deliver/final.mp4` **没有被本次覆盖**
   * （仍指向上一版或不存在），成片在 `pointers` 指向的 assets 里。没测响度时恒为
   * `{deliverable:true, blockers:[]}`——不判即放行，保持 A1 之前的语义。
   */
  verdict: { deliverable: boolean; blockers: string[]; finalIsStale: boolean }
  /** A1：响度实测与判据明细（没测则整段缺省）。阈值一并落盘，读卡不必翻源码。 */
  loudnessCheck?: {
    targetLufs: number
    toleranceLu: number
    truePeakCeilingDbtp: number
    measuredLufs: number | null
    measuredTruePeakDbtp: number | null
    expectsAudio: boolean
    hasAudio: boolean
    lufsOutOfRange: boolean
    truePeakOver: boolean
    audioMissing: boolean
    unmeasured: boolean
    warnings: string[]
  }
  pointers: { url: string; assetFile: string; nodeId: string | null }
  /**
   * R11-B2：段产物清单（分镜路由才有）。`file` 是**相对项目根**的路径 ——
   * 卡要能跟着项目搬，绝对路径一搬就废。
   */
  segments?: SegmentPointer[]
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
  // A1：只在调用方真的测过时才判（缺省 = 不判，行为与 A1 之前一致）。
  const gate = input.loudness === undefined ? null : evaluateLoudnessGate(input.loudness)
  const rejected = gate !== null && !gate.deliverable
  const finalIsStale = rejected && existsSync(finalPath)
  try {
    mkdirSync(deliverDir, { recursive: true })
    // A1：硬闸拒收 ⇒ **不覆盖** final.mp4（削波不可逆、音轨丢失的片不配当权威交付）。
    // 但卡照写 —— 拒绝的理由必须落盘，否则「deliver/ 为什么没更新」只能靠猜。
    // 成片本身在 assets/ 与画布节点上，不陪葬（沿用 D4）。
    if (!rejected) copyFileSync(input.sourceFile, finalPath)
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
      verdict: {
        deliverable: gate === null ? true : gate.deliverable,
        blockers: gate === null ? [] : gate.blockers,
        finalIsStale,
      },
      ...(input.loudness === undefined || gate === null ? {} : {
        loudnessCheck: {
          targetLufs: DELIVER_LUFS_TARGET,
          toleranceLu: DELIVER_LUFS_TOLERANCE_LU,
          truePeakCeilingDbtp: DELIVER_TRUE_PEAK_CEILING_DBTP,
          measuredLufs: input.loudness.lufs,
          measuredTruePeakDbtp: input.loudness.truePeakDbtp,
          expectsAudio: input.loudness.expectsAudio,
          hasAudio: input.loudness.hasAudio,
          lufsOutOfRange: gate.lufsOutOfRange,
          truePeakOver: gate.truePeakOver,
          audioMissing: gate.audioMissing,
          unmeasured: gate.unmeasured,
          warnings: gate.warnings,
        },
      }),
      pointers: { url: input.url, assetFile: input.assetFile, nodeId: input.nodeId },
      ...(input.segments === undefined || input.segments.length === 0 ? {} : { segments: input.segments }),
    }
    writeFileSync(cardPath, JSON.stringify(card, null, 2), 'utf8')
    return {
      written: true,
      finalPath,
      cardPath,
      deliveredWithGaps,
      durationMismatch,
      deltaSec,
      rejected,
      finalIsStale,
      loudness: gate,
    }
  } catch (cause) {
    const note = cause instanceof Error ? cause.message : String(cause)
    return {
      written: false,
      finalPath,
      cardPath,
      deliveredWithGaps,
      durationMismatch,
      deltaSec,
      rejected,
      finalIsStale,
      loudness: gate,
      note: `权威交付写入失败（成片不受影响）：${note}`,
    }
  }
}

/** 交付结果 → 渲染回执的 warnings 行（空数组 = 无话可说）。 */
export function deliveryReceiptLines(result: DeliverableResult | null): string[] {
  if (result === null) return []
  if (!result.written) return [`⚠️ ${result.note as string}`]
  const lines: string[] = result.rejected
    ? [
      '❌ 权威交付被拒：card.json 已写，deliver/final.mp4 **未更新**'
      + (result.finalIsStale ? '（磁盘上那份仍是上一版，别当本次产物）' : '（本次没有生成）')
      + ' —— 成片本身在 assets/ 与画布节点上，不受影响',
    ]
    : ['📦 权威交付：deliver/final.mp4 + card.json（版本 / 时长断言 / 未决项见卡）']
  // A1：响度闸的分级文案 —— ❌ 硬 blocker（拒收原因）/ ⚠️ 软标注（照交付但要修）
  for (const blocker of result.loudness?.blockers ?? []) lines.push(`❌ ${blocker}`)
  for (const warning of result.loudness?.warnings ?? []) lines.push(`⚠️ ${warning}`)
  if (result.durationMismatch) {
    lines.push(`⚠️ 时长断言：成片与目标相差 ${String(result.deltaSec)}s（> ${String(DELIVER_DURATION_TOLERANCE_SEC)}s 容忍）—— 混规格会话请显性化处理（durationMismatch 已标进 card.json）`)
  }
  if (result.deliveredWithGaps) {
    lines.push('⚠️ 交付卡未决项为空——把未决项写进 PROGRESS「已知未决」再交付，下一会话的续接靠它（card.json 已标 deliveredWithGaps）')
  }
  return lines
}

