/**
 * 品牌令牌 DOM 注入（client 半）。
 *
 * 单例 `<style data-plugin="canvas-studio" data-cs-brand="<presetId>">` 元素，
 * 与组件样式（styles.ts 的 installStudioStyles）并列挂在 head，二者都以
 * `data-plugin='canvas-studio'` 标记做品牌级隔离。切换预设 = 更新该元素的
 * `textContent`（完整 `--cs-*` 令牌）与 `data-cs-brand` 属性（选择器锚点）。
 */
import { brandCssText, DEFAULT_BRAND_PRESET, FAVICON_DATA_URL, resolveBrandPreset, type BrandPresetId } from '../brand.js'

const PLUGIN_ID = 'canvas-studio'
const BRAND_ATTR = 'data-cs-brand'

let brandElement: HTMLStyleElement | null = null
let activePreset: BrandPresetId = DEFAULT_BRAND_PRESET

/** 创建 / 复用品牌样式元素（幂等；被外部移除时重建）。
 * 挂在 `document.body`（而非 head）：品牌令牌的深色轨道选择器是
 * `body[data-ds-dark-theme] [data-cs-brand=…]`，元素必须在 body 内才匹配。 */
export function ensureBrandElement(): HTMLStyleElement {
  if (brandElement !== null && brandElement.isConnected) return brandElement
  brandElement = document.createElement('style')
  brandElement.setAttribute('data-plugin', PLUGIN_ID)
  brandElement.setAttribute(BRAND_ATTR, activePreset)
  brandElement.textContent = brandCssText(activePreset)
  document.body.appendChild(brandElement)
  return brandElement
}

/** 应用某预设（更新 CSS 变量 + data-cs-brand 属性），幂等，返回生效的 preset id。 */
export function applyBrandPreset(presetId: string | null | undefined): BrandPresetId {
  const preset = resolveBrandPreset(presetId)
  activePreset = preset.id
  const element = ensureBrandElement()
  element.setAttribute(BRAND_ATTR, preset.id)
  element.textContent = brandCssText(preset.id)
  return preset.id
}

/** 当前生效的品牌预设 id（默认 cinema-violet）。 */
export function getActiveBrandPreset(): BrandPresetId {
  return activePreset
}

/** 注入品牌 favicon（data: URL 单色场记板），幂等。 */
export function installBrandFavicon(): void {
  if (document.head.querySelector('link[data-plugin="canvas-studio"][rel="icon"]') !== null) return
  const link = document.createElement('link')
  link.setAttribute('rel', 'icon')
  link.setAttribute('data-plugin', PLUGIN_ID)
  link.href = FAVICON_DATA_URL
  document.head.appendChild(link)
}

/** 安装品牌令牌（默认或给定预设）+ favicon，返回卸载函数（CR-042：真正移除
 * 注入的 DOM 元素并复位引用——否则 effect 重跑会再 createElement，旧 <style>
 * 残留在 body 里累积品牌样式）。 */
export function installBrandStyles(presetId: string | null | undefined): () => void {
  applyBrandPreset(presetId)
  installBrandFavicon()
  return () => {
    if (brandElement !== null) {
      brandElement.remove()
      brandElement = null
    }
    document.head.querySelector('link[data-plugin="canvas-studio"][rel="icon"]')?.remove()
  }
}
