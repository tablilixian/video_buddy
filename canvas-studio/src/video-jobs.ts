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
import type { ProjectRegistry } from './projects.js'
import { DRAMA_ENDPOINTS } from './config.js'
import { executionErrorText, jobStatusOf } from './providers/drama.js'
import type { DramaJobStatus } from './providers/types.js'

/** jobs.json 文档版本（结构变更时递增；读取按缺失字段兜底）。 */
export const DRAMA_JOBS_VERSION = 1

/**
 * 任务阶段。前五个 = 后端状态机（`DramaJobStatus`）；`settled` = 本仓终态
 * （产物已下载、节点已落盘）。后三者为**终态**，恢复扫描不再跟踪。
 */
export type DramaVideoJobPhase = DramaJobStatus | 'settled'

/** 单条任务记录。`params` 是提交时的完整生成参数 JSON（恢复结算时原样重放）。 */
export interface DramaVideoJobRecord {
  readonly jobId: string
  readonly projectId: string
  readonly toolName: string
  readonly params: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly status: DramaVideoJobPhase
  /** 仅 failed 时后端给出的错误详情。 */
  readonly executionError?: string | null
  /** completed 后记录的产物（结算成功即转 settled）。 */
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
 */
export async function recordDramaJobSubmitted(
  registry: ProjectRegistry,
  projectId: string,
  input: { jobId: string; toolName: string; params: string },
): Promise<void> {
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
}

/**
 * 回写任务状态。缺记录 / 已终态时**不做事**（终态不可逆，防迟到的 in_progress
 * 把 settled 打回去）。`result` 仅在 completed 时记录。
 */
export async function updateDramaJobStatus(
  registry: ProjectRegistry,
  projectId: string,
  jobId: string,
  status: DramaVideoJobPhase,
  opts: { executionError?: string | null; result?: { filename: string; fullUrl: string } } = {},
): Promise<void> {
  const jobs = await readDramaJobs(registry, projectId)
  const index = jobs.findIndex((entry) => entry.jobId === jobId)
  if (index < 0) return
  const current = jobs[index]!
  if (isTerminalJobPhase(current.status)) return
  const next: DramaVideoJobRecord = {
    ...current,
    status,
    updatedAt: Date.now(),
    // 错误详情：本次带入就用本次的；failed 且从未记录过保持 null；非 failed 清空。
    executionError: opts.executionError !== undefined
      ? opts.executionError
      : status === 'failed' ? (current.executionError ?? null) : null,
    ...(opts.result !== undefined ? { result: opts.result } : {}),
  }
  jobs[index] = next
  await writeDramaJobs(registry, projectId, jobs)
}

/**
 * 扫描所有项目的**非终态**任务（Host 启动时的恢复输入）。
 * 单项目扫描失败（目录权限等）跳过该页，不阻断其余项目。
 */
export async function pendingDramaJobs(registry: ProjectRegistry): Promise<DramaVideoJobRecord[]> {
  const projects = await registry.list()
  const all: DramaVideoJobRecord[] = []
  for (const project of projects) {
    try {
      const jobs = await readDramaJobs(registry, project.id)
      all.push(...jobs.filter((entry) => !isTerminalJobPhase(entry.status)))
    } catch { /* 单项目读取失败不阻断扫描 */ }
  }
  return all
}

/** 恢复轮询依赖注入（由 generate.ts / host-tools 装配，避免与 generate.ts 成环）。 */
export interface DramaJobResumeDeps {
  readonly registry: ProjectRegistry
  /** 与 Drama adapter 同款任务端点请求（网络失败返 status=0，不抛）。 */
  readonly request: (method: 'GET' | 'POST', path: string) => Promise<{ status: number; json: unknown }>
  /** completed 后的产物结算（下载 + ffmpeg 实测 + 节点落盘），成功后自行把台账置 settled。 */
  readonly settle: (record: DramaVideoJobRecord, result: { filename: string; fullUrl: string }) => Promise<void>
  /** 单任务轮询间隔（毫秒），默认 30_000 —— 与 executor 内 Drama 轮询同一节奏。 */
  readonly pollIntervalMs?: number
  /** 恢复轮询的最长跟踪时长（毫秒），默认 45min（覆盖 executor 的 40min deadline）。 */
  readonly maxAgeMs?: number
}

/** 正在被恢复轮询跟踪的 jobId（供 UI 展示「后端还有几个恢复中的任务」）。 */
const activeResumeJobIds = new Set<string>()

/** 当前恢复轮询跟踪中的任务数（快照，供队列视图并入）。 */
export function activeResumeJobCount(): number {
  return activeResumeJobIds.size
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/** 从 result 响应解析产物；形状不对返回 null（不猜）。 */
function resultPayloadOf(json: unknown): { filename: string; fullUrl: string } | null {
  if (typeof json !== 'object' || json === null) return null
  const fullUrl = (json as { full_url?: unknown }).full_url
  if (typeof fullUrl !== 'string' || fullUrl.length === 0) return null
  const filename = (json as { filename?: unknown }).filename
  return typeof filename === 'string' && filename.length > 0
    ? { filename, fullUrl }
    : null
}

/** 单任务的独立轮询循环（setTimeout 链；终态或超龄退出，finally 摘除跟踪标记）。 */
async function watchDramaJob(record: DramaVideoJobRecord, deps: DramaJobResumeDeps): Promise<void> {
  const interval = deps.pollIntervalMs ?? 30_000
  const maxAgeMs = deps.maxAgeMs ?? 45 * 60_000
  const jobId = record.jobId
  activeResumeJobIds.add(jobId)
  try {
    let lastStatus: string | null = null
    for (;;) {
      if (Date.now() - record.createdAt > maxAgeMs) {
        await updateDramaJobStatus(deps.registry, record.projectId, jobId, 'failed', {
          executionError: `恢复轮询超过上限（${Math.round(maxAgeMs / 60_000)} 分钟）仍未完成，已放弃跟踪；后端任务可能仍在执行。`,
        })
        return
      }
      let snapshot: { status: number; json: unknown }
      try {
        snapshot = await deps.request('GET', `${DRAMA_ENDPOINTS.jobs}/${jobId}`)
      } catch {
        snapshot = { status: 0, json: null }
      }
      if (snapshot.status === 404) {
        await updateDramaJobStatus(deps.registry, record.projectId, jobId, 'failed', {
          executionError: '后端不存在该任务（404，可能因后端重启被清空）。',
        })
        return
      }
      const status = jobStatusOf(snapshot.json)
      if (status !== null && status !== lastStatus) {
        lastStatus = status
        await updateDramaJobStatus(
          deps.registry,
          record.projectId,
          jobId,
          status,
          status === 'failed' ? { executionError: executionErrorText(snapshot.json) ?? null } : {},
        )
      }
      if (status === 'completed') {
        let result: { status: number; json: unknown }
        try {
          result = await deps.request('GET', `${DRAMA_ENDPOINTS.jobs}/${jobId}/result`)
        } catch {
          result = { status: 0, json: null }
        }
        const payload = result.status === 200 ? resultPayloadOf(result.json) : null
        if (payload !== null) {
          await updateDramaJobStatus(deps.registry, record.projectId, jobId, 'completed', { result: payload })
          try {
            await deps.settle({ ...record, status: 'completed', result: payload }, payload)
            return
          } catch {
            // 结算失败（磁盘 / 网络抖动）：台账保持 completed，下一轮重试结算。
          }
        }
        // 202 / 5xx / 形状不对：下一轮重取（状态已是 completed，不再重复回写）。
      }
      if (status === 'failed' || status === 'cancelled') return
      await sleep(interval)
    }
  } finally {
    activeResumeJobIds.delete(jobId)
  }
}

/**
 * 启动恢复轮询（Host 装配时调用一次）：扫描所有项目的非终态任务，逐个起独立
 * 循环。**扫描即快照**——之后新提交的任务由该次工具调用自己负责，不再入册。
 * 返回停止函数（测试用；产品进程随 Host 生命周期）。
 */
export function startDramaJobResumeWatcher(deps: DramaJobResumeDeps): { stop: () => void } {
  const timers = new Set<ReturnType<typeof setTimeout>>()
  void pendingDramaJobs(deps.registry)
    .then((jobs) => {
      for (const record of jobs) {
        if (activeResumeJobIds.has(record.jobId)) continue
        const timer = setTimeout(() => {
          timers.delete(timer)
          void watchDramaJob(record, deps).catch(() => {
            // 单任务恢复失败不影响其余任务；终态由下一轮扫描（重启）兜底。
          })
        }, 0)
        timers.add(timer)
      }
    })
    .catch(() => { /* 扫描失败（registry 不可读）：本次不恢复，任务仍留台账 */ })
  return {
    stop: () => {
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    },
  }
}
