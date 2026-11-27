/**
 * ORB 类目 · 轨道 / 中心体运动演示（D3-b · 2026-11-26 配方正确用法开发文档 §4.1）。
 *
 * ## 位置来源（D3-b 拍板）
 *
 * - **椭圆**（|rx − ry| > 0.5）→ 多段 `animate` **折线采样真椭圆**：参数方程采样、
 *   段窗首尾相接、Σ durationInFrames = 轨长、相邻段 `to == from`（单向连续）。
 *   `OrbitMotion` 只有单一 `radius`（正圆）—— **绝不给 orbit 写 radiusX/radiusY**。
 * - **正圆** → 一行 `orbit` 轨（省体积）；`scale` 段可与 orbit 同轨叠加
 *   （`orbitPositionConflict` 只拦 from/to 的 x/y，scale 不触发）。
 *
 * ## 近远点尺寸 / 停顿
 *
 * `scaleNearFar > 1` 时按 `periodInFrames / 2` 分两段（近→远、远→近），相位由近点
 * 角度对齐；与位置维度同数组混排（CV-336 按维度独立选段，互不覆盖）。首尾各一
 * from == to 静止段近似 D3 的「停一下」；**不做**开普勒近日点变速 —— 匀速是诚实的
 * 简化，不把错误认知产品化。
 *
 * ## 卡内结构自检（反变异 7 / 8 的红源）
 *
 * 产物逐轨断言：orbit 键合法（无 radiusX/radiusY/angle）、animate 段不含 orbit 键、
 * 位置折线段窗相接且末段贴轨长。违例即 `CS-DEV-ERR`，结构错误不留到渲染。
 */
import { throwError } from '../error-system.js'
import { readDataNum, registerCard } from './recipe-cards.js'
import type { CardRenderContext } from './recipe-cards.js'

/** 中心体略偏上，给底部 caption 留呼吸位。 */
const CENTER_X = 50
const CENTER_Y = 46
/** 正圆判定（百分点半轴差）：差值 ≤ 该值走 `orbit` 一行，否则走折线。 */
const CIRCLE_EPS = 0.5
/** 每圈首尾静止帧上限（近似「停一下」）。 */
const HOLD_MAX = 12
/** 折线采样点数上下限（自适应 N = ⌈π / arccos(1 − tol / r)⌉，tol = 2px）。 */
const SAMPLE_MIN = 16
const SAMPLE_MAX = 64
/** 中心体 / 绕行体直径（画布百分比）。 */
const CORE_SIZE = 11
const BODY_SIZE = 3.6

/** 折线采样点数：r 用画布宽 1920 折算像素，弦高 tol = 2px。 */
function sampleCount(rx: number, ry: number): number {
  const rPx = (Math.max(rx, ry) * 1920) / 100
  const ratio = 1 - 2 / Math.max(2, rPx)
  const n = Math.ceil(Math.PI / Math.acos(Math.min(1, Math.max(-1, ratio))))
  return Math.min(SAMPLE_MAX, Math.max(SAMPLE_MIN, n))
}

/** 近点角度相对 0° 的偏移：rx ≥ ry 时短轴端（90°）最近，否则长轴端（0°）；正圆约定 90°。 */
function nearOffsetDeg(rx: number, ry: number): number {
  return ry <= rx ? 90 : 0
}

