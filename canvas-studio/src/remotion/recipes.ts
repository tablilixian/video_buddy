/**
 * **片型配方（recipe）**：一支片子该有哪些段、每段多长、要什么素材。
 *
 * ## 它解决什么
 *
 * 过去每支片子都从"往空 tracks 里堆"开始：结构靠试、时长靠凑、素材靠边做边找。
 * 会话 #5（187.6 分钟）里这三件事全发生了。recipe 给的是**起点**：
 * 段序列（按权重分时间）+ 每段用哪张卡 + 这段需不需要素材。
 *
 * ## 为什么不是"模板工程"
 *
 * shotcraft 的模板是一支完整 Remotion 工程（含 TSX）。我们的产物是 manifest DSL，
 * 搬不了也不该搬。所以这里只固化**结构**：段 / 权重 / 卡片 / 素材需求。
 * 具体画面由卡片册（`shot-cards.md`）填，配色由主题（`themes.ts`）给。
 *
 * ## 边界
 *
 * - 生成的 tracks 是**合法可渲的最小占位**（每段一张文字卡），不含图片轨 ——
 *   图片必须指向真实素材，占位写不进去（校验会拒）。
 * - 有素材需求的段会在返回里列成 §07 清单片段，让 agent/用户先备齐
 *   （`status:"pending"` 会阻断落地，见 `validateForSeed`）。
 */
import type { StoryboardAssetSource } from '../contracts/storyboard.js'

export interface RecipeAssetNeed {
  /** 素材名（写进 §07 的 `name`）。 */
  readonly name: string
  readonly type: 'image' | 'video'
  readonly source: StoryboardAssetSource
  /** 这条素材服务哪一段（段 id）。 */
  readonly segmentId: string
  /** 为什么需要它 / 拿到之后怎么用。 */
  readonly note: string
}

export interface RecipeSegment {
  readonly id: string
  readonly label: string
  /** 用哪张卡（对应 `shot-cards.md` 的编号，给人看）。 */
  readonly card: string
  /** 时长权重（同一 recipe 内归一化到总时长）。 */
  readonly weight: number
  readonly copy: string
}

export interface Recipe {
  readonly id: string
  readonly title: string
  /** 这套配方适合什么片、有什么注意点。 */
  readonly note: string
  /** 推荐主题（`scaffold_manifest` 的 theme 取值）。 */
  readonly theme: string
  readonly segments: readonly RecipeSegment[]
  readonly assets: readonly RecipeAssetNeed[]
}

export const RECIPES: Readonly<Record<string, Recipe>> = {
  'explainer-cards': {
    id: 'explainer-cards',
    title: '科普图卡（零素材）',
    note: '纯代码绘制，**不需要任何外部素材** —— 适合原理讲解、数据解读、概念拆解。这是最省素材组织成本的一档，超过一半的科普片都能用它。',
    theme: 'cold-tech',
    segments: [
      { id: 'hook', label: '开场提问', card: 'A2 标题逐字', weight: 15, copy: '把观众的问题原样问出来' },
      { id: 'data', label: '数据锚点', card: 'B1 数据卡', weight: 25, copy: '给 2–3 个硬数字建立可信度' },
      { id: 'body', label: '要点展开', card: 'A4 要点逐词', weight: 35, copy: '3–5 条，每条一个动作/因果' },
      { id: 'outro', label: '收尾落版', card: 'A5 收尾落版', weight: 25, copy: '一句结论 + 一个可行动建议' },
    ],
    assets: [],
  },
  'product-walkthrough': {
    id: 'product-walkthrough',
    title: '产品讲解（1 张产品图）',
    note: '左讲解右产品，适合硬件/App 讲解。**只需要 1 张竖构产品图**（最好是干净背景或纯色），其它全靠代码绘制。',
    theme: 'ink-press',
    segments: [
      { id: 'hook', label: '开场定位', card: 'A1 标题遮罩', weight: 15, copy: '一句话说清它解决什么问题' },
      { id: 'showcase', label: '产品亮相', card: 'C2 左右分栏', weight: 30, copy: '左侧讲这屏在做什么，右侧产品图' },
      { id: 'spec', label: '参数对比', card: 'B1 数据卡', weight: 30, copy: '2–3 个关键指标，不要念全表' },
      { id: 'outro', label: '收尾落版', card: 'A5 收尾落版', weight: 25, copy: '价格/上手方式/一句话结论' },
    ],
    assets: [
      {
        name: '产品图（竖构）',
        type: 'image',
        source: 'user',
        segmentId: 'showcase',
        note: '右侧 30–42% 画布宽度，`fit:"contain"` 否则边缘会被裁；如果要"产品图里某块区域填内容"，那是抠图需求，当前没有工具，改用纯色遮罩 + 代码绘制。',
      },
    ],
  },
  'story-arc': {
    id: 'story-arc',
    title: '人物故事（2–4 张实拍/氛围图）',
    note: '有情绪线的叙事片。**素材成本最高的一档**（每段一张图），排期时先确认素材能否拿到，拿不到就退回 `explainer-cards`。',
    theme: 'warm-ember',
    segments: [
      { id: 'hook', label: '开场悬念', card: 'A2 标题逐字', weight: 12, copy: '先给一个反常细节' },
      { id: 'scene1', label: '场景一', card: 'E1 素材推拉', weight: 30, copy: '时间/地点/人物状态' },
      { id: 'scene2', label: '场景二', card: 'E1 素材推拉', weight: 30, copy: '转折发生的那一刻' },
      { id: 'outro', label: '收尾落版', card: 'A5 收尾落版', weight: 28, copy: '回到开场那个细节，给它新含义' },
    ],
    assets: [
      { name: '场景一图', type: 'image', source: 'user', segmentId: 'scene1', note: '氛围/环境图，`fit:"kenburns"` 会缓慢推进 8%。' },
      { name: '场景二图', type: 'image', source: 'user', segmentId: 'scene2', note: '与场景一有明显色温或构图差异，否则看不出转折。' },
    ],
  },
}

