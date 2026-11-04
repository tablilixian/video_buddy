/**
 * P3（2026-11-03）：manifest **轨级校验**的外提件（chart / callout / animate 窗口 /
 * exit / colorShift / startAfter / 视觉状态原语）。
 *
 * 为什么拆：manifest.ts 在 file-size-guard 行数棘轮上（只准减不准增），新字段照旧内联
 * 必然破线。chart 校验是自包含块，原样外提；`isRecord` / `isNonEmptyString` 一并随迁
 * （唯一事实源仍是一份），manifest.ts 反向 import —— 依赖方向 manifest → 本模块，
 * 单向无环。
 *
 * 2026-11-04（科普 0.1 验收批）：随 `reveal.out` 新契约一道外提
 * 「视觉状态校验原语 + exit / colorShift / startAfter 三族轨级校验」——
 * manifest.ts 因此**净减**约 120 行，新契约字段不占棘轮余量。
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

import { validatePieFamilyTrack } from './chart-pie.js'
import { animateStateAt } from './timing.js'
import { looksLikeNumericFact } from '../data-provenance.js'
import type { Animate, BaseTrack, Transform } from './manifest.js'

// ─────────────────────── 视觉状态校验原语 ───────────────────────

/** CV-334：缓动白名单（三期 W2-1 扩档；与 `AnimateEasing` 同域，非法值报错而非静默回退）。 */
export const ANIMATE_EASINGS = new Set<string>([
  'linear', 'easeIn', 'easeOut', 'easeInOut',
  // 三期 W2-1
  'easeInCubic', 'easeOutCubic', 'easeInOutCubic',
  'easeOutQuart', 'easeOutExpo', 'easeOutCirc', 'easeInOutExpo',
  'backOut',
  // 三期 W2-2
  'spring',
])

/** 校验一个 `VisualState`（或 `Transform`）的字段取值；`allowOpacity=false` 时禁 `opacity`。 */
export function validateVisualStateFields(value: unknown, at: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${at} 必须是对象（如 {"x":50,"y":50,"scale":1}）`)
    return
  }
  for (const key of ['x', 'y', 'rotation'] as const) {
    const raw = value[key]
    if (raw === undefined) continue
    if (typeof raw !== 'number' || !Number.isFinite(raw)) errors.push(`${at}.${key} 必须是有限数`)
  }
  const scale = value.scale
  if (scale !== undefined) {
    if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
      errors.push(`${at}.scale 必须是 > 0 的有限数`)
    }
  }
  const opacity = value.opacity
  if (opacity !== undefined) {
    if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      errors.push(`${at}.opacity 必须是 0–1 的数值`)
    }
  }
}

/** 三期 W2-2：`spring` 物理参数校验（缺省合法；非法值会让归一化时间算出 NaN）。 */
export function validateSpringConfig(value: unknown, at: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${at} 必须是对象（如 {"stiffness":170,"damping":18,"mass":1}）`)
    return
  }
  for (const key of ['stiffness', 'damping', 'mass'] as const) {
    const raw = value[key]
    if (raw === undefined) continue
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
      errors.push(`${at}.${key} 必须是 > 0 的有限数`)
    }
  }
}

/** 正整数帧校验（缺省合法）。 */
export function validatePositiveInteger(value: unknown, at: string, errors: string[], label = '帧'): void {
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    errors.push(`${at} 必须是正整数（${label}）`)
  }
}

/** 非负整数校验（缺省合法）。 */
export function validateNonNegativeInteger(value: unknown, at: string, errors: string[]): void {
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    errors.push(`${at} 必须是 >= 0 的整数`)
  }
}

/**
 * 整数帧校验（**允许负值**，缺省合法）。
 *
 * O-08 专用：`startAfter.gapFrames` 的负值有明确语义（= 与引用轨重叠），不能套
 * `validateNonNegativeInteger`。下限不在这里判 —— 「解析出的起始帧不能为负」取决于
 * 引用轨的绝对起点，只有 `normalizeManifestTiming` 知道。
 */
export function validateInteger(value: unknown, at: string, errors: string[]): void {
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    errors.push(`${at} 必须是整数（负数 = 与引用轨重叠的帧数）`)
  }
}

// ─────────────────────── 轨级字段校验 ───────────────────────

