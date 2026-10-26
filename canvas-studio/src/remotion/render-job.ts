/**
 * REQ-034（Remotion 集成）· B3 route B 渲染工单桥（宿主半，**无浏览器**）。
 *
 * 技术事实源 = 仓根 `remotion-integration-devdoc-2026-10-14.md` §6.3（v1.5）。
 *
 * 路线 B（CSR）下真正的渲染发生在 Electron 渲染进程（`@remotion/web-renderer`），
 * 宿主拿不到 `<canvas>` / `VideoEncoder`；于是走一条**工单桥**：
 *
 *   工具 `render_composition`
 *     └─ 宿主 `runRenderJob`：建单（内存表）+ 挂超时 + 等结算
 *          └─ 客户端 `pollRemotionQueue`（GET /remotion/pending）取单 + CSR 渲染
 *               └─ 客户端回写（POST /remotion/commit 传字节 / cancel 传失败原因）
 *     └─ 宿主 `commitRenderJob`：落盘 `saveLocalAssetBytes` + `probeMediaInfo` 探真值 → 结算
 *
 * 工单**不落文件**：Host 半与路由同进程，模块级 `Map` 即单例（devdoc §6.3 注允许，
 * 且比文件式更易测）。新增 CV-xxx。
 */
import { join } from 'node:path'
import { newAssetId } from '../config.js'
import { makeCanvasError } from '../error-system.js'
import { probeMediaInfo } from '../ffmpeg-run.js'
import { saveLocalAssetBytes } from '../generate.js'
import { recordTransientAsset } from '../asset-gc.js'
import type { ProjectRegistry } from '../projects.js'
import '../errors/catalog.js'
import type { CompositionManifest, RenderQuality } from './manifest.js'
import { summarizeManifestAudio, type ManifestAudioSummary } from './manifest.js'
import {
  listRenderJobs,
  reportRenderProgress,
  reserveRenderSlot,
  releaseRenderSlot,
  type RenderJobView,
} from './render-queue.js'
import { hasRenderHostLauncher, warmRenderHost } from '../render-host/dispatch.js'
import { RENDER_HOST_STALE_MS, renderHostCanTakeOver, renderHostHealth, renderHostReady } from '../render-host/status.js'
import { resetRenderHostAfterFailure } from '../render-host/dispatch.js'
import { pickSampleFrames, renderTimeoutMs } from './timing.js'

/**
 * 工单超时**下限**（毫秒）。
 *
 * 二期 1b 起不再是固定值：真实超时 = `renderTimeoutMs(帧数)`
 * （`clamp(帧数 × 200ms + 60s, 90s, 20min)`，见 `timing.ts`；REQ-034 O-06 改口径）。
 * 保留这个常量是因为它仍是下限，且外部（测试 / 文档）按「一分钟半量级」理解这条工单。
 */
export const RENDER_JOB_TIMEOUT_MS = 90_000

/**
 * 这张单由谁来渲染（**建单时定；唯一的例外见 `claimRenderJobFor` 的滞留改派**）。
 *
 * - `render-host`：隐藏窗口（`src/render-host/`）。页面被遮挡/最小化/切会话都照跑。
 * - `client`：用户画布页（三期之前的老路径）。页面不可见 ⇒ rAF 停摆 ⇒ 挂到超时。
 *
 * 为什么要在建单时钉死而不是每拍现算：现算会让「窗口在第 3 秒死掉」的单在下一拍
 * 被客户端接走，而客户端只能**从头**渲一遍 —— 用户看到进度条回到 0，且上一单的抽帧
 * 已经落了一半。钉死 + 心跳看门狗（失联即结算失败）语义更诚实：要么渲完，要么明确报错。
 *
 * ⚠️ 2026-10-23 例外（滞留改派）：真机实测「冷启窗口 3s 内没就绪 ⇒ 单钉给 client，
 * 而画布页取单链路死了（页面没开 / 项目没选中 / 轮询早停）」时，这张单**没人认领**，
 * 白等到 `CS-RENDER-TIMEOUT`（10-20 起 11 连败的签名）。故 `client` 单若在宽限期内
 * 连客户端看都没看过一眼（从未被 claim），允许隐藏窗口在就绪后**接管**——它从头渲，
 * 与「页面中途切走导致重渲」的代价一致，而收益是把必然超时变成必然成功。
 */
export type RenderExecutor = 'render-host' | 'client'

/** 客户端轮询看到的工单视图（不含宿主内部结算 handle）。 */
export interface PendingRenderJob {
  jobId: string
  projectId: string
  /** 校正后的 Manifest（宿主已派生音频构成 / 校正视频时长）。 */
  manifest: CompositionManifest
  fps: number
  /** 三期 W5-3：质量档（客户端据此选编码参数，并决定是否跳过预览闸门）。 */
  quality: RenderQuality
  /** CV-373：探针渲染 —— 客户端据此跳过预览闸门（诊断渲不打扰用户）。 */
  probe: boolean
  /**
   * 三期 W5-4：宿主 ffprobe 已探到的真值时长（`src → 秒`）。
   * 客户端**直接复用**，不再自己探一遍（原来 10 段素材要白等 1.5–8s）。
   */
  realDurations: Record<string, number>
  /** 三期 W6-1：建议抽帧位置（绝对帧号）。 */
  sampleFrames: number[]
  /**
   * 本单的**绝对截止时刻**（宿主时钟毫秒）。
   *
   * 给页面一个自己能判的终线：宿主超时只是"宿主不再等"，页面并不知道，
   * 于是一次挂住的渲染会让 `currentJobId` 长期非空、后续轮询全部跳过
   * （2026-10-24 事故的放大器）。页面拿到它就能在同一时刻自行 abort。
   */
  deadlineAt: number
}

