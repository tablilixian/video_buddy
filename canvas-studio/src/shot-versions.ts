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
 * 取代关系四条建立通道（通道 1/2 用户拍板；通道 1b = CV-222，判据经 CV-277 修正）：
 * 1. **输入指纹相同自动取代** —— 同 toolName + 同参考图 filename + 同时长 +
 *    同分镜卡，视为同一镜位的重复生成，新版自动作废旧版（保守：指纹没有
 *    锚点时拒绝判重，避免误伤）；
 * 1b. **同镜位自动取代（CV-222 / CV-277）** —— 新视频锚定分镜卡时，**镜位
 *     锚点集被新锚点覆盖**的活动视频一律取代（换参考组合 / 改时长的返工不再
 *     漏判）。锚点以显式 `shotRefs` 声明为准，血缘继承仅在唯一时回退；**不再
 *     用「血缘含同一张卡」判同镜位** —— 逐镜多参考图（≥3 张，补位引用别镜关键帧）
 *     会让 CV-031 把多张分镜卡继承进同一条视频，使该判据退化为全局串链
 *     （揽月湾实测：3 镜 6 条视频串成 v1→v6，5 条误标废弃、2 条实际已在成片里）；
 * 2. **agent 显式 `replaces`** —— 返工改了关键帧（指纹不同但语义是替代）时，
 *    生成工具显式声明取代哪个节点；
 * 3. **用户手动作废 / 恢复** —— 画布右键。恢复旧版时接管者自动作废，
 *    保证同一镜位只有一份有效。
 *
 * 消费方：`defaultComposeClips` 只取有效节点；`list_shots` 把版本与状态
 * 暴露给 agent，使其能精确指定 clipIds。
 */
import { STORYBOARD_NODE_TOOL } from './contracts/canvas.js'
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
  /**
   * CV-222：镜位级取代锚点的**血缘兜底** = 新节点血缘中的分镜卡 id（调用方从
   * resolved sourceIds 派生，含 CV-031 关键帧继承的间接锚点 —— agent 漏传
   * shotRefs 时仍能锚定镜位）。**不参与指纹**。
   *
   * CV-277：`shotNodeIds`（显式 `shotRefs`）非空时**只用显式、忽略本字段**；
   * 显式为空且本字段**恰好一张**时才回退采纳，多张一律拒绝自动取代（多张血缘
   * 卡意味着这条视频跨了多个镜位，无法判定它属于哪一镜）。须真实命中场上的
   * 分镜卡节点，防传错 id 误伤。
   */
  anchorShotCardIds?: string[] | undefined
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
 * BUG-020（R002 复盘）：**废弃节点** = 被新版取代（supersededBy）或手动作废
 * （retired）。取代机制本身是承重墙（合成不串版本 / 参考池不串形象 / 可恢复
 * 可审计，见类头注四条通道），要修的只是展示：画布默认隐藏废弃节点（数据
 * 不动），本谓词是渲染过滤 / fit-to-content / 拖线落点的统一口径——UI 可见性
 * 判定共用同一份纯函数（包规约），消费方不得各自内联。
 */
