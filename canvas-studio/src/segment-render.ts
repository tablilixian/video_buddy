/**
 * REQ-041 第 2 批（2026-11-25）· **单段 / 缺失段渲染编排**（P0-3 方案 c + N1 共用内核）。
 *
 * ## 解决什么
 *
 * ① **P0-3**：带 `audio`（旁白/BGM）的项目走整片路径（`shot-render.ts` 的
 *    `allowShots = manifest.audio === undefined`），整片路径既不分层渲、也不写
 *    shot-cache ⇒ `segment-publish.ts` 读不到缓存 ⇒ 新项目「一段都没有」。
 * ② **N1**：分镜卡上「引用这一屏 + 说一句意见 → 只换这一屏」需要「只渲这一段」的入口。
 *
 * 两件事的渲染内核是同一个：**取段表 → 只渲目标段 → 落 shot-cache → 发布副本**。
 * 差别只在「目标段怎么选」与「发布整批还是只发布这一段」。
 *
 * ## 渲在哪一侧
 *
 * 段渲染**本来就是客户端 CSR**：`renderManifestOnWeb` 支持 `frameRange`（闭区间，
 * `endFrame - 1`）与 `audioCodec: null`（R11-C3 无声段）。宿主只做「排计划 → 发布
 * 副本 → 合声」。所以本模块不碰渲染实现，只收一个注入的 `renderSegment`。
 *
 * ## 硬约束（真实事故，C5）
 *
 * 作业参数**必须**由 `shot-cache.ts` 的纯函数 `segmentRenderOptions` 产出
 * （`frameRange` 闭区间 + `muteAudio: true` + `segmentManifest` 剥 audio）。
 * C5 接线时入口内联拼对象、漏传这两个字段，真机渲出的是**整片且带声**，还进了缓存。
 * 因此调用方（`host-tools.ts` 的 `buildShotRenderDeps`）只允许透传这个纯函数的产物；
 * 本模块收到的 `renderSegment` 回调就是那份产物。守卫见
 * `tests/req041-batch2-segment-rerender.test.mjs`（漏传即红）。
 *
 * ## 纪律
 *
 * - 不抛：逐段失败只进 `failures`（D14 逐段口径 —— 成功的段照样给指针）；
 * - 不写画布：只写 `build/shot-cache/`、`deliver/segments/`、`assets/seg-<id>.mp4`
 *   （D15：段渲染不得改写节点尺寸、不得写 `canvas.json`）；
 * - 不碰整片：concat / saveMerged / probe 全不参与，成片字节零风险。
 */
import type { CompositionManifest, RenderQuality } from './remotion/manifest.js'
import type { RenderJobOutcome } from './remotion/render-job.js'
import type { ShotSegment } from './shot-slice.js'
import { manifestGlobalsFingerprint, shotCacheDir, storeSegment } from './shot-cache.js'
import {
  segmentAssetName,
  type SegmentArtifact,
  type SegmentPointer,
} from './segment-artifacts.js'
import { planSegmentTable, type SegmentTablePlan } from './segment-table.js'
import { cacheIndexByWindow, publishSegmentsFromCache } from './segment-publish.js'
import { publishSegmentArtifacts } from './shot-render.js'

/** 一段的渲染 × 发布所需的宿主能力（全部注入，测试可给假实现）。 */
export interface SegmentRenderIo {
  projectDir: string
  assetsDir: string
  quality: RenderQuality
  signal: AbortSignal
  /**
   * 渲一段。**唯一允许的构造方式**是 `runRenderJobWithStuckRetry({ projectId, signal,
   * ...segmentRenderOptions(manifest, segment, quality, realDurations) })` —— 见模块头硬约束。
   */
  renderSegment: (segment: ShotSegment) => Promise<RenderJobOutcome>
  /** `assetFile` → 磁盘绝对路径（宿主资产路由）。 */
  resolveAsset: (assetFile: string) => string
  realDurations?: Record<string, number>
  /** 时钟注入（耗时回执）；缺省 `Date.now`。 */
  now?: () => number
}

