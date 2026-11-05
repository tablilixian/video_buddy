/**
 * 生成单元规划（CV-445 S3，rea-video A4 吸收）—— 算法移植自 rea-video `production.py`
 * （Apache-2.0，JuneYaooo 版权；纯算法零视觉依赖，场景相似度用 `shot-detect.ts` 的
 * HSV 直方图，不 vendor 代码）。
 *
 * ## 解决什么
 *
 * 我们逐镜生成 = 每镜一次调用；`video_composite` 已有 ≤9 参考图 + ≤3 参考视频能力，
 * **缺的正是规划层**。本模块把拆解表（含 A1 分册「制作方式」列）变成**生成单元计划**：
 *
 *   - 同场景 + 硬切相连的 AI 镜头合并为**一次连续生成**（H3 单段 ≤15s），剪辑时在
 *     硬切处切开 —— README 案例口径：8 镜 → 3 次调用；
 *   - 中间插入的代码/录屏/静图镜头**不打断 run**（生成连着出、剪辑时插回，「口播+UI」
 *     类片子的常规做法）；
 *   - 动态规划求**最少单元数**：代价 = 1 + 0.4×(超 prefer 8s) + 0.2×(低于最短 4s)；
 *   - 单镜超上限 → 在动作停顿处切段，后段用前段尾帧作首帧（S02 → `shotTransition:'chain'`
 *     + `extract_last_frame`）；相邻单元同场景且硬切相连 → S05 尾帧衔接。
 *
 * ## 与 rea-video 的刻意差异（上限参数换成我们的真实规格，能力对照表 §4）
 *
 *   - 标签语法：`@图片1` → **`<Picture N>`**（`prompt-refs.ts` 口径）；`@视频1` → `<Video N>`；
 *   - 上限：参考图 1–9 / 参考视频 ≤3 / 参考音频 ≤3 / **合计 ≤12 文件**；
 *   - **不做 multi_shot primitive 假设**：我们的「一次多镜头」= 一次调用生成连续片段
 *     覆盖多镜（单元时长 = 各镜时长和 ≤15s），不是模型原生的分段输出；
 *   - **只出计划，不自动执行**（决策点 D4，对齐「付费生成先 dry-run」纪律）。
 */
import { histogramBhattacharyya, rgbHsvHistogram, SHOT_THUMB_H, SHOT_THUMB_W } from './shot-detect.js'

/** 可生成通道的制作方式（A1 分册 8 类口径的生成侧）。 */
export const GEN_METHODS: readonly string[] = ['ai-video', 'cg-3d', '2d-animation']
/** 插入画面：单独做、剪辑时插回，不打断生成 run。 */
export const INSERT_METHODS: readonly string[] = ['code-render', 'screen-capture', 'still-motion', 'static-hold']

/** 拆解表一镜（本工具的输入形态；与 viral-remake 拆解表列同构）。 */
export interface PlanShotInput {
  /** 镜序（1 起）。 */
  index: number
  startSec: number
  endSec: number
  /** 制作方式（A1 分册：ai-video / live-action / code-render / screen-capture / still-motion / static-hold / avatar / other）。 */
  productionMethod: string
  /** 画面描述（生成提示词的原料；逐镜一句「主体+动作+运镜」）。 */
  description: string
  /** 入转场：与前一镜的连接方式（首镜可省）。 */
  transitionIn?: 'cut' | 'dissolve' | 'fade' | 'other'
  /** 可选英文描述（拼英文提示词；缺省只出中文）。 */
  promptEn?: string
}

/** 用户自备参考素材（跨单元复用：产品图 / 人物图等）。 */
export interface PlanReferenceAsset {
  kind: 'image' | 'video' | 'audio'
  /** 素材说明（进提示词引用行，如「产品实拍图（正面 + 带 Logo 面）」）。 */
  what: string
}

/** 规划上限（对齐 video_composite 真实规格）。 */
export interface PlanLimits {
  /** 单次生成时长上限（秒）：`clampDuration` 的 maxVideoSeconds，出厂 15。 */
  maxUnitSec: number
  /** 单元最短生成时长（秒）：太短的单镜单独生成不稳定，补到这个长度再剪。 */
  minUnitSec: number
  /** 单元内连续硬切的偏好上限（秒），超出加代价（S06）。 */
  preferSec: number
  maxPictures: number
  maxVideos: number
  maxAudios: number
  maxTotalFiles: number
  /** 同场景判定阈值（HSV Bhattacharyya 距离 ≤ 此值算同场景）。 */
  sameSceneDistance: number
}

