/**
 * Drama 异步视频任务台账（每项目 `jobs.json`）+ Host 侧恢复轮询（后端 0.5.0）。
 *
 * ## 为什么需要
 *
 * `image2videofl2va` / `image2videoref2va` 改异步后，`job_id` 是取回产物的唯一凭据。
 * 生成期间客户端（连同 Host 进程）可能重启 —— 进程一死 executor 的轮询循环就没了，
 * ComfyUI 侧任务却还在跑。没有台账 = 任务完成也没人取，孤儿任务白占队列。
 *
 * 本模块做两件事：
 *  ① **落地**：提交拿到 `job_id` 立即写进 `<项目目录>/jobs.json`（generate.ts 经
 *     ProviderContext 的 `onSubmitted` / `onJobUpdate` 钩子调用），状态机流转
 *     （pending → in_progress → completed/failed/cancelled → settled）持续回写，
 *     任何时刻读文件都能拿到每个任务的真实状态。
 *  ② **恢复**：Host 启动时扫描所有项目的非终态任务（`startDramaJobResumeWatcher`），
 *     每个任务起**独立的 30s 轮询循环**（与 executor 内的轮询同一节奏，任务之间互不
 *     干扰）；`completed` 后交给注入的 `settle`（generate.ts 的共享结算：下载 →
 *     ffmpeg 实测 → 画布节点落盘）；`failed` / `cancelled` / 404 落终态；瞬时错误
 *     （网络抖动 / 5xx）容忍到 `maxAgeMs` 上限。
 *
 * ## 边界（刻意不做的事）
 *
 * - **不碰 canvas.json**：生成中的任务不提前写半成品节点（渲染层无需感知
 *   「无 url 的视频节点」）。重启后到结算前画布上看不到它——这与「占位节点本是
 *   内存态、重启即失」的现状一致；结算完成节点落盘，严格优于「任务直接丢失」。
 * - **不与在跑的生成去重**：watcher 只在 Host 启动时扫描一次，此后的新任务由
 *   该次工具调用的 executor 自带轮询负责，两条路径不会同时跟踪同一个 job。
 * - **终态记录保留**：settled / failed 记录不删（体量极小），供排查与状态查询。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { sharedWriteQueue } from './keyed-queue.js'
import type { ProjectRegistry } from './projects.js'
import type { DramaJobStatus } from './providers/types.js'

/** jobs.json 文档版本（结构变更时递增；读取按缺失字段兜底）。 */
export const DRAMA_JOBS_VERSION = 1

/**
 * 任务阶段。前五个 = 后端状态机（`DramaJobStatus`）；`settled` = 本仓终态
 * （产物已下载、节点已落盘）。后三者为**终态**，恢复扫描不再跟踪。
 */
export type DramaVideoJobPhase = DramaJobStatus | 'settled'

/** 幂等意图（迁移 B3-3：创建前落台账，响应丢失时按原 key+body 重放）。 */
export interface GenerationIntentRecord {
  readonly key: string
  readonly body: unknown
  readonly clientRunId?: string
  readonly fingerprint?: string
  readonly createdAt?: string
}

/**
 * 单条任务记录。`params` 是提交时的完整生成参数 JSON（恢复结算时原样重放）。
 *
 * **台账 v2（迁移 B3-3）**：`api: 'business'` 记录走新业务 API（jobId = generation
 * UUID，version 为轮询游标，intent 为幂等重放凭据）；`api` 缺省 = v1 旧记录
 * （8082 后端的 ComfyUI prompt_id）——**原样保留、不处置**（拍板 2026-11-22：
 * 恢复扫描跳过、不落终态、不删除；旧端口已废弃，这些任务不再被跟踪）。
 */
export interface DramaVideoJobRecord {
  readonly jobId: string
  readonly projectId: string
  readonly toolName: string
  readonly params: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly status: DramaVideoJobPhase
  /** 台账代：缺省 = v1（legacy 8082）；'business' = 新业务 API。 */
  readonly api?: 'legacy' | 'business'
  /** 轮询游标（business 记录：/poll 的 version）。 */
  readonly version?: number
  /** business 记录的幂等意图（创建响应丢失时的重放凭据）。 */
  readonly intent?: GenerationIntentRecord
  /** 仅 failed 时后端给出的错误详情。 */
  readonly executionError?: string | null
  /** completed 后记录的产物（legacy：full_url 形态；结算成功即转 settled）。 */
  readonly result?: { readonly filename: string; readonly fullUrl: string }
}

interface DramaJobsDocument {
  version: number
  jobs: DramaVideoJobRecord[]
}

