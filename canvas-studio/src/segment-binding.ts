/**
 * R11-B3 · **镜 ↔ 段对位**（spec `sections[]` ↔ 画布分镜卡）—— 纯函数。
 *
 * ## 解决什么
 *
 * 故事板与内容规格是两条平行数据：故事板写「怎么拍」（scene × shot），spec 写
 * 「屏上放什么」（sections × units），片长与产物只认 spec。真机会话里 3 屏片落了
 * 6 张分镜卡，卡面正文是 `visual / camera / promptEn`，与 spec 的 `card / copy / cell`
 * **零字段对应** —— 于是「对着这张分镜说改一句」根本无法唯一落到一段 spec 上，
 * 只能整份 spec 重写再全量重渲。这就是 R11 判据（改一段的代价 = 1 段渲染 + 1 次确认）
 * 缺的那一块地基。
 *
 * 本模块只做一件事：**把对位做成可判定、可回显、可缺失的**。
 *
 * - 可判定：数量相等才按序绑（错一位就改错屏，宁可不对位）；
 * - 可回显：卡正文追加一行 `【段】spec:s2 · B1 · 「−60°C 的冰芯」`，人读得到；
 * - 可缺失：对不上就不写字段，`patch_spec_section` 会明说「这张卡没有段指针」。
 *
 * ## 为什么不用时间对位
 *
 * 段时长由 `planStages` 算（6.5s 基准）或 spec 的 `durationSec` 定，而 shot 的
 * `duration` 是故事板自己写的 —— 两个时钟从来不同源。按「落在哪一段的时间窗里」
 * 对位，会在段长改动后静默错位，比不对位更坏。
 */
import type { StudioCanvasNode } from './contracts/canvas.js'

/** spec 一屏的最小投影（只取对位与摘要用得到的字段）。 */
export interface SegmentBrief {
  /** spec 段 id（`s1` / `open`；写进 `segmentRef` 的那个）。 */
  readonly id: string
  /** 屏级卡编号（units 型段缺省）。 */
  readonly card?: string
  readonly label?: string
  /** 屏级文案（units 型段可缺省）。 */
  readonly copy?: string
  readonly units?: readonly {
    readonly card?: string
    readonly copy?: string
    readonly label?: string
  }[]
}

/** 参与对位的分镜卡（调用方负责只传分镜卡，不要把锚点/资产卡混进来）。 */
export interface ShotCardCandidate {
  readonly id: string
  readonly title: string
  /** 镜号顺序的唯一依据（seed 写 `now + mirror`，升序即镜号序）。 */
  readonly createdAt: number
}

export interface SegmentBinding {
  readonly segmentId: string
  readonly nodeId: string
  readonly nodeTitle: string
  /** 卡正文要追加的那一行（已含 `【段】` 标签）。 */
  readonly line: string
}

export interface SegmentBindingPlan {
  readonly bindings: readonly SegmentBinding[]
  /** 未对位原因（`bindings` 为空时必有；给人看的完整一句话）。 */
  readonly reason: string | null
}

/** `segmentRef` 的命名空间前缀（与 `sbRef` 的 `04:` / `05:` 同风格）。 */
export const SEGMENT_REF_PREFIX = 'spec:'

/** 卡正文里的段行标签（解析器与渲染器共用这一份定义）。 */
export const SEGMENT_LINE_LABEL = '段'

/** 段 id → `segmentRef`。 */
export function segmentRefOf(segmentId: string): string {
  return `${SEGMENT_REF_PREFIX}${segmentId}`
}

/**
 * `segmentRef` → 段 id。不认前缀的值一律 null（不猜）。
 *
 * 为什么不接受裸 id：`segmentRef` 与 `sbRef` 同住一个节点，裸值会让「这串是段还是
 * 故事板路径」在读取侧不可判定 —— 一次误判就是改错一段。
 */
export function segmentIdFromRef(ref: string | undefined): string | null {
  if (ref === undefined) return null
  const trimmed = ref.trim()
  if (!trimmed.startsWith(SEGMENT_REF_PREFIX)) return null
  const id = trimmed.slice(SEGMENT_REF_PREFIX.length).trim()
  return id === '' ? null : id
}

/** 按码点截断（中文/emoji 不会被切半个）。 */
function clip(text: string, max: number): string {
  const points = Array.from(text)
  return points.length <= max ? text : `${points.slice(0, max).join('')}…`
}

