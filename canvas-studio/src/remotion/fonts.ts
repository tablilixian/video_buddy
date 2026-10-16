/**
 * REQ-034 · R1：随包中文字体解析（**纯函数**，Host / Client / React 组件共用）。
 *
 * 背景（devdoc §8.3 方案 C 混合，route B 版）：组件原先硬编码 `font-family: sans-serif`，
 * 中文靠渲染进程的系统字体侥幸渲染 —— 非 macOS / 无该字体的机器会**静默 fallback**（观感事故），
 * 且不满足「离线一致 / 断网出片」。这里把随包中文字体子集（`assets/fonts/*.woff2`，
 * 由 `scripts/build-font-subset.mjs` 产出）解析成客户端渲染前要注入的 `@font-face` 清单。
 *
 * 纪律：
 *   - **禁 import node 内置** —— 本模块会被客户端 bundle 与 `.tsx` 组件消费。
 *   - 渲染位置在**客户端渲染进程**，故字体 URL 一律是**同源相对路径**（宿主只读路由
 *     `/canvas-studio/remotion/fonts/…`）。跨源 `@font-face` 会静默 404 → 回退系统字体，
 *     这是 devdoc §8.3 第 4 条标红的最易漏点。
 *   - **本版不做下载链**（devdoc §8.3 第 2 条：依赖 Drama 后端 `/fonts/` 静态路由，
 *     属非 MVP 外部前置）⇒ 未命中随包时**回落 + warning**，不阻断渲染。
 */
import type { CompositionManifest } from './manifest.js'

/**
 * 随包字体族名。
 * ⚠️ 三处必须逐字一致：本常量、`scripts/build-font-subset.mjs` 的 `FAMILY`、
 * `assets/fonts/*.woff2` 的实际族名（守卫 `tests/remotion-fonts.test.mjs`）。
 */
export const BUNDLED_FONT_FAMILY = 'Noto Sans SC'

/** 随包字体只读路由前缀（宿主 `src/routes.ts` 的 `ROUTE_REMOTION_FONTS`）。 */
export const REMOTION_FONT_ROUTE_PREFIX = '/canvas-studio/remotion/fonts'

/**
 * 随包字重 → 文件名。只随包 400/700 两个字重（组件实际只用这两个；其余字重由浏览器
 * 在同一族内就近匹配，不会触发合成粗体之外的问题 —— 这也是选静态双字重而非可变字体的原因：
 * 单文件更小、无 `font-weight: 250 900` 这类轴声明风险）。
 */
export const BUNDLED_FONT_FILES: Readonly<Record<number, string>> = {
  400: 'noto-sans-sc-400.woff2',
  700: 'noto-sans-sc-700.woff2',
}

/** 随包字体字重清单（`BUNDLED_FONT_FILES` 的键，顺序固定）。 */
export const BUNDLED_FONT_WEIGHTS: readonly number[] = [400, 700]

/** 一条待注入的 `@font-face` 面。 */
export interface ResolvedFontEntry {
  family: string
  weight: number
  /** 同源 URL（宿主只读路由相对路径，或 manifest 里声明的同源 `src`）。 */
  url: string
}

export interface ResolvedFonts {
  /** 需要注入的字体面（已去重、已按族名/字重排序）。 */
  entries: ResolvedFontEntry[]
  /** 文本节点实际使用的族名（声明不可用时已回落到随包族名）。 */
  defaultFamily: string
  /** 非致命告警 —— 由调用方并入 `ComposeToolResult.warnings`（不阻断渲染）。 */
  warnings: string[]
}

/** 去引号 + 去首尾空白（`fontFamily: '"Noto Sans SC"'` 与 `Noto Sans SC` 视为同一族）。 */
function normalizeFamily(value: string): string {
  return value.trim().replace(/^["']+|["']+$/g, '')
}

/**
 * 组件的 CSS `font-family` 值（族名 + 兜底栈）。
 *
 * 兜底栈不是可选项：子集只覆盖 GB2312 全集 + 常用标点，**子集外的字**（生僻字、日文假名、
 * 韩文、emoji）必须交给系统字体，否则就是豆腐块 □。
 */
export function fontFamilyStack(family: string): string {
  const quoted = `"${family}"`
  return family === BUNDLED_FONT_FAMILY ? `${quoted}, sans-serif` : `${quoted}, "Noto Sans SC", sans-serif`
}

/** 随包字体的两个面（同源 URL）。 */
function bundledEntries(): ResolvedFontEntry[] {
  return BUNDLED_FONT_WEIGHTS.map((weight) => ({
    family: BUNDLED_FONT_FAMILY,
    weight,
    url: `${REMOTION_FONT_ROUTE_PREFIX}/${BUNDLED_FONT_FILES[weight] ?? ''}`,
  }))
}

/**
 * 解析一个 manifest 需要哪些字体面。
 *
 * 判定顺序：
 *   1. `global.fonts[]` 声明的面：随包族 → 跳过（下面统一补齐）；带同源 `src` → 直接注入；
 *      既未随包又无 `src` → warning + 回落随包（本版无下载链）。
 *   2. `global.fontFamily` 缺省族名：随包 / 已在上面解析出的族 → 用它；否则 warning + 回落随包。
 *   3. 最终用随包族时，注入随包的两个面 ⇒ **离线必出片**。
 */
export function resolveFonts(manifest: CompositionManifest): ResolvedFonts {
  const warnings: string[] = []
  const declared = manifest.global?.fonts ?? []
  const entries: ResolvedFontEntry[] = []
  /** 同一族只报一次 —— `fonts[]` 与 `fontFamily` 常指同一族，重复告警只会淹没真问题。 */
  const warnedFamilies = new Set<string>()

  for (const font of declared) {
    const family = normalizeFamily(font.family)
    if (family === BUNDLED_FONT_FAMILY) continue
    const weight = font.weight ?? 400
    if (font.src !== undefined && font.src.length > 0) {
      entries.push({ family, weight, url: font.src })
      continue
    }
    if (warnedFamilies.has(family)) continue
    warnedFamilies.add(family)
    warnings.push(
      `字体「${family}」未随包，且本版未启用字体下载链（devdoc §8.3 第 2 条为非 MVP 外部前置），`
      + `已回退随包中文字体「${BUNDLED_FONT_FAMILY}」。`,
    )
  }

  const requestedRaw = manifest.global?.fontFamily
  const requested = requestedRaw === undefined ? undefined : normalizeFamily(requestedRaw)
  const usable = (candidate: string): boolean =>
    candidate === BUNDLED_FONT_FAMILY || entries.some((entry) => entry.family === candidate)

  let defaultFamily = BUNDLED_FONT_FAMILY
  if (requested !== undefined && requested.length > 0) {
    if (usable(requested)) {
      defaultFamily = requested
    } else if (!warnedFamilies.has(requested)) {
      warnedFamilies.add(requested)
      warnings.push(
        `缺省字体族「${requested}」既未随包也未提供同源 src，已回退随包中文字体「${BUNDLED_FONT_FAMILY}」。`,
      )
    }
  }

  if (defaultFamily === BUNDLED_FONT_FAMILY) entries.unshift(...bundledEntries())

  const seen = new Set<string>()
  const deduped = entries.filter((entry) => {
    const key = `${entry.family}|${entry.weight}|${entry.url}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  deduped.sort((a, b) => (a.family === b.family ? a.weight - b.weight : a.family.localeCompare(b.family)))

  return { entries: deduped, defaultFamily, warnings }
}
