/**
 * REQ-034（Remotion 集成）· B1 契约层：`CompositionManifest` 类型与纯函数校验/派生。
 *
 * 技术事实源 = `docs/plans/remotion/remotion-integration-devdoc-2026-10-14.md` §4（v1.3）。
 * 本文件**零 Remotion 依赖**：只有纯数据契约 + 纯函数，两条渲染路线（SSR/CSR）
 * 都复用同一套，故先于 Phase 2/3 落地且不返工。
 *
 * 分层：skill（LLM）产出 JSON 字符串 → `validateManifest` 校验 → 宿主渲染。
 * `audioComposition` **不是** Manifest 输入，由 `deriveAudioComposition` 在宿主侧
 * 派生（避免模型编一个音轨构成骗过校验）。
 *
 * 2026-10-16（CV-334 · B1 批次）三处扩展，都在本文件：
 * 1. **帧级动画**（`VisualState` / `Animate`）：agent 的唯一输出通道是一段 JSON 字符串，
 *    JSON 表达得了*数据*（在哪 / 多久 / 什么色）、表达不了*程序*（怎么随时间变）。
 *    `animate` 就是把这个「程序」压成一段**可校验的声明**（插值本身在 `timing.ts`）。
 * 2. **`transform` 上提到 `BaseTrack`**：此前只有 `VideoClipTrack` 有它 —— 5 种轨里
 *    4 种改不了位置（`Shape` 只有静态 `box`、`TextCard` 位置写死在组件内）。
 * 3. **未知字段 → `warnings`**（不阻断）：此前越界字段**静默丢弃** —— 给 `textCard`
 *    塞 `animation`（少个 e）会得到 `ok=true` / `errors=[]` / `warnings=[]`，成片里
 *    没有动画、且没有任何一方告诉模型。这是最隐蔽的一类限制：不是"做不到"，
 *    是"做不到还不知道"。
 */

import type { StudioAudioComposition } from '../contracts/canvas.js'
import { compositionFromPresence, compositionFromTimeline } from '../audio-timeline.js'
import { timelineFromManifestAudio } from '../audio-compose.js'
import { formatMotionLint, lintMotion } from './motion-lint.js'

/** 成片顶层 Manifest（`render_composition` 的唯一入参结构）。 */
export interface CompositionManifest {
  /** 唯一 id（用 `newAssetId()` 生成，便于血缘与重试）。 */
  id: string
  meta: ManifestMeta
  /** 时间轴轨道（按 `startFrame` 排序后渲染；多轨同帧按数组顺序叠放）。 */
  tracks: CompositionTrack[]
  /** 音频层（可选；复用现有 ffmpeg 混音语义）。 */
  audio?: ManifestAudio
  /** 全局样式（字体 / 主题 / 品牌色）。 */
  global?: ManifestGlobal
}

export interface ManifestMeta {
  title: string
  /** 输出像素（与 `sizeForAspectRatio` 对齐，16:9 默认 1280×720 或 1920×1088）。 */
  width: number
  height: number
  fps: number
  /** 总时长（帧）；= max(track.endFrame)。 */
  durationInFrames: number
  backgroundColor?: string
  /**
   * 三期 W2-4：**全片调色**（对比 / 饱和 / 亮度 / 色温 / 暗角 / 颗粒）。
   *
   * 为什么是全局而不是逐轨 `fx`：调色是「全片统一」的事，逐轨调必然花；缺省不挂任何
   * 滤镜层 ⇒ 老 manifest 逐像素不变。折算在 `timing.ts` 的 `lookStyles`（纯函数）。
   */
  look?: ManifestLook
  /** 三期 W5-3：渲染质量档（也可由工具参数覆盖）。缺省 `standard`。 */
  quality?: RenderQuality
  /** 三期 W1-3：`off` = 跳过编排体检（lint 只告警，模型可显式关）。 */
  lint?: 'off'
}

/** 三期 W5-3：三档质量预设（`draft` 半分辨率 + 低码率；`standard` 与今天完全一致）。 */
export type RenderQuality = 'draft' | 'standard' | 'high'

/**
 * 质量档 → **输出分辨率缩放**（唯一来源，O-12 复用）。
 *
 * 客户端渲染预设（`QUALITY_PRESETS.scale`）与宿主侧的「素材是否被上采样」判定
 * 必须用同一个数：draft 档实际出片是半分辨率，若拿 `meta.width` 原值去判上采样，
 * 864×480 素材进 640×360 的草稿也会被误报成糊片。
 *
 * 放在 `manifest.ts`（纯类型/常量模块）而不是客户端文件：宿主侧不能 import
 * `client/remotion-render.ts`（那会把 `@remotion/web-renderer` 拖进 host bundle）。
 */
export const RENDER_QUALITY_SCALE: Readonly<Record<RenderQuality, number>> = {
  draft: 0.5,
  standard: 1,
  high: 1,
}

/**
 * 三期 W2-4：全片调色参数。全部可选、全部有缺省中性值（缺省 = 不产生任何样式）。
 *
 * - `contrast` / `saturation` / `brightness`：CSS `filter` 倍率（1 = 不变）；
 * - `temperature`：-1（冷）~ 1（暖）。暖 = sepia + 微负角度；冷 = 低饱和 + 微正角度
 *   （角度按强度缩放，OPT-9 修复后不再使用恒定大角度 hue-rotate）；
 * - `vignette`：0–1，四角压暗强度；
 * - `grain`：0–1，胶片颗粒不透明度（按帧整数偏移，逐帧确定）。
 */
export interface ManifestLook {
  contrast?: number
  saturation?: number
  brightness?: number
  temperature?: number
  vignette?: number
  grain?: number
}

/** 轨道联合类型：视频 / 图片 / 文本卡 / 形状 / 转场 / 音频可视化。 */
export type CompositionTrack =
  | VideoClipTrack
  | ImageClipTrack
  | TextCardTrack
  | ShapeTrack
  | TransitionTrack
  | AudioVizTrack

export interface BaseTrack {
  /**
   * 轨道 id（组件层的局部标识）。
   *
   * ⚠️ B1 契约约定（2026-10-16 拍板）：**素材轨（`video` / `image`）的 `id`
   * 必须填该素材的画布节点 id** —— `collectManifestSourceIds` 直接据此产出血缘
   * `sourceIds`（见该函数）。纯呈现轨（`textCard` / `shape` / `transition`）的
   * `id` 是本地 id，不参与血缘。§4.4 示例里的 `t0` 是简化占位，不应照抄到素材轨。
   */
  id: string
  startFrame: number
  durationInFrames: number
  /**
   * 会话效率优化（2026-10-26）· **区域声明 `box`**：把内容约束到画布的一个子区域，
   * 模型不再手算 `transform.scale` + 位移（那一整类几何心算错误由此消灭）。
   *
   * - 语义与 `ShapeTrack` 的既有 `box` 完全同域（本字段就是从那里上提的）：
   *   **0–100 画布百分比，`x` / `y` 是区域中心**（渲染层 `translate(-50%,-50%)`
   *   中心对齐），`w` / `h` 是区域宽高。铺满 = `{x:50,y:50,w:100,h:100}`。
   * - 只对 **video / image / textCard / shape** 生效；`transition` / `audioViz`
   *   给出 `box` 会被 `validateManifest` 拒收（它们的位置由别的字段决定）。
   * - **与位置维度互斥（video / image / textCard）**：`transform.x/y`、`animate` 的
   *   `from.to.x/y`、`exit.to.x/y`、`orbit` 与 `box` 同时声明 ⇒ 报错（位置来源必须唯一，
   *   与 orbit 的 D-02 决策同口径）；`scale` / `rotation` / `opacity` 仍可用（绕区域中心生效）。
   *   **shape 轨豁免**：沿用既有语义（box 是缺省落点，transform/animate 显式 x/y 覆盖之；
   *   出画布也不查 —— 存量示例本有 x:0,y:0 贴边写法），收紧会拒掉历史 manifest。
   * - `shape:'path'` 铺满画布，`box` 不生效（校验层 warning）。
   */
  box?: ManifestBox
  /**
   * 静态变换（百分比坐标系，相对画布）。**5 种轨通用**（CV-334 从 `VideoClipTrack` 上提）。
   *
   * 与 `animate` 的分工：`transform` 是"不动的那个姿势"，`animate` 是"从 A 姿势到 B 姿势"。
   * 两者同时给出时，`animate` 覆盖它声明过的维度，未声明的维度取 `transform` 的值。
   */
  transform?: Transform
  /**
   * 帧级动画（CV-334 新增）：一条或**多条**，多条按数组顺序叠加（后者覆盖前者声明过的维度）。
   *
   * 缺省 = 静止（与 CV-334 之前的全部老写法**行为完全一致**）。插值实现是纯函数
   * `animateStateAt`（`timing.ts`）—— 组件不得自己写插值、更不得用 CSS
   * `transition` / `@keyframes`（逐帧截图走真实时钟 ⇒ 同一份 manifest 渲两次不一样）。
   */
  animate?: Animate | Animate[]
  /**
   * 首尾淡入淡出帧数（CV-334 新增）：`0` = **硬切**；缺省 `DEFAULT_FADE_FRAMES`（6），
   * 即 CV-334 之前的强制行为。此前「硬切」只是 `TextCard` 里 `subtitle` 的**组件内特例**，
   * 契约里没有字段能关 ⇒ 「硬切入场 + 入场动画」这个最基础的组合做不出来。
   */
  fadeFrames?: number
  /**
   * 二期 A1：公转（帧级，纯函数求值）。
   *
   * **与 `transform` / `animate` 的位置维度互斥**：三者只能有一个当位置来源
   * （同时声明 ⇒ `validateManifest` 报错，而不是静默择一 —— 静默择一会让模型
   * 写了 `orbit` 却看到元素不动，误判成渲染 bug）。
   */
  orbit?: OrbitMotion
  /**
   * 二期 A2：视觉效果（`glow` / `stroke` / `shadow` / `blur` / `maskFade`）。
   * 折算在 `animated-style.ts`（唯一接线点），5 类组件共用同一份口径。
   */
  fx?: TrackFx
  /**
   * 三期 W1-1：**退场动画**。缺省无退场（与三期之前完全一致）。
   *
   * `from` 由引擎自动取「入场动画在退场起点处的读数」⇒ 不会跳变；只想写 `to`。
   */
  exit?: ExitMotion
  /**
   * 三期 W1-2：**顺序衔接**。与 `startFrame` 互斥。
   *
   * 解析发生在宿主 `normalizeManifestTiming()`（纯函数），渲染器永远看不到它。
   */
  startAfter?: StartAfter
  /**
   * 三期 W2-5：混合模式（CSS `mix-blend-mode`）。缺省 `normal` ⇒ 不写样式，
   * 老 manifest 像素不变。零运行时成本（GPU 合成）。
   */
  blend?: TrackBlend
  /**
   * 三期 W2-3：**颜色过渡**。作用于 `shape.color` / `textCard.accentColor` /
   * `audioViz.color`；sRGB 线性插值，区间外取端点。
   */
  colorShift?: ColorShift
}

/**
 * 三期 W1-1：退场动画。
 *
 * 区间 = `[dur - gapFrames - durationInFrames, dur - gapFrames)`；`to` 必填，
 * `from` 自动取入场读数。`durationInFrames` 缺省 = 入场时长 × 0.6（clamp 4–12）——
 * 「退场比进场快」是专业动效纪律，不该让模型每次手算。
 */
export interface ExitMotion {
  /** 退场终点（只写想变的维度）。 */
  to: VisualState
  /** 退场耗时（帧）；缺省按入场时长的 0.6 倍推导。 */
  durationInFrames?: number
  /** 缓动（缺省 `easeIn`：退场加速离开，与入场的减速落位互补）。 */
  easing?: AnimateEasing
  /** 距轨道末尾提前结束的帧数（缺省 0 = 贴着轨道末尾退场）。 */
  gapFrames?: number
}

/**
 * 三期 W1-2：顺序衔接 —— 本轨从「另一条轨结束之后」开始。
 *
 * 引用必须指向**数组中更靠前**的轨（天然无环，无需拓扑排序）；与 `startFrame` 互斥。
 *
 * O-08：`gapFrames` **允许负数 = 与引用轨重叠**（`-10` = 重叠 10 帧，正好一个 10 帧
 * 叠化窗口）。原实现强制 `>= 0`，导致 `startAfter` 只能产出相邻/留空，产不出转场
 * 需要的重叠 ⇒ 只要片子用转场，顺序衔接就永远用不上。
 */