/** 三期 W1-1：`exit` 校验。 */
export function validateExitMotion(value: unknown, at: string, trackDuration: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${at}.exit 必须是对象（如 {"to":{"opacity":0,"y":44},"durationInFrames":8}）`)
    return
  }
  if (value.to === undefined) errors.push(`${at}.exit.to 缺失（退场终点必填，写 {} 表示"不覆盖"）`)
  else validateVisualStateFields(value.to, `${at}.exit.to`, errors)
  validatePositiveInteger(value.durationInFrames, `${at}.exit.durationInFrames`, errors)
  validateNonNegativeInteger(value.gapFrames, `${at}.exit.gapFrames`, errors)
  const easing = value.easing
  if (easing !== undefined && (typeof easing !== 'string' || !ANIMATE_EASINGS.has(easing))) {
    errors.push(`${at}.exit.easing 非法（${String(easing)}）—— 白名单：${[...ANIMATE_EASINGS].join(' / ')}`)
  }
  const duration = value.durationInFrames
  if (
    typeof duration === 'number' && Number.isFinite(duration) && typeof trackDuration === 'number' &&
    Number.isFinite(trackDuration) && duration > trackDuration
  ) {
    errors.push(`${at}.exit.durationInFrames ${duration} 超过轨道时长 ${trackDuration}`)
  }
}

/** 三期 W1-2：`startAfter` 校验（引用存在性与顺序在归一化阶段判，这里只查形状）。 */
export function validateStartAfter(value: unknown, at: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${at}.startAfter 必须是对象（如 {"trackId":"t1","gapFrames":-10}）`)
    return
  }
  if (!isNonEmptyString(value.trackId)) errors.push(`${at}.startAfter.trackId 必须是非空字符串`)
  // O-08：负数合法（= 与引用轨重叠）；写 `-10` 表示与 10 帧转场对齐。
  validateInteger(value.gapFrames, `${at}.startAfter.gapFrames`, errors)
}

/** 三期 W2-3：`colorShift` 校验。 */
export function validateColorShift(value: unknown, at: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${at}.colorShift 必须是对象（如 {"from":"#4f9cf9","to":"#ff7a59"}）`)
    return
  }
  for (const key of ['from', 'to'] as const) {
    const raw = value[key]
    if (!isNonEmptyString(raw) || !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/u.test(raw)) {
      errors.push(`${at}.colorShift.${key} 必须是 #rgb 或 #rrggbb 形式的颜色`)
    }
  }
  validateNonNegativeInteger(value.startFrame, `${at}.colorShift.startFrame`, errors)
  validatePositiveInteger(value.durationInFrames, `${at}.colorShift.durationInFrames`, errors)
  const easing = value.easing
  if (easing !== undefined && (typeof easing !== 'string' || !ANIMATE_EASINGS.has(easing))) {
    errors.push(`${at}.colorShift.easing 非法（${String(easing)}）—— 白名单：${[...ANIMATE_EASINGS].join(' / ')}`)
  }
}

/**
 * chart 轨校验（自 manifest.ts `case 'chart'` **原样外提**，2026-10-31 能力基准 #04 /
 * A2 source:'timeline' / P2' variant:'line' 的语义逐字不变）。
 *
 * @param hasVideoTrack manifest 里是否存在 video 轨（source:'timeline' 的前置条件；
 *   由调用方在 switch 外算好，本模块不接触整份 manifest）
 */