/** 终态判定：恢复扫描与状态回写共用（终态不可被再次改写）。 */
export function isTerminalJobPhase(status: DramaVideoJobPhase): boolean {
  return status === 'failed' || status === 'cancelled' || status === 'settled'
}

/** 某项目的台账文件路径（与 canvas.json / skills.json 同级）。 */
export function dramaJobsFileOf(registry: ProjectRegistry, projectId: string): string {
  return join(registry.projectDir(projectId), 'jobs.json')
}

/** 读台账；文件缺失或损坏一律回空表（台账是恢复凭据，不是阻塞项）。 */
export async function readDramaJobs(registry: ProjectRegistry, projectId: string): Promise<DramaVideoJobRecord[]> {
  let text: string
  try {
    text = await readFile(dramaJobsFileOf(registry, projectId), 'utf8')
  } catch {
    return []
  }
  try {
    const document = JSON.parse(text) as Partial<DramaJobsDocument>
    return Array.isArray(document.jobs) ? document.jobs : []
  } catch {
    return []
  }
}

async function writeDramaJobs(
  registry: ProjectRegistry,
  projectId: string,
  jobs: readonly DramaVideoJobRecord[],
): Promise<void> {
  const document: DramaJobsDocument = { version: DRAMA_JOBS_VERSION, jobs: [...jobs] }
  await writeFileAtomic(dramaJobsFileOf(registry, projectId), `${JSON.stringify(document, null, 2)}\n`, {
    mode: 0o600,
    dirMode: 0o700,
  })
}

/**
 * 提交成功即落台账（按 jobId upsert；已存在则只刷 updatedAt，不回退状态）。
 * 在进入轮询**之前**调用——这是「客户端重启后还能续上」的凭据。
 *
 * **AR-04**：读-改-写整体入队（key = 台账文件路径）。修复前并发 5 次只剩 1 条，
 * 而台账丢失 = 那条视频的产物**永远不会被取回**（没人知道要取哪个 job）。
 */
export async function recordDramaJobSubmitted(
  registry: ProjectRegistry,
  projectId: string,
  input: { jobId: string; toolName: string; params: string },
): Promise<void> {
  return sharedWriteQueue.run(dramaJobsFileOf(registry, projectId), async () => {
    const jobs = await readDramaJobs(registry, projectId)
    const existing = jobs.find((entry) => entry.jobId === input.jobId)
    if (existing !== undefined) return
    const now = Date.now()
    jobs.push({
      jobId: input.jobId,
      projectId,
      toolName: input.toolName,
      params: input.params,
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    })
    await writeDramaJobs(registry, projectId, jobs)
  })
}

/**
 * 【台账 v2】创建**前**落 intent（业务 API 记录；jobId 暂用幂等键占位，202 后由
 * {@link recordGenerationSubmitted} 补 generationId）。**必须先于 POST 调用**——
 * 响应丢失时这是「按原 key+body 重放」的唯一凭据（api(12).md §6.8 幂等纪律）。
 * AR-04 同款：读-改-写入共享串行队列。
 */
export async function recordGenerationIntent(
  registry: ProjectRegistry,
  projectId: string,
  input: { intent: GenerationIntentRecord; toolName: string; params: string },
): Promise<void> {
  return sharedWriteQueue.run(dramaJobsFileOf(registry, projectId), async () => {
    const jobs = await readDramaJobs(registry, projectId)
    const existing = jobs.find((entry) => entry.jobId === input.intent.key)
    if (existing !== undefined) return
    const now = Date.now()
    jobs.push({
      jobId: input.intent.key,
      projectId,
      toolName: input.toolName,
      params: input.params,
      createdAt: now,
      updatedAt: now,
      status: 'pending',
      api: 'business',
      intent: input.intent,
    })
    await writeDramaJobs(registry, projectId, jobs)
  })
}

/**
 * 【台账 v2】创建成功（202）后补 generationId / version：按幂等键定位占位记录，
 * 把 jobId 换成 generation UUID（后续轮询/结算/取消的唯一凭据）。
 */
export async function recordGenerationSubmitted(
  registry: ProjectRegistry,
  projectId: string,
  input: { intentKey: string; generationId: string; version?: number },
): Promise<void> {
  return sharedWriteQueue.run(dramaJobsFileOf(registry, projectId), async () => {
    const jobs = await readDramaJobs(registry, projectId)
    const index = jobs.findIndex((entry) => entry.jobId === input.intentKey)
    if (index < 0) return
    const current = jobs[index]!
    if (current.api !== 'business') return
    jobs[index] = { ...current, jobId: input.generationId, ...(input.version !== undefined ? { version: input.version } : {}), updatedAt: Date.now() }
    await writeDramaJobs(registry, projectId, jobs)
  })
}