export interface StartAfter {
  trackId: string
  /**
   * 两轨之间的空档帧（缺省 0 = 紧接）；**负数 = 与引用轨重叠的帧数**。
   *
   * 解析式始终是 `引用轨.startFrame + 引用轨.durationInFrames + gapFrames`，负号自己
   * 就是减法。要与 `transition` 对齐时长：10 帧叠化就写 `-10`。
   */
  gapFrames?: number
}

/** 三期 W2-5：混合模式白名单（CSS `mix-blend-mode` 的子集）。 */
export type TrackBlend = 'normal' | 'screen' | 'multiply' | 'overlay' | 'soft-light'

/** 三期 W2-3：颜色过渡（sRGB 线性插值）。 */
export interface ColorShift {
  /** 起始色（`#rgb` / `#rrggbb`）。 */
  from: string
  /** 结束色（`#rgb` / `#rrggbb`）。 */
  to: string
  /** 轨内相对起始帧（缺省 0）。 */
  startFrame?: number
  /** 过渡时长（帧，缺省 = 整轨）。 */
  durationInFrames?: number
  /** 缓动（缺省 `easeInOut`）。 */
  easing?: AnimateEasing
}

/**
 * 区域声明（会话效率优化 2026-10-26）：0–100 画布百分比，**`x` / `y` 是区域中心**
 * （与 `Transform.x/y` / `orbit.center` 同域；渲染层 `translate(-50%,-50%)` 中心对齐）。
 * 铺满全屏 = `{x:50,y:50,w:100,h:100}`；右半区 = `{x:71,y:50,w:58,h:100}`。
 */
export interface ManifestBox {
  /** 区域中心的水平位置（0–100 画布百分比）。 */
  x: number
  /** 区域中心的垂直位置（0–100 画布百分比）。 */
  y: number
  /** 区域宽度（0–100 画布百分比）。 */
  w: number
  /** 区域高度（0–100 画布百分比）。 */
  h: number
}

/**
 * 静态变换（百分比坐标系，相对画布）。
 *
 * 帧级插值由 `timing.ts` 的纯函数 `animateStateAt` 负责 —— 本文件零 Remotion 依赖，
 * Host 侧要能算、`node --test` 要能覆盖。（CV-334 之前此处注释写着"组件用
 * `interpolate` 对其做帧级动画"，而 `interpolate` 在全仓只出现于那行注释、从未
 * 被 import —— 注释承诺的能力从没兑现过。这次兑现了，但实现落在纯函数层。）
 */
export interface Transform {
  /** 水平中心位置（0–100，默认 50 居中）。 */
  x?: number
  /** 垂直中心位置（0–100，默认 50 居中）。 */
  y?: number
  /** 缩放倍数，默认 1（必须 > 0）。 */
  scale?: number
  /** 旋转角度（度），默认 0。 */
  rotation?: number
}

/**
 * 帧级视觉状态（CV-334）：`Transform` 的超集，多一个 `opacity`。
 * 全部可选 —— 缺省表示"该维度不变"（取值回落到 `transform` / 组件缺省）。
 */
export interface VisualState {
  /** 水平中心位置（0–100）。 */
  x?: number
  /** 垂直中心位置（0–100）。 */
  y?: number
  /** 缩放倍数（> 0）。 */
  scale?: number
  /** 旋转角度（度）。 */
  rotation?: number
  /** 不透明度（0–1）；与轨道淡入淡出**相乘**（不是覆盖）。 */
  opacity?: number
}

/**
 * 缓动白名单（CV-334；三期 W2-1 扩档）。
 *
 * ⚠️ **只增不改**：老 4 档（`linear` / `easeIn` / `easeOut` / `easeInOut`）的公式一字不动
 * —— 它们决定了历史 manifest 的逐像素结果。新 7 档 + `spring` 是纯追加。
 *
 * 仍然**不开放任意贝塞尔**：模型编非法控制点的概率很高，命名曲线已覆盖 95% 场景。
 */
export type AnimateEasing =
  | 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'
  | 'easeInCubic' | 'easeOutCubic' | 'easeInOutCubic'
  | 'easeOutQuart' | 'easeOutExpo' | 'easeOutCirc' | 'easeInOutExpo'
  | 'backOut'
  | 'spring'

/** 三期 W2-2：spring 物理参数（缺省 170 / 18 / 1 ⇒ ζ≈0.69、过冲约 5%）。 */
export interface SpringConfig {
  /** 刚度（越大越快）。 */
  stiffness?: number
  /** 阻尼（越大越不过冲）。 */
  damping?: number
  /** 质量（越大越慢）。 */
  mass?: number
}

/**
 * 一条帧级动画（CV-334）：轨内**相对帧**区间 `[startFrame, startFrame + durationInFrames)`
 * 内，从 `from` 线性/缓动插值到 `to`；区间之前取 `from`、之后取 `to`（端点收敛）。
 */
export interface Animate {
  /** 起点（必填）。 */
  from: VisualState
  /** 终点（必填）。 */
  to: VisualState
  /** 轨内相对起始帧（缺省 0 —— 即轨道开始）。 */
  startFrame?: number
  /** 动画时长（帧，缺省 = 整轨长）。 */
  durationInFrames?: number
  /** 缓动（缺省 `easeInOut`；`linear` 需显式指定）。 */
  easing?: AnimateEasing
  /** 三期 W2-2：`easing: 'spring'` 时的物理参数（其它缓动下无效）。 */
  spring?: SpringConfig
}

/**
 * 二期 A1：**公转**（关系类动画的一等声明）。
 *
 * 为什么需要一等字段：JSON 表达得了"什么"，表达不了"绕谁转"。此前「行星绕太阳」只能由
 * skill 侧内联上百个关键帧（`motion-helpers.mjs` 手算像素坐标），既贵又易错，且模型
 * 几乎必然写错其中几帧。公转是**帧的函数**，一行声明即可。
 *
 * 求值在 `timing.ts` 的纯函数 `orbitStateAt`（零 Remotion 依赖，Host 可算、可单测）。
 * 坐标系与 `Transform.x/y` 同域：0–100 画布百分比。
 */
export interface OrbitMotion {
  /** 圆心（百分比坐标）。 */
  center: { x: number; y: number }
  /** 半径（与 x/y 同单位，必须 > 0 且 ≤ 100）。 */
  radius: number
  /** 起始角度（度）。0° = 正右（+x），角度增大 = 顺时针（屏幕 y 向下）。缺省 0。 */
  startAngle?: number
  /** 转一圈所需帧数（> 0）。缺省 = 本轨 `durationInFrames`。 */
  periodInFrames?: number
  /** 方向；缺省 `cw`（顺时针）。 */
  direction?: 'cw' | 'ccw'
}

/**
 * 二期 A1：**路径生长**（只用于 `shape:'path'` 轨）。
 *
 * 语义：轨内相对帧 `[startFrame, startFrame + durationInFrames)` 上，描边从 0 长到 `to`；
 * 区间之前为 0、之后恒为 `to`（端点收敛，不跳变）。求值在 `drawProgressAt`（纯函数）。
 */
export interface DrawMotion {
  /** 生长到多少比例（0–1），缺省 1 = 全画出。 */
  to?: number
  /** 轨内相对起始帧（缺省 0）。 */
  startFrame?: number
  /** 生长耗时（帧，缺省 = 整轨）。 */
  durationInFrames?: number
  /** 缓动，沿用 `AnimateEasing` 白名单（缺省 `easeInOut`）。 */
  easing?: AnimateEasing
}

/**
 * 二期 A2：**视觉效果**（单值枚举，不做组合数组 —— 组合会让模型乱搭）。
 *
 * ⚠️ 字段名用 `fx` 而不是 `effect`：`TransitionTrack.effect` 已占用该名
 * （值域 `fade|slide|zoom|dissolve`），同名同层会同时污染类型、`KNOWN_TRACK_KEYS`
 * 与工具描述。折算在 `resolveAnimatedStyle`（唯一接线点），组件只负责贴样式。
 */
export type TrackFx = 'glow' | 'stroke' | 'shadow' | 'blur' | 'maskFade'

export interface VideoClipTrack extends BaseTrack {
  type: 'video'
  /** 同源资产 URL（`/canvas-studio/assets/...`）或本地绝对路径。 */
  src: string
  /** 是否启用 Ken-Burns 缓慢推拉（默认 false）。 */
  kenBurns?: boolean
  /**
   * 三期 W3-1：从源素材第几帧开始用（**输出合成帧**口径；源 fps 不同由宿主换算）。
   * 缺省 0 = 从头。
   */
  trimBeforeFrames?: number
  /** 三期 W3-1：播放速率（0.1–4；0.5 = 慢动作，2 = 快放）。缺省 1。 */
  playbackRate?: number
  /** 三期 W3-1：静音（关掉片段原声）。缺省 false。 */
  muted?: boolean
  /** 三期 W3-1：音量（0–1）。缺省 1。 */
  volume?: number
  /** 三期 W3-1：轨道时长超过素材时循环播放。缺省 false。 */
  loop?: boolean
}

export interface ImageClipTrack extends BaseTrack {
  type: 'image'
  src: string
  /** 图片展示形态：`cover`（默认，填满）/ `contain`（留边）/ `kenburns`。 */
  fit?: 'cover' | 'contain' | 'kenburns'
  caption?: string
}

/** 三期 W4-2：文本动效预设。 */
export type TextAnimPreset = 'fadeUp' | 'maskReveal' | 'typewriter' | 'wordStagger'

/** 三期 W4-2：文本动效参数（全部有缺省值）。 */
export interface TextAnimOptions {
  /** 相邻词/字之间错开多少帧（缺省 3）。 */
  wordDelayFrames?: number
  /** 上浮距离（像素，缺省 14）。 */
  offsetY?: number
  /** 模糊强度（像素，缺省 4；0 = 不模糊）。 */
  blur?: number
}

export interface TextCardTrack extends BaseTrack {
  type: 'textCard'
  /** 卡片样式：字幕条 / 数据卡 / 标题卡 / 要点列表。 */
  variant: 'subtitle' | 'dataCard' | 'title' | 'bullets'
  /** 主文本（`subtitle` / `title` / `bullets` 每行一条）。 */
  text: string | string[]
  /** `dataCard` 专用：键值对（如 `[{k:'全球老龄化',v:'16%'}]`）。 */
  data?: { k: string; v: string }[]
  accentColor?: string
  /** 三期 W4-2：入场文本动效预设（缺省无 —— 与三期之前一致）。 */
  anim?: TextAnimPreset
  /** 三期 W4-2：文本动效参数。 */
  animOptions?: TextAnimOptions
}

export interface ShapeTrack extends BaseTrack {
  type: 'shape'
  /**
   * 形状种类：
   * - 老 4 种（`rect` / `circle` / `line` / `gradient`）保持手写实现**不动**
   *   （换实现 = div→svg，老 manifest 像素会变，违反「旧 manifest 逐帧不变」铁律）；
   * - `path`（二期 A1）：SVG 路径，配 `d` / `strokeWidth` / `draw`；
   * - `arrow` / `triangle` / `star` / `polygon`（二期 A3）：几何由
   *   `shape-geometry.ts` 纯函数算出顶点，再以 `<polygon>` 渲染。
   */
  shape: 'rect' | 'circle' | 'line' | 'gradient' | 'path' | 'arrow' | 'triangle' | 'star' | 'polygon'
  color: string
  // `box` 已上提到 `BaseTrack`（会话效率优化 2026-10-26）——语义不变（0–100、x/y 中心），
  // shape 轨经继承继续持有；`path` 轨铺满画布、`box` 不生效（校验层 warning）。
  /**
   * `shape:'path'` 必填：SVG path 的 `d`。
   *
   * 坐标空间 = **0–100 双轴百分比**（`viewBox="0 0 100 100"` + `preserveAspectRatio="none"`），
   * 与 `box` 同域、**非等比** —— 16:9 画布下正圆的 `rx:ry` 比是 `1 : 0.5625`。
   */
  d?: string
  /** `shape:'path'` 的描边宽度（百分比单位，缺省 0.5；相对 100 单位盒）。 */
  strokeWidth?: number
  /** `shape:'path'` 的生长控制；缺省 = 全画出。 */
  draw?: DrawMotion
}

