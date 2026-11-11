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

/**
 * 模板的**配乐位**（`audio.json` 的 `bgm` 字段）。
 *
 * 为什么模板**不自带**音频文件：一首 20s 的免版税曲子 3–5MB，随包发既让插件体积失控，
 * 也把授权审计拉进发布流程（`决策日志` D-35）。模板只声明「要什么样的曲子」，实际
 * 音频由模型现场生成（一次调用，30–60s），生成后经 `scaffold_manifest({ bgmUrl })`
 * 编进产物 —— 编译器仍然不读盘、不联网、不取当前时间。
 */
export interface TemplateBgm {
  /** 生成提示（喂给音乐生成工具；英文更稳：调性 / BPM / 乐器 / 情绪）。 */
  prompt: string
  /** 建议音量 0–1（写进 `audio.mix.bgmVolume`，与 `BGM_MIX_VOLUME` 同口径）。 */
  volume?: number
  /** 淡入（秒）。 */
  fadeInSeconds?: number
  /** 淡出（秒）。 */
  fadeOutSeconds?: number
  /** 期望时长（秒）；缺省 = 模板整片时长。短于成片会有静音尾巴。 */
  durationSeconds?: number
}

/**
 * `audio.json` 归一后的形状：音效事件表 + 可选的配乐位。
 *
 * 兼容 1（CV-463）的**裸数组**写法（那版只有音效表）：注册表读到数组就包成
 * `{ sfx }`，老模板不用改文件。
 */
export interface TemplateAudio {
  sfx?: ManifestSfx[]
  bgm?: TemplateBgm
}

/** 一份模板的完整内容（宿主读盘后的形状）。 */
export interface TemplateBundle {
  meta: TemplateMeta
  /** 骨架：**真实可渲**的 manifest，文本位写成 `{{slotId}}`。 */
  skeleton: unknown
  slots: SlotContract[]
  /** 装饰构件声明（编译期展开成普通 shape 轨）。 */
  furniture?: FurnitureSpec[]
  /** 音效事件表 + 配乐位（音效锚定到骨架轨 id，编译期注入 `audio.sfx[]`）。 */
  audio?: TemplateAudio
}

export interface CompileStats {
  trackCount: number
  /** 其中由构件展开出来的轨数（诊断「装饰层有没有生效」）。 */
  furnitureTracks: number
  sfxCount: number
  /** 本次产物是否真的接上了 BGM（模板有声部、且调用方给了 `bgmUrl`）。 */
  bgmApplied: boolean
}

/** 编译入口的可选参数。 */
export interface CompileOptions {
  /**
   * 已生成的配乐地址（模型先调音乐生成，再把产物 URL 传进来）。
   *
   * 为什么不在编译期自己生成：编译是**纯函数**（同 bundle + 同 values ⇒ 逐字节相同），
   * 一旦允许它联网取音频，确定性、可重放、单测三件事同时失效。
   */
  bgmUrl?: string
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
  /**
   * 模板声明了配乐位、本次却**没给 `bgmUrl`** ⇒ 原样回传这段声明。
   *
   * 调用方（`template-scaffold`）据此给模型一条可执行的下一步（「先生成 ~Ns 的曲子，
   * 再把 URL 传回来重编」）。编译本身不报错：无 BGM 是**合法的片子**，只是不完整。
   */
  bgmRequest?: TemplateBgm
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
  opts?: CompileOptions,
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
      stats: { trackCount: 0, furnitureTracks: 0, sfxCount: 0, bgmApplied: false },
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
      stats: { trackCount: 0, furnitureTracks: 0, sfxCount: 0, bgmApplied: false },
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
        stats: { trackCount: 0, furnitureTracks: 0, sfxCount: 0, bgmApplied: false },
      }
    }
  }
  tracks.push(...furnitureTracks)

  // ⑤ 音频：音效事件表注入（锚定到骨架轨，不写绝对帧 —— 组合时不会错位）+ 配乐位接入
  //
  // 配乐的三个来源（优先级从高到低）：调用方给的 `bgmUrl` > 骨架自带的 `audio.bgmUrl`
  // （模板若想内置曲子就走这条）> 没有。模板声明的 `bgm` 只提供**参数**（音量/淡入淡出），
  // 它自己不产生音频文件（D-35）。
  const audioDecl = bundle.audio
  const sfx = audioDecl?.sfx ?? []
  const declaredBgm = audioDecl?.bgm
  const bgmUrl = opts?.bgmUrl?.trim() ?? ''
  const bgmWarnings: string[] = []
  // 模板声明了配乐位却没写提示词 ⇒ 这条声明不可执行（模型无从生成），当没有处理并点名。
  // `typeof` 守卫不是多余：`TemplateBundle` 是公开 API（测试与脚本会手搭），外部 JSON 不能信。
  const usableBgm = declaredBgm !== undefined
    && typeof declaredBgm.prompt === 'string'
    && declaredBgm.prompt.trim() !== ''
    ? declaredBgm
    : undefined
  if (declaredBgm !== undefined && usableBgm === undefined) {
    bgmWarnings.push(`模板 ${meta.id} 的 audio.bgm 缺 prompt（生成提示），配乐位已忽略 —— 模板作者需补一句可执行的曲子描述`)
  }
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
  const audio = { ...((manifest.audio ?? {}) as ManifestAudio) }
  if (sfx.length > 0) {
    const existing = Array.isArray(audio.sfx) ? audio.sfx : []
    audio.sfx = [...existing, ...sfx]
  }
  if (bgmUrl !== '') {
    audio.bgmUrl = bgmUrl
    // 模板声明的是**建议值**：音量与淡入淡出只在接了 BGM 时才有意义，所以放在这里写，
    // 不放 ①② （否则没有 BGM 的产物会带一堆孤立的 mix 字段，读起来像「配乐丢了」）。
    if (usableBgm?.volume !== undefined) audio.mix = { ...(audio.mix ?? {}), bgmVolume: usableBgm.volume }
    if (usableBgm?.fadeInSeconds !== undefined) audio.fadeInSeconds = usableBgm.fadeInSeconds
    if (usableBgm?.fadeOutSeconds !== undefined) audio.fadeOutSeconds = usableBgm.fadeOutSeconds
  }
  if (Object.keys(audio).length > 0) manifest.audio = audio
  const bgmApplied = typeof audio.bgmUrl === 'string' && audio.bgmUrl !== ''

  // ⑥ 出厂自检：产物必须过校验（编译器对下游的承诺）
  const verdict = validateManifest(manifest as unknown as CompositionManifest)
  const warnings = [...bgmWarnings, ...verdict.warnings]
  const stats: CompileStats = {
    trackCount: tracks.length,
    furnitureTracks: furnitureTracks.length,
    sfxCount: sfx.length,
    bgmApplied,
  }
  if (!verdict.ok) {
    return { ok: false, manifest: null, issues, errors: verdict.errors, warnings, stats }
  }
  return {
    ok: true,
    manifest: manifest as unknown as CompositionManifest,
    issues,
    errors: [],
    warnings,
    stats,
    // 只在「声明了、但没接上」时回传：接上了就没有下一步要交代。
    ...(usableBgm !== undefined && !bgmApplied ? { bgmRequest: usableBgm } : {}),
  }
}

/** 模板的「装得下多少内容」（闸门判据 1 用；与槽位合同同一份事实）。 */
export function templateCapacity(slots: readonly SlotContract[]): number {
  return requiredCapacity(slots)
}
