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
import type { CellRect } from './cell-projection.js'
import { projectBoxToCell } from './cell-projection.js'
import type { StagePlan } from './stage-plan.js'
import { StagePlanError, planStages } from './stage-plan.js'
import { applyStageTransitions } from './stage-transition.js'

/** 一屏内的一个单元（RQ-25）：主视觉 + 文案 + 自己的格位。 */
export interface SpecUnit {
  /** 卡编号或卡名（'A2' / 'A2 标题逐字'）；未注册即回落占位。 */
  card: string
  /**
   * **刻意叠层声明**（RQ-R8）：本单元格位与同屏其他单元相交超过容忍阈值时，
   * 写 `true` 才放行 —— 静默遮挡是错，显式声明是设计。缺省 false（无声明）。
   */
  overlap?: boolean
  /** 该单元的主文案（卡生成器的 copy 槽位）。 */
  copy: string
  label?: string
  /** 该单元独占的格位；缺省 = 该屏的 `sections[].cell`，再缺省 = 全屏。 */
  cell?: CellRect
  assetSlots?: Record<string, string>
  accentColor?: string
}

/** 跨屏常驻层（RQ-26）：一条非全屏底板，从 fromSection 首帧铺到 toSection 末帧。 */
export interface SpecCarry {
  id: string
  box: CellRect
  color: string
  /** 圆角（px）；缺省 0。 */
  radius?: number
  /** 覆盖起点屏 id；缺省 = 第一屏。 */
  fromSection?: string
  /** 覆盖终点屏 id；缺省 = 最后一屏。 */
  toSection?: string
}

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
    /**
     * B1（RQ-N2）：屏数与节奏交给 `planStages()` 算 —— 屏数 = clamp(round(时长/6.5), 2, 40)，
     * 单屏 4–10s，屏边界向 TTS 句起点（`stageBoundarySec`）±0.6s 吸附。
     * **显式 true 才启用**；缺省/ false = 旧行为逐字段不变（回归纪律）。
     * 启用后 sections 只管内容（每段不许带 durationSec/weight），且段数必须等于算出的屏数。
     */
    autoStages?: boolean
    /**
     * TTS 句起点（秒，严格升序；来自 tts_narration 回执 `audio.voiceOver[].startSec` 换算）。
     * 仅 `autoStages: true` 时参与屏边界吸附；只写本字段不开 autoStages 会被警告「不生效」。
     */
    stageBoundarySec?: number[]
  }
  /** 段序列（每段 = 一屏；一屏可含 1–4 个单元）。 */
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
    /**
     * 该屏的缺省格位（RQ-25）。给了 `units` 而未逐个给 `cell` 时，所有单元共享它；
     * 两者都缺省 = 全屏（与今天行为逐字段一致）。
     */
    cell?: CellRect
    /**
     * 一屏多单元（RQ-25）：1–4 个，共享该屏的时间窗、各占自己的格位。
     * **与 `card` 互斥**（同给即校验失败）。
     */
    units?: SpecUnit[]
  }>
  /** 字幕表（可选；词级字幕请走 caption 轨，本表只做占位校对）。 */
  captions?: Array<{ text: string; startSec?: number; endSec?: number }>
  /** 音效钉帧表（可选；由 VO 能量谷推导的工具另行落）。 */
  sfx?: Array<{ name: string; startSec?: number; gain?: number }>
  /** 跨屏常驻层（RQ-26）：真机 45s 版为 0 块，手写 60s 版 9 块，差的就是这个字段。 */
  carry?: SpecCarry[]
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

/** 格位校验（RQ-25）：中心点百分比，宽高为正；`fontScale` 缺省由短边推导。 */
/**
 * 同屏格位相交的容忍阈值（占较小格位面积的百分比）。
 * D4 标定初值 5%（贴边 / 呼吸位预留 / 浮点），标定表见 docs/plans/REQ-038-R7-…md §11.6；
 * 复核条件：出现被误拒的合法叠层样本 → 放宽；出现 5–10% 的明显遮挡漏网 → 收紧。改值只改此处。
 */