export interface TransitionTrack extends BaseTrack {
  type: 'transition'
  /**
   * 作用于相邻两轨的转场类型。
   *
   * 老 4 种（`fade` / `slide` / `zoom` / `dissolve`）语义不变；二期 A4 新增
   * `wipeLeft` / `wipeRight`（`clipPath` 硬边推进）、`clock`（polygon 扇形扫描）、
   * `flipX`（2D 压扁翻面）—— 全部按帧求值，**不用** CSS transition。
   * 能力基准 #09 收口（2026-10-31）新增三种无 WebGL 近似转场：`zoomBlur`（径向
   * 模糊推近）/ `linearBlur`（方向模糊横移）/ `crossWarp`（水平挤压交换），
   * 全部 transform + `filter: blur` 白名单内，参数为基准实测值。
   */
  effect: 'fade' | 'slide' | 'zoom' | 'dissolve' | 'wipeLeft' | 'wipeRight' | 'clock' | 'flipX'
    | 'zoomBlur' | 'linearBlur' | 'crossWarp'
  /** 作用的源轨道 id（前一轨）。 */
  fromTrackId: string
  /** 作用的目标轨道 id（后一轨）。 */
  toTrackId: string
  /** 三期 W2-6：转场缓动（缺省沿用各效果的线性推进 —— 老 manifest 不变）。 */
  easing?: AnimateEasing
  /** 三期 W2-6：软化边缘（0–1；0 = 硬边，与今天一致）。只对 wipe 生效。 */
  softness?: number
  /** 三期 W2-6：方向（只对 slide / wipe 生效；缺省按效果自身语义）。 */
  direction?: 'left' | 'right' | 'up' | 'down'
}

/**
 * 二期 B1：**音频可视化**轨（波形 / 频谱柱随音频跳动）。
 *
 * 音频振幅在浏览器侧解码（`AudioViz.tsx` 用原生 `AudioContext.decodeAudioData`），
 * 解码结果只当**数据**喂给纯函数 `waveformBars`（`timing.ts`）决定每帧柱高 ——
 * 组件里不写插值，否则同一 manifest 渲两次柱高可能不同。
 */
export interface AudioVizTrack extends BaseTrack {
  type: 'audioViz'
  /** 音频资产 URL（与 `audio.bgmUrl` 同一套同源约束）。 */
  src: string
  /** 柱数（缺省 24，范围 1–128）。 */
  bars?: number
  /** 柱色（缺省主题蓝）。 */
  color?: string
  /** 形态：`bars`（单向）/ `mirror`（上下对称）/ `line`（连续波形线）。缺省 `bars`。 */
  mode?: 'bars' | 'mirror' | 'line'
  /** 振幅增益（0–4，缺省 1.6；人声/配乐响度差异大，靠它调视觉幅度）。 */
  gain?: number
  /** 波形区高度（占画布高度百分比，缺省 30）。 */
  heightPercent?: number
  /** 贴底还是贴顶（缺省 `bottom`）。 */
  position?: 'bottom' | 'top'
  /** 三期 W3-3：帧间指数平滑（0–0.9；0 = 不平滑，与今天一致）。 */
  smoothing?: number
  /** 三期 W3-3：柱体渐变（缺省纯色）。 */
  gradient?: { from?: string; to?: string }
}

/**
 * O-10：**单条旁白**（多句旁白各占一段时间轴）。
 *
 * 真机症状：三句旁白要落在 2.60 / 7.07 / 11.90 秒，而 `voiceOverUrl` 只收一个文件 ——
 * agent 只能自己用 ffmpeg 拼一条 `voiceover-timeline-v4.mp3`。**终端用户跑不了 ffmpeg**，
 * 于是「多句旁白」这条路对用户是断的。
 */
export interface ManifestVoiceOver {
  /** 旁白资产 URL（`tts_voiceover` 产物，同源约束同 `tracks[].src`）。 */
  src: string
  /** 该句在成片里的起始帧（缺省 0）。 */
  startFrame?: number
  /** 单句音量（0–1）；缺省走 `mix.voiceVolume`（再缺省 1）。 */
  volume?: number
}

export interface ManifestAudio {
  /** BGM 资产 URL（复用 `compose_video` 的 `bgmNodeId` 语义）。 */
  bgmUrl?: string
  /**
   * 旁白资产 URL（`tts_voiceover` 产物）。**单轨兼容入口** —— 只有一句旁白时用这个；
   * 多句请用 `voiceOver` 数组（两者**互斥**，同时给会拒收）。
   */
  voiceOverUrl?: string
  /**
   * O-10：**多轨旁白**。`[{src, startFrame?, volume?}]`，宿主/渲染器按 `startFrame` 排到
   * 时间轴，不需要 agent 自己用 ffmpeg 拼一条长音轨。
   */
  voiceOver?: ManifestVoiceOver[]
  /** 混音音量（0–1），缺省走 `BGM_MIX_VOLUME` / 1.0。 */
  mix?: { bgmVolume?: number; voiceVolume?: number }
  /** 三期 W3-2：BGM 淡入（秒，缺省 0）。 */
  fadeInSeconds?: number
  /** 三期 W3-2：BGM 淡出（秒，缺省 0）。 */
  fadeOutSeconds?: number
  /**
   * 三期 W3-2：BGM 自动闪避（D-09 选 A：以字幕窗口为依据，零音频分析）。
   *
   * 近似说明：旁白间隙不恢复 —— 字幕连续时 BGM 全程压低。
   */
  duck?: { amount?: number }
}

export interface ManifestGlobal {
  /** 缺省字体族名；未随包且未缓存时走 §8 解析/下载链。 */
  fontFamily?: string
  /** 可选：动态字体描述（多语言扩展；随包子集未命中时按需下载并缓存）。 */
  fonts?: ManifestFont[]
  theme?: 'light' | 'dark'
  brandColor?: string
}

export interface ManifestFont {
  /** 字体族名（与 CSS `font-family` / `global.fontFamily` 对应）。 */
  family: string
  /** 字重，默认 400。 */
  weight?: number
  /** 字体文件同源 URL（同 `tracks[].src` 约束）；缺省由宿主字体解析表解析。 */
  src?: string
}

/** 校验结论：`ok=false` 时 `errors` 非空（拒绝渲染）；`warnings` 一律随渲染结果回传。 */
export interface ManifestValidation {
  ok: boolean
  errors: string[]
  warnings: string[]
}

const TRACK_TYPES = new Set(['video', 'image', 'textCard', 'shape', 'transition', 'audioViz'])
const TEXT_VARIANTS = new Set(['subtitle', 'dataCard', 'title', 'bullets'])
const SHAPES = new Set([
  'rect', 'circle', 'line', 'gradient',
  // 二期 A1 / A3
  'path', 'arrow', 'triangle', 'star', 'polygon',
])
const EFFECTS = new Set([
  'fade', 'slide', 'zoom', 'dissolve',
  // 二期 A4
  'wipeLeft', 'wipeRight', 'clock', 'flipX',
  // 能力基准 #09 收口（2026-10-31）：无 WebGL 近似转场
  'zoomBlur', 'linearBlur', 'crossWarp',
])
const IMAGE_FITS = new Set(['cover', 'contain', 'kenburns'])
/** CV-334：缓动白名单（三期 W2-1 扩档；与 `AnimateEasing` 同域，非法值报错而非静默回退）。 */
const ANIMATE_EASINGS = new Set<string>([
  'linear', 'easeIn', 'easeOut', 'easeInOut',
  // 三期 W2-1
  'easeInCubic', 'easeOutCubic', 'easeInOutCubic',
  'easeOutQuart', 'easeOutExpo', 'easeOutCirc', 'easeInOutExpo',
  'backOut',
  // 三期 W2-2
  'spring',
])
/** 二期 A2：视觉效果白名单（与 `TrackFx` 同域）。 */
const TRACK_FX = new Set(['glow', 'stroke', 'shadow', 'blur', 'maskFade'])
/** 二期 A1：公转方向白名单。 */
const ORBIT_DIRECTIONS = new Set(['cw', 'ccw'])
/** 二期 B1：音频可视化形态白名单。 */
const AUDIO_VIZ_MODES = new Set(['bars', 'mirror', 'line'])
/** 三期 W2-5：混合模式白名单。 */
const TRACK_BLENDS = new Set(['normal', 'screen', 'multiply', 'overlay', 'soft-light'])
/** 三期 W2-6：转场方向白名单。 */
const TRANSITION_DIRECTIONS = new Set(['left', 'right', 'up', 'down'])
/** 三期 W4-2：文本动效预设白名单。 */
const TEXT_ANIM_PRESETS = new Set(['fadeUp', 'maskReveal', 'typewriter', 'wordStagger'])
/** 三期 W5-3：质量档白名单。 */
const RENDER_QUALITIES = new Set(['draft', 'standard', 'high'])

/**
 * 同源资产 URL 前缀（`urlToAssetPath` 反查的锚点；`materialize.ts` 物化后的落点）。
 *
 * 导出供 `asset-check.ts` / `materialize.ts` 复用 —— 此前两处各自硬编码过一份，
 * 前缀一旦改动会静默错配。
 */
export const ASSET_URL_PREFIX = '/canvas-studio/assets/'

/**
 * 是否为本仓允许的素材引用（防外链泄露，devdoc §4.3 规则 7）：
 * - 同源资产 URL：以 `/canvas-studio/assets/` 开头；
 * - 本地绝对路径：以 `/` 开头（但不能是 `//host` 协议相对 URL）；
 * - 其余（含任何 `scheme://`、协议相对 `//`）一律拒绝。
 *
 * ⚠️ 本函数**只看形状、不看落点** —— 绝对路径是否真的可用由 `materialize.ts` 判定：
 * route B（CSR）渲染在浏览器环境，只有**本项目资产目录内**的绝对路径能被物化成同源
 * URL；域外路径会被显式拒收（不放行到渲染，避免静默 404）。
 */
export function isAllowedManifestAssetRef(ref: string): boolean {
  if (ref.startsWith(ASSET_URL_PREFIX)) return true
  if (!ref.startsWith('/')) return false
  return !ref.startsWith('//')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

// ─────────────────────── CV-334 · 契约外字段告警（不阻断） ───────────────────────
//
// 背景：工具入参是 `manifest: string`，JSON Schema 管不进字符串内部；`validateManifest`
// 此前只查"已知字段是否合法"，**从不看未知键** ⇒ 模型写 `animation`（少个 e）、
// `enterAnimation`、`motion` 都得到 `ok=true` / `warnings=[]`，模型以为做了动画、
// 成片里没有、没有任何一方告诉它。
//
// 处置：跑完既有校验后追加一趟"契约外字段"扫描，命中即 push 一条 warning。
// **只告警、绝不阻断** —— 老输入里可能带着无伤大雅的额外键，拒收会造出假缺陷。

/** 顶层 / 各层已知键表（用于"契约外字段"告警的唯一事实源）。 */
const KNOWN_MANIFEST_KEYS = new Set(['id', 'meta', 'tracks', 'audio', 'global'])
const KNOWN_META_KEYS = new Set(['title', 'width', 'height', 'fps', 'durationInFrames', 'backgroundColor', 'look', 'quality', 'lint'])
const KNOWN_BASE_TRACK_KEYS = new Set([
  'id', 'type', 'startFrame', 'durationInFrames', 'transform', 'animate', 'fadeFrames',
  // 会话效率优化 2026-10-26：区域声明 box（自 ShapeTrack 上提，video/image/textCard/shape 生效）
  'box',
  // 二期 A1 / A2
  'orbit', 'fx',
  // 三期 W1-1 / W1-2 / W2-3 / W2-5
  'exit', 'startAfter', 'colorShift', 'blend',
])
const KNOWN_TRACK_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  video: new Set(['src', 'kenBurns', 'trimBeforeFrames', 'playbackRate', 'muted', 'volume', 'loop']),
  image: new Set(['src', 'fit', 'caption']),
  textCard: new Set(['variant', 'text', 'data', 'accentColor', 'anim', 'animOptions']),
  shape: new Set(['shape', 'color', 'd', 'strokeWidth', 'draw']),
  transition: new Set(['effect', 'fromTrackId', 'toTrackId', 'easing', 'softness', 'direction']),
  audioViz: new Set(['src', 'bars', 'color', 'mode', 'gain', 'heightPercent', 'position', 'smoothing', 'gradient']),
}
const KNOWN_TRANSFORM_KEYS = new Set(['x', 'y', 'scale', 'rotation'])
const KNOWN_VISUAL_STATE_KEYS = new Set(['x', 'y', 'scale', 'rotation', 'opacity'])
const KNOWN_ANIMATE_KEYS = new Set(['from', 'to', 'startFrame', 'durationInFrames', 'easing', 'spring'])
const KNOWN_ORBIT_KEYS = new Set(['center', 'radius', 'startAngle', 'periodInFrames', 'direction'])
const KNOWN_ORBIT_CENTER_KEYS = new Set(['x', 'y'])
const KNOWN_DRAW_KEYS = new Set(['to', 'startFrame', 'durationInFrames', 'easing'])
const KNOWN_EXIT_KEYS = new Set(['to', 'durationInFrames', 'easing', 'gapFrames'])
const KNOWN_START_AFTER_KEYS = new Set(['trackId', 'gapFrames'])
const KNOWN_COLOR_SHIFT_KEYS = new Set(['from', 'to', 'startFrame', 'durationInFrames', 'easing'])
const KNOWN_LOOK_KEYS = new Set(['contrast', 'saturation', 'brightness', 'temperature', 'vignette', 'grain'])
const KNOWN_TEXT_ANIM_OPTIONS_KEYS = new Set(['wordDelayFrames', 'offsetY', 'blur'])
const KNOWN_SPRING_KEYS = new Set(['stiffness', 'damping', 'mass'])
/** O-10：多轨旁白的条数上限（防一份 manifest 塞进上百条把渲染器音频层压垮）。 */
const MAX_VOICE_OVER_CLIPS = 64

