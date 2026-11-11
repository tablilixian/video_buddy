/**
 * 1（CV-463）· **模板编译器**：模板骨架 + 本期内容 → 一份真实可渲的 manifest。
 *
 * ## 为什么是「骨架 + 占位符」而不是「spec + 编译器」
 *
 * 实证过（`决策-模板需求收口.md` §2.1）：`text` 只校验「非空字符串 / 非空字符串数组」，
 * **不检查内容** ⇒ `{{title}}` 天然合法；ML-11/ML-12 的字幕检查只针对 `variant:'subtitle'`
 * 且只告警。所以「把一份真能渲的 manifest 的文本位写成占位符」= 零成本拿到模板能力，
 * 且**产物可以继续被模型编辑**（加轨 / 改配色 / 换文案），不是二值选择。
 *
 * 代价（接受）：占位符不能改变**轨道数 / 段数**。那是「段组合」（G2）的事，不在这里偷渡。
 *
 * ## 编译链
 *
 * ```
 * skeleton（manifest.template.json）─┐
 * slots.json ────────────────────────┼→ 槽位校验 → 占位符替换 → 追加构件轨 → 注入音效
 * furniture.json ────────────────────┤                              ↓
 * audio.json ────────────────────────┘                    meta 时长自洽 → validateManifest
 * ```
 *
 * ## 三条不可退让的性质
 *
 * 1. **确定性**：同 bundle + 同 values ⇒ 逐字节相同（**不用** `Date.now()` 生成 id）；
 * 2. **只改内容不动结构**：不同 values 编两次，除文本字段外轨道结构逐字节相同；
 * 3. **产物必须过 `validateManifest`** —— 编译器不产出非法 JSON，这是它对下游的承诺。
 */
import { expandFurnitureList, type FurnitureContext, type FurnitureSpec, type FurnitureTrackDraft } from './furniture.js'
import type { CompositionManifest, ManifestAudio, ManifestSfx } from './manifest.js'
import { MANIFEST_CONTRACT_VERSION, validateManifest } from './manifest.js'
import {
  requiredCapacity,
  resolveSlotValues,
  validateSlotValues,
  type SlotContract,
  type SlotIssue,
} from './slot-contract.js'

/** 模板元信息（`meta.json`）。`list_templates` 的返回项就是它的摘要。 */
export interface TemplateMeta {
  /** `family/id`（全局唯一；目录结构也按它落）。 */
  id: string
  name: string
  /** 风格族 / 体裁（`science` / `product` / `report`）—— 自动选模板的过滤条件。 */
  family: string
  version: string
  /** 渲染器契约版本；与 `MANIFEST_CONTRACT_VERSION` 不符时**明确拒绝**。 */
  contractVersion: string
  summary: string
  suitableFor: string[]
  notSuitableFor: string[]
  /** 固定片长（帧）。模板是整片，不自适应时长（那是 G2 段组合的事）。 */
  durationInFrames: number
  fps: number
  aspect: string
  /** 本模板能装几条「要点」（闸门判据 4「条目数」用）。 */
  itemCapacity?: number
  /** 适用时长区间（秒，闭区间）；缺省由 durationInFrames/fps 推一个 ±35% 的窗。 */
  durationRange?: [number, number]
  /** 必须由用户提供的素材（没有素材就不该选这个模板）。 */
  requiredAssets?: string[]
  /** 声明的装饰构件（与 furniture.json 的 id 列表一致，供 list_templates 展示）。 */
  furniture?: string[]
  /** 给 LLM 的用法提示。 */
  usage?: string
}

/** 一份模板的完整内容（宿主读盘后的形状）。 */
export interface TemplateBundle {
  meta: TemplateMeta
  /** 骨架：**真实可渲**的 manifest，文本位写成 `{{slotId}}`。 */
  skeleton: unknown
  slots: SlotContract[]
  /** 装饰构件声明（编译期展开成普通 shape 轨）。 */
  furniture?: FurnitureSpec[]
  /** 音效事件表（锚定到骨架轨 id，编译期注入 `audio.sfx[]`）。 */
  audio?: ManifestSfx[]
}

export interface CompileStats {
  trackCount: number
  /** 其中由构件展开出来的轨数（诊断「装饰层有没有生效」）。 */
  furnitureTracks: number
  sfxCount: number
}