export function isDeprecatedNode(node: StudioCanvasNode): boolean {
  return node.supersededBy !== undefined || node.retired === true
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

/**
 * 节点的真实命中场上分镜卡集合（`toolName=submit_storyboard_for_approval`）。
 * 传入的 id 逐一验证存在且是分镜卡 —— 防 agent 传错 id / 传普通节点 id 误伤。
 */
function realShotCardsOf(ids: readonly (string | undefined)[], nodes: readonly StudioCanvasNode[]): Set<string> {
  const out = new Set<string>()
  for (const id of ids) {
    if (id === undefined) continue
    if (nodes.find((node) => node.id === id)?.toolName === STORYBOARD_NODE_TOOL) out.add(id)
  }
  return out
}

/**
 * 节点的**镜位锚点集** —— 「这条视频属于哪一镜」的权威答案。
 *
 * 两级取值，**显式声明优先，血缘继承仅在唯一时回退**：
 * 1. `generationPrompt.shotNodeIds`（agent 传 `shotRefs` 的显式声明）——
 *    逐个验证命中场上分镜卡后全部采纳；
 * 2. 显式为空时回退血缘（`sourceIds` 里的分镜卡，CV-031 关键帧继承带来的），
 *    **但仅当恰好一张时采纳**。
 *
 * ② 的「恰好一张」是 CV-277 的核心修正：原实现用「血缘里有任一张分镜卡相同」
 * 判同镜位，而 `shot-format.md` 第 9 步要求逐镜参考组合 ≥3 张、agent 补位时会
 * 引用别镜关键帧，CV-031 于是把**多张**分镜卡继承进同一条视频的 `sourceIds`
 * —— 任意两条视频都至少共享一张卡，镜位级取代退化成全局串链（实测：6 条视频
 * 串成 v1→v6、5 条误标废弃、其中 2 条实际已在成片里）。
 *
 * 语义边界：锚点集为空或大于一张 ⇒ **拒绝自动取代**（延续「无锚点拒绝判重」
 * 的保守口径）。此时同镜位重跑需要 agent 显式传 `replaces`；只有完全相同
 * （含全部参考图与时长）的重复调用才由指纹通道吃掉。
 */
export function shotAnchorCardsOf(node: StudioCanvasNode, nodes: readonly StudioCanvasNode[]): Set<string> {
  const declared = realShotCardsOf(parseGenerationPrompt(node.generationPrompt).shotNodeIds ?? [], nodes)
  if (declared.size > 0) return declared
  const inherited = realShotCardsOf(node.sourceIds, nodes)
  return inherited.size === 1 ? inherited : new Set()
}

/**
 * 新提交节点的镜位锚点集 —— 与 `shotAnchorCardsOf` 同一条口径（显式优先、
 * 血缘唯一时回退、否则拒绝）。
 *
 * `input.shotNodeIds` 是 agent 传 `shotRefs` 的显式声明（调用方已解析为节点 id）；
 * `input.anchorShotCardIds` 是调用方从**血缘**派生的分镜卡（CV-031 继承来的，
 * 可能多张）。显式非空时**只用显式** —— 否则多张血缘卡会让判据退化成
 * 「只要沾一张就算同镜位」，正是 CV-277 修掉的串链。
 */
function newNodeAnchorCards(
  input: ShotFingerprintInput,
  nodes: readonly StudioCanvasNode[],
): Set<string> {
  const declared = realShotCardsOf(input.shotNodeIds ?? [], nodes)
  if (declared.size > 0) return declared
  const inherited = new Set(input.anchorShotCardIds ?? [])
  return inherited.size === 1 ? inherited : new Set()
}

/** 锚点集 a 是否被 b 覆盖（b 含 a 的全部锚点）。空集一律 false。 */
function anchorCoveredBy(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size === 0) return false
  for (const id of a) {
    if (!b.has(id)) return false
  }
  return true
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
 * - **仅视频（CV-222，CV-277 修正判据）**：镜位级取代 —— 新视频锚定分镜卡时，
 *   所有「有效 + 非成片 + 镜位锚点集被新锚点覆盖」的视频节点一并取代。背景：
 *   指纹级判定要求「同参考图 + 同时长 + 同分镜卡」，而真实返工往往换参考组合 /
 *   改时长（罗大佑画布分镜 11 重跑换了色彩参考 ⇒ 指纹不同 ⇒ 新旧两条活动视频
 *   并列，会一起进 defaultComposeClips 重复拼镜；同画布分镜 7/8 恰好指纹未变
 *   走了显式 replaces —— 同机制一半生效一半失效，证明靠 agent 自觉传 replaces
 *   不可靠）。**CV-277 修掉的关键缺陷**：原判据是「血缘里有任一张分镜卡相同即
 *   取代」，而逐镜参考组合要求 ≥3 张、agent 补位会引用别镜关键帧，CV-031 继承
 *   于是把多张分镜卡写进同一条视频的 `sourceIds` ⇒ 任意两条都共享一张卡 ⇒
 *   退化成全局串链（揽月湾实测：3 镜 6 条视频串成 v1→v6，5 条误标废弃、其中
 *   2 条实际已在成片里，白烧 3 条视频）。现判据为**锚点集覆盖**且锚点以显式
 *   `shotRefs` 声明为准（详见 `shotAnchorCardsOf`）。
 *   安全边界：新视频没有任何分镜卡锚点、或锚点无法唯一确定时不触发（延续
 *   「无锚点拒绝判重」的保守口径，纯文生视频不互相误伤）；
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
  // CV-222 / CV-277：镜位级取代。两侧锚点都按「显式声明优先、血缘唯一时回退」
  // 取（`newNodeAnchorCards` / `shotAnchorCardsOf`），旧节点锚点被新锚点覆盖才判
  // 同镜位 —— 修掉「有任一张卡相同即取代」在多参考图跨镜时的全局串链。
  if (kind === 'video') {
    const anchorCards = newNodeAnchorCards(input, nodes)
    if (anchorCards.size > 0) {
      for (const node of nodes) {
        if (node.kind !== 'video' || node.toolName === 'compose') continue
        if (!isActiveShot(node) || ids.has(node.id)) continue
        if (anchorCoveredBy(shotAnchorCardsOf(node, nodes), anchorCards)) ids.add(node.id)
      }
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