export function validateChartTrack(
  track: Record<string, unknown>,
  at: string,
  errors: string[],
  warnings: string[],
  hasVideoTrack: boolean,
): void {
  const variant = track.variant
  if (variant !== 'bars' && variant !== 'dual' && variant !== 'line' && variant !== 'pie' && variant !== 'donut' && variant !== 'gauge') {
    errors.push(`${at}.variant 只允许 bars / dual / line / pie / donut / gauge（当前：${String(variant)}）`)
  }
  // A2（2026-10-31）：数据来源 —— 'timeline' 从 video 轨真值推导，与内联互斥。
  const timelineMode = track.source === 'timeline'
  if (track.source !== undefined && !timelineMode) {
    errors.push(`${at}.source 只允许 'timeline'（缺省 = 内联 labels / values）`)
  }
  if (timelineMode) {
    const inline = track.labels !== undefined || track.values !== undefined || track.lineValues !== undefined
    if (inline) {
      errors.push(`${at} 的 source:'timeline' 与内联 labels/values/lineValues 互斥（数据来源必须唯一）`)
    } else if (!hasVideoTrack) {
      errors.push(`${at} 的 source:'timeline' 需要 manifest 里至少一条 video 轨（每镜时长真值）`)
    }
  } else {
    const labels = track.labels
    if (
      !Array.isArray(labels) || labels.length === 0 || labels.length > 32 ||
      !labels.every((l) => isNonEmptyString(l))
    ) {
      errors.push(`${at}.labels 必须是非空字符串数组（1–32 项，与 values 一一对应）`)
    }
    const values = track.values
    const valuesOk =
      Array.isArray(values) && values.length > 0 &&
      values.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)
    if (!valuesOk) {
      errors.push(`${at}.values 必须是非负有限数值数组（柱高数据，不允许负值）`)
    } else if (Array.isArray(labels) && labels.length > 0 && Array.isArray(values) && values.length !== labels.length) {
      errors.push(`${at}.values 长度（${String(Array.isArray(values) ? values.length : 0)}）必须与 labels（${String(Array.isArray(labels) ? labels.length : 0)}）一致`)
    } else if (Array.isArray(values) && values.every((v) => v === 0)) {
      errors.push(`${at}.values 不能全为 0（至少一个 > 0，否则没有可缩放的量纲）`)
    }
    if (track.lineValues !== undefined) {
      if (variant !== 'dual') {
        warnings.push(`${at} 是 variant:'${String(variant)}'，lineValues 只在 variant:'dual' 下生效（已忽略）`)
      } else {
        const lv = track.lineValues
        const lineOk =
          Array.isArray(lv) && lv.length > 0 &&
          lv.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)
        if (!lineOk) {
          errors.push(`${at}.lineValues 必须是非负有限数值数组（折线数据）`)
        } else if (Array.isArray(labels) && labels.length > 0 && lv.length !== labels.length) {
          errors.push(`${at}.lineValues 长度（${String(Array.isArray(lv) ? lv.length : 0)}）必须与 labels（${String(Array.isArray(labels) ? labels.length : 0)}）一致`)
        } else if (Array.isArray(lv) && lv.every((v) => v === 0)) {
          errors.push(`${at}.lineValues 不能全为 0`)
        }
      }
    } else if (variant === 'dual') {
      errors.push(`${at} 是 variant:'dual'，必须提供 lineValues（折线数据，长度同 labels）`)
    }
    // B-4（CV-440，P-01/P-17）：数据出处 / 基准 —— 观察期 warning（P5 拍板本轮不升
    // error）。缺失给补法不阻断；'timeline'（片内真值派生）豁免 —— 它的出处是本片
    // video 轨，无需外溯源。混基准序列（RUN-2）靠 baseline 强制声明口径来暴露。
    if (track.dataSource === undefined) {
      warnings.push(`${at} 内联数值缺 dataSource（数据集 + 可复核入口，如 'NASA GISTEMP v4, https://…'）——L3 数据保真判据前置，成片前请补（B-4 观察期提醒，暂不阻断）`)
    }
    if (track.baseline === undefined) {
      warnings.push(`${at} 内联数值缺 baseline（口径 / 基线说明，如 '1951–1980 基线距平'）——混基准会画出错误结论（RUN-2），成片前请补（B-4 观察期提醒，暂不阻断）`)
    }
  }
  for (const key of ['lineLabel', 'unit', 'lineUnit', 'color', 'lineColor', 'dataSource', 'baseline'] as const) {
    if (track[key] !== undefined && !isNonEmptyString(track[key])) {
      errors.push(`${at}.${key} 必须是非空字符串`)
    }
  }
  // 4.1（2026-11-04）：pie / donut / gauge 专属语义（gauge 单值 / gaugeMax / palette）。
  if (variant === 'pie' || variant === 'donut' || variant === 'gauge') {
    validatePieFamilyTrack(track, at, errors)
  }
}

/**
 * B-4（CV-440，P-01/P-17）：dataCard 数值型事实的溯源观察期检查。
 *
 * 触发口径收窄（P-01 复核实测修正）：只有 `v` 像**可溯源数字**（温标 / 百分比 /
 * 量级等，判据见 `looksLikeNumericFact`）才要求 `dataSource`；BPM / 时长 / 计数
 * 等元数据豁免。`dataSource:'observed' | 'inline'` = 声明「非外部事实」，诚实出口。
 * 观察期只 warning —— 让漂移的数据自己现形，不诱导编造出处。
 */
