/**
 * 制作六阶段（C1 / DD-05）——「现在拍到哪里」的**唯一派生实现**。
 *
 * ## 为什么是派生，而不是扩契约
 *
 * `StudioWorkflowState` 只有 5 个值（`drafting` / `script_review` /
 * `awaiting_approval` / `keyframe_review` / `executing`），**推不出**设计稿的
 * 六段「剧本 → 分镜 → 定妆 → 关键帧 → 镜头 → 成片」—— 定妆、镜头、成片这
 * 三段在 state 里没有独立取值（见 visual-direction-ui-closeout.md §5 Q1）。
 *
 * 两条路：
 * - 路线 ii：扩 `workflow.state` 契约。Host 路由 + 状态机 + 唤醒逻辑全动，并把
 *   「画布上已经有成片、state 还停在 executing」这类不一致变成必须由状态机保证的
 *   强约束。
 * - **路线 i（本实现，已拍板）**：state 给**地板**，画布产物给**证据**，取较大值。
 *   纯函数、零契约风险、`node --test` 可直连。
 *
 * 选路线 i 的核心理由不是省事，而是**证据比状态更可信**：state 是 agent 流程的
 * 副产物，会因重放 / 中断 / 多轮对话停在半路；而「画布上有没有成片节点」是事实。
 * 只看 state 的轨道会在「已经出片了但 state 没跟上」时说谎。
 *
 * ## 单调性（阶段只前进不后退）
 *
 * 结果 = `max(state 地板, 最强产物证据)`。中途删掉几张关键帧不会让轨道倒回
 * 「分镜」，因为后段证据（镜头 / 成片）还在。这正是「进度」的语义：进度不会
 * 因为删了一份草稿就回退。
 *
 * ## 铁律
 *
 * - 本模块是六阶段判定的**唯一实现**。`StudioFrame` 只允许 import，不得自己
 *   遍历 `nodes` 推阶段（同一规则两份实现是 CV-160 的教训）。
 * - 成片 / 逐镜片段判定复用 `shot-versions.ts` 的权威口径，不在这里重写
 *   `toolName === 'compose'` 或 `kind === 'video'`。
 * - 纯函数、无 DOM、无 React。
 */
import type { StudioCanvasNode, StudioCanvasOperationType } from './contracts/canvas.js'
import type { StudioWorkflowState } from './contracts/project.js'
import { BRIEF_NODE_TOOL } from './contracts/canvas.js'
import { isComposeProduct } from './shot-versions.js'

/** 六段展示名（顺序即阶段序）。 */
export const WORKFLOW_STAGE_LABELS = ['剧本', '分镜', '定妆', '关键帧', '镜头', '成片'] as const
export type WorkflowStageLabel = (typeof WORKFLOW_STAGE_LABELS)[number]
export const WORKFLOW_STAGE_COUNT = WORKFLOW_STAGE_LABELS.length

/** 阶段序号的具名常量（避免消费方各写一遍魔数）。 */
export const STAGE_SCRIPT = 0
export const STAGE_STORYBOARD = 1
export const STAGE_LOOK = 2
export const STAGE_KEYFRAME = 3
export const STAGE_SHOT = 4
export const STAGE_FILM = 5

/**
 * `workflow.state` 给出的**地板值**（即「至少走到哪」）。
 *
 * 注意 `script_review` 的地板是 0 而不是 1：它的含义是「剧本已提交、**待批准**」，
 * 也就是我们正**站在剧本阶段**等确认，而不是已经进了分镜。同理 `awaiting_approval`
 * 是站在分镜阶段（1）。把「待批准」误读成「已完成」会让轨道抢跑一格。
 */
const STATE_FLOOR: Readonly<Record<StudioWorkflowState, number>> = {
  drafting: STAGE_SCRIPT,
  script_review: STAGE_SCRIPT,
  awaiting_approval: STAGE_STORYBOARD,
  keyframe_review: STAGE_KEYFRAME,
  executing: STAGE_SHOT,
}

/** 待批准态 —— 决定审批条显隐（与阶段派生无关，随 state 走）。 */
const APPROVAL_STATES: ReadonlySet<string> = new Set([
  'script_review', 'awaiting_approval', 'keyframe_review',
])

