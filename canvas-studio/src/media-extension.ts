/**
 * 文件名扩展名解析（纯函数）。
 *
 * 音频（`audio-reference.ts`）与视频（`video-reference.ts`）两侧都要按扩展名
 * 做格式把关。**同一规则只准一份实现** —— 故提升到这里，两侧共用。
 */

/** 取小写扩展名（含点）；无扩展名返回空串。 */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot < 0 ? '' : filename.slice(dot).toLowerCase()
}
