/**
 * CV-243 / BUG-005：项目资产废料回收（回收站 + 打开项目 GC）。
 *
 * 两段式：
 *   1. **trash（删除时）**：画布保存路由拿到 `removedIds` 后，把「剩余节点引用集合
 *      不再包含」的文件 rename 进 `<项目>/assets/.trash/`——不物理删，undo / 粘贴
 *      共享 / 生成中引用三个竞态全部免疫（详见 docs/plans/资产废料回收方案.md）。
 *   2. **GC（打开项目自动 / `POST /canvas-studio/asset-gc` 手动）**：
 *      ① 引用集合内但落在 trash 的文件 → 移回根目录（undo 恢复 + 已保存的场景）；
 *      ② trash 其余文件 → 物理删除（undo 不跨会话，绝对安全）；
 *      ③ 根目录孤儿（历史遗留，如 compose 自定义命名的 mix 文件）→ 物理删除；
 *      ④ reference-manifest 剪枝（指向已不存在文件的映射条目）。
 *
 * 引用判据是**文件名**（节点 url 的 basename）而非节点 id——`pasteNodes` 复制节点
 * 保留原 url，两个节点共享同一磁盘文件，按 id 判会误删共享文件。
 *
 * 本模块刻意只依赖 ProjectRegistry 的目录方法与 canvas 读取——文件操作集中在
 * 这里一处，删除/回收语义只有一个实现（CV-116 式收口）。
 */
import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import { ASSET_TRASH_DIR } from './config.js'
import type { ProjectRegistry } from './projects.js'
import type { StudioCanvasDocument, StudioCanvasNode } from './contracts/canvas.js'
import { pruneReferenceManifest } from './generate.js'
import { collectProtectedBasenames, pruneHistory } from './asset-history.js'

/** 合法资产文件名（与 promoteAssetFile 的防路径穿越判据同源）。 */
const ASSET_FILE_RE = /^[A-Za-z0-9._-]+$/u

/** url → 磁盘文件名（basename）。非本地资产 url（理论不存在）返回 null。 */
function basenameOfUrl(url: string): string | null {
  const name = url.split('/').pop() ?? ''
  return name.length > 0 && ASSET_FILE_RE.test(name) ? name : null
}

/**
 * 画布文档引用的资产文件名集合（去重）。纯函数。
 * 判据是 url basename：粘贴共享、export 成片挂节点，全部天然覆盖。
 */
export function collectReferencedBasenames(
  doc: Pick<StudioCanvasDocument, 'nodes'>,
): Set<string> {
  const names = new Set<string>()
  for (const node of doc.nodes as readonly StudioCanvasNode[]) {
    if (node.url === undefined) continue
    const name = basenameOfUrl(node.url)
    if (name !== null) names.add(name)
  }
  return names
}

function trashDirOf(registry: ProjectRegistry, projectId: string): string {
  return join(registry.assetsDir(projectId), ASSET_TRASH_DIR)
}

/**
 * 删除节点后的 trash 步骤（画布保存路由在 `writeCanvas` 之后调用）。
 *
 * @param removedIds - 本次保存显式删除的节点 id（CV-242 协议）。
 * @param beforeNodes - 保存**前**的节点表（被删节点的 url 只在这里拿得到）。
 *
 * 对每个被删节点的文件：当前文档（保存后）的引用集合不含其 basename → 移入
 * `.trash/`。源文件不存在（节点本就无文件 / 已被清过）静默跳过——trash 是
 * 维护操作，绝不反向阻塞保存。
 */
export async function trashAssetsForRemovedNodes(
  registry: ProjectRegistry,
  projectId: string,
  removedIds: readonly string[],
  beforeNodes: readonly StudioCanvasNode[],
): Promise<number> {
  if (removedIds.length === 0) return 0
  const removedIdSet = new Set(removedIds)
  const candidates = new Set<string>()
  for (const node of beforeNodes) {
    if (!removedIdSet.has(node.id) || node.url === undefined) continue
    const name = basenameOfUrl(node.url)
    if (name !== null) candidates.add(name)
  }
  if (candidates.size === 0) return 0
  const nextDoc = await registry.readCanvas(projectId)
  const referenced = collectReferencedBasenames(nextDoc)
  const trashed: string[] = []
  const assetsDir = registry.assetsDir(projectId)
  await mkdir(trashDirOf(registry, projectId), { recursive: true })
  for (const name of candidates) {
    if (referenced.has(name)) continue
    try {
      await rename(join(assetsDir, name), join(trashDirOf(registry, projectId), name))
      trashed.push(name)
    } catch (error) {
      // 源不存在 = 无可回收（节点本就没有本地文件）；其余错误同样不阻塞保存。
      continue
    }
  }
  if (trashed.length > 0) {
    const trashedSet = new Set(trashed)
    await pruneReferenceManifest(registry, projectId, (assetFile) => !trashedSet.has(assetFile))
  }
  return trashed.length
}