/**
 * 图片类产物的 `operationType` → 阶段。
 *
 * 只收**制作产物**。`import` / `drawing` 不在表内 —— 手动导入的素材不属于任何
 * 制作阶段（它没有「被哪一步做出来」这回事），硬塞进某一段会让轨道虚报进度。
 * 注意 `import` 同时是剧本卡（`user_brief`）的 operationType，所以那一类必须靠
 * `toolName` 判，不能靠 operationType（见 `stageOfNode`）。
 */
const OPERATION_STAGE: Readonly<Partial<Record<StudioCanvasOperationType, number>>> = {
  storyboard: STAGE_STORYBOARD,
  'storyboard-split': STAGE_STORYBOARD,
  'character-sheet': STAGE_LOOK,
  'scene-concept': STAGE_LOOK,
  'text-to-image': STAGE_KEYFRAME,
  'image-to-image': STAGE_KEYFRAME,
  variant: STAGE_KEYFRAME,
  expand: STAGE_KEYFRAME,
  'style-transfer': STAGE_KEYFRAME,
  'background-replace': STAGE_KEYFRAME,
  'background-remove': STAGE_KEYFRAME,
  'text-to-video': STAGE_SHOT,
  'image-to-video': STAGE_SHOT,
  'mkr-video': STAGE_SHOT,
  'video-clip': STAGE_SHOT,
  'video-composite': STAGE_SHOT,
  // 六段模型里没有独立的「配乐」段：BGM 是镜头阶段的伴生素材（音乐生成与
  // 镜头产出并行），归到镜头段最贴近用户心智 —— 它绝不早于分镜出现。
  'text-to-audio': STAGE_SHOT,
}

/**
 * 单个节点归属哪个阶段。`null` = 不属于任何制作阶段（便签 / 文案 / 导入素材 /
 * 分组节点）。这类节点不参与进度判定，也不会被「点阶段 → 聚焦产物」选中。
 *
 * 判定优先级（从强到弱）：
 * 1. **成片** —— `isComposeProduct`（全仓唯一口径）。成片是终点产物，压过一切。
 * 2. **剧本卡** —— `toolName === BRIEF_NODE_TOOL`。必须排在 operationType 之前，
 *    因为剧本卡的 operationType 是 `import`（与手动导入同值）。
 * 3. **视频类** —— 非成片的 `kind === 'video'` 一律算镜头。不查 operationType：
 *    视频端点会随供应商增加（H3 就换过两轮），逐个列举迟早漏一个，而「画布上
 *    能播的片段 = 镜头段产物」这个语义不会漏。
 * 4. **图片类** —— 查 `OPERATION_STAGE`。
 */
export function stageOfNode(node: StudioCanvasNode): number | null {
  if (isComposeProduct(node)) return STAGE_FILM
  if (node.toolName === BRIEF_NODE_TOOL) return STAGE_SCRIPT
  if (node.kind === 'video') return STAGE_SHOT
  if (node.kind !== 'image') return null
  const byOperation = node.operationType === undefined
    ? undefined
    : OPERATION_STAGE[node.operationType]
  return byOperation ?? null
}

/** 六阶段的派生结果。 */
export interface WorkflowStageView {
  /** 当前阶段 0..5（`max(地板, 证据)`）。 */
  readonly stage: number
  /** 每阶段的产物节点 id，下标与 `WORKFLOW_STAGE_LABELS` 对齐。 */
  readonly idsByStage: readonly (readonly string[])[]
  /** 是否有待批准项（`script_review` / `awaiting_approval` / `keyframe_review`）。 */
  readonly approvalPending: boolean
}

/**
 * C10：节点头部要显示的**产物名** —— 六段的细分，不是第二套阶段模型。
 *
 * 六段名是为**轨道**（一条横轴上六个刻度）取的，一格一个词；卡片头部问的是
 * 另一个问题：「这一步做出来的**东西**叫什么」。两者大多同字（剧本 / 分镜 /
 * 关键帧 / 成片），但有两处必须分开，否则卡片会说谎：
 *
 * - `定妆` 是一格，格里的产物是**角色**或**场景**两种卡。标成「定妆」等于把
 *   两种东西压成一个词，用户看卡面认不出这是角色表还是场景图。
 * - `镜头` 是一格，格里的产物是**片段**，还可能是并行产出的 **BGM**。
 *
 * 因此本表**只收与阶段名不同字的那几个**，其余交给 `WORKFLOW_STAGE_LABELS`
 * 兜底 —— 不抄一份全表，就不会出现「轨道改了名、卡片没跟着改」。
 *
 * 未进表但在 `OPERATION_STAGE` 里的（`text-to-image` 等）走阶段名兜底 = 关键帧。
 */
