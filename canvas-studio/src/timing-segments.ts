/**
 * 复刻提效批四（Q2+Q3，REQ-036 续，2026-11-02）—— `render_composition` 的
 * 拆解时序 / 元素覆盖双闸。
 *
 * Q2 段落时序闸：成片渲完后用 `verifyTeardown`（B3 同一算法，见 teardown-verify.ts）
 * 实测**成片**的画面切换点，与拆解段起点比对 —— 漂移超窗的段落报警（甜品会话 v2
 * 全程漂移 0.5–1s 无人发现）。抽样 4fps（0.25s 分辨率）+ 0.45s 窗口：量化误差
 * ≤0.125s，真实漂移 >~0.3s 即 unmatched，对齐「时序闸 ±0.3s」口径。
 *
 * Q3 素材覆盖闸：拆解段每段带 `elements`（拆解表「元素与动效」列逐元素一条），
 * 宿主数每段时间窗里的「动画轨」—— 少于元素数 = 有元素没落地（铁律「每个会动的
 * 元素 = 一条独立轨」；v2 装饰层近零的教训）。纯启发式、只警告不阻断：模型可以
 * 补轨，也可以修正 elements 列（素材内部运动不必单列）。
 *
 * 纯函数（解析 / 判定 / 汇总）与 IO（ffmpeg 抽帧在 teardown-verify）分离；
 * render-job 只做薄接线。
 */
import { throwError } from './error-system.js'
import type { CompositionManifest } from './remotion/manifest.js'
import type { TeardownSegment, TeardownVerifyResult } from './teardown-verify.js'

/** 拆解段（与 verify_teardown 的入参同构，多一个可选 elements 列）。 */
export interface TimingSegment extends TeardownSegment {
  /**
   * 该段的动效元素清单（拆解表「元素与动效」列逐条）。素材内部运动（生视频里
   * 自带的人物动作等）不必单列 —— 单列了只会让覆盖核对误报。
   */
  elements?: string[]
}

/** Q2 抽样帧率：4fps = 0.25s 分辨率（B3 缺省 2fps 的 0.5s 量化会吃掉 ±0.3s 闸口）。 */
export const TIMING_CHECK_SAMPLE_FPS = 4
/** Q2 匹配窗口：0.45s ≈ 抽样量化 ±0.125s + 漂移报警阈值 0.3s。 */
export const TIMING_CHECK_TOLERANCE_SEC = 0.45

/**
 * `timingSegments` 入参解析：undefined / 空数组返回 undefined（未启用）；
 * 形状非法显式拒收（零副作用 —— 拒收发生在建渲染工单之前）。
 * 宽容点：label 缺省按序号补；elements 非法项过滤而非拒收（清单是给覆盖核对用的）。
 */
export function parseTimingSegments(raw: unknown): TimingSegment[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) {
    throwError('CS-USER-ERR', { message: 'timingSegments 必须是数组（[{label, startSec, endSec, elements?}]）。' })
  }
  const segments: TimingSegment[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const r = item as Record<string, unknown>
    const label = typeof r.label === 'string' && r.label.trim() !== '' ? r.label.trim() : `段${segments.length + 1}`
    const startSec = typeof r.startSec === 'number' && Number.isFinite(r.startSec) ? r.startSec : Number.NaN
    const endSec = typeof r.endSec === 'number' && Number.isFinite(r.endSec) ? r.endSec : Number.NaN
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
      throwError('CS-USER-ERR', {
        message: `timingSegments 段「${label}」起止非法（${String(r.startSec)}–${String(r.endSec)}），需要 startSec < endSec（0.1s 精度）。`,
      })
    }
    const elements = Array.isArray(r.elements)
      ? r.elements.filter((e): e is string => typeof e === 'string' && e.trim() !== '').map((e) => e.trim())
      : undefined
    segments.push({
      label,
      startSec,
      endSec,
      ...(elements !== undefined && elements.length > 0 ? { elements } : {}),
    })
  }
  return segments.length > 0 ? segments : undefined
}

/** 任一轨型的最小判定面（manifest 各轨共有的动效字段都在 BaseTrack 上）。 */
type AnyTrack = CompositionManifest['tracks'][number]

/**
 * 「这条轨算不算动画轨」—— Q3 覆盖计数的唯一判据。
 *
 * - 有 `animate` / `orbit` ⇒ 动（5 类轨通用的显式动效声明）；
 * - image：`fit: 'kenburns'` 算动（推近是运动），纯 cover/contain 静帧**不算**
 *   （「静帧图 fade 轮播」正是 Q3 要抓的反模式）；
 * - textCard：`anim` 入场动效算动，纯静态标题不算；
 * - shape：`draw`（描画生长）算动，纯静态色块不算；
 * - transition 不算（转场是镜间衔接，拆解表有独立「转场入」列，不该顶元素数）；
 * - video / chart / caption / audioViz 本身就是运动内容 ⇒ 算动。
 */
export function trackIsAnimated(track: AnyTrack): boolean {
  if (track.animate !== undefined || track.orbit !== undefined) return true
  if (track.type === 'image') return track.fit === 'kenburns'
  if (track.type === 'textCard') return track.anim !== undefined
  if (track.type === 'shape') return track.draw !== undefined
  if (track.type === 'transition') return false
  return true
}

