/**
 * 生成队列的**对外形状**、归一化与 UI 文案（纯函数，无状态）。CV-220。
 *
 * ## 为什么与 `generate-queue.ts` 分开
 *
 * 形状与文案要**同时**被两侧使用：Host（路由下发快照）与 Client（画布遮罩显示）。
 * 而 `generate-queue.ts` 里挂着宿主进程级的队列实例 —— 客户端不该把宿主的队列
 * 状态带进浏览器 bundle，只该拿到「形状 + 纯函数」。于是这里只留数据与推导。
 *
 * ## 为什么没有「busy」这个字段
 *
 * 「忙不忙」完全由 `active` / `waiting` 决定。若当成独立字段下发，就存在
 * 「字段与内容互相矛盾」的状态（后端算错、序列化丢字段、中间层改写），而 UI 信谁
 * 都有一半会错。所以快照里**只有事实**（谁在执行、谁在等），派生只在
 * {@link generationQueueStateOf} 里做一次，且它对外只回答「要不要显示队列」。
 *
 * ## 为什么只给「队列全景」而不是「本节点第 N 位」
 *
 * 快照里的 `position` 是**全局队列内**的位次，而客户端只看得到「自己发起的这批
 * 请求」，看不到模型同回合发起的调用、也看不到失败未入队的调用 —— 把全局位次硬贴
 * 到某个节点上就是**假精度**（同一次刷新里两个节点可能都显示「第 2 位」）。
 *
 * 所以这里如实展示**队列全景**（谁在执行、还有几个在等）。要做到逐节点的准确
 * 位次，需要给请求加一条 `客户端 requestId → 队列条目` 的归属通道（当前刻意不做）。
 */

/** 队列里的一个条目。 */
export interface GenerateQueueEntry {
  /** 稳定 id（仅用于 UI 区分条目与测试断言，无业务含义）。 */
  readonly id: string
  /** 人类可读标签（如「视频生成」）。**由调用点派生**，本模块不解释其内容。 */
  readonly label: string
  /**
   * 1 起的位次：1 = 已排到最前、下一个就轮到它。
   * **执行中的条目恒为 0**（UI 对 0 显示「生成中」、对 ≥1 显示「排队中」）。
   */
  readonly position: number
}

/** 队列快照：**只有事实**，不含任何派生布尔（见文件头）。 */
export interface GenerateQueueSnapshot {
  /** 正在执行的那一个；空闲为 `null`。 */
  readonly active: GenerateQueueEntry | null
  /** 等待中的条目，按 FIFO 次序（`position` 递增）。 */
  readonly waiting: readonly GenerateQueueEntry[]
}

/**
 * 客户端 store 里保留的最小投影。
 *
 * **不变式：本类型存在 ⇒ `waiting ≥ 1`**（生产者 {@link generationQueueStateOf}
 * 只在这种情况下返回它）。所以 `active` 一定是具体标签，不需要可空 —— 若允许
 * 可空，`generationQueueNote` 里就会长出一条永远不会走到的兜底分支。
 */
export interface GenerationQueueState {
  /** 正在执行的那一个的标签。 */
  readonly active: string
  /** 等待中的数量（不含执行中的那一个），恒 ≥ 1。 */
  readonly waiting: number
}

function entryOf(value: unknown): GenerateQueueEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as { id?: unknown; label?: unknown; position?: unknown }
  if (typeof raw.id !== 'string' || typeof raw.label !== 'string') return null
  if (typeof raw.position !== 'number' || !Number.isFinite(raw.position)) return null
  return { id: raw.id, label: raw.label, position: raw.position }
}

/**
 * 归一化 HTTP 响应体（客户端轮询用）。
 *
 * 形状不对 ⇒ `null`（**不**降级成「空队列」）：空队列意味着「没有生成在跑」，
 * 那是个会误导 UI 的强断言；拿不准时返回 `null`，调用方保持上一拍状态即可。
 */
export function normalizeGenerateQueueSnapshot(value: unknown): GenerateQueueSnapshot | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as { active?: unknown; waiting?: unknown }
  const active = raw.active === null || raw.active === undefined ? null : entryOf(raw.active)
  if (raw.active !== null && raw.active !== undefined && active === null) return null
  if (!Array.isArray(raw.waiting)) return null
  const waiting: GenerateQueueEntry[] = []
  for (const item of raw.waiting) {
    const entry = entryOf(item)
    if (entry === null) return null
    waiting.push(entry)
  }
  return { active, waiting }
}

/**
 * 快照 → 客户端状态。**只有「真的有等待」才非 null**（不变式见
 * {@link GenerationQueueState}）。
 *
 * 为什么「没有等待」也返回 `null` 而不是一个 `waiting: 0` 的对象：轮询每 2s 一次，
 * 每次现造对象都会让 store 里这个字段换引用 ⇒ 所有订阅者每 2s 白重渲染一次。
 * 返回 `null` 既省掉这份churn，也让「只有一个请求在跑」这个常见情况完全不进 UI。
 *
 * 形状矛盾（有等待却没有执行者）同样返回 `null`：这是**唯一**做一致性判定的地方，
 * 下游因此不必再写兜底分支。
 */
export function generationQueueStateOf(
  snapshot: GenerateQueueSnapshot | null,
): GenerationQueueState | null {
  if (snapshot === null) return null
  if (snapshot.waiting.length <= 0) return null
  if (snapshot.active === null) return null
  return { active: snapshot.active.label, waiting: snapshot.waiting.length }
}

/**
 * 遮罩上的一句话（`null` = 不显示）。**UI 文案的唯一来源**。
 *
 * 文案刻意短（节点体区宽度约 260px，`.csNodeOverlayHint` 是单行小字）：
 * `生成队列：视频生成 · 等待 2 个`。带标签是有用的部分 —— 它回答的不是
 * 「我排第几」（那需要请求归属，见文件头），而是「**谁占着唯一那条通道**」，
 * 用户一眼就知道卡住自己的不是这张卡。
 */
export function generationQueueNote(state: GenerationQueueState | null): string | null {
  if (state === null) return null
  return `生成队列：${state.active} · 等待 ${state.waiting} 个`
}
