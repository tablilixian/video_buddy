/**
 * RQ-10（REQ-038）· **卡 → 可执行配方生成器**注册表。
 *
 * ## 它解决什么（需求正本 §2.2 的断点）
 *
 * `recipes.ts` 的 `segments[].card` 早就写好了卡 id（与 `shot-cards.md` 完全对应），
 * 但 `planRecipe()` 不读它 —— 每段只吐一张占位文字卡 ⇒ 产品自产 5.8KB / 16 轨
 * / 0.04 轨/秒（E10）。本模块把断点接上：**注册表 = 卡编号 → 生成器函数**，
 * `planRecipe` 按 `segment.card` 查表生成完整版式轨；**查不到回落占位轨**
 *（老行为逐像素不变 —— RQ-10 验收 1）。
 *
 * ## 素材契约（RQ-21 的卡级机读声明）
 *
 * 每张卡**必须**声明 `assets`（不需要素材就给空数组 —— 「缺声明即校验失败」在
 * `registerCard` 里执行）。`source` 三路（user / library / generated）即 RQ-21 的
 * 分流依据；`fallback` 描述缺素材时的降级（生成器按 `assetSrc(slot) === undefined`
 * 自行落降级版式 —— 缺素材降级出片，不整片停摆）。
 *
 * ## 品牌红线（SB-5）
 *
 * `kind: 'logo' | 'ui'` 的素材 **禁止** `source: 'generated'`（AI 近似重画 = 品牌事故
 * 入口）—— `registerCard` 拒收，红线在注册期就拦住，不留到渲染。
 */

// 副作用 import：装载错误码注册表（throwError 依赖它；模块顶层 registerCard 在加载期就会抛）。
import '../errors/catalog.js'
import { throwError } from '../error-system.js'

/** RQ-21 · 卡级机读素材声明（每张注册卡必带，可空数组）。 */
export interface CardAssetDecl {
  /** 内容槽位名（生成器内 `ctx.assetSrc(slot)` 取用；如 'productImage'）。 */
  readonly slot: string
  readonly kind: 'logo' | 'image' | 'audio' | 'font' | 'ui'
  /** 供给三路（RQ-21）：user = 必须用户给；library = 资产库复用；generated = 可生成。 */
  readonly source: 'user' | 'library' | 'generated'
  /** 是否阻断：true = 没有就该换卡/停下问；false = 按 fallback 降级出片。 */
  readonly required: boolean
  /** 缺素材时的降级策略说明（生成器必须实现对应降级版式）。 */
  readonly fallback?: string
}

/** 卡生成器的上下文（纯数据；时间轴已按权重切好）。 */
export interface CardRenderContext {
  /** 段 id（轨 id 前缀用）。 */
  readonly segmentId: string
  readonly label: string
  readonly copy: string
  /** 段内时间轴（本地坐标已折算成 manifest 绝对帧）。 */
  readonly startFrame: number
  readonly durationInFrames: number
  /** 段序号（0 起）与总段数（角标 '01 / 04' 用）。 */
  readonly index: number
  readonly sectionCount: number
  /** 素材槽位 → 同源 URL。未给（或槽位缺）返回 undefined ⇒ 生成器落降级版式。 */
  readonly assetSrc: (slot: string) => string | undefined
  /** 强调色（主题接线；缺省产品蓝）。 */
  readonly accentColor: string
}

export type CardTrackGenerator = (ctx: CardRenderContext) => Record<string, unknown>[]

export interface CardDefinition {
  /** 卡编号（'A2'；`segment.card` 按空白切分取首段匹配）。 */
  readonly id: string
  readonly title: string
  readonly assets: readonly CardAssetDecl[]
  readonly generate: CardTrackGenerator
}

const REGISTRY = new Map<string, CardDefinition>()

const KNOWN_CARD_KINDS = new Set(['logo', 'image', 'audio', 'font', 'ui'])
const KNOWN_CARD_SOURCES = new Set(['user', 'library', 'generated'])

/**
 * 注册一张卡。冲突 id 抛错（防静默覆盖）；`assets` 缺失抛错（RQ-21「缺声明即校验
 * 失败」的注册期执行）；品牌红线（logo/ui × generated）抛错（SB-5）。
 */
