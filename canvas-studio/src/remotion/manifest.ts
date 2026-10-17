/**
 * REQ-034（Remotion 集成）· B1 契约层：`CompositionManifest` 类型与纯函数校验/派生。
 *
 * 技术事实源 = 仓根 `remotion-integration-devdoc-2026-10-14.md` §4（v1.3）。
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
}

/** 轨道联合类型：视频 / 图片 / 文本卡 / 形状 / 转场。 */
export type CompositionTrack =
  | VideoClipTrack
  | ImageClipTrack
  | TextCardTrack
  | ShapeTrack
  | TransitionTrack

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

/** 缓动白名单（CV-334）：不开放任意贝塞尔 —— 模型会编出非法控制点。 */
export type AnimateEasing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'

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
}

export interface VideoClipTrack extends BaseTrack {
  type: 'video'
  /** 同源资产 URL（`/canvas-studio/assets/...`）或本地绝对路径。 */
  src: string
  /** 是否启用 Ken-Burns 缓慢推拉（默认 false）。 */
  kenBurns?: boolean
}

export interface ImageClipTrack extends BaseTrack {
  type: 'image'
  src: string
  /** 图片展示形态：`cover`（默认，填满）/ `contain`（留边）/ `kenburns`。 */
  fit?: 'cover' | 'contain' | 'kenburns'
  caption?: string
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
}

export interface ShapeTrack extends BaseTrack {
  type: 'shape'
  shape: 'rect' | 'circle' | 'line' | 'gradient'
  color: string
  /** 相对画布的百分比坐标（0–100）。`transform` / `animate` 给出 x/y 时以它们为准。 */
  box?: { x: number; y: number; w: number; h: number }
}

export interface TransitionTrack extends BaseTrack {
  type: 'transition'
  /** 作用于相邻两轨的转场类型。 */
  effect: 'fade' | 'slide' | 'zoom' | 'dissolve'
  /** 作用的源轨道 id（前一轨）。 */
  fromTrackId: string
  /** 作用的目标轨道 id（后一轨）。 */
  toTrackId: string
}

