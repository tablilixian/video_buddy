/**
 * REQ-022（CV-305）· 落地执行体 —— 「故事板终版 → 画布」的**唯一实现点**。
 *
 * 契约见 `docs/plans/REQ-022-storyboard数据契约.md` §7.2（单向终点）：落地一次，
 * 之后版本操作冻结、画布成为唯一工作面。本模块管的是「怎么把这一步做对」，
 * `routes.ts` 只留 HTTP 壳（解析 body / 发响应）。
 *
 * ## 骨架：`landed` 即预写日志（WAL）
 *
 * 落地要做三件事，顺序与「谁是料源」是本模块的全部要点：
 *
 * 1. **写 `landed`（含 `sections` 全量快照 + `bindings` 反查表）**
 * 2. 写画布（seed 投影追加到现有节点之后）
 * 3. 把 workflow 推到 `executing`
 *
 * 第 1 步刻意放在第 2 步**之前** —— 这与「先写画布再置标记」的直觉相反，原因是
 * 失败收敛：`StoryboardLanded.sections` 本来就是一份**完整只读快照**（契约 §7.3），
 * 把它当「这次落地的料」的持久暂存点，整条链路立刻获得三个性质：
 *
 * - **幂等**：重试时料从 `landed.sections` 读，不会「重试期间活副本被改 ⇒ 记的料
 *   与画布内容不同源」；重复 append 也由锚点探测挡住（见 `hasSeedAnchor`）。
 * - **TOCTOU 收口**：落地一开始料就被快照锁死，窗口内 agent 再写 `write_storyboard`
 *   也污染不了本次落地内容。
 * - **无死角**：无论死在写画布还是死在推状态，用户「再点一次落地」都是有效操作
 *   （续做只补缺失的那一步）。交换这两行（先画布后 `landed`）反而更糟：那时
 *   「画布已成、`landed` 未写」的窗口里没有任何地方能暂存「本次落的是哪份料」，
 *   要么记错料、要么被迫再引一套 checkpoint 记账。
 *
 * ## 入口三分支（取代原先的 `assertNotLanded` 一律拒）
 *
 * | 现状 | 判定 | 动作 |
 * | --- | --- | --- |
 * | `landed === null` | 还没落过 | 正常落地 |
 * | 有 `landed` ∧ 画布有锚点 ∧ `state === 'executing'` | **真·已完成** | 拒绝（单向终点不变） |
 * | 其余（缺画布 ∨ 缺状态） | 落了一半 | **续做**：补缺的那一步 |
 *
 * `assertNotLanded`（`routes.ts`）**原样保留**给存档 / 回退 / 改名 —— 落地一开始
 * 就不该换料，那是对的；本模块只是不复用它做入口判定。
 */
import type { StudioAsset, StudioCanvasDocument, StudioCanvasNode, StudioCanvasView } from './contracts/canvas.js'
import { BRIEF_NODE_TOOL, hasSeedAnchor } from './contracts/canvas.js'
import type { StudioProject, StudioWorkflow, StudioWorkflowState } from './contracts/project.js'
import type { StoryboardBinding, StoryboardDocument } from './contracts/storyboard.js'
import { validateForSeed } from './contracts/storyboard.js'
import type { StoryboardSeedPlan } from './storyboard-seed.js'
import { planSeedFromStoryboard } from './storyboard-seed.js'
import { archive as archiveVersion, versionById } from './storyboard-history.js'
import type { StoryboardFileRegistry } from './storyboard-store.js'
import { loadStoryboardOrFail, updateStoryboardOrFail } from './storyboard-store.js'
import { enforceAssetReadinessEnabled } from './storyboard-gate.js'
import { throwError } from './error-system.js'
// 本模块自己抛的用户可见错误码出自 catalog：按仓库惯例在**使用方**注册一次
// （`param-guard.ts` 是唯一例外，那里方向必须单向）。不依赖入口模块的先手注册 ——
// 否则单独驱动本模块（测试、脚本）会得到「未注册的错误码」而不是真文案。
import './errors/catalog.js'

/**
 * 落地执行体需要的 registry 面（**窄接口**）—— 六个方法，全部是落地真用得上的。
 *
 * 刻意不收 `ProjectRegistry`：那个类有 40+ 方法，测试要驱动落地就得先造一个完整
 * registry。收窄后测试只提供这六个（画布走内存、`storyboardFile` 指临时目录），
 * 驱动的是**真实的**读写层、损坏隔离、串行队列。真实实例天然满足本接口。
 */