/** `scale` 脉动段：每周期两段（近→远、远→近），窗口首尾相接铺满 [0, dur]。`base` = 基准缩放（有图 image 层用 BODY_SIZE/100 把铺满层压成小图）。 */
function scaleSegments(
  snf: number,
  period: number,
  dur: number,
  offset: number,
  base = 1,
): Array<{ from: Record<string, number>; to: Record<string, number>; startFrame: number; durationInFrames: number; easing: 'linear' }> {
  const half = Math.max(1, period / 2)
  const valueAt = (t: number): number => {
    let phase = (t - offset) % period
    if (phase < 0) phase += period
    return phase <= half ? snf + (1 - snf) * (phase / half) : 1 + (snf - 1) * ((phase - half) / half)
  }
  const segs: Array<{ from: Record<string, number>; to: Record<string, number>; startFrame: number; durationInFrames: number; easing: 'linear' }> = []
  let t = offset - Math.ceil(Math.max(offset, 0) / half) * half
  while (t < dur) {
    const from = Math.max(0, Math.round(t))
    const to = Math.min(dur, Math.round(t + half))
    if (to > from) {
      segs.push({
        from: { scale: +(base * valueAt(from)).toFixed(4) },
        to: { scale: +(base * valueAt(to)).toFixed(4) },
        startFrame: from,
        durationInFrames: to - from,
        easing: 'linear',
      })
    }
    t += half
  }
  return segs
}

/**
 * 卡内结构自检（反变异 7 / 8）：orbit 键合法、animate 段无 orbit 键、
 * 位置折线段窗相接且末段贴轨长。违例 `CS-DEV-ERR`。
 */
function assertOrbitStructure(tracks: readonly Record<string, unknown>[]): void {
  const visit = (list: readonly Record<string, unknown>[]): void => {
    for (const track of list) {
      const children = track.children
      if (Array.isArray(children)) visit(children as Record<string, unknown>[])
      const orbit = track.orbit
      if (orbit !== undefined && orbit !== null && typeof orbit === 'object') {
        for (const key of Object.keys(orbit)) {
          if (key === 'radiusX' || key === 'radiusY' || key === 'angle') {
            throwError(
              'CS-DEV-ERR',
              { detail: `ORB1 自检失败：orbit.${key} 非法 —— OrbitMotion 只有单一 radius（正圆），椭圆走多段 animate 折线（D3-b）` },
            )
          }
        }
      }
      const animate = track.animate
      if (!Array.isArray(animate)) continue
      let prevEnd: number | null = null
      let prevTo: { x?: number; y?: number } | null = null
      let posCount = 0
      for (const raw of animate) {
        if (raw === null || typeof raw !== 'object') continue
        const seg = raw as { startFrame?: number; durationInFrames?: number; from?: Record<string, number>; to?: Record<string, number> }
        if ((seg as Record<string, unknown>).orbit !== undefined) {
          throwError('CS-DEV-ERR', { detail: 'ORB1 自检失败：animate 段含 orbit 键 —— orbit 是轨级字段' })
        }
        const from = seg.from
        const to = seg.to
        const hasPos = from?.x !== undefined || from?.y !== undefined || to?.x !== undefined || to?.y !== undefined
        if (!hasPos) continue
        posCount += 1
        const start = seg.startFrame ?? 0
        const duration = seg.durationInFrames ?? 0
        if (prevEnd !== null && (start !== prevEnd || from?.x !== prevTo?.x || from?.y !== prevTo?.y)) {
          throwError(
            'CS-DEV-ERR',
            { detail: `ORB1 自检失败：位置折线段 #${posCount} 窗口不相接或 to/from 断裂（start=${start}，上一段 end=${prevEnd}）` },
          )
        }
        prevEnd = start + duration
        prevTo = { ...(to?.x === undefined ? {} : { x: to.x }), ...(to?.y === undefined ? {} : { y: to.y }) }
      }
      if (posCount > 0 && prevEnd !== null && prevEnd !== Math.round(Number(track.durationInFrames))) {
        throwError(
          'CS-DEV-ERR',
          { detail: `ORB1 自检失败：位置折线末段 end=${prevEnd} ≠ 轨长=${String(track.durationInFrames)}（反变异 7：Σ 必须铺满轨长）` },
        )
      }
    }
  }
  visit(tracks)
}