/** 三期 W6-2 / REQ-035 F-04：渲染报告（宿主侧形状，字段与客户端 `RenderMetrics` 一一对齐）。 */
export interface RenderJobReport {
  quality: RenderQuality
  frames: number
  totalMs: number
  /** 准备阶段（字体注入 + 素材时长探测 + 能力判定），与帧数无关。 */
  prepareMs: number
  /** 净渲染耗时（`renderMediaOnWeb` 从调用到返回）。 */
  renderMs: number
  /** 每帧净渲染耗时 = `renderMs / frames`。 */
  msPerFrame: number
  /** 全部帧**编码完成**的时刻（相对渲染开始）；不是"编码耗时"。 */
  encodeDoneAtMs: number
  bytes: number
  bitrateKbps: number
  width: number
  height: number
  sampledFrames: number
  /** OPT-11：音频平台保证 —— 由 manifest 确定性推导（非探测）。`audibleSources=0` ⇒ 成片必然无声。 */
  audio?: ManifestAudioSummary
}

/**
 * REQ-035 F-01：工单生命周期快照。
 *
 * 2026-10-24 事故的 39 次超时里，agent 只能看到"超时"这一句，无法区分
 * 「没人取单」「取了没开渲」「渲到一半停了」—— 三种情况的修法完全不同。
 * 这份快照成功与失败都会带回，并拼进超时文案，让排障不再靠猜。
 */
export interface RenderJobDiagnostics {
  id: string
  /** 谁在渲：隐藏渲染窗口 or 用户画布页。 */
  path: RenderExecutor
  /** 被认领的时刻；`null` = 从未被认领。 */
  claimedAt: number | null
  /** 第一帧进度上报的时刻；`null` = 一帧都没出过。 */
  firstFrameAt: number | null
  settled: 'ok' | 'failed' | 'timeout' | 'cancelled'
  /** 是否发生过滞留改派（画布页卡住 → 窗口接管）。 */
  takeover: boolean
  /** 从派发到结算的毫秒数。 */
  waitedMs: number
  /** 到过的最大进度（0–1）。 */
  maxProgress: number
}

/** 把诊断快照压成一句人读文本（进超时文案与日志）。 */
export function describeDiagnostics(d: RenderJobDiagnostics): string {
  const who = d.path === 'render-host' ? '隐藏渲染窗口' : '画布页'
  const waited = Math.round(d.waitedMs / 1000)
  if (d.claimedAt === null) return `${who}从未取走这张工单（等 ${waited}s）`
  if (d.firstFrameAt === null) return `${who}已取单但 ${waited}s 内一帧都没渲染`
  return `${who}已渲染 ${waited}s，进度 ${Math.round(d.maxProgress * 100)}%${d.takeover ? '（曾发生过改派）' : ''}`
}

/** 三期 W6-1：一张抽帧（已落盘的同源 URL）。 */export interface RenderSampleResult {
  frame: number
  url: string
}

/** `runRenderJob` 结算产物（宿主已落盘并探测真值）。 */
export interface RenderJobOutcome {
  /** 同源资产 URL（`/canvas-studio/assets/<projectId>/<file>`）。 */
  url: string
  /** 落盘文件名（`assetFile`）。 */
  assetFile: string
  /** 成片真值时长（秒）；未探到为 `0`。 */
  duration: number
  width?: number
  height?: number
  /** 渲染期告警（客户端上报的字体降级 / 编码降级 + 宿主探测告警）。 */
  warnings: string[]
  /** 三期 W5-3：本次质量档。 */
  quality: RenderQuality
  /** 三期 W6-1：抽帧（可为空）。 */
  frames: RenderSampleResult[]
  /** 三期 W6-2：渲染报告。 */
  report: RenderJobReport
  /** REQ-035 F-01：工单生命周期快照（成功也回，便于对比"这次为什么快/慢"）。 */
  job: RenderJobDiagnostics
}

/** 建单参数。 */
export interface RunRenderJobOptions {
  projectId: string
  manifest: CompositionManifest
  /** 渲染帧率（缺省取 `manifest.meta.fps`）。 */
  fps?: number
  /** 超时（毫秒）；缺省 `renderTimeoutMs(帧数)`。测试注入短值。 */
  timeoutMs?: number
  signal?: AbortSignal
  /** 三期 W5-3：质量档（缺省 `standard`）。 */
  quality?: RenderQuality
  /** CV-373：探针渲染（REQ-035 F-05）—— 客户端据此跳过预览闸门（诊断渲不打扰用户）。 */
  probe?: boolean
  /** 三期 W5-4：宿主探测到的素材真值时长（透传给客户端，免二次探测）。 */
  realDurations?: Record<string, number>
  /** 三期 W6-1：抽帧位置（缺省由客户端按 4 张 + 转场中点自选）。 */
  sampleFrames?: number[]
  /** O-06：强制指定执行者（测试 / 排障用；缺省按 RenderHost 是否就绪自动选）。 */
  executor?: RenderExecutor
  /** O-06：等隐藏窗口自报就绪的上限（缺省 `RENDER_HOST_WARMUP_MS` = 8s）。只影响冷启首单。 */
  hostWarmupMs?: number
  /** O-06：心跳判失联阈值（缺省 `RENDER_HOST_STALE_MS`）。测试注入短值。 */
  heartbeatStaleMs?: number
  /** client 单「取单后一帧没动」的判死阈值（缺省 `CLIENT_CLAIM_STALL_MS`）。测试注入短值。 */
  clientClaimStallMs?: number
  /** client 单「开渲后停滞」的判死阈值（缺省 `CLIENT_PROGRESS_STALL_MS`）。测试注入短值。 */
  clientProgressStallMs?: number
}

/** 客户端回写内容。 */
export interface CommitRenderInput {
  /** 客户端渲染出的 mp4 字节。 */
  bytes: Uint8Array
  /** 客户端上报的渲染期告警。 */
  warnings?: readonly string[]
  /** 三期 W6-2：客户端渲染报告（缺省用宿主侧兜底值）。 */
  report?: Partial<RenderJobReport>
}