const KNOWN_AUDIO_KEYS = new Set(['bgmUrl', 'voiceOverUrl', 'voiceOver', 'mix', 'fadeInSeconds', 'fadeOutSeconds', 'duck'])
const KNOWN_MIX_KEYS = new Set(['bgmVolume', 'voiceVolume'])
const KNOWN_DUCK_KEYS = new Set(['amount'])
const KNOWN_GLOBAL_KEYS = new Set(['fontFamily', 'fonts', 'theme', 'brandColor'])
const KNOWN_FONT_KEYS = new Set(['family', 'weight', 'src'])

/**
 * 契约外字段告警条数上限：整段写错字段名时（模型偶尔会自造一套命名）不刷屏。
 * 超出部分折成一条汇总，仍然让模型知道"还有 n 处"。
 */
const MAX_UNKNOWN_FIELD_WARNINGS = 12

function warnUnknownKeys(
  value: unknown,
  known: ReadonlySet<string>,
  at: string,
  sink: string[],
): void {
  if (!isRecord(value)) return
  for (const key of Object.keys(value)) {
    if (known.has(key)) continue
    sink.push(`${at} 含契约外字段 "${key}"（已忽略）。请核对字段名与写法 —— 它不会生效。`)
  }
}

/** 扫描全份 manifest 的契约外字段，产出告警（纯函数，不阻断）。 */
export function collectUnknownFieldWarnings(input: unknown): string[] {
  const found: string[] = []
  if (!isRecord(input)) return found

  warnUnknownKeys(input, KNOWN_MANIFEST_KEYS, 'manifest', found)
  warnUnknownKeys(input.meta, KNOWN_META_KEYS, 'meta', found)
  if (isRecord(input.meta) && isRecord(input.meta.look)) {
    warnUnknownKeys(input.meta.look, KNOWN_LOOK_KEYS, 'meta.look', found)
  }

  if (Array.isArray(input.tracks)) {
    for (let i = 0; i < input.tracks.length; i += 1) {
      const track = input.tracks[i]
      const at = `tracks[${i}]`
      if (!isRecord(track)) continue
      // ⚠️ 公共字段与该 kind 专有字段**必须合并成一趟扫描**。分两趟各扫一遍同一个
      // track 对象时，每趟都会把「对方集合里有、自己集合里没有」的字段报成契约外
      // ——合法 manifest 会被报出 18 条假告警（base 趟报 src/fit，extra 趟报
      // id/type/startFrame/durationInFrames，两趟相加恰为全部字段数）。
      const extra = isNonEmptyString(track.type) ? KNOWN_TRACK_KEYS[track.type] : undefined
      const knownTrackKeys =
        extra === undefined ? KNOWN_BASE_TRACK_KEYS : new Set([...KNOWN_BASE_TRACK_KEYS, ...extra])
      warnUnknownKeys(track, knownTrackKeys, at, found)
      warnUnknownKeys(track.transform, KNOWN_TRANSFORM_KEYS, `${at}.transform`, found)
      warnAnimateKeys(track.animate, at, found)
      // 二期 A1：`orbit` / `draw` 的子对象也要扫 —— 否则 `orbit:{centerX:…}` 这类
      // 少一层嵌套的写法会被静默忽略（正是本机制要消灭的那类"做不到还不知道"）。
      if (isRecord(track.orbit)) {
        warnUnknownKeys(track.orbit, KNOWN_ORBIT_KEYS, `${at}.orbit`, found)
        warnUnknownKeys(track.orbit.center, KNOWN_ORBIT_CENTER_KEYS, `${at}.orbit.center`, found)
      }
      if (isRecord(track.draw)) warnUnknownKeys(track.draw, KNOWN_DRAW_KEYS, `${at}.draw`, found)
      // 三期：新增字段的子对象同扫（否则 `exit:{target:{…}}` 会被静默忽略）。
      if (isRecord(track.exit)) warnUnknownKeys(track.exit, KNOWN_EXIT_KEYS, `${at}.exit`, found)
      if (isRecord(track.exit) && isRecord(track.exit.to)) {
        warnUnknownKeys(track.exit.to, KNOWN_VISUAL_STATE_KEYS, `${at}.exit.to`, found)
      }
      if (isRecord(track.startAfter)) {
        warnUnknownKeys(track.startAfter, KNOWN_START_AFTER_KEYS, `${at}.startAfter`, found)
      }
      if (isRecord(track.colorShift)) {
        warnUnknownKeys(track.colorShift, KNOWN_COLOR_SHIFT_KEYS, `${at}.colorShift`, found)
      }
      if (isRecord(track.animOptions)) {
        warnUnknownKeys(track.animOptions, KNOWN_TEXT_ANIM_OPTIONS_KEYS, `${at}.animOptions`, found)
      }
      if (isRecord(track.gradient)) {
        // 渐变只有两个键，单独扫一遍即可（避免把它当成契约外字段整条报掉）。
        for (const key of Object.keys(track.gradient)) {
          if (key !== 'from' && key !== 'to') {
            found.push(`${at}.gradient 含契约外字段 "${key}"（已忽略）。`)
          }
        }
      }
    }
  }

  if (isRecord(input.audio)) {
    warnUnknownKeys(input.audio, KNOWN_AUDIO_KEYS, 'audio', found)
    warnUnknownKeys(input.audio.mix, KNOWN_MIX_KEYS, 'audio.mix', found)
    warnUnknownKeys(input.audio.duck, KNOWN_DUCK_KEYS, 'audio.duck', found)
  }

  if (isRecord(input.global)) {
    warnUnknownKeys(input.global, KNOWN_GLOBAL_KEYS, 'global', found)
    if (Array.isArray(input.global.fonts)) {
      for (let i = 0; i < input.global.fonts.length; i += 1) {
        warnUnknownKeys(input.global.fonts[i], KNOWN_FONT_KEYS, `global.fonts[${i}]`, found)
      }
    }
  }

  if (found.length <= MAX_UNKNOWN_FIELD_WARNINGS) return found
  const head = found.slice(0, MAX_UNKNOWN_FIELD_WARNINGS)
  head.push(`另有 ${found.length - MAX_UNKNOWN_FIELD_WARNINGS} 处契约外字段（已忽略）。`)
  return head
}

function warnAnimateKeys(value: unknown, at: string, sink: string[]): void {
  const list = Array.isArray(value) ? value : [value]
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i]
    if (!isRecord(item)) continue
    const label = Array.isArray(value) ? `${at}.animate[${i}]` : `${at}.animate`
    warnUnknownKeys(item, KNOWN_ANIMATE_KEYS, label, sink)
    warnUnknownKeys(item.from, KNOWN_VISUAL_STATE_KEYS, `${label}.from`, sink)
    warnUnknownKeys(item.to, KNOWN_VISUAL_STATE_KEYS, `${label}.to`, sink)
    if (isRecord(item.spring)) warnUnknownKeys(item.spring, KNOWN_SPRING_KEYS, `${label}.spring`, sink)
  }
}

// ───────────────────────────── CV-334 · animate 校验 ─────────────────────────────

/** 校验一个 `VisualState`（或 `Transform`）的字段取值；`allowOpacity=false` 时禁 `opacity`。 */
function validateVisualStateFields(value: unknown, at: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${at} 必须是对象（如 {"x":50,"y":50,"scale":1}）`)
    return
  }
  for (const key of ['x', 'y', 'rotation'] as const) {
    const raw = value[key]
    if (raw === undefined) continue
    if (typeof raw !== 'number' || !Number.isFinite(raw)) errors.push(`${at}.${key} 必须是有限数`)
  }
  const scale = value.scale
  if (scale !== undefined) {
    if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
      errors.push(`${at}.scale 必须是 > 0 的有限数`)
    }
  }
  const opacity = value.opacity
  if (opacity !== undefined) {
    if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      errors.push(`${at}.opacity 必须是 0–1 的数值`)
    }
  }
}

function validateAnimateList(value: unknown, at: string, errors: string[]): void {
  if (value === undefined) return
  const list = Array.isArray(value) ? value : [value]
  if (list.length === 0) {
    errors.push(`${at}.animate 不能是空数组（不写即为静止）`)
    return
  }
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i]
    const label = Array.isArray(value) ? `${at}.animate[${i}]` : `${at}.animate`
    if (!isRecord(item)) {
      errors.push(`${label} 必须是对象`)
      continue
    }
    if (item.from === undefined) errors.push(`${label}.from 缺失（动画起点必填，写 {} 表示"不覆盖"）`)
    else validateVisualStateFields(item.from, `${label}.from`, errors)
    if (item.to === undefined) errors.push(`${label}.to 缺失（动画终点必填）`)
    else validateVisualStateFields(item.to, `${label}.to`, errors)

    const start = item.startFrame
    if (start !== undefined && (typeof start !== 'number' || !Number.isFinite(start) || start < 0 || !Number.isInteger(start))) {
      errors.push(`${label}.startFrame 必须是 >= 0 的整数（轨内相对帧）`)
    }
    const duration = item.durationInFrames
    if (duration !== undefined && (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || !Number.isInteger(duration))) {
      errors.push(`${label}.durationInFrames 必须是正整数（帧）`)
    }
    const easing = item.easing
    if (easing !== undefined && (typeof easing !== 'string' || !ANIMATE_EASINGS.has(easing))) {
      errors.push(`${label}.easing 非法（${String(easing)}）—— 白名单：${[...ANIMATE_EASINGS].join(' / ')}`)
    }
    if (item.spring !== undefined) validateSpringConfig(item.spring, `${label}.spring`, errors)
  }
}

/** 三期 W2-2：`spring` 物理参数校验（缺省合法；非法值会让归一化时间算出 NaN）。 */
function validateSpringConfig(value: unknown, at: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${at} 必须是对象（如 {"stiffness":170,"damping":18,"mass":1}）`)
    return
  }
  for (const key of ['stiffness', 'damping', 'mass'] as const) {
    const raw = value[key]
    if (raw === undefined) continue
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
      errors.push(`${at}.${key} 必须是 > 0 的有限数`)
    }
  }
}

/**
 * 二期 A1：校验 `orbit`（公转）取值。
 *
 * 防的具体事故：
 * - `radius: 0` ⇒ 元素钉死在圆心（看起来"没动画"）；
 * - `periodInFrames` 缺省且轨道时长非法 ⇒ 除零 ⇒ `NaN` 坐标 ⇒ `translate(NaN%)` 整层消失
 *   （比报错更糟：画面全黑但没有错误信息）；
 * - `center` 越界 ⇒ 元素转到画外，人只会看到"东西不见了"。
 */
