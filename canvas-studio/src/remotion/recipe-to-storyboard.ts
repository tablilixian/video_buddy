/**
 * §3.4 / §3.4.1：配方 → 故事板种子（`recipeToStoryboardSeed`）+ spec 种子（`specSeed`）。
 *
 * ## 它解决什么
 *
 * 配方（`recipes.ts`）给的是结构骨架，但结构要落进两处契约才生效：
 * `write_storyboard` 九节（阶段一终点）与 `ContentSpec`（`scaffold_manifest({specPath})`）。
 * 没有这个编译器，模型得把段序列 / 权重 / 素材需求手抄两遍 —— 抄错一处就是
 * 「storyboard 与 spec 段数不符」的拒收。这里把映射钉成纯函数。
 *
 * ## 三条硬纪律（开发文档 §3.4「必须守住」）
 *
 * 1. **只产种子节 00/02/04/07/08** —— §03 旁白 / §05 角色 / §06 声音留给真值与
 *    用户意图，不由配方生成；输出走 `write_storyboard` 的分节合并语义。
 * 2. **不跑 `validateForSeed` 拦截**（反变异 2b）—— 本函数按设计产出全 `pending`
 *    素材，`enforceAssetReadiness` 下 pending 是 blocker ⇒ 生成即被拦 = 三套有素材
 *    配方死锁。拦截的唯一位置是落地（`storyboard-land.ts`），`write_storyboard`
 *    本身也只报不拦。谁在生成路径上调 `validateForSeed`，`tests/recipe-seed.test.mjs`
 *    的源码文本断言必须红。
 * 3. **bare 数组形态** —— §07 / §08 的 normalize 只认数组（`contracts/storyboard.ts:709-710`），
 *    wrapper（`{"assets":[…]}`）会被静默清空成 `[]`。seed 输出 bare，模型原样喂。
 *
 * 生成后过 `normalizeStoryboard` + 结构自检（tokens / scenes / shots 非空、语义 ID
 * 唯一、`frames = round(duration×fps)` 同源），不通过直接抛 —— 宁可不给 seed，
 * 不给一份落不了地的 seed。
 */
import {
  collectSemanticIds,
  normalizeStoryboard,
  type StoryboardSections,
} from '../contracts/storyboard.js'
import { throwError } from '../error-system.js'
// 本模块自己抛的错误出自 catalog —— 按仓库惯例在使用方注册一次，
// 否则单独驱动本模块（测试）会得到「未注册的错误码」而不是真文案。
import '../errors/catalog.js'
import type { ContentSpec } from './content-spec.js'
import type { Recipe } from './recipes.js'

/** `list_recipes` requirements 里 seed 消费的字段（其余字段只喂判据）。 */
export interface RecipeSeedRequirements {
  readonly totalSeconds?: number
  readonly audience?: string
}

export interface RecipeSeedInput {
  readonly recipe: Recipe
  readonly requirements?: RecipeSeedRequirements
  /** 合成帧率（缺省 30）—— `frames = round(duration×fps)` 的换算依据。 */
  readonly fps?: number
  /** 片名（§00 brief 与 `specSeed.meta.title` 用；缺省用配方标题）。 */
  readonly title?: string
}

export interface RecipeSeedResult {
  /** 只含种子节 00/02/04/07/08 的 `Partial<StoryboardSections>`（bare 形态）。 */
  readonly sections: Partial<StoryboardSections>
  /** 喂 `build/manifest-spec.json` 的 spec 种子（§3.4.1 映射）。 */
  readonly specSeed: Partial<ContentSpec>
  /** 「哪些节是配方填的」—— 回执文案直接列给模型。 */
  readonly filledSections: readonly string[]
}

/** 配方填的五节（其余四节 01/03/05/06 不动，保留用户已写内容）。 */
const SEED_FILLED = [
  '00_creative',
  '02_visual',
  '04_storyboard',
  '07_assets',
  '08_constraints',
] as const

/** 未给 `totalSeconds` 时的兜底段长（秒）—— 同时写进 §08 让兜底可审计。 */
const FALLBACK_SEC_PER_SEGMENT = 5

/** §07 素材 `name` 上限：note 并进 name 后截断，别把整段 note 变成清单名。 */
const ASSET_NAME_LIMIT = 80

/**
 * 配方 → 故事板种子 + spec 种子（纯函数，不读盘、不调工具）。
 *
 * 时长算法与 `planRecipe` 同源：按权重把总帧数分给各段，前 n-1 段
 * `round(w/Σw × totalFrames)`、余数给最后一段 —— Σ frames 恒等于
 * `round(totalSeconds×fps)`，`duration = frames/fps` 使
 * `round(duration×fps) === frames` 天然成立（同源，不引入第二套换算）。
 */