/** 回写响应（也作为路由 200 体）。 */
export interface CommitRenderResult {
  ok: true
  url: string
  assetFile: string
  duration: number
  width?: number
  height?: number
}

interface ActiveRenderJob {
  jobId: string
  projectId: string
  manifest: CompositionManifest
  fps: number
  /** 三期 W5-3：质量档。 */
  quality: RenderQuality
  /** CV-373：探针渲染 —— 透传给客户端跳过预览闸门。 */
  probe: boolean
  /** 三期 W5-4：宿主已探到的素材真值（透传客户端）。 */
  realDurations: Record<string, number>
  /** 三期 W6-1：建议抽帧位置。 */
  sampleFrames: number[]
  /** 三期 W6-1：已回写的抽帧。 */
  samples: RenderSampleResult[]
  /** O-06：这张单归谁渲（建单时定）。 */
  executor: RenderExecutor
  /** O-06：最近一次进度上报（心跳看门狗把它也算作「活着」的证据）。 */
  lastProgressAt: number
  /**
   * 到过的最大进度（0–1）。`0` 表示**一帧都没动过**。
   *
   * 改派与看门狗都用它区分「取走了但没开渲」和「正在渲只是慢」——这两件事的处置
   * 完全相反（前者要立刻接管/结算，后者必须继续等）。
   */
  maxProgress: number
  /** O-06：宿主心跳看门狗（只在 `render-host` 单派发后存在）。 */
  watchdog: ReturnType<typeof setInterval> | null
  resolve: (outcome: RenderJobOutcome) => void
  reject: (cause: unknown) => void
  timer: ReturnType<typeof setTimeout>
  signal?: AbortSignal
  onAbort?: () => void
  settled: boolean
  /** 二期 1b：是否已获得渲染槽位（排队中为 `false`，客户端暂时看不到这张单）。 */
  dispatched: boolean
  /** 滞留改派：获得槽位的时刻（`armTimeout` 恰在派发时跑一次）。 */
  dispatchedAt?: number
  /** 滞留改派：画布页第一次 claim 到这张单的时刻；从未被看过为 `undefined`。 */
  clientClaimedAt?: number
  /** REQ-035 F-01：任意执行者第一次 claim 的时刻（诊断用，不改派判据）。 */
  claimedAt?: number
  /** REQ-035 F-01：第一次进度 > 0 的时刻；`undefined` = 一帧都没出过。 */
  firstFrameAt?: number
  /** 滞留改派：被隐藏窗口接管的时刻（观测用）。 */
  takenOverAt?: number
  /** O-06：本单生效的心跳判失联阈值（建单时算好，改派后看门狗复用同一值）。 */
  heartbeatStaleMs: number
  /** 本单预算（毫秒）；`deadlineAt = dispatchedAt + timeoutMs`。 */
  timeoutMs: number
  /** 绝对截止时刻（派发时定；页面据此自 abort，见 `PendingRenderJob.deadlineAt`）。 */
  deadlineAt: number
  /** client 单「取单后一帧没动」的判死阈值（见 `CLIENT_CLAIM_STALL_MS`）。 */
  claimStallMs: number
  /** client 单「开渲后停滞」的判死阈值（见 `CLIENT_PROGRESS_STALL_MS`）。 */
  progressStallMs: number
}

/** 进程内工单表（Host 半与路由同模块单例）。 */
const activeJobs = new Map<string, ActiveRenderJob>()

/**
 * 取一张**归本执行者渲染**的工单（`GET /remotion/pending` 的唯一实现）。
 *
 * `owner` 是请求方：隐藏窗口传 `render-host`，用户画布页传 `client`。
 * 归谁在建单时已定（见 `RenderExecutor` 的注释），这里只是按归属过滤 ——
 * **不在这里做「先到先得」的抢占**，否则两条 1s 轮询会互相偷单。
 *
 * @param projectId `null` = 任意项目（只有 RenderHost 这么用：它不绑定画布页）
 */
export function claimRenderJobFor(
  projectId: string | null,
  owner: RenderExecutor,
  options: ClaimRenderJobOptions = {},
): PendingRenderJob | null {
  const now = options.now ?? Date.now()
  for (const job of activeJobs.values()) {
    if (job.projectId !== projectId && projectId !== null) continue
    if (!job.dispatched) continue
    if (job.executor !== owner) continue
    // 滞留改派的判据打点：画布页「看过」这张单的第一拍。只记第一次即可，
    // 轮询每秒都会再来，重复打点无害。
    if (owner === 'client' && job.clientClaimedAt === undefined) job.clientClaimedAt = now
    // 诊断用（F-01）：任意执行者的首次认领时刻。
    if (job.claimedAt === undefined) job.claimedAt = now
    return {
      jobId: job.jobId,
      projectId: job.projectId,
      manifest: job.manifest,
      fps: job.fps,
      quality: job.quality,
      probe: job.probe,
      realDurations: job.realDurations,
      sampleFrames: job.sampleFrames,
      deadlineAt: job.deadlineAt,
    }
  }
  if (owner === 'render-host') {
    // 滞留改派（2026-10-23，O-06 真机翻车的兜底）：隐藏窗口取单扑空时，把
    // 「画布页取走了却没动静」的 client 单接管过来。判据见 `clientJobIsOrphaned`。
    const takeover = takeoverOrphanedClientJob(now, options)
    if (takeover !== null) {
      return {
        jobId: takeover.jobId,
        projectId: takeover.projectId,
        manifest: takeover.manifest,
        fps: takeover.fps,
        quality: takeover.quality,
        probe: takeover.probe,
        realDurations: takeover.realDurations,
        sampleFrames: takeover.sampleFrames,
        deadlineAt: takeover.deadlineAt,
      }
    }
  }
  return null
}