export const DEFAULT_PLAN_LIMITS: PlanLimits = {
  maxUnitSec: 15,
  minUnitSec: 4,
  preferSec: 8,
  maxPictures: 9,
  maxVideos: 3,
  maxAudios: 3,
  maxTotalFiles: 12,
  sameSceneDistance: 0.5,
}

/** 一个生成单元（一次 video_composite/video_generate 调用的完整参数卡）。 */
export interface GenerationUnit {
  id: string
  /** 涵盖的镜序。 */
  shots: number[]
  /** 成片时间区间（插入画面造成的断口保留原样 —— 生成时连着出，剪辑时插回）。 */
  ranges: Array<[number, number]>
  startSec: number
  endSec: number
  /** 生成时长（各镜时长和；插入画面不占生成时长）。 */
  durationSec: number
  mode: 'multi_shot' | 'single' | 'split'
  /** 调用次数（split > 1）。 */
  calls: number
  refs: Array<{ tag: string; what: string }>
  /** 可直接贴进 video_composite.prompt 的提示词。 */
  prompt: string
  promptEn: string
  /** 与上一单元的衔接说明（S05 尾帧衔接 / 首帧参照）。 */
  continuity?: string
  notes: string[]
}

export interface GenerationPlan {
  units: GenerationUnit[]
  /** 总调用次数。 */
  calls: number
  /** 进单元的镜头数。 */
  unitShotCount: number
  /** 输入的 AI 镜头数（= 逐镜生成的调用数基线）。 */
  genShotCount: number
  /** 逐镜调用数 − 规划调用数（≥0 才有省；负数如实报）。 */
  savedCalls: number
  limits: PlanLimits
  /** 规格/输入问题警告（不阻断，agent 应转述给用户）。 */
  warnings: string[]
  /** 不可生成通道的镜头（按制作方式分组；不含插入类）。 */
  nonGen: Array<{ method: string; shots: number[]; hint: string }>
  /** 插入画面镜头（单独做、剪辑时插回，不打断 run）。 */
  inserts: Array<{ method: string; shots: number[]; hint: string }>
  /** 一行人话总结。 */
  summary: string
}

// ───────────────── run 分组（production.py `_runs`） ─────────────────

/**
 * 同场景 + 硬切相连的 AI 镜头归一个 run；中间插入的代码/录屏/静图**不打断**；
 * 实拍/数字人/未知制作方式打断（无对应生成通道）。
 * `isSameScene(a, b)` 由调用方注入（帧直方图距离或拆解表场景标注）。
 */
export function groupGenerationRuns(
  shots: readonly PlanShotInput[],
  isSameScene: (a: PlanShotInput, b: PlanShotInput) => boolean,
): PlanShotInput[][] {
  const runs: PlanShotInput[][] = []
  let current: PlanShotInput[] = []
  let gap = false
  for (const shot of shots) {
    const method = shot.productionMethod
    if (!GEN_METHODS.includes(method)) {
      if (INSERT_METHODS.includes(method) && current.length > 0) {
        gap = true
        continue
      }
      if (current.length > 0) runs.push(current)
      current = []
      gap = false
      continue
    }
    const last = current[current.length - 1]
    const joinable = last !== undefined && isSameScene(last, shot)
      && (gap || shot.transitionIn === 'cut' || shot.transitionIn === undefined)
    if (current.length > 0 && !joinable) {
      runs.push(current)
      current = []
    }
    current.push(shot)
    gap = false
  }
  if (current.length > 0) runs.push(current)
  return runs
}

// ───────────────── DP 切分（production.py `_split_run`） ─────────────────

/**
 * 动态规划求最少单元数：代价 = 1 + 0.4×(len(seg)>1 且 dur>prefer) + 0.2×(dur<unitMin)。
 * 多镜段时长和超过 maxUnitSec 的组合不参与（break 剪枝，对齐 production.py）。
 */
