/**
 * CV-108：镜位版本链与失效标注（纯函数层，可单测）。
 *
 * 背景：agent 对同一镜头会重复/返工生成多个视频节点（实测会话里 6 个镜头
 * 出了 12~13 段），而成片合成默认收「全部视频节点」，导致返工前后的版本
 * 一起被拼进成片。用户要求「最后合成时只合成合理的分镜视频」。
 *
 * 机制：节点上记录版本链——
 * - `shotVersion`：同一镜位的版本号（首版 1，被取代后新版 +1）；
 * - `supersededBy`：被哪个节点取代（有值即失效）；
 * - `retired`：手动作废（无替代者，如「这镜不要了」）；
 * - `supersedes`：取代了谁（反向索引，回溯用）。
 *
 * 取代关系三条建立通道（用户拍板）：
 * 1. **输入指纹相同自动取代** —— 同 toolName + 同参考图 filename + 同时长 +
 *    同分镜卡，视为同一镜位的重复生成，新版自动作废旧版（保守：指纹没有
 *    锚点时拒绝判重，避免误伤）；
 * 2. **agent 显式 `replaces`** —— 返工改了关键帧（指纹不同但语义是替代）时，
 *    生成工具显式声明取代哪个节点；
 * 3. **用户手动作废 / 恢复** —— 画布右键。恢复旧版时接管者自动作废，
 *    保证同一镜位只有一份有效。
 *
 * 消费方：`defaultComposeClips` 只取有效节点；`list_shots` 把版本与状态
 * 暴露给 agent，使其能精确指定 clipIds。
 */
import type { StudioCanvasNode } from './contracts/canvas.js'

/** 节点状态：有效 / 被新版取代 / 手动作废。 */
export type ShotStatus = 'active' | 'superseded' | 'retired'

/** 生成输入的指纹素材（用于判重）。 */
export interface ShotFingerprintInput {
  /** 产出工具名（video_generate / video_composite …）。 */
  toolName?: string | undefined
  /** 单参考图（video_generate）。 */
  filename?: string | undefined
  /** 多参考图（video_composite）。 */
  filenames?: string[] | undefined
  /** 时长（秒）。 */
  duration?: number | undefined
  /** 关联分镜卡节点 id。 */
  shotNodeIds?: string[] | undefined
}

/** 版本递增上限：防御脏数据成环时无限循环。 */
const MAX_CHAIN_DEPTH = 64

function normalizeList(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) seen.add(value)
  }
  return [...seen].sort()
}

/** 节点状态判定（有效 = 未被取代且未手动作废）。 */
export function shotStatusOf(node: StudioCanvasNode): ShotStatus {
  if (node.retired === true) return 'retired'
  if (node.supersededBy !== undefined) return 'superseded'
  return 'active'
}

/** 是否参与默认合成的「有效」节点。 */
export function isActiveShot(node: StudioCanvasNode): boolean {
  return shotStatusOf(node) === 'active'
}

/**
 * 合成产物（成片）判定：`kind='video'` 但 `toolName='compose'`。
 *
 * 成片是**产物**不是**素材**——它由若干片段拼出来，若再被当成片段参与时长
 * 估算 / 下一次合成，就会出现「成片把自己再拼一遍」的递归叠加，预计时长也
 * 会凭空多出一整部成片的长度（CV-160：实测预期 15.51s 被算成 30.99s）。
 */
export function isComposeProduct(node: StudioCanvasNode): boolean {
  return node.kind === 'video' && node.toolName === 'compose'
}

/**
 * 「逐镜片段」判定——**全仓唯一权威口径**。
 *
 * 视频素材（video_generate / video_composite 产物）+ 存活版本（未被取代、未作废），
 * 且排除成片节点。此前该规则在 `defaultComposeClips`（Host 缺省选片）、时间轴
 * 预计时长、右键菜单三处各写一份，CV-006/007 新增的选择层漏了「非成片」一条，
 * 直接导致成片被重复计入时长并递归叠加（CV-160）。任何新消费方都必须复用本函数，
 * 不得再内联 `kind === 'video'` 自行判片段。
 */
export function isShotClip(node: StudioCanvasNode): boolean {
  return node.kind === 'video' && !isComposeProduct(node) && isActiveShot(node)
}

/**
 * 输入指纹：同一镜位的不同版本共有的输入特征。
 *
 * 参考图与分镜卡都为空时返回 `''`——没有锚点就无法安全判重（否则所有纯文生
 * 视频会互相判重），调用方须跳过自动取代。
 */
export function shotFingerprintOf(input: ShotFingerprintInput): string {
  const files = normalizeList([...(input.filenames ?? []), input.filename])
  const cards = normalizeList(input.shotNodeIds ?? [])
  if (files.length === 0 && cards.length === 0) return ''
  const duration = input.duration === undefined ? '' : String(Math.round(input.duration * 100) / 100)
  return [input.toolName ?? '', files.join(','), cards.join(','), duration].join('|')
}