function validateOrbitMotion(value: unknown, at: string, trackDuration: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${at}.orbit 必须是对象（如 {"center":{"x":50,"y":50},"radius":22}）`)
    return
  }
  const center = value.center
  if (!isRecord(center)) {
    errors.push(`${at}.orbit.center 必须是对象（{"x":50,"y":50}）`)
  } else {
    for (const key of ['x', 'y'] as const) {
      const raw = center[key]
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 100) {
        errors.push(`${at}.orbit.center.${key} 必须是 0–100 的数值（画布百分比）`)
      }
    }
  }
  const radius = value.radius
  if (typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0 || radius > 100) {
    errors.push(`${at}.orbit.radius 必须是 (0, 100] 的数值（百分比单位），当前为 ${String(radius)}`)
  }
  const startAngle = value.startAngle
  if (startAngle !== undefined && (typeof startAngle !== 'number' || !Number.isFinite(startAngle))) {
    errors.push(`${at}.orbit.startAngle 必须是有限数（度；内部按 360 取模）`)
  }
  const period = value.periodInFrames
  if (period === undefined) {
    const usable = typeof trackDuration === 'number' && Number.isFinite(trackDuration) && trackDuration > 0
    if (!usable) {
      errors.push(`${at}.orbit 未给 periodInFrames，而本轨 durationInFrames 非法（${String(trackDuration)}）—— 请显式给 periodInFrames（正整数帧）`)
    }
  } else if (typeof period !== 'number' || !Number.isFinite(period) || period <= 0) {
    errors.push(`${at}.orbit.periodInFrames 必须是 > 0 的数值（帧）`)
  }
  const direction = value.direction
  if (direction !== undefined && (typeof direction !== 'string' || !ORBIT_DIRECTIONS.has(direction))) {
    errors.push(`${at}.orbit.direction 非法（${String(direction)}）—— 只允许 cw / ccw`)
  }
}

/** 二期 A1：校验 `draw`（路径生长）取值。 */
function validateDrawMotion(value: unknown, at: string, trackDuration: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${at}.draw 必须是对象（如 {"to":1,"easing":"easeInOut"}）`)
    return
  }
  const to = value.to
  if (to !== undefined && (typeof to !== 'number' || !Number.isFinite(to) || to < 0 || to > 1)) {
    errors.push(`${at}.draw.to 必须是 0–1 的数值（生长比例）`)
  }
  const start = value.startFrame
  if (start !== undefined && (typeof start !== 'number' || !Number.isFinite(start) || start < 0 || !Number.isInteger(start))) {
    errors.push(`${at}.draw.startFrame 必须是 >= 0 的整数（轨内相对帧）`)
  }
  const duration = value.durationInFrames
  if (duration !== undefined) {
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || !Number.isInteger(duration)) {
      errors.push(`${at}.draw.durationInFrames 必须是正整数（帧）`)
    }
  } else if (typeof trackDuration !== 'number' || !Number.isFinite(trackDuration) || trackDuration <= 0) {
    errors.push(`${at}.draw 未给 durationInFrames，而本轨 durationInFrames 非法（${String(trackDuration)}）`)
  }
  const easing = value.easing
  if (easing !== undefined && (typeof easing !== 'string' || !ANIMATE_EASINGS.has(easing))) {
    errors.push(`${at}.draw.easing 非法（${String(easing)}）—— 白名单：${[...ANIMATE_EASINGS].join(' / ')}`)
  }
}

// ───────────────────── 三期 · 编排 / 表现力字段校验（W1-1 / W1-2 / W2-3 / W2-5） ─────────────────────

/** 正整数帧校验（缺省合法）。 */
function validatePositiveInteger(value: unknown, at: string, errors: string[], label = '帧'): void {
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    errors.push(`${at} 必须是正整数（${label}）`)
  }
}

/** 非负整数校验（缺省合法）。 */
function validateNonNegativeInteger(value: unknown, at: string, errors: string[]): void {
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    errors.push(`${at} 必须是 >= 0 的整数`)
  }
}

/**
 * 整数帧校验（**允许负值**，缺省合法）。
 *
 * O-08 专用：`startAfter.gapFrames` 的负值有明确语义（= 与引用轨重叠），不能套
 * `validateNonNegativeInteger`。下限不在这里判 —— 「解析出的起始帧不能为负」取决于
 * 引用轨的绝对起点，只有 `normalizeManifestTiming` 知道。
 */
function validateInteger(value: unknown, at: string, errors: string[]): void {
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    errors.push(`${at} 必须是整数（负数 = 与引用轨重叠的帧数）`)
  }
}

/** 三期 W1-1：`exit` 校验。 */
function validateExitMotion(value: unknown, at: string, trackDuration: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${at}.exit 必须是对象（如 {"to":{"opacity":0,"y":44},"durationInFrames":8}）`)
    return
  }
  if (value.to === undefined) errors.push(`${at}.exit.to 缺失（退场终点必填，写 {} 表示"不覆盖"）`)
  else validateVisualStateFields(value.to, `${at}.exit.to`, errors)
  validatePositiveInteger(value.durationInFrames, `${at}.exit.durationInFrames`, errors)
  validateNonNegativeInteger(value.gapFrames, `${at}.exit.gapFrames`, errors)
  const easing = value.easing
  if (easing !== undefined && (typeof easing !== 'string' || !ANIMATE_EASINGS.has(easing))) {
    errors.push(`${at}.exit.easing 非法（${String(easing)}）—— 白名单：${[...ANIMATE_EASINGS].join(' / ')}`)
  }
  const duration = value.durationInFrames
  if (
    typeof duration === 'number' && Number.isFinite(duration) && typeof trackDuration === 'number' &&
    Number.isFinite(trackDuration) && duration > trackDuration
  ) {
    errors.push(`${at}.exit.durationInFrames ${duration} 超过轨道时长 ${trackDuration}`)
  }
}

/** 三期 W1-2：`startAfter` 校验（引用存在性与顺序在归一化阶段判，这里只查形状）。 */
function validateStartAfter(value: unknown, at: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${at}.startAfter 必须是对象（如 {"trackId":"t1","gapFrames":-10}）`)
    return
  }
  if (!isNonEmptyString(value.trackId)) errors.push(`${at}.startAfter.trackId 必须是非空字符串`)
  // O-08：负数合法（= 与引用轨重叠）；写 `-10` 表示与 10 帧转场对齐。
  validateInteger(value.gapFrames, `${at}.startAfter.gapFrames`, errors)
}

/** 三期 W2-3：`colorShift` 校验。 */
function validateColorShift(value: unknown, at: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${at}.colorShift 必须是对象（如 {"from":"#4f9cf9","to":"#ff7a59"}）`)
    return
  }
  for (const key of ['from', 'to'] as const) {
    const raw = value[key]
    if (!isNonEmptyString(raw) || !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/u.test(raw)) {
      errors.push(`${at}.colorShift.${key} 必须是 #rgb 或 #rrggbb 形式的颜色`)
    }
  }
  validateNonNegativeInteger(value.startFrame, `${at}.colorShift.startFrame`, errors)
  validatePositiveInteger(value.durationInFrames, `${at}.colorShift.durationInFrames`, errors)
  const easing = value.easing
  if (easing !== undefined && (typeof easing !== 'string' || !ANIMATE_EASINGS.has(easing))) {
    errors.push(`${at}.colorShift.easing 非法（${String(easing)}）—— 白名单：${[...ANIMATE_EASINGS].join(' / ')}`)
  }
}

/** 三期 W2-4：`meta.look` 校验（全部数值 + 取值域）。 */
function validateLook(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push('meta.look 必须是对象（如 {"contrast":1.06,"vignette":0.35,"grain":0.16}）')
    return
  }
  const ranges: Readonly<Record<string, [number, number]>> = {
    contrast: [0, 4], saturation: [0, 4], brightness: [0, 4],
    temperature: [-1, 1], vignette: [0, 1], grain: [0, 1],
  }
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const raw = value[key]
    if (raw === undefined) continue
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < min || raw > max) {
      errors.push(`meta.look.${key} 必须是 ${min}–${max} 的数值`)
    }
  }
}

/**
 * 二期 A1：位置来源互斥检查（D-02 选 C）。
 *
 * 三者只能有一个决定 `x` / `y`：`orbit` ｜ `transform`（含 `animate` 声明过的维度）｜ 缺省 50/50。
 * 同时声明时**报错而非静默择一** —— 否则模型写了 `orbit`、`animate` 又把 x 钉在起点，
 * 画面整段不动，看起来像渲染 bug。
 */
function orbitPositionConflict(track: Record<string, unknown>): string | null {
  const transform = track.transform
  if (isRecord(transform) && (transform.x !== undefined || transform.y !== undefined)) {
    return '位置已由 orbit 决定，请移除 transform 的 x / y'
  }
  const raw = track.animate
  const list = Array.isArray(raw) ? raw : (raw === undefined ? [] : [raw])
  for (const item of list) {
    if (!isRecord(item)) continue
    for (const side of ['from', 'to'] as const) {
      const state = item[side]
      if (isRecord(state) && (state.x !== undefined || state.y !== undefined)) {
        return '位置已由 orbit 决定，请移除 animate 中 from / to 的 x / y'
      }
    }
  }
  return null
}

// ─────────────────── 会话效率优化 2026-10-26 · `box` 区域声明校验 ───────────────────

/** 浮点容差：x+w 这类求和允许 0.01 的长尾（0–100 百分比域）。 */
const BOX_EDGE_TOLERANCE = 0.01

/**
 * 校验 `box` 区域取值（fail-closed，错误信息自带修正指引 —— 模型收到 rejection
 * 后无需重读文档即可自纠）。
 *
 * 拦的事故：
 * - 单位写错（0–1 比例值：`w:0.58` 会被当成 0.58% 宽，渲染出来一条缝）；
 * - 出画布（内容不可见，人只会看到「东西不见了」）；
 * - 零/负宽高（除法与裁剪都会出 NaN 或空层）。
 */