export function registerCard(card: CardDefinition): void {
  // 注册期防呆走 CS-DEV-ERR（开发者错误：模块加载期就炸，不进用户视线）——
  // 静态守卫要求 src/ 零裸 throw，全部收进 error-system。
  const devFail = (detail: string): never => throwError('CS-DEV-ERR', { detail: `registerCard: ${detail}` })
  if (!/^[A-Z]\d+$/.test(card.id)) {
    devFail(`卡编号必须是「字母+数字」形态（如 A2），收到 "${card.id}"`)
  }
  if (REGISTRY.has(card.id)) {
    devFail(`卡 ${card.id} 已注册（${REGISTRY.get(card.id)?.title}），不允许静默覆盖`)
  }
  if (!Array.isArray(card.assets)) {
    devFail(`卡 ${card.id} 缺 assets 声明（不需要素材就给空数组 —— RQ-21 机读契约）`)
  }
  for (const decl of card.assets) {
    if (!KNOWN_CARD_KINDS.has(decl.kind)) {
      devFail(`卡 ${card.id} 的 assets[${decl.slot}].kind 非法（${String(decl.kind)}）`)
    }
    if (!KNOWN_CARD_SOURCES.has(decl.source)) {
      devFail(`卡 ${card.id} 的 assets[${decl.slot}].source 非法（${String(decl.source)}）`)
    }
    if (decl.source === 'generated' && (decl.kind === 'logo' || decl.kind === 'ui')) {
      devFail(`卡 ${card.id} 的 assets[${decl.slot}] 是 ${decl.kind}，禁止 generated 通道（品牌红线 SB-5：logo/UI 禁 AI 近似重画）`)
    }
  }
  REGISTRY.set(card.id, card)
}

/** 查卡（编号精确）。 */
export function getCard(id: string): CardDefinition | undefined {
  return REGISTRY.get(id)
}

/**
 * `segment.card`（如 'A2 标题逐字'）→ 卡编号。按空白切首段；已是纯编号则原样。
 * 查不到返回 null（调用方回落占位轨）。
 */
export function lookupCardId(card: string): string | null {
  const first = card.trim().split(/[\s:：]/)[0] ?? ''
  return /^[A-Z]\d+$/.test(first) && REGISTRY.has(first) ? first : null
}

/** 已注册卡编号（确定性顺序，测试与文档用）。 */
export function registeredCardIds(): string[] {
  return [...REGISTRY.keys()].sort()
}

/** 段轨道通用前缀的 id 拼装（确定性；同段多轨不撞 id）。 */
const tid = (ctx: CardRenderContext, part: string): string => `${ctx.segmentId}-${part}`

/** 段底板（每卡第一轨：段内渐变底，弱化跳变感）。 */
function sectionBase(ctx: CardRenderContext): Record<string, unknown> {
  return {
    id: tid(ctx, 'base'),
    type: 'shape',
    shape: 'gradient',
    color: '#0d1322',
    box: { x: 50, y: 50, w: 100, h: 100 },
    startFrame: ctx.startFrame,
    durationInFrames: ctx.durationInFrames,
    fadeFrames: 0,
  }
}

/** 眉标（小标签：段序 + 段名）。 */
function eyebrow(ctx: CardRenderContext): Record<string, unknown> {
  const num = String(ctx.index + 1).padStart(2, '0')
  return {
    id: tid(ctx, 'eyebrow'),
    type: 'textCard',
    variant: 'subtitle',
    text: `${num} / ${String(ctx.sectionCount).padStart(2, '0')} · ${ctx.label}`,
    box: { x: 50, y: 12, w: 40, h: 6 },
    startFrame: ctx.startFrame + 6,
    durationInFrames: Math.max(6, ctx.durationInFrames - 12),
    fadeFrames: 0,
  }
}

/** 强调装饰线（卡通用第二装饰；accent 色细条）。 */
function accentLine(ctx: CardRenderContext, box: { x: number; y: number; w: number; h: number }): Record<string, unknown> {
  return {
    id: tid(ctx, 'accent'),
    type: 'shape',
    shape: 'rect',
    color: ctx.accentColor,
    box,
    startFrame: ctx.startFrame + 4,
    durationInFrames: Math.max(6, ctx.durationInFrames - 8),
    fadeFrames: 6,
  }
}

/** 段编号角标（左下小字，呼应 eyebrow）。 */
function cornerMark(ctx: CardRenderContext): Record<string, unknown> {
  return {
    id: tid(ctx, 'corner'),
    type: 'textCard',
    variant: 'subtitle',
    text: ctx.copy,
    box: { x: 50, y: 92, w: 70, h: 5 },
    startFrame: ctx.startFrame + 10,
    durationInFrames: Math.max(6, ctx.durationInFrames - 20),
    fadeFrames: 6,
  }
}

/**
 * 段装饰三件套（playsout 设计语言的代码化）：点阵底纹（dotGrid）/ 径向光晕
 *（gradient radial）/ 逐段暗角（vignette）—— 全部消费批 2/3 的原语与 playsout
 * 实测参数量级（光晕 60%/50%、暗角 0.45–0.7 取 0.55）。每卡至少挂 vignette。
 */
