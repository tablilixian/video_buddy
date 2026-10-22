/**
 * 首页首句的**路由判定**（纯函数，Host/Client 两侧无关，可单测）。
 *
 * 背景（2026-10-22 真机）：`sendSession` 拦截分支原先按「基线 phase 是否 ready」
 * 判定要不要认领 draft 目录。phase 是**就绪代理量**，一旦它在真机上不是 `ready`
 * （版本升级后语义漂移、订阅未落地、或等待窗口里被别的 effect 重置），判定就退化成
 * 「放行原生发送」—— 首句落进 `.draft-*` 目录，之后**永远不会被认领成项目**：
 * 侧栏一直「还没有项目」、agent 所有画布工具报「未绑定任何 Canvas Studio 项目」、
 * 布局停在首页。
 *
 * 真正的判据是**数据**，不是 phase：这条消息要落到的会话 cwd，是否已经属于某个
 * 项目目录。属于 → 项目内发送（原生放行）；不属于且是首页落点（`.draft-*`）或
 * 用户明确停在首页 → 认领。这样即使基线 phase 尚未 ready，只要会话 cwd 已经在
 * 手上就能正确认领；cwd 还没有时返回 `undetermined`，由调用方**显式**处理
 * （等待/报错），不再静默放行。
 */

/** 首页落点目录名前缀（`registry.ensureDraftDir` 的铸名规则）。 */
export const DRAFT_LANDING_PREFIX = '.draft-'

/** 一条发送消息该走哪条路。 */
export type StudioSendRoute =
  /** 认领 draft 目录并把它变成项目（首页首句）。 */
  | 'claim'
  /** 原生放行（项目内发送 / 与首页无关）。 */
  | 'native'
  /** 判不出来（会话 cwd 还没就位）—— 调用方必须显式处置，**不得静默放行**。 */
  | 'undetermined'

/** 取路径最后一段（同时认 `/` 与 `\`，客户端不引入 node:path）。 */
function baseName(dir: string): string {
  const trimmed = dir.replace(/[\\/]+$/u, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut === -1 ? trimmed : trimmed.slice(cut + 1)
}

/** `dir` 是否是首页 draft 落点目录（`.draft-*`）。 */
export function isDraftLandingDir(dir: string | undefined): boolean {
  if (dir === undefined || dir === '') return false
  return baseName(dir).startsWith(DRAFT_LANDING_PREFIX)
}

/**
 * `cwd` 是否落在某个项目目录里（精确相等或项目目录的子路径）。
 *
 * 与 Host 侧 `resolveProjectId` 同一口径（最长前缀匹配的简化版：此处只判归属）。
 */
export function cwdBelongsToProject(cwd: string, projectDirs: readonly string[]): boolean {
  const normalized = cwd.replace(/[\\/]+$/u, '')
  return projectDirs.some((dir) => {
    const projectDir = dir.replace(/[\\/]+$/u, '')
    if (projectDir === '') return false
    if (normalized === projectDir) return true
    return normalized.startsWith(`${projectDir}/`) || normalized.startsWith(`${projectDir}\\`)
  })
}

/**
 * 决定一条用户消息的发送路径。
 *
 * @param input.homePinned - 用户是否明确停在首页（品牌区回首页 / 启动窗口）。停在
 *   首页时即便残留会话 cwd 仍指向某个老项目，也必须认领（CV-299 的「首页意图优先」）。
 * @param input.cwd - 承载这条消息的会话工作目录；未就位为 undefined。
 * @param input.projectDirs - 客户端已知的项目目录集合。
 */
export function routeStudioSend(input: {
  homePinned: boolean
  cwd: string | undefined
  projectDirs: readonly string[]
}): StudioSendRoute {
  const { homePinned, cwd, projectDirs } = input
  // cwd 未就位 = 判不出来。放在最前：没有 cwd 时连「首页意图」都无法落到具体目录上
  //（认领必须用会话 cwd），只能让调用方去等或明确报错。
  if (cwd === undefined || cwd === '') return 'undetermined'
  if (homePinned) return 'claim'
  if (cwdBelongsToProject(cwd, projectDirs)) return 'native'
  if (isDraftLandingDir(cwd)) return 'claim'
  // 既不属于任何项目、也不是首页落点（外部工作区 / 用户自己的目录）：按老规矩放行，
  // 认领会因为「目录不在项目根内」被 Host 拒，没必要让用户先撞一次失败。
  return 'native'
}
