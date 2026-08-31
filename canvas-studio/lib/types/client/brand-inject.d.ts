/**
 * 品牌令牌 DOM 注入（client 半）。
 *
 * 单例 `<style data-plugin="canvas-studio" data-cs-brand="<presetId>">` 元素，
 * 与组件样式（styles.ts 的 installStudioStyles）并列挂在 head，二者都以
 * `data-plugin='canvas-studio'` 标记做品牌级隔离。切换预设 = 更新该元素的
 * `textContent`（完整 `--cs-*` 令牌）与 `data-cs-brand` 属性（选择器锚点）。
 */
import { type BrandPresetId } from '../brand.js';
/** 创建 / 复用品牌样式元素（幂等；被外部移除时重建）。
 * 挂在 `document.body`（而非 head）：品牌令牌的深色轨道选择器是
 * `body[data-ds-dark-theme] [data-cs-brand=…]`，元素必须在 body 内才匹配。 */
export declare function ensureBrandElement(): HTMLStyleElement;
/** 应用某预设（更新 CSS 变量 + data-cs-brand 属性），幂等，返回生效的 preset id。 */
export declare function applyBrandPreset(presetId: string | null | undefined): BrandPresetId;
/** 当前生效的品牌预设 id（默认 cinema-violet）。 */
export declare function getActiveBrandPreset(): BrandPresetId;
/** 注入品牌 favicon（data: URL 单色场记板），幂等。 */
export declare function installBrandFavicon(): void;
/** 安装品牌令牌（默认或给定预设）+ favicon，返回卸载函数（元素常驻，仅断开引用）。 */
export declare function installBrandStyles(presetId: string | null | undefined): () => void;