function decorDots(ctx: CardRenderContext): Record<string, unknown> {
  return {
    id: tid(ctx, 'dots'),
    type: 'shape',
    shape: 'dotGrid',
    color: 'rgba(152,163,255,0.18)',
    dotSpacing: 28,
    dotRadius: 1.6,
    box: { x: 50, y: 50, w: 100, h: 100 },
    startFrame: ctx.startFrame,
    durationInFrames: ctx.durationInFrames,
    fadeFrames: 0,
  }
}

function decorGlow(ctx: CardRenderContext): Record<string, unknown> {
  return {
    id: tid(ctx, 'glow'),
    type: 'shape',
    shape: 'gradient',
    gradientType: 'radial',
    gradientRadius: { x: 60, y: 50 },
    color: 'rgba(79,156,249,0.16)',
    box: { x: 50, y: 44, w: 100, h: 100 },
    startFrame: ctx.startFrame,
    durationInFrames: ctx.durationInFrames,
    fadeFrames: 0,
  }
}

function decorVignette(ctx: CardRenderContext): Record<string, unknown> {
  return {
    id: tid(ctx, 'vignette'),
    type: 'shape',
    shape: 'vignette',
    color: '#000000',
    strength: 0.55,
    box: { x: 50, y: 50, w: 100, h: 100 },
    startFrame: ctx.startFrame,
    durationInFrames: ctx.durationInFrames,
    fadeFrames: 0,
  }
}

// ─────────────────── 内置卡（`shot-cards.md` A1/A2/A4/A5/B1/C2/E1） ───────────────────

/** 标题卡骨架（A1/A2/A5 共用）：底板 + 点阵 + 光晕 + 眉标 + 主标题 + 装饰线 + 角标 + 暗角。 */
function titleCardTracks(ctx: CardRenderContext, anim: 'maskReveal' | 'typewriter' | undefined, withExit: boolean): Record<string, unknown>[] {
  const dur = ctx.durationInFrames
  const tracks: Record<string, unknown>[] = [
    sectionBase(ctx),
    decorDots(ctx),
    decorGlow(ctx),
    eyebrow(ctx),
    {
      id: tid(ctx, 'title'),
      type: 'textCard',
      variant: 'title',
      text: ctx.copy,
      box: { x: 50, y: 46, w: 76, h: 30 },
      plate: 'none',
      letterSpacingEm: -0.022,
      startFrame: ctx.startFrame + 6,
      durationInFrames: Math.max(12, dur - 12),
      fadeFrames: 0,
      ...(anim === undefined ? {} : { anim }),
      // exit 只动 opacity/scale —— 带 box 的轨位置由 box 决定（exit.to 的 x/y 会被
      // validateManifest 拒收，A5 卡首版踩过：「位置已由 box 决定」）。
      ...(withExit ? { exit: { durationInFrames: Math.max(8, Math.round(dur * 0.24)), to: { opacity: 0, scale: 0.96 } } } : {}),
    },
    accentLine(ctx, { x: 50, y: 66, w: 12, h: 0.8 }),
    cornerMark(ctx),
    decorVignette(ctx),
  ]
  return tracks
}

registerCard({
  id: 'A1',
  title: '标题遮罩揭示',
  assets: [],
  generate: (ctx) => titleCardTracks(ctx, 'maskReveal', false),
})

registerCard({
  id: 'A2',
  title: '标题逐字打出',
  assets: [],
  generate: (ctx) => titleCardTracks(ctx, 'typewriter', false),
})

registerCard({
  id: 'A4',
  title: '要点逐词落位',
  assets: [],
  generate: (ctx) => [
    sectionBase(ctx),
    decorDots(ctx),
    decorGlow(ctx),
    eyebrow(ctx),
    {
      id: tid(ctx, 'bullets'),
      type: 'textCard',
      variant: 'bullets',
      text: ctx.copy.split(/[；;\n]/).map((line) => line.trim()).filter((line) => line.length > 0).slice(0, 6),
      anim: 'wordStagger',
      box: { x: 44, y: 52, w: 64, h: 46 },
      startFrame: ctx.startFrame + 6,
      durationInFrames: Math.max(12, ctx.durationInFrames - 12),
      fadeFrames: 0,
    },
    accentLine(ctx, { x: 50, y: 20, w: 10, h: 0.8 }),
    decorVignette(ctx),
  ],
})

registerCard({
  id: 'A5',
  title: '收尾落版',
  assets: [],
  generate: (ctx) => titleCardTracks(ctx, undefined, true),
})