/** 一段的覆盖核对结论（animatedTracks < elements 才成立）。 */
export interface ElementCoverageIssue {
  label: string
  startSec: number
  endSec: number
  /** 拆解表声明的元素数。 */
  elements: number
  /** 时间窗内实测动画轨数。 */
  animatedTracks: number
}

/**
 * Q3 覆盖核对：每段 [startSec·fps, endSec·fps) 时间窗内数动画轨，少于该段
 * elements 数即记一条 issue。没有 elements 的段跳过（时序段可单独用于 Q2）。
 */
export function checkElementCoverage(
  manifest: CompositionManifest,
  segments: readonly TimingSegment[],
  fps: number,
): ElementCoverageIssue[] {
  if (fps <= 0) return []
  const issues: ElementCoverageIssue[] = []
  for (const segment of segments) {
    if (segment.elements === undefined) continue
    const winStart = segment.startSec * fps
    const winEnd = segment.endSec * fps
    let animated = 0
    for (const track of manifest.tracks) {
      const trackEnd = track.startFrame + track.durationInFrames
      if (track.startFrame < winEnd && trackEnd > winStart && trackIsAnimated(track)) animated += 1
    }
    if (animated < segment.elements.length) {
      issues.push({
        label: segment.label,
        startSec: segment.startSec,
        endSec: segment.endSec,
        elements: segment.elements.length,
        animatedTracks: animated,
      })
    }
  }
  return issues
}

/** 覆盖核对告警文案（拼进 render_composition 的 warnings，非阻断）。 */
export function coverageWarningText(issue: ElementCoverageIssue): string {
  const deficit = issue.elements - issue.animatedTracks
  return `[素材覆盖] 段「${issue.label}」(${issue.startSec.toFixed(1)}–${issue.endSec.toFixed(1)}s)`
    + ` 拆解表列了 ${issue.elements} 个动效元素，段内只有 ${issue.animatedTracks} 条动画轨（差 ${deficit}）。`
    + '铁律「每个会动的元素 = 一条独立轨」：给漏掉的元素补轨（shape / image / textCard…），'
    + '或修正 timingSegments 的 elements 列（该元素是素材内部运动就不必单列）。'
}

/** Q2 回核结果的压缩形态（进 `report.timingCheck`，模型按它逐段校准）。 */
export interface TimingCheckSummary {
  ok: boolean
  matched: number
  unmatched: number
  extraSwitches: number
  /** 段落边界逐条结论（首段不核）。 */
  boundaries: Array<{
    label: string
    tableSec: number
    status: 'matched' | 'unmatched'
    measuredSec?: number
    deltaSec?: number
  }>
}

/** TeardownVerifyResult → 报告形态（去掉抽帧细节，只留结论）。 */
export function summarizeTimingCheck(result: TeardownVerifyResult): TimingCheckSummary {
  const boundaries = result.boundaries.map((b) => ({
    label: b.label,
    tableSec: b.tableSec,
    status: b.status,
    ...(b.measuredSec !== undefined ? { measuredSec: b.measuredSec } : {}),
    ...(b.deltaSec !== undefined ? { deltaSec: b.deltaSec } : {}),
  }))
  return {
    ok: result.ok,
    matched: boundaries.filter((b) => b.status === 'matched').length,
    unmatched: boundaries.filter((b) => b.status === 'unmatched').length,
    extraSwitches: result.extraSwitches.length,
    boundaries,
  }
}

/**
 * Q2 告警文案：unmatched（窗内找不到切换）/ 大漂移（matched 但 |delta| > 0.3s ——
 * 时序闸口径；注意 ok=true 时也可能有漂移，不能因 ok 提前返回）/ extraSwitches
 * （表外切换）三类，各自一行；全对齐返回空。
 */
export function timingCheckWarnings(summary: TimingCheckSummary): string[] {
  const lines: string[] = []
  const missing = summary.boundaries.filter((b) => b.status === 'unmatched')
  if (missing.length > 0) {
    lines.push(
      `[时序回核] ${missing.length} 处段落边界在成片里 ±${TIMING_CHECK_TOLERANCE_SEC}s 内找不到画面切换：`
      + missing.map((b) => `「${b.label}」@${b.tableSec.toFixed(1)}s`).join('、')
      + ' —— 按轨道 startFrame = 秒×fps 重排该段（时序闸 ±0.3s）。',
    )
  }
  const drifted = summary.boundaries.filter(
    (b) => b.status === 'matched' && Math.abs(b.deltaSec ?? 0) > 0.3,
  )
  if (drifted.length > 0) {
    lines.push(
      `[时序回核] ${drifted.length} 处段落边界漂移超 0.3s：`
      + drifted.map((b) => `「${b.label}」实测 ${b.measuredSec?.toFixed(1)}s vs 表 ${b.tableSec.toFixed(1)}s（${(b.deltaSec ?? 0) > 0 ? '+' : ''}${(b.deltaSec ?? 0).toFixed(2)}s）`).join('、')
      + ' —— 校准对应轨道的 startFrame 后重渲。',
    )
  }
  if (summary.extraSwitches > 0) {
    lines.push(
      `[时序回核] 成片里有 ${summary.extraSwitches} 处拆解表之外的画面切换 —— 疑似漏段或多余轨，`
      + '对照 report.timingCheck 与拆解表逐段核对。',
    )
  }
  return lines
}
