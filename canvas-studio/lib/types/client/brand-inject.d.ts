/**
 * 品牌令牌 DOM 注入（client 半）。
 *
 * 单例 `<style data-plugin="canvas-studio">` 元素与组件样式（styles.ts 的
 * installStudioStyles）并列挂在 body；品牌预设锚点 `data-cs-brand` 挂在
 * `document.body` 上——CSS 自定义属性只沿 DOM 树向下继承，锚在 <style>
 * 自身会让令牌永远无法到达页面节点。切换预设 = 更新该元素 textContent
 * （完整 `--cs-*` 令牌）与 body 的 `data-cs-brand` 属性（选择器锚点）。
 */
import { type BrandPresetId } from '../brand.js';
/** 创建 / 复用品牌样式元素（幂等；被外部移除时重建），并在 body 上设置
 * 预设锚点属性（浅色轨道选择器 `body[data-cs-brand=…]` 与深色轨道
 * `body[data-ds-dark-theme][data-cs-brand=…]` 都直接匹配 body 本身）。 */
export declare function ensureBrandElement(): HTMLStyleElement;
/** 应用某预设（更新 CSS 变量 + body 的 data-cs-brand 属性），幂等，返回生效的 preset id。 */
export declare function applyBrandPreset(presetId: string | null | undefined): BrandPresetId;
/** 当前生效的品牌预设 id（默认 cinema-violet）。 */
export declare function getActiveBrandPreset(): BrandPresetId;
/** 注入品牌 favicon（data: URL 单色场记板），幂等。 */
export declare function installBrandFavicon(): void;
/** 安装品牌令牌（默认或给定预设）+ favicon，返回卸载函数（CR-042：真正移除
 * 注入的 DOM 元素、body 上的预设锚点属性并复位引用——否则 effect 重跑会再
 * createElement，旧 <style> 残留在 body 里累积品牌样式）。 */
export declare function installBrandStyles(presetId: string | null | undefined): () => void;