/**
 * 滞留改派宽限期（毫秒）：`client` 单派发后这么久仍**从未被画布页 claim 过**，
 * 隐藏窗口取单时可以接管。
 *
 * 为什么是 15s：健康的画布页每 1s 一拍、取到单立刻开渲，宽限期只要盖过几拍
 * 轮询就够（「工具调用 → 宿主建单」的校验/素材探测延迟发生在派发**前**，不占
 * 这段）。太短会和「客户端正在路上」的正常竞态抢单，太长则把用户白等的超时
 * 又拉长一截。
 */
export const RENDER_HOST_TAKEOVER_GRACE_MS = 15_000

/**
 * 「取走了但没开渲」的判定阈值（毫秒）。
 *
 * 2026-10-24 事故里最贵的一条：`clientClaimedAt` 一旦打点就**永久**放弃改派，
 * 而 claim ≠ 在渲。画布页取到单后卡住（主线程被 `pageResponsiveness: 'disabled'`
 * 按住、页面被切走、renderer 崩了），这张单就再也回不到空闲的隐藏窗口。
 * 现在改成：claim 后这么久**一帧进度都没有** ⇒ 视为滞留，允许接管 / 结算。
 *
 * 为什么是 20s：健康客户端出首帧是秒级；20s 足够盖住一次慢启动，又远小于
 * 90s 的工具超时下限。
 */
export const CLIENT_CLAIM_STALL_MS = 20_000

/**
 * 「开渲后停滞」的判定阈值（毫秒）。
 *
 * 已经出过进度、但这么久没有新进度 ⇒ 判卡死。取值比 claim 档宽得多：
 * 编码尾巴可能长时间没有回调（`draft` 档冻结主线程时更明显），误杀一张
 * 马上要成的片子比多等一分钟更贵。
 */
export const CLIENT_PROGRESS_STALL_MS = 90_000

/**
 * 冷启等待上限（毫秒）。
 *
 * 原值 3s 是纸面推演：窗口要创建 → loadURL → 拉 bundle → 自检 → 首次自报，
 * 实测远不止 3s。于是**每个新会话的首单几乎必然被判给画布页**，而那正是最
 * 容易挂的一条路（见 Phase 0 报告 §三 D-4）。
 */
export const RENDER_HOST_WARMUP_MS = 8_000

/** 滞留改派的可调参数（`claimRenderJobFor` 第三参；生产路径不传）。 */
export interface ClaimRenderJobOptions {
  /** 现在时刻（测试注入假时钟）。 */
  now?: number
  /** 宽限期（缺省 `RENDER_HOST_TAKEOVER_GRACE_MS`）。 */
  graceMs?: number
  /** claim 后无进度的滞留阈值（缺省 `CLIENT_CLAIM_STALL_MS`）。 */
  claimStallMs?: number
  /** 开渲后停滞阈值（缺省 `CLIENT_PROGRESS_STALL_MS`）。 */
  progressStallMs?: number
  /** 发生改派时的通知（路由层拿去打日志，排障用）。`reason` 说明命中哪一档滞留判据。 */
  onTakeover?: (jobId: string, reason: string) => void
}

/**
 * 这张 client 单是不是已经"滞留"（可以改派）；返回原因，`null` = 还正常。
 *
 * 三档，按证据强弱递进：
 * 1. **从没被取过**：派发后超过宽限期 ⇒ 画布页压根没在工作（原逻辑）。
 * 2. **取过但一帧没动**：claim 后超过 `claimStallMs` ⇒ 取了单却没开渲（新增）。
 * 3. **开渲后停住**：进度停更超过 `progressStallMs` ⇒ 中途卡死（新增）。
 *
 * 第 2 档是本次事故的核心：原判据止步于「claim 过就永不改派」，把"取单"当成了
 * "在渲"。原因串会原样进宿主日志，排障时一眼能分清是哪一档。
 */
function clientJobOrphanReason(
  job: ActiveRenderJob,
  now: number,
  graceMs: number,
  claimStallMs: number,
  progressStallMs: number,
): string | null {
  if (job.executor !== 'client' || job.settled || !job.dispatched) return null
  if (job.clientClaimedAt === undefined) {
    // 派发时刻未知按「刚派发」处理：宁可少改派，不多抢。
    const dispatchedAt = job.dispatchedAt ?? now
    return now - dispatchedAt >= graceMs ? '宽限期内画布页未认领' : null
  }
  if (job.maxProgress <= 0) {
    // CV-373：判死计时落在**最后一次活性证据**上 —— 页面取单后会打报活心跳
    //（progress=0，`reportRenderJobProgress` 照样刷新 `lastProgressAt`）。
    // warmup（首帧前 ~80s）与预览闸门等人本来就会让 maxProgress 长期为 0，
    // 旧实现只看 `clientClaimedAt`，把「活着只是慢/在等人」误判成「死了」
    //（2026-10-25 会话 9 渲 7 死的根因）。页面停止报活 ⇒ 依旧是死，照常判。
    const waited = now - Math.max(job.clientClaimedAt, job.lastProgressAt)
    return waited >= claimStallMs ? `画布页认领后 ${Math.round(waited / 1000)}s 无任何进度（含报活）` : null
  }
  const stalled = now - job.lastProgressAt
  return stalled >= progressStallMs ? `画布页进度停滞 ${Math.round(stalled / 1000)}s` : null
}

/**
 * 滞留改派：找最老一张"滞留"的 client 单，转给隐藏窗口。
 *
 * 只转**一张**：隐藏窗口的取单是 1s 一拍的轮询，并发又是 1 —— 一拍接一单，
 * 剩下的下一拍自然轮到（FIFO 由 Map 插入序保证，与队列口径一致）。
 *
 * @returns 被改派的工单；没有合格候选时返回 `null`（调用方照旧返回无单）。
 */
