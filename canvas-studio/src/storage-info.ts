/**
 * 存储目录只读诊断快照（REQ-021 R001 后续·方案 B「存储目录可见化」）。
 *
 * 背景：首页认领**不改名**（REQ-005 v1.3 变体 A 的设计产物——宿主 workspace /
 * 会话绑在 draft 目录上，认领只补 registry 记录），正式项目的目录名因此是
 * `.draft-*` 点前缀铸名：在 macOS Finder 默认不可见、目录名无语义、备份工具
 * 可能跳过。诊断面把「存储到底落在哪、draft 堆积了多少、哪个项目在哪个目录」
 * 变成设置页可读的信息块（备份指引随块尾文案落 UI）。
 *
 * 为什么在 src/ 根：readdir + registry 组装是纯持久化快照（不触网、不写盘），
 * node:test 直连（同 auto-test-checkpoints.ts 的先例）；routes.ts 只做 HTTP 包装。
 *
 * 只读纪律：本模块绝不 mkdir / rm —— 空目录统计以 readdir 结果为准，目录缺失
 * 按「零堆积」收场（诊断面不致命）。
 */
import { readdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { DRAFT_DIR_PREFIX, type ProjectRegistry } from './projects.js'
import type { StudioProject } from './contracts/project.js'

/** draft 目录堆积统计。 */
export interface StudioStorageDraftStats {
  /** `.draft-*` 目录总数（含已认领的正式项目目录）。 */
  total: number
  /** 未认领且目录为空 —— 启动清扫的可回收候选。 */
  empty: number
  /** 其余（已认领项目目录，或有会话/附件残留的未认领目录）。 */
  nonEmpty: number
}

/** 项目「名称 → 目录名」对照条目。 */
export interface StudioStorageProjectEntry {
  name: string
  dirBasename: string
}

/** storage-info 路由的响应体（设置页诊断区直接渲染的形状）。 */
export interface StudioStorageInfo {
  /** 存储根（资产库位置生效值；跟随 root provider 实时解析）。 */
  root: string
  /** 项目目录根（`<root>/projects`）。 */
  projectsDir: string
  drafts: StudioStorageDraftStats
  projects: StudioStorageProjectEntry[]
}

/** draft 目录是否「空」（无任何可见文件；claimed 判定在调用方之前做）。 */
async function isDirEmpty(dir: string): Promise<boolean | null> {
  try {
    return (await readdir(dir)).length === 0
  } catch {
    return null
  }
}

/**
 * 组装存储诊断快照。任何单目录读取失败都按该目录不可判定收场（不计入堆积、
 * 不抛错）—— 诊断面永远不比主功能更脆弱。
 */
export async function storageInfoSnapshot(registry: ProjectRegistry): Promise<StudioStorageInfo> {
  const root = registry.registryRoot
  const projectsDir = registry.projectsRoot
  const projects: readonly StudioProject[] = await registry.list().catch(() => [])
  const entries = await readdir(projectsDir, { withFileTypes: true }).catch(() => [])
  const claimed = new Set(projects.map((entry) => resolve(entry.dir)))
  let empty = 0
  let nonEmpty = 0
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(DRAFT_DIR_PREFIX)) continue
    const dir = join(projectsDir, entry.name)
    // 已认领的 draft 目录就是正式项目目录（认领不改名），恒归非空侧。
    const isEmpty = claimed.has(resolve(dir)) ? false : await isDirEmpty(dir)
    if (isEmpty === false) nonEmpty += 1
    // 读取失败（null）不计入任何一侧 —— 统计只回答能回答的。
    if (isEmpty === true) empty += 1
  }
  return {
    root,
    projectsDir,
    drafts: {
      total: empty + nonEmpty,
      empty,
      nonEmpty,
    },
    projects: projects.map((entry) => ({ name: entry.name, dirBasename: basename(entry.dir) })),
  }
}