export interface LandRegistry extends StoryboardFileRegistry {
  readCanvas(projectId: string): Promise<StudioCanvasDocument>
  /** 与 `ProjectRegistry.writeCanvas` 同签名（可选参数保持可选，实参形状不变）。 */
  writeCanvas(
    projectId: string,
    nodes: readonly StudioCanvasNode[],
    view?: StudioCanvasView,
    assets?: StudioAsset[],
    options?: { author?: 'host' | 'client'; removedIds?: readonly string[] },
  ): Promise<void>
  updateWorkflow(projectId: string, patch: Partial<StudioWorkflow>): Promise<StudioProject>
  getProject(projectId: string): Promise<StudioProject | null>
}

/** 落地结果（HTTP 响应体直接展开它）。 */
export interface LandResult {
  readonly shots: number
  readonly nodes: number
  readonly assets: number
  /** 实际落的是哪一版（`"v3"` / `"live"`）—— 续做时取自 `landed.sourceVersion`。 */
  readonly version: string
  readonly warnings: readonly string[]
  /** `true` = 本次是**续做**（沿用上次落地的料，只补了缺失的步骤）。 */
  readonly resumed: boolean
}

/** 投影计划：把（活副本或快照）投成待落画布的节点/资产，并接上「创意」节点的血缘。 */
function seedPlan(
  document: StoryboardDocument,
  sections: StoryboardDocument['sections'],
  canvas: StudioCanvasDocument,
  sourceVersion: string,
): StoryboardSeedPlan {
  const briefNodeId = canvas.nodes.find((node) => node.toolName === BRIEF_NODE_TOOL)?.id
  return planSeedFromStoryboard({ ...document, sections }, {
    ...(briefNodeId === undefined ? {} : { briefNodeId }),
    sourceVersion,
  })
}

/**
 * 由**画布实况**反查「语义 ID ↔ 画布 UUID」（契约 §7.6 的 `bindings` 块）。
 *
 * 真源刻意选画布，而不是「本次投影计划」：节点 id 是每次现铸的随机 UUID，拿另一次
 * 计划算出来的 bindings 会指向画布上**不存在**的节点 —— 回写通道（L 类）静默断链，
 * 看不出来也查不到。画布上的节点与资产自带 `sbRef`（seed / 结构修订写的回指针，
 * CV-242 起与 `filename` 同受 Host 专属字段保护），所以「画布上有什么」就是
 * 「bindings 该记什么」：首落、续做、并发探测命中三条路径同一条规则，且续做时
 * 顺带**自愈**历史断链。这也是本文件唯一的反查表实现点。
 */
function bindingsFrom(
  nodes: readonly StudioCanvasNode[],
  assets: readonly StudioAsset[],
): Record<string, StoryboardBinding> {
  const bindings: Record<string, StoryboardBinding> = {}
  for (const node of nodes) {
    if (node.sbRef === undefined || node.sbRef === '') continue
    bindings[node.sbRef] = { ...(bindings[node.sbRef] ?? {}), canvasNodeId: node.id, seededFrom: 'final' }
  }
  for (const asset of assets) {
    if (asset.sbRef === undefined || asset.sbRef === '') continue
    bindings[asset.sbRef] = { ...(bindings[asset.sbRef] ?? {}), canvasAssetId: asset.id, seededFrom: 'final' }
  }
  return bindings
}

/**
 * 落活副本时的 TOCTOU 复核（评审 SB-06 的正解）：活副本自「读到并校验」以来
 * 没被动过吗？
 *
 * 读故事板与实际写 `landed` 之间隔着校验、投影、随机 id 生成，而这两步是
 * **两次独立入队**（串行队列只保护单次读改写，不保护整段落地事务）—— 窗口内
 * agent 的 `write_storyboard` 落盘后，落地用的仍是校验过的旧快照，画布与
 * `landed` 虽然自洽，但**内容不是用户确认时看到的那一份**。
 *
 * 比较方式用 `JSON.stringify`：`sections` 由 `normalizeStoryboard` 归一化，
 * 九个分节的键序与各节内部字段序都是构造器定的，同一份内容必然产出同一串
 * （该前提由 `storyboard-store.ts` 的「先归一化再返回」保证）。逐字段深比较要
 * 多写一大坨、收益相当 —— 这里的判定只需要「一模一样 vs 有任何改动」。
 */