function validateBoxRegion(value: unknown, at: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${at}.box 必须是对象（如 {"x":71,"y":50,"w":58,"h":100}；x/y 是区域中心，0–100 画布百分比）`)
    return
  }
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    const raw = value[key]
    if (raw === undefined) {
      errors.push(`${at}.box.${key} 缺失（box 必须给全 x/y/w/h 四个分量；x/y 是区域中心，0–100 画布百分比）`)
      continue
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      errors.push(`${at}.box.${key} 必须是有限数（0–100 画布百分比），当前为 ${String(raw)}`)
    }
  }
  const x = value.x
  const y = value.y
  const w = value.w
  const h = value.h
  if (typeof w === 'number' && Number.isFinite(w) && w <= 0) {
    errors.push(`${at}.box.w 必须是 > 0 的数值（画布百分比宽度；右半区写 58，不要写 0.58）`)
  } else if (typeof w === 'number' && Number.isFinite(w) && w > 0 && w <= 1) {
    // 会话效率优化 2026-10-26：0–1 比例值（OPT-2 要拦的典型心算单位错）。≤1% 宽
    //（1280 画布上 ≈13px）在真实布局里不可能是有意为之，宁可拒收让模型改成 58，
    // 也不放行一条 7px 的缝。
    errors.push(`${at}.box.w = ${w} 疑似 0–1 比例值 —— 本契约 box 用 0–100 画布百分比（右半区写 w:58，不是 0.58）`)
  }
  if (typeof h === 'number' && Number.isFinite(h) && h <= 0) {
    errors.push(`${at}.box.h 必须是 > 0 的数值（画布百分比高度）`)
  } else if (typeof h === 'number' && Number.isFinite(h) && h > 0 && h <= 1) {
    errors.push(`${at}.box.h = ${h} 疑似 0–1 比例值 —— 本契约 box 用 0–100 画布百分比（全高写 h:100，不是 1）`)
  }
  if (typeof x === 'number' && Number.isFinite(x) && typeof w === 'number' && Number.isFinite(w) && w > 0) {
    const left = x - w / 2
    const right = x + w / 2
    if (left < -BOX_EDGE_TOLERANCE || right > 100 + BOX_EDGE_TOLERANCE) {
      errors.push(`${at}.box 水平方向出画布：区域 [${left.toFixed(2)}, ${right.toFixed(2)}] 超出 [0, 100]。请缩小 w 或把中心 x 移回画内（右半区示例：x:71, w:58 → [42, 100]）`)
    }
  }
  if (typeof y === 'number' && Number.isFinite(y) && typeof h === 'number' && Number.isFinite(h) && h > 0) {
    const top = y - h / 2
    const bottom = y + h / 2
    if (top < -BOX_EDGE_TOLERANCE || bottom > 100 + BOX_EDGE_TOLERANCE) {
      errors.push(`${at}.box 垂直方向出画布：区域 [${top.toFixed(2)}, ${bottom.toFixed(2)}] 超出 [0, 100]。请缩小 h 或把中心 y 移回画内`)
    }
  }
}

/**
 * `box` 与位置维度的互斥检查（与 orbit 的 D-02 同口径：位置来源必须唯一，
 * 报错而非静默择一 —— 静默择一会让模型看到「写了 box 内容却不动/乱动」）。
 *
 * `box` 在场时：`transform.x/y`、`animate.from/to.x/y`、`exit.to.x/y`、`orbit`
 * 任一出现即冲突；`scale` / `rotation` / `opacity` 不受影响（绕区域中心生效）。
 */
function boxPositionConflict(track: Record<string, unknown>): string | null {
  const transform = track.transform
  if (isRecord(transform) && (transform.x !== undefined || transform.y !== undefined)) {
    return '位置已由 box 决定，请移除 transform 的 x / y（scale / rotation 可保留）'
  }
  const raw = track.animate
  const list = Array.isArray(raw) ? raw : (raw === undefined ? [] : [raw])
  for (const item of list) {
    if (!isRecord(item)) continue
    for (const side of ['from', 'to'] as const) {
      const state = item[side]
      if (isRecord(state) && (state.x !== undefined || state.y !== undefined)) {
        return '位置已由 box 决定，请移除 animate 中 from / to 的 x / y（scale / rotation / opacity 可保留）'
      }
    }
  }
  if (isRecord(track.exit) && isRecord(track.exit.to) &&
    (track.exit.to.x !== undefined || track.exit.to.y !== undefined)) {
    return '位置已由 box 决定，请移除 exit.to 的 x / y（opacity / scale 可保留）'
  }
  if (track.orbit !== undefined) {
    return '位置已由 box 决定，orbit 与 box 不能同时声明（二者都决定位置）'
  }
  return null
}

/**
 * 校验一段未知输入是否为合法 `CompositionManifest`（纯函数）。
 *
 * 规则（devdoc §4.3）：
 * 1. 结构：`meta` 必填，`width/height/fps/durationInFrames` 为有限正数，`tracks` 为数组；
 * 2. 轨道：`id` 非空且唯一、`startFrame >= 0`、`durationInFrames > 0`、`type` 合法；
 * 3. `transition` 的 `fromTrackId` / `toTrackId` 必须存在且不相同；
 * 4. `transition` 的 from/to 两轨必须重叠：首尾相接（无重叠）→ warning（退化为硬切），
 *    完全不相交 → error；
 * 5. 总时长 = max(startFrame + durationInFrames)，与 `meta.durationInFrames` 偏差 > 1 帧 → warning；
 * 6. 任一轨道 `endFrame > meta.durationInFrames` → warning（渲染层按 meta 裁切）；
 * 7. 素材引用必须以 `/canvas-studio/assets/` 开头或为本地绝对路径（防外链）。
 * 8. **CV-334**：`transform` / `animate` / `fadeFrames` 取值合法；**契约外字段 → warning**（不阻断）。
 */
export function validateManifest(input: unknown): ManifestValidation {
  const errors: string[] = []
  const warnings: string[] = []

  if (!isRecord(input)) {
    return { ok: false, errors: ['manifest 必须是 JSON 对象'], warnings }
  }
  if (!isNonEmptyString(input.id)) errors.push('manifest.id 必须是非空字符串')

  const meta = input.meta
  if (!isRecord(meta)) {
    return { ok: false, errors: [...errors, 'manifest.meta 缺失或不是对象'], warnings }
  }
  if (!isNonEmptyString(meta.title)) errors.push('meta.title 必须是非空字符串')
  if (!isFinitePositive(meta.width)) errors.push('meta.width 必须是有限正数')
  if (!isFinitePositive(meta.height)) errors.push('meta.height 必须是有限正数')
  if (!isFinitePositive(meta.fps)) errors.push('meta.fps 必须是有限正数')
  if (!isFinitePositive(meta.durationInFrames) || !Number.isInteger(meta.durationInFrames)) {
    errors.push('meta.durationInFrames 必须是正整数（帧）')
  }
  // 三期 W2-4 / W5-3：全片调色与质量档。
  if (meta.look !== undefined) validateLook(meta.look, errors)
  if (meta.quality !== undefined && (typeof meta.quality !== 'string' || !RENDER_QUALITIES.has(meta.quality))) {
    errors.push(`meta.quality 非法（${String(meta.quality)}）—— 只允许 draft / standard / high`)
  }
  if (meta.lint !== undefined && meta.lint !== 'off') {
    errors.push(`meta.lint 只允许 "off"（缺省开启体检）`)
  }

  if (!Array.isArray(input.tracks)) {
    return { ok: false, errors: [...errors, 'manifest.tracks 必须是数组'], warnings }
  }

  const kindById = new Map<string, string>()
  let maxEnd = 0

  for (let i = 0; i < input.tracks.length; i += 1) {
    const track = input.tracks[i]
    const at = `tracks[${i}]`
    if (!isRecord(track)) {
      errors.push(`${at} 必须是对象`)
      continue
    }
    const id = track.id
    if (!isNonEmptyString(id)) {
      errors.push(`${at}.id 必须是非空字符串`)
    } else if (kindById.has(id)) {
      errors.push(`${at}.id 重复（${id}）：轨道 id 必须唯一`)
    }

    const type = track.type
    if (!isNonEmptyString(type) || !TRACK_TYPES.has(type)) {
      errors.push(`${at}.type 非法（${String(type)}）`)
      continue
    }
    if (isNonEmptyString(id)) kindById.set(id, type)

    const start = track.startFrame
    const duration = track.durationInFrames
    // 三期 W1-2：`startAfter` 与 `startFrame` 互斥；用 `startAfter` 时 startFrame 允许缺省
    //（由 `normalizeManifestTiming` 在渲染前解析）。渲染器看到的 manifest 必有数字 startFrame。
    const usesStartAfter = track.startAfter !== undefined
    if (usesStartAfter) {
      validateStartAfter(track.startAfter, at, errors)
      if (track.startFrame !== undefined) {
        errors.push(`${at} 不能同时给 startFrame 与 startAfter（二选一：绝对帧或顺序衔接）`)
      }
    } else if (typeof start !== 'number' || !Number.isFinite(start) || start < 0 || !Number.isInteger(start)) {
      errors.push(`${at}.startFrame 必须是 >= 0 的整数（帧），或改用 startAfter 顺序衔接`)
    }
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || !Number.isInteger(duration)) {
      errors.push(`${at}.durationInFrames 必须是正整数（帧）`)
    }
    if (
      typeof start === 'number' && Number.isFinite(start) &&
      typeof duration === 'number' && Number.isFinite(duration)
    ) {
      const end = start + duration
      if (end > maxEnd) maxEnd = end
      if (typeof meta.durationInFrames === 'number' && end > meta.durationInFrames) {
        warnings.push(`${at}(${String(id)}) 结束帧 ${end} 超出总时长 ${meta.durationInFrames}，渲染将按 meta 裁切`)
      }
    }

    // CV-334：三处新增字段（5 种轨通用）—— 校验放在类型分支之前，避免各分支各写一遍。
    if (track.transform !== undefined) validateVisualStateFields(track.transform, `${at}.transform`, errors)
    validateAnimateList(track.animate, at, errors)
    const fadeFrames = track.fadeFrames
    if (fadeFrames !== undefined) {
      if (typeof fadeFrames !== 'number' || !Number.isFinite(fadeFrames) || fadeFrames < 0 || !Number.isInteger(fadeFrames)) {
        errors.push(`${at}.fadeFrames 必须是 >= 0 的整数（0 = 硬切）`)
      } else if (typeof duration === 'number' && Number.isFinite(duration) && fadeFrames > duration) {
        warnings.push(`${at}.fadeFrames ${fadeFrames} 超过轨道时长 ${duration}，渲染时按轨道时长折半处理`)
      }
    }

    // 二期 A1 / A2：`orbit` / `fx` 也是「5 种轨通用」的字段，同样放在类型分支之前。
    if (track.orbit !== undefined) {
      validateOrbitMotion(track.orbit, at, duration, errors)
      const conflict = orbitPositionConflict(track)
      if (conflict !== null) errors.push(`${at}(${String(id)}) ${conflict}`)
    }
    if (track.fx !== undefined && (typeof track.fx !== 'string' || !TRACK_FX.has(track.fx))) {
      errors.push(`${at}.fx 非法（${String(track.fx)}）—— 白名单：glow / stroke / shadow / blur / maskFade`)
    }

    // 会话效率优化 2026-10-26：`box` 区域声明（video/image/textCard/shape 生效）。
    // 放在通用字段区（与 transform/orbit 同层），type 此刻已验证过、可直接引用。
    if (track.box !== undefined) {
      if (type === 'transition' || type === 'audioViz') {
        errors.push(`${at}.box 只支持 video / image / textCard / shape 轨（${type} 轨的位置由其它字段决定，box 不适用）`)
      } else {
        // 以下两查只对**新获得 box 的三类轨**生效；shape 保持既有语义不动——
        // ① box 是缺省落点、transform/animate 显式 x/y 时覆盖（manifest-contract.md
        //    「shape 特例表」第 9 条的存量合法写法）；② 契约示例本就有 x:0,y:0 这类
        //    中心落在画外/贴边的写法（orbit 节「直接写 0 即可」）。收紧会拒掉历史 manifest。
        if (type !== 'shape') {
          validateBoxRegion(track.box, at, errors)
          const conflict = boxPositionConflict(track)
          if (conflict !== null) errors.push(`${at}(${String(id)}) ${conflict}`)
        }
        if (type === 'shape' && track.shape === 'path') {
          warnings.push(`${at} 是 shape:'path'（铺满画布），box 不生效（已忽略）`)
        }
      }
    }

    // 三期：`exit` / `blend` / `colorShift` 同样是「所有内容轨通用」的字段。
    if (track.exit !== undefined) validateExitMotion(track.exit, at, duration, errors)
    if (track.blend !== undefined && (typeof track.blend !== 'string' || !TRACK_BLENDS.has(track.blend))) {
      errors.push(`${at}.blend 非法（${String(track.blend)}）—— 白名单：normal / screen / multiply / overlay / soft-light`)
    }
    if (track.colorShift !== undefined) validateColorShift(track.colorShift, at, errors)

    switch (type) {
      case 'video':
      case 'image':
        if (!isNonEmptyString(track.src) || !isAllowedManifestAssetRef(track.src)) {
          errors.push(`${at}.src 必须是 ${ASSET_URL_PREFIX} 开头的同源资产 URL（或以 / 开头的绝对路径，须位于本项目资产目录内，宿主会物化为同源 URL）`)
        }
        if (type === 'image' && track.fit !== undefined && (typeof track.fit !== 'string' || !IMAGE_FITS.has(track.fit))) {
          errors.push(`${at}.fit 非法（${String(track.fit)}）`)
        }
        // 三期 W3-1：裁剪 / 速率 / 静音 / 音量 / 循环（只对 video 有意义）。
        if (type === 'video') {
          validateNonNegativeInteger(track.trimBeforeFrames, `${at}.trimBeforeFrames`, errors)
          const rate = track.playbackRate
          if (rate !== undefined && (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0.1 || rate > 4)) {
            errors.push(`${at}.playbackRate 必须是 0.1–4 的数值`)
          }
          if (track.muted !== undefined && typeof track.muted !== 'boolean') {
            errors.push(`${at}.muted 必须是布尔值`)
          }
          validateUnitInterval(track.volume, `${at}.volume`, errors)
          if (track.loop !== undefined && typeof track.loop !== 'boolean') {
            errors.push(`${at}.loop 必须是布尔值`)
          }
        }
        break
      case 'textCard': {
        if (typeof track.variant !== 'string' || !TEXT_VARIANTS.has(track.variant)) {
          errors.push(`${at}.variant 非法（${String(track.variant)}）`)
        }
        const text = track.text
        const textOk = isNonEmptyString(text) ||
          (Array.isArray(text) && text.length > 0 && text.every((line) => isNonEmptyString(line)))
        if (!textOk) errors.push(`${at}.text 必须是非空字符串或非空字符串数组`)
        // 三期 W4-2：文本动效预设。
        if (track.anim !== undefined && (typeof track.anim !== 'string' || !TEXT_ANIM_PRESETS.has(track.anim))) {
          errors.push(`${at}.anim 非法（${String(track.anim)}）—— 只允许 fadeUp / maskReveal / typewriter / wordStagger`)
        }
        if (track.animOptions !== undefined) {
          if (!isRecord(track.animOptions)) {
            errors.push(`${at}.animOptions 必须是对象`)
          } else {
            validateNonNegativeInteger(track.animOptions.wordDelayFrames, `${at}.animOptions.wordDelayFrames`, errors)
            const offsetY = track.animOptions.offsetY
            if (offsetY !== undefined && (typeof offsetY !== 'number' || !Number.isFinite(offsetY))) {
              errors.push(`${at}.animOptions.offsetY 必须是有限数（像素）`)
            }
            const blur = track.animOptions.blur
            if (blur !== undefined && (typeof blur !== 'number' || !Number.isFinite(blur) || blur < 0 || blur > 32)) {
              errors.push(`${at}.animOptions.blur 必须是 0–32 的数值（像素）`)
            }
          }
        }
        break
      }
      case 'shape': {
        if (typeof track.shape !== 'string' || !SHAPES.has(track.shape)) {
          errors.push(`${at}.shape 非法（${String(track.shape)}）`)
        }
        if (!isNonEmptyString(track.color)) errors.push(`${at}.color 必须是非空字符串`)
        if (track.shape === 'path') {
          if (!isNonEmptyString(track.d)) {
            errors.push(`${at}.d 缺失：shape:'path' 必须给 SVG path 的 d（坐标空间 0–100 双轴百分比）`)
          }
          const strokeWidth = track.strokeWidth
          if (strokeWidth !== undefined) {
            if (typeof strokeWidth !== 'number' || !Number.isFinite(strokeWidth) || strokeWidth <= 0 || strokeWidth > 100) {
              errors.push(`${at}.strokeWidth 必须是 (0, 100] 的数值（百分比单位，缺省 0.5）`)
            }
          }
          if (track.draw !== undefined) validateDrawMotion(track.draw, at, duration, errors)
        } else {
          // 容忍模型冗余：不阻断，但要告诉它"写了也不会生效"（否则成片里没有生长效果却没人说）。
          if (track.d !== undefined) {
            warnings.push(`${at} 是 shape:'${String(track.shape)}'，d 只在 shape:'path' 上生效（已忽略）`)
          }
          if (track.draw !== undefined) {
            warnings.push(`${at} 的 draw 只在 shape:'path' 上生效（已忽略）`)
          }
        }
        break
      }
      case 'audioViz': {
        if (!isNonEmptyString(track.src) || !isAllowedManifestAssetRef(track.src)) {
          errors.push(`${at}.src 必须是 ${ASSET_URL_PREFIX} 开头的同源资产 URL（或以 / 开头的绝对路径，须位于本项目资产目录内）`)
        }
        const bars = track.bars
        if (bars !== undefined) {
          if (typeof bars !== 'number' || !Number.isInteger(bars) || bars < 1 || bars > 128) {
            errors.push(`${at}.bars 必须是 1–128 的整数（柱数）`)
          }
        }
        const mode = track.mode
        if (mode !== undefined && (typeof mode !== 'string' || !AUDIO_VIZ_MODES.has(mode))) {
          // 三期 W3-3 加了 `line`：文案从白名单现算，别再手写一份（手写的那份已经漏了它）。
          errors.push(`${at}.mode 非法（${String(mode)}）—— 只允许 ${[...AUDIO_VIZ_MODES].join(' / ')}`)
        }
        const gain = track.gain
        if (gain !== undefined && (typeof gain !== 'number' || !Number.isFinite(gain) || gain < 0 || gain > 4)) {
          errors.push(`${at}.gain 必须是 0–4 的数值`)
        }
        const heightPercent = track.heightPercent
        if (heightPercent !== undefined && (typeof heightPercent !== 'number' || !Number.isFinite(heightPercent) || heightPercent <= 0 || heightPercent > 100)) {
          errors.push(`${at}.heightPercent 必须是 (0, 100] 的数值（占画布高度百分比）`)
        }
        const position = track.position
        if (position !== undefined && position !== 'bottom' && position !== 'top') {
          errors.push(`${at}.position 只允许 bottom / top`)
        }
        // 三期 W3-3：平滑与渐变。
        const smoothing = track.smoothing
        if (smoothing !== undefined && (typeof smoothing !== 'number' || !Number.isFinite(smoothing) || smoothing < 0 || smoothing > 0.9)) {
          errors.push(`${at}.smoothing 必须是 0–0.9 的数值`)
        }
        if (track.gradient !== undefined) {
          if (!isRecord(track.gradient)) {
            errors.push(`${at}.gradient 必须是对象（如 {"from":"#4f9cf9","to":"#0b1220"}）`)
          } else {
            for (const key of ['from', 'to'] as const) {
              const raw = track.gradient[key]
              if (raw !== undefined && (typeof raw !== 'string' || raw.length === 0)) {
                errors.push(`${at}.gradient.${key} 必须是非空颜色字符串`)
              }
            }
          }
        }
        break
      }
      case 'transition':
        if (typeof track.effect !== 'string' || !EFFECTS.has(track.effect)) {
          errors.push(`${at}.effect 非法（${String(track.effect)}）`)
        }
        if (!isNonEmptyString(track.fromTrackId)) errors.push(`${at}.fromTrackId 必须是非空字符串`)
        if (!isNonEmptyString(track.toTrackId)) errors.push(`${at}.toTrackId 必须是非空字符串`)
        // 三期 W2-6：转场参数化。
        if (track.easing !== undefined && (typeof track.easing !== 'string' || !ANIMATE_EASINGS.has(track.easing))) {
          errors.push(`${at}.easing 非法（${String(track.easing)}）—— 白名单：${[...ANIMATE_EASINGS].join(' / ')}`)
        }
        const softness = track.softness
        if (softness !== undefined && (typeof softness !== 'number' || !Number.isFinite(softness) || softness < 0 || softness > 1)) {
          errors.push(`${at}.softness 必须是 0–1 的数值`)
        }
        if (track.direction !== undefined && (typeof track.direction !== 'string' || !TRANSITION_DIRECTIONS.has(track.direction))) {
          errors.push(`${at}.direction 只允许 left / right / up / down`)
        }
        break
      default:
        break
    }
  }

  if (errors.length === 0 && typeof meta.durationInFrames === 'number') {
    if (Math.abs(maxEnd - meta.durationInFrames) > 1) {
      warnings.push(`轨道总时长 ${maxEnd} 与 meta.durationInFrames ${meta.durationInFrames} 偏差超过 1 帧`)
    }
    validateTransitions(input.tracks, errors, warnings)
  }

  const audio = input.audio
  if (audio !== undefined) {
    if (!isRecord(audio)) {
      errors.push('audio 必须是对象')
    } else {
      validateAssetRefField(audio.bgmUrl, 'audio.bgmUrl', errors)
      validateAssetRefField(audio.voiceOverUrl, 'audio.voiceOverUrl', errors)
      // O-10：多轨旁白。与单轨 `voiceOverUrl` 互斥（同时给会重复播放同一句）。
      if (audio.voiceOver !== undefined) {
        if (audio.voiceOverUrl !== undefined) {
          errors.push('audio.voiceOverUrl 与 audio.voiceOver 二选一（单句用 voiceOverUrl，多句用 voiceOver 数组）')
        }
        if (!Array.isArray(audio.voiceOver)) {
          errors.push('audio.voiceOver 必须是数组（如 [{"src":"…","startFrame":78}]）')
        } else if (audio.voiceOver.length === 0) {
          errors.push('audio.voiceOver 为空数组 —— 没有旁白就不要写这个字段')
        } else if (audio.voiceOver.length > MAX_VOICE_OVER_CLIPS) {
          errors.push(`audio.voiceOver 最多 ${MAX_VOICE_OVER_CLIPS} 条（当前 ${audio.voiceOver.length} 条）`)
        } else {
          audio.voiceOver.forEach((clip, index) => {
            const at = `audio.voiceOver[${index}]`
            if (!isRecord(clip)) {
              errors.push(`${at} 必须是对象（如 {"src":"…","startFrame":0}）`)
              return
            }
            validateAssetRefField(clip.src, `${at}.src`, errors)
            validateNonNegativeInteger(clip.startFrame, `${at}.startFrame`, errors)
            validateUnitInterval(clip.volume, `${at}.volume`, errors)
          })
        }
      }
      // 三期 W3-2：音量包络 + 闪避。
      for (const key of ['fadeInSeconds', 'fadeOutSeconds'] as const) {
        const raw = audio[key]
        if (raw !== undefined && (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 30)) {
          errors.push(`audio.${key} 必须是 0–30 的数值（秒）`)
        }
      }
      if (audio.duck !== undefined) {
        if (!isRecord(audio.duck)) {
          errors.push('audio.duck 必须是对象（如 {"amount":0.55}）')
        } else {
          validateUnitInterval(audio.duck.amount, 'audio.duck.amount', errors)
        }
      }
      const mix = audio.mix
      if (mix !== undefined) {
        if (!isRecord(mix)) {
          errors.push('audio.mix 必须是对象')
        } else {
          validateUnitInterval(mix.bgmVolume, 'audio.mix.bgmVolume', errors)
          validateUnitInterval(mix.voiceVolume, 'audio.mix.voiceVolume', errors)
        }
      }
    }
  }

  const global = input.global
  if (global !== undefined) {
    if (!isRecord(global)) {
      errors.push('global 必须是对象')
    } else {
      if (global.theme !== undefined && global.theme !== 'light' && global.theme !== 'dark') {
        errors.push(`global.theme 非法（${String(global.theme)}）`)
      }
      if (global.fonts !== undefined) {
        if (!Array.isArray(global.fonts)) {
          errors.push('global.fonts 必须是数组')
        } else {
          for (let i = 0; i < global.fonts.length; i += 1) {
            const font = global.fonts[i]
            if (!isRecord(font) || !isNonEmptyString(font.family)) {
              errors.push(`global.fonts[${i}].family 必须是非空字符串`)
              continue
            }
            if (font.src !== undefined) validateAssetRefField(font.src, `global.fonts[${i}].src`, errors)
          }
        }
      }
    }
  }

  // CV-334：契约外字段扫描（**只告警、永不阻断**）。放在最后 —— 它不依赖上面的结论，
  // 且当上面已经报错时这些告警不再是重点，但仍随结果回传，便于模型一次看清全部偏差。
  warnings.push(...collectUnknownFieldWarnings(input))

  // 三期 W1-3：编排体检（只 warning，D-10 选 A）。结构合法之后再跑 —— 结构都错时
  // 再报「6 个元素同帧入场」只会淹没真问题。
  if (errors.length === 0) {
    warnings.push(...formatMotionLint(lintMotion(input as unknown as CompositionManifest)))
    warnings.push(...lintZOrder(input.tracks as unknown[]))
  }

  return { ok: errors.length === 0, errors, warnings }
}

/**
 * OPT-8（2026-10-26）：**z-order 风险体检**（只 warning）。
 *
 * track 数组序 = 层叠序（靠后在上）。无 box 的 video/image 轨铺满画布，排在
 * 内容轨（textCard / shape）之后时，重叠时间段内下方内容会被画面整体盖住 ——
 * 真机实证：全屏视频轨放在 title 卡之后 → 卡片「消失」，agent 只能改轨序绕过。
 * 渲染端底色已改为只跟媒体元素（同日修复），但视频画面本身仍是不透明覆盖，
 * 所以这条体检仍有价值：模型在收稿前就该看到提醒，而不是等渲染返工。
 *
 * 豁免：媒体轨带 box（只覆盖子区域）；下方 shape 的 box 铺满画布（本来就是
 * 全屏背景层，被盖住是预期）；时间不重叠（先后出场互不遮挡）。每条媒体轨只报一次。
 */
function lintZOrder(tracks: unknown[]): string[] {
  const out: string[] = []
  const isMedia = (t: unknown): t is Record<string, unknown> =>
    isRecord(t) && (t.type === 'video' || t.type === 'image')
  const isContent = (t: unknown): t is Record<string, unknown> =>
    isRecord(t) && (t.type === 'textCard' || t.type === 'shape')
  const span = (t: Record<string, unknown>): [number, number] => {
    const start = typeof t.startFrame === 'number' && Number.isFinite(t.startFrame) ? t.startFrame : 0
    const duration = typeof t.durationInFrames === 'number' && Number.isFinite(t.durationInFrames) ? t.durationInFrames : 0
    return [start, start + duration]
  }
  for (let i = 0; i < tracks.length; i += 1) {
    const media = tracks[i]
    if (!isMedia(media) || media.box !== undefined) continue
    const [mStart, mEnd] = span(media)
    for (let j = 0; j < i; j += 1) {
      const below = tracks[j]
      if (!isContent(below)) continue
      if (below.type === 'shape') {
        const box = below.box
        // 全屏背景 shape（无 box 缺省 30×20 也不是全屏；显式铺满才豁免）：
        const full = isRecord(box)
          && typeof box.x === 'number' && typeof box.y === 'number'
          && typeof box.w === 'number' && typeof box.h === 'number'
          && box.w >= 95 && box.h >= 95
        if (full) continue
      }
      const [bStart, bEnd] = span(below)
      if (Math.min(mEnd, bEnd) - Math.max(mStart, bStart) <= 0) continue
      const mid = typeof media.id === 'string' ? media.id : `#${i}`
      const bid = typeof below.id === 'string' ? below.id : `#${j}`
      out.push(
        `z-order 风险：全屏 ${String(media.type)} 轨 "${mid}" 排在内容轨 "${bid}" 之后（数组靠后 = 更上层），重叠时间段内下方内容会被画面盖住 —— `
        + `若需内容浮于视频上，把内容轨移到数组更后；若媒体只该占局部区域，给它加 box`,
      )
      break
    }
  }
  return out
}