export function recipeToStoryboardSeed(input: RecipeSeedInput): RecipeSeedResult {
  const { recipe } = input
  const fps = input.fps ?? 30
  const requirements = input.requirements ?? {}
  const givenTotal = typeof requirements.totalSeconds === 'number'
    && Number.isFinite(requirements.totalSeconds)
    && requirements.totalSeconds > 0
    ? requirements.totalSeconds
    : undefined
  const totalSeconds = givenTotal ?? recipe.segments.length * FALLBACK_SEC_PER_SEGMENT
  const totalFrames = Math.max(1, Math.round(totalSeconds * fps))
  const totalWeight = recipe.segments.reduce((sum, segment) => sum + Math.max(0, segment.weight), 0) || 1

  // ── §04：一段一 scene 一 shot（id 铸 S<n> / S<n>-Sh1，符合 ID_PATTERN） ──
  // 帧分配与 planRecipe 同源：前 n-1 段 round、余数给最后一段 ⇒ Σ = totalFrames。
  let cursor = 0
  const scenes = recipe.segments.map((segment, index) => {
    const isLast = index === recipe.segments.length - 1
    const frames = isLast
      ? Math.max(1, totalFrames - cursor)
      : Math.max(1, Math.round((Math.max(0, segment.weight) / totalWeight) * totalFrames))
    cursor += frames
    const copy = segment.copy.replace(/\s+/gu, ' ').trim()
    return {
      id: `S${String(index + 1)}`,
      title: segment.label,
      shots: [{
        id: `S${String(index + 1)}-Sh1`,
        duration: frames / fps,
        frames,
        // 占位运镜/声底：seed 只定结构，具体语汇由模型按镜头语汇 token 改写。
        camera: '固定',
        visual: `「${segment.label}」${segment.card}：${copy}`,
        audio: '无声/环境底',
        backup: false,
      }],
    }
  })
  const shotIdBySegment = new Map<string, string>()
  recipe.segments.forEach((segment, index) => {
    shotIdBySegment.set(segment.id, `S${String(index + 1)}-Sh1`)
  })

  // ── §07：素材 pending + neededBy 指向本批 shot（修 recipeAssetsJson 空 neededBy） ──
  const assets = recipe.assets.map((asset) => {
    const note = asset.note.length > ASSET_NAME_LIMIT
      ? `${asset.note.slice(0, ASSET_NAME_LIMIT - 1)}…`
      : asset.note
    const shotId = shotIdBySegment.get(asset.segmentId)
    return {
      name: `${note}（${asset.name}）`,
      type: asset.type,
      status: 'pending' as const,
      ref: { kind: 'file' as const, id: '' },
      neededBy: shotId === undefined ? [] : [shotId],
      source: asset.source,
    }
  })

  // ── §00 / §02 / §08：brief 短句 + theme token + 硬约束逐条 ──
  const title = input.title ?? recipe.title
  const brief = input.title === undefined
    ? `${recipe.title}（${recipe.id}）`
    : `${title}：${recipe.title}（${recipe.id}）`
  const constraints: string[] = [
    `配方注意：${recipe.note}`,
    `结构起点：配方 ${recipe.id}，判据由 list_recipes 五判据给出`,
  ]
  if (requirements.audience !== undefined && requirements.audience.trim() !== '') {
    constraints.push(`受众：${requirements.audience.trim()}（文案抽象度以该人群为准）`)
  }
  if (givenTotal === undefined) {
    constraints.push(`未给 totalSeconds，段时长按 ${String(FALLBACK_SEC_PER_SEGMENT)}s/段兜底`)
  }

  const seedSections: Partial<StoryboardSections> = {
    '00_creative': { brief },
    '02_visual': { tokens: [{ k: 'theme', v: recipe.theme }] },
    '04_storyboard': { scenes },
    '07_assets': assets,
    '08_constraints': constraints,
  }

  // ── 结构自检：先归一化再逐项验，不通过不返回 ──
  const doc = normalizeStoryboard({ projectId: 'seed', sections: seedSections })
  if (doc === undefined) {
    throwError('CS-USER-ERR', { message: '配方 seed 结构归一化失败（sections 不是对象）' })
  }
  const normalized = doc.sections
  const failures: string[] = []
  if (normalized['02_visual'].tokens.length === 0) failures.push('§02 tokens 为空')
  if (normalized['04_storyboard'].scenes.length === 0) failures.push('§04 没有分镜')
  for (const scene of normalized['04_storyboard'].scenes) {
    if (scene.shots.length === 0) failures.push(`分镜 ${scene.id} 没有 shot`)
    for (const shot of scene.shots) {
      if (shot.visual.trim() === '' || shot.camera.trim() === '' || shot.audio.trim() === '') {
        failures.push(`shot ${shot.id} 的 visual/camera/audio 有空值`)
      }
      if (shot.frames !== Math.round(shot.duration * fps)) {
        failures.push(`shot ${shot.id} 的 frames(${shot.frames}) ≠ round(duration×fps)=${String(Math.round(shot.duration * fps))}`)
      }
    }
  }
  const semanticIds = collectSemanticIds(normalized)
  if (new Set(semanticIds).size !== semanticIds.length) {
    failures.push(`语义 ID 重复：${semanticIds.join(', ')}`)
  }
  if (failures.length > 0) {
    throwError('CS-USER-ERR', { message: `配方 seed 结构自检未过：${failures.join('；')}` })
  }

  // ── specSeed（§3.4.1）：weight 只写其一、units/carry 留空、autoStages 不开 ──
  const specSeed: Partial<ContentSpec> = {
    meta: {
      title,
      theme: recipe.theme,
      ...(givenTotal === undefined ? {} : { durationSec: givenTotal }),
    },
    sections: recipe.segments.map((segment) => ({
      id: segment.id,
      card: segment.card,
      copy: segment.copy,
      weight: segment.weight,
      label: segment.label,
    })),
  }

  return {
    sections: {
      '00_creative': normalized['00_creative'],
      '02_visual': normalized['02_visual'],
      '04_storyboard': normalized['04_storyboard'],
      '07_assets': normalized['07_assets'],
      '08_constraints': normalized['08_constraints'],
    },
    specSeed,
    filledSections: [...SEED_FILLED],
  }
}
