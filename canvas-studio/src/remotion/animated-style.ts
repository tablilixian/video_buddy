/**
 * CV-334 · B1：帧级动画的**唯一接线点** —— 轨道 → 可直接落进 style 的视觉读数。
 *
 * 计划里这一处叫 `useAnimatedStyle(track, frame)`；实现落成**纯函数**
 * （`resolveAnimatedStyle`），理由与本仓 `timing.ts` 头注一致：把行为抽成纯函数
 * 才能被 `node --test` / `scripts/probe-*.mjs` 直接覆盖。组件里只剩一行取值，
 * `use*` 前缀换不来任何东西，反而把这段逻辑锁进浏览器环境。
 *
 * 它同时消化两件事（此前由各组件各写一遍）：
 * 1. **首尾淡入淡出**（`track.fadeFrames`，`0` = 硬切；缺省 `DEFAULT_FADE_FRAMES`）；
 * 2. **`track.transform` + `track.animate` 的插值**（`animateStateAt`），并把它折算成
 *    铺满层可直接使用的 `transform` 串。
 *
 * 坐标语义（一次说清，四个组件共用）：
 * `x` / `y` 是**画布百分比坐标里的中心位置**（缺省 50/50 = 画布中心）。对铺满画布的
 * 层（video / image / textCard），「把内容从中心移到 (x, y)」在数学上就是
 * `translate((x-50)%, (y-50)%)` —— `%` 的基准是层自身尺寸，而铺满层的尺寸就是画布。
 * 于是**缺省参数下整串是恒等的**，与 CV-334 之前的渲染结果逐像素一致。
 */
import type { BaseTrack, TrackBlend } from './manifest.js'
import {
  DEFAULT_FADE_FRAMES,
  animateStateAt,
  exitStateAt,
  fadeInOnlyOpacity,
  fadeOpacity,
  fxStyles,
  orbitStateAt,
  type FxStyle,
} from './timing.js'

export interface AnimatedStyle {
  /** 合成不透明度：淡入淡出 × `animate.opacity` × `exit.opacity`，已 clamp 到 0–1。 */
  opacity: number
  /** 水平中心位置（画布百分比，缺省 50）。 */
  x: number
  /** 垂直中心位置（画布百分比，缺省 50）。 */
  y: number
  /** 最终缩放倍数（含 `extraScale`，缺省 1）。 */
  scale: number
  /** 最终旋转角度（度，缺省 0）。 */
  rotation: number
  /**
   * 铺满层（`AbsoluteFill`）上的整层变换串：
   * `translate((x-50)%, (y-50)%) scale(s) rotate(rdeg)`。
   * 缺省参数下为 `translate(0%, 0%) scale(1) rotate(0deg)`（恒等）。
   */
  layerTransform: string
  /** 不含位移的变换串 `scale(s) rotate(rdeg)`（`shape` 这类自定位元素用）。 */
  shapeTransform: string
  /** 本轨是否**显式声明过**位置（`shape` 据此决定是否覆盖 `box` 的落点）。 */
  positionDeclared: boolean
  /** 本轨是否声明过 `transform` / `animate` / `orbit` / `exit`（诊断与守卫用）。 */
  animated: boolean
  /** 二期 A2：`fx` 折算出的 CSS 片段（空对象 = 没有效果）。组件只展开，不解读枚举。 */
  fx: FxStyle
  /** 三期 W2-5：混合模式（`normal` = 不写样式）。 */
  blend: TrackBlend
  /** 三期 W1-1：是否正处于退场区间（诊断用）。 */
  exiting: boolean
}