export function splitRunByDuration(
  run: readonly PlanShotInput[],
  limits: PlanLimits,
): PlanShotInput[][] {
  const n = run.length
  if (n === 0) return []
  const durations = run.map((r) => r.endSec - r.startSec)
  const best = [0, ...Array<number>(n).fill(Number.POSITIVE_INFINITY)]
  const prev = Array<number>(n + 1).fill(0)
  for (let j = 1; j <= n; j += 1) {
    for (let i = j - 1; i >= 0; i -= 1) {
      let dur = 0
      for (let k = i; k < j; k += 1) dur += durations[k] ?? 0
      if (j - i > 1 && dur > limits.maxUnitSec) break
      const cost = 1.0
        + (j - i > 1 && dur > limits.preferSec ? 0.4 : 0)
        + (dur < limits.minUnitSec ? 0.2 : 0)
      if ((best[i] ?? Number.POSITIVE_INFINITY) + cost < (best[j] ?? Number.POSITIVE_INFINITY)) {
        best[j] = (best[i] ?? 0) + cost
        prev[j] = i
      }
    }
  }
  const out: PlanShotInput[][] = []
  let j = n
  while (j > 0) {
    out.unshift(run.slice(prev[j] ?? 0, j))
    j = prev[j] ?? 0
  }
  return out
}

// ───────────────── 单元拼装（production.py `_unit`） ─────────────────

export interface AssembleOptions {
  limits: PlanLimits
  /** 全片统一风格句（每次调用都带，分开生成的单元看起来仍是一条片）。 */
  styleLine?: string
  refs: Array<{ tag: string; what: string }>
  prevUnit?: GenerationUnit
  /** 本单元首镜与上一单元末镜是否同场景（决定 S05 衔接）。 */
  sameScenePrev: boolean
}

export function assembleUnit(seg: readonly PlanShotInput[], k: number, options: AssembleOptions): GenerationUnit {
  const { limits } = options
  const t0 = seg[0]?.startSec ?? 0
  const t1 = seg[seg.length - 1]?.endSec ?? 0
  let durationSec = 0
  const ranges: Array<[number, number]> = []
  for (const shot of seg) {
    if (shot === undefined) continue
    const dur = shot.endSec - shot.startSec
    const lastRange = ranges[ranges.length - 1]
    if (lastRange !== undefined && Math.abs(lastRange[1] - shot.startSec) < 1e-3) {
      lastRange[1] = shot.endSec
    } else {
      ranges.push([shot.startSec, shot.endSec])
    }
    durationSec += dur
  }
  durationSec = Math.round(durationSec * 1000) / 1000
  const contiguous = ranges.length === 1
  const notes: string[] = []

  // 单镜超上限 → 切段（S02：动作停顿处切，后段用前段尾帧作首帧）
  let calls = 1
  if (seg.length === 1 && durationSec > limits.maxUnitSec) {
    calls = Math.ceil(durationSec / limits.maxUnitSec)
    notes.push(`单镜 ${durationSec.toFixed(1)}s 超过单次上限 ${limits.maxUnitSec}s：在动作停顿处切成 ${calls} 段，后一段用前一段尾帧作首帧（video_composite shotTransition:'chain' + extract_last_frame）`)
  }
  const mode: GenerationUnit['mode'] = seg.length > 1 ? 'multi_shot' : (calls > 1 ? 'split' : 'single')

  // S05 尾帧衔接：上一单元末镜与本单元首镜同场景、硬切相连、时间无缝
  const prev = options.prevUnit
  let continuity: string | undefined
  const firstShot = seg[0]
  if (prev !== undefined && options.sameScenePrev
    && firstShot?.transitionIn === 'cut'
    && Math.abs((prev.ranges[prev.ranges.length - 1]?.[1] ?? -1) - t0) < 1e-3) {
    continuity = `首帧用 ${prev.id} 的尾帧衔接动作（video_composite shotTransition:'chain'，首图用 extract_last_frame 取 ${prev.id} 末帧）`
  }

  // 提示词：风格句 + 参考行 + 逐镜行
  const head: string[] = []
  if (options.styleLine !== undefined && options.styleLine !== '') head.push(options.styleLine)
  const pictureRefs = options.refs.filter((r) => r.tag.startsWith('<Picture'))
  const videoRefs = options.refs.filter((r) => r.tag.startsWith('<Video'))
  for (const ref of pictureRefs) head.push(`${ref.what}以 ${ref.tag} 为准，外观细节保持一致`)
  if (videoRefs.length > 0) head.push(`参考 ${videoRefs.map((r) => r.tag).join('、')} 的动作、运镜和剪辑节奏`)
  if (seg.length > 1) head.push('镜头之间硬切')
  if (!contiguous) notes.push('这几镜在成片里被插入画面隔开：生成时连着出，剪辑时再把插入画面放回原位')

  const lines: string[] = []
  const linesEn: string[] = []
  let acc = 0
  const missing: number[] = []
  for (let i = 0; i < seg.length; i += 1) {
    const shot = seg[i]
    if (shot === undefined) continue
    const dur = shot.endSec - shot.startSec
    const a = acc
    const z = acc + dur
    acc = z
    const text = shot.description.trim() !== '' ? shot.description : (missing.push(shot.index), `（第 ${shot.index} 镜缺描述：补 description 后重跑）`)
    lines.push(seg.length > 1 ? `镜头${i + 1}（${a.toFixed(1)}–${z.toFixed(1)}s）：${text}` : text)
    if (shot.promptEn !== undefined && shot.promptEn.trim() !== '') {
      linesEn.push(seg.length > 1 ? `Shot ${i + 1} (${a.toFixed(1)}-${z.toFixed(1)}s): ${shot.promptEn}` : shot.promptEn)
    }
  }
  if (missing.length > 0) notes.push(`镜头 ${missing.join('、')} 缺 description —— 提示词不完整，先补再生成`)

  // 太短的单镜：补到 minUnitSec 再剪
  const generateS = seg.length === 1 && durationSec < limits.minUnitSec ? limits.minUnitSec : durationSec
  if (generateS > durationSec + 0.01) {
    notes.push(`生成 ${generateS.toFixed(0)}s 后剪到 ${durationSec.toFixed(1)}s（太短的镜头单独生成不稳定）`)
  }

  return {
    id: `G${k}`,
    shots: seg.map((s) => s.index),
    ranges,
    startSec: Math.round(t0 * 1000) / 1000,
    endSec: Math.round(t1 * 1000) / 1000,
    durationSec,
    mode,
    calls,
    refs: options.refs,
    prompt: `${head.length > 0 ? `${head.join('。')}。\n` : ''}${lines.join('\n')}`,
    promptEn: linesEn.length === seg.length && linesEn.length > 0 ? linesEn.join('\n') : '',
    ...(continuity !== undefined ? { continuity } : {}),
    notes,
  }
}