/** 业务状态机 → 台账 phase（§6.9.3；cancel_requested 是等待收敛，不是终态）。 */
export function businessStatusToPhase(status: string): DramaVideoJobPhase | null {
  switch (status) {
    case 'created':
    case 'credit_held':
    case 'queued':
      return 'pending'
    case 'submitted':
    case 'running':
    case 'finalizing':
    case 'cancel_requested':
      return 'in_progress'
    case 'succeeded':
      return 'completed'
    case 'failed':
    case 'timeout':
      return 'failed'
    case 'canceled':
      return 'cancelled'
    default:
      return null
  }
}

/**
 * 【台账 v2】按 /poll 快照增量回写（状态 + version 游标 + 错误详情）。
 * 与 {@link updateDramaJobStatus} 同队列同纪律；缺记录 / 已终态不做事。
 */
export async function updateGenerationSnapshot(
  registry: ProjectRegistry,
  projectId: string,
  generationId: string,
  snapshot: { status: string; version?: number; error?: { code: string; message: string } | null },
): Promise<void> {
  const phase = businessStatusToPhase(snapshot.status)
  if (phase === null) return
  const detail = snapshot.error !== undefined && snapshot.error !== null ? `${snapshot.error.code}: ${snapshot.error.message}` : null
  await updateDramaJobStatus(registry, projectId, generationId, phase, {
    ...(detail !== null ? { executionError: detail } : {}),
    ...(snapshot.version !== undefined ? { version: snapshot.version } : {}),
  } as Parameters<typeof updateDramaJobStatus>[4])
}

/**
 * 回写任务状态。缺记录 / 已终态时**不做事**（终态不可逆，防迟到的 in_progress
 * 把 settled 打回去）。`result` 仅在 completed 时记录。
 *
 * **AR-04**：与 `recordDramaJobSubmitted` 同一条队列（同文件），否则一次提交与
 * 一次状态回写交错时会丢掉状态更新。
 */
export async function updateDramaJobStatus(
  registry: ProjectRegistry,
  projectId: string,
  jobId: string,
  status: DramaVideoJobPhase,
  opts: { executionError?: string | null; result?: { filename: string; fullUrl: string }; version?: number } = {},
): Promise<void> {
  return sharedWriteQueue.run(dramaJobsFileOf(registry, projectId), async () => {
    const jobs = await readDramaJobs(registry, projectId)
    const index = jobs.findIndex((entry) => entry.jobId === jobId)
    if (index < 0) return
    const current = jobs[index]!
    if (isTerminalJobPhase(current.status)) return
    const next: DramaVideoJobRecord = {
      ...current,
      status,
      ...(opts.version !== undefined ? { version: opts.version } : {}),
      updatedAt: Date.now(),
      // 错误详情：本次带入就用本次的；failed 且从未记录过保持 null；非 failed 清空。
      executionError: opts.executionError !== undefined
        ? opts.executionError
        : status === 'failed' ? (current.executionError ?? null) : null,
      ...(opts.result !== undefined ? { result: opts.result } : {}),
    }
    jobs[index] = next
    await writeDramaJobs(registry, projectId, jobs)
  })
}

/**
 * 扫描所有项目的**非终态 business 任务**（Host 启动时的恢复输入）。
 * 拍板 ③（2026-11-22）：v1 旧记录（api 缺省，挂在已废弃的 8082 上）**原样保留、
 * 不处置**——恢复扫描跳过、不落终态、不删除；对应画布节点不会落盘（用户知情）。
 * 单项目扫描失败（目录权限等）跳过该页，不阻断其余项目。
 */
export async function pendingDramaJobs(registry: ProjectRegistry): Promise<DramaVideoJobRecord[]> {
  const projects = await registry.list()
  const all: DramaVideoJobRecord[] = []
  for (const project of projects) {
    try {
      const jobs = await readDramaJobs(registry, project.id)
      all.push(...jobs.filter((entry) => entry.api === 'business' && !isTerminalJobPhase(entry.status)))
    } catch { /* 单项目读取失败不阻断扫描 */ }
  }
  return all
}

/** 恢复依赖注入（迁移 B3-3：business 记录由 generate.ts 供给的恢复闭包全权处理）。 */
export interface DramaJobResumeDeps {
  readonly registry: ProjectRegistry
  /**
   * business 记录的**完整恢复**：轮询到终态 → 下载产物 → 节点落盘 → 台账置 settled
   *（generate.ts 闭包：engine + persistGeneratedAsset 共享结算）。无 generationId 的
   * 记录（intent 占位）在闭包内按原 key+body 重放创建。抛错 = 本轮恢复失败（下轮
   * 扫描兜底），watcher 只记日志不中断其余任务。
   */
  readonly resumeBusiness: (record: DramaVideoJobRecord) => Promise<void>
  /** 恢复轮询的最长跟踪时长（毫秒），默认 45min（超过后落 failed，防永久悬挂）。 */
  readonly maxAgeMs?: number
}