function takeoverOrphanedClientJob(
  now: number,
  options: ClaimRenderJobOptions,
): ActiveRenderJob | null {
  // 窗口只要**还能干活**就配接管 —— 不再要求它「此刻就绪」。
  // 两者共用一个判据会形成死锁：窗口忙/刚渲染完 ⇒ 新单推给画布页，同时禁止它接管。
  // 这条 claim 也可能来自 curl（排障手工取单），所以仍要求窗口活着，避免把单从一个
  // 「可能只是慢」的客户端手里抢给一个不存在的窗口。
  if (!renderHostCanTakeOver(now)) return null
  const graceMs = options.graceMs ?? RENDER_HOST_TAKEOVER_GRACE_MS
  const claimStallMs = options.claimStallMs ?? CLIENT_CLAIM_STALL_MS
  const progressStallMs = options.progressStallMs ?? CLIENT_PROGRESS_STALL_MS
  for (const job of activeJobs.values()) {
    const reason = clientJobOrphanReason(job, now, graceMs, claimStallMs, progressStallMs)
    if (reason === null) continue
    job.executor = 'render-host'
    job.takenOverAt = now
    // 改派单要在这里补装看门狗（`armTimeout` 只给建单时就归窗口的单装），
    // 否则窗口渲到一半死掉，这张单要干等原始超时而不是 30s 内结算。
    armLivenessWatchdog(job, job.heartbeatStaleMs)
    options.onTakeover?.(job.jobId, reason)
    return job
  }
  return null
}

/**
 * 向后兼容的旧入口（等价于「以客户端身份取单」）。
 *
 * ⚠️ 在 RenderHost 就绪时，属于隐藏窗口的单这里会返回 `null` —— 这正是 O-06 要的：
 * 客户端不该看见别人（别的执行者）的单。
 */
export function pendingRenderJobFor(projectId: string): PendingRenderJob | null {
  return claimRenderJobFor(projectId, 'client')
}

/** 测试 / 诊断用：当前活跃工单数（含排队中的）。 */
export function activeRenderJobCount(): number {
  return activeJobs.size
}

/** 测试 / 诊断用：仍在排队（未获槽位）的工单数。 */
export function queuedRenderJobCount(): number {
  let count = 0
  for (const job of activeJobs.values()) if (!job.dispatched) count += 1
  return count
}

/** 进度接口的数据源（`GET /remotion/jobs`）。 */
export function listRenderJobViews(projectId?: string): RenderJobView[] {
  return listRenderJobs(projectId)
}

/** 客户端上报渲染进度（0–1）；单不存在 / 未在渲染返回 `false`。`now` 供假时钟测试。 */
export function reportRenderJobProgress(
  jobId: string,
  progress: number,
  options: { now?: number } = {},
): boolean {
  const applied = reportRenderProgress(jobId, progress)
  // O-06：进度也是「页面还活着」的证据 —— 看门狗用它兜住「主线程被编码器按住」的窗口。
  if (applied) {
    const job = activeJobs.get(jobId)
    if (job !== undefined) {
      job.lastProgressAt = options.now ?? Date.now()
      // `maxProgress > 0` 是「真的开渲了」的唯一硬证据，改派与看门狗都靠它区分
      // 「取单没动」和「在渲只是慢」。
      if (Number.isFinite(progress) && progress > job.maxProgress) {
        if (job.maxProgress <= 0 && progress > 0) job.firstFrameAt = Date.now()
        job.maxProgress = progress
      }
    }
  }
  return applied
}

/** REQ-035 F-01：把一张工单的当前状态压成诊断快照（结算前后都可调）。 */
function diagnosticsOf(job: ActiveRenderJob, settled: RenderJobDiagnostics['settled']): RenderJobDiagnostics {
  const since = job.dispatchedAt ?? job.claimedAt ?? Date.now()
  return {
    id: job.jobId,
    path: job.executor,
    claimedAt: job.claimedAt ?? null,
    firstFrameAt: job.firstFrameAt ?? null,
    settled,
    takeover: job.takenOverAt !== undefined,
    waitedMs: Math.max(0, Date.now() - since),
    maxProgress: job.maxProgress,
  }
}

function settleAndForget(job: ActiveRenderJob, state: 'succeeded' | 'failed' | 'cancelled' | 'timedOut', error?: string): void {  clearTimeout(job.timer)
  if (job.watchdog !== null) {
    clearInterval(job.watchdog)
    job.watchdog = null
  }
  if (job.onAbort !== undefined) job.signal?.removeEventListener('abort', job.onAbort)
  activeJobs.delete(job.jobId)
  releaseRenderSlot(job.jobId, state, error)
}

/** 冷启探测间隔（毫秒）。 */
const EXECUTOR_PROBE_MS = 100

/**
 * 建单时决定这张单归谁渲（见 `RenderExecutor` 的注释）。
 *
 * ⚠️ 这个函数**必须只在真正需要等的时候才 await**：`runRenderJob` 在它之前建单，
 * 一旦无条件 `await`，调用方「起单 → 立刻取单」的一拍就会拿到 `null`
 *（工单表还是空的）—— 老测试与老客户端都是这么用的。所以这里先算能**同步**定的
 * 两种情况，只有「有拉起器但窗口还在起」才真去等。
 */
function immediateExecutor(options: RunRenderJobOptions): RenderExecutor | undefined {
  if (options.executor !== undefined) return options.executor
  // 没有拉起器（纯 CLI 宿主 / 单测）⇒ 没有窗口可言，直接客户端，零等待。
  if (!hasRenderHostLauncher()) return 'client'
  // 窗口已自报就绪 ⇒ 同步归它。
  if (renderHostReady()) return 'render-host'
  return undefined
}