registerCard({
  id: 'ORB1',
  title: '轨道演示',
  assets: [
    { slot: 'core', kind: 'image', source: 'user', required: false, fallback: '缺图时画纯色 circle 中心体' },
    { slot: 'satellite', kind: 'image', source: 'user', required: false, fallback: '缺图时画纯色 circle 绕行体' },
  ],
  dataKeys: ['radiusX', 'radiusY', 'eccentricity', 'periodSec', 'startAngle', 'bodies', 'scaleNearFar', 'tiltX', 'labels'],
  generate: (ctx: CardRenderContext) => {
    const data = ctx.data
    const rx = readDataNum(data, 'radiusX', 26, 2, 48)
    const ryGiven = readDataNum(data, 'radiusY', Number.NaN, 2, 48)
    const ecc = readDataNum(data, 'eccentricity', 0, 0, 0.999)
    const ry = Number.isFinite(ryGiven) ? ryGiven : rx * Math.sqrt(1 - ecc * ecc)
    const periodSec = readDataNum(data, 'periodSec', 6, 1, 60)
    const startAngle = readDataNum(data, 'startAngle', 0, -720, 720)
    const bodies = Math.round(readDataNum(data, 'bodies', 1, 1, 4))
    const snf = readDataNum(data, 'scaleNearFar', 1, 1, 3)
    const tilt = Math.round(readDataNum(data, 'tiltX', 0, -30, 30))
    const labels = String(data?.labels ?? '')
      .split(/[,，]/).map((part) => part.trim()).filter(Boolean).slice(0, 2)

    const fps = ctx.fps ?? 30
    const dur = Math.max(1, Math.round(ctx.durationInFrames))
    const period = Math.max(2, Math.round(periodSec * fps))
    const isCircle = Math.abs(rx - ry) <= CIRCLE_EPS
    const accent = ctx.accentColor
    const hold = dur >= 60 ? Math.min(HOLD_MAX, Math.floor(dur * 0.08)) : 0
    const pt = (deg: number): { x: number; y: number } => {
      const rad = (deg * Math.PI) / 180
      return { x: +(CENTER_X + rx * Math.cos(rad)).toFixed(3), y: +(CENTER_Y + ry * Math.sin(rad)).toFixed(3) }
    }

    // 椭圆折线的时间线：首尾 hold，中间 k 圈 × N 段整数分界（相邻差 ≥ 1 帧）。
    const n = sampleCount(rx, ry)
    const k = Math.max(1, Math.ceil(dur / period))
    const total = n * k
    const usable = Math.max(total, dur - 2 * hold)
    const bounds: number[] = [hold]
    for (let i = 1; i <= total; i += 1) bounds.push(hold + Math.round((i * usable) / total))

    const coreSrc = ctx.assetSrc('core')
    const satSrc = ctx.assetSrc('satellite')
    const plane: Record<string, unknown>[] = []

    // 轨道线：两段 A 弧凑整椭圆（与折线采样同一组 center/rx/ry/startAngle，保证同源）。
    const f = (v: number): string => v.toFixed(2)
    plane.push({
      id: `${ctx.segmentId}-orbit-line`,
      type: 'shape',
      shape: 'path',
      color: accent,
      d: `M ${f(CENTER_X - rx)} ${f(CENTER_Y)} A ${f(rx)} ${f(ry)} 0 0 1 ${f(CENTER_X + rx)} ${f(CENTER_Y)} A ${f(rx)} ${f(ry)} 0 0 1 ${f(CENTER_X - rx)} ${f(CENTER_Y)}`,
      strokeWidth: 0.5,
      draw: { to: 1, durationInFrames: Math.min(30, dur), easing: 'easeOutCubic' },
      startFrame: ctx.startFrame,
      durationInFrames: dur,
      fadeFrames: Math.min(8, Math.floor(dur / 8)),
    })

    // 中心体：有图走 image，缺图降级纯色 circle（缺素材降级出片，不整片停摆）。
    plane.push(
      coreSrc !== undefined
        ? {
            id: `${ctx.segmentId}-core`,
            type: 'image',
            src: coreSrc,
            fit: 'contain',
            box: { x: CENTER_X, y: CENTER_Y, w: CORE_SIZE, h: CORE_SIZE },
            startFrame: ctx.startFrame,
            durationInFrames: dur,
            fadeFrames: Math.min(8, Math.floor(dur / 8)),
          }
        : {
            id: `${ctx.segmentId}-core`,
            type: 'shape',
            shape: 'circle',
            color: accent,
            box: { x: CENTER_X, y: CENTER_Y, w: CORE_SIZE, h: CORE_SIZE },
            startFrame: ctx.startFrame,
            durationInFrames: dur,
            fadeFrames: Math.min(8, Math.floor(dur / 8)),
          },
    )

    const nearDeg = nearOffsetDeg(rx, ry)
    const fadeFrames = Math.min(8, Math.floor(dur / 8))

    for (let b = 0; b < bodies; b += 1) {
      const bodyStart = startAngle + (b * 360) / bodies
      // 近点在**绝对**角度 nearDeg（椭圆轴对齐画布，与起始角无关）；本体到达近点的
      // 相位 = (nearDeg − bodyStart) 折算的时间偏移。
      const bodyOffset = ((((nearDeg - bodyStart) % 360) + 360) % 360 / 360) * period
      const p0 = pt(bodyStart)
      const exit = { durationInFrames: Math.max(6, Math.round(dur * 0.14)), to: { opacity: 0 } }

      if (satSrc === undefined) {
        // 降级路径（无图）：shape circle —— 「shape 特例」：box 是缺省落点，
        // animate / orbit 显式覆盖位置（manifest-contract 特例表第 9 条）。
        const scaleSegs = snf > 1 ? scaleSegments(snf, period, dur, bodyOffset) : []
        const posSegs: Array<Record<string, unknown>> = []
        if (!isCircle) {
          if (hold > 0) posSegs.push({ from: p0, to: p0, startFrame: 0, durationInFrames: hold, easing: 'linear' })
          for (let i = 0; i < total; i += 1) {
            const segStart = bounds[i] ?? 0
            const segEnd = bounds[i + 1] ?? segStart
            posSegs.push({
              from: pt(bodyStart + (i * 360) / n),
              to: pt(bodyStart + ((i + 1) * 360) / n),
              startFrame: segStart,
              durationInFrames: Math.max(1, segEnd - segStart),
              easing: 'linear',
            })
          }
          if (hold > 0) posSegs.push({ from: p0, to: p0, startFrame: hold + usable, durationInFrames: hold, easing: 'linear' })
        }
        if (scaleSegs.length > 0) posSegs.push(...scaleSegs)
        plane.push({
          id: `${ctx.segmentId}-body${b + 1}`,
          type: 'shape',
          shape: 'circle',
          color: accent,
          box: { x: p0.x, y: p0.y, w: BODY_SIZE, h: BODY_SIZE },
          ...(isCircle
            ? {
                orbit: {
                  center: { x: CENTER_X, y: CENTER_Y },
                  radius: rx,
                  startAngle: bodyStart,
                  periodInFrames: period,
                  direction: 'cw',
                },
              }
            : {}),
          ...(posSegs.length > 0 ? { animate: posSegs } : {}),
          exit,
          startFrame: ctx.startFrame,
          durationInFrames: dur,
          fadeFrames,
        })
        continue
      }

      // 主路径（有图）：image 轨**不带 box** —— `box` 与位置 animate/orbit 互斥
      // （`boxPositionConflict`：位置来源必须唯一）。无 box 的媒体层是铺满画布层
      // （ImageClip），`animate x/y` 即画布百分比**中心坐标**（animated-style 契约：
      // `translate((x−50)%, (y−50)%)`）；尺寸靠 `transform.scale` 压到 BODY_SIZE，
      // 近远脉动段在该基准上等比。子轨白名单不收嵌套 group，故不套体组。
      const s0 = BODY_SIZE / 100
      const scaleSegs = snf > 1 ? scaleSegments(snf, period, dur, bodyOffset, s0) : []
      const moveSegs: Array<Record<string, unknown>> = []
      if (!isCircle) {
        if (hold > 0) moveSegs.push({ from: p0, to: p0, startFrame: 0, durationInFrames: hold, easing: 'linear' })
        for (let i = 0; i < total; i += 1) {
          const segStart = bounds[i] ?? 0
          const segEnd = bounds[i + 1] ?? segStart
          moveSegs.push({
            from: pt(bodyStart + (i * 360) / n),
            to: pt(bodyStart + ((i + 1) * 360) / n),
            startFrame: segStart,
            durationInFrames: Math.max(1, segEnd - segStart),
            easing: 'linear',
          })
        }
        if (hold > 0) moveSegs.push({ from: p0, to: p0, startFrame: hold + usable, durationInFrames: hold, easing: 'linear' })
      }
      plane.push({
        id: `${ctx.segmentId}-body${b + 1}`,
        type: 'image',
        src: satSrc,
        fit: 'contain',
        transform: { scale: s0 },
        ...(isCircle
          ? {
              orbit: {
                center: { x: CENTER_X, y: CENTER_Y },
                radius: rx,
                startAngle: bodyStart,
                periodInFrames: period,
                direction: 'cw',
              },
            }
          : {}),
        ...([...moveSegs, ...scaleSegs].length > 0 ? { animate: [...moveSegs, ...scaleSegs] } : {}),
        exit,
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames,
      })
    }

    // 标注：近点 / 远点标签（绝对角度 nearDeg / nearDeg+180，径向向外偏 6 个点；
    // 放 group 外，避免被容器 3D 拖走）。
    const labelTracks: Record<string, unknown>[] = []
    const labelStart = ctx.startFrame + Math.round(dur * 0.08)
    labels.forEach((text, i) => {
      const deg = i === 0 ? nearDeg : nearDeg + 180
      const p = pt(deg)
      const vx = p.x - CENTER_X
      const vy = p.y - CENTER_Y
      const len = Math.hypot(vx, vy) || 1
      const lx = +(CENTER_X + (vx / len) * (len + 6)).toFixed(2)
      const ly = +(CENTER_Y + (vy / len) * (len + 6)).toFixed(2)
      labelTracks.push({
        id: `${ctx.segmentId}-label${i + 1}`,
        type: 'textCard',
        variant: 'subtitle',
        text,
        box: { x: lx, y: ly, w: 16, h: 4.5 },
        background: 'transparent',
        color: accent,
        anim: 'fadeUp',
        startFrame: labelStart,
        durationInFrames: Math.max(8, ctx.startFrame + dur - labelStart),
        fadeFrames: 4,
      })
    })

    const tracks: Record<string, unknown>[] = [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0b1220', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: dur, fadeFrames: 0 },
      { id: `${ctx.segmentId}-title`, type: 'textCard', variant: 'subtitle', text: ctx.label, box: { x: 50, y: 8, w: 60, h: 6 }, background: 'transparent', color: '#e2e8f0', startFrame: ctx.startFrame, durationInFrames: dur, fadeFrames },
    ]
    if (tilt !== 0) {
      tracks.push({
        id: `${ctx.segmentId}-plane`,
        type: 'group',
        // 容器倾角走 transform（collect3dAngles 读 transform/animate；≤30° 校验层把关）。
        transform: { rotateX: tilt },
        children: plane.map((track) => ({ ...track, startFrame: 0 })),
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
      })
    } else {
      tracks.push(...plane)
    }
    tracks.push(...labelTracks)
    if (ctx.copy.trim() !== '') {
      tracks.push({
        id: `${ctx.segmentId}-cap`,
        type: 'textCard',
        variant: 'subtitle',
        text: ctx.copy,
        box: { x: 50, y: 93, w: 86, h: 6 },
        background: 'transparent',
        color: '#e2e8f0',
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames,
      })
    }

    assertOrbitStructure(tracks)
    return tracks
  },
})