/** 正在被恢复轮询跟踪的 jobId（供 UI 展示「后端还有几个恢复中的任务」）。 */
const activeResumeJobIds = new Set<string>()

/** 当前恢复轮询跟踪中的任务数（快照，供队列视图并入）。 */
export function activeResumeJobCount(): number {
  return activeResumeJobIds.size
}

/**
 * 单任务的恢复（迁移 B3-3）：整段跟踪委托给注入的 `resumeBusiness`（engine 长轮询
 * + 结算），watcher 只管超龄兜底与在册标记。
 */
async function watchDramaJob(
  record: DramaVideoJobRecord,
  deps: DramaJobResumeDeps,
  signal: AbortSignal,
): Promise<void> {
  const maxAgeMs = deps.maxAgeMs ?? 45 * 60_000
  activeResumeJobIds.add(record.jobId)
  try {
    try {
      await deps.resumeBusiness(record)
      return
    } catch (cause) {
      if (signal.aborted) return
      // 超龄兜底：恢复闭包自身的超时/终态失败会带 CS 码进来；这里只对「还在转」
      // 的记录按台账时间判超龄（跟随引擎有自己的墙钟，正常不会走到这里）。
      if (Date.now() - record.createdAt > maxAgeMs) {
        await updateDramaJobStatus(deps.registry, record.projectId, record.jobId, 'failed', {
          executionError: `恢复跟踪超过上限（${Math.round(maxAgeMs / 60_000)} 分钟）仍未完成，已放弃；任务可能仍在后台执行。`,
        })
        return
      }
      // 瞬时失败：台账保持非终态，下一轮 Host 重启扫描兜底；本次恢复结束。
      return
    }
  } finally {
    activeResumeJobIds.delete(record.jobId)
  }
}
/**
 * 启动恢复轮询（Host 装配时调用一次）：扫描所有项目的非终态任务，逐个起独立
 * 循环。**扫描即快照**——之后新提交的任务由该次工具调用自己负责，不再入册。
 *
 * 返回停止函数：`stop()` 会 **abort 全部在跑循环**（AR-05 修正）+ 清掉尚未启动的
 * 定时器，并**等它们真正退出后才 resolve**。
 *
 * 为什么要等（2026-11-05 实测）：`stop()` 原先 fire-and-forget 立即返回，但
 * `watchDramaJob` 的 `activeResumeJobIds` 是模块级集合 —— 同一 jobId 的上一条循环
 * 若还没从 `finally` 里摘掉，紧接着启动的新 watcher 会在扫描阶段被 `continue` 跳过，
 * 于是「新 watcher 在等一个永远不会写自己目录的旧循环」→ 测试在全量并发的墙钟压力下
 * 偶发超时（表现为 `恢复轮询：failed 落终态` 这类假红）。生产侧同一 jobId 不会二次
 * 启动，所以只有在测试里暴露；但语义上「stop 之后还继续写台账」本身就是 bug。
 */
export function startDramaJobResumeWatcher(deps: DramaJobResumeDeps): { stop: () => Promise<void> } {
  const controller = new AbortController()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  /** 在跑的循环 + 尚未跑完的首次扫描：`stop()` 等它们全部落地。 */
  const inflight = new Set<Promise<void>>()
  const track = (task: Promise<void>): void => {
    // 单任务恢复失败不影响其余任务；终态由下一轮扫描（重启）兜底。扫描失败同理。
    const guarded = task.catch(() => {})
    inflight.add(guarded)
    void guarded.then(() => inflight.delete(guarded))
  }
  track(pendingDramaJobs(deps.registry).then((jobs) => {
    if (controller.signal.aborted) return
    for (const record of jobs) {
      if (activeResumeJobIds.has(record.jobId)) continue
      const timer = setTimeout(() => {
        timers.delete(timer)
        if (controller.signal.aborted) return
        track(watchDramaJob(record, deps, controller.signal))
      }, 0)
      timers.add(timer)
    }
  }))
  return {
    stop: async () => {
      // 先 abort（让已进入循环的任务在下一次检查点退出），再清未启动的定时器。
      controller.abort()
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      // abort 后不会再有新任务入册（定时器回调与扫描都先查 signal），循环必然收敛。
      while (inflight.size > 0) await Promise.all([...inflight])
    },
  }
}
