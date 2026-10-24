/**
 * 三期 W1-3：**编排体检**（motion lint，纯函数，零 Remotion 依赖）。
 *
 * ## 为什么它是三期最便宜的一项
 * `validateManifest` 只查「结构合法」；合法但难看的片子照样能渲：6 个元素同帧冒出、
 * 动画只跑 3 帧（观感是抖动）、元素有进无出最后硬切。这些错误**没有任何一方告诉模型**。
 * 把专业动效纪律做成 lint，比写进 skill 有效 10 倍 —— **skill 是建议，lint 是回执**。
 *
 * ## 纪律（D-10 选 A）
 * - **只产 warning，绝不阻断**：拒收会造出「合法片渲不出来」的假缺陷；
 * - 文案带 hint（「建议…」），不是命令；
 * - 上限 12 条，超出折成汇总；
 * - `meta.lint: "off"` 可整体关闭（刻意的写法不被噪声淹没）。
 */

import type { CompositionManifest, CompositionTrack, ShapeTrack } from './manifest.js'
import { MIN_VISIBLE_OVERLAP_FRAMES } from './normalize-timing.js'

export interface MotionLintIssue {
  /** `ML-01` … `ML-12`。 */
  code: string
  /** 回执主文案（说清「哪里」+「为什么不好」）。 */
  message: string
  /** 定位（轨 id / 轨道序号）。 */
  at: string
  /** 可执行建议（不强制）。 */
  hint: string
}

/** 单条轨的动画段（绝对帧，供重叠统计与规则判定）。 */
interface AbsoluteSegment {
  trackId: string
  start: number
  end: number
  easing: string
  from: Record<string, number>
  to: Record<string, number>
}

const MAX_ISSUES = 12

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function animateList(track: CompositionTrack): unknown[] {
  const raw = (track as { animate?: unknown }).animate
  if (raw === undefined) return []
  return Array.isArray(raw) ? raw : [raw]
}

function collectSegments(track: CompositionTrack, index: number): AbsoluteSegment[] {
  const trackDuration = Math.max(1, Math.floor(track.durationInFrames))
  const segments: AbsoluteSegment[] = []
  for (const raw of animateList(track)) {
    if (!isRecord(raw)) continue
    const startFrame = numeric(raw.startFrame) ?? 0
    const duration = numeric(raw.durationInFrames) ?? trackDuration
    if (!Number.isFinite(duration) || duration <= 0) continue
    const absoluteStart = track.startFrame + startFrame
    segments.push({
      trackId: track.id !== undefined ? String(track.id) : `tracks[${index}]`,
      start: absoluteStart,
      end: absoluteStart + duration,
      easing: typeof raw.easing === 'string' ? raw.easing : 'easeInOut',
      from: isRecord(raw.from) ? pickNumbers(raw.from) : {},
      to: isRecord(raw.to) ? pickNumbers(raw.to) : {},
    })
  }
  return segments
}

function pickNumbers(value: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = raw
  }
  return out
}

/**
 * 两个视觉状态是否近似相同（识别「往复呼吸」用）。
 *
 * 容差 0.6 是**显示级**差异：x/y 是 0–100 的百分比、opacity 是 0–1，
 * 半个百分点以内人眼分不出，够判"首尾回到原点"。任一维度只在一侧出现
 * 就判不同 —— 那是"覆盖了一个维度"，不是回到起点。
 */
function sameState(a: Record<string, number>, b: Record<string, number>, tolerance = 0.6): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  if (keys.size === 0) return true
  for (const key of keys) {
    const va = a[key]
    const vb = b[key]
    if (va === undefined || vb === undefined) return false
    if (Math.abs(va - vb) > tolerance) return false
  }
  return true
}

/** 位移强度（把不同维度折算到同一量纲：1% 位移 ≈ 1，scale 0.1 ≈ 5，rotation 10° ≈ 3.3）。 */function movementMagnitude(from: Record<string, number>, to: Record<string, number>): number {
  const delta = (key: string, scale: number): number => {
    const a = from[key]
    const b = to[key]
    if (a === undefined || b === undefined) return 0
    return Math.abs(b - a) * scale
  }
  return Math.max(delta('x', 1), delta('y', 1), delta('scale', 50), delta('rotation', 1 / 3), delta('opacity', 10))
}

/** 满画布背景板（`box` 的 x/y 是中心，w/h ≥ 95% 即铺满）。 */
function isFullCanvasBackdrop(track: ShapeTrack): boolean {
  const box = track.box
  if (box === undefined) return false
  const w = numeric(box.w)
  const h = numeric(box.h)
  return w !== undefined && h !== undefined && w >= 95 && h >= 95
}