/**
 * 冷启等待：窗口存在但还没自报就绪（新建约 1s，实测更久）。
 *
 * 为什么值得等：首单如果甩给画布页，而用户此时切走了，就正好复现本次要修的
 * 那个挂死。等待预算从 3s 提到 8s —— 窗口要创建 → loadURL → 拉 bundle → 自检
 * → 首次自报，3s 是纸面值（2026-10-24 事故里首单几乎必然因此判给画布页）。
 * 等不到才老实回退客户端。
 */
async function pickExecutor(options: RunRenderJobOptions): Promise<RenderExecutor> {
  warmRenderHost()
  const budget = Math.max(0, options.hostWarmupMs ?? RENDER_HOST_WARMUP_MS)
  if (budget === 0) return 'client'
  const deadline = Date.now() + budget
  while (Date.now() < deadline) {
    if (options.signal?.aborted === true) return 'client'
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, EXECUTOR_PROBE_MS)
      ;(timer as unknown as { unref?: () => void }).unref?.()
    })
    if (renderHostReady()) return 'render-host'
  }
  return 'client'
}

/**
 * 心跳看门狗：**两种执行者都装**（此前只给 `render-host` 装，见下方"为什么改"）。
 *
 * 判据按执行者分开，因为两条路能拿到的证据不同：
 * - `render-host`：页面自报（`POST /render-host/status`，1s 一拍）与进度上报谁新用谁。
 *   只看自报会误杀 —— `pageResponsiveness: 'disabled'` 会把主线程按住几十秒。
 * - `client`：没有页面自报通道，只有进度。分两档（见 `clientSilence`）：
 *   取单后**一帧没动**按 `CLIENT_CLAIM_STALL_MS` 判，已开渲后按 `CLIENT_PROGRESS_STALL_MS` 判。
 *
 * 为什么 client 也要装：2026-10-24 事故里 client 单是**唯一**没有兜底的路径 ——
 * 画布页取走一张单后卡住，宿主只能干等到 90–420s 的固定超时，期间用户什么提示都没有。
 */
function armLivenessWatchdog(job: ActiveRenderJob, staleMs: number): void {
  if (job.watchdog !== null) return
  const tick = job.executor === 'render-host'
    ? Math.max(200, Math.min(1000, Math.floor(staleMs / 4)))
    : 1000
  const timer = setInterval(() => {
    if (job.settled) return
    const stall = silenceOf(job, Date.now(), staleMs)
    if (stall === null) return
    const diag = diagnosticsOf(job, 'failed')
    job.settled = true
    settleAndForget(job, 'failed', `${stall.detail} · ${describeDiagnostics(diag)}`)
    if (diag.path === 'render-host') resetRenderHostAfterFailure(`render host stalled: ${stall.detail}`)
    job.reject(makeCanvasError('CS-RENDER-002', {
      message: stall.message,
      detail: `${stall.detail} · ${describeDiagnostics(diag)}`,
      job: diag,
    }))
  }, tick)
  ;(timer as unknown as { unref?: () => void }).unref?.()
  job.watchdog = timer
}

/** 看门狗判定：返回 `null` 表示"还活着"，否则给出结算理由。 */
function silenceOf(
  job: ActiveRenderJob,
  now: number,
  staleMs: number,
): { message: string; detail: string } | null {
  if (job.executor === 'render-host') {
    const silentFor = Math.min(renderHostHealth(now).ageMs, now - job.lastProgressAt)
    if (silentFor <= staleMs) return null
    return {
      message: '渲染窗口异常，已中止本次渲染。请重试。',
      detail: `render host heartbeat lost for ${Math.round(silentFor / 1000)}s`,
    }
  }
  // client：看「有没有真的动起来」+「有没有报活」（CV-373：报活也是活性证据，
  // 口径与 clientJobOrphanReason 一致 —— 最后一次活性证据起算 20s）。
  if (job.maxProgress <= 0) {
    const lastAlive = Math.max(job.clientClaimedAt ?? job.dispatchedAt ?? now, job.lastProgressAt)
    const waited = now - lastAlive
    if (waited < job.claimStallMs) return null
    // 有窗口能干活 ⇒ 把「救活」的机会留给改派（它会重渲这一单），别在这里判死。
    if (renderHostCanTakeOver(now)) return null
    return {
      message: '画布页取单后一直没开始渲染，已中止本次渲染。请重试。',
      detail: `client claimed but produced no progress for ${Math.round(waited / 1000)}s (last liveness ${Math.round((now - job.lastProgressAt) / 1000)}s ago)`,
    }
  }
  const stalled = now - job.lastProgressAt
  if (stalled < job.progressStallMs) return null
  // 同上：能改派就交给窗口重渲 —— 编码尾巴可能长时间没有回调，
  // 宁可多跑一遍也不要误杀一张马上要成的片子。
  if (renderHostCanTakeOver(now)) return null
  return {
    message: '画布页渲染中断（长时间无进展），已中止本次渲染。请重试。',
    detail: `client progress stalled for ${Math.round(stalled / 1000)}s`,
  }
}

/**
 * 渲染窗口没了（renderer 崩溃 / 无响应 / 窗口被关）：立刻结算**所有**归它的单。
 *
 * 比等看门狗早 30 秒 —— 用户看到的是「立即报错重试」而不是半分钟的空转。
 * @returns 被结算的工单数（0 = 当时没有在飞的隐藏窗口单，调用方不必打日志）
 */
export function failRenderHostJobs(reason: string): number {
  let count = 0
  for (const job of [...activeJobs.values()]) {
    if (job.executor !== 'render-host' || job.settled) continue
    job.settled = true
    settleAndForget(job, 'failed', reason)
    job.reject(makeCanvasError('CS-RENDER-002', {
      message: '渲染窗口异常，已中止本次渲染。请重试。',
      detail: reason,
    }))
    count += 1
  }
  return count
}

/** 测试 / 诊断用：当前归隐藏窗口渲染的单数（含排队中的）。 */
export function renderHostJobCount(): number {
  let count = 0
  for (const job of activeJobs.values()) if (job.executor === 'render-host') count += 1
  return count
}

