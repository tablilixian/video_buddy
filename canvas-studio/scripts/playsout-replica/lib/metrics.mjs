/**
 * 真实字体度量（HarfBuzz）—— 让 manifest 的排版按**实际字宽**落位。
 *
 * 为什么需要它：manifest DSL 的文本轨（`textCard`）一律把文字**居中**在 `box` 里，
 * 而源工程的标题卡 / 眉标 / 芯片全是**左对齐**。要把居中文本放成左对齐，
 * 就必须知道这段文字到底多宽 —— 用估值会漂，用真实字宽则一字不差。
 *
 * 实现：`fontverter` 把 woff2 解成 sfnt → `harfbuzzjs`（WASM）取每个字形的
 * advance 宽度 → 乘字号得像素宽。**只用仓库已有的依赖，不新增。**
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { convert } from 'fontverter'
import * as hb from 'harfbuzzjs'

/** 源工程字体文件（staging 后的扁平名）。 */
export const FONT_FILES = {
  'NBDisplay-800': 'fonts-NewBlackTypeface-ExtraBold.woff2',
  'NBDisplay-700': 'fonts-NewBlackTypeface-Bold.woff2',
  'RedHatDisplay-500': 'fonts-RedHatDisplay-Medium.woff2',
  'RedHatDisplay-600': 'fonts-RedHatDisplay-SemiBold.woff2',
}

/** 已加载的 face 缓存（key = face key）。 */
const faces = new Map()

/**
 * 预加载字体。**必须 await 一次**，之后 `textWidth` 可同步调用。
 * @param {string} fontDir staging 素材目录（扁平字体文件所在处）
 */
export async function initMetrics(fontDir) {
  if (faces.size > 0) return
  for (const key of Object.keys(FONT_FILES)) {
    const sfnt = await convert(readFileSync(join(fontDir, FONT_FILES[key])), 'sfnt')
    faces.set(key, new hb.Face(new hb.Blob(sfnt)))
  }
}

/** 同步取字宽（需先 `await initMetrics(...)`）。 */
export function textWidth(text, options) {
  const { faceKey = 'NBDisplay-800', size = 84, letterSpacing = 0 } = options
  const face = faces.get(faceKey)
  if (face === undefined) throw new Error(`字体未加载：${faceKey}（先 await initMetrics(...)）`)
  const font = new hb.Font(face)
  const buffer = new hb.Buffer()
  buffer.addText(text)
  buffer.guessSegmentProperties()
  hb.shape(font, buffer)
  const units = buffer.getGlyphPositions().reduce((sum, p) => sum + p.xAdvance, 0)
  const advance = (units / face.upem) * size
  // CSS 的 letter-spacing 在**每个字符之后**都加一次（含末字符）。
  return advance + text.length * letterSpacing
}
