/**
 * 音效合成库入口（0A · CV-460）。
 *
 * 只在**构建期**被 `scripts/build-sfx.mjs` 调用，产出 `assets/sfx/*.wav` 与清单。
 * 渲染期不引用本模块 —— 浏览器里跑不了这套 DSP，且实时合成无法保证确定性
 * （见任务包 0A 决策 2：合成离线、渲染只读文件）。
 */
export * from './dsp.js'
export * from './wav.js'
export * from './voices.js'

/** 包内音效的 URL 前缀。与 `routes.ts` 的 `ROUTE_REMOTION_SFX` 必须一致。 */
export const SFX_URL_PREFIX = '/canvas-studio/remotion/sfx'

/** 清单文件的版本号。改 WAV 生成逻辑时**必须**一起改，否则幂等跳过会留旧素材。 */
export const SFX_ASSET_VERSION = 1

/** 清单里的一支音效。 */
export interface SfxAssetEntry {
  /** 与 `type` / 文件名同一套词。 */
  id: string
  label: string
  /** 相对 `assets/`：`sfx/<id>.wav`。 */
  file: string
  /** 对外 URL：`/canvas-studio/remotion/sfx/<id>.wav`。 */
  url: string
  bytes: number
  frames: number
  durationSec: number
  sampleRate: number
  /** 归一化后的峰值（0–1），供校验层判断素材是否过小。 */
  peak: number
  /** 该素材由哪条配方产出（溯源；manifest 的 `type` 与此对应）。 */
  recipe: string
}

/**
 * 素材清单（`assets/sfx/manifest.json`）。
 *
 * 存在的唯一理由：校验层要能回答「这个 `src` 是不是本仓合成的」。是 ⇒ `pan`
 * 声明有效；不是（用户自带）⇒ 必须发 warning「外部音效素材不支持声像」。
 * 没有这份清单，那个判断只能靠字符串前缀猜，一改目录就静默失效。
 */
export interface SfxAssetManifest {
  version: number
  generatedBy: 'build-sfx'
  sampleRate: number
  /** 归一化目标峰值。改它会让所有素材的音量基准一起漂 ⇒ 必须同时改 version。 */
  normalizePeak: number
  voices: SfxAssetEntry[]
}
