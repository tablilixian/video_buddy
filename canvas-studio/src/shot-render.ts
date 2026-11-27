/**
 * RQ-038 R11-B2（2026-11-16）· **分镜渲染编排**（从 `host-tools.ts` 抽出）。
 *
 * ## 为什么抽出来
 *
 * ① 这 100 行是「可判定逻辑」却零测试（真机 P0 就发生在这里：`frameRange`/`muteAudio`
 *   漏传，每段按整片时长渲）。抽成模块并把宿主服务做成注入，测试才能用假渲染器
 *   驱动真实缓存/拼接/产物逻辑 —— 集成缺口只能被集成测试挡住，纯函数挡不住。
 * ② `host-tools.ts` 已顶到体积棘轮（注册值 + 余量 ≈ 15 行），B2 加的产物/抽帧/回执
 *   无处可放。
 *
 * ## B2 相对 R11 第一版补的三件事（真机会话 6f8ba13c 的产物级缺陷）
 *
 * - **段产物可见**：每段复制到 `deliver/segments/<id>.mp4`（可读 id、与 `card.json`
 *   `pointers.segments[]` 同源）。此前只在 `build/shot-cache/<hash>.mp4`，用户与
 *   后续流程都看不到「每段有一段视频」。
 * - **段级抽帧回灌 `outcome.frames[]`**：分镜路径此前恒传空数组，模型只能自己
 *   `ffmpeg` 抽 1080p PNG（会话里 6 步 / 8 次读图 / 3 次撞 2MB 上限重试）。现在
 *   每段取中点交给宿主抽一帧，走与整片路径**同一个** `frames[]` 通道。
 * - **报告与告警不再丢**：段渲染的 `warnings`（字体缺失等）此前被扔掉；`report`
 *   此前是 `undefined as unknown as RenderJobReport` 的 cast（自检行因此基本空）。
 *   现在按段产物真值（字节 / 时长 / 帧数 / 实测分辨率）构造诚实的最小报告。
 *
 * ## 失败语义
 *
 * 本模块**不吞异常**：调用方（`host-tools.ts`）用 try/catch 把任何失败降级成
 * 「回退整片渲染 + 回执说明」，分镜渲染永远只是优化，不能成为出片的前置条件。
 * 唯二例外是**辅助设施**：段级抽帧失败只记一行、段产物发布失败只记一行 ——
 * 成片已经渲好了，不能因为一张 PNG 或一次复制就陪葬（同 `deliverable.ts` 纪律）。
 */
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { CompositionManifest, RenderQuality } from './remotion/manifest.js'
import type { RenderJobOutcome, RenderJobReport, RenderSampleResult } from './remotion/render-job.js'
import type { ShotSegment } from './shot-slice.js'
import { boundariesFromSpec, resolveShotBoundaries } from './shot-slice.js'
import {
  allTierCacheHashes,
  clearStaleEntries,
  getDirtySegments,
  planShotRender,
  shotCacheDir,
  storeSegment,
} from './shot-cache.js'
import {
  SEGMENT_DELIVER_DIR,
  planSegmentArtifacts,
  segmentArtifactName,
  segmentAssetName,
  segmentPointers,
  segmentReceiptLine,
  type SegmentArtifact,
  type SegmentPointer,
} from './segment-artifacts.js'
import { throwError } from './error-system.js'
import {
  audioCompatibleWithShots,
  muxManifestAudio,
  type MuxManifestAudioInput,
  type MuxManifestAudioResult,
} from './manifest-audio-mux.js'
import type { TeardownSegment } from './teardown-verify.js'
import { verifyTeardown } from './teardown-verify.js'
import {
  TIMING_CHECK_SAMPLE_FPS,
  TIMING_CHECK_TOLERANCE_SEC,
  summarizeTimingCheck,
  timingCheckWarnings,
  type TimingCheckSummary,
} from './timing-segments.js'
import './errors/catalog.js'

