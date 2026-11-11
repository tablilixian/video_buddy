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

import type { CompositionManifest, CompositionTrack, TextCardTrack } from './manifest.js'
import { MIN_VISIBLE_OVERLAP_FRAMES } from './normalize-timing.js'
import { motionIntervalsFor, trackMotionFeatures } from './motion-features.js'

export interface MotionLintIssue {
  /** `ML-01` … `ML-15`。 */
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

/** 位移强度（把不同维度折算到同一量纲：1% 位移 ≈ 1，scale 0.1 ≈ 5，rotation 10° ≈ 3.3）。 */
function movementMagnitude(from: Record<string, number>, to: Record<string, number>): number {
  const delta = (key: string, scale: number): number => {
    const a = from[key]
    const b = to[key]
    if (a === undefined || b === undefined) return 0
    // P-05：幅度按 1e-9 取整再比 —— 浮点边界会判反方向（实测
    // |1.0-0.9|×10 = 0.9999999999999998 < 1，恰好达到可见门槛的 opacity
    // 0.9↔1.0 呼吸被误判成"看不见"而照报 ML-04）。
    return Math.round(Math.abs(b - a) * scale * 1e9) / 1e9
  }
  return Math.max(delta('x', 1), delta('y', 1), delta('scale', 50), delta('rotation', 1 / 3), delta('opacity', 10))
}

/**
 * 若干区间的**并集**长度（重叠只算一次），并裁剪到 `[lo, hi)`。
 *
 * ML-10 的「画面在动的时间」必须按并集算：三条轨同帧一起动是 1 帧，不是 3 帧。
 */
function unionLength(
  intervals: ReadonlyArray<{ start: number; end: number }>,
  lo: number,
  hi: number,
): number {
  const clipped = intervals
    .map((iv) => [Math.max(lo, iv.start), Math.min(hi, iv.end)] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0])
  if (clipped.length === 0) return 0
  const first = clipped[0] as readonly [number, number]
  let total = 0
  let curStart = first[0]
  let curEnd = first[1]
  for (let i = 1; i < clipped.length; i += 1) {
    const [s, e] = clipped[i] as readonly [number, number]
    if (s <= curEnd) {
      if (e > curEnd) curEnd = e
      continue
    }
    total += curEnd - curStart
    curStart = s
    curEnd = e
  }
  return total + (curEnd - curStart)
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
    // CV-428 的 reveal.out（帘式退场 / 转场幕布）也是合法退场，不该报硬切（会话 15 恒报 11 条 ML-02 的根因）。
    if (trackMotionFeatures(track).windowKinds.includes('revealOut')) continue
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

  // 1C/1（CV-462/463）：**装饰构件的匀速是设计意图，不是机械感**。
  // 构件展开出的进度条游标表达的就是「时间」—— 给它换缓动等于让游标位置与时间轴不符；
  // 括线 / 刻度 / 星点则是静止的整轨。这些轨的 id 由 `expandFurniture` 生成（统一 `fx-` 前缀），
  // 靠前缀识别而不是新增 `meta` 字段：构件在编译期展开后已经只是普通轨道，渲染器与体检
  // 都不该知道「它是构件」（那会把机制塞进热路径）。
  const FURNITURE_TRACK_PREFIX = 'fx-'
  const isFurnitureTrack = (trackId: string): boolean => trackId.startsWith(FURNITURE_TRACK_PREFIX)