export interface CompileOutput {
  ok: boolean
  manifest: CompositionManifest | null
  /** 槽位问题（含多余槽位的 warning）。 */
  issues: SlotIssue[]
  /** 结构性错误：模板自身缺陷（占位符指向不存在的槽 / 产物过不了校验）。 */
  errors: string[]
  /** `validateManifest` 的告警（模板作者该看的，不影响出片）。 */
  warnings: string[]
  stats: CompileStats
}

/** 契约版本不符时的报错文案（防「模板要求的能力没有，却渲出来了」的假成功）。 */
export class TemplateContractError extends Error {
  constructor(templateId: string, found: string) {
    super(
      `模板 ${templateId} 要求渲染器契约 v${found}，当前是 v${MANIFEST_CONTRACT_VERSION} —— `
      + '拒绝编译（静默降级会产出「模板以为有、实际没有」的假成功）。请升级模板或渲染器。',
    )
    this.name = 'TemplateContractError'
  }
}

const PLACEHOLDER = /\{\{([A-Za-z0-9_.\-]+)\}\}/g

/** 整串就是一个占位符（`"{{tags}}"`）—— 这种位置可以整值替换（含数组）。 */
function wholePlaceholder(text: string): string | undefined {
  const match = /^\{\{([A-Za-z0-9_.\-]+)\}\}$/u.exec(text)
  return match?.[1]
}

/** 把一个值渲染成「插进长文本里」的字符串形态（数组按行拼）。 */
function asText(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join('\n')
  return String(value)
}

/**
 * 深度替换占位符。
 *
 * - 整串占位符 ⇒ 原值（数组保持数组：`text` 支持 `string[]`，作者显式分行的意图不能被拍平）；
 * - 嵌在长文本里 ⇒ 字符串化（数组按 `\n` 拼）；
 * - 占位符指向不存在的槽 ⇒ **记 error**（模板缺陷，不能当成空串糊过去）。
 */
function fill(node: unknown, values: Record<string, unknown>, issues: SlotIssue[], path: string): unknown {
  if (typeof node === 'string') {
    const whole = wholePlaceholder(node)
    if (whole !== undefined) {
      if (!(whole in values)) {
        issues.push(unresolved(whole, path))
        return ''
      }
      return values[whole]
    }
    return node.replace(PLACEHOLDER, (raw, id: string) => {
      if (!(id in values)) {
        issues.push(unresolved(id, path))
        return raw
      }
      return asText(values[id])
    })
  }
  if (Array.isArray(node)) return node.map((item, index) => fill(item, values, issues, `${path}[${String(index)}]`))
  if (node !== null && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out[key] = fill(value, values, issues, path === '' ? key : `${path}.${key}`)
    }
    return out
  }
  return node
}

function unresolved(slotId: string, path: string): SlotIssue {
  return {
    slotId,
    code: 'SLOT_UNRESOLVED',
    severity: 'error',
    message: `模板骨架里的占位符 {{${slotId}}}（在 ${path}）找不到对应槽位 —— 这是模板自身的缺陷，请补 slots.json 或删掉该占位符`,
  }
}

/** FNV-1a 32 位（确定性 id 用；不追求抗碰撞，只要求「同内容同 id」）。 */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** 稳定序列化（键排序）—— 「同输入同 id」不能被对象键顺序影响。 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** 画布上下文（构件展开用）；取骨架 meta，缺字段回落到 16:9@30。 */
function contextOf(meta: Record<string, unknown>, totalFrames: number): FurnitureContext {
  const width = typeof meta.width === 'number' && meta.width > 0 ? meta.width : 1920
  const height = typeof meta.height === 'number' && meta.height > 0 ? meta.height : 1080
  const fps = typeof meta.fps === 'number' && meta.fps > 0 ? meta.fps : 30
  return { canvasWidth: width, canvasHeight: height, fps, totalFrames }
}

/**
 * 编译：模板 + 内容 → manifest。**纯函数**（不读盘、不取当前时间）。
 *
 * @throws {TemplateContractError} 模板声明的契约版本与渲染器不符。
 */