// ───────────────── 汇总入口（纯） ─────────────────

export interface PlanInputOptions {
  limits?: Partial<PlanLimits>
  styleLine?: string
  referenceAssets?: readonly PlanReferenceAsset[]
  /** 场景相似度函数（缺省 = 只按「硬切相连」合并不看画面 —— 无帧数据时的降级）。 */
  isSameScene?: (a: PlanShotInput, b: PlanShotInput) => boolean
}

/** 不可生成通道的镜头去向提示（实拍/数字人/未知 —— 打断 run 的那批）。 */
const NON_GEN_HINTS: Record<string, string> = {
  'live-action': '实拍段：给拍摄方案（场景/机位/布光），或用 video_generate 以参考图近似',
  'avatar': '数字人段：本批无数字人通道 —— TTS + 数字人驱动单独处理',
  'other': '制作方式未知：先补「制作方式」列（production-method 分册）再规划',
}

/** 插入画面的单独做法提示（不打断 run；剪辑时插回原位）。 */
const INSERT_HINTS: Record<string, string> = {
  'code-render': '代码/模板渲染：CompositionManifest 轨道重建（文字与版式 100% 可控，我们的最强项）',
  'screen-capture': '录屏/截图段：user_assets 清单让用户自录真实界面',
  'still-motion': '静图推拉：本地 ffmpeg 零成本（一张图 + 测得的 zoom/pan 参数）',
  'static-hold': '静帧：一张图定格',
}

/**
 * 拆解表 → 生成单元计划（纯函数；场景相似度由 `isSameScene` 注入或降级）。
 * 输入shots应已按时间排序（拆解表口径）。
 */