export interface ManifestAudio {
  /** BGM 资产 URL（复用 `compose_video` 的 `bgmNodeId` 语义）。 */
  bgmUrl?: string
  /** 旁白资产 URL（`tts_voiceover` 产物）。 */
  voiceOverUrl?: string
  /** 混音音量（0–1），缺省走 `BGM_MIX_VOLUME` / 1.0。 */
  mix?: { bgmVolume?: number; voiceVolume?: number }
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

const TRACK_TYPES = new Set(['video', 'image', 'textCard', 'shape', 'transition'])
const TEXT_VARIANTS = new Set(['subtitle', 'dataCard', 'title', 'bullets'])
const SHAPES = new Set(['rect', 'circle', 'line', 'gradient'])
const EFFECTS = new Set(['fade', 'slide', 'zoom', 'dissolve'])
const IMAGE_FITS = new Set(['cover', 'contain', 'kenburns'])
/** CV-334：缓动白名单（与 `AnimateEasing` 同域，非法值报错而非静默回退）。 */
const ANIMATE_EASINGS = new Set(['linear', 'easeIn', 'easeOut', 'easeInOut'])

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
const KNOWN_META_KEYS = new Set(['title', 'width', 'height', 'fps', 'durationInFrames', 'backgroundColor'])
const KNOWN_BASE_TRACK_KEYS = new Set(['id', 'type', 'startFrame', 'durationInFrames', 'transform', 'animate', 'fadeFrames'])
const KNOWN_TRACK_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  video: new Set(['src', 'kenBurns']),
  image: new Set(['src', 'fit', 'caption']),
  textCard: new Set(['variant', 'text', 'data', 'accentColor']),
  shape: new Set(['shape', 'color', 'box']),
  transition: new Set(['effect', 'fromTrackId', 'toTrackId']),
}
const KNOWN_TRANSFORM_KEYS = new Set(['x', 'y', 'scale', 'rotation'])
const KNOWN_VISUAL_STATE_KEYS = new Set(['x', 'y', 'scale', 'rotation', 'opacity'])
const KNOWN_ANIMATE_KEYS = new Set(['from', 'to', 'startFrame', 'durationInFrames', 'easing'])
const KNOWN_AUDIO_KEYS = new Set(['bgmUrl', 'voiceOverUrl', 'mix'])
const KNOWN_MIX_KEYS = new Set(['bgmVolume', 'voiceVolume'])
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
    }
  }

  if (isRecord(input.audio)) {
    warnUnknownKeys(input.audio, KNOWN_AUDIO_KEYS, 'audio', found)
    warnUnknownKeys(input.audio.mix, KNOWN_MIX_KEYS, 'audio.mix', found)
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
      errors.push(`${label}.easing 非法（${String(easing)}）—— 白名单：linear / easeIn / easeOut / easeInOut`)
    }
  }
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
    if (typeof start !== 'number' || !Number.isFinite(start) || start < 0 || !Number.isInteger(start)) {
      errors.push(`${at}.startFrame 必须是 >= 0 的整数（帧）`)
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

    switch (type) {
      case 'video':
      case 'image':
        if (!isNonEmptyString(track.src) || !isAllowedManifestAssetRef(track.src)) {
          errors.push(`${at}.src 必须是 ${ASSET_URL_PREFIX} 开头的同源资产 URL（或以 / 开头的绝对路径，须位于本项目资产目录内，宿主会物化为同源 URL）`)
        }
        if (type === 'image' && track.fit !== undefined && (typeof track.fit !== 'string' || !IMAGE_FITS.has(track.fit))) {
          errors.push(`${at}.fit 非法（${String(track.fit)}）`)
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
        break
      }
      case 'shape':
        if (typeof track.shape !== 'string' || !SHAPES.has(track.shape)) {
          errors.push(`${at}.shape 非法（${String(track.shape)}）`)
        }
        if (!isNonEmptyString(track.color)) errors.push(`${at}.color 必须是非空字符串`)
        break
      case 'transition':
        if (typeof track.effect !== 'string' || !EFFECTS.has(track.effect)) {
          errors.push(`${at}.effect 非法（${String(track.effect)}）`)
        }
        if (!isNonEmptyString(track.fromTrackId)) errors.push(`${at}.fromTrackId 必须是非空字符串`)
        if (!isNonEmptyString(track.toTrackId)) errors.push(`${at}.toTrackId 必须是非空字符串`)
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

  return { ok: errors.length === 0, errors, warnings }
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
    const fromStart = from.startFrame as number
    const fromEnd = fromStart + (from.durationInFrames as number)
    const toStart = to.startFrame as number
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
 * 规则（与 `compose.ts` 的角标语义对齐；`native` = 至少一条 video 轨的**原生环境声**）：
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
 *
 * CV-334（D6）改动：此前 `voiceOver` 被**并入 `bgm` 位** —— 纯代码片明明有旁白，
 * 角标却显示「纯 BGM」，用户看不出"这里有旁白"。现按「原生声 / BGM / 旁白」三个
 * 布尔正交展开，`StudioAudioComposition` 扩到 8 值（旧 4 值语义**完全不变** ⇒
 * 老画布数据照常显示）。
 */
export function deriveAudioComposition(manifest: CompositionManifest): StudioAudioComposition {
  const hasNative = manifest.tracks.some((track) => track.type === 'video')
  const hasBgm = isNonEmptyString(manifest.audio?.bgmUrl)
  const hasVoiceOver = isNonEmptyString(manifest.audio?.voiceOverUrl)
  if (hasNative) {
    if (hasBgm && hasVoiceOver) return 'native+bgm+voiceOver'
    if (hasBgm) return 'native+bgm'
    if (hasVoiceOver) return 'native+voiceOver'
    return 'native'
  }
  if (hasBgm && hasVoiceOver) return 'bgm+voiceOver'
  if (hasBgm) return 'bgm'
  if (hasVoiceOver) return 'voiceOver'
  return 'none'
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
