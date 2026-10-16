/**
 * REQ-034 · R1：字体族的传递通道（React context，避免逐层透传）。
 *
 * 为什么不是 prop 透传：`StudioComposition → TrackBody → TextCard/ImageClip` 三层，
 * 且 `TrackBody` 是 `switch` 分发器 —— 加一个 prop 要改四处签名，且将来新增组件还会再漏。
 *
 * 取值为**已组好兜底栈的 CSS 值**（`fonts.ts` 的 `fontFamilyStack`），组件拿到即可直接赋值。
 * 缺省值是随包中文字体 —— 意味着组件在**没有 Provider**（如 Remotion Studio 单组件预览）时
 * 也不会退回 `sans-serif`。
 */
import { createContext, useContext } from 'react'
import { BUNDLED_FONT_FAMILY, fontFamilyStack } from '../fonts.js'

export const FontFamilyContext = createContext<string>(fontFamilyStack(BUNDLED_FONT_FAMILY))

/** 文本节点应使用的 `font-family` 栈。 */
export function useFontFamilyStack(): string {
  return useContext(FontFamilyContext)
}
