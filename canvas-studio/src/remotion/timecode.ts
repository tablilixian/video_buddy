/**
 * ≥95% 对齐 S1-B：**帧级时间码**（`textCard` 新变体 `timecode` 的取值源）。
 *
 * 为什么单独一个文件：`timing.ts` 在 file-size-guard 的行数棘轮上（只准减不准增），
 * 这个纯函数不值得挤占它的余量；且它与音频/插值域无关，独立成文件可单测、可复述。
 *
 * 确定性铁律：入参只有「轨内相对帧 + fps」，**禁** `Date.now()` / 真实时钟 ——
 * 同一 manifest 渲两次必须逐字节相同（与 `animateStateAt` 同纪律）。
 *
 * 口径（对齐原片 HUD `00:00:38:00`）：`HH:MM:SS:FF`，`FF` 是**帧号**（0 起，
 * `fps - 1` 封顶），不是毫秒 —— 时间码的最后一格在专业时间轴上就是帧。
 */

/** 格式化轨内帧号为 `HH:MM:SS:FF`（纯函数；fps 必须为有限正数，非法时回落 30）。 */
export function timecodeStringAt(frame: number, fps: number): string {
  const safeFps = Number.isFinite(fps) && fps > 0 ? Math.floor(fps) : 30
  const safeFrame = Number.isFinite(frame) && frame >= 0 ? Math.floor(frame) : 0
  const seconds = Math.floor(safeFrame / safeFps)
  const frames = safeFrame % safeFps
  const hh = Math.floor(seconds / 3600)
  const mm = Math.floor((seconds % 3600) / 60)
  const ss = seconds % 60
  const two = (value: number): string => String(value).padStart(2, '0')
  return `${two(hh)}:${two(mm)}:${two(ss)}:${two(frames)}`
}
