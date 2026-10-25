/**
 * **分组坐标（`groups`）**：把「组内的相对百分比」在**宿主侧**展开成画布绝对百分比。
 *
 * ## 为什么是"编译期糖"而不是运行时嵌套
 *
 * 用户的原话（2026-10-25，会话 #5 @143min）：
 * 「表盘跟里面的内容做到一起，是不是就不用考虑全局变换坐标了啊？」
 *
 * 他要的是**写的时候**不用算全局坐标，而不是渲染时的 DOM 嵌套。所以本模块在
 * `render_composition` 入口把组内坐标**预展开**：
 *   - 组声明一个绝对矩形（画布百分比，中心语义）；
 *   - 组内轨道的 `box` 用**组内百分比**（0–100 相对该组）；
 *   - 展开后轨道拿到绝对 `box`，`group` 字段被抹掉。
 *
 * 渲染组件、校验器、客户端一律**看不到**组 —— 它们只收到展开后的普通 manifest。
 * 这样组能力不会变成第二套坐标体系（否则「组内 x」与「画布 x」两套语义必然有人用错）。
 *
 * ## 边界（刻意不做的）
 *
 * - **只展开 `box`**。`animate` 的 `x`/`y` 是画布绝对百分比，不参与展开（否则「入场从组外飞入」
 *   这种刻意越界的动效就做不出来了）；要组内相对动画，自己在组内坐标里算好再写。
 * - **只支持一层**。组套组会让"哪个百分比相对谁"变成推理题，收益不抵风险。
 * - 没有 `box` 的轨道（如铺满的 `image`）不受组影响，会出一条 warning 说明「被忽略了」。
 */
import type { CompositionManifest } from './manifest.js'

export interface GroupRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface ManifestGroup {
  readonly id: string
  /** 组在画布上的绝对矩形（画布百分比，x/y 是**中心**）。 */
  readonly box: GroupRect
}

export interface GroupExpansion {
  readonly manifest: CompositionManifest
  /** 展开过程中的降级说明（未知组名 / 无 box 的轨 / 嵌套组）—— 必须报给调用方。 */
  readonly warnings: readonly string[]
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function readRect(raw: unknown): GroupRect | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const { x, y, w, h } = record
  if (!isNumber(x) || !isNumber(y) || !isNumber(w) || !isNumber(h)) return null
  if (w <= 0 || h <= 0) return null
  return { x, y, w, h }
}

/** 百分比单位换算的唯一点：组内 `local`（0–100）→ 画布绝对。 */
function placeFrom(local: number, originStart: number, span: number): number {
  return Math.round((originStart + (local / 100) * span) * 100) / 100
}

/**
 * 展开分组。**纯函数**（不读盘、不改入参）。
 *
 * 没有 `groups` 时原样返回同一个对象（零开销，老 manifest 像素不变）。
 */
export function expandGroups(input: CompositionManifest): GroupExpansion {
  const groups = (input as { groups?: unknown }).groups
  if (groups === undefined) return { manifest: input, warnings: [] }

  const warnings: string[] = []
  if (Array.isArray(groups) && groups.length === 0) {
    // 空数组 = "没分组"，与不写等价（不要因为一个 `groups: []` 就让调用方失败）。
    return { manifest: input, warnings: [] }
  }
  if (!Array.isArray(groups)) {
    return { manifest: input, warnings: ['groups 不是数组'] }
  }

  const table = new Map<string, GroupRect>()
  for (const raw of groups) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const record = raw as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    const rect = readRect(record.box)
    if (id === '' || rect === null) {
      warnings.push(`组条目缺 id 或 box 非法，已跳过：${JSON.stringify(record)}`)
      continue
    }
    if (table.has(id)) {
      warnings.push(`组 id 重复（${id}），后者覆盖前者`)
    }
    table.set(id, rect)
  }

  if (table.size === 0) {
    return { manifest: { ...input, groups: undefined } as CompositionManifest, warnings: [...warnings, '没有任何可用分组，groups 已移除'] }
  }

  const tracks = input.tracks.map((track) => {
    const groupId = (track as { group?: unknown }).group
    if (typeof groupId !== 'string' || groupId.trim() === '') return track
    const rect = table.get(groupId.trim())
    if (rect === undefined) {
      warnings.push(`轨道 ${String(track.id)} 引用了不存在的组（${groupId}），按绝对坐标处理`)
      return { ...track, group: undefined }
    }
    const box = (track as { box?: unknown }).box
    const local = readRect(box)
    if (local === null) {
      warnings.push(`轨道 ${String(track.id)} 属于组 ${groupId} 但没有合法 box —— 组只作用于 box，该轨按原样处理`)
      return { ...track, group: undefined }
    }
    // 组内 0–100 映射到组的实际范围；组外数值也允许（= 刻意越界），不做钳制。
    const absolute = {
      x: placeFrom(local.x, rect.x - rect.w / 2, rect.w),
      y: placeFrom(local.y, rect.y - rect.h / 2, rect.h),
      w: Math.round((local.w / 100) * rect.w * 100) / 100,
      h: Math.round((local.h / 100) * rect.h * 100) / 100,
    }
    return { ...track, box: absolute, group: undefined }
  })

  return { manifest: { ...input, tracks, groups: undefined } as CompositionManifest, warnings }
}