function sameSections(a: StoryboardDocument['sections'], b: string): boolean {
  return JSON.stringify(a) === b
}

/**
 * 落地：把所选内容投影到画布（契约 §7.2 的单向终点）。
 *
 * `sourceVersion` 省略 = 落**活副本**（并补一个「落地前固化」checkpoint）；
 * 给了版本号 = 落**那个历史版本**（它本来就在 history 里，不必再补 checkpoint）。
 * 续做路径忽略 `sourceVersion` —— 料已由 `landed.sections` 锁定。
 */
export async function landStoryboard(
  registry: LandRegistry,
  projectId: string,
  sourceVersion?: string,
): Promise<LandResult> {
  const document = await loadStoryboardOrFail(registry, projectId)
  const canvas = await registry.readCanvas(projectId)

  // 还没落过地：正常路径（含校验、checkpoint、投影）。
  if (document.landed === null) {
    return landFirstTime(registry, projectId, document, canvas, sourceVersion)
  }

  // 落过地了：判「真完成」还是「落了一半」。
  const anchorExists = hasSeedAnchor(canvas.nodes)
  const state = (await registry.getProject(projectId))?.workflow?.state
  if (anchorExists && state === 'executing') {
    throwError('CS-USER-ERR', {
      message: `本项目已落地（${document.landed.sourceVersion}），版本操作已冻结。版本列表仍可只读回看。`,
    })
  }
  return resumeLanding(registry, projectId, document, canvas, state)
}

/** 首落：校验 → 快照落盘（WAL）→ 写画布 → 推状态。 */
async function landFirstTime(
  registry: LandRegistry,
  projectId: string,
  document: StoryboardDocument,
  canvas: StudioCanvasDocument,
  sourceVersion: string | undefined,
): Promise<LandResult> {
  const source = sourceVersion === undefined ? undefined : versionById(document.versions, sourceVersion)
  if (sourceVersion !== undefined && source === undefined) {
    throwError('CS-USER-ERR', { message: `没有这个版本：${sourceVersion}` })
  }
  const frozen = source === undefined ? document.sections : source.snapshot
  const { blockers, warnings } = validateForSeed({ ...document, sections: frozen }, {
    // §07 素材未就绪也算阻断项（2026-10-25）：落地是"开始动手"的那一刻，
    // 此时素材没齐就该停 —— 否则后面每个 shot 都要临时找图（会话 #5 的主因）。
    enforceAssetReadiness: enforceAssetReadinessEnabled(),
  })
  if (blockers.length > 0) {
    throwError('CS-USER-ERR', {
      message: `故事板还有 ${String(blockers.length)} 项未补齐，不能落地：\n- ${blockers.join('\n- ')}`,
    })
  }

  const landedLabel = source === undefined ? 'live' : source.version
  // 落活副本才复核（落历史版本时 frozen 来自快照，与活副本本就不同）。
  const frozenJson = source === undefined ? JSON.stringify(frozen) : undefined

  // ── 第一步（WAL）：只把**料**冻结落盘，且必须早于任何画布写入 ──
  // 这里是全模块的要点：`landed` 是这次落地唯一的持久料源。若把画布写在前，
  // 「画布已成、标记未写」的窗口里没有任何地方能记「本次落的是哪一份内容」——
  // 要么重试时按已被改过的活副本记错料，要么被迫再引一套 checkpoint 记账。
  // 顺带落活副本的「落地前固化」checkpoint（落历史版本时那条本来就在 history 里）。
  //
  // `bindings` 刻意**不在这里**写 —— 它的真源是画布（见 `bindingsFrom`），而画布
  // 此刻还没写。分成两步的代价是可能留下「有 landed、没 bindings」的中间态，
  // 而那正是续做路径会自愈的一类（续做每次都按画布实况重建）。
  await updateStoryboardOrFail(registry, projectId, (current) => {
    // 复核必须在 mutate 里做（那才是盘上最新值）；不一致就**停手**，见 `sameSections`。
    if (frozenJson !== undefined && !sameSections(current.sections, frozenJson)) {
      throwError('CS-USER-ERR', {
        message: '故事板在落地过程中被修改了，本次未做任何改动。请重新确认要落的内容。',
      })
    }
    return {
      ...current,
      versions: source === undefined
        ? archiveVersion(current.versions, current.sections, { kind: 'auto', label: '落地前固化' })
        : current.versions,
      landed: { at: Date.now(), sourceVersion: landedLabel, sections: structuredClone(frozen) },
    }
  })

  // ── 第二步：投影 + 写画布（画布写入自带写前重读与幂等探测）──
  // 料在第一步已经确认没被动过，这里才投影 —— 复核失败时连一个随机 id 都不铸。
  const plan = seedPlan(document, frozen, canvas, landedLabel)
  const canvasAfter = await appendSeedToCanvas(registry, projectId, plan)

  // ── 第三步：反查表以**画布实况**为准 ──
  await updateStoryboardOrFail(registry, projectId, (current) => ({
    ...current,
    bindings: { ...current.bindings, ...bindingsFrom(canvasAfter.nodes, canvasAfter.assets ?? []) },
  }))

  // ── 第四步：推状态（覆盖层据此让位给画布） ──
  await registry.updateWorkflow(projectId, { state: 'executing' })

  return {
    shots: plan.shotNumbers.length,
    nodes: plan.nodes.length,
    assets: plan.assets.length,
    version: landedLabel,
    warnings,
    resumed: false,
  }
}

