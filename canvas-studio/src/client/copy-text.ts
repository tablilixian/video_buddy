/**
 * CV-335：复制一段纯文本到剪贴板 —— **本文件不碰 `navigator.clipboard`**。
 *
 * 全仓只在 `client/canvas/clipboard-env.ts` 一处接触剪贴板 API（守卫
 * `tests/clipboard-copy.test.mjs` 遍历 `src/` 锁死这条「唯一性」）。`SkillImportWizard`
 * 与 `SkillMarket` 都要给用户一个「复制路径」按钮，若各自写 `navigator.clipboard?.writeText`
 * 就会同时踩两条线：① 破坏唯一性守卫；② 能力探测各写一份，迟早漂移。
 *
 * ## 为什么失败是**静默**的
 *
 * 复制的目标是一段**已经显示在界面上的路径** —— 用户能看见、能自己选中复制。
 * 所以「点了没反应」的代价极低，而弹一个用户无法处置的权限错误（剪贴板权限在
 * iframe / 非聚焦窗口下会被拒）反而更像故障。原实现用 `?.` 可选链，语义就是「有就写、
 * 没有就当没点」，这里保持同一语义。
 */
import { clipboardEnv } from './canvas/clipboard-env.js'

/** 复制文本；能力缺失或权限被拒时**静默返回**（调用方不必包 try/catch）。 */
export function copyTextQuietly(text: string): void {
  void clipboardEnv().writeText(text).catch(() => {})
}