const OPERATION_PRODUCT: Readonly<Partial<Record<StudioCanvasOperationType, string>>> = {
  'character-sheet': '角色',
  'scene-concept': '场景',
  'video-clip': '片段',
  'text-to-audio': 'BGM',
}

/** 与阶段无关的产物名（模板 / 手动素材）。 */
const KIND_PRODUCT: Readonly<Record<string, string>> = {
  sticky: '便签',
  text: '文本',
  prompt: '提示',
  group: '分组',
  audio: 'BGM',
}

/**
 * C10：单个节点在卡片头部显示的产物名（简称「类型」）。
 *
 * 判定优先级（从强到弱）——**与 `stageOfNode` 逐条对齐**，两者若给出互相矛盾的
 * 答案（比如 `stageOfNode` 说这是剧本段、头部却写着「文本」），阶段轨道与卡片
 * 就会各说各话。所以这里复用同一个 `isComposeProduct` / `BRIEF_NODE_TOOL` 判据，
 * 而不是另写一遍。
 *
 * 1. 成片 —— `isComposeProduct`（全仓唯一口径），压过一切。
 * 2. 剧本卡 —— `toolName === BRIEF_NODE_TOOL`。必须排在 operationType 之前：
 *    剧本卡的 operationType 是 `import`，与手动导入素材同值。
 * 3. `OPERATION_PRODUCT` —— 与阶段名不同字的产物（角色 / 场景 / 片段 / BGM）。
 * 4. 音频 —— 没有 operationType 的音频节点仍是 BGM（工具生成路径都会写，但
 *    历史节点与手动落卡不保证）。
 * 5. 视频 —— 非成片的视频一律「片段」（与 `stageOfNode` 的「不查 operationType」
 *    同一理由：端点会随供应商换，逐个列举迟早漏一个）。
 * 6. 参考图 —— 标记为参考的素材。
 * 7. 导入 —— 手动素材（`import` 同时是剧本卡的值，故只能排在第 2 条之后）。
 * 8. 阶段名兜底 —— `WORKFLOW_STAGE_LABELS[stage]`。
 * 9. `KIND_PRODUCT` —— 便签 / 文本 / 提示 / 分组。
 *
 * 返回 `null` = 交调用方兜底（目前只有 `kind: 'image'` 且没有任何判据命中的
 * 裸图片节点，客户端用 `KIND_LABEL` 显示「图片」）。
 */
export function productLabelOf(node: StudioCanvasNode): string | null {
  if (isComposeProduct(node)) return WORKFLOW_STAGE_LABELS[STAGE_FILM]
  if (node.toolName === BRIEF_NODE_TOOL) return WORKFLOW_STAGE_LABELS[STAGE_SCRIPT]
  const byOperation = node.operationType === undefined ? undefined : OPERATION_PRODUCT[node.operationType]
  if (byOperation !== undefined) return byOperation
  if (node.kind === 'audio') return KIND_PRODUCT.audio ?? null
  if (node.kind === 'video') return '片段'
  if (node.isReference === true) return '参考'
  if (node.operationType === 'import') return '导入'
  const stage = stageOfNode(node)
  if (stage !== null) return WORKFLOW_STAGE_LABELS[stage] ?? null
  return KIND_PRODUCT[node.kind] ?? null
}

/**
 * 派生当前阶段 + 每阶段产物索引。
 *
 * **已作废 / 被取代的节点照常计入**（它们仍是那一步的产物，聚焦时看到灰显卡片
 * 是有信息量的）；**不可见节点也计入** —— 「看不见」是显隐开关，不是「没做过」。
 */
export function deriveWorkflowStage(
  state: StudioWorkflowState | undefined,
  nodes: readonly StudioCanvasNode[],
): WorkflowStageView {
  const buckets: string[][] = WORKFLOW_STAGE_LABELS.map(() => [])
  let evidence = STAGE_SCRIPT
  for (const node of nodes) {
    const stage = stageOfNode(node)
    if (stage === null) continue
    buckets[stage]!.push(node.id)
    if (stage > evidence) evidence = stage
  }

  const floor = state === undefined ? STAGE_SCRIPT : STATE_FLOOR[state] ?? STAGE_SCRIPT
  const stage = Math.min(WORKFLOW_STAGE_COUNT - 1, Math.max(floor, evidence))

  return {
    stage,
    idsByStage: buckets,
    approvalPending: state !== undefined && APPROVAL_STATES.has(state),
  }
}