export function validateDataCardProvenance(track: Record<string, unknown>, at: string, warnings: string[]): void {
  if (track.dataSource !== undefined) return
  const data = track.data
  if (!Array.isArray(data)) return
  for (const entry of data) {
    if (!isRecord(entry) || typeof entry.v !== 'string') continue
    if (!looksLikeNumericFact(entry.v)) continue
    warnings.push(`${at} 数据卡含数值型事实（"${entry.v}"）缺 dataSource（数据集 / 来源 URL；自测值写 'observed'，占位演示写 'inline'）——L3 数据保真判据前置（B-4 观察期提醒，暂不阻断）`)
    break // 一张卡点名一次即可，不逐条刷
  }
}

/** P3（2026-11-03）：callout 轨校验（标签盒 box 在通用区已查几何与位置来源冲突）。 */
export function validateCalloutTrack(track: Record<string, unknown>, at: string, errors: string[]): void {
  const anchor: unknown = track.anchor
  const anchorOk = isRecord(anchor)
    && typeof anchor.x === 'number' && Number.isFinite(anchor.x) && anchor.x >= 0 && anchor.x <= 100
    && typeof anchor.y === 'number' && Number.isFinite(anchor.y) && anchor.y >= 0 && anchor.y <= 100
  if (!anchorOk) {
    errors.push(`${at}.anchor 必须是 { x, y }（画布百分比 0–100，引线指着的那个点）`)
  }
  if (!isNonEmptyString(track.text) || track.text.length > 80) {
    errors.push(`${at}.text 必须是非空字符串（建议 ≤24 字，上限 80 字符）`)
  }
  if (track.box === undefined) {
    errors.push(`${at} 必须给 box（标签盒，画布百分比中心语义，如 {"x":30,"y":30,"w":22,"h":9}）`)
  }
  if (track.line !== undefined && track.line !== 'elbow' && track.line !== 'straight') {
    errors.push(`${at}.line 只允许 elbow / straight`)
  }
  for (const key of ['color', 'labelBackground'] as const) {
    if (track[key] !== undefined && !isNonEmptyString(track[key])) {
      errors.push(`${at}.${key} 必须是非空颜色字符串`)
    }
  }
}

/**
 * animate 段与**轨长**的关系校验（2026-11-04 · 科普 0.1 验收事故沉淀）。
 *
 * 事故：科普 0.1 验收里 `s2_callout` 轨写了
 *   `animate:{from:{opacity:0},to:{opacity:1},startFrame:31,durationInFrames:1}` 配 32 帧轨。
 * `animateStateAt` 的命中窗口是 `localFrame >= start && localFrame < start + duration`，
 * 于是该段**唯一命中帧**的 progress 恒为 0 ⇒ 合成 opacity 恒 0 ⇒ 整条轨全程透明。
 * 原校验层只查 `startFrame` / `durationInFrames` 的**取值合法性**，完全不查它们与轨长的
 * 关系 ⇒ 这类错一路放行到成片（中文版与英文重制版两批都中招）。
 *
 * 三条判据（①③ 阻断渲染，② 只提示）：
 * ① 段整段落在轨外（`startFrame >= 轨长`）⇒ error：一段永不命中的动画 = 绝对帧误写。
 * ② 段尾越出轨尾（`startFrame + durationInFrames > 轨长`）⇒ warning：动画尾巴被截断
 *    （良性场景真实存在，如 1% 幅度的呼吸层被切掉最后一两帧 —— 只提示，不断言）。
 * ③ 轨内 opacity 维度**全程读到 0** ⇒ error：整层永久不可见（①的语义化补充）。
 *
 * ③ 的读数**复用渲染层同一个纯函数** `animateStateAt`（timing.ts）—— 校验层绝不自己
 * 重写一遍插值/选段规则，否则必然与渲染漂移（这是本判据能"零误报"的前提）。
 */