/** 解析节点 `generationPrompt`（生成参数的 JSON 序列化）为指纹素材。 */
function parseGenerationPrompt(raw: string | undefined): Omit<ShotFingerprintInput, 'toolName' | 'duration'> {
  if (raw === undefined || raw.length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const record = parsed as Record<string, unknown>
    const filenames = Array.isArray(record.filenames)
      ? record.filenames.filter((item): item is string => typeof item === 'string')
      : undefined
    const shotNodeIds = Array.isArray(record.shotNodeIds)
      ? record.shotNodeIds.filter((item): item is string => typeof item === 'string')
      : undefined
    return {
      ...(typeof record.filename === 'string' ? { filename: record.filename } : {}),
      ...(filenames !== undefined ? { filenames } : {}),
      ...(shotNodeIds !== undefined ? { shotNodeIds } : {}),
    }
  } catch {
    return {}
  }
}

/** 从已落盘节点反推输入指纹（与生成时同源）。 */
export function shotFingerprintOfNode(node: StudioCanvasNode): string {
  return shotFingerprintOf({ toolName: node.toolName, duration: node.duration, ...parseGenerationPrompt(node.generationPrompt) })
}

/** 版本链规划结果。 */
export interface SupersedePlan {
  /** 新节点的版本号（被取代者最大版本 + 1；无取代者为 1）。 */
  version: number
  /** 应被标失效的节点 id。 */
  supersedeIds: string[]
}

/**
 * 规划新节点的取代关系（纯函数，不落盘）。
 *
 * - `replaces` 命中且节点种类匹配 `kind` → 无条件取代（agent 显式声明）；
 * - **仅视频**：指纹非空 → 所有「有效 + 非成片 + 同指纹」的视频节点一并取代
 *   （吃掉同参数重复调用）；
 * - **图片**（CV-159）：不做指纹判重——参考图多版本是有意的，只吃显式
 *   `replaces`（样张重出取代旧样张）；
 * - 两者皆无 → 返回 version 1、空列表（普通新镜头 / 新参考）。
 */
export function planSupersede(
  nodes: readonly StudioCanvasNode[],
  input: ShotFingerprintInput,
  replaces?: string,
  kind: 'video' | 'image' = 'video',
): SupersedePlan {
  const ids = new Set<string>()
  if (replaces !== undefined) {
    const target = nodes.find((node) => node.id === replaces)
    if (target !== undefined && target.kind === kind) ids.add(target.id)
  }
  const fingerprint = kind === 'video' ? shotFingerprintOf(input) : ''
  if (fingerprint !== '') {
    for (const node of nodes) {
      if (node.kind !== 'video' || node.toolName === 'compose') continue
      if (!isActiveShot(node)) continue
      if (shotFingerprintOfNode(node) === fingerprint) ids.add(node.id)
    }
  }
  if (ids.size === 0) return { version: 1, supersedeIds: [] }
  let maxVersion = 0
  for (const node of nodes) {
    if (!ids.has(node.id)) continue
    maxVersion = Math.max(maxVersion, node.shotVersion ?? 1)
  }
  return { version: maxVersion + 1, supersedeIds: [...ids] }
}

/** 给被取代节点打上 `supersededBy`（返回新数组，不改原数组）。 */
export function applySupersede(
  nodes: readonly StudioCanvasNode[],
  newId: string,
  supersedeIds: readonly string[],
): StudioCanvasNode[] {
  const set = new Set(supersedeIds)
  if (set.size === 0) return [...nodes]
  return nodes.map((node) => (set.has(node.id) ? { ...node, supersededBy: newId } : node))
}

/** 沿 `supersededBy` 追到当前有效版（脏数据成环时返回 undefined）。 */
export function latestActiveOf(
  nodes: readonly StudioCanvasNode[],
  id: string,
): StudioCanvasNode | undefined {
  let current = nodes.find((node) => node.id === id)
  for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth += 1) {
    if (current === undefined) return undefined
    if (isActiveShot(current)) return current
    if (current.supersededBy === undefined) return current
    current = nodes.find((node) => node.id === current?.supersededBy)
  }
  return undefined
}

/**
 * 作废 / 恢复（画布右键用，纯函数）。
 *
 * - 有效节点 → 置 `retired: true`；
 * - 失效节点 → 清除 `retired` 与 `supersededBy` 复活，**并把接管它的那个节点
 *   作废**，保证同一镜位始终只有一份有效（避免恢复后成片里出现两份同镜）。
 */
export function toggleRetire(nodes: readonly StudioCanvasNode[], id: string): StudioCanvasNode[] {
  const target = nodes.find((node) => node.id === id)
  if (target === undefined) return [...nodes]
  if (isActiveShot(target)) {
    return nodes.map((node) => (node.id === id ? { ...node, retired: true } : node))
  }
  const takerId = target.supersededBy
  return nodes.map((node) => {
    if (node.id === id) {
      const { retired: _retired, supersededBy: _supersededBy, ...rest } = node
      return rest
    }
    if (takerId !== undefined && node.id === takerId) return { ...node, retired: true }
    return node
  })
}