/**
 * 续做：料取自 `landed.sections`，只补缺的那一步（画布 / 状态），**不重复 append**。
 *
 * 走到这里的前提是「落过地但没落完」（首落中途失败、或用户中途关掉了应用）。
 * 三步都写成幂等的：写画布那一步自带探测（已就绪则原样返回），反查表按画布实况
 * 重建（同时自愈断链），状态只在没到位时才推。
 */
async function resumeLanding(
  registry: LandRegistry,
  projectId: string,
  document: StoryboardDocument,
  canvas: StudioCanvasDocument,
  state: StudioWorkflowState | undefined,
): Promise<LandResult> {
  const landed = document.landed
  // 调用方已判非空；这里再收一次窄，让 TS 与读者都看得见前提。
  if (landed === null) throwError('CS-USER-ERR', { message: '本项目尚未落地，无法续做。' })

  const plan = seedPlan(document, landed.sections, canvas, landed.sourceVersion)
  // 画布缺失＝首落死在了写画布那一步（landed 已写、画布没写）；已就绪则一个节点都不动。
  const canvasAfter = await appendSeedToCanvas(registry, projectId, plan)
  await updateStoryboardOrFail(registry, projectId, (current) => ({
    ...current,
    bindings: { ...current.bindings, ...bindingsFrom(canvasAfter.nodes, canvasAfter.assets ?? []) },
  }))
  if (state !== 'executing') {
    await registry.updateWorkflow(projectId, { state: 'executing' })
  }

  return {
    shots: plan.shotNumbers.length,
    nodes: plan.nodes.length,
    assets: plan.assets.length,
    version: landed.sourceVersion,
    // 续做不重跑 `validateForSeed`（料是首落时已过闸的那一份），故无 warnings。
    warnings: [],
    resumed: true,
  }
}

/**
 * 把 seed 计划追加到画布，返回**写后画布实况**（未写入时返回当前实况）。
 *
 * 两个刻意的设计：
 *
 * 1. **写前重读**：落地开始到真正写盘之间有一段真实窗口（校验、快照落盘、随机 id
 *    生成），期间画布可能被别处写（`character_sheet` 补占位图、客户端拖动保存…）。
 *    以入口时读的快照为基底覆盖写会把这些丢掉 ⇒ 重读一次取最新节点表作基底。
 * 2. **幂等探测**：重读同时再判一次锚点（`hasSeedAnchor`），命中就**原样返回、不写**。
 *    这是「重复 append」的最后一道闸 —— 入口判定与实际写入之间同样可能有并发
 *    （两个落地请求、或 agent 侧的写），而画布写入不可撤销。
 */
async function appendSeedToCanvas(
  registry: LandRegistry,
  projectId: string,
  plan: StoryboardSeedPlan,
): Promise<StudioCanvasDocument> {
  const latest = await registry.readCanvas(projectId)
  if (hasSeedAnchor(latest.nodes)) return latest
  const nodes = [...latest.nodes, ...plan.nodes]
  const assets = [...(latest.assets ?? []), ...plan.assets]
  await registry.writeCanvas(projectId, nodes, undefined, assets, { author: 'host' })
  return { ...latest, nodes, assets }
}