export function planGenerationUnits(
  shots: readonly PlanShotInput[],
  options: PlanInputOptions = {},
): GenerationPlan {
  const limits: PlanLimits = { ...DEFAULT_PLAN_LIMITS, ...(options.limits ?? {}) }
  const warnings: string[] = []

  // 参考素材 → <Picture N> / <Video N> / <Audio N>，超限裁剪并告警
  const refs: Array<{ tag: string; what: string }> = []
  let pic = 0
  let vid = 0
  let aud = 0
  let total = 0
  for (const asset of options.referenceAssets ?? []) {
    if (total >= limits.maxTotalFiles) {
      warnings.push(`参考素材超过合计上限 ${limits.maxTotalFiles} 文件（video_composite 预检会拒），「${asset.what}」未纳入 —— 挑最重要的 ${limits.maxTotalFiles} 个`)
      break
    }
    if (asset.kind === 'image') {
      if (pic >= limits.maxPictures) {
        warnings.push(`参考图超过上限 ${limits.maxPictures} 张，「${asset.what}」未纳入`)
        continue
      }
      pic += 1
      total += 1
      refs.push({ tag: `<Picture ${pic}>`, what: asset.what })
    } else if (asset.kind === 'video') {
      if (vid >= limits.maxVideos) {
        warnings.push(`参考视频超过上限 ${limits.maxVideos} 段，「${asset.what}」未纳入`)
        continue
      }
      vid += 1
      total += 1
      refs.push({ tag: `<Video ${vid}>`, what: asset.what })
    } else {
      if (aud >= limits.maxAudios) {
        warnings.push(`参考音频超过上限 ${limits.maxAudios} 段，「${asset.what}」未纳入`)
        continue
      }
      aud += 1
      total += 1
      refs.push({ tag: `<Audio ${aud}>`, what: asset.what })
    }
  }

  const isSameScene = options.isSameScene ?? (() => true) // 降级：只按硬切相连合并
  const shotByIndex = new Map(shots.map((s) => [s.index, s]))
  const genShotCount = shots.filter((s) => GEN_METHODS.includes(s.productionMethod)).length
  const units: GenerationUnit[] = []
  for (const run of groupGenerationRuns(shots, isSameScene)) {
    for (const seg of splitRunByDuration(run, limits)) {
      const first = seg[0]
      if (first === undefined) continue
      const prev = units[units.length - 1]
      let sameScenePrev = false
      if (prev !== undefined && prev.shots.length > 0) {
        const prevLast = shotByIndex.get(prev.shots[prev.shots.length - 1] ?? -1)
        sameScenePrev = prevLast !== undefined && isSameScene(prevLast, first)
      }
      units.push(assembleUnit(seg, units.length + 1, {
        limits,
        ...(options.styleLine !== undefined ? { styleLine: options.styleLine } : {}),
        refs,
        ...(prev !== undefined ? { prevUnit: prev } : {}),
        sameScenePrev,
      }))
    }
  }
  // 重编 id（ranges 排序后仍按时间序）
  units.sort((a, b) => a.startSec - b.startSec)
  units.forEach((u, i) => { u.id = `G${i + 1}` })

  const nonGenMap = new Map<string, number[]>()
  const insertMap = new Map<string, number[]>()
  for (const shot of shots) {
    if (GEN_METHODS.includes(shot.productionMethod)) continue
    const target = INSERT_METHODS.includes(shot.productionMethod) ? insertMap : nonGenMap
    const list = target.get(shot.productionMethod) ?? []
    list.push(shot.index)
    target.set(shot.productionMethod, list)
  }
  const toGroups = (map: Map<string, number[]>, hints: Record<string, string>): Array<{ method: string; shots: number[]; hint: string }> =>
    [...map.entries()].map(([method, shotList]) => ({
      method,
      shots: shotList,
      hint: hints[method] ?? NON_GEN_HINTS['other'] ?? '无对应通道，人工处理',
    }))
  const nonGen = toGroups(nonGenMap, NON_GEN_HINTS)
  const inserts = toGroups(insertMap, INSERT_HINTS)

  const calls = units.reduce((sum, u) => sum + u.calls, 0)
  const unitShotCount = units.reduce((sum, u) => sum + u.shots.length, 0)
  const bits: string[] = []
  if (units.length > 0) {
    bits.push(`AI 镜头 ${genShotCount} 镜 → ${units.length} 个生成单元、${calls} 次调用（逐镜生成要 ${genShotCount} 次，省 ${Math.max(0, genShotCount - calls)} 次）`)
  }
  for (const item of nonGen) {
    bits.push(`${item.method} ${item.shots.length} 镜 → ${item.hint}`)
  }
  for (const item of inserts) {
    bits.push(`插入画面 ${item.method} ${item.shots.length} 镜 → ${item.hint}`)
  }
  if (units.length === 0 && nonGen.length === 0 && inserts.length === 0) bits.push('没有可规划的镜头')

  return {
    units,
    calls,
    unitShotCount,
    genShotCount,
    savedCalls: genShotCount - calls,
    limits,
    warnings,
    nonGen,
    inserts,
    summary: bits.join('；'),
  }
}

