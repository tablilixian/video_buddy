/**
 * P3（2026-11-03）：manifest 轨级校验的**外提件**（chart / callout）。
 *
 * 为什么拆：manifest.ts 在 file-size-guard 行数棘轮上（登记 2187、只准减不准增），
 * 新轨型照旧内联必然破线。chart 校验是自包含块，原样外提；`isRecord` /
 * `isNonEmptyString` 一并随迁（唯一事实源仍是一份），manifest.ts 反向 import ——
 * 依赖方向 manifest → 本模块，单向无环。
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
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
  if (variant !== 'bars' && variant !== 'dual' && variant !== 'line') {
    errors.push(`${at}.variant 只允许 bars / dual / line（当前：${String(variant)}）`)
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
      if (variant === 'bars' || variant === 'line') {
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
  }
  for (const key of ['lineLabel', 'unit', 'lineUnit', 'color', 'lineColor'] as const) {
    if (track[key] !== undefined && !isNonEmptyString(track[key])) {
      errors.push(`${at}.${key} 必须是非空字符串`)
    }
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
