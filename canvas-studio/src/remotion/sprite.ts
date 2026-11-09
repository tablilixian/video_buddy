/**
 * CV-392（REQ-036 R-2）：`image` 轨 `sourceRect` —— 精灵图子区域裁切。
 *
 * 语义：`sourceRect` 用**百分比（0–100，与 box 同口径）**从源图圈出一块子区域，
 * 圈出的区域按既有 `fit` 语义（cover / contain；kenburns 在组件层乘 extraScale）
 * 铺进轨道层 —— 「把圈出的区域当作这张图」。缺省不写 = 整图，老 manifest 零影响。
 *
 * 实现口径（CSR 写法护栏，bench 实证）：纯 DOM。区域映射 = `<img>` 元素按
 * scale 放大 + 负偏移对准区域 + 层 overflow hidden 裁掉溢出 + `objectFit:'fill'`
 * （源图精确拉伸到元素盒，不依赖 background-position —— 那条路不等待图片加载）。
 * cover / contain 的等比缩放需要源图自然尺寸：组件层在 onLoad 里测（Remotion
 * 官方 delayRender 模式，帧截图必等测量完成；AudioViz decodeAudioData 同款先例）。
 * 本文件全部是**纯函数**，单测直连。
 */

/** `sourceRect` 的形状：四字段全必填，百分比 0–100，`x+w ≤ 100`、`y+h ≤ 100`。 */
export interface SpriteRect {
  x: number
  y: number
  w: number
  h: number
}

/** 容差：百分比边界比较用的浮点余量（与校验层共用，避免 0.1+0.2 类尾差误杀）。 */
const EPS = 1e-6

/**
 * `validateManifest` 用：非法即 push 错误（硬失败，与 fit/src 同级口径）。
 * 调用方保证 value 已知存在（`track.sourceRect !== undefined` 分支内）。
 */
export function validateSpriteRect(value: unknown, at: string, errors: string[]): void {
  const label = `${at}.sourceRect`
  if (typeof value !== 'object' || value === null) {
    errors.push(`${label} 必须是 {x,y,w,h} 百分比对象`)
    return
  }
  const rect = value as Record<string, unknown>
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    const v = rect[key]
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push(`${label}.${key} 必须是有限数值`)
      return
    }
  }
  const { x, y, w, h } = rect as unknown as SpriteRect
  if (x < -EPS || y < -EPS || x > 100 + EPS || y > 100 + EPS) {
    errors.push(`${label}.x/.y 必须在 0–100（百分比，与 box 同口径）`)
    return
  }
  if (w <= EPS || h <= EPS) {
    errors.push(`${label}.w/.h 必须大于 0`)
    return
  }
  if (x + w > 100 + EPS || y + h > 100 + EPS) {
    errors.push(`${label} 越界：x+w 与 y+h 不得大于 100（当前 ${x + w} / ${y + h}）—— 缩小 w/h 或把 x/y 左移上移；sourceRect 是百分比，不是像素`)
  }
}

export interface SpriteRegionLayout {
  /** 区域铺层模式：`cover` = 等比铺满（溢出裁掉）/ `contain` = 等比完整可见（留边居中）。 */
  mode: 'cover' | 'contain'
  /** 层的像素尺寸：box 约束层 = 画布尺寸 × box 百分比；无 box = 画布尺寸。 */
  layerW: number
  layerH: number
}

/**
 * 区域 → 层 的 `<img>` 显式几何（px）。调用前提：natural 已测得（组件在 onLoad
 * 之后才应用本样式；帧截图被 delayRender 挡住，首帧不存在未测量态）。
 *
 * 返回四元组含义：`<img>` 元素 = 整图按 `scale` 放大后的盒子（配 objectFit:'fill'
 * = 源图精确拉伸到元素盒）；`left/top` 让**区域的左上角**落在「区域在层内居中」
 * 的位置 ⇒ 层（overflow hidden）里可见的恰好是区域本身按 cover/contain 铺满的效果。
 *
 * 退化口径：区域或层尺寸非正（坏图 natural=0 等）→ 退回**纯百分比拉伸填满**
 * （不需要自然尺寸的兜底式），绝不抛错卡渲染。
 */
export function spriteRegionStyle(
  rect: SpriteRect,
  natural: { w: number; h: number },
  layout: SpriteRegionLayout,
): { left: number; top: number; width: number; height: number } {
  const { x, y, w, h } = rect
  const regionW = (natural.w * w) / 100
  const regionH = (natural.h * h) / 100
  if (!(regionW > 0) || !(regionH > 0) || !(layout.layerW > 0) || !(layout.layerH > 0)) {
    return {
      left: (-x / w) * layout.layerW,
      top: (-y / h) * layout.layerH,
      width: (100 / w) * layout.layerW,
      height: (100 / h) * layout.layerH,
    }
  }
  const scale =
    layout.mode === 'contain'
      ? Math.min(layout.layerW / regionW, layout.layerH / regionH)
      : Math.max(layout.layerW / regionW, layout.layerH / regionH)
  const width = natural.w * scale
  const height = natural.h * scale
  const left = (layout.layerW - regionW * scale) / 2 - (x / 100) * natural.w * scale
  const top = (layout.layerH - regionH * scale) / 2 - (y / 100) * natural.h * scale
  return { left, top, width, height }
}
