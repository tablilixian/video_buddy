/**
 * RQ-12（REQ-038）· **内容规格 schema**（brief → 确定性 spec → manifest）。
 *
 * ## 解决什么
 *
 * playsout 复刻的 `lib/spec.mjs`（221 行、15 张表）是**手搓**的：没有 schema ⇒
 * 换个 brief 就得从头手搓，而且模型「写作文」的自由度太大（写错字段名、漏必填项
 * 都没人拦）。本模块把 spec 定义成**可校验的数据**：模型填空而不是写作文，
 * 校验失败即拒收（RQ-12 验收：spec 校验零错）。
 *
 * ## 与 RQ-10/RQ-21 的接线
 *
 * - `sections[].card` 直接消费 `recipe-cards.ts` 注册表（卡编号）；
 * - `sections[].assets`（slot → URL 映射）喂给生成器的 `ctx.assetSrc`；
 * - `specAssetNeeds()` 汇总**用到的卡**的素材声明并按三路分流（RQ-21：
 *   user / library / generated），同一份 spec 两次运行产出**同一份**清单（确定性）。
 *
 * ## 口径
 *
 * - 时间轴：`sections[].durationSec`（显式）或 `weight`（权重归一）二选一，
 *   fps 把秒折成帧（30fps 基准；末段吃余数保证 Σ = 总帧）；
 * - 确定性：一切数值来源 spec 本身（禁时钟/随机），同 spec ⇒ 同 manifest。
 */
import type { CardAssetDecl } from './recipe-cards.js'
import { getCard, lookupCardId } from './recipe-cards-all.js'
import type { RecipePlan } from './recipes.js'
import { planRecipe } from './recipes.js'
import type { Recipe, RecipeSegment } from './recipes.js'

/** 内容规格（schema 正本；字段语义见各注释）。 */
export interface ContentSpec {
  meta: {
    title: string
    /** 主题（`themes.ts` 的 id；缺省 cold-tech）。 */
    theme?: string
    /** 帧率（缺省 30）。 */
    fps?: number
    /** 总时长（秒；与 sections 的时长/权重共同定帧）。 */
    durationSec?: number
  }
  /** 段序列（每段 = 一张卡 + 内容槽位）。 */
  sections: Array<{
    id: string
    /** 卡编号或卡名（'A2' / 'A2 标题逐字'）；缺省 = 占位段（回落路径）。 */
    card?: string
    /** 主文案（卡生成器的 copy 槽位；B1 用 `k:v; k:v` 行内格式）。 */
    copy: string
    /** 段时长（秒，显式）；与 weight 二选一，都给时长优先。 */
    durationSec?: number
    /** 时长权重（无显式时长时按权重归一）。 */
    weight?: number
    /** 段标签（eyebrow / dataCard 标题用）。 */
    label?: string
    /** 素材槽位 → 同源 URL（喂生成器）。 */
    assetSlots?: Record<string, string>
    /** 强调色覆盖（缺省统一 #4f9cf9）。 */
    accentColor?: string
  }>
  /** 字幕表（可选；词级字幕请走 caption 轨，本表只做占位校对）。 */
  captions?: Array<{ text: string; startSec?: number; endSec?: number }>
  /** 音效钉帧表（可选；由 VO 能量谷推导的工具另行落）。 */
  sfx?: Array<{ name: string; startSec?: number; gain?: number }>
}

/** 素材需求清单条目（RQ-21 分流的数据面；比 CardAssetDecl 多 slot 上下文）。 */
export interface SpecAssetNeed extends CardAssetDecl {
  /** 需要它的段 id。 */
  readonly segmentId: string
}

