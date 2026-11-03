/**
 * OPT-8（2026-10-26）：**z-order 风险体检**（只 warning）。
 *
 * 为什么独立成文件（P1 pivot 落码，2026-11-03）：`manifest.ts` 在文件行数棘轮
 * 白名单上（tests/file-size-guard.test.mjs，「只准减不准增」），本轮 pivot 字段
 * + 校验让它超标，按超大文件拆分纪律把这块**自包含**（仅依赖 isRecord）的体检
 * 拆到这里。行为与拆出前逐字符一致，`validateManifest` 经 import 继续调用。
 *
 * track 数组序 = 层叠序（靠后在上）。无 box 的 video/image 轨铺满画布，排在
 * 内容轨（textCard / shape）之后时，重叠时间段内下方内容会被画面整体盖住 ——
 * 真机实证：全屏视频轨放在 title 卡之后 → 卡片「消失」，agent 只能改轨序绕过。
 * 渲染端底色已改为只跟媒体元素（同日修复），但视频画面本身仍是不透明覆盖，
 * 所以这条体检仍有价值：模型在收稿前就该看到提醒，而不是等渲染返工。
 *
 * 豁免：媒体轨带 box（只覆盖子区域）；下方 shape 的 box 铺满画布（本来就是
 * 全屏背景层，被盖住是预期）；时间不重叠（先后出场互不遮挡）。每条媒体轨只报一次。
 */

/** 与 manifest.ts 的同名守卫同实现（3 行类型守卫不值得为它引依赖环）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function lintZOrder(tracks: unknown[]): string[] {
  const out: string[] = []
  const isMedia = (t: unknown): t is Record<string, unknown> =>
    isRecord(t) && (t.type === 'video' || t.type === 'image')
  const isContent = (t: unknown): t is Record<string, unknown> =>
    isRecord(t) && (t.type === 'textCard' || t.type === 'shape')
  const span = (t: Record<string, unknown>): [number, number] => {
    const start = typeof t.startFrame === 'number' && Number.isFinite(t.startFrame) ? t.startFrame : 0
    const duration = typeof t.durationInFrames === 'number' && Number.isFinite(t.durationInFrames) ? t.durationInFrames : 0
    return [start, start + duration]
  }
  for (let i = 0; i < tracks.length; i += 1) {
    const media = tracks[i]
    if (!isMedia(media) || media.box !== undefined) continue
    const [mStart, mEnd] = span(media)
    for (let j = 0; j < i; j += 1) {
      const below = tracks[j]
      if (!isContent(below)) continue
      if (below.type === 'shape') {
        const box = below.box
        // 全屏背景 shape（无 box 缺省 30×20 也不是全屏；显式铺满才豁免）：
        const full = isRecord(box)
          && typeof box.x === 'number' && typeof box.y === 'number'
          && typeof box.w === 'number' && typeof box.h === 'number'
          && box.w >= 95 && box.h >= 95
        if (full) continue
      }
      const [bStart, bEnd] = span(below)
      if (Math.min(mEnd, bEnd) - Math.max(mStart, bStart) <= 0) continue
      const mid = typeof media.id === 'string' ? media.id : `#${i}`
      const bid = typeof below.id === 'string' ? below.id : `#${j}`
      out.push(
        `z-order 风险：全屏 ${String(media.type)} 轨 "${mid}" 排在内容轨 "${bid}" 之后（数组靠后 = 更上层），重叠时间段内下方内容会被画面盖住 —— `
        + `若需内容浮于视频上，把内容轨移到数组更后；若媒体只该占局部区域，给它加 box`,
      )
      break
    }
  }
  return out
}