/** 宿主服务注入（全部由 `host-tools.ts` 提供真实实现，测试提供假实现）。 */
export interface ShotRenderDeps {
  projectDir: string
  assetsDir: string
  quality: RenderQuality
  signal: AbortSignal
  /** 渲染一段（含 E2「渲染器卡死」重试包装 —— 那层留在调用方）。 */
  renderSegment: (segment: ShotSegment) => Promise<RenderJobOutcome>
  /** `assetFile` → 磁盘绝对路径（宿主资产路由）。 */
  resolveAsset: (assetFile: string) => string
  /** 拼接产物保存为资产。 */
  saveMerged: (bytes: Uint8Array, name: string) => Promise<{ url: string; assetFile: string }>
  /** 探测成片真值（时长 / 分辨率）。 */
  probeMedia: (absPath: string) => Promise<{ duration: number; width?: number; height?: number }>
  /** 拼接（ffmpeg concat -c copy）。 */
  concat: (args: { segmentFiles: readonly string[]; outputPath: string; signal: AbortSignal }) => Promise<unknown>
  /**
   * 段级抽帧：从段产物取一帧，落盘并回传可回读的 URL。
   * 返回 null = 抽帧不可用（缺 ffmpeg / 解码失败 / 未提供实现）—— 不影响出片。
   */
  sampleFrame?: (args: { segment: ShotSegment; file: string; artifact: SegmentArtifact }) => Promise<{ url: string } | null>
  /** spec.json 读取（缺省读 `<projectDir>/build/spec.json`；测试注入）。 */
  loadSpec?: () => unknown
  /** 是否发布段产物到 `deliver/segments`（缺省：非 draft 即发布）。 */
  publishSegments?: boolean
  /**
   * Q2 时序闸的拆解段（`render_composition` 的 `timingSegments` 入参）。
   * 给了 ≥2 段就跑回核 —— 分镜路径此前绕过 `commitRenderJob`，`report.timingCheck`
   * 永远缺席：用户传了拆解表、界面显示「已回核」，实际一次都没比。
   */
  timingSegments?: readonly TeardownSegment[]
  /** 时序回核实现（缺省 {@link verifyShotTiming}；测试注入假实现）。 */
  verifyTiming?: (args: { videoPath: string; segments: readonly TeardownSegment[] }) => Promise<TimingVerifyResult>
  /** 时钟注入（报告耗时与临时文件名；缺省 `Date.now`）。 */
  now?: () => number
  /**
   * 整轨混音实现（缺省 {@link muxManifestAudio}；测试注入假实现）。
   *
   * P0-2：段渲染恒静音 + concat `-c copy` ⇒ 合并片没有音轨。挂旁白的片子此前因此
   * 被整体挡在分镜之外（改一屏 = 整片重渲 68–150s）。现在拼接后在这里补一次
   * `manifest.audio` 整轨混音，画面零重编码，增量收益保留。
   */
  muxAudio?: (input: MuxManifestAudioInput) => Promise<MuxManifestAudioResult>
}

/** 一次分镜渲染的结果：`outcome = null` ⇒ 走了回退（回执里有原因）。 */
export interface ShotRenderResult {
  outcome: RenderJobOutcome | null
  receipt: string[]
  /** 段产物交付指针（未发布 / 回退 = 空数组）。 */
  segments: SegmentPointer[]
}

/** 读 `<projectDir>/build/spec.json`；缺失或解析失败返回 null（= 无 spec 边界）。 */
export function readProjectSpec(projectDir: string): unknown {
  try {
    const specPath = join(projectDir, 'build', 'spec.json')
    if (!existsSync(specPath)) return null
    return JSON.parse(readFileSync(specPath, 'utf8')) as unknown
  } catch {
    return null
  }
}

/** Q2 时序回核结论（进 `report.timingCheck` + warnings）。 */
export interface TimingVerifyResult {
  summary: TimingCheckSummary
  warnings: string[]
}

