/**
 * CV-246 / BUG-006：生成产物历史登记（`<项目>/assets/history.json`）。
 *
 * 为什么需要：产物全部落 `assets/`（`UUID.ext` 形态，文件名无语义），canvas.json
 * 只登记画布上的节点——节点删除/被取代后线索即断，产物沦为「无主文件」（打开
 * 项目就会被 CV-243 的 GC 当孤儿清掉）。本模块在**每个产物落盘点**顺手记账：
 * 文件名、类型、来源工具、时间、体积——历史面板据此回溯，用户删除则走
 * 「标记 deletedAt + 移入 .trash」的两段式（与 CV-243 同语义）。
 *
 * 与 GC 的契约（asset-gc.ts）：**未删条目（无 deletedAt）的文件受保护**——根目录
 * 孤儿判定与 .trash 物理清都要避开；只有用户在面板显式删除（deletedAt 落库）后，
 * GC 才会物理清并剪掉条目。登记表是「有人想要的」事实源，GC 是「没人要的」执行者。
 *
 * 放 assets/（registry 对外暴露的最深目录）；写入经模块级串行队列（与
 * reference-manifest 同模式，防并发撕档）；文件缺失/损坏按空表起底——登记表是
 * 回溯加速器，丢了只影响历史面板的完整性，不影响任何主流程。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectRegistry } from './projects.js'

export type AssetHistoryKind = 'image' | 'video' | 'audio' | 'file'

export interface AssetHistoryEntry {
  /** assets 根下文件名（同 url basename）。 */
  file: string
  kind: AssetHistoryKind
  /** 来源工具名（`upload` / 生成工具 / `compose` / `cut_audio`）。 */
  tool: string
  /** 人话标题（Host 端映射一次成型，客户端不再各猜一份）。 */
  label: string
  /** 落盘时刻（epoch ms）。 */
  createdAt: number
  /** 字节数（落盘点已知时写入；未知省略）。 */
  size?: number
  /** 面板删除时刻。有值 = 用户已放弃，GC 可物理清 + 剪条目。 */
  deletedAt?: number
}

export interface AssetHistoryFile {
  version: 1
  entries: AssetHistoryEntry[]
}

function historyFileOf(registry: ProjectRegistry, projectId: string): string {
  return join(registry.assetsDir(projectId), 'history.json')
}

/** history 读改写串行链：同进程内绝不并发撕档（与 reference-manifest 同模式）。 */
let historyQueue: Promise<unknown> = Promise.resolve()

/** 扩展名 → 产物类型（记账时的唯一派生点）。 */
export function kindOfExtension(ext: string): AssetHistoryKind {
  const e = ext.replace(/^\./, '').toLowerCase()
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(e)) return 'image'
  if (['mp4', 'mov', 'webm', 'mkv'].includes(e)) return 'video'
  if (['mp3', 'wav', 'm4a', 'flac', 'ogg', 'aac'].includes(e)) return 'audio'
  return 'file'
}

/** 工具名 → 人话标题（唯一映射点；新工具漏登记时兜底展示原 tool 名）。 */
export function labelOfTool(tool: string): string {
  const table: Record<string, string> = {
    upload: '上传文件',
    video_generate: '视频生成',
    image_generate: '图像生成',
    image2image: '图像生成',
    txt2image: '图像生成',
    image_fix: '图内文字修复',
    character: '角色四视图',
    music_generation: '音乐生成',
    compose: '成片合成',
    video_composite: '成片合成',
    cut_audio: '音频裁切',
  }
  return table[tool] ?? tool
}

/** 读登记表（缺失/损坏按空表起底）。 */
export async function loadAssetHistory(
  registry: ProjectRegistry,
  projectId: string,
): Promise<AssetHistoryFile> {
  try {
    const parsed = JSON.parse(await readFile(historyFileOf(registry, projectId), 'utf8')) as AssetHistoryFile
    if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.entries)) {
      return { version: 1, entries: parsed.entries }
    }
  } catch {
    // 缺失/损坏按空表起底。
  }
  return { version: 1, entries: [] }
}

export interface AssetHistoryInput {
  file: string
  tool: string
  size?: number
}

/**
 * 产物落盘后记账（幂等：同 file 已有未删条目则跳过）。
 * 内部走串行队列；绝不抛错——记账失败不阻断生成主流程（调用方 try/catch 兜底）。
 */
export async function recordAssetHistory(
  registry: ProjectRegistry,
  projectId: string,
  input: AssetHistoryInput,
): Promise<void> {
  const run = historyQueue.then(async () => {
    const history = await loadAssetHistory(registry, projectId)
    const existing = history.entries.find((entry) => entry.file === input.file && entry.deletedAt === undefined)
    if (existing !== undefined) return
    const ext = input.file.includes('.') ? input.file.split('.').pop() ?? '' : ''
    history.entries.push({
      file: input.file,
      kind: kindOfExtension(ext),
      tool: input.tool,
      label: labelOfTool(input.tool),
      createdAt: Date.now(),
      ...(input.size !== undefined ? { size: input.size } : {}),
    })
    await writeFile(historyFileOf(registry, projectId), `${JSON.stringify(history, null, 2)}\n`, 'utf8')
  })
  historyQueue = run.catch(() => {})
  await run
}

/**
 * 面板删除：标记 deletedAt（文件移入 .trash 由调用方完成，本模块只管账）。
 * 经同一条串行队列，与记账互不撕档。
 */
export async function markHistoryDeleted(
  registry: ProjectRegistry,
  projectId: string,
  file: string,
): Promise<void> {
  const run = historyQueue.then(async () => {
    const history = await loadAssetHistory(registry, projectId)
    const entry = history.entries.find((candidate) => candidate.file === file && candidate.deletedAt === undefined)
    if (entry === undefined) return
    entry.deletedAt = Date.now()
    await writeFile(historyFileOf(registry, projectId), `${JSON.stringify(history, null, 2)}\n`, 'utf8')
  })
  historyQueue = run.catch(() => {})
  await run
}

/**
 * 未删条目的文件名集合（GC 保护名单）。纯读，不排队。
 */
export async function collectProtectedBasenames(
  registry: ProjectRegistry,
  projectId: string,
): Promise<Set<string>> {
  const history = await loadAssetHistory(registry, projectId)
  const names = new Set<string>()
  for (const entry of history.entries) {
    if (entry.deletedAt === undefined) names.add(entry.file)
  }
  return names
}

/**
 * GC 后剪枝：文件在根目录与 .trash 都已不存在的条目移除（物理清的收尾）。
 * 经同一条串行队列。
 */
export async function pruneHistory(
  registry: ProjectRegistry,
  projectId: string,
  keepFile: (file: string) => boolean,
): Promise<void> {
  const run = historyQueue.then(async () => {
    const history = await loadAssetHistory(registry, projectId)
    const next = history.entries.filter((entry) => keepFile(entry.file))
    if (next.length === history.entries.length) return
    await writeFile(
      historyFileOf(registry, projectId),
      `${JSON.stringify({ version: 1 as const, entries: next }, null, 2)}\n`,
      'utf8',
    )
  })
  historyQueue = run.catch(() => {})
  await run
}