/** 段摘要：`B1 · 「−60°C 的冰芯」`（卡编号与首条文案；都没有就空串）。 */
export function briefSummary(brief: SegmentBrief): string {
  const unitCards = (brief.units ?? [])
    .map((unit) => (unit.card ?? '').trim())
    .filter((card) => card !== '')
  const cardPart = unitCards.length > 0 ? unitCards.join('+') : (brief.card ?? '').trim()
  const copySource = (brief.copy ?? '').trim() !== ''
    ? (brief.copy as string)
    : ((brief.units ?? []).find((unit) => (unit.copy ?? '').trim() !== '')?.copy ?? '')
  const copy = copySource.trim()
  const parts = [cardPart, copy === '' ? '' : `「${clip(copy, 16)}」`].filter((part) => part !== '')
  return parts.join(' · ')
}

/** 卡正文的段行：`【段】spec:s2 · B1 · 「−60°C 的冰芯」`。 */
export function segmentLine(segmentId: string, brief: SegmentBrief): string {
  const summary = briefSummary(brief)
  return `【${SEGMENT_LINE_LABEL}】${segmentRefOf(segmentId)}${summary === '' ? '' : ` · ${summary}`}`
}

/**
 * 把段行写进卡正文（**幂等**）：已有 `【段】` 行则整行替换，没有则追加在末尾。
 *
 * 幂等的理由：scaffold 会重跑（改一次 spec 就重编一次），若每次追加则卡面无限增长；
 * 而「替换而不是重建整个正文」是为了保住模型手改过的 `【视觉】/【运镜】` 那些行 ——
 * 段指针是宿主的事实，正文其余部分是创作内容，两者不能互相覆盖。
 */
export function withSegmentLine(text: string, line: string): string {
  const marker = `【${SEGMENT_LINE_LABEL}】`
  const kept = text.split('\n').filter((row) => !row.startsWith(marker))
  return [...kept, line].join('\n')
}

/**
 * 对位计划：数量相等才按序绑，否则一个都不绑并给出原因。
 *
 * 宁可不对位，也不做模糊匹配 ——「大概对上了」在段级编辑里等于「大概改对了」，
 * 而用户看到的是成片。
 */
export function planSegmentBindings(
  sections: readonly SegmentBrief[],
  cards: readonly ShotCardCandidate[],
): SegmentBindingPlan {
  if (sections.length === 0) {
    return { bindings: [], reason: 'spec 没有 sections，无段可对位。' }
  }
  const ids = sections.map((section) => section.id).join(' / ')
  if (cards.length === 0) {
    return { bindings: [], reason: '画布上没有分镜卡，无卡可对位（先落地故事板）。' }
  }
  if (sections.length !== cards.length) {
    return {
      bindings: [],
      reason: `屏 ${String(sections.length)} ≠ 分镜卡 ${String(cards.length)}：数量不等时不做位置对位`
        + '（错一位就会改错屏）—— 要按段改请直接指定 segmentId（' + ids + '）。',
    }
  }
  const ordered = [...cards].sort((a, b) => a.createdAt - b.createdAt)
  const bindings = sections.map((section, index) => {
    const card = ordered[index] as ShotCardCandidate
    return {
      segmentId: section.id,
      nodeId: card.id,
      nodeTitle: card.title,
      line: segmentLine(section.id, section),
    }
  })
  return { bindings, reason: null }
}

/** 应用结果：新节点表（未命中任何卡时返回**同一个数组**，调用方可据此跳过写盘）。 */
export interface SegmentBindingApplied {
  readonly nodes: readonly StudioCanvasNode[]
  readonly changed: number
}

/**
 * 把对位结果写进节点（`segmentRef` + 正文段行）。
 *
 * 只动 `bindings` 里点名的节点；其余节点**原样返回引用**（画布写入是全量覆盖，
 * 无谓的重建会让每个节点都变成新对象，客户端的 diff 与撤销栈都会失效）。
 */
export function applySegmentBindings(
  nodes: readonly StudioCanvasNode[],
  bindings: readonly SegmentBinding[],
): SegmentBindingApplied {
  if (bindings.length === 0) return { nodes, changed: 0 }
  const byNodeId = new Map(bindings.map((binding) => [binding.nodeId, binding]))
  let changed = 0
  const next = nodes.map((node) => {
    const binding = byNodeId.get(node.id)
    if (binding === undefined) return node
    const text = node.text ?? ''
    const nextText = withSegmentLine(text, binding.line)
    const ref = segmentRefOf(binding.segmentId)
    if (node.segmentRef === ref && nextText === text) return node
    changed += 1
    return { ...node, segmentRef: ref, text: nextText }
  })
  return { nodes: next, changed }
}