registerCard({
  id: 'B1',
  title: '数据卡',
  assets: [],
  generate: (ctx) => [
    sectionBase(ctx),
    decorDots(ctx),
    eyebrow(ctx),
    {
      id: tid(ctx, 'data'),
      type: 'textCard',
      variant: 'dataCard',
      text: ctx.label,
      data: ctx.copy.split(/[；;\n]/).map((pair) => pair.trim()).filter((pair) => pair.length > 0).slice(0, 4)
        .map((pair) => {
          const sep = pair.lastIndexOf(':') >= 0 ? pair.lastIndexOf(':') : pair.lastIndexOf('：')
          return sep > 0
            ? { k: pair.slice(0, sep).trim(), v: pair.slice(sep + 1).trim() }
            : { k: pair, v: '—' }
        }),
      accentColor: ctx.accentColor,
      countUp: true,
      box: { x: 50, y: 54, w: 52, h: 56 },
      startFrame: ctx.startFrame + 6,
      durationInFrames: Math.max(12, ctx.durationInFrames - 12),
      fadeFrames: 0,
    },
    accentLine(ctx, { x: 50, y: 18, w: 10, h: 0.8 }),
    decorVignette(ctx),
  ],
})

registerCard({
  id: 'C2',
  title: '左右分栏（讲解 + 视觉主体）',
  assets: [{
    slot: 'mainVisual',
    kind: 'image',
    source: 'user',
    required: false,
    fallback: '缺图降级为纯文字版式（右栏出强调色块占位），出片不阻断 —— RQ-21 fallback 口径',
  }],
  generate: (ctx) => {
    const src = ctx.assetSrc('mainVisual')
    const rightBox = { x: 74, y: 54, w: 34, h: 56 }
    const visual: Record<string, unknown> = src === undefined
      // 降级：强调色块占位（可渲、可见、不冒充真图）。
      ? {
        id: tid(ctx, 'visual-fallback'),
        type: 'shape',
        shape: 'rect',
        color: ctx.accentColor,
        box: rightBox,
        radius: 24,
        startFrame: ctx.startFrame + 6,
        durationInFrames: Math.max(12, ctx.durationInFrames - 12),
        fadeFrames: 6,
      }
      : {
        id: tid(ctx, 'visual'),
        type: 'image',
        src,
        fit: 'contain',
        box: rightBox,
        startFrame: ctx.startFrame + 6,
        durationInFrames: Math.max(12, ctx.durationInFrames - 12),
        fadeFrames: 6,
      }
    return [
      sectionBase(ctx),
      decorDots(ctx),
      eyebrow(ctx),
      {
        id: tid(ctx, 'copy'),
        type: 'textCard',
        variant: 'title',
        text: ctx.copy,
        box: { x: 34, y: 50, w: 44, h: 40 },
        plate: 'none',
        startFrame: ctx.startFrame + 6,
        durationInFrames: Math.max(12, ctx.durationInFrames - 12),
        fadeFrames: 0,
      },
      visual,
      accentLine(ctx, { x: 55, y: 54, w: 0.6, h: 40 }),
      decorVignette(ctx),
    ]
  },
})

registerCard({
  id: 'E1',
  title: '素材推拉',
  assets: [{
    slot: 'scene',
    kind: 'image',
    source: 'user',
    required: false,
    fallback: '缺图降级为标题卡（A2 结构），出片不阻断',
  }],
  generate: (ctx) => {
    const src = ctx.assetSrc('scene')
    if (src === undefined) return titleCardTracks(ctx, 'typewriter', false)
    return [
      {
        id: tid(ctx, 'scene'),
        type: 'image',
        src,
        fit: 'kenburns',
        box: { x: 50, y: 50, w: 100, h: 100 },
        startFrame: ctx.startFrame,
        durationInFrames: ctx.durationInFrames,
        fadeFrames: 0,
      },
      {
        id: tid(ctx, 'scrim'),
        type: 'shape',
        shape: 'vignette',
        color: '#000000',
        strength: 0.55,
        box: { x: 50, y: 50, w: 100, h: 100 },
        startFrame: ctx.startFrame,
        durationInFrames: ctx.durationInFrames,
        fadeFrames: 0,
      },
      eyebrow(ctx),
      {
        id: tid(ctx, 'caption'),
        type: 'textCard',
        variant: 'subtitle',
        text: ctx.copy,
        startFrame: ctx.startFrame + 8,
        durationInFrames: Math.max(10, ctx.durationInFrames - 16),
        fadeFrames: 0,
      },
    ]
  },
})