/**
 * 分镜路径的时序回核 —— 与整片路径**同一个算法、同一组常量**（`verifyTeardown` +
 * 4fps 采样 + ±0.45s 容差）。
 *
 * 为什么单独抽出来：整片路径在 `commitRenderJob` 里顺手做，而分镜路径合成 outcome
 * 时绕过了它 ⇒ 用户传了拆解表，`report.timingCheck` 永远缺席，浮点漂移没人报。
 * 抽成独立函数既让分镜路径能复用，也让测试可以注入假实现（真实实现要 ffmpeg）。
 */
export async function verifyShotTiming(args: {
  videoPath: string
  segments: readonly TeardownSegment[]
}): Promise<TimingVerifyResult> {
  const verified = await verifyTeardown({
    videoPath: args.videoPath,
    segments: args.segments,
    sampleFps: TIMING_CHECK_SAMPLE_FPS,
    toleranceSec: TIMING_CHECK_TOLERANCE_SEC,
  })
  const summary = summarizeTimingCheck(verified)
  return { summary, warnings: timingCheckWarnings(summary) }
}

/**
 * 段产物发布：`deliver/segments/<id>.mp4` + `assets/seg-<id>.mp4`（都覆盖写）。
 *
 * 每段都复制（含**复用段**）：复用段若只留在 hash 缓存目录，交付目录就会少一段 ——
 * 「用户看到的三段里有一段不存在」这种半成品比没有更误导。复制失败不抛，
 * 汇总成一行 note（成片不陪葬）。
 *
 * REQ-041 的第二份副本进 `assets/`：`deliver/` 在 assets 媒体路由之外，客户端只能
 * 通过 `GET /canvas-studio/assets/<pid>/<file>` 拿到带 Range 的媒体流。文件名确定性
 * （`seg-<id>.mp4`）而非随机资产 id，重渲覆盖同名 —— URL 与缓存键都稳定。两份
 * 中任一份失败都算该段未完整落地 ⇒ 该段不给指针（REQ-041 D14：**逐段**，其它段照给），
 * 失败逐段点名进 note。
 */
export function publishSegmentArtifacts(input: {
  projectDir: string
  assetsDir: string
  artifacts: readonly SegmentArtifact[]
  files: readonly string[]
  fps: number
}): { pointers: SegmentPointer[]; note?: string } {
  const dir = join(input.projectDir, SEGMENT_DELIVER_DIR)
  const failures: string[] = []
  const published: SegmentArtifact[] = []
  try {
    mkdirSync(dir, { recursive: true })
    mkdirSync(input.assetsDir, { recursive: true })
  } catch (cause) {
    return { pointers: [], note: `建目录失败：${cause instanceof Error ? cause.message : String(cause)}` }
  }
  input.artifacts.forEach((artifact, i) => {
    const source = input.files[i]
    if (source === undefined) {
      failures.push(`${artifact.id}（无源文件）`)
      return
    }
    try {
      copyFileSync(source, join(dir, segmentArtifactName(artifact.id)))
      copyFileSync(source, join(input.assetsDir, segmentAssetName(artifact.id)))
      published.push(artifact)
    } catch (cause) {
      failures.push(`${artifact.id}（${cause instanceof Error ? cause.message : String(cause)}）`)
    }
  })
  const note = failures.length > 0 ? `段 ${failures.join('、')} 复制失败` : undefined
  return {
    // REQ-041 D14：**逐段** —— 落地几段就给几段指针，失败的已在 note 里点名。
    // 旧口径「任一段失败 ⇒ 全批不给」与差异表不符：文件已复制进 assets/，卡上
    // 明明能播、账上说没发。「半套指针更误导」的顾虑用 note 逐段点名解决，
    // 而不是把成功的段一起作废。
    pointers: segmentPointers(published, input.fps),
    ...(note === undefined ? {} : { note }),
  }
}