/**
 * OPT-15（2026-10-26）：收集**带动画轨的动画窗口表**（纯函数，进渲染报告）。
 *
 * 背景：QC 曾把 maskReveal **动画中段**的标题判成「偏移 ~100px」—— 末帧其实是
 * 居中的，agent 烧了 ~4 轮排查一个不存在的 bug。有了窗口表，agent 拿抽帧的
 * 绝对帧号一对就知道「这帧在动画飞行中」，先看窗口末帧再下结论。
 */
export interface TrackAnimationWindow {
  /** 轨 id。 */
  id: string
  /** 窗口起点（绝对帧）。 */
  start: number
  /** 窗口终点（绝对帧）。 */
  end: number
  /** 动画种类（animate / exit / orbit，按轨实际声明）。 */
  kinds: string[]
}

export function collectAnimationWindows(manifest: CompositionManifest): TrackAnimationWindow[] {
  const out: TrackAnimationWindow[] = []
  for (const track of manifest.tracks) {
    const kinds: string[] = []
    if (track.animate !== undefined) kinds.push('animate')
    if (track.exit !== undefined) kinds.push('exit')
    if (track.orbit !== undefined) kinds.push('orbit')
    if (kinds.length === 0) continue
    const start = track.startFrame
    out.push({ id: track.id, start, end: start + track.durationInFrames, kinds })
  }
  return out
}

