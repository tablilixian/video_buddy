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
}

/** 静态变换（百分比坐标系，相对画布；组件用 `interpolate` 对其做帧级动画）。 */
export interface Transform {
  /** 水平中心位置（0–100，默认 50 居中）。 */
  x?: number
  /** 垂直中心位置（0–100，默认 50 居中）。 */
  y?: number
  /** 缩放倍数，默认 1。 */
  scale?: number
  /** 旋转角度（度），默认 0。 */
  rotation?: number
}

export interface VideoClipTrack extends BaseTrack {
  type: 'video'
  /** 同源资产 URL（`/canvas-studio/assets/...`）或本地绝对路径。 */
  src: string
  transform?: Transform
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
  /** 相对画布的百分比坐标（0–100）。 */
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
 * MVP 规则（与 `compose.ts` 的角标语义对齐）：
 * - 存在 `video` 轨（默认带原声）→ 有 bgm 或 voiceOver ? `native+bgm` : `native`
 * - 无 `video` 轨 → 有 bgm 或 voiceOver ? `bgm` : `none`
 *
 * 注：现有角标枚举无「旁白」独立位，`voiceOver` 并入 `bgm` 位；未来若要区分需扩展
 * `StudioAudioComposition` 枚举（二期，需客户端角标同步）。
 */
export function deriveAudioComposition(manifest: CompositionManifest): StudioAudioComposition {
  const hasVideo = manifest.tracks.some((track) => track.type === 'video')
  const hasExtraAudio = isNonEmptyString(manifest.audio?.bgmUrl) || isNonEmptyString(manifest.audio?.voiceOverUrl)
  if (hasVideo) return hasExtraAudio ? 'native+bgm' : 'native'
  return hasExtraAudio ? 'bgm' : 'none'
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