export interface ResolveAnimatedStyleOptions {
  /**
   * 轨道未声明 `fadeFrames` 时的缺省淡入淡出帧数。
   *
   * `textCard` 的 `subtitle` 变体传 `0` —— 字幕卡按句首尾相接排布，两卡各带淡入淡出
   * 会让接缝处前后两卡同时透明（2026-10-16 实测叠合不透明度 `0.00` ⇒ 每句闪一次背景）。
   * CV-334 起这条**组件内特例**收敛为契约能力 `fadeFrames: 0` 的等价物。
   *
   * 显式带 `| undefined`：本仓开了 `exactOptionalPropertyTypes`，调用方常按变体条件传值。
   */
  defaultFadeFrames?: number | undefined
  /**
   * 额外缩放，与动画 `scale` **相乘**：`image` / `video` 的 Ken-Burns 缓推走这里
   * （这样"缓推 + 入场缩放"能叠加，而不是互相覆盖）。
   */
  extraScale?: number | undefined
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 1
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

/**
 * 解析一条轨道在**轨内相对帧** `localFrame` 处的最终视觉读数（纯函数）。
 *
 * ⚠️ 组件必须传**轨内相对帧**（被 `<Sequence>` 包裹时 `useCurrentFrame()` 即是），
 * 与 `BaseTrack.startFrame` 的口径一致；传绝对帧会让整段动画前移。
 */
export function resolveAnimatedStyle(
  track: BaseTrack,
  localFrame: number,
  options: ResolveAnimatedStyleOptions = {},
): AnimatedStyle {
  const duration = Math.max(1, Math.floor(track.durationInFrames))
  const fadeFrames = track.fadeFrames ?? options.defaultFadeFrames ?? DEFAULT_FADE_FRAMES
  const state = animateStateAt(track, localFrame)
  // 三期 W1-1：退场是**覆盖层**（不进 `animateStateAt`，避免污染入场语义）。
  // `from` 取入场读数 ⇒ 退场首帧与入场末帧连续（V2）；存在退场时尾部淡出让位，
  // 否则两个淡出叠加会「灰一下」。
  const exitState = exitStateAt(track, localFrame)
  const fade = track.exit !== undefined
    ? fadeInOnlyOpacity(localFrame, duration, fadeFrames)
    : fadeOpacity(localFrame, duration, fadeFrames)
  // 二期 A1（D-02 选 C）：位置来源**三选一互斥** —— orbit ＞ transform/animate ＞ 缺省 50/50。
  // 契约层已把「orbit 与 transform/animate 的 x/y 同时出现」判为 error，这里只剩优先级。
  // 取 orbit 的**帧值**（不是偏移量）：两者语义都是「画布百分比里的中心位置」，叠加会变成
  // 两套坐标系（模型算不清、人也算不清）。
  const orbitPoint = orbitStateAt(track, localFrame)
  const x = exitState?.x ?? (orbitPoint !== null ? orbitPoint.x : (state.x ?? 50))
  const y = exitState?.y ?? (orbitPoint !== null ? orbitPoint.y : (state.y ?? 50))
  const scale = Math.max(0.0001, (exitState?.scale ?? state.scale ?? 1) * (options.extraScale ?? 1))
  const rotation = exitState?.rotation ?? state.rotation ?? 0
  const opacity = clampUnit(fade * (exitState?.opacity ?? state.opacity ?? 1))
  const declared = track.animate !== undefined || track.transform !== undefined || track.orbit !== undefined
  const exitDeclaresPosition = exitState !== null && (exitState.x !== undefined || exitState.y !== undefined)
  return {
    opacity,
    x,
    y,
    scale,
    rotation,
    layerTransform: `translate(${x - 50}%, ${y - 50}%) scale(${scale}) rotate(${rotation}deg)`,
    shapeTransform: `scale(${scale}) rotate(${rotation}deg)`,
    // orbit 时位置同样"已声明"：否则 `Shape.tsx` 仍用 `box` 落点，orbit 白算（这条曾在计划里被点名）。
    positionDeclared: exitDeclaresPosition || orbitPoint !== null || (declared && (state.x !== undefined || state.y !== undefined)),
    animated: declared || track.exit !== undefined,
    fx: fxStyles(track.fx),
    blend: track.blend ?? 'normal',
    exiting: exitState !== null,
  }
}