/**
 * OPT-11（2026-10-26）：成片音频构成摘要（**纯函数，由 manifest 确定性推导**）。
 *
 * 背景：真机上 agent 为了确认 `muted:true` 是否真静音，要自己 ffprobe 采电平
 * 对比（session 实证 ~1.5min）。其实「成片有没有任何出声源」是 manifest 的
 * 确定性推论，不需要探测 —— 挂进渲染报告后，`audibleSources === 0` 即平台
 * 保证成片无声，agent 无需再做任何音频验证。
 *
 * 统计口径：出声源 = 未 muted 的 video 轨 + `audio.bgmUrl` + `audio.voiceOverUrl`
 * + `audio.voiceOver[]` 条数。image/textCard/shape 天然无声，不计。
 */
export interface ManifestAudioSummary {
  /** 声明了 `muted: true` 的 video 轨数。 */
  mutedVideoTracks: number
  /** 成片可能出声的源数量；`0` ⇒ 成片必然无声（平台保证）。 */
  audibleSources: number
}

export function summarizeManifestAudio(manifest: CompositionManifest): ManifestAudioSummary {
  let mutedVideoTracks = 0
  let audibleSources = 0
  for (const track of manifest.tracks) {
    if (track.type !== 'video') continue
    if (track.muted === true) mutedVideoTracks += 1
    else audibleSources += 1
  }
  const audio = manifest.audio
  if (audio !== undefined) {
    if (audio.bgmUrl !== undefined) audibleSources += 1
    if (audio.voiceOverUrl !== undefined) audibleSources += 1
    if (Array.isArray(audio.voiceOver)) audibleSources += audio.voiceOver.length
  }
  return { mutedVideoTracks, audibleSources }
}

/**
 * CV-360 · manifest **尾部截断**检测（独立纯函数，只在宿主工具入口调用）。
 *
 * 为什么不并进 `validateManifest`：它还被客户端校正路径复用
 * （`client/remotion-render.ts` 的「校正结果必须仍能通过校验，否则保留原样」），
 * 而 ffprobe 真值校正会合法地缩短 video 轨 ⇒ 共享语义下「缩水」可能是正常产物。
 * 截断检测只该拦**工具入口**那份用户声明的 manifest。
 *
 * 判据：`meta.durationInFrames` 应等于全部轨道的最大结束帧（工具说明的明文契约，
 * 字幕规则也要求末句卡到达总时长）。`maxEnd < 总时长` 时，成片尾部就是一段
 * 无内容的背景色 —— 真机上这正是「manifest 被截断后尾部轨道丢失」的症状
 * （CV-360 复盘：宿主校验只查超长不查缩水，截断的 manifest 照样放行烧掉一次渲染）。
 *
 * 结构不合法（缺 meta / 缺 tracks / 非正整数）时返回 null —— 那些由 `validateManifest` 报。
 */
export function manifestTruncationError(input: unknown): string | null {
  if (!isRecord(input)) return null
  const meta = input.meta
  if (!isRecord(meta)) return null
  const total = meta.durationInFrames
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0 || !Array.isArray(input.tracks)) return null
  let maxEnd = 0
  for (const track of input.tracks) {
    if (!isRecord(track)) continue
    const start = track.startFrame
    const duration = track.durationInFrames
    if (typeof start === 'number' && Number.isFinite(start)
      && typeof duration === 'number' && Number.isFinite(duration)) {
      const end = start + duration
      if (end > maxEnd) maxEnd = end
    }
  }
  // maxEnd === 0 ⇒ 没有任何可判定的数字轨，结构问题交给 validateManifest。
  if (maxEnd === 0 || maxEnd >= total) return null
  return `manifest 尾部完整性校验失败：meta.durationInFrames(${total}) 大于全部轨道的最大结束帧(${maxEnd})`
    + `——最后 ${total - maxEnd} 帧没有任何轨道覆盖。两种可能：`
    + `① manifest 尾部轨道被截断（入参过大被截断的典型症状，最常见）；② 总时长多报。`
    + `请核对 tracks[] 是否完整后重传完整 manifest，不要原样重试；`
    + `若尾部空白确属有意（极少见），把 meta.durationInFrames 改成 ${maxEnd} 使其自洽。`
}

function validateTransitions(
  tracks: readonly unknown[],
  errors: string[],
  warnings: string[],
): void {
  const byId = new Map<string, Record<string, unknown>>()
  for (const track of tracks) {
    if (isRecord(track) && isNonEmptyString(track.id)) byId.set(track.id, track)
  }
  for (const track of tracks) {
    if (!isRecord(track) || track.type !== 'transition') continue
    const at = `transition ${String(track.id)}`
    const fromId = track.fromTrackId
    const toId = track.toTrackId
    if (!isNonEmptyString(fromId) || !isNonEmptyString(toId)) continue
    if (fromId === toId) {
      errors.push(`${at}: fromTrackId 与 toTrackId 不能相同`)
      continue
    }
    if (!byId.has(fromId) || !byId.has(toId)) {
      errors.push(`${at}: 引用了不存在的轨道（from=${fromId}, to=${toId}）`)
      continue
    }
    const from = byId.get(fromId)!
    const to = byId.get(toId)!
    const fromStart = from.startFrame
    const toStart = to.startFrame
    // 三期 W1-2：`startAfter` 轨在**归一化之前**没有数值 startFrame。
    // 不跳过的后果是实测过的：`undefined + n = NaN` ⇒ `overlapEnd > overlapStart` 为 false
    // ⇒ 落到「两轨完全不相交」分支，把一份完全合法的 manifest 直接拒收。
    // 真正的重叠判定发生在归一化之后的第二次校验（`render_composition` 正是这么排的）。
    if (typeof fromStart !== 'number' || !Number.isFinite(fromStart) ||
      typeof toStart !== 'number' || !Number.isFinite(toStart)) {
      continue
    }
    const fromEnd = fromStart + (from.durationInFrames as number)
    const toEnd = toStart + (to.durationInFrames as number)
    const overlapStart = Math.max(fromStart, toStart)
    const overlapEnd = Math.min(fromEnd, toEnd)
    if (overlapEnd > overlapStart) {
      const tStart = track.startFrame as number
      const tEnd = tStart + (track.durationInFrames as number)
      if (tEnd <= overlapStart || tStart >= overlapEnd) {
        warnings.push(`${at}: 转场窗口 [${tStart}, ${tEnd}) 不在两轨重叠区 [${overlapStart}, ${overlapEnd})，过渡可能不可见`)
      }
      continue
    }
    if (fromEnd === toStart || toEnd === fromStart) {
      warnings.push(`${at}: from/to 两轨首尾相接无重叠，转场退化为硬切`)
    } else {
      errors.push(`${at}: from/to 两轨完全不相交，转场无意义`)
    }
  }
}

function validateAssetRefField(value: unknown, label: string, errors: string[]): void {
  if (value === undefined) return
  if (!isNonEmptyString(value) || !isAllowedManifestAssetRef(value)) {
    errors.push(`${label} 必须是 /canvas-studio/assets/ 同源 URL 或本地绝对路径`)
  }
}

function validateUnitInterval(value: unknown, label: string, errors: string[]): void {
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    errors.push(`${label} 必须是 0–1 的数值`)
  }
}

/**
 * 宿主侧派生音轨构成（纯函数，落节点前调用；skill/LLM 不产出此值）。
 *
 * S2b 起**改走统一模型**：manifest → `timelineFromManifestAudio`（audio-compose.ts，
 * 与 compose 装配路径的适配器同层）→ `compositionFromTimeline`（同一个派生实现）。
 * 派生结果与旧三布尔口径逐值一致：
 *
 * | 原生声 | BGM | 旁白 | 结论 |
 * |---|---|---|---|
 * | ✓ |   |   | `native` |
 * | ✓ | ✓ |   | `native+bgm` |
 * | ✓ |   | ✓ | `native+voiceOver` |
 * | ✓ | ✓ | ✓ | `native+bgm+voiceOver` |
 * |   | ✓ |   | `bgm` |
 * |   |   | ✓ | `voiceOver` |
 * |   | ✓ | ✓ | `bgm+voiceOver` |
 * |   |   |   | `none` |
 */
export function deriveAudioComposition(manifest: CompositionManifest): StudioAudioComposition {
  return compositionFromTimeline(timelineFromManifestAudio(manifest))
}

/**
 * O-10：是否带旁白（单轨 `voiceOverUrl` 或多轨 `voiceOver[]` 任一非空）。
 *
 * 单独抽出来是因为三个消费方（音轨构成、幻灯片风险评分、工具结果文案）都要同一个
 * 结论；散写三份 `voiceOverUrl !== undefined` 必然在加多轨那天漏一处。
 */
export function hasVoiceOverAudio(audio: ManifestAudio | undefined): boolean {
  if (audio === undefined) return false
  if (isNonEmptyString(audio.voiceOverUrl)) return true
  return Array.isArray(audio.voiceOver) && audio.voiceOver.some((clip) => isNonEmptyString(clip.src))
}

/**
 * 三布尔 → 8 值音轨构成的**兼容包装**（CV-334 · D6 引入；S1 起分类实现迁往
 * `src/audio-timeline.ts` 的 `compositionFromPresence` —— 时间轴成为唯一事实源后，
 * 三布尔是它的退化入参，保留本签名让既有调用点/老单测不动）。
 *
 * 为什么单独抽出来：`compose_video`（ffmpeg 拼接路径）与 `render_composition`
 * （manifest 路径）都要报「音轨构成」，而角标文案与工具结果必须说同一句话 ——
 * 两份 if 链一旦分叉，模型读到的和用户看到的就会不一致（这正是 D6 的原始症状）。
 * 两条路径都经它（或它指向的唯一实现），判定只有一处。
 */
export function audioCompositionFrom(input: {
  hasNative: boolean
  hasBgm: boolean
  hasVoiceOver: boolean
}): StudioAudioComposition {
  return compositionFromPresence(input)
}

/**
 * 收集 Manifest 引用的素材画布节点 id（用于 `appendComposedVideoNode` 的血缘 `sourceIds`）。
 *
 * B1 契约约定：`video` / `image` 轨的 `id` 即素材画布节点 id（见 `BaseTrack.id`），
 * 按轨道顺序去重返回；纯呈现轨（`textCard` / `shape` / `transition`）不参与血缘。
 * 音频（`audio.bgmUrl` / `voiceOverUrl`）只有 URL、无节点 id，故不并入。
 */
export function collectManifestSourceIds(manifest: CompositionManifest): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const track of manifest.tracks) {
    if (track.type !== 'video' && track.type !== 'image') continue
    if (seen.has(track.id)) continue
    seen.add(track.id)
    ids.push(track.id)
  }
  return ids
}