/** 边界来源的中文口径（模型靠这句判断「段窗是否可信」——必须如实区分）。 */
function boundaryLabelOf(manifest: CompositionManifest, specBoundaries: number[] | null): string {
  const source = resolveShotBoundaries(manifest, specBoundaries).source
  if (source === 'segments') return '段表'
  if (source === 'spec') return 'spec'
  return source === 'transition' ? 'transition 末端' : '单段回退'
}

/** 报告耗时口径：分镜路径没有单次渲染的工单史，用**本次调用墙钟**并标明字段含义。 */
function shotReport(input: {
  quality: RenderQuality
  manifest: CompositionManifest
  frames: number
  totalMs: number
  bytes: number
  durationSec: number
  sampledFrames: number
  width?: number
  height?: number
  timingCheck?: TimingCheckSummary
}): RenderJobReport {
  const width = input.width ?? input.manifest.meta.width
  const height = input.height ?? input.manifest.meta.height
  const duration = input.durationSec > 0 ? input.durationSec : 0
  return {
    quality: input.quality,
    frames: input.frames,
    totalMs: input.totalMs,
    // 分镜路径没有独立的准备阶段（段渲染各自准备），不虚报拆分项。
    prepareMs: 0,
    prepareFontMs: 0,
    prepareProbeMs: 0,
    prepareCapabilityMs: 0,
    renderMs: input.totalMs,
    msPerFrame: input.frames > 0 ? Math.round((input.totalMs / input.frames) * 100) / 100 : 0,
    encodeDoneAtMs: input.totalMs,
    bytes: input.bytes,
    // 两位小数：一位小数会把「极小产物」折成 0，读数上等于没测（真机成片是 MB 级，不受影响，
    // 但报告不该在边界上撒谎）。
    bitrateKbps: duration > 0 ? Math.round(((input.bytes * 8) / duration / 1000) * 100) / 100 : 0,
    width,
    height,
    sampledFrames: input.sampledFrames,
    ...(input.timingCheck === undefined ? {} : { timingCheck: input.timingCheck }),
  }
}

/**
 * 分镜渲染主流程：决策 → 脏段渲染 → 段产物发布 → 段级抽帧 → 拼接 → 合成 outcome。
 *
 * 返回 `outcome: null` 的唯一情况是「不走分镜」（`planShotRender` 判 whole），
 * 那时回执带一行原因，调用方落回整片路径（行为与不切片逐字段一致）。
 */