export function compileTemplate(
  bundle: TemplateBundle,
  values: Record<string, unknown>,
): CompileOutput {
  const { meta, slots } = bundle
  if (meta.contractVersion !== MANIFEST_CONTRACT_VERSION) {
    throw new TemplateContractError(meta.id, meta.contractVersion)
  }

  // ① 槽位校验（先合并缺省值：合同的「必填」指成片里不能空，不是模型必须逐字给）
  const resolved = resolveSlotValues(slots, values)
  const issues = validateSlotValues(slots, resolved)
  const slotErrors = issues.filter((issue) => issue.severity === 'error')
  if (slotErrors.length > 0) {
    return {
      ok: false,
      manifest: null,
      issues,
      errors: slotErrors.map((issue) => issue.message),
      warnings: [],
      stats: { trackCount: 0, furnitureTracks: 0, sfxCount: 0 },
    }
  }

  // ② 占位符替换（整棵骨架，含 meta.title）
  const filled = fill(bundle.skeleton, resolved, issues, '') as Record<string, unknown>
  const structural = issues.filter((issue) => issue.code === 'SLOT_UNRESOLVED')
  if (structural.length > 0) {
    return {
      ok: false,
      manifest: null,
      issues,
      errors: structural.map((issue) => issue.message),
      warnings: [],
      stats: { trackCount: 0, furnitureTracks: 0, sfxCount: 0 },
    }
  }

  const tracks = Array.isArray(filled.tracks) ? [...(filled.tracks as unknown[])] : []
  const skeletonMeta = (filled.meta ?? {}) as Record<string, unknown>

  // ③ 时长自洽（K-6）：meta.durationInFrames 必须**等于**最大结束帧，否则尾部完整性校验拒收。
  const maxEnd = tracks.reduce<number>((max, track) => {
    const t = track as { startFrame?: unknown; durationInFrames?: unknown }
    const start = typeof t.startFrame === 'number' ? t.startFrame : 0
    const duration = typeof t.durationInFrames === 'number' ? t.durationInFrames : 0
    return Math.max(max, start + duration)
  }, 0)
  const totalFrames = maxEnd > 0
    ? maxEnd
    : (typeof skeletonMeta.durationInFrames === 'number' ? skeletonMeta.durationInFrames : 0)

  // ④ 装饰构件：编译期展开成普通轨道，**纯追加**到末尾（轨序影响叠放层级）
  const ctx = contextOf(skeletonMeta, totalFrames)
  let furnitureTracks: FurnitureTrackDraft[] = []
  if (bundle.furniture !== undefined && bundle.furniture.length > 0) {
    try {
      furnitureTracks = expandFurnitureList(bundle.furniture, ctx)
    } catch (error) {
      return {
        ok: false,
        manifest: null,
        issues,
        errors: [`构件展开失败：${error instanceof Error ? error.message : String(error)}`],
        warnings: [],
        stats: { trackCount: 0, furnitureTracks: 0, sfxCount: 0 },
      }
    }
  }
  tracks.push(...furnitureTracks)

  // ⑤ 音效事件表注入（锚定到骨架轨，不写绝对帧 —— 组合时不会错位）
  const sfx = bundle.audio ?? []
  const manifest: Record<string, unknown> = {
    ...filled,
    id: `comp-tpl-${fnv1a(stableStringify({ template: meta.id, values: resolved }))}`,
    meta: {
      ...skeletonMeta,
      durationInFrames: totalFrames,
      // 编译器就是 builder：产物带标记，render 侧不再发「手写 manifest」的假告警（K-9）。
      generatedBy: 'manifest-builder',
      templateId: meta.id,
      // P-7：家族必须随产物落地 —— G2 段组合的唯一「同族可拼」判据（本期不实现 G2，只留数据）。
      family: meta.family,
    },
    tracks,
  }
  if (sfx.length > 0) {
    const audio = (manifest.audio ?? {}) as ManifestAudio
    const existing = Array.isArray(audio.sfx) ? audio.sfx : []
    manifest.audio = { ...audio, sfx: [...existing, ...sfx] }
  }

  // ⑥ 出厂自检：产物必须过校验（编译器对下游的承诺）
  const verdict = validateManifest(manifest as unknown as CompositionManifest)
  if (!verdict.ok) {
    return {
      ok: false,
      manifest: null,
      issues,
      errors: verdict.errors,
      warnings: verdict.warnings,
      stats: { trackCount: tracks.length, furnitureTracks: furnitureTracks.length, sfxCount: sfx.length },
    }
  }
  return {
    ok: true,
    manifest: manifest as unknown as CompositionManifest,
    issues,
    errors: [],
    warnings: verdict.warnings,
    stats: { trackCount: tracks.length, furnitureTracks: furnitureTracks.length, sfxCount: sfx.length },
  }
}

/** 模板的「装得下多少内容」（闸门判据 1 用；与槽位合同同一份事实）。 */
export function templateCapacity(slots: readonly SlotContract[]): number {
  return requiredCapacity(slots)
}