/** 段表规划（段 + 产物 id/帧窗）。切法唯一实现在 `segment-table.ts`。 */
export type { SegmentTablePlan }

/** 段产物在 shot-cache 里的匹配键（`startFrame:endFrame`，与 meta.json 同口径）。 */
export function segmentCacheKey(artifact: SegmentArtifact): string {
  return `${String(artifact.startFrame)}:${String(artifact.startFrame + artifact.frames)}`
}

/** 缓存里还没有的段（= 需要渲的段）。顺序与段序一致。 */
export function missingArtifacts(
  artifacts: readonly SegmentArtifact[],
  cacheDir: string,
): SegmentArtifact[] {
  const index = cacheIndexByWindow(cacheDir)
  return artifacts.filter((artifact) => !index.has(segmentCacheKey(artifact)))
}

/** 一次「渲 N 段」的产物（`failures` 非空不代表整体失败，见 D14）。 */
export interface RenderSegmentsResult {
  /** 真正渲成并落了缓存的段（与 `files` 同序、同长）。 */
  artifacts: SegmentArtifact[]
  files: string[]
  /** 逐段失败原因（进 note，不抛）。 */
  failures: string[]
  /** 段渲染告警（字体缺失 / 编码降级），去重。 */
  warnings: string[]
  elapsedMs: number
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * 渲指定段 → 写 shot-cache。
 *
 * 逐段 try/catch：一段失败不许拖垮其余段（D14「成功的给指针，失败的写进 note」）。
 * 缓存写失败不阻断（`storeSegment` 内部返回 null）—— 段产物已落 `assets/`，
 * 下次重渲一次即可。
 */
export async function renderSegmentArtifacts(input: SegmentRenderIo & {
  manifest: CompositionManifest
  plan: SegmentTablePlan
  targets: readonly SegmentArtifact[]
}): Promise<RenderSegmentsResult> {
  const now = input.now ?? ((): number => Date.now())
  const cacheDir = shotCacheDir(input.projectDir)
  const globals = manifestGlobalsFingerprint(input.manifest)
  const startedAt = now()
  const artifacts: SegmentArtifact[] = []
  const files: string[] = []
  const failures: string[] = []
  const warnings: string[] = []
  for (const artifact of input.targets) {
    const segment = input.plan.segments[artifact.index]
    if (segment === undefined) {
      failures.push(`${artifact.id}（段表里没有第 ${String(artifact.index)} 段）`)
      continue
    }
    let outcome: RenderJobOutcome
    try {
      outcome = await input.renderSegment(segment)
    } catch (cause) {
      failures.push(`${artifact.id}（${messageOf(cause)}）`)
      continue
    }
    let absPath: string
    try {
      absPath = input.resolveAsset(outcome.assetFile)
    } catch (cause) {
      failures.push(`${artifact.id}（产物路径不可解析：${messageOf(cause)}）`)
      continue
    }
    storeSegment(segment, input.quality, cacheDir, absPath, globals)
    for (const warning of outcome.warnings) {
      if (!warnings.includes(warning)) warnings.push(warning)
    }
    artifacts.push(artifact)
    files.push(absPath)
  }
  return { artifacts, files, failures, warnings, elapsedMs: Math.max(0, now() - startedAt) }
}

/** 段补渲结果（P0-3）。`rendered = 0` 表示缓存已齐或切不出段。 */
export interface FillMissingSegmentsResult {
  /** 本次真正渲的段数。 */
  rendered: number
  /** 已落地段的指针（D14：逐段，成功的都给）。 */
  pointers: SegmentPointer[]
  artifacts: SegmentArtifact[]
  note?: string
  /** 本次渲段墙钟（§十 5 的实测数据面；没渲段时为 0）。 */
  elapsedMs: number
}

/**
 * P0-3 方案 c：**整片路径渲完后补段**。
 *
 * 只渲缓存里没有的段（第一次整片渲 = 全渲；之后内容不变 = 零成本），渲完交给
 * `publishSegmentsFromCache` 统一发布 —— 发布只留一套实现（D11 质量档择优、
 * D14 逐段指针、两份副本），不给「补渲出来的段」另开一条发布口径。
 *
 * 不抛：任何失败都收进 `note`，成片已经在盘上，不该被段补渲陪葬。
 */
export async function fillMissingSegments(input: SegmentRenderIo & {
  manifest: CompositionManifest
  spec: unknown
}): Promise<FillMissingSegmentsResult> {
  const plan = planSegmentTable({ manifest: input.manifest, spec: input.spec })
  if (plan === null) {
    return { rendered: 0, pointers: [], artifacts: [], note: '切不出段（无可用边界），跳过段补渲', elapsedMs: 0 }
  }
  const missing = missingArtifacts(plan.artifacts, shotCacheDir(input.projectDir))
  if (missing.length === 0) {
    return { rendered: 0, pointers: [], artifacts: [], elapsedMs: 0 }
  }
  const rendered = await renderSegmentArtifacts({ ...input, plan, targets: missing })
  const published = publishSegmentsFromCache({
    projectDir: input.projectDir,
    assetsDir: input.assetsDir,
    manifest: input.manifest,
    spec: input.spec,
  })
  const notes: string[] = []
  if (rendered.failures.length > 0) notes.push(`段 ${rendered.failures.join('、')} 重渲失败`)
  if (published.note !== undefined) notes.push(published.note)
  return {
    rendered: rendered.artifacts.length,
    pointers: published.pointers,
    artifacts: published.artifacts,
    ...(notes.length === 0 ? {} : { note: notes.join('；') }),
    elapsedMs: rendered.elapsedMs,
  }
}

/** 单段重渲结果（N1）。 */
export interface RerenderSegmentResult {
  pointer: SegmentPointer
  /** 清单会指向的副本 URL（带声副本存在时是 `-voice`；由调用方 stat 决定）。 */
  assetFile: string
  renderedMs: number
  warnings: string[]
  note?: string
}

/**
 * N1：只重渲一段并发布。
 *
 * **只发布这一段**（不重发其余段）：其余段的 `assets/seg-*.mp4` mtime 一变，
 * 清单里的 `?v=` 就会跟着变，客户端会把「没改过的屏」也当新版重拉 —— 承诺是
 * 「只换这一屏」，那就只动这一屏的文件。
 *
 * 返回 `null` = 该段没渲成（`failures` 里给原因），调用方据此如实回报，不静默。
 */
export async function rerenderSegmentArtifact(input: SegmentRenderIo & {
  manifest: CompositionManifest
  plan: SegmentTablePlan
  artifact: SegmentArtifact
}): Promise<{ result: RerenderSegmentResult | null; failure?: string; renderedMs: number }> {
  const rendered = await renderSegmentArtifacts({ ...input, targets: [input.artifact] })
  if (rendered.artifacts.length === 0) {
    return { result: null, failure: rendered.failures.join('、') || '渲染未产出', renderedMs: rendered.elapsedMs }
  }
  const published = publishSegmentArtifacts({
    projectDir: input.projectDir,
    assetsDir: input.assetsDir,
    artifacts: rendered.artifacts,
    files: rendered.files,
    fps: input.manifest.meta.fps,
  })
  const pointer = published.pointers[0]
  if (pointer === undefined) {
    return {
      result: null,
      failure: published.note ?? '段副本未落地',
      renderedMs: rendered.elapsedMs,
    }
  }
  return {
    result: {
      pointer,
      assetFile: segmentAssetName(pointer.id),
      renderedMs: rendered.elapsedMs,
      warnings: rendered.warnings,
      ...(published.note === undefined ? {} : { note: published.note }),
    },
    renderedMs: rendered.elapsedMs,
  }
}