  // REQ-035 F-09：**往复呼吸不是拖沓**。
  // 一条轨的动画首尾状态相同（from ≈ to）说明它是"来回呼吸/循环脉动"，长时长恰恰是
  // 设计意图；ML-04 原判据只看"时长长且位移小"，会把它判成"动画拖沓"，诱导 agent
  // 去改掉正确的环境光/呼吸层（事故里 glowWide/Core/Hot 三条都被误报）。
  //
  // 2026-11-04（科普 0.1 验收 P7）**收紧**：豁免只对**看得见的**呼吸有效。
  // 事故：为消 ML-04，agent 给 19 条轨挂上 `scale 0.994↔1.006` 的往复动画 ——
  // 「首尾同值」一测就豁免，于是"加一段假呼吸"成了消告警的**万能钥匙**；而 1.2% 的
  // 缩放幅度人眼根本读不出来，等于拿画面代价换一条它本来就会主动放弃的 warning
  //（agent 自己事后写道："ML-04 只是 warning 级别，不值得为它牺牲观感"）。
  // 判据：振荡幅度必须**达到可见量级**（`movementMagnitude ≥ 1`）。
  // 换算：x/y 1 个画布百分点、scale 2%、opacity 0.1、rotation 3°。
  const CYCLIC_MIN_VISIBLE_MAGNITUDE = 1
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
      if (first === undefined || last === undefined) continue
      if (!sameState(first.from, last.to)) continue
      // 幅度看得见才算"呼吸"；1% 级的微幅往复只是让画面"看起来有动效"的空动作。
      let amplitude = 0
      for (const segment of list) {
        amplitude = Math.max(amplitude, movementMagnitude(segment.from, segment.to))
      }
      if (amplitude < CYCLIC_MIN_VISIBLE_MAGNITUDE) continue
      cyclicTracks.add(trackId)
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
    if (moving && segment.easing === 'linear' && !isFurnitureTrack(segment.trackId)) {
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

  // ML-10：画面上有东西在动的时间占比过低 ⇒ 幻灯片。
  //
  // REQ-034 O-02：原实现只把 animate/exit/fade/draw 当分子，分母却把**所有轨**算进去
  // —— 素材驱动片（bg 600 + 三镜视频 465 + 波形 600 + 文字卡 656 ≈ 2321 帧）恒判 5%，
  // 真机连报 7 次。一条永远为真的提示 = 噪声，代价是 agent 学会无视整份体检
  // （真出 ML-02 这类硬问题也会被一起跳过）。
  //
  // 2026-11-04（科普 0.1 验收 P7）**换口径**：从「各轨动效时长之和 / 可动轨总时长」
  // 改成「**画面在动的时间** / 整片时长」——各运动区间的**并集**（重叠只算一次）。
  //
  // 旧口径的两个毛病都被真机会话踩到：
  // ① 分母被「设计性静物」灌水：一条静止的标题卡 / 地轴线 / 边框撑满整条轨的时长，
  //    全都算进「可动轨总时长」，把比例压到 10%。agent 收到「画面太静」的告警后，
  //    唯一可行的响应就是给 19 条轨挂 1.2% 缩放的假呼吸 —— **拿画面代价换一条它本来
  //    就会主动放弃的 warning**（实测：剥掉假呼吸后 ML-10 立刻以 10% 报出来）。
  // ② 分子漏算 `reveal` / `exit`：帘式擦除与退场都是画面在动，旧口径一个都不算。
  //
  // 新口径直接回答「这画面有多少时间在动」：静态支撑元素不再稀释分母（它们本来就不该
  // 被要求动效），而擦除显现 / 退场 / 素材播放都计入动效时间。
  //
  // 口径②已由「video 轨按自己就在动计入」覆盖（REQ-034 O-02），保留。
  // #11：分子统一取自动效特征 SSOT —— video 全时长 + animate / exit / reveal /
  // reveal.out / kenburns / anim / draw 的帧区间；旧口径四路手工收集全部收口到这里。
  const motionIntervals: Array<{ start: number; end: number }> = []
  for (const track of tracks) {
    for (const iv of motionIntervalsFor(track)) motionIntervals.push(iv)
  }
  const movingFrames = unionLength(motionIntervals, 0, metaDuration)
  const ratio = metaDuration > 0 ? Math.min(1, movingFrames / metaDuration) : 1
  if (metaDuration > 0 && ratio < 0.3) {
    push({
      code: 'ML-10',
      at: 'manifest',
      message: `画面上有东西在动的时间只占 ${(100 * ratio).toFixed(0)}%（整片 ${metaDuration} 帧）`,
      hint: '静态时长占比 > 70% 会被当成幻灯片；建议给关键元素补入场/强调/退场动效。',
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

  // ML-13：两张文本卡时空双重叠 ⇒ 叠字（甜品复刻会话实测：「热带金」与「微乐甜品」
  // 压在同一块画面上，谁也读不清）。判据刻意收窄，避免误伤正常的标题+副标题堆叠：
  // ① 两张卡都写了显式 `box`（无 box = 铺满卡，版式意图不明确，不判）；
  // ② 时间重叠 ≥ 短轨时长的 60%；
  // ③ 空间重叠面积 ≥ 较小卡面积的 35%。
  // 只产 warning：真要刻意叠字（描边压底）时 `meta.lint: "off"` 可整体关闭。
  {
    const cards = tracks.filter((track): track is TextCardTrack => track.type === 'textCard' && track.box !== undefined)
    for (let i = 0; i < cards.length; i += 1) {
      for (let j = i + 1; j < cards.length; j += 1) {
        const a = cards[i]
        const b = cards[j]
        if (a === undefined || b === undefined) continue
        const overlapStart = Math.max(a.startFrame, b.startFrame)
        const overlapEnd = Math.min(a.startFrame + a.durationInFrames, b.startFrame + b.durationInFrames)
        const timeOverlap = overlapEnd - overlapStart
        const shorter = Math.min(a.durationInFrames, b.durationInFrames)
        if (shorter <= 0 || timeOverlap < shorter * 0.6) continue
        const area = (track: TextCardTrack): number => {
          const box = track.box
          if (box === undefined) return 0
          return Math.max(0, numeric(box.w) ?? 0) * Math.max(0, numeric(box.h) ?? 0)
        }
        const inter = (): number => {
          const ba = a.box
          const bb = b.box
          if (ba === undefined || bb === undefined) return 0
          // box 的 x/y 是**中心**语义 —— 先折算成边缘再求交。
          const ax0 = (numeric(ba.x) ?? 0) - (numeric(ba.w) ?? 0) / 2
          const ax1 = (numeric(ba.x) ?? 0) + (numeric(ba.w) ?? 0) / 2
          const ay0 = (numeric(ba.y) ?? 0) - (numeric(ba.h) ?? 0) / 2
          const ay1 = (numeric(ba.y) ?? 0) + (numeric(ba.h) ?? 0) / 2
          const bx0 = (numeric(bb.x) ?? 0) - (numeric(bb.w) ?? 0) / 2
          const bx1 = (numeric(bb.x) ?? 0) + (numeric(bb.w) ?? 0) / 2
          const by0 = (numeric(bb.y) ?? 0) - (numeric(bb.h) ?? 0) / 2
          const by1 = (numeric(bb.y) ?? 0) + (numeric(bb.h) ?? 0) / 2
          return Math.max(0, Math.min(ax1, bx1) - Math.max(ax0, bx0))
            * Math.max(0, Math.min(ay1, by1) - Math.max(ay0, by0))
        }
        const minArea = Math.min(area(a), area(b))
        if (minArea <= 0 || inter() < minArea * 0.35) continue
        push({
          code: 'ML-13',
          at: `${a.id} × ${b.id}`,
          message: `文本卡「${a.id}」与「${b.id}」时间与空间双重叠（重叠 ≥ ${Math.round((inter() / minArea) * 100)}%）`,
          hint: '文字会互相压字；建议错开 box 位置或时间，或把两段文案合并成一张卡的多行排版。',
        })
      }
    }
  }

  // ML-14：countUp 激活期间数据卡标签写死图表末点标签 ⇒「2025 年 配 0.47」式事实错误
  //（四季片 D-07：数位滚动中卡片固定标终值年份，观众在滚动中段读到 1997 年的值）。
  // 刻意只判「标签文本包含图表末点标签」这一种可机器判定的形态；改法（区间标签 /
  // 滚动结束才出终值年份）是编排自由度，交给 hint。
  {
    const chartLastLabels = new Set<string>()
    for (const track of tracks) {
      if (track.type !== 'chart') continue
      const labels = (track as { labels?: unknown }).labels
      if (Array.isArray(labels) && labels.length > 0) {
        const last = labels[labels.length - 1]
        if (typeof last === 'string' && last !== '') chartLastLabels.add(last)
      }
    }
    if (chartLastLabels.size > 0) {
      // 归一化后**同值**才算写死（剥首尾空白与尾部「年」）：区间标签「1996–2025」
      // 天然包含「2025」子串但语义正确，不能用 includes 判 —— 否则正解被误报。
      const normalize = (s: string): string => s.trim().replace(/年+$/u, '').trim()
      for (const track of tracks) {
        if (track.type !== 'textCard') continue
        const card = track as TextCardTrack
        if (card.variant !== 'dataCard' || card.countUp !== true) continue
        const label = typeof card.text === 'string' ? card.text : ''
        const hit = [...chartLastLabels].find((l) => normalize(label) === normalize(l))
        if (hit === undefined) continue
        push({
          code: 'ML-14',
          at: String(card.id),
          message: `countUp 激活期间卡片标签「${label}」与图表末点标签「${hit}」同值 —— 滚动中段显示的是别的时点的值，构成事实错误组合`,
          hint: '滚动期间标签改用区间（如「1996–2025」）或「滚动中」；终值年份等滚动结束才出现（四季片 D-07）。',
        })
      }
    }
  }

  // ML-15：首帧「半可见」起步（四季片 D-01：title fadeUp from.opacity 0.25、主体从
  // 第 6/14 帧才起 ⇒ 0–0.4s 近全黑）。刻意只判 **(0, 0.35) 的半透明起步**：
  // 从 0 淡入是正常入场（几帧内即过门槛），从 ≥0.35 起是完整可见 —— 只有「既不是
  // 干净入场也不是完整可见」的半截状态才是 D-01 的病灶。判据收在结构层，不猜画面；
  // 退场侧（reveal.out 整屏空）口径未拍，本条只管入场。
  for (const track of tracks) {
    if (track.startFrame !== 0) continue
    for (const raw of animateList(track)) {
      if (!isRecord(raw)) continue
      if ((numeric(raw.startFrame) ?? 0) + track.startFrame !== 0) continue
      const from = isRecord(raw.from) ? raw.from : {}
      const opacity = numeric(from.opacity)
      if (opacity === undefined || opacity <= 0 || opacity >= 0.35) continue
      push({
        code: 'ML-15',
        at: track.id !== undefined ? String(track.id) : 'track',
        message: `轨道在第 0 帧从 opacity ${opacity} 半透明起步 —— 既非干净入场也非完整可见，首帧观感近全黑`,
        hint: '要么从 0 淡入（正常入场），要么首帧完整可见（opacity ≥0.35 起）；半截起步配主体后置 = 开头近全黑（四季片 D-01）。',
      })
      break
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