// ───────────────── 场景相似度（IO 侧的纯比较函数） ─────────────────

/** 一镜的首/尾帧 HSV 直方图签名（IO 层抽帧后构造）。 */
export interface SceneSignature {
  hists: Float64Array[]
}

/** 从 rgb24 缩略图构造签名（`extractShotFrameThumb` 的配套纯函数）。 */
export function signatureFromRgb(raw: Uint8Array): SceneSignature {
  return { hists: [rgbHsvHistogram(raw, 0, SHOT_THUMB_W * SHOT_THUMB_H)] }
}

/**
 * 两镜场景距离 = 任意首/尾帧组合的最小 Bhattacharyya 距离（0 同景 → 1 无关，
 * 对齐 production.py `scene_distance`）。
 */
export function sceneDistance(a: SceneSignature, b: SceneSignature): number {
  let best = 1
  for (const ha of a.hists) {
    for (const hb of b.hists) {
      const d = histogramBhattacharyya(ha, hb)
      if (d < best) best = d
    }
  }
  return best
}

/** 缩略图字节规格（IO 层抽帧用，与 shot-detect 同尺寸）。 */
export const SHOT_FRAME_BYTES = SHOT_THUMB_W * SHOT_THUMB_H * 3

// ───────────────── IO：单帧缩略图 + 场景签名测量 ─────────────────

import { spawn } from 'node:child_process'
import { resolveFfmpegPath, FFMPEG_TIMEOUT_MS } from './ffmpeg-run.js'

/**
 * 抽某时刻的单帧缩略图（rgb24，96×54）—— 场景签名原料。
 * 场景相似度刻意用「首帧 + 尾帧」两帧（production.py 同口径），每镜 2 次 ffmpeg。
 */
export async function extractShotFrameThumb(
  videoPath: string,
  tSec: number,
  ffmpegPath?: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const ffmpeg = resolveFfmpegPath(ffmpegPath)
  return await new Promise<Uint8Array>((resolvePromise, rejectPromise) => {
    const child = spawn(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-ss', tSec.toFixed(3),
      '-i', videoPath,
      '-frames:v', '1',
      '-vf', `scale=${SHOT_THUMB_W}:${SHOT_THUMB_H}`,
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    let lastError = ''
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () => {
      child.kill('SIGKILL')
      finish(() => rejectPromise(signal?.reason ?? new DOMException('aborted', 'AbortError')))
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(() => rejectPromise(new Error(`抽帧超时（${Math.round(FFMPEG_TIMEOUT_MS / 1000)}s）`)))
    }, FFMPEG_TIMEOUT_MS)
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total <= SHOT_FRAME_BYTES * 2) chunks.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => { lastError += String(chunk).slice(0, 4000) })
    child.on('error', (cause) => {
      finish(() => rejectPromise(new Error(`ffmpeg 启动失败: ${cause instanceof Error ? cause.message : String(cause)}`)))
    })
    child.on('close', (code) => {
      finish(() => {
        const raw = Buffer.concat(chunks)
        if (raw.length < SHOT_FRAME_BYTES) {
          rejectPromise(new Error(`第 ${tSec.toFixed(2)}s 抽帧失败（${raw.length}/${SHOT_FRAME_BYTES} 字节，exit ${code}）: ${lastError.trim() || '无 stderr'}`))
          return
        }
        resolvePromise(new Uint8Array(raw.subarray(0, SHOT_FRAME_BYTES)))
      })
    })
  })
}

/** 场景相似度测量的镜头数上限（超过降级为「不看画面只看硬切」，防单次调用抽几百帧）。 */
export const MAX_SCENE_SIGNAME_SHOTS = 60

/**
 * 批量测一组镜头的首/尾帧场景签名（IO）。失败的单镜记 `null`（该镜与谁都不同景，
 * 只能靠硬切相连合并）。返回 Map：镜序 → 签名（该镜首帧 + 尾帧两个直方图）。
 */