export interface RecipePlanInput {
  readonly title: string
  readonly totalFrames: number
  readonly recipe: Recipe
}

export interface RecipePlan {
  readonly tracks: readonly Record<string, unknown>[]
  /** 段的时间轴（人读，也给 agent 对照）。 */
  readonly timeline: readonly { id: string; label: string; card: string; startFrame: number; durationInFrames: number }[]
}

/**
 * 按权重把总时长切给各段，并生成**合法可渲的最小占位轨**（每段一张文字卡）。
 *
 * 时间轴算法刻意简单：前 n-1 段向下取整，余数全给最后一段 —— 保证
 * `Σ = totalFrames`（时长自洽是硬约束，差一帧都会被打回）。
 */
export function planRecipe(input: RecipePlanInput): RecipePlan {
  const { recipe, totalFrames } = input
  const totalWeight = recipe.segments.reduce((sum, segment) => sum + Math.max(0, segment.weight), 0) || 1
  const timeline: { id: string; label: string; card: string; startFrame: number; durationInFrames: number }[] = []
  let cursor = 0
  recipe.segments.forEach((segment, index) => {
    const isLast = index === recipe.segments.length - 1
    const span = isLast
      ? Math.max(1, totalFrames - cursor)
      : Math.max(1, Math.round((Math.max(0, segment.weight) / totalWeight) * totalFrames))
    timeline.push({
      id: segment.id,
      label: segment.label,
      card: segment.card,
      startFrame: cursor,
      durationInFrames: span,
    })
    cursor += span
  })

  const tracks: Record<string, unknown>[] = [
    {
      id: 'bg',
      type: 'shape',
      shape: 'gradient',
      color: '#111827',
      box: { x: 50, y: 50, w: 100, h: 100 },
      startFrame: 0,
      durationInFrames: totalFrames,
      fadeFrames: 0,
    },
    ...recipe.segments.map((segment, index) => {
      const slot = timeline[index] as RecipePlan['timeline'][number]
      // 占位用 `subtitle` variant：它自带压暗与底边定位，不会盖住后面要加的视觉主体。
      return {
        id: `seg-${segment.id}`,
        type: 'textCard',
        variant: 'subtitle',
        text: `【${segment.label}】${segment.copy}`,
        startFrame: slot.startFrame,
        durationInFrames: slot.durationInFrames,
        fadeFrames: 0,
      }
    }),
  ]

  return { tracks, timeline }
}

/** 把配方的素材需求渲染成可直接填进 §07 的 JSON（`pending` ⇒ 会阻断落地）。 */
export function recipeAssetsJson(recipe: Recipe): string {
  if (recipe.assets.length === 0) return '（这套配方不需要外部素材）'
  const assets = recipe.assets.map((asset) => ({
    name: asset.name,
    type: asset.type,
    status: 'pending',
    ref: { kind: 'file', id: '' },
    neededBy: [],
    source: asset.source,
  }))
  return JSON.stringify({ assets }, null, 2)
}