export const CELL_OVERLAP_TOLERANT_PERCENT = 5

/**
 * 两格位的相交率（box 中心语义，与 ML-13 的 box 交同口径）：相交面积 / 较小格位面积 × 100。
 */
export function cellOverlapPercent(a: CellRect, b: CellRect): number {
  const ax0 = a.x - a.w / 2
  const ax1 = a.x + a.w / 2
  const ay0 = a.y - a.h / 2
  const ay1 = a.y + a.h / 2
  const bx0 = b.x - b.w / 2
  const bx1 = b.x + b.w / 2
  const by0 = b.y - b.h / 2
  const by1 = b.y + b.h / 2
  const iw = Math.min(ax1, bx1) - Math.max(ax0, bx0)
  const ih = Math.min(ay1, by1) - Math.max(ay0, by0)
  if (iw <= 0 || ih <= 0) return 0
  const minArea = Math.min(a.w * a.h, b.w * b.h)
  if (minArea <= 0) return 0
  return ((iw * ih) / minArea) * 100
}

function checkCell(value: unknown, at: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${at} 必须是对象（{ x, y, w, h } 百分比中心点，与 box 同口径）`)
    return
  }
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    const n = value[key]
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      errors.push(`${at}.${key} 必须是数值`)
      continue
    }
    if (key === 'w' || key === 'h') {
      if (n <= 0 || n > 100) errors.push(`${at}.${key} 必须在 (0, 100] 内（当前 ${String(n)}）`)
    } else if (n < 0 || n > 100) {
      errors.push(`${at}.${key} 必须在 [0, 100] 内（当前 ${String(n)}）`)
    }
  }
  if (value.fontScale !== undefined) {
    // 保留字段但不承诺生效：textCard 白名单没有 fontSize，字号由 planTextFit 按 box 推。
    // 仍然校验形态，避免将来接线时留一个没人验过的字段。
    errors.push(`${at}.fontScale 暂不生效 —— textCard 的字号由 planTextFit 按 box 宽度推，请改用格位宽度控制字号`)
  }
}

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
    if (meta.autoStages !== undefined && typeof meta.autoStages !== 'boolean') {
      errors.push('spec.meta.autoStages 必须是布尔值')
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
      // RQ-25：格位与多单元。两者都是可选字段，缺省即旧行为（这是回归纪律）。
      if (section.card !== undefined && section.units !== undefined) {
        errors.push(`${at} 的 card 与 units 互斥 —— 单单元写 card，多单元写 units（两个都给会让「谁是主视觉」无解）`)
      }
      if (section.cell !== undefined) checkCell(section.cell, `${at}.cell`, errors)
      if (section.units !== undefined) {
        if (!Array.isArray(section.units) || section.units.length === 0) {
          errors.push(`${at}.units 必须是非空数组（不分区就别写这个字段）`)
        } else if (section.units.length > 4) {
          errors.push(`${at}.units 最多 4 个单元（当前 ${String(section.units.length)}）—— 一屏塞 5 个东西谁也不读`)
        } else {
          section.units.forEach((unit, unitIndex) => {
            const unitAt = `${at}.units[${String(unitIndex)}]`
            if (!isRecord(unit)) {
              errors.push(`${unitAt} 必须是对象`)
              return
            }
            if (!isNonEmptyString(unit.card)) errors.push(`${unitAt}.card 必须是非空字符串`)
            else if (lookupCardId(unit.card) === null) {
              warnings.push(`${unitAt}.card "${unit.card}" 未注册 —— 该单元将走占位回落`)
            }
            if (!isNonEmptyString(unit.copy)) errors.push(`${unitAt}.copy 必须是非空字符串`)
            if (unit.cell !== undefined) checkCell(unit.cell, `${unitAt}.cell`, errors)
            if (unit.overlap !== undefined && typeof unit.overlap !== 'boolean') {
              errors.push(`${unitAt}.overlap 必须是布尔值（刻意叠层声明：true = 本格位允许与同屏其他单元相交）`)
            }
          })
          // RQ-R8（A1）：同屏格位相交分级校验 —— 动效在格位内部（卡内动画），跨格位的长期
          // 并存只有两种解释：写错了，或刻意叠层（overlap: true 显式声明）。≤5% 贴边放行。
          const pairCells = section.units.map((unit) => {
            const raw = (isRecord(unit) && isRecord((unit as Record<string, unknown>).cell))
              ? (unit as Record<string, unknown>).cell as Record<string, unknown>
              : (isRecord(section.cell) ? section.cell as Record<string, unknown> : {})
            return {
              x: typeof raw.x === 'number' ? raw.x : 50,
              y: typeof raw.y === 'number' ? raw.y : 50,
              w: typeof raw.w === 'number' ? raw.w : 100,
              h: typeof raw.h === 'number' ? raw.h : 100,
            }
          })
          for (let i = 0; i < section.units.length; i++) {
            for (let j = i + 1; j < section.units.length; j++) {
              const ui = section.units[i] as { overlap?: unknown } | null
              const uj = section.units[j] as { overlap?: unknown } | null
              if (ui?.overlap === true || uj?.overlap === true) continue
              const pct = cellOverlapPercent(pairCells[i] as CellRect, pairCells[j] as CellRect)
              if (pct > CELL_OVERLAP_TOLERANT_PERCENT) {
                errors.push(
                  `${at} 的格位 units[${String(i)}] 与 units[${String(j)}] 相交 ${String(Math.round(pct))}%（占较小格位）—— `
                    + '同屏内容格位长期并存是遮挡不是动效（动效在格位内部）：把两个格位错开，'
                    + `或在刻意叠层的单元上写 "overlap": true 声明设计意图（≤${String(CELL_OVERLAP_TOLERANT_PERCENT)}% 贴边自动放行）`,
                )
              }
            }
          }
        }
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
  // B1（RQ-N2）：autoStages —— 屏数与节奏由 planStages 算，sections 只管内容。
  // 对账失败即拒收（两种意图打架：模型数了一遍屏，工具算了一遍屏，必须只留一个）。
  if (isRecord(meta) && meta.autoStages === true) {
    const durationSec = meta.durationSec
    if (typeof durationSec !== 'number' || durationSec <= 0) {
      errors.push('spec.meta.autoStages 开启时必须给 meta.durationSec —— 屏数 = round(时长 / 6.5)，没有总时长就无解')
    } else {
      if (Array.isArray(sections)) {
        sections.forEach((section, index) => {
          if (isRecord(section) && (section.durationSec !== undefined || section.weight !== undefined)) {
            errors.push(`spec.sections[${index}] 在 autoStages 下不能带 durationSec/weight —— 节奏归 planStages（单屏 4–10s）；要自己控节奏就关掉 autoStages`)
          }
        })
      }
      const boundaries = meta.stageBoundarySec
      if (boundaries !== undefined && Array.isArray(boundaries)) {
        boundaries.forEach((value, index) => {
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > durationSec) {
            errors.push(`spec.meta.stageBoundarySec[${index}] 必须是 [0, ${String(durationSec)}] 内的秒数，收到 ${String(value)}`)
          } else if (index > 0 && (value as number) <= (boundaries[index - 1] as number)) {
            errors.push(`spec.meta.stageBoundarySec 必须严格升序（TTS 句起点），[${String(index - 1)}] ≥ [${String(index)}]`)
          }
        })
      }
      if (Array.isArray(sections) && sections.length > 0) {
        try {
          const fps = typeof meta.fps === 'number' && meta.fps >= 1 ? meta.fps : 30
          const stagePlan = planStages({
            totalSeconds: durationSec,
            fps,
            ...(Array.isArray(boundaries) ? { boundaries: boundaries.map((value) => Math.round((value as number) * fps)) } : {}),
          })
          if (stagePlan.stages.length !== sections.length) {
            errors.push(
              `autoStages 算出 ${String(stagePlan.stages.length)} 屏（round(${String(durationSec)}/6.5)，${stagePlan.meta.clamped ? '触到屏数上限' : '未触上限'}），但 sections 写了 ${String(sections.length)} 段 —— `
                + `把 sections 调成 ${String(stagePlan.stages.length)} 段，或关掉 autoStages 自己控节奏`,
            )
          }
        } catch (cause) {
          // planStages 抛错（如时长不足单屏下限）→ 转成校验错误回给模型，不是吞掉。
          errors.push(`autoStages 算不出屏表：${cause instanceof Error ? cause.message : String(cause)}`)
        }
      }
    }
  } else if (isRecord(meta) && meta.stageBoundarySec !== undefined) {
    warnings.push('spec.meta.stageBoundarySec 写了但没开 autoStages —— 本字段只在 autoStages: true 时参与屏边界吸附，当前不生效')
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
  // RQ-26：跨屏常驻层。fromSection / toSection 指向不存在的屏必须报错 ——
  // 静默丢一条常驻层就是「又变回 0 块底板」，而这个错误在成片里看不出来。
  const carry = spec.carry
  if (carry !== undefined) {
    if (!Array.isArray(carry)) errors.push('spec.carry 必须是数组')
    else {
      const order = new Map<string, number>()
      if (Array.isArray(sections)) {
        sections.forEach((section, index) => {
          if (isRecord(section) && isNonEmptyString(section.id) && !order.has(section.id)) order.set(section.id, index)
        })
      }
      carry.forEach((item, index) => {
        const at = `spec.carry[${index}]`
        if (!isRecord(item)) {
          errors.push(`${at} 必须是对象`)
          return
        }
        if (!isNonEmptyString(item.id)) errors.push(`${at}.id 必须是非空字符串`)
        if (!isNonEmptyString(item.color)) errors.push(`${at}.color 必须是非空字符串`)
        if (item.box === undefined) errors.push(`${at}.box 必填（常驻层的形状与位置）`)
        else checkCell(item.box, `${at}.box`, errors)
        for (const key of ['fromSection', 'toSection'] as const) {
          const id = item[key]
          if (id === undefined) continue
          if (!isNonEmptyString(id)) errors.push(`${at}.${key} 必须是非空字符串`)
          else if (!order.has(id)) errors.push(`${at}.${key} 指向不存在的屏 "${id}"`)
        }
        const from = isNonEmptyString(item.fromSection) ? order.get(item.fromSection) : 0
        const to = isNonEmptyString(item.toSection) ? order.get(item.toSection) : (order.size === 0 ? 0 : order.size - 1)
        if (from !== undefined && to !== undefined && from > to) {
          errors.push(`${at} 的 fromSection 在 toSection 之后 —— 常驻层的时间窗是空的`)
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

/** 一屏的单元列表（RQ-25）：`units` 优先，否则把 `card` 当唯一单元（旧行为）。 */
function resolveUnits(section: ContentSpec['sections'][number]): SpecUnit[] {
  if (Array.isArray(section.units) && section.units.length > 0) return section.units
  return [{
    card: section.card ?? '',
    copy: section.copy,
    ...(section.label === undefined ? {} : { label: section.label }),
    ...(section.assetSlots === undefined ? {} : { assetSlots: section.assetSlots }),
    ...(section.accentColor === undefined ? {} : { accentColor: section.accentColor }),
  }]
}

/**
 * 把一组单元轨投影进格位（RQ-25）。
 *
 * - 几何：`projectBoxToCell` 仿射映射（卡内部仍是 100%×100% 坐标系，卡不用改）；
 * - 字号：**不在这里动** —— `textCard` 白名单没有 `fontSize`，字由 `planTextFit`
 *   按 box 宽度实时推（详见 `cell-projection.ts` 头注释）。硬塞会被校验拒收；
 * - id：多单元时加 `u{i}-` 前缀，否则两个单元各自生成的 `t1` 会撞号（manifest 查重）。
 *
 * `cell === undefined` 时**原样返回**（同一个数组引用）—— 这是「旧 spec 逐字段不变」的
 * 执行点：不投影、不改 id。
 */
function projectUnitTracks(
  generated: Record<string, unknown>[],
  cell: CellRect | undefined,
  idPrefix: string | undefined,
): Record<string, unknown>[] {
  if (cell === undefined) return generated
  const prefix = idPrefix ?? ''
  return generated.map((track) => {
    const next: Record<string, unknown> = { ...track }
    if (prefix !== '' && typeof next.id === 'string') next.id = `${prefix}${next.id}`
    const box = next.box
    if (isRecord(box)
      && typeof box.x === 'number' && typeof box.y === 'number'
      && typeof box.w === 'number' && typeof box.h === 'number') {
      next.box = projectBoxToCell({ x: box.x, y: box.y, w: box.w, h: box.h }, cell)
    }
    return next
  })
}

/** 跨屏常驻层 → 轨（RQ-26）：帧窗 = fromSection 首帧到 toSection 末帧。 */
function buildCarryTracks(spec: ContentSpec, timeline: RecipePlan['timeline']): Record<string, unknown>[] {
  const carries = spec.carry
  if (!Array.isArray(carries) || carries.length === 0) return []
  const first = timeline[0]
  const last = timeline[timeline.length - 1]
  if (first === undefined || last === undefined) return []
  const byId = new Map(timeline.map((slot) => [slot.id, slot]))
  const out: Record<string, unknown>[] = []
  for (const item of carries) {
    const from = item.fromSection === undefined ? first : (byId.get(item.fromSection) ?? first)
    const to = item.toSection === undefined ? last : (byId.get(item.toSection) ?? last)
    out.push({
      id: item.id,
      type: 'shape',
      shape: 'rect',
      color: item.color,
      box: { x: item.box.x, y: item.box.y, w: item.box.w, h: item.box.h },
      ...(item.radius === undefined ? {} : { radius: item.radius }),
      startFrame: from.startFrame,
      durationInFrames: Math.max(1, to.startFrame + to.durationInFrames - from.startFrame),
      // 常驻层不做入场：每进一屏闪一次就不叫常驻了。
      fadeFrames: 0,
    })
  }
  return out
}

/**
 * spec → 配方计划（确定性）。卡已注册的段走生成器（RQ-10 接线）；
 * 未注册的段回落 planRecipe 的占位轨。返回里带素材需求清单（RQ-21）。
 */
export function planFromSpec(spec: ContentSpec, totalFrames: number): RecipePlan & { assetNeeds: ReturnType<typeof specAssetNeeds>; stagePlan?: StagePlan } {
  const recipe = toRecipe(spec)
  const plan = planRecipe({ title: spec.meta.title, totalFrames, recipe })
  // B1（RQ-N2）：autoStages —— planStages 的屏窗替换 planRecipe 的等权切分。
  // 只在显式 true 时走这条分支；false/缺省连这行计算都不碰（旧 spec 逐字段不变是回归纪律）。
  let timeline = plan.timeline
  let stagePlan: StagePlan | undefined
  if (spec.meta.autoStages === true) {
    const fps = spec.meta.fps === undefined || spec.meta.fps < 1 ? 30 : spec.meta.fps
    stagePlan = planStages({
      totalSeconds: totalFrames / fps,
      fps,
      ...(Array.isArray(spec.meta.stageBoundarySec)
        ? { boundaries: spec.meta.stageBoundarySec.map((value) => Math.round(value * fps)) }
        : {}),
    })
    if (stagePlan.stages.length !== spec.sections.length) {
      throw new StagePlanError(`planFromSpec: autoStages 算出 ${String(stagePlan.stages.length)} 屏但 sections 有 ${String(spec.sections.length)} 段 —— 先过 validateContentSpec（会拦住这种 spec）`)
    }
    timeline = stagePlan.stages.map((stage, index) => {
      const section = spec.sections[index] as ContentSpec['sections'][number]
      return {
        id: section.id,
        label: section.label ?? section.id,
        card: section.card ?? '—',
        startFrame: stage.startFrame,
        durationInFrames: stage.durationInFrames,
      }
    })
  }
  const tracks: Record<string, unknown>[] = []
  // B4：按屏分桶（顺序与 timeline 一一对应），供段间转场配对；bg/carry 是全片轨，不进桶。
  const screenTracks: Record<string, unknown>[][] = []
  for (const slot of timeline) {
    const section = spec.sections.find((candidate) => candidate.id === slot.id)
    if (section === undefined) {
      screenTracks.push([])
      continue
    }
    const bucket: Record<string, unknown>[] = []
    screenTracks.push(bucket)
    const units = resolveUnits(section)
    const multi = units.length > 1
    units.forEach((unit, unitIndex) => {
      const cardId = lookupCardId(unit.card)
      const card = cardId === null ? undefined : getCard(cardId)
      if (card === undefined) {
        // 回落：保留 planRecipe 的占位轨（老行为）。多单元时只在一屏全未注册时回落一次，
        // 避免「3 个单元里 1 个没注册」产出 3 张占位卡叠在同一个位置。
        if (!multi) {
          const placeholder = plan.tracks.find((track) => track.id === `seg-${slot.id}`)
          if (placeholder !== undefined) {
            // autoStages 下 planRecipe 的占位轨仍是等权节拍，必须按屏窗重排；
            // 非 autoStages 推同一个对象引用（逐字段不变是回归纪律）。
            const placed = stagePlan === undefined
              ? placeholder
              : { ...placeholder, startFrame: slot.startFrame, durationInFrames: slot.durationInFrames }
            tracks.push(placed)
            bucket.push(placed)
          }
        }
        return
      }
      const slots = unit.assetSlots ?? section.assetSlots ?? {}
      const generated = card.generate({
        segmentId: multi ? `${slot.id}-u${String(unitIndex)}` : slot.id,
        label: unit.label ?? section.label ?? slot.label,
        copy: unit.copy,
        startFrame: slot.startFrame,
        durationInFrames: slot.durationInFrames,
        index: spec.sections.indexOf(section),
        sectionCount: spec.sections.length,
        assetSrc: (name: string) => slots[name],
        accentColor: unit.accentColor ?? section.accentColor ?? '#4f9cf9',
      })
      const projected = projectUnitTracks(generated, unit.cell ?? section.cell, multi ? `u${String(unitIndex)}-` : undefined)
      tracks.push(...projected)
      bucket.push(...projected)
    })
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
  // 常驻层压在内容之下、底色之上（轨序即层叠：后画的在上）。
  const carryTracks = buildCarryTracks(spec, timeline)
  if (carryTracks.length > 0) tracks.splice(1, 0, ...carryTracks)
  // B4（D1 方案②）：段间转场 —— 下一屏内容轨左移 T 帧造叠化窗，边界插既有 transition 轨。
  // bg / carry 是全片轨不参与；屏数 <2 或空屏（全未注册多单元）该边界自然跳过。
  const transitions = applyStageTransitions({
    screens: screenTracks,
    boundaryFrames: timeline.map((slot) => slot.startFrame),
    filmEndFrame: totalFrames,
  })
  tracks.push(...transitions)
  return { tracks, timeline, assetNeeds: specAssetNeeds(spec), ...(stagePlan === undefined ? {} : { stagePlan }) }
}