export async function measureSceneSignatures(
  videoPath: string,
  shots: readonly PlanShotInput[],
  ffmpegPath?: string,
  signal?: AbortSignal,
): Promise<Map<number, SceneSignature>> {
  const out = new Map<number, SceneSignature>()
  for (const shot of shots) {
    if (out.size >= MAX_SCENE_SIGNAME_SHOTS) break
    try {
      const first = signatureFromRgb(await extractShotFrameThumb(videoPath, shot.startSec, ffmpegPath, signal))
      const lastRaw = await extractShotFrameThumb(videoPath, Math.max(shot.startSec, shot.endSec - 0.05), ffmpegPath, signal)
      first.hists.push(rgbHsvHistogram(lastRaw, 0, SHOT_THUMB_W * SHOT_THUMB_H))
      out.set(shot.index, first)
    } catch {
      // 单镜抽帧失败：不进 Map（同场景判定对它恒 false）
    }
  }
  return out
}

// ───────────────── Markdown 渲染（纯） ─────────────────

const MODE_ZH: Record<GenerationUnit['mode'], string> = {
  multi_shot: '一次连续生成（剪辑时按硬切切开）',
  single: '单镜',
  split: '超长切段',
}

/** 计划 → Markdown 人话报告（工具返回文本；单元提示词在代码块里可直接复制）。 */
export function renderPlanMarkdown(plan: GenerationPlan): string {
  const L: string[] = []
  L.push(`📋 **${plan.summary}**`)
  if (plan.warnings.length > 0) {
    L.push('')
    for (const warning of plan.warnings) L.push(`⚠️ ${warning}`)
  }
  if (plan.units.length > 0) {
    L.push('')
    L.push('| 单元 | 镜头 | 成片时间 | 生成时长 | 方式 | 衔接 |')
    L.push('|---|---|---|---|---|---|')
    for (const unit of plan.units) {
      const shotsLabel = unit.ranges.length > 1
        ? unit.shots.map((i) => `#${i}`).join('、')
        : `#${unit.shots[0] ?? '?'}${unit.shots.length > 1 ? `–#${unit.shots[unit.shots.length - 1] ?? '?'}` : ''}`
      const when = unit.ranges.map(([a, z]) => `${a.toFixed(1)}–${z.toFixed(1)}s`).join('、')
      L.push(`| ${unit.id} | ${shotsLabel} | ${when} | ${unit.durationSec.toFixed(1)}s | ${MODE_ZH[unit.mode]}${unit.calls > 1 ? `（${unit.calls} 次）` : ''} | ${unit.continuity ?? '—'} |`)
    }
    for (const unit of plan.units) {
      L.push('')
      L.push(`### ${unit.id} · 镜头 ${unit.shots.map((i) => `#${i}`).join('、')} · ${unit.durationSec.toFixed(1)}s`)
      if (unit.refs.length > 0) {
        L.push(`- 参考素材：${unit.refs.map((r) => `\`${r.tag}\` ${r.what}`).join('；')}`)
      }
      if (unit.continuity !== undefined) L.push(`- 衔接：${unit.continuity}`)
      for (const note of unit.notes) L.push(`- 注：${note}`)
      L.push(`- video_composite 参数：duration=${unit.durationSec.toFixed(1)}（上限 ${plan.limits.maxUnitSec}s）${unit.refs.length > 0 ? `、参考按 ${unit.refs.map((r) => r.tag).join('/')}` : ''}`)
      L.push('')
      L.push('```text')
      L.push(unit.prompt)
      L.push('```')
      if (unit.promptEn !== '') {
        L.push('', 'English prompt：', '', '```text', unit.promptEn, '```')
      }
    }
  }
  for (const item of plan.nonGen) {
    L.push('')
    L.push(`- ${item.method}（镜头 ${item.shots.map((i) => `#${i}`).join('、')}）→ ${item.hint}`)
  }
  for (const item of plan.inserts) {
    L.push(`- 插入画面 ${item.method}（镜头 ${item.shots.map((i) => `#${i}`).join('、')}）→ ${item.hint}（生成连着出，剪辑时插回原位）`)
  }
  L.push('')
  L.push('下一步：**逐单元人工确认**（提示词/参考素材/时长）后，逐单元调 video_composite 执行 —— 本工具只出计划不代执行（付费生成先确认）。')
  return L.join('\n')
}