/** GC 结果计数（供路由响应与日志）。 */
export interface AssetGcResult {
  /** 从 .trash 移回根目录的文件数（仍被引用，undo 恢复场景）。 */
  restored: number
  /** 从 .trash 物理删除的文件数。 */
  purged: number
  /** 根目录孤儿（历史遗留）物理删除的文件数。 */
  orphansRemoved: number
}

/**
 * 打开项目 GC（自动触发 + `POST /canvas-studio/asset-gc` 手动兜底）。
 * 见模块头注释的 ①~⑤；`reference-manifest.json` 与 `history.json` 不在清理
 * 范围（结构文件），死映射条目分别由第 ④⑤ 步剪枝。
 *
 * CV-246：**历史登记表（history.json）的未删条目是保护名单**——用户还没在
 * 历史面板放弃的产物，即使画布已不引用（根目录孤儿 / 已进 .trash），GC 都
 * 不物理清；只有面板显式删除（deletedAt 落库）后才随 GC 走完清理闭环。
 */
export async function gcProjectAssets(
  registry: ProjectRegistry,
  projectId: string,
): Promise<AssetGcResult> {
  const result: AssetGcResult = { restored: 0, purged: 0, orphansRemoved: 0 }
  const doc = await registry.readCanvas(projectId)
  const referenced = collectReferencedBasenames(doc)
  // CV-246：并入历史保护名单——「画布引用 ∪ 历史未删条目」都不动。
  const protectedNames = await collectProtectedBasenames(registry, projectId)
  const assetsDir = registry.assetsDir(projectId)
  const trashDir = trashDirOf(registry, projectId)
  let entries: Dirent[]
  try {
    entries = await readdir(assetsDir, { withFileTypes: true })
  } catch {
    return result // 项目 assets 目录还没建：无可回收
  }
  const rootFiles = new Set<string>()
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (entry.name === 'reference-manifest.json') continue
    if (entry.name === 'history.json') continue
    rootFiles.add(entry.name)
  }
  // ③ 根目录孤儿（历史遗留）：画布不引用 **且** 历史未保护 → 物理删除。
  for (const name of rootFiles) {
    if (referenced.has(name) || protectedNames.has(name)) continue
    try {
      await rm(join(assetsDir, name))
      result.orphansRemoved += 1
    } catch {
      continue
    }
  }
  // ①② trash：仍被画布引用的移回根目录；画布不引用 **且** 历史未保护的物理
  // 删除；历史保护但未被画布引用的**留在 .trash**（回活会成为下次孤儿；面板
  // 预览走资产路由的 .trash fallback，不受影响）。
  let trashEntries: Dirent[]
  try {
    trashEntries = await readdir(trashDir, { withFileTypes: true })
  } catch {
    trashEntries = [] // 无 .trash 目录：跳过 ①②
  }
  // trash 名单快照（第 ⑤ 步剪枝用）：物理清时同步剔除，保证剪枝判据是
  // 「清理后真实还存在的文件」而不是清理前的旧快照。
  const trashNames = new Set(
    trashEntries.filter((entry) => entry.isFile() && ASSET_FILE_RE.test(entry.name)).map((entry) => entry.name),
  )
  for (const entry of trashEntries) {
    if (!entry.isFile() || !ASSET_FILE_RE.test(entry.name)) continue
    if (referenced.has(entry.name) && !rootFiles.has(entry.name)) {
      try {
        await rename(join(trashDir, entry.name), join(assetsDir, entry.name))
        rootFiles.add(entry.name)
        trashNames.delete(entry.name)
        result.restored += 1
      } catch {
        continue
      }
    } else if (!protectedNames.has(entry.name)) {
      try {
        await rm(join(trashDir, entry.name))
        trashNames.delete(entry.name)
        result.purged += 1
      } catch {
        continue
      }
    }
  }
  // ④ manifest 剪枝：映射指向的资产文件已不在根目录 → 条目删除。
  await pruneReferenceManifest(registry, projectId, (assetFile) => rootFiles.has(assetFile))
  // ⑤ history 剪枝：文件在根目录与 .trash 都已不存在 → 条目删除（物理清的收尾）。
  await pruneHistory(registry, projectId, (file) => rootFiles.has(file) || trashNames.has(file))
  return result
}