/**
 * 建单并等待客户端结算。
 *
 * 结算三条路：`commitRenderJob`（成功）/ `cancelRenderJob`（失败或撤单）/ 超时（本函数）。
 * abort（用户打断本轮）与超时都**不** `CS-GEN-207` 之外的特殊处理：abort 收敛到
 * `CS-GEN-207`（客户端据此移除占位节点，取消不是故障）。
 */
export async function runRenderJob(options: RunRenderJobOptions): Promise<RenderJobOutcome> {
  const { projectId, manifest } = options
  const fps = options.fps ?? manifest.meta.fps
  // 二期 1b（D-04）：超时按片长自适应；REQ-034 O-06 改按帧数。
  const timeoutMs = options.timeoutMs ?? renderTimeoutMs(manifest.meta.durationInFrames)
  const { signal } = options
  if (signal?.aborted === true) {
    throw makeCanvasError('CS-GEN-207', { detail: 'render job aborted before start' })
  }
  // O-06：先定执行者（可能要等窗口冷启），再建单 —— 等待不该算进渲染预算。
  const fastExecutor = immediateExecutor(options)
  const executor = fastExecutor ?? await pickExecutor(options)
  const heartbeatStaleMs = Math.max(50, options.heartbeatStaleMs ?? RENDER_HOST_STALE_MS)
  const jobId = `rj-${newAssetId()}`
  // 入队 + 尝试派发（同步入表 ⇒ 客户端当拍可见；并发 = 1 ⇒ 第二单要等前一单结算）。
  const slot = reserveRenderSlot(
    { jobId, projectId, durationInFrames: manifest.meta.durationInFrames, fps },
    signal,
  )
  return await new Promise<RenderJobOutcome>((resolve, reject) => {
    const job: ActiveRenderJob = {
      jobId,
      projectId,
      manifest,
      fps,
      quality: options.quality ?? manifest.meta.quality ?? 'standard',
      probe: options.probe === true,
      realDurations: options.realDurations ?? {},
      sampleFrames: options.sampleFrames ?? pickSampleFrames(manifest),
      samples: [],
      executor,
      lastProgressAt: Date.now(),
      maxProgress: 0,
      watchdog: null,
      resolve,
      reject,
      timer: setTimeout(() => {}, 0),
      settled: false,
      dispatched: slot.dispatched,
      heartbeatStaleMs,
      timeoutMs,
      deadlineAt: 0,
      claimStallMs: Math.max(1, options.clientClaimStallMs ?? CLIENT_CLAIM_STALL_MS),
      progressStallMs: Math.max(1, options.clientProgressStallMs ?? CLIENT_PROGRESS_STALL_MS),
      ...(signal !== undefined ? { signal } : {}),
    }
    activeJobs.set(jobId, job)
    const armTimeout = (): void => {
      if (job.settled) return
      // 滞留改派以本时刻为宽限起点（armTimeout 恰在「获得槽位」时跑一次）。
      job.dispatchedAt = Date.now()
      // 排队可能很久；进度/存活计时都从**真正派发**起算，否则排在前面的单会误判超时。
      job.lastProgressAt = job.dispatchedAt
      job.deadlineAt = job.dispatchedAt + timeoutMs
      // 两种执行者都要看门狗：client 单此前完全没有兜底（Phase 0 §三 D-3）。
      armLivenessWatchdog(job, heartbeatStaleMs)
      job.timer = setTimeout(() => {
        if (job.settled) return
        const diag = diagnosticsOf(job, 'timeout')
        job.settled = true
        settleAndForget(job, 'timedOut', `timeout after ${timeoutMs}ms · ${describeDiagnostics(diag)}`)
        // B2-2：超时且单在窗口上 ⇒ 认定窗口状态可疑，丢掉重建（客户端路径不碰窗口）。
        if (diag.path === 'render-host') resetRenderHostAfterFailure(`render timeout ${Math.round(timeoutMs / 1000)}s`)
        // F-01/F-03：把「谁认领了 / 有没有出首帧」直接写进文案 —— 39 次超时里
        // agent 只能看到一句"超时"，于是把执行器故障误判成画面太复杂。
        reject(makeCanvasError('CS-RENDER-TIMEOUT', {
          seconds: Math.round(timeoutMs / 1000),
          diagnosis: describeDiagnostics(diag),
          job: diag,
        }))
      }, timeoutMs)
    }
    if (slot.dispatched) {
      armTimeout()
    } else {
      // 排队中：**超时从派发时刻起算**（等队列的时间不该算进渲染预算）。
      void slot.when.then(() => {
        if (job.settled) return
        job.dispatched = true
        armTimeout()
      })
    }
    if (signal !== undefined) {
      job.onAbort = () => {
        if (job.settled) return
        job.settled = true
        settleAndForget(job, 'cancelled', 'render job aborted by user')
        reject(makeCanvasError('CS-GEN-207', { detail: 'render job aborted by user' }))
      }
      signal.addEventListener('abort', job.onAbort, { once: true })
      // abort 发生在入队阶段（`reserveRenderSlot` 内部已按取消处理）⇒ 直接结算，不再等槽位。
      if (signal.aborted) {
        job.settled = true
        settleAndForget(job, 'cancelled', 'render job aborted before start')
        reject(makeCanvasError('CS-GEN-207', { detail: 'render job aborted before start' }))
      }
    }
  })
}

/**
 * 三期 W6-1：客户端回写一张抽帧（PNG 字节 → 项目资产目录）。
 *
 * @returns 落盘后的同源 URL；工单不存在 / 已结算返回 `null`（路由据此回 200 幂等）。
 */