export async function runShotRender(
  manifest: CompositionManifest,
  deps: ShotRenderDeps,
): Promise<ShotRenderResult> {
  const now = deps.now ?? ((): number => Date.now())
  const receipt: string[] = []
  const spec = deps.loadSpec !== undefined ? deps.loadSpec() : readProjectSpec(deps.projectDir)
  const specBoundaries = spec === null || spec === undefined
    ? null
    : boundariesFromSpec(spec, manifest.meta.durationInFrames, manifest.meta.fps)
  const plan = planShotRender(manifest, {
    specBoundaries,
    quality: deps.quality,
    projectDir: deps.projectDir,
    // 入口已保证非 probe/spot。带 audio 的片子只要**画面里没有 video 轨**就能走分镜 ——
    // 声音全在 `manifest.audio`，拼接后由 `muxAudio` 整轨补上（P0-2）。有 video 轨时
    // 原生声在段渲染 mute 之后找不回来，仍整片渲。
    allowShots: audioCompatibleWithShots(manifest),
  })
  if (plan.mode !== 'shots') {
    return {
      outcome: null,
      receipt: plan.reason === undefined ? [] : [`ℹ️ 分镜渲染未启用：${plan.reason}`],
      segments: [],
    }
  }

  const segments = plan.segments as ShotSegment[]
  const cacheDir = plan.cacheDir as string
  // P1-2：全局态指纹由 planShotRender 算一次，比对与落缓存共用同一把钥匙。
  const shotGlobals = plan.globals as string
  const { dirty, reused } = getDirtySegments(segments, deps.quality, cacheDir, shotGlobals)
  // 孤儿回收：hash 失配的旧条目按**全档合法集**清理（P1-4：只认本次档会把 high 条目
  // 当垃圾清光）；hashes 异常缺失时跳过（绝不能拿空集合当合法集 —— 那会清光整个缓存目录）。
  if (Array.isArray(plan.hashes) && plan.hashes.length > 0) {
    const orphans = clearStaleEntries(cacheDir, new Set(allTierCacheHashes(segments, shotGlobals)))
    if (orphans > 0) receipt.push(`🧹 段缓存回收 ${String(orphans)} 条过期条目`)
  }

  const startedAt = now()
  const renderedByIndex = new Map<number, string>()
  const segmentWarnings: string[] = []
  for (const segment of dirty) {
    const outcome = await deps.renderSegment(segment)
    const absPath = deps.resolveAsset(outcome.assetFile)
    renderedByIndex.set(segment.index, absPath)
    storeSegment(segment, deps.quality, cacheDir, absPath, shotGlobals)
    // 段渲染的告警（字体缺失 / 编码降级）此前被整体丢弃 —— 分镜路径静默降级。
    for (const warning of outcome.warnings) {
      if (!segmentWarnings.includes(warning)) segmentWarnings.push(warning)
    }
  }

  const orderedFiles = segments.map((segment) => {
    const hit = reused.find((entry) => entry.segment.index === segment.index)
    if (hit !== undefined) return hit.entry.videoPath
    const file = renderedByIndex.get(segment.index)
    if (file === undefined) throwError('CS-SHOT-004', { index: segment.index })
    return file
  })

  const artifacts = planSegmentArtifacts({
    segments,
    declared: manifest.meta.segments,
    fps: manifest.meta.fps,
  })

  const mergedTmp = join(shotCacheDir(deps.projectDir), `merged-${randomUUID().slice(0, 8)}.mp4`)
  // 混音产物与拼接中间件同属临时文件，finally 一并清掉（不留 N 个 merged-* 在缓存目录）。
  let voicedTmp: string | null = null
  let outcome: RenderJobOutcome
  let pointers: SegmentPointer[] = []
  const frames: RenderSampleResult[] = []
  try {
    await deps.concat({ segmentFiles: orderedFiles, outputPath: mergedTmp, signal: deps.signal })
    // P0-2：段渲染恒静音、concat 又是 `-c copy` ⇒ 合并片没有音轨。挂旁白/配乐的片子
    // 现在也走分镜（见上面的 `audioCompatibleWithShots`），所以这里必须补一次整轨混音，
    // 否则"分镜快"是拿"成片没声音"换的。混音失败只降级成无声 + 一行回执，不让成片陪葬。
    let mergedSource = mergedTmp
    if (manifest.audio !== undefined) {
      const mux = deps.muxAudio ?? muxManifestAudio
      const outputPath = join(shotCacheDir(deps.projectDir), `merged-${randomUUID().slice(0, 8)}-voiced.mp4`)
      try {
        const result = await mux({
          videoPath: mergedTmp,
          outputPath,
          manifest,
          assetsDir: deps.assetsDir,
          signal: deps.signal,
        })
        if (result.mixed) {
          mergedSource = result.videoPath
          voicedTmp = result.videoPath
          receipt.push(result.audioComposition === undefined
            ? '🔊 分镜成片已按 manifest.audio 整轨混音'
            : `🔊 分镜成片已整轨混音（音轨构成：${result.audioComposition}）`)
        }
        if (result.note !== undefined) receipt.push(result.note)
      } catch (cause) {
        receipt.push(`⚠️ 分镜成片混音异常，已输出无声母版：${cause instanceof Error ? cause.message : String(cause)}`)
      }
    }
    const mergedBytes = readFileSync(mergedSource)
    const saved = await deps.saveMerged(mergedBytes, `remotion-shot-merged-${randomUUID().slice(0, 8)}.mp4`)
    const info = await deps.probeMedia(deps.resolveAsset(saved.assetFile))
    const totalFrames = segments.reduce((sum, segment) => sum + (segment.endFrame - segment.startFrame), 0)
    const totalMs = Math.max(0, now() - startedAt)

    // 抽帧放在成片落盘之后：它读的是段产物（与成片同源），失败只记一行。
    if (deps.sampleFrame !== undefined) {
      for (const artifact of artifacts) {
        const file = orderedFiles[artifact.index]
        const segment = segments[artifact.index]
        if (file === undefined || segment === undefined) continue
        try {
          const sampled = await deps.sampleFrame({ segment, file, artifact })
          if (sampled !== null) frames.push({ frame: artifact.sampleFrame, url: sampled.url })
        } catch (cause) {
          receipt.push(`⚠️ 段 ${artifact.id} 抽帧失败：${cause instanceof Error ? cause.message : String(cause)}`)
        }
      }
    }

    const publish = deps.publishSegments ?? deps.quality !== 'draft'
    if (publish) {
      const published = publishSegmentArtifacts({
        projectDir: deps.projectDir,
        assetsDir: deps.assetsDir,
        artifacts,
        files: orderedFiles,
        fps: manifest.meta.fps,
      })
      pointers = published.pointers
      if (published.note !== undefined) receipt.push(`⚠️ 段产物未完整落地：${published.note}`)
    }

    // Q2 时序闸：拆解表 ≥2 段才回核（单段没有边界可比）。失败只降级为一行提示，
    // 绝不吞掉已经渲出来的成片。
    let timingCheck: TimingCheckSummary | undefined
    if ((deps.timingSegments?.length ?? 0) >= 2) {
      try {
        const verified = await (deps.verifyTiming ?? verifyShotTiming)({
          videoPath: deps.resolveAsset(saved.assetFile),
          segments: deps.timingSegments as readonly TeardownSegment[],
        })
        timingCheck = verified.summary
        for (const warning of verified.warnings) {
          if (!segmentWarnings.includes(warning)) segmentWarnings.push(warning)
        }
      } catch (cause) {
        receipt.push(`⚠️ [时序回核] 未执行：${cause instanceof Error ? cause.message : String(cause)}`)
      }
    }

    outcome = {
      url: saved.url,
      assetFile: saved.assetFile,
      duration: info.duration,
      ...(info.width === undefined ? {} : { width: info.width }),
      ...(info.height === undefined ? {} : { height: info.height }),
      warnings: segmentWarnings,
      quality: deps.quality,
      frames,
      // 合成诊断：分镜拼接产物没有单次渲染的工单史 —— 按 RenderJobDiagnostics 最小集填充。
      job: {
        id: `shot-${randomUUID().slice(0, 8)}`,
        path: 'client',
        claimedAt: startedAt,
        firstFrameAt: null,
        settled: 'ok',
        takeover: false,
        waitedMs: 0,
        maxProgress: 1,
      },
      report: shotReport({
        quality: deps.quality,
        manifest,
        frames: totalFrames,
        totalMs,
        bytes: mergedBytes.length,
        durationSec: info.duration,
        sampledFrames: frames.length,
        ...(info.width === undefined ? {} : { width: info.width }),
        ...(info.height === undefined ? {} : { height: info.height }),
        ...(timingCheck === undefined ? {} : { timingCheck }),
      }),
    }
  } finally {
    rmSync(mergedTmp, { force: true })
    // 混音产物同样只是一次性的中间件（成片字节已读进内存）。
    if (voicedTmp !== null) rmSync(voicedTmp, { force: true })
  }

  receipt.push(
    `🧩 分镜渲染：${String(segments.length)} 段（${String(reused.length)} 复用 / ${String(dirty.length)} 重渲，边界来源 ${boundaryLabelOf(manifest, specBoundaries)}）`,
  )
  const segmentLine = segmentReceiptLine(pointers)
  if (segmentLine !== '') receipt.push(segmentLine)
  return { outcome, receipt, segments: pointers }
}