/**
 * 常驻装饰轨：满画布背景板 / 整片长的 `audioViz`，**且自己没写 animate/exit**。
 *
 * 这类轨不该被要求「补动效」（动它反而怪），也不进 ML-10 分母。一旦作者确实给它写了
 * animate / exit，就照常计入 —— 否则会出现「分子在涨、分母不涨」的虚高比例。
 */
function isResidentDecoration(track: CompositionTrack, metaDuration: number): boolean {
  if (animateList(track).length > 0 || track.exit !== undefined) return false
  if (track.type === 'audioViz') return track.durationInFrames >= metaDuration * 0.9
  if (track.type === 'shape') return isFullCanvasBackdrop(track)
  return false
}

/**
 * 体检整份 manifest（纯函数）。返回空数组 = 没有意见。
 */
export function lintMotion(manifest: CompositionManifest): MotionLintIssue[] {
  if (manifest.meta?.lint === 'off') return []
  const issues: MotionLintIssue[] = []
  // REQ-035 F-09：同一 (code, at) 只留一条。
  // 原实现按**分段**逐条 push，于是「一条轨上有 3 段长呼吸动画」会产出 3 条一模一样的
  // ML-04（2026-10-24 事故里 3 条 glow 轨刷出 14 条），把真正该看的告警挤出 MAX_ISSUES。
  const seen = new Set<string>()
  const push = (issue: MotionLintIssue): void => {
    const key = `${issue.code}|${issue.at}`
    if (seen.has(key)) return
    seen.add(key)
    if (issues.length < MAX_ISSUES) issues.push(issue)
  }
  const tracks = manifest.tracks.filter((track) => track.type !== 'transition')
  const transitionTracks = manifest.tracks.filter((track) => track.type === 'transition')
  const metaDuration = Math.max(1, Math.floor(manifest.meta?.durationInFrames ?? 1))

  // ML-01：≥3 条内容轨同帧入场且都带动画 ⇒ 观感「一起冒出来」。
  const byStart = new Map<number, CompositionTrack[]>()
  for (const track of tracks) {
    if (animateList(track).length === 0) continue
    const start = track.startFrame
    const list = byStart.get(start) ?? []
    list.push(track)
    byStart.set(start, list)
  }
  for (const [start, list] of byStart) {
    if (list.length < 3) continue
    push({
      code: 'ML-01',
      at: `startFrame=${start}`,
      message: `${list.length} 条轨在同一帧（${start}）同时开始动画：${list.map((t) => t.id).join(' / ')}`,
      hint: '建议错峰 3–6 帧，或用 startAfter 让后一条接在前一条后面，画面才有主次。',
    })
  }

  // ML-02：轨在片尾前结束、硬切（fadeFrames:0）、无 exit、无尾部转场 ⇒ 凭空消失。
  const transitionTouchingEnd = new Set<string>()
  for (const track of transitionTracks) {
    if (track.type !== 'transition') continue
    const end = track.startFrame + track.durationInFrames
    if (end >= metaDuration - 2) {
      transitionTouchingEnd.add(track.fromTrackId)
      transitionTouchingEnd.add(track.toTrackId)
    }
  }
  for (const track of tracks) {
    if (track.exit !== undefined) continue
    const end = track.startFrame + track.durationInFrames
    if (end >= metaDuration - 1) continue
    if (transitionTouchingEnd.has(track.id)) continue
    // 缺省 fadeFrames 是 6（会淡出）；只有显式 0 才算硬切。
    if (track.fadeFrames !== 0) continue
    push({
      code: 'ML-02',
      at: track.id,
      message: `轨「${track.id}」在第 ${end} 帧戛然而止（fadeFrames:0 且无 exit / 尾部转场）`,
      hint: '建议加 exit（如 {"to":{"opacity":0,"y":44},"durationInFrames":8}）让元素先动再离开。',
    })
  }

  const segments: AbsoluteSegment[] = []
  tracks.forEach((track, index) => { segments.push(...collectSegments(track, index)) })

  // REQ-035 F-09：**往复呼吸不是拖沓**。
  // 一条轨的动画首尾状态相同（from ≈ to）说明它是"来回呼吸/循环脉动"，长时长恰恰是
  // 设计意图；ML-04 原判据只看"时长长且位移小"，会把它判成"动画拖沓"，诱导 agent
  // 去改掉正确的环境光/呼吸层（事故里 glowWide/Core/Hot 三条都被误报）。
  const cyclicTracks = new Set<string>()
  {
    const byTrack = new Map<string, AbsoluteSegment[]>()
    for (const segment of segments) {
      const list = byTrack.get(segment.trackId) ?? []
      list.push(segment)
      byTrack.set(segment.trackId, list)
    }
    for (const [trackId, list] of byTrack) {
      if (list.length < 2) continue
      const first = list[0]
      const last = list[list.length - 1]
      if (first !== undefined && last !== undefined && sameState(first.from, last.to)) cyclicTracks.add(trackId)
    }
  }

  for (const segment of segments) {
    const duration = segment.end - segment.start
    // ML-03：动画太短 ⇒ 观感是抖动（30fps 下 0.2s）。
    if (duration < 6) {
      push({
        code: 'ML-03',
        at: segment.trackId,
        message: `轨「${segment.trackId}」有一段动画只有 ${duration} 帧`,
        hint: '低于 6 帧（30fps 下 0.2s）观感是抖动；建议 ≥ 10 帧。',
      })
    }
    // ML-04：动画太长且几乎不动 ⇒ 拖沓。往复呼吸轨豁免（见 cyclicTracks）。
    if (!cyclicTracks.has(segment.trackId) && duration > 45 && movementMagnitude(segment.from, segment.to) < 10) {
      push({
        code: 'ML-04',
        at: segment.trackId,
        message: `轨「${segment.trackId}」的动画长 ${duration} 帧但位移极小`,
        hint: '建议压到 18–30 帧，或给出更明确的位移/缩放。',
      })
    }
    // ML-05：有位移/缩放却用 linear ⇒ 机械感。
    const moving = segment.from.x !== undefined || segment.from.y !== undefined ||
      segment.from.scale !== undefined || segment.from.rotation !== undefined ||
      segment.to.x !== undefined || segment.to.y !== undefined ||
      segment.to.scale !== undefined || segment.to.rotation !== undefined
    if (moving && segment.easing === 'linear') {
      push({
        code: 'ML-05',
        at: segment.trackId,
        message: `轨「${segment.trackId}」的位移/缩放用了 linear`,
        hint: '建议 easeOutCubic / easeOutExpo（入场）或 easeInOutCubic（往复）。',
      })
    }
    // ML-09：动画端点越出画布。
    for (const side of ['from', 'to'] as const) {
      const state = side === 'from' ? segment.from : segment.to
      const x = state.x
      const y = state.y
      if ((x !== undefined && (x < 0 || x > 100)) || (y !== undefined && (y < 0 || y > 100))) {
        push({
          code: 'ML-09',
          at: segment.trackId,
          message: `轨「${segment.trackId}」的 ${side}.x/y 超出 0–100（x=${String(x)}, y=${String(y)}）`,
          hint: '元素会跑出画布；若刻意要做画外进场，请确认起点仍在画布附近（如 -10 ~ 110）。',
        })
      }
    }
  }

  // ML-06：转场窗口太短。下限与 `startAfter` 的重叠提示同源（`MIN_VISIBLE_OVERLAP_FRAMES`）：
  // 写 `gapFrames:-4` 造出的 4 帧重叠，正是这条规则要报的「看不见」。
  for (const track of transitionTracks) {
    if (track.type !== 'transition') continue
    if (track.durationInFrames < MIN_VISIBLE_OVERLAP_FRAMES) {
      push({
        code: 'ML-06',
        at: track.id,
        message: `转场「${track.id}」只有 ${track.durationInFrames} 帧`,
        hint: `低于 ${MIN_VISIBLE_OVERLAP_FRAMES} 帧肉眼几乎看不见；建议 12–20 帧。用 startAfter 叠化时把 gapFrames 设成与转场时长同值（如 -12）。`,
      })
    }
  }

  // ML-07：同帧 ≥4 条轨在动 ⇒ 主次不清。
  const events: { frame: number; trackId: string }[] = []
  for (const segment of segments) {
    const trackId = segment.trackId
    // 只记开始与结束（区间并发的最大值必出现在某个端点）。
    events.push({ frame: segment.start, trackId })
    events.push({ frame: segment.end, trackId })
  }
  const uniqueFrames = [...new Set(events.map((event) => event.frame))].sort((a, b) => a - b)
  for (const frame of uniqueFrames) {
    const active = new Set<string>()
    for (const segment of segments) {
      if (frame >= segment.start && frame < segment.end) active.add(segment.trackId)
    }
    if (active.size >= 4) {
      push({
        code: 'ML-07',
        at: `frame=${frame}`,
        message: `第 ${frame} 帧有 ${active.size} 条轨同时在动`,
        hint: '建议 1 主 2 次：同一时刻最多 2–3 个元素有动效，其余保持静止。',
      })
      break
    }
  }

  // ML-08：全片没有任何退场。
  const exitCount = tracks.filter((track) => track.exit !== undefined).length
  if (exitCount === 0 && tracks.length >= 5) {
    push({
      code: 'ML-08',
      at: 'manifest',
      message: `全片 ${tracks.length} 条轨，没有任何 exit`,
      hint: '画面会越叠越满、最后硬切；建议至少给主要元素加退场（比进场快 40%）。',
    })
  }

  // ML-10：静态时长占比过高 ⇒ 幻灯片。
  //
  // REQ-034 O-02：原实现只把 animate/exit/fade/draw 当分子，分母却把**所有轨**算进去
  // —— 素材驱动片（bg 600 + 三镜视频 465 + 波形 600 + 文字卡 656 ≈ 2321 帧）恒判 5%，
  // 真机连报 7 次。一条永远为真的提示 = 噪声，代价是 agent 学会无视整份体检
  // （真出 ML-02 这类硬问题也会被一起跳过）。
  //
  // 现口径（两条同时生效）：
  // ① **video 轨按「自己就在动」计入分子**（它不该被要求写 animate，也不该被当成静态）；
  // ② 分母排除常驻装饰轨（满画布 shape / 整片长 audioViz）。
  //
  // 之所以不再保留方案里的「video 占比 > 40% 直接不判」兜底：在口径 ① 之下它恒真已无作用
  // （video 占比 > 40% ⇒ 比例本身必 > 40% ⇒ 本来就不报警）。留着是测不出来的死分支。
  const movingByTrack = new Map<string, number>()
  for (const segment of segments) {
    const key = segment.trackId
    movingByTrack.set(key, (movingByTrack.get(key) ?? 0) + Math.max(0, segment.end - segment.start))
  }
  let movingFrames = 0
  let totalTrackFrames = 0
  tracks.forEach((track, index) => {
    const duration = Math.max(0, track.durationInFrames)
    if (track.type === 'video') {
      totalTrackFrames += duration
      movingFrames += duration
      return
    }
    if (isResidentDecoration(track, metaDuration)) return
    totalTrackFrames += duration
    movingFrames += movingByTrack.get(track.id !== undefined ? String(track.id) : `tracks[${index}]`) ?? 0
  })
  const ratio = totalTrackFrames > 0 ? Math.min(1, movingFrames / totalTrackFrames) : 1
  if (totalTrackFrames > 0 && ratio < 0.3) {
    push({
      code: 'ML-10',
      at: 'manifest',
      message: `动效覆盖仅占可动轨总时长的 ${(100 * ratio).toFixed(0)}%`,
      hint: '静态时长占比 > 70% 会被当成幻灯片；建议给关键元素补入场/强调动画。',
    })
  }

  // ML-11 / ML-12：字幕安全区（引擎侧只排 3 行；单行过长会压字）。
  for (const track of tracks) {
    if (track.type !== 'textCard' || track.variant !== 'subtitle') continue
    const raw = track.text
    const lines = Array.isArray(raw) ? raw : [raw]
    if (lines.length > 3) {
      push({
        code: 'ML-11',
        at: track.id,
        message: `字幕卡「${track.id}」有 ${lines.length} 行`,
        hint: '字幕安全区最多 3 行（1080p 建议 2 行）；建议拆成多条字幕卡。',
      })
    }
    for (const line of lines) {
      if ([...String(line)].length > 28) {
        push({
          code: 'ML-12',
          at: track.id,
          message: `字幕卡「${track.id}」单行超过 28 字`,
          hint: '建议按语义断句（每句 ≤ 20 字），否则字号会被压到很小。',
        })
        break
      }
    }
  }

  if (issues.length === MAX_ISSUES) {
    issues.push({
      code: 'ML-00',
      at: 'manifest',
      message: `编排体检结果过多，仅显示前 ${MAX_ISSUES} 条`,
      hint: '先修最靠前的几条（通常同源），其余会自动消失。',
    })
  }
  return issues
}

/** 体检结果转成 `warnings` 文案（并入工具结果）。 */
export function formatMotionLint(issues: readonly MotionLintIssue[]): string[] {
  // 文案拼法：`[编号] 定位：问题` + `。` + `建议`。中间那个句号不能省 ——
  // message 与 hint 都不带句末标点，直接空格拼会读成一句（「…的 0% 静态时长占比 > 70% 会…」）。
  return issues.map((issue) => `[编排体检 ${issue.code}] ${issue.at}：${issue.message}。${issue.hint}`)
}