export async function recordRenderSample(
  registry: ProjectRegistry,
  jobId: string,
  frame: number,
  png: Uint8Array,
): Promise<RenderSampleResult | null> {
  const job = activeJobs.get(jobId)
  if (job === undefined || job.settled || png.length === 0) return null
  const safeFrame = Number.isFinite(frame) ? Math.max(0, Math.round(frame)) : 0
  // ⚠️ `saveLocalAssetBytes` 只按**扩展名**分类，落盘名由它自己生成（`<assetId>.png`）——
  // 这里传的 name 不进文件名。帧号的真值在 `job.samples` / 结算产物的 `frames[].frame` 里，
  // **不要**让任何调用方依赖文件名里的帧号（会静默对不上）。
  const saved = await saveLocalAssetBytes(
    registry,
    job.projectId,
    `remotion-sample-${newAssetId()}.png`,
    png,
  )
  // F-17：抽帧天生是中间产物 —— 登记进 `.transient-assets.json`，让 GC 能**单独报**出来
  // （不自动删；要清必须显式 purgeTransient）。
  await recordTransientAsset(registry.assetsDir(job.projectId), saved.assetFile)
  const sample: RenderSampleResult = { frame: safeFrame, url: saved.url }
  job.samples.push(sample)
  return sample
}

/**
 * 客户端回写成片字节：落盘（`saveLocalAssetBytes`，不 promote）+ 探测真值 + 结算。
 *
 * 探测失败（`duration: 0`）只加告警，不阻断——与 `compose_video` 对探测的宽容口径一致。
 */
export async function commitRenderJob(
  registry: ProjectRegistry,
  jobId: string,
  input: CommitRenderInput,
): Promise<CommitRenderResult> {
  const job = activeJobs.get(jobId)
  if (job === undefined || job.settled) {
    throw makeCanvasError('CS-RENDER-002', {
      message: '渲染工单不存在或已结束（可能已超时 / 被取消）。',
      detail: `unknown jobId ${jobId}`,
    })
  }
  if (input.bytes.length === 0) {
    throw makeCanvasError('CS-USER-ERR', { message: '渲染产物为空，请重试。', detail: 'empty render bytes' })
  }
  const saved = await saveLocalAssetBytes(registry, job.projectId, `remotion-${newAssetId()}.mp4`, input.bytes)
  const info = await probeMediaInfo(join(registry.assetsDir(job.projectId), saved.assetFile))
  const warnings = [...(input.warnings ?? [])]
  if (info.duration <= 0) warnings.push('未能探测成片真实时长（ffprobe 不可用或产物不可识别）。')

  // F-01：结算前取一次快照（结算会把它从工单表摘掉）。
  const diagnostics = diagnosticsOf(job, 'ok')
  job.settled = true
  settleAndForget(job, 'succeeded')
  const frames = [...job.samples].sort((a, b) => a.frame - b.frame)
  const report: RenderJobReport = {
    // 宿主侧已知的字段（质量档 / 帧数 / 真实字节数 / 真实分辨率）优先；
    // 客户端上报的耗时与码率只填宿主测不到的项。
    quality: job.quality,
    frames: Math.max(1, Math.round(job.manifest.meta.durationInFrames)),
    totalMs: input.report?.totalMs ?? 0,
    prepareMs: input.report?.prepareMs ?? 0,
    renderMs: input.report?.renderMs ?? 0,
    msPerFrame: input.report?.msPerFrame ?? 0,
    encodeDoneAtMs: input.report?.encodeDoneAtMs ?? 0,
    bytes: input.bytes.length,
    bitrateKbps: input.report?.bitrateKbps ?? 0,
    width: info.width ?? input.report?.width ?? 0,
    height: info.height ?? input.report?.height ?? 0,
    sampledFrames: frames.length,
    // OPT-11：音频平台保证随报告回传 —— agent 拿 `audibleSources=0` 就不必再做
    // ffprobe 采电平之类的自行验证（真机实证的重复成本）。
    audio: summarizeManifestAudio(job.manifest),
  }
  const outcome: RenderJobOutcome = {
    url: saved.url,
    assetFile: saved.assetFile,
    duration: info.duration,
    warnings,
    quality: job.quality,
    frames,
    report,
    job: diagnostics,
    ...(info.width !== undefined ? { width: info.width } : {}),
    ...(info.height !== undefined ? { height: info.height } : {}),
  }
  job.resolve(outcome)
  return {
    ok: true,
    url: saved.url,
    assetFile: saved.assetFile,
    duration: info.duration,
    ...(info.width !== undefined ? { width: info.width } : {}),
    ...(info.height !== undefined ? { height: info.height } : {}),
  }
}

/** 客户端撤单参数。 */
export interface CancelRenderInput {
  /** `failed: true` = 客户端渲染失败（带原因）；否则视为主动撤单（无原因）。 */
  failed?: boolean
  /** 失败原因 / 取消说明（透传到错误文案与 dev 详情）。 */
  reason?: string
}

/**
 * 客户端撤单：渲染失败（`CS-RENDER-002`）或主动取消（`CS-GEN-207`）。
 *
 * @returns 命中并结算返回 `true`；工单不存在 / 已结算返回 `false`（路由据此回 200 幂等）。
 */
export function cancelRenderJob(jobId: string, input: CancelRenderInput = {}): boolean {
  const job = activeJobs.get(jobId)
  if (job === undefined || job.settled) return false
  job.settled = true
  settleAndForget(
    job,
    input.failed === true ? 'failed' : 'cancelled',
    input.reason ?? (input.failed === true ? 'client render failed' : 'render job cancelled by client'),
  )
  if (input.failed === true) {
    job.reject(makeCanvasError('CS-RENDER-002', {
      message: input.reason ?? '客户端渲染失败，请重试。',
      detail: input.reason ?? 'client render failed',
    }))
  } else {
    job.reject(makeCanvasError('CS-GEN-207', { detail: input.reason ?? 'render job cancelled by client' }))
  }
  return true
}