/** spec 校验结论（与 ManifestValidation 同形）。 */
export interface ContentSpecValidation {
  ok: boolean
  errors: string[]
  warnings: string[]
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** spec → 校验结论（只报 schema 事实：必填 / 取值域 / 卡可解析性；不猜意图）。 */
export function validateContentSpec(spec: unknown): ContentSpecValidation {
  const errors: string[] = []
  const warnings: string[] = []
  if (!isRecord(spec)) return { ok: false, errors: ['spec 必须是 JSON 对象'], warnings }
  const meta = spec.meta
  if (!isRecord(meta)) {
    errors.push('spec.meta 必须是对象')
  } else {
    if (!isNonEmptyString(meta.title)) errors.push('spec.meta.title 必须是非空字符串')
    if (meta.fps !== undefined && (typeof meta.fps !== 'number' || meta.fps < 1 || meta.fps > 120)) {
      errors.push('spec.meta.fps 必须是 1–120 的数值')
    }
    if (meta.durationSec !== undefined && (typeof meta.durationSec !== 'number' || meta.durationSec <= 0 || meta.durationSec > 3600)) {
      errors.push('spec.meta.durationSec 必须是 (0, 3600] 的数值（秒）')
    }
  }
  const sections = spec.sections
  if (!Array.isArray(sections) || sections.length === 0) {
    errors.push('spec.sections 必须是非空数组（一段都没有的片不存在）')
  } else {
    if (sections.length > 64) errors.push(`spec.sections 最多 64 段（当前 ${sections.length}）`)
    sections.forEach((section, index) => {
      const at = `spec.sections[${index}]`
      if (!isRecord(section)) {
        errors.push(`${at} 必须是对象`)
        return
      }
      if (!isNonEmptyString(section.id)) errors.push(`${at}.id 必须是非空字符串`)
      if (!isNonEmptyString(section.copy)) errors.push(`${at}.copy 必须是非空字符串（卡生成器的 copy 槽位）`)
      if (section.durationSec !== undefined && (typeof section.durationSec !== 'number' || section.durationSec <= 0)) {
        errors.push(`${at}.durationSec 必须是正数（秒）`)
      }
      if (section.weight !== undefined && (typeof section.weight !== 'number' || section.weight <= 0)) {
        errors.push(`${at}.weight 必须是正数`)
      }
      if (section.card !== undefined && isNonEmptyString(section.card) && lookupCardId(section.card) === null) {
        warnings.push(`${at}.card "${section.card}" 未注册 —— 该段将走占位回落（RQ-10 回落路径）`)
      }
      const slots = section.assetSlots
      if (slots !== undefined) {
        if (!isRecord(slots)) errors.push(`${at}.assetSlots 必须是对象（slot → URL）`)
        else {
          for (const [slot, url] of Object.entries(slots)) {
            if (!isNonEmptyString(url)) errors.push(`${at}.assetSlots.${slot} 必须是非空字符串 URL`)
          }
        }
      }
    })
  }
  const captions = spec.captions
  if (captions !== undefined) {
    if (!Array.isArray(captions)) errors.push('spec.captions 必须是数组')
    else {
      captions.forEach((caption, index) => {
        if (!isRecord(caption) || !isNonEmptyString(caption.text)) {
          errors.push(`spec.captions[${index}].text 必须是非空字符串`)
        }
      })
    }
  }
  const sfx = spec.sfx
  if (sfx !== undefined) {
    if (!Array.isArray(sfx)) errors.push('spec.sfx 必须是数组')
    else {
      sfx.forEach((event, index) => {
        if (!isRecord(event) || !isNonEmptyString(event.name)) {
          errors.push(`spec.sfx[${index}].name 必须是非空字符串`)
        }
        if (isRecord(event) && event.startSec !== undefined && (typeof event.startSec !== 'number' || event.startSec < 0)) {
          errors.push(`spec.sfx[${index}].startSec 必须是 ≥0 的数值（秒）`)
        }
      })
    }
  }
  return { ok: errors.length === 0, errors, warnings }
}

/**
 * RQ-21 · **素材需求清单**（确定性）：汇总 spec 用到的卡的 `assets` 声明，
 * 按 source 三路分组返回。同一份 spec 两次调用产出同一份清单（深比较相等）。
 */
export function specAssetNeeds(spec: ContentSpec): {
  user: SpecAssetNeed[]
  library: SpecAssetNeed[]
  generated: SpecAssetNeed[]
  /** 全部条目（未分流；按段序稳定排序）。 */
  all: SpecAssetNeed[]
} {
  const all: SpecAssetNeed[] = []
  for (const section of spec.sections) {
    const cardId = section.card === undefined ? null : lookupCardId(section.card)
    if (cardId === null) continue
    const card = getCard(cardId)
    if (card === undefined) continue
    for (const decl of card.assets) {
      all.push({ ...decl, segmentId: section.id })
    }
  }
  const by = (source: SpecAssetNeed['source']): SpecAssetNeed[] => all.filter((need) => need.source === source)
  return { user: by('user'), library: by('library'), generated: by('generated'), all }
}

/** spec 段 → recipes.ts 的 RecipeSegment 形状（复用 planRecipe 的时长切分）。 */
function toRecipe(spec: ContentSpec): Recipe {
  const segments: RecipeSegment[] = spec.sections.map((section) => ({
    id: section.id,
    label: section.label ?? section.id,
    card: section.card ?? '—',
    // durationSec 显式时换算成权重近似（fps 无关：权重只用于相对切分）；都缺省给 1。
    weight: section.durationSec ?? section.weight ?? 1,
    copy: section.copy,
  }))
  return {
    id: 'content-spec',
    title: spec.meta.title,
    note: '由 content-spec 确定性生成',
    theme: spec.meta.theme ?? 'cold-tech',
    segments,
    assets: [],
  }
}

/**
 * spec → 配方计划（确定性）。卡已注册的段走生成器（RQ-10 接线）；
 * 未注册的段回落 planRecipe 的占位轨。返回里带素材需求清单（RQ-21）。
 */
export function planFromSpec(spec: ContentSpec, totalFrames: number): RecipePlan & { assetNeeds: ReturnType<typeof specAssetNeeds> } {
  const recipe = toRecipe(spec)
  const plan = planRecipe({ title: spec.meta.title, totalFrames, recipe })
  const tracks: Record<string, unknown>[] = []
  for (const slot of plan.timeline) {
    const section = spec.sections.find((candidate) => candidate.id === slot.id)
    if (section === undefined) continue
    const cardId = section.card === undefined ? null : lookupCardId(section.card)
    const card = cardId === null ? undefined : getCard(cardId)
    if (card === undefined) {
      // 回落：保留 planRecipe 的占位轨（老行为）。
      const placeholder = plan.tracks.find((track) => track.id === `seg-${slot.id}`)
      if (placeholder !== undefined) tracks.push(placeholder)
      continue
    }
    const slots = section.assetSlots ?? {}
    tracks.push(...card.generate({
      segmentId: slot.id,
      label: section.label ?? slot.label,
      copy: section.copy,
      startFrame: slot.startFrame,
      durationInFrames: slot.durationInFrames,
      index: spec.sections.indexOf(section),
      sectionCount: spec.sections.length,
      assetSrc: (name: string) => slots[name],
      accentColor: section.accentColor ?? '#4f9cf9',
    }))
  }
  // 背景底轨（与 planRecipe 一致；若卡已出过 base 也保留这层全片底色）。
  const hasBg = tracks.some((track) => track.id === 'bg')
  if (!hasBg) {
    tracks.unshift({
      id: 'bg',
      type: 'shape',
      shape: 'gradient',
      color: '#111827',
      box: { x: 50, y: 50, w: 100, h: 100 },
      startFrame: 0,
      durationInFrames: totalFrames,
      fadeFrames: 0,
    })
  }
  return { tracks, timeline: plan.timeline, assetNeeds: specAssetNeeds(spec) }
}