export function validateAnimateWindows(
  track: Record<string, unknown>,
  at: string,
  trackDuration: unknown,
  errors: string[],
  warnings: string[],
): void {
  const raw = track.animate
  if (raw === undefined) return
  const list = Array.isArray(raw) ? raw : [raw]
  if (!list.some(isRecord)) return
  // 轨长非法：字段校验（manifest.ts）已经报过，这里不重复也不猜。
  if (typeof trackDuration !== 'number' || !Number.isFinite(trackDuration) || trackDuration <= 0) return
  const duration = Math.floor(trackDuration)
  const id = typeof track.id === 'string' && track.id.length > 0 ? `(${track.id})` : ''

  // ① / ②：段与轨长的关系。
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i]
    if (!isRecord(item)) continue
    const label = Array.isArray(raw) ? `${at}.animate[${i}]` : `${at}.animate`
    const start = animateSegmentStart(item)
    const segDuration = animateSegmentDuration(item, duration)
    if (start >= duration) {
      errors.push(
        `${label}${id} 的 startFrame ${start} 已越出轨道（轨长 ${duration} 帧）—— 该动画段永不命中。`
        + 'startFrame 是**轨内相对帧**，请勿写绝对帧',
      )
      continue
    }
    const end = start + segDuration
    if (end > duration) {
      warnings.push(
        `${label}${id} 的动画段越出轨尾 ${end - duration} 帧`
        + `（startFrame ${start} + durationInFrames ${segDuration} > 轨长 ${duration}）—— 末尾这 ${end - duration} 帧不生效`,
      )
    }
  }

  // ③：整层永久不可见（opacity 维度在轨内全程读到 0）。
  if (exitCanRescueOpacity(track)) return
  const animatable = list.filter(
    (item): item is Animate => isRecord(item) && isRecord(item.from) && isRecord(item.to),
  )
  if (animatable.length === 0) return
  // 只有声明了 opacity 的段才可能把整层钉死；没有这种段时 animate 与可见性无关。
  const touchesOpacity = animatable.some(
    (item) => item.from.opacity !== undefined || item.to.opacity !== undefined,
  )
  if (!touchesOpacity) return

  const probe: Pick<BaseTrack, 'animate' | 'transform' | 'durationInFrames'> = {
    animate: animatable,
    durationInFrames: duration,
    ...(isRecord(track.transform) ? { transform: track.transform as Transform } : {}),
  }
  // 候选帧 = 各段窗口的四个边界点（前后各一帧）+ 轨首尾。
  // 理由：段内读数是进度的线性函数（端点收敛 ⇒ 极值在端点），段外读数是常量
  //（首段起点 / 末段终点），所以「有没有一帧可见」只需在这有限个点上取样即可判准。
  const candidates = new Set<number>([0, duration - 1])
  for (const item of animatable) {
    const start = animateSegmentStart(item)
    const segDuration = animateSegmentDuration(item, duration)
    candidates.add(start - 1)
    candidates.add(start)
    candidates.add(start + segDuration - 1)
    candidates.add(start + segDuration)
  }
  for (const frame of candidates) {
    if (frame < 0 || frame >= duration) continue
    const opacity = animateStateAt(probe, frame).opacity ?? 1
    if (opacity > 0) return
  }
  errors.push(
    `${at}${id} 的 animate 使整层永久不可见：opacity 维度在轨内 ${duration} 帧全程读到 0 —— 该轨渲染出来是空白。`
    + '常见成因：淡入段被写到轨尾（startFrame + durationInFrames 越过轨长），唯一命中帧的 progress 恒为 0',
  )
}

/** 一个 animate 段的轨内起始帧（缺省 0）。 */
function animateSegmentStart(item: { startFrame?: unknown }): number {
  const raw = item.startFrame
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return 0
  return Math.floor(raw)
}

/** 一个 animate 段的时长（缺省 = 整轨长，与 `animateProgressAt` 同口径）。 */
function animateSegmentDuration(item: { durationInFrames?: unknown }, trackDuration: number): number {
  const raw = item.durationInFrames
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return trackDuration
  return Math.floor(raw)
}

/**
 * `exit.to.opacity > 0` 时退场会把内容救回来 ⇒ ③ 不适用（不多报）。
 *
 * `exit` 只产出 `exit.to` 里声明过的维度；声明 `opacity: 0` 反而是"退场时更透明"，
 * 救不回可见性，所以只有 **> 0** 才算"能救"。
 */
function exitCanRescueOpacity(track: Record<string, unknown>): boolean {
  const exit = track.exit
  if (!isRecord(exit)) return false
  const to = exit.to
  if (!isRecord(to)) return false
  const opacity = to.opacity
  return typeof opacity === 'number' && Number.isFinite(opacity) && opacity > 0
}
