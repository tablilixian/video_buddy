/**
 * 卡注册表的**总装入口**：核心注册表(`recipe-cards.ts`)+ 各类目卡文件的副作用注册。
 *
 * 为什么单独一个文件：类目卡文件 `import { registerCard } from './recipe-cards.js'`
 * 是单向依赖；本文件把「注册全部卡」收敛成一个 import 点 —— 消费方
 * (`recipes.ts` / `content-spec.ts` / 测试)只 import 这里，新类目文件加进来
 * 不需要改任何调用方。
 *
 * 2026-11-13 SSR 消化批：`recipe-cards-<类目>.ts` 十个类目文件(CAM/DAT/TYP/UI/
 * FX/TRN/INT/RHY/OPN/OUT 前缀),来源 = video-shotcraft-dsh demos(Apache-2.0,
 * 手法参考、表达重写;逐卡翻译对照见 shotcraft-catalog.md)。
 */
import './recipe-cards.js'
import './recipe-cards-camera.js'
import './recipe-cards-data.js'
import './recipe-cards-typography.js'
import './recipe-cards-ui.js'
import './recipe-cards-effects.js'
import './recipe-cards-transition.js'
import './recipe-cards-interaction.js'
import './recipe-cards-rhythm.js'
import './recipe-cards-opening.js'
import './recipe-cards-outro.js'

export {
  registerCard,
  getCard,
  lookupCardId,
  registeredCardIds,
  type CardDefinition,
  type CardAssetDecl,
  type CardRenderContext,
  type CardTrackGenerator,
} from './recipe-cards.js'
